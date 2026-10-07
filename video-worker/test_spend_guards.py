"""Spend restrictions: no escalating retries, hard request budgets, bounded closer looks,
unconfirmed overtime dropped, and a resumable Retry button. Mirrors the Oct 5 Regina job."""
import json
import os
import tempfile
import threading
import unittest
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import worker

ENV = {'OPENAI_API_KEY': 'k', 'OPENAI_MODEL': 'm', 'AI_PROVIDER': 'openai'}


def review_json(**extra):
    review = {'summary': 'S', 'tactical': {}, 'uncertainties': [], 'player_evaluations': [],
              'observations': [], **extra}
    return {'status': 'completed', 'output': [{'content': [{'type': 'output_text', 'text': json.dumps(review)}]}]}


CUT_OFF = {'status': 'incomplete', 'incomplete_details': {'reason': 'max_output_tokens'}}


class ChunkAnalysisCost(unittest.TestCase):
    def analyze(self, responses):
        sent = []
        def fake(url, headers, payload):
            sent.append(payload)
            return responses[len(sent) - 1]
        with patch.dict(os.environ, ENV), patch.object(worker, 'gm_profile', return_value=None), \
                patch.object(worker, 'ai_budget_gate'), patch.object(worker, 'http_json', side_effect=fake):
            try:
                return worker.analyze([], {'start': 0, 'end': 120}, {}), sent
            except worker.Problem as exc:
                return exc, sent

    def test_cut_off_answer_is_retried_once_shorter_never_larger(self):
        result, sent = self.analyze([CUT_OFF, review_json()])
        self.assertEqual(result['summary'], 'S')
        self.assertEqual([p['max_output_tokens'] for p in sent], [4800, 4800])
        first, second = (p['input'][0]['content'][0]['text'] for p in sent)
        self.assertIn('OUTPUT SIZE LIMITS', first)
        self.assertIn('summary <= 120 words', first)
        self.assertIn('summary <= 72 words', second)

    def test_two_cut_offs_stop_after_two_requests(self):
        result, sent = self.analyze([CUT_OFF, CUT_OFF, review_json()])
        self.assertIsInstance(result, worker.Problem)
        self.assertEqual(result.code, 'output_cap')
        self.assertEqual(len(sent), 2)  # the old code made three, at up to 2.5x the size

    def test_cut_off_never_falls_back_to_the_expensive_model(self):
        calls = []
        def fake(payload, model=None, rate_limit_retries=2, escalate=True):
            calls.append((model, escalate))
            raise worker.Problem(502, 'cut off', 'output_cap')
        with patch.object(worker, 'step_models', return_value=['cheap/model', 'pricey/model']), \
                patch.object(worker, 'request_ai', side_effect=fake):
            with self.assertRaises(worker.Problem):
                worker.request_routed('overview', {}, lambda r: r, escalate=False)
        self.assertEqual(calls, [('cheap/model', False)])


class RequestBudgets(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = patch.object(worker, 'ROOT', Path(self.tmp.name))
        self.root.start()
        worker.initialize()
        worker._CTX.job_id = 'job-a'

    def tearDown(self):
        worker._CTX.job_id = None
        self.root.stop()
        self.tmp.cleanup()

    def test_job_budget_stops_further_requests(self):
        with patch.object(worker, 'AI_JOB_BUDGET', 3), patch.object(worker, 'AI_DAY_BUDGET', 100):
            for _ in range(3):
                worker.ai_budget_gate()
            with self.assertRaises(worker.Problem) as stopped:
                worker.ai_budget_gate()
        self.assertEqual((stopped.exception.status, stopped.exception.code), (403, 'ai_budget'))
        self.assertIn('Saved work is kept', stopped.exception.message)

    def test_day_budget_covers_all_jobs(self):
        with patch.object(worker, 'AI_JOB_BUDGET', 100), patch.object(worker, 'AI_DAY_BUDGET', 2):
            worker.ai_budget_gate()
            worker._CTX.job_id = 'job-b'
            worker.ai_budget_gate()
            worker._CTX.job_id = 'job-c'
            with self.assertRaises(worker.Problem):
                worker.ai_budget_gate()

    def test_request_is_not_sent_once_budget_is_spent(self):
        with patch.dict(os.environ, ENV), patch.object(worker, 'gm_profile', return_value=None), \
                patch.object(worker, 'AI_JOB_BUDGET', 1), patch.object(worker, 'AI_DAY_BUDGET', 100), \
                patch.object(worker, 'http_json', return_value=review_json()) as send:
            worker.request_ai({'max_output_tokens': 10})
            with self.assertRaises(worker.Problem) as stopped:
                worker.request_ai({'max_output_tokens': 10})
        self.assertEqual(send.call_count, 1)
        self.assertEqual(stopped.exception.code, 'ai_budget')

    def test_budget_failure_is_not_retried_and_cut_off_gets_one_retry(self):
        job_id = str(uuid4())
        meta = {'streamed_replay': True, 'replay_phase': 'analyze_periods', 'period_unit_index': 0,
                'period_units': [{'label': 'Period 1', 'start': 0, 'end': 300}]}
        with worker.connect() as db:
            db.execute('INSERT INTO jobs VALUES (?,?,?,?,?,?,?)', (job_id, 'o', 0, 'processing', json.dumps(meta), '{}', ''))
        self.assertIsNone(worker.schedule_part_retry(job_id, worker.Problem(403, 'limit', 'ai_budget')))
        self.assertIsNotNone(worker.schedule_part_retry(job_id, worker.Problem(502, 'cut', 'output_cap')))
        self.assertIsNone(worker.schedule_part_retry(job_id, worker.Problem(502, 'cut', 'output_cap')))


class CloserLooks(unittest.TestCase):
    def chunks(self, count, concern_at=()):
        return [{'label': 'Period 1', 'start': i * 120, 'end': i * 120 + 120,
                 'review': {'observations': [{'source': 'gameplay', 'timestamp': i * 120 + 60,
                                              'impact': 'negative' if i in concern_at else 'neutral'}]}}
                for i in range(count)]

    def run_looks(self, chunks, every):
        looked = []
        with tempfile.TemporaryDirectory() as tmp, patch.object(worker, 'SEQUENCE_REVIEW_EVERY', every), \
                patch.object(worker, 'AI_CHUNK_PAUSE', 0), patch.object(worker, 'update'), \
                patch.object(worker, 'extract_frames', return_value=[]), \
                patch.object(worker, 'analyze', side_effect=lambda f, window, *a, **k: looked.append(window['start']) or {'summary': 'x'}):
            worker.review_sequences('job', Path(tmp) / 'source.mp4', chunks, {}, {})
        return looked

    def test_one_closer_look_per_three_chunks_concerns_first(self):
        chunks = self.chunks(6, concern_at=(4,))
        looked = self.run_looks(chunks, 3)
        self.assertEqual(len(looked), 2)
        self.assertIn(4 * 120 + 56, looked)  # the flagged chunk is chosen
        self.assertTrue(all(c['sequence_checked'] for c in chunks))
        self.assertEqual(sum('sequence_review' in c for c in chunks), 2)

    def test_default_off_and_every_chunk_switches(self):
        self.assertEqual(self.run_looks(self.chunks(4), 0), [])
        self.assertEqual(len(self.run_looks(self.chunks(4), 1)), 4)
        self.assertEqual(len(self.run_looks(self.chunks(1), 3)), 1)


def regina_like(confirmed=False, pending_rollup=None):
    """P1-P3 reported; then post-game footage detected as 'Overtime', two parts already saved."""
    periods = [{'label': 'Period 1', 'start': 0, 'end': 300}, {'label': 'Period 2', 'start': 300, 'end': 600},
               {'label': 'Period 3', 'start': 600, 'end': 900}, {'label': 'Overtime 1', 'start': 900, 'end': 1100},
               {'label': 'Overtime 2', 'start': 1100, 'end': 2150}]
    units = worker.bounded_period_units(periods)
    done = [i for i, u in enumerate(units) if u['end'] <= 1470]  # 5 parts, as on the real job
    chunks = [{'label': u['label'], 'start': u['start'], 'end': u['end'], 'sequence_checked': True,
               'review': {'summary': 'saved', 'observations': []}} for u in units[:len(done)]]
    meta = {'streamed_replay': True, 'replay_phase': 'analyze_periods', 'source_kind': 'twitch_replay',
            'period_source': 'replay_scoreboard', 'period_units': units, 'periods': periods,
            'period_unit_index': len(done), 'completed_parts': done, 'source_start_seconds': 0,
            'source_end_seconds': 2150, 'vod_url': 'https://www.twitch.tv/videos/1'}
    if confirmed:
        meta['overtime_confirmed'] = True
    if pending_rollup:
        meta['pending_period_rollup'] = pending_rollup
    reports = [{'label': l, 'report': {'summary': l}} for l in ('Period 1', 'Period 2', 'Period 3', 'Overtime 1')]
    return meta, {'chunks': chunks, 'period_reports': reports}, len(units)


class ReginaLikeJob(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = patch.object(worker, 'ROOT', Path(self.tmp.name))
        self.root.start()
        worker.initialize()

    def tearDown(self):
        self.root.stop()
        self.tmp.cleanup()

    def job(self, **kwargs):
        meta, result, count = regina_like(**kwargs)
        job_id = str(uuid4())
        with worker.connect() as db:
            db.execute('INSERT INTO jobs VALUES (?,?,?,?,?,?,?)',
                       (job_id, 'o', 0, 'queued', json.dumps(meta), json.dumps(result), ''))
        return job_id, count

    def test_unconfirmed_overtime_is_dropped_and_game_report_is_built_without_new_video(self):
        job_id, count = self.job(pending_rollup='Overtime 2')
        self.assertGreater(count, 5)
        calls = []
        def rollup(chunks, step='game_rollup', period_reports=None):
            calls.append((step, [c['label'] for c in chunks], [p['label'] for p in period_reports or []]))
            return {'summary': 'Game'}
        with patch.object(worker, 'ai_configured', return_value=True), \
                patch.object(worker, 'AUTO_RELEASE_TWITCH_MEDIA', False), \
                patch.object(worker, 'build_rollup', side_effect=rollup), \
                patch.object(worker, 'extract_frames', side_effect=AssertionError('analyzed video')), \
                patch.object(worker, 'analyze', side_effect=AssertionError('ai call for overtime')):
            worker.process(job_id)
        job = worker.get_job(job_id)
        self.assertEqual(job['status'], 'ready_for_review')
        self.assertEqual(len(calls), 1)  # only the game report; no Overtime period report
        step, chunk_labels, report_labels = calls[0]
        self.assertEqual(step, 'game_rollup')
        self.assertEqual(report_labels, ['Period 1', 'Period 2', 'Period 3'])
        self.assertNotIn('Overtime 1', chunk_labels)
        self.assertEqual({u['label'] for u in job['metadata']['period_units']}, {'Period 1', 'Period 2', 'Period 3'})
        self.assertNotIn('pending_period_rollup', job['metadata'])

    def test_manually_confirmed_overtime_is_kept(self):
        job_id, _ = self.job(confirmed=True)
        with patch.object(worker, 'ai_configured', return_value=True), \
                patch.object(worker, 'build_rollup', side_effect=AssertionError('too early')):
            worker.process(job_id)
        job = worker.get_job(job_id)
        self.assertEqual(job['status'], 'retrieving')  # next overtime part still to fetch
        self.assertEqual(job['metadata']['period_unit_index'], 5)
        self.assertEqual(len(job['metadata']['period_units']), 7)

    def test_environment_switch_keeps_overtime(self):
        meta, _, count = regina_like()
        with patch.object(worker, 'ALLOW_UNCONFIRMED_OVERTIME', True):
            self.assertFalse(worker.prune_unconfirmed_overtime(meta))
        self.assertEqual(len(meta['period_units']), count)

    def test_resume_list_prunes_and_queues_without_a_download(self):
        job_id, _ = self.job()
        with worker.connect() as db:
            db.execute("UPDATE jobs SET status='failed' WHERE id=?", (job_id,))
        with patch.dict(os.environ, {'VOD_RESUME_JOB_IDS': job_id}):
            self.assertEqual(worker.resume_listed_jobs(), [(job_id, 'queued')])
        self.assertEqual(len(worker.get_job(job_id)['metadata']['period_units']), 3)


class ConfirmedOvertime(unittest.TestCase):
    def test_a_game_with_real_overtime_keeps_it_and_the_others_do_not(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(worker, 'ROOT', Path(tmp)):
            worker.initialize()
            ids = []
            for _ in range(2):
                meta, result, _ = regina_like()
                job_id = str(uuid4())
                with worker.connect() as db:
                    db.execute('INSERT INTO jobs VALUES (?,?,?,?,?,?,?)',
                               (job_id, 'o', 0, 'failed', json.dumps(meta), json.dumps(result), ''))
                ids.append(job_id)
            with patch.dict(os.environ, {'VOD_CONFIRM_OVERTIME_JOB_IDS': f'{ids[1]}, not-a-job'}):
                worker.confirm_overtime_jobs()
                worker.confirm_overtime_jobs()  # idempotent
            first, second = (worker.get_job(i) for i in ids)
            self.assertNotIn('overtime_confirmed', first['metadata'])
            self.assertTrue(second['metadata']['overtime_confirmed'])
            self.assertEqual(second['status'], 'failed')  # confirming never starts work
            kept = dict(second['metadata'])
            self.assertFalse(worker.prune_unconfirmed_overtime(kept))
            self.assertTrue(worker.prune_unconfirmed_overtime(dict(first['metadata'])))


class RetryButton(unittest.TestCase):
    def test_retry_resumes_a_streamed_replay_that_has_no_video_on_disk(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(worker, 'ROOT', Path(tmp)):
            worker.initialize()
            meta, result, _ = regina_like()
            meta['part_attempts'] = {'5': 3}
            job_id = str(uuid4())
            with worker.connect() as db:
                db.execute('INSERT INTO jobs VALUES (?,?,?,?,?,?,?)',
                           (job_id, 'owner-a', 0, 'failed', json.dumps(meta), json.dumps(result), 'AI credits'))
            server = ThreadingHTTPServer(('127.0.0.1', 0), worker.Handler)
            threading.Thread(target=server.serve_forever, daemon=True).start()
            try:
                req = urllib.request.Request(f'http://127.0.0.1:{server.server_port}/jobs/{job_id}/retry',
                                             method='POST', data=b'{}',
                                             headers={'Authorization': 'Bearer owner-a', 'Content-Type': 'application/json'})
                with patch.object(worker, 'authenticate', side_effect=lambda h: h.split(' ')[1]):
                    with urllib.request.urlopen(req, timeout=5) as res:
                        self.assertEqual(res.status, 202)
            finally:
                server.shutdown()
            job = worker.get_job(job_id)
            self.assertEqual(job['status'], 'queued')  # no 410 'Recording expired'
            self.assertNotIn('part_attempts', job['metadata'])
            self.assertEqual(job['result']['chunks'], result['chunks'])


if __name__ == '__main__':
    unittest.main()
