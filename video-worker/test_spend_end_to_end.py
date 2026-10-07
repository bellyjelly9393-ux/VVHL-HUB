"""Whole pipeline with real video files and a fake AI: counts every paid request."""
import json
import os
import re
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import worker
from test_spend_guards import CUT_OFF, review_json

ENV = {'OPENAI_API_KEY': 'k', 'OPENAI_MODEL': 'm', 'AI_PROVIDER': 'openai'}
ROLLUP = {k: 'Reviewed evidence.' for k in ('summary', 'patterns', 'strengths', 'corrections',
                                            'tactical_report', 'player_report', 'professional_writeup')}


def completed(payload):
    return {'status': 'completed', 'output': [{'content': [{'type': 'output_text', 'text': json.dumps(payload)}]}]}


def make_video(path, seconds):
    worker.command(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=2',
                    '-t', str(seconds), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', str(path)],
                   timeout=180)


class EndToEndSpend(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = patch.object(worker, 'ROOT', Path(self.tmp.name))
        self.root.start()
        worker.initialize()
        self.calls = []

    def tearDown(self):
        worker._CTX.job_id = None
        self.root.stop()
        self.tmp.cleanup()

    def ai(self, cut_off_first_chunk=False):
        state = {'cut': cut_off_first_chunk}
        def fake(url, headers, payload):
            name = payload['text']['format']['name']
            text = payload['input'][0]['content'][0]['text']
            self.calls.append((name, payload['max_output_tokens']))
            if name == 'elite_hockey_review':
                if state['cut']:
                    state['cut'] = False
                    return CUT_OFF
                chunk = json.loads(re.search(r'Context: (\{.*\})\n', text).group(1))['chunk']
                return review_json(observations=[{'timestamp': chunk['start'] + 5, 'source': 'gameplay',
                                                  'category': 'offense', 'impact': 'negative', 'note': 'n', 'player': None}])
            return completed(ROLLUP)
        return fake

    def play(self, cut_off_first_chunk=False):
        job_id = str(uuid4())
        units = [{'label': 'Period 1', 'start': 0, 'end': 240}, {'label': 'Period 2', 'start': 240, 'end': 480}]
        meta = {'streamed_replay': True, 'replay_phase': 'analyze_periods', 'source_kind': 'twitch_replay',
                'period_source': 'manual', 'period_units': units, 'period_unit_index': 0, 'periods': units,
                'source_start_seconds': 0, 'source_end_seconds': 480, 'vod_url': 'https://www.twitch.tv/videos/1'}
        with worker.connect() as db:
            db.execute('INSERT INTO jobs VALUES (?,?,?,?,?,?,?)', (job_id, 'o', 0, 'queued', json.dumps(meta), '{}', ''))
        folder = worker.ROOT / job_id
        folder.mkdir()
        worker._CTX.job_id = job_id
        with patch.dict(os.environ, ENV), patch.object(worker, 'gm_profile', return_value=None), \
                patch.object(worker, 'AI_CHUNK_PAUSE', 0), patch.object(worker, 'AUTO_RELEASE_TWITCH_MEDIA', False), \
                patch.object(worker, 'http_json', side_effect=self.ai(cut_off_first_chunk)):
            make_video(folder / 'source.mp4', 240)
            worker.process(job_id)  # part 1 + Period 1 report
            first = worker.get_job(job_id)
            self.assertEqual(first['status'], 'retrieving')
            self.assertEqual([p['label'] for p in first['result']['period_reports']], ['Period 1'])
            self.assertEqual(first['metadata']['completed_parts'], [0])
            self.assertFalse((folder / 'source.mp4').exists())  # video released once saved
            make_video(folder / 'source.mp4', 240)  # what retrieval would fetch for part 2
            worker.update(job_id, 'queued')
            worker.process(job_id)  # part 2 + Period 2 report + game report
        with worker.connect() as db:
            used = db.execute('SELECT COALESCE(SUM(requests),0) FROM ai_usage WHERE job_id=?', (job_id,)).fetchone()[0]
        return worker.get_job(job_id), used

    def test_a_two_period_game_makes_exactly_the_expected_requests(self):
        job, used = self.play()
        self.assertEqual(job['status'], 'ready_for_review')
        self.assertEqual([p['label'] for p in job['result']['period_reports']], ['Period 1', 'Period 2'])
        self.assertTrue(job['result']['game_rollup']['summary'])
        self.assertEqual(len(job['result']['chunks']), 6)
        # 3 chunk reviews + 1 closer look + 1 period report per period, then 1 game report
        self.assertEqual(used, 11)
        self.assertEqual(len(self.calls), 11)
        self.assertEqual(sum('sequence_review' in c for c in job['result']['chunks']), 2)
        self.assertTrue(all(tokens <= 5000 for _, tokens in self.calls))  # nothing ever escalates

    def test_a_cut_off_answer_costs_one_extra_request_not_two(self):
        job, used = self.play(cut_off_first_chunk=True)
        self.assertEqual(job['status'], 'ready_for_review')
        self.assertEqual(used, 12)
        self.assertTrue(all(tokens <= 5000 for _, tokens in self.calls))


if __name__ == '__main__':
    unittest.main()
