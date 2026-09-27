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
