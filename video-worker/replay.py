"""Authenticated, idempotent replay retrieval using the review's saved source."""
import json
import os
import re
import subprocess
import time
import urllib.error
from urllib.parse import urlsplit
from uuid import UUID, uuid4

import worker

TWITCH_AUTH_FILE = worker.ROOT / '.twitch-auth-token'

def twitch_auth_configured():
    try:
        return bool(os.getenv('TWITCH_AUTH_TOKEN', '').strip()) or (TWITCH_AUTH_FILE.exists() and bool(TWITCH_AUTH_FILE.read_text().strip()))
    except OSError:
        return bool(os.getenv('TWITCH_AUTH_TOKEN', '').strip())

def read_twitch_auth():
    env = os.getenv('TWITCH_AUTH_TOKEN', '').strip()
    if env:
        return env
    try:
        return TWITCH_AUTH_FILE.read_text().strip() if TWITCH_AUTH_FILE.exists() else ''
    except OSError:
        return ''

def save_twitch_auth(token):
    value = str(token or '').strip()
    if not re.fullmatch(r'[A-Za-z0-9]{20,200}', value):
        raise worker.Problem(422, 'That does not look like a Twitch web auth token.')
    TWITCH_AUTH_FILE.write_text(value)
    os.chmod(TWITCH_AUTH_FILE, 0o600)

def clear_twitch_auth():
    TWITCH_AUTH_FILE.unlink(missing_ok=True)


def replay_url(value):
    parsed = urlsplit(str(value or '').strip())
    if (parsed.scheme != 'https' or parsed.hostname not in ('twitch.tv', 'www.twitch.tv')
            or parsed.username or parsed.password or parsed.port not in (None, 443)):
        raise worker.Problem(422, 'No saved recording is available. Add a Twitch replay link or use Upload recording. A channel link cannot identify an old game.')
    # Twitch mobile/share links can include the channel before /v/<id>, e.g.
    # /aichelmachine/v/2876177579?sr=a. Normalize all supported replay shapes
    # to Twitch's canonical /videos/<id> URL.
    match = (re.fullmatch(r'/(?:videos|v)/([0-9]+)/?', parsed.path)
             or re.fullmatch(r'/[^/]+/v/([0-9]+)/?', parsed.path))
    if not match:
        raise worker.Problem(422, 'This is not a recognized Twitch replay link. Paste the VOD share link (including channel/v/ID or videos/ID), or upload the recording.')
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
                rollup = job['result'].get('game_rollup') or {}
                incomplete_report = job['status'] == 'ready_for_review' and not all(
                    isinstance(rollup.get(k), str) and rollup[k].strip() for k in (
                        'summary', 'patterns', 'strengths', 'corrections',
                        'tactical_report', 'player_report', 'professional_writeup'))
                if create and (job['status'] in ('failed', 'awaiting_ai') or incomplete_report) and (worker.ROOT / row['id'] / 'source.mp4').exists():
                    # Analyze Game resumes saved chunk evidence and retries the report.
                    # It must not just redisplay the same failed job indefinitely.
                    meta.pop('ai_rate_limit_retries', None)
                    db.execute("UPDATE jobs SET metadata=?,status='queued',error='' WHERE id=?", (json.dumps(meta), row['id']))
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
    # Start with Streamlink's normal Twitch resolver. Public VODs generally do
    # not need Chromium/client-integrity at all, and forcing the browser-integrity
    # path can make otherwise playable VODs fail.
    twitch_token = read_twitch_auth()
    diagnostic = folder / 'streamlink-error.log'

    def launch_streamlink(force_integrity=False):
        source.unlink(missing_ok=True)
        args = ['streamlink', '--stream-timeout', '20', '--retry-streams', '0']
        if twitch_token:
            args.append('--twitch-api-header=Authorization=OAuth ' + twitch_token)
        if force_integrity:
            args.extend(['--twitch-force-client-integrity', '--twitch-purge-client-integrity'])
        args.extend(['-o', str(source), url, '480p,360p,best'])
        with diagnostic.open('wb') as err:
            return subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=err)

    def wait_for_streamlink(proc):
        deadline = time.monotonic() + 1800
        while proc.poll() is None:
            size = source.stat().st_size if source.exists() else 0
            if size > worker.MAX_UPLOAD or worker.disk_used() + size + 150 * 1024**2 > worker.MAX_STORAGE:
                raise worker.Problem(413, 'Replay exceeds the video storage limit. Use a game-sized recording instead.')
            if time.monotonic() > deadline or worker.STOP.wait(1):
                raise worker.Problem(504, 'Replay retrieval timed out. Try Analyze Game again or upload the recording.')

    proc = launch_streamlink(False)
    try:
        wait_for_streamlink(proc)

        # Some Twitch VODs reject even authenticated playback until Streamlink obtains
        # a fresh browser/client-integrity token. Chromium is included in the worker
        # image, so make one clean retry that explicitly forces and purges integrity.
        if (proc.returncode or not source.exists() or not source.stat().st_size) and twitch_token:
            if proc.poll() is None:
                proc.terminate()
                proc.wait(timeout=5)
            proc = launch_streamlink(True)
            wait_for_streamlink(proc)

        if proc.returncode or not source.exists() or not source.stat().st_size:
            detail = ''
            try:
                detail = diagnostic.read_text(errors='ignore')[-6000:].lower()
            except OSError:
                pass
            if any(term in detail for term in ('client-integrity', 'client integrity', 'webbrowser', 'chromium')):
                raise worker.Problem(422, 'Twitch browser integrity verification failed for this VOD. The worker tried both authenticated playback and a fresh Chromium integrity check.')
            if any(term in detail for term in ('subscriber', 'authentication', 'unauthorized', 'forbidden', '403', 'restricted')):
                raise worker.Problem(422, 'Twitch rejected authenticated playback for this VOD. Refresh the Twitch auth-token connection and try again.')
            if not twitch_token:
                raise worker.Problem(422, 'Twitch blocked anonymous replay playback. Connect Twitch Retrieval in VOD Lab, then Analyze Game again.')
            raise worker.Problem(422, 'Twitch still did not provide a playable replay after authenticated playback and a fresh browser integrity check. Use the local recording fallback for this VOD.')
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
        diagnostic.unlink(missing_ok=True)
