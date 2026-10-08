"""Low-cost live scoreboard period watcher for Twitch capture.

Adapted from the uploaded VVHL VOD worker concept, but kept local: FFmpeg grabs only
the scoreboard crop and Tesseract reads the period. No extra AI call is spent every
20 seconds. Boundaries are advisory; if confidence is insufficient the normal
post-capture period detector remains the fallback.
"""
import os
from pathlib import Path
import re
import shutil
import subprocess
import threading
import time

INTERVAL = max(8, int(os.getenv('LIVE_PERIOD_WATCH_SECONDS', '20')))
CONFIRM_READS = max(2, int(os.getenv('LIVE_PERIOD_CONFIRM_READS', '2')))
REPLAY_INTERVAL = max(6, int(os.getenv('REPLAY_PERIOD_SCAN_SECONDS', '12')))
LEFT = float(os.getenv('LIVE_SCOREBOARD_CROP_LEFT', '0.30'))
TOP = float(os.getenv('LIVE_SCOREBOARD_CROP_TOP', '0.00'))
WIDTH = float(os.getenv('LIVE_SCOREBOARD_CROP_WIDTH', '0.40'))
HEIGHT = float(os.getenv('LIVE_SCOREBOARD_CROP_HEIGHT', '0.16'))


def parse_period(text):
    raw = re.sub(r'[^A-Z0-9 ]+', ' ', str(text or '').upper())
    compact = re.sub(r'\s+', ' ', raw).strip()
    tests = (
        (1, (r'\b1ST\b', r'\bPERIOD 1\b', r'\b1 PERIOD\b')),
        (2, (r'\b2ND\b', r'\bPERIOD 2\b', r'\b2 PERIOD\b')),
        (3, (r'\b3RD\b', r'\bPERIOD 3\b', r'\b3 PERIOD\b')),
        (4, (r'\bOT\b', r'\bOVERTIME\b', r'\bPERIOD 4\b')),
    )
    for period, patterns in tests:
        if any(re.search(p, compact) for p in patterns):
            return period
    return None


def parse_clock(text):
    raw = str(text or '').upper().replace('.', ':')
    candidates = []
    for match in re.finditer(r'(?<!\d)(\d{1,2})\s*:\s*([0-5]\d)(?!\d)', raw):
        minutes, seconds = int(match.group(1)), int(match.group(2))
        if 0 <= minutes <= 20:
            candidates.append(minutes * 60 + seconds)
    return candidates[0] if candidates else None


def infer_period_ranges(reads, duration, initial_period=1, confirm_reads=2, interval=REPLAY_INTERVAL, confirmed=True):
    """With confirmed=False (start of a replay) nothing is Period 1 until a period or game
    clock is read confirm_reads times: lobby footage before puck drop is not carried as P1."""
    try:
        duration = float(duration)
    except (TypeError, ValueError):
        return {'ranges': [], 'current_period': initial_period or 1, 'boundaries': [], 'confirmed': confirmed}
    if duration <= 0:
        return {'ranges': [], 'current_period': initial_period or 1, 'boundaries': [], 'confirmed': confirmed}

    current = max(1, int(initial_period or 1)) if confirmed else 0
    boundaries = [{'period': current, 'at': 0.0, 'reason': 'carry'}] if confirmed else []
    candidate = None
    streak = 0
    candidate_at = None
    previous_clock = None

    for item in reads:
        at = max(0.0, min(duration, float(item.get('at') or 0)))
        observed = item.get('period')
        clock = item.get('clock_seconds')
        reason = 'period_ocr'
        if current == 0 and observed is None and clock is not None:
            observed, reason = 1, 'game_clock'
        if (observed is None and previous_clock is not None and clock is not None
                and 1 <= current < 8 and previous_clock <= 6 * 60 and clock >= 14 * 60
                and clock - previous_clock >= 8 * 60):
            observed = current + 1
            reason = 'clock_reset'
        if clock is not None:
            previous_clock = clock
        try:
            observed = int(observed) if observed is not None else None
        except (TypeError, ValueError):
            observed = None
        if observed is None or observed == current:
            candidate = None
            streak = 0
            candidate_at = None
            continue
        if observed < current or observed > current + 1:
            candidate = None
            streak = 0
            candidate_at = None
            continue
        if reason == 'clock_reset':
            boundary_at = max(0.0, at - interval / 2)
            current = observed
            boundaries.append({'period': current, 'at': round(boundary_at, 1), 'reason': reason})
            candidate = None
            streak = 0
            candidate_at = None
            continue
        if candidate == observed:
            streak += 1
        else:
            candidate = observed
            streak = 1
            candidate_at = at
        if streak >= max(1, int(confirm_reads)):
            boundary_at = max(0.0, float(candidate_at or at) - interval / 2)
            current = observed
            boundaries.append({'period': current, 'at': round(boundary_at, 1), 'reason': reason})
            candidate = None
            streak = 0
            candidate_at = None

    clean = []
    for item in boundaries:
        if clean and item['period'] == clean[-1]['period']:
            continue
        if clean and item['at'] <= clean[-1]['at']:
            item = dict(item, at=round(min(duration, clean[-1]['at'] + 0.1), 1))
        clean.append(item)

    ranges = []
    for index, item in enumerate(clean):
        start = max(0.0, min(duration, float(item['at'])))
        end = duration if index + 1 == len(clean) else max(start, min(duration, float(clean[index + 1]['at'])))
        if end - start < 1:
            continue
        period = int(item['period'])
        label = f'Period {period}' if period <= 3 else ('Overtime' if period == 4 else f'Overtime {period - 3}')
        ranges.append({'label': label, 'period': period, 'start': round(start, 1), 'end': round(end, 1)})
    return {'ranges': ranges, 'current_period': max(1, current), 'boundaries': clean, 'confirmed': current >= 1}


def scan_recording_periods(source, duration, initial_period=1, interval=REPLAY_INTERVAL, confirmed=True):
    """Replay-specific local scoreboard scan.

    Use a wide top scoreboard band first. If that OCR cannot read a period/clock,
    fall back to the full frame. This remains entirely local and makes no AI call.
    """
    source = Path(source)
    folder = source.parent / 'replay-period-watch'
    shutil.rmtree(folder, ignore_errors=True)
    folder.mkdir(parents=True, exist_ok=True)
    reads = []
    try:
        # Wide top band catches alternate EA/broadcast scoreboard placements that
        # the narrower live crop can miss. Keep source low-res; upscale only the
        # OCR crop locally because Tesseract benefits from larger glyphs.
        subprocess.run([
            'ffmpeg', '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
            '-i', str(source),
            '-vf', f'fps=1/{interval},crop=iw:ih*0.30:0:0,scale=1280:-1',
            '-q:v', '4', str(folder / 'top_%04d.jpg')
        ], check=True, timeout=180)
        subprocess.run([
            'ffmpeg', '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
            '-i', str(source),
            '-vf', f'fps=1/{interval},scale=960:-1',
            '-q:v', '5', str(folder / 'full_%04d.jpg')
        ], check=True, timeout=180)

        top_frames = sorted(folder.glob('top_*.jpg'))
        full_frames = sorted(folder.glob('full_*.jpg'))
        count = max(len(top_frames), len(full_frames))
        for index in range(count):
            top_raw = ''
            full_raw = ''
            if index < len(top_frames):
                run = subprocess.run(
                    ['tesseract', str(top_frames[index]), 'stdout', '--psm', '11'],
                    capture_output=True, check=False, timeout=10
                )
                top_raw = run.stdout.decode('utf-8', 'ignore')
            period = parse_period(top_raw)
            clock = parse_clock(top_raw)

            if (period is None or clock is None) and index < len(full_frames):
                run = subprocess.run(
                    ['tesseract', str(full_frames[index]), 'stdout', '--psm', '11'],
                    capture_output=True, check=False, timeout=10
                )
                full_raw = run.stdout.decode('utf-8', 'ignore')
                if period is None:
                    period = parse_period(full_raw)
                if clock is None:
                    clock = parse_clock(full_raw)

            raw = (top_raw + '\n' + full_raw).strip()
            reads.append({
                'at': round(min(float(duration), index * interval + interval / 2), 1),
                'period': period,
                'clock_seconds': clock,
                'ocr': raw[:320],
            })

        inferred = infer_period_ranges(reads, duration, initial_period, CONFIRM_READS, interval, confirmed)
        inferred['reads'] = reads[-40:]
        inferred['interval_seconds'] = interval
        return inferred
    except Exception:
        label = f'Period {int(initial_period or 1)}'
        return {
            'ranges': [{'label': label, 'period': int(initial_period or 1), 'start': 0.0, 'end': round(float(duration), 1)}]
            if confirmed else [],
            'confirmed': confirmed,
            'current_period': int(initial_period or 1),
            'boundaries': [],
            'reads': reads[-20:],
            'interval_seconds': interval,
        }
    finally:
        shutil.rmtree(folder, ignore_errors=True)


class LivePeriodWatcher:
    def __init__(self, stream_url, folder):
        self.stream_url = stream_url
        self.folder = Path(folder) / 'period-watch'
        self.folder.mkdir(parents=True, exist_ok=True)
        self.stop_event = threading.Event()
        self.thread = None
        self.started = None
        self.current_period = 1
        self.candidate = None
        self.streak = 0
        self.boundaries = {1: 0.0}
        self.reads = []

    def start(self):
        if not self.stream_url:
            return self
        self.started = time.monotonic()
        self.thread = threading.Thread(target=self._loop, daemon=True, name='wildman-period-watch')
        self.thread.start()
        return self

    def stop(self):
        self.stop_event.set()
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=min(12, INTERVAL + 2))
        return self

    def _snapshot(self, index):
        out = self.folder / f'score_{index:04d}.jpg'
        crop = f'crop=iw*{WIDTH}:ih*{HEIGHT}:iw*{LEFT}:ih*{TOP},scale=960:-1'
        subprocess.run([
            'ffmpeg', '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
            '-rw_timeout', '12000000',
            '-i', self.stream_url, '-frames:v', '1', '-vf', crop, '-q:v', '4', str(out)
        ], check=True, timeout=20)
        return out

    def _read(self, path):
        run = subprocess.run(
            ['tesseract', str(path), 'stdout', '--psm', '11'],
            capture_output=True, check=False, timeout=10
        )
        text = run.stdout.decode('utf-8', 'ignore')
        return parse_period(text), text[:240]

    def _observe(self, period):
        if not period:
            self.candidate = None
            self.streak = 0
            return
        if period == self.current_period:
            self.candidate = None
            self.streak = 0
            return
        # Reject impossible backwards jumps and large jumps caused by OCR garbage.
        if period < self.current_period or period > self.current_period + 1:
            self.candidate = None
            self.streak = 0
            return
        if self.candidate == period:
            self.streak += 1
        else:
            self.candidate = period
            self.streak = 1
        if self.streak >= CONFIRM_READS:
            elapsed = max(0.0, time.monotonic() - self.started)
            self.current_period = period
            self.boundaries.setdefault(period, round(elapsed, 1))
            self.candidate = None
            self.streak = 0

    def _loop(self):
        index = 0
        while not self.stop_event.is_set():
            try:
                path = self._snapshot(index)
                period, raw = self._read(path)
                elapsed = max(0.0, time.monotonic() - self.started)
                self.reads.append({'at': round(elapsed, 1), 'period': period, 'ocr': raw})
                self.reads = self.reads[-40:]
                self._observe(period)
            except Exception:
                # This is an enhancement, never a reason to lose the capture.
                pass
            index += 1
            self.stop_event.wait(INTERVAL)

    def period_ranges(self, duration):
        try:
            duration = float(duration)
        except (TypeError, ValueError):
            return []
        if duration <= 0:
            return []
        starts = sorted((p, t) for p, t in self.boundaries.items() if 1 <= p <= 8)
        # Regulation boundaries must be confidently present. Otherwise let the
        # normal post-capture OCR/full-game fallback decide.
        if not all(p in self.boundaries for p in (1, 2, 3)):
            return []
        ranges = []
        for i, (period, start) in enumerate(starts):
            end = starts[i + 1][1] if i + 1 < len(starts) else duration
            start = max(0.0, min(float(start), duration))
            end = max(start, min(float(end), duration))
            if end - start < 45:
                continue
            label = f'Period {period}' if period <= 3 else ('Overtime' if period == 4 else f'Overtime {period - 3}')
            ranges.append({'label': label, 'start': round(start, 1), 'end': round(end, 1)})
        if len(ranges) < 3:
            return []
        return ranges

    def diagnostics(self):
        return {
            'boundaries': dict(self.boundaries),
            'recent_reads': list(self.reads[-12:]),
            'interval_seconds': INTERVAL,
            'confirm_reads': CONFIRM_READS,
        }

    def cleanup(self):
        shutil.rmtree(self.folder, ignore_errors=True)
