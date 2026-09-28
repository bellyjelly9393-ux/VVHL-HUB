import json
import os
import sys
from pathlib import Path
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from uuid import uuid4

import replay
import worker


class ReplayTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = patch.object(worker, 'ROOT', Path(self.tmp.name))
        self.root.start()
        worker.initialize()
        self.review = {'id': str(uuid4()), 'vod_url': 'https://www.twitch.tv/videos/12345', 'title': 'Game'}

    def tearDown(self):
        self.root.stop()
        self.tmp.cleanup()

    def test_twitch_auth_accepts_cookie_or_header_shapes(self):
        for raw in ['auth-token=' + 'a'*30, 'OAuth ' + 'b'*30, 'c'*30]:
            replay.save_twitch_auth(raw)
            self.assertEqual(len(replay.read_twitch_auth()), 30)

    def test_rejects_channels_private_hosts_credentials_and_spoofed_domains(self):
        for url in ['https://twitch.tv/chelmachine', 'http://twitch.tv/videos/1',
                    'https://127.0.0.1/videos/1', 'https://twitch.tv.evil.com/videos/1',
                    'https://user:pass@twitch.tv/videos/1', 'https://twitch.tv:8443/videos/1']:
            with self.subTest(url=url), self.assertRaises(worker.Problem):
                replay.replay_url(url)
        self.assertEqual(replay.replay_url('https://twitch.tv/videos/123?t=10'), 'https://www.twitch.tv/videos/123')

    def test_double_click_creates_only_one_persistent_job(self):
        with ThreadPoolExecutor(2) as pool:
            jobs = list(pool.map(lambda _: replay.resolve(self.review, 'owner', True), range(2)))
        self.assertEqual(jobs[0]['id'], jobs[1]['id'])
        worker.initialize()
        self.assertEqual(replay.resolve(self.review, 'owner')['id'], jobs[0]['id'])
        self.assertIsNone(replay.resolve(self.review, 'other-owner'))

    def test_review_window_and_context_are_saved_in_job_metadata(self):
        review = dict(self.review, source_start_seconds=600, source_end_seconds=1500,
                      game_format='6s', scouting_context='Calgary lineup')
        job = replay.resolve(review, 'owner', True)
        meta = job['metadata']
        self.assertEqual(meta['source_start_seconds'], 600)
        self.assertEqual(meta['source_end_seconds'], 1500)
        self.assertEqual(meta['vod_offset_seconds'], 600)
        self.assertEqual(meta['game_format'], '6s')
        self.assertEqual(meta['players'], 'Calgary lineup')

    def test_rejects_invalid_review_window(self):
        review = dict(self.review, source_start_seconds=900, source_end_seconds=300)
        with self.assertRaises(worker.Problem):
            replay.resolve(review, 'owner', True)

    def test_saved_capture_reused_without_replay_link(self):
        job = replay.resolve(self.review, 'owner', True)
        review = dict(self.review, id=str(uuid4()), vod_url='https://twitch.tv/channel', worker_job_id=job['id'])
        self.assertEqual(replay.resolve(review, 'owner', True)['id'], job['id'])

    def test_pending_capture_does_not_start_download(self):
        review = dict(self.review, _capture={'status': 'capturing'})
        self.assertTrue(replay.resolve(review, 'owner', True)['waiting_for_capture'])
        with worker.connect() as db:
            self.assertEqual(db.execute('select count(*) from jobs').fetchone()[0], 0)

    def test_failed_retrieval_retries_same_job(self):
        job = replay.resolve(self.review, 'owner', True)
        worker.update(job['id'], 'failed', error='not available')
        retried = replay.resolve(self.review, 'owner', True)
        self.assertEqual(retried['id'], job['id'])
        self.assertEqual(retried['status'], 'retrieving')

    def test_analyze_resumes_failed_saved_recording_without_reupload(self):
        job = replay.resolve(self.review, 'owner', True)
        folder = worker.ROOT / job['id']
        folder.mkdir()
        (folder / 'source.mp4').write_bytes(b'saved recording')
        evidence = {'chunks': [{'review': {'summary': 'Completed chunk'}}]}
        worker.update(job['id'], 'failed', evidence, 'Report failed')
        self.assertEqual(replay.resolve(self.review, 'owner')['status'], 'failed')
        resumed = replay.resolve(self.review, 'owner', True)
        self.assertEqual(resumed['id'], job['id'])
        self.assertEqual(resumed['status'], 'queued')
        self.assertEqual(resumed['result'], evidence)
        self.assertEqual(resumed['error'], '')

    def test_analyze_repairs_legacy_ready_job_with_missing_report(self):
        job = replay.resolve(self.review, 'owner', True)
        folder = worker.ROOT / job['id']
        folder.mkdir()
        (folder / 'source.mp4').write_bytes(b'saved recording')
        evidence = {'chunks': [{'review': {'summary': 'Evidence'}}], 'game_rollup': {'summary': 'Partial'}}
        worker.update(job['id'], 'ready_for_review', evidence)
        resumed = replay.resolve(self.review, 'owner', True)
        self.assertEqual(resumed['status'], 'queued')
        self.assertEqual(resumed['result']['chunks'], evidence['chunks'])

    def test_rls_empty_result_is_denied(self):
        with patch.dict('os.environ', {'SUPABASE_URL': 'https://example.supabase.co', 'SUPABASE_PUBLISHABLE_KEY': 'public'}), patch.object(worker, 'http_json', return_value=[]):
            with self.assertRaises(worker.Problem) as error:
                replay.read_review(self.review['id'], 'Bearer session')
            self.assertEqual(error.exception.status, 404)

    def test_download_failure_never_queues_partial_media(self):
        job = replay.resolve(self.review, 'owner', True)
        class FailedProcess:
            returncode = 1
            def poll(self): return 1
        with patch.object(replay.subprocess, 'Popen', return_value=FailedProcess()):
            with self.assertRaises(worker.Problem):
                replay.retrieve(job['id'])
        self.assertFalse((worker.ROOT / job['id'] / 'source.mp4').exists())

    def test_retrieved_media_is_validated_remuxed_and_queued(self):
        fixture = worker.ROOT / 'fixture.ts'
        worker.command(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=5', '-t', '2', '-c:v', 'mpeg2video', str(fixture)])
        executable = worker.ROOT / 'streamlink'
        args_file = worker.ROOT / 'streamlink-args.json'
        executable.write_text('#!' + sys.executable + '\nimport json,shutil,sys\nopen(' + repr(str(args_file)) + ', "w").write(json.dumps(sys.argv))\nshutil.copyfile(' + repr(str(fixture)) + ', sys.argv[sys.argv.index("-o")+1])\n')
        executable.chmod(0o755)
        review = dict(self.review, source_start_seconds=120, source_end_seconds=240)
        job = replay.resolve(review, 'owner', True)
        with patch.dict(os.environ, {'PATH': str(worker.ROOT) + os.pathsep + os.environ['PATH']}):
            replay.retrieve(job['id'])
        argv = json.loads(args_file.read_text())
        self.assertEqual(argv[argv.index('--hls-start-offset') + 1], '120.0')
        self.assertEqual(argv[argv.index('--stream-segmented-duration') + 1], '120.0')
        self.assertEqual(argv[-1], '360p,480p,worst')
        self.assertEqual(worker.get_job(job['id'])['status'], 'queued')
        self.assertGreater(worker.probe(worker.ROOT / job['id'] / 'source.mp4'), 0)
        self.assertFalse((worker.ROOT / job['id'] / 'replay.ts').exists())

if __name__ == '__main__':
    unittest.main()
