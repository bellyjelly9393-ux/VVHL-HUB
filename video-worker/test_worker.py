import json
import io
import urllib.error
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4

import worker


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = patch.object(worker, 'ROOT', Path(self.tmp.name))
        self.root.start()
        worker.initialize()

    def tearDown(self):
        self.root.stop()
        self.tmp.cleanup()

    def create(self, status='queued'):
        job_id = str(uuid4())
        with worker.connect() as db:
            db.execute('INSERT INTO jobs VALUES (?,?,?,?,?,?,?)',
                       (job_id, 'owner-a', 1, status, json.dumps({'periods': []}), '{}', ''))
        directory = worker.ROOT / job_id
        directory.mkdir()
        worker.command(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i',
                        'testsrc2=size=320x180:rate=5', '-t', '6', '-pix_fmt', 'yuv420p',
                        str(directory / 'source.mp4')])
        return job_id

    def test_chunks_overlap_without_crossing_periods(self):
        chunks = worker.segments([{'label':'P1','start':10,'end':260},
                                  {'label':'P2','start':300,'end':320}], 400)
        self.assertEqual([(c['start'],c['end']) for c in chunks],
                         [(10,130),(125,245),(240,260),(300,320)])
        with self.assertRaises(worker.Problem):
            worker.segments([{'label':'P1','start':20,'end':10}], 100)

    def test_real_video_preparation_and_no_fake_analysis(self):
        job_id = self.create()
        with patch.dict(os.environ, {'OPENAI_API_KEY':'','OPENAI_MODEL':''}):
            worker.process(job_id)
        job = worker.get_job(job_id)
        self.assertEqual(job['status'], 'awaiting_ai')
        self.assertEqual(job['result']['chunks'], [])
        frames = worker.extract_frames(worker.ROOT/job_id/'source.mp4', worker.ROOT/job_id/'frames', 0, 6)
        self.assertEqual(len(frames), 1)
        self.assertGreater(frames[0].stat().st_size, 100)

    def test_resumes_only_unfinished_chunks_and_cleans_frames(self):
        job_id = self.create()
        calls = []
        def review(frames, chunk, context, frame_step):
            calls.append(chunk['start'])
            if len(calls) == 2:
                raise worker.Problem(502, 'Provider temporarily unavailable')
            return {'summary':'Synthetic test only', 'observations':[], 'uncertainties':[]}
        with patch.dict(os.environ, {'OPENAI_API_KEY':'test','OPENAI_MODEL':'test'}), \
             patch.object(worker, 'CHUNK', 4), patch.object(worker, 'OVERLAP', 1), \
             patch.object(worker, 'analyze', side_effect=review), \
             patch.object(worker, 'AI_CHUNK_PAUSE', 0), \
             patch.object(worker, 'build_rollup', return_value={'summary':'Synthetic test report'}):
            with self.assertRaises(worker.Problem):
                worker.process(job_id)
            self.assertEqual(len(worker.get_job(job_id)['result']['chunks']), 1)
            worker.process(job_id)
        self.assertEqual(calls, [0,3,3])
        self.assertEqual(worker.get_job(job_id)['status'], 'ready_for_review')
        self.assertFalse((worker.ROOT/job_id/'frames').exists())

    def test_failed_report_preserves_chunks_and_resumes_synthesis_only(self):
        job_id = self.create()
        chunk_review = {'summary': 'Synthetic evidence', 'observations': [], 'uncertainties': []}
        with patch.dict(os.environ, {'OPENAI_API_KEY': 'test', 'OPENAI_MODEL': 'test'}), \
             patch.object(worker, 'detect_periods', return_value=[]), \
             patch.object(worker, 'analyze', return_value=chunk_review) as analyze, \
             patch.object(worker, 'build_rollup', side_effect=[worker.Problem(502, 'Report failed'), {'summary': 'Recovered report'}]):
            with self.assertRaises(worker.Problem):
                worker.process(job_id)
            saved = worker.get_job(job_id)
            self.assertNotEqual(saved['status'], 'ready_for_review')
            self.assertEqual(saved['result']['stage'], 'writing_report')
            self.assertEqual(len(saved['result']['chunks']), 1)
            worker.process(job_id)
            self.assertEqual(analyze.call_count, 1)
            self.assertEqual(worker.get_job(job_id)['result']['stage'], 'report_ready')

    def test_report_retries_transient_provider_failure(self):
        report = {key: 'Synthetic evidence only' for key in (
            'summary', 'patterns', 'strengths', 'corrections',
            'tactical_report', 'player_report', 'professional_writeup')}
        response = {'status': 'completed', 'output': [{'content': [{'type': 'output_text', 'text': json.dumps(report)}]}]}
        busy = urllib.error.HTTPError('https://api.openai.com/v1/responses', 503, 'busy', {}, io.BytesIO(b''))
        with patch.dict(os.environ, {'OPENAI_API_KEY': 'test', 'OPENAI_MODEL': 'test'}), \
             patch.object(worker, 'http_json', side_effect=[busy, response]) as request, \
             patch.object(worker.STOP, 'wait', return_value=False):
            self.assertEqual(worker.build_rollup([{'review': {'summary': 'test'}}]), report)
            self.assertEqual(request.call_count, 2)

    def test_token_truncation_retries_but_never_accepts_partial_json(self):
        incomplete = {'status': 'incomplete', 'incomplete_details': {'reason': 'max_output_tokens'}}
        calls = []
        def response(url, headers, payload):
            calls.append(payload['max_output_tokens'])
            return incomplete if len(calls) == 1 else {'status': 'completed'}
        with patch.dict(os.environ, {'OPENAI_API_KEY': 'test'}), patch.object(worker, 'http_json', side_effect=response):
            worker.request_ai({'model': 'test', 'max_output_tokens': 4800})
        self.assertEqual(calls, [4800, 9600])
        with patch.dict(os.environ, {'OPENAI_API_KEY': 'test'}), patch.object(worker, 'http_json', return_value=incomplete):
            with self.assertRaises(worker.Problem):
                worker.request_ai({'model': 'test', 'max_output_tokens': 4800})

    def test_quota_failure_is_not_retried(self):
        quota = urllib.error.HTTPError('https://api.openai.com/v1/responses', 429, 'quota', {},
                                      io.BytesIO(b'{"error":{"code":"insufficient_quota"}}'))
        with patch.dict(os.environ, {'OPENAI_API_KEY': 'test'}), \
             patch.object(worker, 'http_json', side_effect=quota) as request:
            with self.assertRaises(worker.Problem) as error:
                worker.request_ai({'model': 'test'})
            self.assertIn('billing', error.exception.message)
            self.assertEqual(request.call_count, 1)

    def test_private_jobs_and_expiry(self):
        job_id = self.create('awaiting_ai')
        with self.assertRaises(worker.Problem) as error:
            worker.get_job(job_id, 'owner-b')
        self.assertEqual(error.exception.status, 404)
        worker.cleanup()
        self.assertFalse((worker.ROOT/job_id).exists())
        self.assertEqual(worker.get_job(job_id)['status'], 'expired')

    def test_authentication_fails_closed(self):
        with self.assertRaises(worker.Problem) as error:
            worker.authenticate(None)
        self.assertEqual(error.exception.status, 401)
        with patch.object(worker, 'USERS', {'approved'}), \
             patch.dict(os.environ, {'SUPABASE_URL':'https://example.supabase.co','SUPABASE_PUBLISHABLE_KEY':'public'}), \
             patch.object(worker, 'http_json', side_effect=[{'id':'unapproved'}, [], []]):
            with self.assertRaises(worker.Problem) as error:
                worker.authenticate('Bearer test')
            self.assertEqual(error.exception.status, 403)


if __name__ == '__main__':
    unittest.main()
