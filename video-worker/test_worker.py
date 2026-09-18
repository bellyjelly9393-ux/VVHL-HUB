import json
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
        self.assertEqual(len(frames), 3)
        self.assertGreater(frames[0].stat().st_size, 100)

    def test_resumes_only_unfinished_chunks_and_cleans_frames(self):
        job_id = self.create()
        calls = []
        def review(frames, chunk, context):
            calls.append(chunk['start'])
            if len(calls) == 2:
                raise worker.Problem(502, 'Provider temporarily unavailable')
            return {'summary':'Synthetic test only', 'observations':[], 'uncertainties':[]}
        with patch.dict(os.environ, {'OPENAI_API_KEY':'test','OPENAI_MODEL':'test'}), \
             patch.object(worker, 'CHUNK', 4), patch.object(worker, 'OVERLAP', 1), \
             patch.object(worker, 'analyze', side_effect=review):
            with self.assertRaises(worker.Problem):
                worker.process(job_id)
            self.assertEqual(len(worker.get_job(job_id)['result']['chunks']), 1)
            worker.process(job_id)
        self.assertEqual(calls, [0,3,3])
        self.assertEqual(worker.get_job(job_id)['status'], 'ready_for_review')
        self.assertFalse((worker.ROOT/job_id/'frames').exists())

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
             patch.object(worker, 'http_json', return_value={'id':'unapproved'}):
            with self.assertRaises(worker.Problem) as error:
                worker.authenticate('Bearer test')
            self.assertEqual(error.exception.status, 403)


if __name__ == '__main__':
    unittest.main()
