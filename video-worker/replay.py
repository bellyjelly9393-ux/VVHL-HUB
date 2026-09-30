"""Authenticated, idempotent replay retrieval using the review's saved source."""
import json
import os
import re
import subprocess
import threading
import time
import urllib.error
from urllib.parse import urlsplit
from uuid import UUID, uuid4

import worker

TWITCH_AUTH_FILE = worker.ROOT / '.twitch-auth-token'
REPLAY_STREAM_WINDOW = max(90, int(os.getenv('REPLAY_STREAM_WINDOW_SECONDS', '240')))
REPLAY_STREAM_HEIGHT = max(240, min(480, int(os.getenv('REPLAY_STREAM_HEIGHT', '360'))))

def seed_replay_test_batch():
    raw = os.getenv('REPLAY_TEST_SEED', '').strip()
    token = os.getenv('REPLAY_TEST_SEED_TOKEN', '').strip()
    if not raw or not token:
        return []
    try:
        games = json.loads(raw)
    except ValueError:
        print('Replay test seed ignored: invalid JSON.', flush=True)
        return []
    if not isinstance(games, list):
        print('Replay test seed ignored: expected a list.', flush=True)
        return []
    queued = []
    for item in games[:8]:
        try:
            owner = str(UUID(str(item.get('owner') or '')))
            review_id = str(UUID(str(item.get('review_id') or '')))
            start = float(item.get('source_start_seconds'))
            end = float(item.get('source_end_seconds'))
            if not 0 <= start < end <= 86400:
                raise ValueError()
            url = replay_url(item.get('vod_url'))
        except (TypeError, ValueError, worker.Problem):
            print('Replay test seed skipped one invalid game.', flush=True)
            continue
        metadata = {
            'review_id': review_id, 'game_id': review_id,
            'title': str(item.get('title') or 'Replay test')[:200],
            'vod_url': url,
            'players': str(item.get('players') or '')[:2000],
            'game_format': str(item.get('game_format') or '6s')[:20],
            'vod_offset_seconds': start,
            'source_start_seconds': start,
            'source_end_seconds': end,
            'periods': [],
            'source_kind': 'twitch_replay',
            'replay_test_seed_token': token,
        }
        with worker.WRITE_LOCK, worker.connect() as db:
            rows = db.execute('SELECT id,metadata,status FROM jobs WHERE owner=? ORDER BY created DESC', (owner,)).fetchall()
            existing_id = None
            already_seeded = False
            for row in rows:
                try:
                    old = json.loads(row['metadata'])
                except (TypeError, ValueError):
                    continue
                if old.get('review_id') == review_id or old.get('game_id') == review_id:
                    existing_id = row['id']
                    if old.get('replay_test_seed_token') == token:
                        already_seeded = True
                    break
            if already_seeded:
                queued.append({'review_id': review_id, 'job_id': existing_id, 'status': 'already_seeded'})
                continue
            if existing_id:
                # REPLAY_TEST_SEED is an explicit one-time production test harness.
                # A new seed token means run the saved replay cleanly from the beginning,
                # rather than mixing evidence from an older pipeline revision.
                source = worker.ROOT / existing_id / 'source.mp4'
                if source.parent.exists():
                    worker.release_job_media(existing_id)
                metadata.update({
                    'period_pipeline_version': 2,
                    'replay_phase': 'scan_periods',
                })
                db.execute(
                    'UPDATE jobs SET metadata=?,status=?,result=?,error=? WHERE id=?',
                    (json.dumps(metadata), 'retrieving', '{}', '', existing_id)
                )
                job_id = existing_id
            else:
                job_id = str(uuid4())
                db.execute(
                    'INSERT INTO jobs VALUES (?,?,?,?,?,?,?)',
                    (job_id, owner, time.time(), 'retrieving', json.dumps(metadata), '{}', '')
                )
            queued.append({'review_id': review_id, 'job_id': job_id, 'status': 'queued'})
    for item in queued:
        print(f"Replay test seed {item['status']}: {item['review_id']} -> {item['job_id']}", flush=True)
    return queued


def start_seed_status_monitor(seeded):
    job_ids = [item.get('job_id') for item in (seeded or []) if item.get('job_id')]
    if not job_ids:
        return
    terminal = {'ready_for_review', 'failed', 'expired', 'awaiting_ai', 'needs_periods'}
    def monitor():
        previous = {}
        deadline = time.time() + 1800
        while not worker.STOP.is_set() and time.time() < deadline:
            all_terminal = True
            for job_id in job_ids:
                try:
                    job = worker.get_job(job_id)
                except worker.Problem:
                    continue
                state = (job.get('status'), job.get('error', ''))
                if previous.get(job_id) != state:
                    safe_error = str(job.get('error') or '').replace('\n', ' ')[:400]
                    failure_code = str((job.get('result') or {}).get('failure_code') or '')
                    print(f"Replay test status: {job_id} status={job.get('status')} code={failure_code} error={safe_error}", flush=True)
                    previous[job_id] = state
                if job.get('status') not in terminal:
                    all_terminal = False
            if all_terminal:
                return
            worker.STOP.wait(5)
    threading.Thread(target=monitor, daemon=True, name='replay-test-status').start()

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
    value = str(token or '').strip().strip('"').strip("'")
    for prefix in ('auth-token=', 'OAuth ', 'oauth '):
        if value.startswith(prefix):
            value = value[len(prefix):].strip().strip('"').strip("'")
            break
    if not re.fullmatch(r'[A-Za-z0-9]{20,200}', value):
        raise worker.Problem(422, 'Paste only the Twitch auth-token value, or the full auth-token=VALUE cookie.')
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


def review_window(review):
    try:
        start = float(review.get('source_start_seconds') or 0)
        raw_end = review.get('source_end_seconds')
        end = None if raw_end in (None, '') else float(raw_end)
    except (TypeError, ValueError):
        raise worker.Problem(422, 'Saved VOD game window is invalid.')
    if start < 0 or start > 86400 or (end is not None and (end <= start or end > 86400)):
        raise worker.Problem(422, 'Saved VOD game window is invalid.')
    return start, end


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
                    start, end = review_window(review)
                    meta.update({
                        'vod_url': replay_url(review.get('vod_url')),
                        'players': str(review.get('scouting_context') or '')[:2000],
                        'game_format': str(review.get('game_format') or '6s')[:20],
                        'vod_offset_seconds': start,
                        'source_start_seconds': start,
                        'source_end_seconds': end,
                    })
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
        if active >= worker.MAX_ACTIVE_JOBS:
            raise worker.Problem(429, f'Video queue is full ({worker.MAX_ACTIVE_JOBS} active jobs). Let the oldest games finish first.', 'queue_full')
        job_id = str(uuid4())
        start, end = review_window(review)
        metadata = {
            'review_id': review['id'], 'game_id': review['id'], 'title': review.get('title', ''),
            'vod_url': url, 'players': str(review.get('scouting_context') or '')[:2000],
            'game_format': str(review.get('game_format') or '6s')[:20],
            'vod_offset_seconds': start, 'source_start_seconds': start, 'source_end_seconds': end,
            'periods': [], 'source_kind': 'twitch_replay'
        }
        db.execute('INSERT INTO jobs VALUES (?,?,?,?,?,?,?)', (job_id, owner, time.time(), 'retrieving', json.dumps(metadata), '{}', ''))
        db.commit()
        return worker.get_job(job_id, owner)


def retrieve(job_id):
    job = worker.get_job(job_id)
    url = replay_url(job['metadata']['vod_url'])
    start = float(job['metadata'].get('source_start_seconds') or 0)
    raw_end = job['metadata'].get('source_end_seconds')
    end = None if raw_end in (None, '') else float(raw_end)
    if start < 0 or (end is not None and end <= start):
        raise worker.Problem(422, 'Saved VOD game window is invalid.')
    duration = None if end is None else end - start
    full_start, full_duration = start, duration
    metadata = dict(job['metadata'])
    if full_duration is not None and full_duration > REPLAY_STREAM_WINDOW:
        # Period-first replay pipeline:
        # 1) storage-safe 360p scan slices, local OCR only, no AI
        # 2) lock P1/P2/P3 boundaries
        # 3) fetch/analyze/delete one whole period at a time
        metadata['streamed_replay'] = True
        metadata['period_pipeline_version'] = 2
        phase = metadata.get('replay_phase') or 'scan_periods'
        metadata['replay_phase'] = phase

        if phase == 'scan_periods':
            units = metadata.get('scan_units') or []
            if not units:
                cursor = 0.0
                while cursor < full_duration:
                    finish = min(full_duration, cursor + REPLAY_STREAM_WINDOW)
                    units.append({'start': round(cursor, 3), 'end': round(finish, 3)})
                    cursor = finish
                metadata['scan_units'] = units
                metadata['scan_unit_index'] = 0
                metadata['scan_current_period'] = 1
            unit_index = max(0, int(metadata.get('scan_unit_index') or 0))
            if unit_index >= len(units):
                raise worker.Problem(409, 'Replay period scan is already complete.')
            unit = units[unit_index]
            metadata['active_replay_unit'] = {
                'kind': 'scan', 'label': 'Period scan',
                'start': float(unit['start']), 'end': float(unit['end'])
            }

        elif phase == 'analyze_periods':
            units = metadata.get('period_units') or []
            unit_index = max(0, int(metadata.get('period_unit_index') or 0))
            if unit_index >= len(units):
                raise worker.Problem(409, 'Replay period analysis is already complete.')
            unit = units[unit_index]
            metadata['active_replay_unit'] = {
                'kind': 'period', 'label': str(unit['label']),
                'start': float(unit['start']), 'end': float(unit['end'])
            }
        else:
            raise worker.Problem(422, 'Replay period pipeline state is invalid.')

        active = metadata['active_replay_unit']
        start = full_start + float(active['start'])
        end = full_start + float(active['end'])
        duration = end - start
        with worker.connect() as db:
            db.execute('UPDATE jobs SET metadata=? WHERE id=?', (json.dumps(metadata), job_id))
    folder = worker.ROOT / job_id
    folder.mkdir(exist_ok=True)
    source = folder / 'replay.ts'
    source.unlink(missing_ok=True)

    def ensure_storage():
        if worker.disk_used() + worker.STORAGE_HEADROOM >= worker.MAX_STORAGE:
            worker.reclaim_replay_media(worker.STORAGE_HEADROOM, exclude_job_id=job_id)
        if worker.disk_used() + worker.STORAGE_HEADROOM >= worker.MAX_STORAGE:
            raise worker.Problem(
                507,
                'Temporary video storage is full even after reclaiming re-downloadable Twitch clips. Retry after the active job finishes.',
                'storage_limit_exceeded'
            )

    def preferred_height():
        if metadata.get('streamed_replay'):
            return min(360, REPLAY_STREAM_HEIGHT)
        usable = worker.storage_status()['usableBytes']
        return 360 if worker.MAX_UPLOAD <= 300 * 1024**2 or usable <= 350 * 1024**2 else 480

    ensure_storage()
    max_height = preferred_height()
    # Start with Streamlink's normal Twitch resolver. Public VODs generally do
    # not need Chromium/client-integrity at all, and forcing the browser-integrity
    # path can make otherwise playable VODs fail.
    twitch_token = read_twitch_auth()
    diagnostic = folder / 'streamlink-error.log'

    def launch_streamlink(force_integrity=False, use_auth=False):
        source.unlink(missing_ok=True)
        args = ['streamlink', '--stream-timeout', '20', '--retry-streams', '0']
        if start:
            args.extend(['--hls-start-offset', str(start)])
        if duration is not None:
            args.extend(['--stream-segmented-duration', str(duration)])
        if use_auth and twitch_token:
            args.append('--twitch-api-header=Authorization=OAuth ' + twitch_token)
        if force_integrity:
            args.extend(['--twitch-force-client-integrity', '--twitch-purge-client-integrity'])
        quality = '360p,worst' if max_height <= 360 else '480p,360p,worst'
        args.extend(['-o', str(source), url, quality])
        with diagnostic.open('wb') as err:
            return subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=err)

    def wait_for_streamlink(proc):
        deadline = time.monotonic() + 1800
        while proc.poll() is None:
            size = source.stat().st_size if source.exists() else 0
            if size > worker.MAX_UPLOAD:
                raise worker.Problem(413, 'This game window exceeds the configured clip-size limit. Shorten the saved VOD start/end range.', 'clip_size_exceeded')
            ensure_storage()
            if time.monotonic() > deadline or worker.STOP.wait(1):
                raise worker.Problem(504, 'Replay retrieval timed out. Try Analyze Game again or upload the recording.')


    def clock_value(seconds):
        value = max(0, int(seconds or 0))
        hours, remainder = divmod(value, 3600)
        minutes, secs = divmod(remainder, 60)
        return f'{hours}:{minutes:02d}:{secs:02d}' if hours else f'{minutes}:{secs:02d}'

    def launch_ytdlp(use_auth=False, impersonate=False):
        for item in folder.glob('ytdlp.*'):
            if item.name != 'ytdlp-error.log':
                item.unlink(missing_ok=True)
        args = [
            'yt-dlp', '--no-playlist', '--no-part', '--retries', '2',
            '--fragment-retries', '2', '--socket-timeout', '20',
            '-f', f'best[height<={max_height}]/worst',
            '-o', str(folder / 'ytdlp.%(ext)s')
        ]
        if impersonate:
            args.extend(['--impersonate', 'chrome'])
        if end is not None:
            args.extend(['--download-sections', f'*{clock_value(start)}-{clock_value(end)}'])
        elif start:
            args.extend(['--download-sections', f'*{clock_value(start)}-inf'])
        cookie_file = folder / 'twitch-cookies.txt'
        if use_auth and twitch_token:
            cookie_file.write_text(
                '# Netscape HTTP Cookie File\n'
                f'.twitch.tv\tTRUE\t/\tTRUE\t2147483647\tauth-token\t{twitch_token}\n'
            )
            os.chmod(cookie_file, 0o600)
            args.extend(['--cookies', str(cookie_file)])
        with (folder / 'ytdlp-error.log').open('wb') as err:
            return subprocess.Popen(args + [url], stdout=subprocess.DEVNULL, stderr=err)

    def wait_for_ytdlp(proc):
        deadline = time.monotonic() + 1800
        while proc.poll() is None:
            size = sum(p.stat().st_size for p in folder.glob('ytdlp.*') if p.is_file())
            if size > worker.MAX_UPLOAD:
                raise worker.Problem(413, 'This replay slice exceeds the configured clip-size limit even at the storage-safe quality.', 'clip_size_exceeded')
            ensure_storage()
            if time.monotonic() > deadline or worker.STOP.wait(1):
                raise worker.Problem(504, 'Alternate Twitch retrieval timed out.')

    def finish_ytdlp():
        candidates = [p for p in folder.glob('ytdlp.*')
                      if p.is_file() and not p.name.endswith('.part') and p.name != 'ytdlp-error.log']
        if not candidates:
            return False
        candidate = max(candidates, key=lambda p: p.stat().st_size)
        if candidate.stat().st_size <= 0:
            return False
        worker.probe(candidate)
        final = folder / 'source.mp4'
        final.unlink(missing_ok=True)
        candidate.replace(final)
        worker.probe(final)
        return True

    # Three-stage retrieval. Public playback gets both normal and fresh-integrity
    # attempts before a saved account token is ever used, so a stale Twitch cookie
    # cannot poison an otherwise-public VOD.
    proc = launch_streamlink(False, False)
    try:
        wait_for_streamlink(proc)

        if proc.returncode or not source.exists() or not source.stat().st_size:
            if proc.poll() is None:
                proc.terminate()
                proc.wait(timeout=5)
            proc = launch_streamlink(True, False)
            wait_for_streamlink(proc)

        if (proc.returncode or not source.exists() or not source.stat().st_size) and twitch_token:
            if proc.poll() is None:
                proc.terminate()
                proc.wait(timeout=5)
            proc = launch_streamlink(True, True)
            wait_for_streamlink(proc)

        streamlink_ok = not proc.returncode and source.exists() and source.stat().st_size > 0
        if streamlink_ok:
            if source.stat().st_size > worker.MAX_UPLOAD:
                raise worker.Problem(413, 'Replay exceeds the configured clip-size limit.', 'clip_size_exceeded')
            worker.probe(source)
            final = folder / 'source.mp4'
            final.unlink(missing_ok=True)
            source.replace(final)
            worker.probe(final)
        else:
            # Streamlink can be rejected by Twitch even for a VOD that is playable in a
            # normal browser. Use yt-dlp as a second independent Twitch resolver and
            # keep the same saved game-window cut so the full broadcast is never pulled.
            ytdlp = launch_ytdlp(False, False)
            wait_for_ytdlp(ytdlp)
            ytdlp_ok = ytdlp.returncode == 0 and finish_ytdlp()
            if not ytdlp_ok:
                ytdlp = launch_ytdlp(False, True)
                wait_for_ytdlp(ytdlp)
                ytdlp_ok = ytdlp.returncode == 0 and finish_ytdlp()
            if not ytdlp_ok and twitch_token:
                ytdlp = launch_ytdlp(True, True)
                wait_for_ytdlp(ytdlp)
                ytdlp_ok = ytdlp.returncode == 0 and finish_ytdlp()
            if not ytdlp_ok:
                raise worker.Problem(422, 'Twitch blocked Streamlink and all yt-dlp replay fallbacks. Retrieval diagnostics were kept on the private worker volume for troubleshooting.')
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
        success = (folder / 'source.mp4').exists()
        if success:
            diagnostic.unlink(missing_ok=True)
            (folder / 'ytdlp-error.log').unlink(missing_ok=True)
        (folder / 'twitch-cookies.txt').unlink(missing_ok=True)
        for item in folder.glob('ytdlp.*'):
            if item.name != 'ytdlp-error.log' or success:
                item.unlink(missing_ok=True)
