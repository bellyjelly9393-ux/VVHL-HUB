"""Site-entered periods (PUT /reviews/<id>/periods) and the reliability fixes around them."""
import json
import os
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from uuid import uuid4

import live_periods
import replay
import worker

P3 = [{'label': 'Period 1', 'start': 0, 'end': 605}, {'label': 'Period 2', 'start': 605, 'end': 1075},
      {'label': 'Period 3', 'start': 1075, 'end': 1550}]
BODY = {'source_start_seconds': 2070, 'source_end_seconds': 3620, 'overtime_confirmed': False, 'periods': P3}


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = patch.object(worker, 'ROOT', Path(self.tmp.name))
        self.root.start()
        worker.initialize()
        self.review = {'id': str(uuid4()), 'vod_url': 'https://www.twitch.tv/videos/77', 'title': 'Game',
                       'source_start_seconds': 2070, 'source_end_seconds': 3620, 'scouting_context': 'lineup'}
        self.read_review = patch.object(replay, 'read_review', side_effect=self.fake_review)
        self.read_review.start()
        self.allowed = {self.review['id']}

    def tearDown(self):
        self.read_review.stop()
        worker._CTX.job_id = None
        self.root.stop()
        self.tmp.cleanup()

    def fake_review(self, review_id, authorization):
        if review_id not in self.allowed:
            raise worker.Problem(404, 'Review not found or management access is missing.')
        return dict(self.review)

    def insert(self, status, meta, result=None, owner='someone-else', created=None):
        job_id = str(uuid4())
        with worker.connect() as db:
            db.execute('INSERT INTO jobs VALUES (?,?,?,?,?,?,?)', (job_id, owner, time.time() if created is None else created,
                       status, json.dumps(meta), json.dumps(result or {}), ''))
        return job_id

    def call(self, method, path, data=None, caller='caller'):
        handler = object.__new__(worker.Handler)
        handler.connection, handler.reply = Mock(), Mock()
        handler.body = handler.optional_body = Mock(return_value=data or {})
        handler.path, handler.command, handler.headers = path, method, {'Authorization': 'Bearer ' + caller}
        with patch.object(worker, 'authenticate', return_value=caller):
            try:
                handler.dispatch()
            except worker.Problem as exc:
                return exc.status, {'error': exc.message, 'code': exc.code}
        return handler.reply.call_args.args

    def jobs(self):
        with worker.connect() as db:
            return [r['id'] for r in db.execute('SELECT id FROM jobs').fetchall()]


class PeriodsEndpoint(Base):
    def put(self, body=BODY, caller='caller'):
        return self.call('PUT', f'/reviews/{self.review["id"]}/periods', body, caller)

    def test_rejects_bad_period_lists_with_400(self):
        bad = [
            P3[:2],  # Period 3 missing
            [P3[0], P3[1], {'label': 'Period 1', 'start': 1075, 'end': 1200}, P3[2]],  # non-adjacent repeat
            [P3[0], {'label': 'Period 2', 'start': 600, 'end': 1075}, P3[2]],  # overlap
            [P3[0], P3[1], {'label': 'Period 3', 'start': 1075, 'end': 1600}],  # outside the window
            [P3[0], P3[1], {'label': 'Third', 'start': 1075, 'end': 1550}],
        ]
        for periods in bad:
            with self.subTest(periods=periods):
                status, payload = self.put({**BODY, 'periods': periods})
                self.assertEqual((status, payload['code']), (400, 'invalid_periods'))
        self.assertEqual(self.jobs(), [])

    def test_a_lag_out_gap_inside_a_period_is_two_adjacent_entries(self):
        periods = [P3[0], {'label': 'Period 2', 'start': 605, 'end': 800}, {'label': 'Period 2', 'start': 840, 'end': 1075}, P3[2]]
        status, payload = self.put({**BODY, 'periods': periods})
        self.assertEqual(status, 200)
        worker.apply_period_requests()
        units = worker.get_job(payload['job']['id'])['metadata']['period_units']
        self.assertEqual([u['label'] for u in units], ['Period 1', 'Period 1', 'Period 2', 'Period 2', 'Period 3', 'Period 3'])
        meta = {'period_units': units}
        self.assertFalse(worker.is_last_part(meta, 2))
        self.assertTrue(worker.is_last_part(meta, 3))

    def test_no_job_yet_creates_one_for_the_caller_and_the_loop_applies_the_periods(self):
        status, payload = self.put()
        self.assertEqual(status, 200)
        job = payload['job']
        self.assertEqual(job['result']['stage'], 'periods_update_pending')
        self.assertTrue(job['periods_update_pending'])
        self.assertEqual(job['status'], 'needs_periods')  # not runnable until the loop applies it
        with worker.connect() as db:
            self.assertEqual(db.execute('SELECT owner FROM jobs WHERE id=?', (job['id'],)).fetchone()['owner'], 'caller')
        worker.apply_period_requests()
        job = worker.get_job(job['id'])
        meta = job['metadata']
        self.assertEqual(job['status'], 'retrieving')
        self.assertEqual(job['result']['stage'], 'period_boundaries_locked')
        self.assertEqual((meta['source_start_seconds'], meta['source_end_seconds']), (2070, 3620))
        self.assertEqual((meta['review_id'], meta['vod_url'], meta['players']), (self.review['id'], self.review['vod_url'], 'lineup'))
        self.assertEqual((meta['replay_phase'], meta['period_source'], meta['period_unit_index']), ('analyze_periods', 'manual', 0))
        self.assertTrue(meta['period_spec_hash'])
        self.assertIsNone(worker.pending_period_request(job['id']))

    def test_the_linked_job_of_another_owner_is_used_never_a_second_one(self):
        linked = self.insert('ready_for_review', {'review_id': self.review['id'].upper(), 'source_kind': 'twitch_replay',
                                                  'vod_url': self.review['vod_url']})
        self.insert('ready_for_review', {'review_id': str(uuid4())})
        status, payload = self.put()
        self.assertEqual((status, payload['job']['id']), (200, linked))
        preferred = self.insert('failed', {'source_kind': 'twitch_replay'})
        self.review['worker_job_id'] = preferred
        self.assertEqual(self.put()[1]['job']['id'], preferred)
        self.assertEqual(len(self.jobs()), 3)

    def test_same_periods_again_change_nothing_and_resume_a_failed_job(self):
        job_id = self.put()[1]['job']['id']
        worker.apply_period_requests()
        worker.update(job_id, 'ready_for_review')
        self.assertEqual(self.put()[1]['job']['status'], 'ready_for_review')
        self.assertIsNone(worker.pending_period_request(job_id))
        worker.update(job_id, 'failed', error='boom')
        job = self.put()[1]['job']
        self.assertEqual((job['status'], job['error']), ('retrieving', ''))

    def test_changed_periods_keep_only_chunks_whose_footage_and_label_are_unchanged(self):
        meta = {'review_id': self.review['id'], 'vod_url': self.review['vod_url'], 'source_kind': 'saved_evidence',
                'synthesis_only': True, 'source_start_seconds': 2070, 'source_end_seconds': 3620, 'streamed_replay': True,
                'completed_parts': [0, 1], 'pending_period_rollup': 'Period 2', 'part_attempts': {'1': 2},
                'ai_rate_limit_retries': 3, 'scan_unit_index': 9, 'resume_marker': 'x'}
        chunks = [{'label': 'Period 1', 'start': 0, 'end': 120, 'sequence_checked': True},
                  {'label': 'Period 1', 'start': 590, 'end': 700, 'sequence_checked': True},
                  {'label': 'Period 2', 'start': 700, 'end': 820, 'sequence_checked': True}]
        result = {'chunks': chunks, 'period_reports': [{'label': 'Period 1'}], 'game_rollup': {'summary': 'old'}}
        job_id = self.insert('ready_for_review', meta, result)
        (worker.ROOT / job_id).mkdir()
        (worker.ROOT / job_id / 'source.mp4').write_bytes(b'old part')
        periods = [{'label': 'Period 1', 'start': 0, 'end': 650}, {'label': 'Period 2', 'start': 650, 'end': 1075}, P3[2]]
        self.put({**BODY, 'periods': periods})
        worker.apply_period_requests()
        job = worker.get_job(job_id)
        self.assertEqual([(c['label'], c['start']) for c in job['result']['chunks']], [('Period 1', 0), ('Period 2', 700)])
        self.assertNotIn('period_reports', job['result'])
        self.assertNotIn('game_rollup', job['result'])
        for gone in worker.RUN_STATE_KEYS:
            self.assertNotIn(gone, job['metadata'])
        self.assertEqual(job['metadata']['source_kind'], 'twitch_replay')
        self.assertFalse((worker.ROOT / job_id).exists())
        # A different window is other footage: nothing is kept.
        self.put({**BODY, 'source_start_seconds': 2000, 'periods': periods})
        worker.apply_period_requests()
        self.assertNotIn('chunks', worker.get_job(job_id)['result'])

    def test_an_expired_linked_job_is_revived(self):
        job_id = self.insert('expired', {'review_id': self.review['id'], 'vod_url': self.review['vod_url']})
        self.assertEqual(self.call('GET', f'/reviews/{self.review["id"]}/job')[1]['job']['status'], 'expired')
        self.put()
        worker.apply_period_requests()
        self.assertEqual(worker.get_job(job_id)['status'], 'retrieving')
        self.assertEqual(self.jobs(), [job_id])

    def test_a_running_job_is_only_changed_by_the_work_loop_between_steps(self):
        job_id = self.insert('processing', {'review_id': self.review['id'], 'vod_url': self.review['vod_url'],
                                            'completed_parts': [0]})
        job = self.put()[1]['job']
        self.assertEqual((job['status'], job['result']['stage']), ('processing', 'periods_update_pending'))
        self.assertEqual(worker.get_job(job_id)['metadata']['completed_parts'], [0])
        stop = threading.Event()
        with patch.object(worker, 'STOP', stop), patch.object(worker, 'process'), \
                patch('replay.retrieve', side_effect=lambda _: stop.set()):
            worker.work_once()
        self.assertNotIn('completed_parts', worker.get_job(job_id)['metadata'])


class AnalyzeAndJobRoutes(Base):
    def test_analyze_without_periods_needs_them_and_never_creates_a_job(self):
        status, payload = self.call('POST', f'/reviews/{self.review["id"]}/analyze')
        self.assertEqual((status, payload['code']), (422, 'periods_required'))
        self.assertEqual(payload['error'], 'Enter the period start times before analyzing.')
        self.assertEqual(self.call('GET', f'/reviews/{self.review["id"]}/job'), (200, {'job': None}))
        self.assertEqual(self.jobs(), [])

    def test_analyze_returns_the_linked_job_and_with_periods_acts_like_put(self):
        job_id = self.insert('needs_periods', {'review_id': self.review['id'], 'vod_url': self.review['vod_url']})
        status, payload = self.call('POST', f'/reviews/{self.review["id"]}/analyze', {})
        self.assertEqual((status, payload['job']['id'], payload['job']['status']), (200, job_id, 'needs_periods'))
        status, payload = self.call('POST', f'/reviews/{self.review["id"]}/analyze', BODY)
        self.assertEqual((status, payload['job']['result']['stage']), (200, 'periods_update_pending'))
        self.assertEqual(self.jobs(), [job_id])

    def test_job_routes_allow_managers_of_the_linked_review(self):
        job_id = self.insert('failed', {'review_id': self.review['id'], 'source_kind': 'twitch_replay',
                                        'streamed_replay': True, 'replay_phase': 'analyze_periods',
                                        'period_units': [{'label': 'Period 1', 'start': 0, 'end': 300}]})
        self.assertEqual(self.call('GET', f'/jobs/{job_id}', caller='gm')[0], 200)
        self.assertEqual(self.call('POST', f'/jobs/{job_id}/retry', {}, caller='gm')[0], 202)
        self.allowed.clear()
        self.assertEqual(self.call('GET', f'/jobs/{job_id}', caller='gm')[0], 404)
        self.assertEqual(self.call('GET', f'/jobs/{job_id}', caller='someone-else')[0], 200)  # the owner


class AuditFixes(Base):
    def streamed(self, status='ready_for_review'):
        units = [{'label': 'Period 1', 'start': 0, 'end': 300}, {'label': 'Period 2', 'start': 300, 'end': 600}]
        meta = {'review_id': self.review['id'], 'streamed_replay': True, 'replay_phase': 'analyze_periods',
                'source_kind': 'twitch_replay', 'period_source': 'manual', 'periods': units, 'period_units': units,
                'period_unit_index': 2, 'completed_parts': [0, 1], 'pending_period_rollup': 'Period 2',
                'part_attempts': {'1': 1}, 'source_start_seconds': 0, 'source_end_seconds': 600,
                'vod_url': self.review['vod_url'], 'keep': 'me'}
        chunks = [{'label': u['label'], 'start': u['start'], 'end': u['end'], 'sequence_checked': True} for u in units]
        return self.insert(status, meta, {'chunks': chunks, 'period_reports': [{'label': 'Period 1'}]}, owner='caller')

    def test_reanalyze_really_looks_at_the_video_again(self):
        job_id = self.streamed()
        self.assertEqual(self.call('POST', f'/jobs/{job_id}/reanalyze', {})[0], 202)
        job = worker.get_job(job_id)
        self.assertEqual((job['status'], job['result']), ('retrieving', {}))
        for gone in ('completed_parts', 'pending_period_rollup', 'part_attempts'):
            self.assertNotIn(gone, job['metadata'])
        self.assertEqual(worker.mark_saved_parts(dict(job['metadata']), job['result']), set())

    def test_refresh_report_merges_metadata_and_refuses_a_running_job(self):
        self.review['worker_result'] = {'chunks': [{'label': 'Period 1', 'review': {'summary': 's'}}]}
        other = dict(self.review, id=str(uuid4()))
        self.assertEqual(replay.refresh_saved_report(other, 'caller')['status'], 'queued')  # no job yet: one is made
        job_id = self.streamed('processing')
        with self.assertRaises(worker.Problem) as busy:
            replay.refresh_saved_report(self.review, 'caller')
        self.assertEqual(busy.exception.status, 409)
        worker.update(job_id, 'ready_for_review')
        job = replay.refresh_saved_report(dict(self.review, source_start_seconds=1), 'caller')
        meta = job['metadata']
        self.assertEqual((job['status'], meta['synthesis_only'], meta['keep']), ('queued', True, 'me'))
        self.assertEqual((meta['source_start_seconds'], len(meta['period_units'])), (0, 2))
        worker.update(job_id, 'ready_for_review')
        self.call('PUT', f'/reviews/{self.review["id"]}/periods', BODY, caller='caller')
        worker.apply_period_requests()
        meta = worker.get_job(job_id)['metadata']
        self.assertNotIn('synthesis_only', meta)
        self.assertEqual(meta['source_kind'], 'twitch_replay')

    def test_replay_test_endpoint_refuses_a_running_job_and_merges(self):
        owner = str(uuid4())
        job_id = self.streamed('retrieving')
        with worker.connect() as db:
            db.execute('UPDATE jobs SET owner=? WHERE id=?', (owner, job_id))
        body = {'owner': owner, 'review_id': self.review['id'], 'vod_url': self.review['vod_url'],
                'source_start_seconds': 10, 'source_end_seconds': 1000}
        handler = object.__new__(worker.Handler)
        handler.connection, handler.reply, handler.body = Mock(), Mock(), Mock(return_value=body)
        handler.path, handler.command, handler.headers = '/internal/replay-test', 'POST', {'X-Replay-Admin': 't'}
        with patch.object(worker, 'REPLAY_ADMIN_TOKEN', 't'):
            with self.assertRaises(worker.Problem) as busy:
                handler.dispatch()
            self.assertEqual(busy.exception.status, 409)
            worker.update(job_id, 'failed')
            handler.dispatch()
        meta = worker.get_job(job_id)['metadata']
        self.assertEqual((meta['keep'], meta['source_start_seconds']), ('me', 10))
        self.assertNotIn('completed_parts', meta)

    def test_finished_ocr_scan_only_suggests_periods(self):
        spans = [{'label': f'Period {n}', 'start': (n - 1) * 400, 'end': n * 400} for n in (1, 2, 3)]
        meta = {'streamed_replay': True, 'replay_phase': 'scan_periods', 'scan_units': [{'start': 0, 'end': 1200}],
                'scan_unit_index': 0, 'source_start_seconds': 0, 'source_end_seconds': 1200, 'players': ''}
        job_id = self.insert('queued', meta)
        (worker.ROOT / job_id).mkdir()
        (worker.ROOT / job_id / 'source.mp4').write_bytes(b'slice')
        scan = {'ranges': spans, 'current_period': 3, 'boundaries': [], 'confirmed': True}
        with patch.object(worker, 'probe', return_value=1200.0), \
                patch.object(live_periods, 'scan_recording_periods', return_value=scan), \
                patch.object(worker, 'analyze', side_effect=AssertionError('paid analysis')):
            worker.process(job_id)
        job = worker.get_job(job_id)
        self.assertEqual(job['status'], 'needs_periods')
        self.assertEqual(job['result']['period_detection'], 'replay_scoreboard')
        self.assertEqual([p['label'] for p in job['result']['detected_periods']], ['Period 1', 'Period 2', 'Period 3'])
        self.assertNotEqual(job['metadata']['replay_phase'], 'analyze_periods')

    def test_upload_ocr_detection_also_waits_for_confirmation(self):
        job_id = self.insert('queued', {'periods': []})
        (worker.ROOT / job_id).mkdir()
        (worker.ROOT / job_id / 'source.mp4').write_bytes(b'video')
        detected = [{'label': 'Period 1', 'start': 0, 'end': 400}]
        with patch.object(worker, 'probe', return_value=1200.0), patch.object(worker, 'detect_periods', return_value=detected), \
                patch.object(worker, 'analyze', side_effect=AssertionError('paid analysis')):
            worker.process(job_id)
        job = worker.get_job(job_id)
        self.assertEqual((job['status'], job['result']['detected_periods']), ('needs_periods', detected))

    def test_unconfirmed_scan_does_not_carry_lobby_footage_as_period_one(self):
        reads = [{'at': 6, 'period': None, 'clock_seconds': None},
                 {'at': 18, 'period': None, 'clock_seconds': 3 * 60},  # stray lobby clocks that look like a reset
                 {'at': 30, 'period': None, 'clock_seconds': None},
                 {'at': 42, 'period': None, 'clock_seconds': 19 * 60 + 50},
                 {'at': 54, 'period': None, 'clock_seconds': None},
                 {'at': 90, 'period': 1, 'clock_seconds': 19 * 60},
                 {'at': 102, 'period': 1, 'clock_seconds': 18 * 60 + 40}]
        inferred = live_periods.infer_period_ranges(reads, 200, confirmed=False, confirm_reads=2, interval=12)
        self.assertTrue(inferred['confirmed'])
        self.assertEqual([(r['label'], r['start']) for r in inferred['ranges']], [('Period 1', 84.0)])
        self.assertFalse(any(b['reason'] == 'clock_reset' for b in inferred['boundaries']))
        nothing = live_periods.infer_period_ranges(reads[:1], 200, confirmed=False)
        self.assertEqual((nothing['ranges'], nothing['confirmed']), ([], False))

    def test_budget_counts_only_this_run(self):
        job_id = self.insert('failed', {'source_kind': 'twitch_replay', 'streamed_replay': True}, owner='caller')
        with worker.connect() as db:
            db.execute("INSERT INTO ai_usage(job_id, day, requests) VALUES (?, '2026-01-01', 3)", (job_id,))
        worker._CTX.job_id = job_id
        with patch.object(worker, 'AI_JOB_BUDGET', 3), patch.object(worker, 'AI_DAY_BUDGET', 100):
            with self.assertRaises(worker.Problem) as spent:
                worker.ai_budget_gate()
            self.assertEqual(spent.exception.code, 'ai_budget')
            self.assertEqual(self.call('POST', f'/jobs/{job_id}/retry', {})[0], 202)
            self.assertEqual(worker.get_job(job_id)['metadata']['ai_requests_baseline'], 3)
            for _ in range(3):
                worker.ai_budget_gate()
            with self.assertRaises(worker.Problem):
                worker.ai_budget_gate()

    def test_overtime_prune_handles_ot_labels_anywhere(self):
        units = [{'label': 'Period 1', 'start': 0, 'end': 300}, {'label': 'OT', 'start': 300, 'end': 400},
                 {'label': 'Period 2', 'start': 400, 'end': 700}, {'label': 'Overtime 1', 'start': 700, 'end': 800},
                 {'label': 'Period 3', 'start': 800, 'end': 900}]
        meta = {'period_units': units, 'completed_parts': [0, 1, 2], 'period_unit_index': 3,
                'part_attempts': {'4': 1, 'game': 1}, 'active_replay_unit': {'label': 'Overtime 1'}}
        self.assertTrue(worker.prune_unconfirmed_overtime(meta))
        self.assertEqual([u['label'] for u in meta['period_units']], ['Period 1', 'Period 2', 'Period 3'])
        self.assertEqual((meta['completed_parts'], meta['period_unit_index']), ([0, 1], 2))
        self.assertEqual(meta['part_attempts'], {'2': 1, 'game': 1})
        self.assertNotIn('active_replay_unit', meta)
        self.assertFalse(worker.prune_unconfirmed_overtime(dict(meta, period_units=units, overtime_confirmed=True)))

    def test_cleanup_expires_by_last_activity_and_spares_streamed_replays(self):
        old = time.time() - worker.RETENTION - 60
        idle = self.insert('awaiting_ai', {}, created=old)
        busy = self.insert('awaiting_ai', {}, created=old)
        streamed = self.insert('awaiting_ai', {'streamed_replay': True}, created=old)
        worker.update(busy, 'awaiting_ai', error='touched')
        worker.cleanup()
        self.assertEqual([worker.get_job(j)['status'] for j in (idle, busy, streamed)],
                         ['expired', 'awaiting_ai', 'awaiting_ai'])

    def test_work_loop_survives_errors_and_reports_liveness(self):
        stop = threading.Event()
        calls = []
        def flaky():
            calls.append(1)
            if len(calls) == 2:
                stop.set()
            raise RuntimeError('database locked')
        with patch.object(worker, 'STOP', stop), patch.object(worker, 'cleanup', side_effect=flaky):
            thread = worker.start_work_loop()
            thread.join(30)
            self.assertEqual(len(calls), 2)
            health = worker.loop_health()
        self.assertEqual((health['errors'] >= 2, health['lastError']), (True, 'RuntimeError'))
        status, payload = self.call('GET', '/health')
        self.assertIn('alive', payload['workLoop'])

    def test_restart_job_normalises_the_review_id(self):
        self.assertIsNone(worker.create_restart_job(str(uuid4()), {'review_id': 'not-a-uuid', 'vod_url': 'https://www.twitch.tv/videos/1'}))
        job = worker.create_restart_job(str(uuid4()), {'review_id': self.review['id'].upper(), 'owner': 'o',
                                                       'vod_url': 'https://www.twitch.tv/videos/1'})
        self.assertEqual(job['metadata']['review_id'], self.review['id'])
        self.assertEqual(replay.resolve(self.review, 'anyone')['id'], job['id'])


if __name__ == '__main__':
    unittest.main()
