"""Authenticated, idempotent replay retrieval using the review's saved source."""
import json
import re
import subprocess
import time
import urllib.error
from urllib.parse import urlsplit
from uuid import UUID, uuid4

import worker


def replay_url(value):
    parsed = urlsplit(str(value or '').strip())
    if (parsed.scheme != 'https' or parsed.hostname not in ('twitch.tv', 'www.twitch.tv')
            or parsed.username or parsed.password or parsed.port not in (None, 443)):
        raise worker.Problem(422, 'No saved recording is available. Add a Twitch replay link or use Upload recording. A channel link cannot identify an old game.')
    match = re.fullmatch(r'/(?:videos|v)/([0-9]+)/?', parsed.path)
    if not match:
        raise worker.Problem(422, 'No saved recording is available. Add a Twitch replay link (twitch.tv/videos/...) or use Upload recording. A channel link cannot identify an old game.')
    return 'https://www.twitch.tv/videos/' + match.group(1)


def read_review(review_id, authorization):
    try:
        UUID(review_id)
    except ValueError:
        raise worker.Problem(404, 'Review not found.')
    import os
    base = os.environ['SUPABASE_URL'].rstrip('/')
    headers = {'Authorization': authorization, 'apikey': os.environ['SUPABASE_PUBLISHABLE_KEY']}
    try:
        rows = worker.http_json(base + '/rest/v1/vod_review_sessions?id=eq.' + review_id + '&select=*', headers)
    except (urllib.error.URLError, ValueError):
        raise worker.Problem(503, 'Could not verify access to this review.')
    if not rows:
        raise worker.Problem(404, 'Review not found or management access is missing.')
    review = rows[0]
    if review.get('media_queue_id'):
        try:
            queue_id = str(UUID(review['media_queue_id']))
            queue = worker.http_json(base + '/rest/v1/media_pipeline_queue?id=eq.' + queue_id + '&select=status,worker_job_id', headers)
        except (urllib.error.URLError, ValueError):
            raise worker.Problem(503, 'Could not check the saved game capture. Try again shortly.')
        if queue:
            review['_capture'] = queue[0]
            if queue[0].get('worker_job_id'):
                review['worker_job_id'] = queue[0]['worker_job_id']
    return review


def resolve(review, owner, create=False):
    """The caller supplies a review read through RLS, never unverified body fields."""
    with worker.WRITE_LOCK, worker.connect() as db:
        rows = db.execute('SELECT id,metadata FROM jobs WHERE owner=? ORDER BY created DESC', (owner,)).fetchall()
        for row in rows:
            meta = json.loads(row['metadata'])
            if (row['id'] == review.get('worker_job_id') or meta.get('review_id') == review['id'] or meta.get('game_id') == review['id']
                    or (meta.get('media_queue_id') and meta['media_queue_id'] == review.get('media_queue_id'))):
                job = worker.get_job(row['id'], owner)
                if job['status'] == 'expired':
                    continue
                # A failed download can be retried with Analyze after the saved link is corrected.
                if create and job['status'] == 'failed' and meta.get('source_kind') == 'twitch_replay' and not (worker.ROOT / row['id'] / 'source.mp4').exists():
                    meta['vod_url'] = replay_url(review.get('vod_url'))
                    db.execute("UPDATE jobs SET metadata=?,status='retrieving',error='' WHERE id=?", (json.dumps(meta), row['id']))
                    db.commit()
                    job = worker.get_job(row['id'], owner)
                return job
        capture = review.get('_capture') or {}
        if capture.get('status') in ('armed', 'queued', 'capturing', 'captured', 'processing'):
            return {'id': None, 'status': capture['status'], 'waiting_for_capture': True}
        if not create:
            return None
        url = replay_url(review.get('vod_url'))
        active = db.execute("SELECT count(*) FROM jobs WHERE status IN ('retrieving','awaiting_upload','uploading','queued','processing','awaiting_ai')").fetchone()[0]
        if active >= 3:
            raise worker.Problem(429, 'Finish existing video jobs before starting another.')
        job_id = str(uuid4())
        metadata = {'review_id': review['id'], 'game_id': review['id'], 'title': review.get('title', ''),
                    'vod_url': url, 'players': '', 'periods': [], 'source_kind': 'twitch_replay'}
        db.execute('INSERT INTO jobs VALUES (?,?,?,?,?,?,?)', (job_id, owner, time.time(), 'retrieving', json.dumps(metadata), '{}', ''))
        db.commit()
        return worker.get_job(job_id, owner)


def retrieve(job_id):
    job = worker.get_job(job_id)
    url = replay_url(job['metadata']['vod_url'])
    folder = worker.ROOT / job_id
    folder.mkdir(exist_ok=True)
    source = folder / 'replay.ts'
    source.unlink(missing_ok=True)
    if worker.disk_used() + 150 * 1024**2 >= worker.MAX_STORAGE:
        raise worker.Problem(507, 'Temporary video storage is full. Try again after cleanup.')
    proc = subprocess.Popen(['streamlink', '--stream-timeout', '20', '--retry-streams', '0',
                             '-o', str(source), url, '480p,360p,best'],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    deadline = time.monotonic() + 1800
    try:
        while proc.poll() is None:
            size = source.stat().st_size if source.exists() else 0
            if size > worker.MAX_UPLOAD or worker.disk_used() + size + 150 * 1024**2 > worker.MAX_STORAGE:
                raise worker.Problem(413, 'Replay exceeds the video storage limit. Use a game-sized recording instead.')
            if time.monotonic() > deadline or worker.STOP.wait(1):
                raise worker.Problem(504, 'Replay retrieval timed out. Try Analyze Game again or upload the recording.')
        if proc.returncode or not source.exists() or not source.stat().st_size:
            raise worker.Problem(422, 'Twitch could not provide this replay. It may be unavailable or restricted. Use another replay link or upload the recording.')
        if source.stat().st_size > worker.MAX_UPLOAD:
            raise worker.Problem(413, 'Replay exceeds the video size limit.')
        worker.probe(source)
        worker.command(['ffmpeg', '-v', 'error', '-protocol_whitelist', 'file', '-i', str(source),
                        '-map', '0:v:0', '-map', '0:a?', '-c', 'copy', '-y', str(folder / 'source.mp4')], 300)
        worker.probe(folder / 'source.mp4')
        worker.update(job_id, 'queued')
    except Exception:
        (folder / 'source.mp4').unlink(missing_ok=True)
        raise
    finally:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
        source.unlink(missing_ok=True)
