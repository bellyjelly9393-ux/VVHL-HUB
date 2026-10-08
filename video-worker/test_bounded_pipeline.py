"""Full VOD -> P1/P2/P3 -> <=370s parts -> saved parts -> bounded period report -> game report."""
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import replay
import worker


def chunk(label, start, end, checked=True, summary='Saved part evidence'):
    return {'label': label, 'start': start, 'end': end, 'sequence_checked': checked,
            'review': {'summary': summary, 'tactical': {'offense': 'Wall-heavy entries ' * 40},
                       'player_evaluations': [{'player': f'P{i}', 'strengths': 'x ' * 400} for i in range(20)],
                       'observations': [{'source': 'gameplay', 'timestamp': start + i, 'note': 'n ' * 200}
                                        for i in range(40)],
                       'uncertainties': ['u ' * 100] * 10}}


def completed(report):
    return {'status': 'completed', 'output': [{'content': [{'type': 'output_text', 'text': json.dumps(report)}]}]}


REPORT = {**{k: 'Reviewed' for k in ('summary', 'patterns', 'strengths', 'corrections', 'tactical_report',
                                      'player_report', 'professional_writeup', 'result', 'process')},
          'team_systems': {k: 'Reviewed' for k in worker.extend_schema({'properties': {}, 'required': []})
                           ['properties']['team_systems']['properties']},
          'game_rating': {'score': None, 'reason': ''}, 'unit_reports': [], 'player_reports': []}

UNITS = (worker.bounded_period_units([{'label': 'Period 1', 'start': 0, 'end': 600}])
         + worker.bounded_period_units([{'label': 'Period 2', 'start': 600, 'end': 1200}]))


class BoundedRollupTests(unittest.TestCase):
    def test_rollup_never_raises_its_token_cap_and_tightens_instead(self):
        sent = []
        def fake(url, headers, payload):
            sent.append(payload)
            if len(sent) == 1:
                return {'status': 'incomplete', 'incomplete_details': {'reason': 'max_output_tokens'}}
            return completed(REPORT)
        chunks = [chunk('Period 1', s, s + 120) for s in range(0, 1200, 115)]
        with patch.dict(os.environ, {'OPENAI_API_KEY': 'k', 'OPENAI_MODEL': 'm', 'AI_PROVIDER': 'openai'}), \
                patch.object(worker, 'gm_profile', return_value=None), \
                patch.object(worker, 'http_json', side_effect=fake):
            worker.build_rollup(chunks, step='period_rollup')
        self.assertEqual([p['max_output_tokens'] for p in sent], [5000, 5000])
        first, second = (p['input'][0]['content'][0]['text'] for p in sent)
        evidence = lambda text: text.split('Reviewed evidence:\n', 1)[1]
        self.assertLessEqual(len(evidence(first)), worker.ROLLUP_EVIDENCE_CHARS)
        self.assertLess(len(evidence(second)), len(evidence(first)))
        self.assertIn('OUTPUT SIZE LIMITS', first)

    def test_game_report_is_built_from_compact_period_reports_not_raw_chunks(self):
        sent = []
        def fake(url, headers, payload):
            sent.append(payload['input'][0]['content'][0]['text'])
            return completed(REPORT)
        chunks = [chunk('Period 1', 0, 120, summary='RAW-CHUNK-ONLY')]
        reports = [{'label': f'Period {n}', 'report': {**REPORT, 'summary': f'P{n} compact report'}} for n in (1, 2, 3)]
        with patch.dict(os.environ, {'OPENAI_API_KEY': 'k', 'OPENAI_MODEL': 'm', 'AI_PROVIDER': 'openai'}), \
                patch.object(worker, 'gm_profile', return_value=None), \
                patch.object(worker, 'http_json', side_effect=fake):
            worker.build_rollup(chunks, period_reports=reports)
        self.assertIn('P3 compact report', sent[0])
        self.assertNotIn('RAW-CHUNK-ONLY', sent[0])


class PartPipelineTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = patch.object(worker, 'ROOT', Path(self.tmp.name))
        self.root.start()
        worker.initialize()

    def tearDown(self):
        self.root.stop()
        self.tmp.cleanup()

    def job(self, status, meta, result):
        job_id = str(uuid4())
        base = {'streamed_replay': True, 'replay_phase': 'analyze_periods', 'source_kind': 'twitch_replay',
                'vod_url': 'https://www.twitch.tv/videos/1', 'source_start_seconds': 0,
                'source_end_seconds': 1200, 'period_units': [dict(u) for u in UNITS]}
        with worker.connect() as db:
            db.execute('INSERT INTO jobs VALUES (?,?,?,?,?,?,?)',
                       (job_id, 'owner', 0, status, json.dumps({**base, **meta}), json.dumps(result), ''))
        return job_id

    def test_parts_never_exceed_370_seconds(self):
        self.assertTrue(all(u['end'] - u['start'] <= 370 for u in UNITS))
        job_id = self.job('retrieving', {'period_units': [{'label': 'Period 1', 'start': 0, 'end': 1200}],
                                         'period_unit_index': 0}, {})
        with patch.object(replay.subprocess, 'Popen', side_effect=RuntimeError('stop before download')):
            with self.assertRaises(RuntimeError):
                replay.retrieve(job_id)
        meta = worker.get_job(job_id)['metadata']
        self.assertTrue(all(u['end'] - u['start'] <= 370 for u in meta['period_units']))
        self.assertLessEqual(meta['active_replay_unit']['end'] - meta['active_replay_unit']['start'], 370)

    def test_saved_part_is_never_downloaded_again(self):
        job_id = self.job('retrieving', {'period_unit_index': 0},
                          {'chunks': [chunk('Period 1', 0, 120), chunk('Period 1', 115, 235),
                                      chunk('Period 1', 230, 370)]})
        with patch.object(replay.subprocess, 'Popen', side_effect=AssertionError('downloaded a saved part')):
            replay.retrieve(job_id)
        job = worker.get_job(job_id)
        self.assertEqual(job['status'], 'queued')
        self.assertEqual(job['metadata']['completed_parts'], [0])

    def test_missing_part_video_is_refetched_not_failed(self):
        job_id = self.job('queued', {'period_unit_index': 1}, {'chunks': []})
        worker.process(job_id)
        self.assertEqual(worker.get_job(job_id)['status'], 'retrieving')

    def test_failed_part_retries_only_that_part(self):
        job_id = self.job('processing', {'period_unit_index': 1, 'completed_parts': [0]}, {'chunks': []})
        delay = worker.schedule_part_retry(job_id, worker.Problem(502, 'AI output was incomplete.'))
        job = worker.get_job(job_id)
        self.assertGreater(delay, 0)
        self.assertEqual(job['metadata']['period_unit_index'], 1)
        self.assertEqual(job['metadata']['completed_parts'], [0])
        self.assertEqual(job['metadata']['part_attempts'], {'1': 1})
        self.assertEqual(job['status'], 'retrieving')
        self.assertIn('part 2', job['error'])
        for _ in range(worker.PART_RETRY_LIMIT - 1):
            worker.schedule_part_retry(job_id, worker.Problem(502, 'again'))
        self.assertIsNone(worker.schedule_part_retry(job_id, worker.Problem(502, 'again')))
        self.assertIsNone(worker.schedule_part_retry(job_id, worker.Problem(402, 'billing')))

    def test_period_report_waits_for_every_part_then_retries_without_video(self):
        saved = [chunk('Period 1', 0, 120), chunk('Period 1', 115, 235), chunk('Period 1', 230, 370),
                 chunk('Period 1', 365, 485), chunk('Period 1', 480, 600)]
        job_id = self.job('queued', {'period_unit_index': 1, 'completed_parts': [0]}, {'chunks': saved})
        calls = []
        def rollup(chunks, step='game_rollup', period_reports=None, lineup=''):
            calls.append((step, len(chunks)))
            raise worker.Problem(502, 'AI output was incomplete.')
        with patch.object(worker, 'ai_configured', return_value=True), \
                patch.object(worker, 'build_rollup', side_effect=rollup):
            with self.assertRaises(worker.Problem):
                worker.process(job_id)
        self.assertEqual(calls, [('period_rollup', 5)])
        job = worker.get_job(job_id)
        self.assertEqual(job['metadata']['pending_period_rollup'], 'Period 1')
        self.assertEqual(job['metadata']['completed_parts'], [0, 1])
        worker.schedule_part_retry(job_id, worker.Problem(502, 'AI output was incomplete.'))
        job = worker.get_job(job_id)
        self.assertEqual(job['status'], 'queued')  # synthesis needs no video download
        self.assertEqual(job['metadata']['part_attempts'], {'rollup:Period 1': 1})
        with patch.object(worker, 'ai_configured', return_value=True), \
                patch.object(worker, 'build_rollup', return_value={'summary': 'P1'}):
            worker.process(job_id)
        job = worker.get_job(job_id)
        self.assertEqual([p['label'] for p in job['result']['period_reports']], ['Period 1'])
        self.assertEqual(job['status'], 'retrieving')
        self.assertEqual(job['metadata']['period_unit_index'], 2)

    def test_game_report_runs_once_from_three_period_reports(self):
        reports = [{'label': l, 'report': {'summary': l}} for l in ('Period 1', 'Period 2')]
        job_id = self.job('queued', {'period_unit_index': len(UNITS)}, {'chunks': [], 'period_reports': reports})
        seen = []
        with patch.object(worker, 'ai_configured', return_value=True), \
                patch.object(worker, 'AUTO_RELEASE_TWITCH_MEDIA', False), \
                patch.object(worker, 'build_rollup',
                             side_effect=lambda c, step='game_rollup', period_reports=None, lineup='':
                             seen.append(period_reports) or {'summary': 'Game'}):
            worker.process(job_id)
        self.assertEqual([p['label'] for p in seen[0]], ['Period 1', 'Period 2'])
        self.assertEqual(worker.get_job(job_id)['status'], 'ready_for_review')

    def test_named_existing_jobs_resume_from_saved_parts_once(self):
        saved = [chunk('Period 1', 0, 120), chunk('Period 1', 115, 235), chunk('Period 1', 230, 370)]
        job_id = self.job('failed', {'period_unit_index': 0, 'active_replay_unit': {'kind': 'period'}},
                          {'chunks': saved})
        other = self.job('failed', {'period_unit_index': 0}, {'chunks': []})
        with patch.dict(os.environ, {'VOD_RESUME_JOB_IDS': job_id}):
            self.assertEqual(worker.resume_listed_jobs(), [(job_id, 'queued')])
            job = worker.get_job(job_id)
            self.assertEqual(job['metadata']['completed_parts'], [0])
            self.assertEqual(job['result']['chunks'], saved)  # same job, evidence kept
            worker.update(job_id, 'failed')
            self.assertEqual(worker.resume_listed_jobs(), [])  # one resume per configured list
        self.assertEqual(worker.get_job(other)['status'], 'failed')


if __name__ == '__main__':
    unittest.main()
