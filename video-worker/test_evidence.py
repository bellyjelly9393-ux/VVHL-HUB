import json
import unittest
import threading
import urllib.request
import urllib.error
from http.server import ThreadingHTTPServer
from unittest.mock import patch

import worker
from hockey_review import sequence_window
import test_worker


class EvidenceTests(unittest.TestCase):
    setUp = test_worker.WorkerTests.setUp
    tearDown = test_worker.WorkerTests.tearDown
    create = test_worker.WorkerTests.create
    def test_closer_pass_is_bounded_and_resumes_without_repeating_ai(self):
        job_id = self.create()
        overview = {'summary': 'Test', 'observations': [
            {'timestamp': 3, 'source': 'gameplay', 'note': 'Visible support', 'player': None}],
            'uncertainties': []}
        with patch.dict('os.environ', {'OPENAI_API_KEY': 'test', 'OPENAI_MODEL': 'test'}), \
             patch.object(worker, 'detect_periods', return_value=[]), \
             patch.object(worker, 'AI_CHUNK_PAUSE', 0), \
             patch.object(worker, 'analyze', return_value=overview) as analyze, \
             patch.object(worker, 'build_rollup', side_effect=[worker.Problem(502, 'retry'), {'summary': 'Test'}]):
            with self.assertRaises(worker.Problem):
                worker.process(job_id)
            saved = worker.get_job(job_id)['result']['chunks'][0]
            self.assertEqual(saved['frame_step_seconds'], 6)
            self.assertEqual(saved['sequence_review']['frame_step_seconds'], .5)
            self.assertEqual(analyze.call_args_list[1].args[3], .5)
            self.assertGreater(len(analyze.call_args_list[1].args[0]), 1)
            worker.process(job_id)
            self.assertEqual(analyze.call_count, 2)
        self.assertFalse((worker.ROOT / job_id / 'sequence-frames').exists())

    def test_player_assessment_requires_named_gameplay_evidence(self):
        review = {'summary': 'Test', 'tactical': {}, 'uncertainties': [],
                  'observations': [{'timestamp': 3, 'source': 'gameplay', 'player': 'Known', 'note': 'Support'}],
                  'player_evaluations': [
                      {'player': 'Known', 'evidence_timestamps': [3]},
                      {'player': 'Lobby only', 'evidence_timestamps': [3]}]}
        response = {'status': 'completed', 'output': [{'content': [{'type': 'output_text', 'text': json.dumps(review)}]}]}
        with patch.dict('os.environ', {'OPENAI_API_KEY': 'test', 'OPENAI_MODEL': 'test'}), \
             patch.object(worker, 'request_ai', return_value=response):
            parsed = worker.analyze([], {'start': 0, 'end': 6}, {})
        self.assertEqual([p['player'] for p in parsed['player_evaluations']], ['Known'])
        self.assertTrue(parsed['uncertainties'])

    def test_stat_screens_cannot_trigger_gameplay_pass(self):
        self.assertIsNone(sequence_window({'observations': [
            {'timestamp': 5, 'source': 'period_stats'}]}, {'start': 0, 'end': 10}))
        window = sequence_window({'observations': [
            {'timestamp': 119, 'source': 'gameplay'}]}, {'start': 115, 'end': 120})
        self.assertEqual((window['start'], window['end']), (115, 120))

    def test_browser_upload_cors_and_private_retry(self):
        source_job = self.create()
        video = (worker.ROOT / source_job / 'source.mp4').read_bytes()
        origin = 'https://wildmanhockey-esportshub-git-featur-bd9939-eliteserieschelmedia.vercel.app'
        server = ThreadingHTTPServer(('127.0.0.1', 0), worker.Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = f'http://127.0.0.1:{server.server_port}'
        def request(path, method='GET', data=None, bearer='owner-a'):
            req = urllib.request.Request(url + path, method=method, data=data,
                headers={'Origin': origin, 'Authorization': 'Bearer ' + bearer,
                         'Content-Type': 'application/json'})
            return urllib.request.urlopen(req, timeout=5)
        try:
            with patch.object(worker, 'authenticate', side_effect=lambda h: h.split(' ')[1]):
                with request('/jobs', 'OPTIONS') as res:
                    self.assertEqual(res.headers['Access-Control-Allow-Origin'], origin)
                with request('/jobs', 'POST', json.dumps({'game_id': 'finals', 'vod_offset_seconds': 60}).encode()) as res:
                    job = json.load(res)
                    self.assertEqual(res.headers['Access-Control-Allow-Origin'], origin)
                with request('/jobs/' + job['id'] + '/upload', 'PUT', video) as res:
                    self.assertEqual(json.load(res)['status'], 'queued')
                with self.assertRaises(urllib.error.HTTPError) as denied:
                    request('/jobs/' + job['id'], bearer='owner-b')
                self.assertEqual(denied.exception.code, 404)
                meta = worker.get_job(job['id'])['metadata']
                meta['ai_rate_limit_retries'] = 5
                with worker.connect() as db:
                    db.execute("UPDATE jobs SET metadata=?,status='failed' WHERE id=?", (json.dumps(meta), job['id']))
                with request('/jobs/' + job['id'] + '/retry', 'POST', b'{}') as res:
                    retried = json.load(res)
                    self.assertEqual(retried['status'], 'queued')
                    self.assertNotIn('ai_rate_limit_retries', retried['metadata'])
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
