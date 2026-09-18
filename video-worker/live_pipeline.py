"""Automatic live-stream ingest queue for Wildman video review.

The public site only stores a stream URL once. Supabase arms a media queue item when
that URL is attached to a game and moves it to queued when the game becomes LIVE.
This worker claims the item, records the public stream, stops when the game becomes
FINAL, and hands the recording to the existing VOD review worker.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import threading
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit, urlunsplit
from uuid import uuid4

import worker

ROOT = worker.ROOT
STOP = worker.STOP
QUEUE_SECRET = os.getenv('WORKER_QUEUE_SECRET', '')
SUPABASE_URL = os.getenv('SUPABASE_URL', '').rstrip('/')
SUPABASE_KEY = os.getenv('SUPABASE_PUBLISHABLE_KEY', '')
CAPTURE_QUALITY = os.getenv('LIVE_CAPTURE_QUALITY', '480p')
CAPTURE_STREAM_SELECTOR = os.getenv('LIVE_CAPTURE_STREAM_SELECTOR', f'{CAPTURE_QUALITY},360p,best')
MAX_LIVE_SECONDS = int(os.getenv('LIVE_CAPTURE_MAX_SECONDS', '3600'))
MIN_CAPTURE_BYTES = int(os.getenv('LIVE_CAPTURE_MIN_MB', '5')) * 1024**2
POLL_SECONDS = max(3, int(os.getenv('LIVE_QUEUE_POLL_SECONDS', '5')))


def configured():
    return bool(QUEUE_SECRET and SUPABASE_URL.startswith('https://') and SUPABASE_KEY)


def rpc(name, payload):
    if not configured():
        raise RuntimeError('Automatic live ingestion is not configured.')
    req = urllib.request.Request(
        f'{SUPABASE_URL}/rest/v1/rpc/{name}',
        headers={
            'apikey': SUPABASE_KEY,
            'Authorization': 'Bearer ' + SUPABASE_KEY,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
        data=json.dumps(payload).encode(),
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        raw = response.read()
        return json.loads(raw) if raw else None


def claim_one():
    data = rpc('worker_claim_media_pipeline_jobs', {'worker_secret': QUEUE_SECRET, 'take_limit': 1})
    if isinstance(data, list):
        return data[0] if data else None
    return data


def queue_state(queue_id):
    data = rpc('worker_media_pipeline_state', {'worker_secret': QUEUE_SECRET, 'target_id': queue_id})
    if isinstance(data, list):
        return data[0] if data else None
    return data


def queue_update(queue_id, status, error=None, worker_job_id=None, duration=None, result=None):
    return rpc('worker_update_media_pipeline_job', {
        'worker_secret': QUEUE_SECRET,
        'target_id': queue_id,
        'new_status': status,
        'new_error': error,
        'new_worker_job_id': worker_job_id,
        'new_duration_seconds': int(duration) if duration is not None else None,
        'result_payload': result,
    })


def safe_terminate(proc):
    if proc.poll() is not None:
        return
    proc.terminate()
    try:
        proc.wait(timeout=12)
    except subprocess.TimeoutExpired:
        proc.kill()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass


def capture_twitch(item, folder):
    raw_url = str(item.get('stream_url') or '').strip()
    if 'twitch.tv' not in raw_url.lower():
        raise RuntimeError('Automatic live capture currently supports Twitch streams only.')
    # Mobile share links commonly append ?sr=a and similar tracking params.
    # Streamlink only needs the channel path, so normalize to a clean public URL.
    parsed = urlsplit(raw_url)
    url = urlunsplit(('https', parsed.netloc.lower(), parsed.path.rstrip('/'), '', ''))
    folder.mkdir(parents=True, exist_ok=True)
    ts_path = folder / 'capture.ts'
    mp4_path = folder / 'source.mp4'
    queue_update(item['id'], 'capturing')

    # Streamlink resolves Twitch's public HLS feed. We record a moderate rendition because
    # this copy is for coaching vision analysis, not archival broadcast mastering.
    args = [
        'streamlink', '--stdout', '--retry-streams', '5', '--retry-open', '3',
        '--twitch-supported-codecs', 'h264,h265,av1',
        url, CAPTURE_STREAM_SELECTOR,
    ]
    with ts_path.open('wb') as out:
        proc = subprocess.Popen(args, stdout=out, stderr=subprocess.DEVNULL)
        started = time.time()
        saw_final = False
        while proc.poll() is None and not STOP.is_set():
            if time.time() - started > MAX_LIVE_SECONDS:
                safe_terminate(proc)
                raise RuntimeError('Live capture exceeded the configured game-length safety limit.')
            try:
                state = queue_state(item['id']) or {}
                if state.get('source_status') == 'final':
                    saw_final = True
                    safe_terminate(proc)
                    break
                if state.get('status') == 'cancelled':
                    safe_terminate(proc)
                    raise RuntimeError('Live capture was cancelled.')
            except (OSError, ValueError, urllib.error.URLError):
                # A short Supabase hiccup should not kill the recording. The safety timer
                # still prevents a forgotten capture from running forever.
                pass
            STOP.wait(POLL_SECONDS)
        if proc.poll() is None:
            safe_terminate(proc)
        if proc.returncode not in (0, -15, -9) and not saw_final:
            raise RuntimeError('Twitch stream could not be captured. Confirm the channel is live.')

    if not ts_path.exists() or ts_path.stat().st_size < MIN_CAPTURE_BYTES:
        raise RuntimeError('The live capture was too short to review.')

    subprocess.run([
        'ffmpeg', '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
        '-i', str(ts_path), '-map', '0:v:0', '-map', '0:a?', '-c', 'copy',
        '-movflags', '+faststart', str(mp4_path)
    ], check=True, timeout=180)
    ts_path.unlink(missing_ok=True)
    duration = worker.probe(mp4_path)
    return mp4_path, duration


def create_review_job(item, source_path, duration):
    if not worker.USERS:
        raise RuntimeError('No automatic VOD review owner is configured.')
    owner = sorted(worker.USERS)[0]
    job_id = str(uuid4())
    directory = ROOT / job_id
    directory.mkdir(parents=True, exist_ok=True)
    shutil.move(str(source_path), str(directory / 'source.mp4'))
    metadata = {
        'game_id': str(item.get('esports_game_id') or item.get('competitive_game_id') or ''),
        'title': 'Automatic live game capture',
        'vod_url': str(item.get('stream_url') or ''),
        'players': '',
        # Empty here is intentional. The worker still processes the complete game in
        # overlapping windows. Reviewed period boundaries can be added/refined later.
        'periods': [],
        'media_queue_id': str(item['id']),
        'automatic_live_capture': True,
    }
    with worker.WRITE_LOCK, worker.connect() as db:
        db.execute(
            'INSERT INTO jobs VALUES (?,?,?,?,?,?,?)',
            (job_id, owner, time.time(), 'queued', json.dumps(metadata), '{}', '')
        )
    queue_update(item['id'], 'processing', worker_job_id=job_id, duration=duration)
    return job_id


def text_rollup(job):
    result = dict(job.get('result') or {})
    chunks = result.get('chunks') or []
    if not chunks:
        return result
    if not os.getenv('OPENAI_API_KEY') or not os.getenv('OPENAI_MODEL'):
        return result
    summaries = []
    for chunk in chunks:
        review = chunk.get('review') or {}
        observations = review.get('observations') or []
        summaries.append({
            'start': chunk.get('start'), 'end': chunk.get('end'),
            'summary': review.get('summary', ''),
            'observations': observations[:12],
            'uncertainties': (review.get('uncertainties') or [])[:8],
        })
    prompt = '''Build a concise EA hockey coaching rollup from chunk reviews.
Use only the supplied reviewed evidence. Do not invent period boundaries, player identities,
stats, scores, goals, or events. Distinguish patterns from one-off observations. Return JSON
with summary, patterns, strengths, corrections. Each field must be a plain string suitable
for a human editor. Mention uncertainty when evidence is sparse or conflicting.'''
    schema = {
        'type': 'object', 'additionalProperties': False,
        'required': ['summary', 'patterns', 'strengths', 'corrections'],
        'properties': {
            'summary': {'type': 'string'}, 'patterns': {'type': 'string'},
            'strengths': {'type': 'string'}, 'corrections': {'type': 'string'},
        }
    }
    api = worker.http_json(
        'https://api.openai.com/v1/responses',
        {'Authorization': 'Bearer ' + os.environ['OPENAI_API_KEY'], 'Content-Type': 'application/json'},
        {
            'model': os.environ['OPENAI_MODEL'], 'store': False,
            'input': [{'role': 'user', 'content': [
                {'type': 'input_text', 'text': prompt + '\n\nChunk evidence:\n' + json.dumps(summaries)}
            ]}],
            'max_output_tokens': 2200,
            'text': {'format': {'type': 'json_schema', 'name': 'game_rollup', 'strict': True, 'schema': schema}},
        }
    )
    text = ''.join(
        c.get('text', '')
        for output in api.get('output', [])
        for c in output.get('content', [])
        if c.get('type') == 'output_text'
    )
    if text:
        result['game_rollup'] = json.loads(text)
    return result


def monitor_review(queue_id, job_id):
    last_status = None
    while not STOP.is_set():
        job = worker.get_job(job_id)
        status = job.get('status')
        if status != last_status:
            if status == 'awaiting_ai':
                queue_update(queue_id, 'awaiting_ai', error=job.get('error'), worker_job_id=job_id,
                             duration=(job.get('result') or {}).get('duration'))
            elif status == 'processing':
                queue_update(queue_id, 'processing', worker_job_id=job_id,
                             duration=(job.get('result') or {}).get('duration'))
            elif status == 'failed':
                queue_update(queue_id, 'failed', error=job.get('error') or 'Video analysis failed.', worker_job_id=job_id)
                return
            last_status = status
        if status == 'ready_for_review':
            try:
                result = text_rollup(job)
            except Exception:
                result = job.get('result') or {}
            queue_update(queue_id, 'ready_for_review', worker_job_id=job_id,
                         duration=result.get('duration'), result=result)
            return
        if status in ('expired',):
            queue_update(queue_id, 'failed', error='Automatic capture expired before review completed.', worker_job_id=job_id)
            return
        STOP.wait(3)


def handle_item(item):
    folder = ROOT / 'live-captures' / str(item['id'])
    try:
        if item.get('provider') != 'twitch':
            queue_update(item['id'], 'failed', error='Automatic capture currently supports Twitch only.')
            return
        source, duration = capture_twitch(item, folder)
        queue_update(item['id'], 'captured', duration=duration)
        job_id = create_review_job(item, source, duration)
        monitor_review(item['id'], job_id)
    except Exception as exc:
        # Keep the stored message intentionally generic. Provider responses and tokens should
        # never wind up in a management UI or database error field.
        msg = str(exc)
        allowed = (
            'Automatic live capture currently supports Twitch streams only.',
            'Live capture exceeded the configured game-length safety limit.',
            'Live capture was cancelled.',
            'Twitch stream could not be captured. Confirm the channel is live.',
            'The live capture was too short to review.',
            'No automatic VOD review owner is configured.',
        )
        queue_update(item['id'], 'failed', error=msg if msg in allowed else 'Automatic live capture failed. Use the saved/local recording fallback.')
    finally:
        # Successful handoff moves the MP4 into the normal job folder. Anything left here is
        # transient failure debris and can be safely removed.
        shutil.rmtree(folder, ignore_errors=True)


def loop():
    if not configured():
        return
    while not STOP.is_set():
        try:
            item = claim_one()
            if item:
                handle_item(item)
                continue
        except (OSError, ValueError, urllib.error.URLError, urllib.error.HTTPError):
            pass
        STOP.wait(POLL_SECONDS)


def start():
    thread = threading.Thread(target=loop, daemon=True, name='wildman-live-ingest')
    thread.start()
    return thread
