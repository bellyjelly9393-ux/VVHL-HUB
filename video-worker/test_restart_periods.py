"""VOD_RESTART_PERIODS: one existing job re-runs on hand-set periods, once, discarding old evidence."""
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import worker

PLAN = {'start': 2070, 'end': 3620,
        'periods': [['Period 1', 0, 605], ['Period 2', 605, 1075], ['Period 3', 1075, 1550]]}


class RestartPeriods(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = patch.object(worker, 'ROOT', Path(self.tmp.name))
        self.root.start()
        worker.initialize()
        self.job_id = str(uuid4())
        meta = {'review_id': 'r', 'streamed_replay': True, 'replay_phase': 'analyze_periods', 'completed_parts': [0, 1],
                'periods': [{'label': 'Period 1', 'start': 0, 'end': 96}], 'period_units': [{'label': 'Period 1', 'start': 0, 'end': 96}],
                'period_unit_index': 1, 'source_start_seconds': 2060, 'source_end_seconds': 4210,
                'pending_period_rollup': 'Period 2', 'part_attempts': {'0': 2}, 'vod_url': 'https://www.twitch.tv/videos/1'}
        result = {'chunks': [{'x': 1}], 'period_reports': [{'label': 'Period 1'}], 'game_rollup': {'summary': 'old'}}
        with worker.connect() as db:
            db.execute('INSERT INTO jobs VALUES (?,?,?,?,?,?,?)',
                       (self.job_id, 'o', 0, 'ready_for_review', json.dumps(meta), json.dumps(result), ''))

    def tearDown(self):
        self.root.stop()
        self.tmp.cleanup()

    def restart(self, plan):
        with patch.dict(os.environ, {'VOD_RESTART_PERIODS': json.dumps(plan)}):
            return worker.restart_job_periods()

    def test_the_job_restarts_on_the_new_periods_with_no_old_evidence(self):
        self.assertEqual(self.restart({self.job_id: PLAN}), [self.job_id])
        job = worker.get_job(self.job_id)
        meta = job['metadata']
        self.assertEqual(job['status'], 'retrieving')
        self.assertEqual((meta['source_start_seconds'], meta['source_end_seconds']), (2070, 3620))
        self.assertEqual([p['label'] for p in meta['periods']], ['Period 1', 'Period 2', 'Period 3'])
        self.assertTrue(all(u['end'] - u['start'] <= 370 for u in meta['period_units']))
        self.assertEqual(meta['period_units'][0]['start'], 0)
        self.assertEqual(meta['period_units'][-1]['end'], 1550)
        self.assertEqual(meta['period_unit_index'], 0)
        self.assertEqual(meta['review_id'], 'r')  # still the same review's job
        for gone in ('completed_parts', 'pending_period_rollup', 'part_attempts'):
            self.assertNotIn(gone, meta)
        self.assertNotIn('chunks', job['result'])
        self.assertNotIn('game_rollup', job['result'])
        self.assertFalse(meta['overtime_confirmed'])

    def test_it_runs_once_per_setting(self):
        self.restart({self.job_id: PLAN})
        worker.update(self.job_id, 'ready_for_review')
        self.assertEqual(self.restart({self.job_id: PLAN}), [])
        self.assertEqual(worker.get_job(self.job_id)['status'], 'ready_for_review')

    def test_a_job_the_site_made_that_is_waiting_in_the_queue_can_be_restarted_too(self):
        worker.update(self.job_id, 'retrieving')
        self.assertEqual(self.restart({self.job_id: PLAN}), [self.job_id])
        self.assertEqual(worker.get_job(self.job_id)['metadata']['period_units'][-1]['end'], 1550)

    def test_bad_input_changes_nothing(self):
        bad = {'start': 2070, 'end': 3620, 'periods': [['Period 1', 0, 900], ['Period 2', 800, 1550]]}
        self.assertEqual(self.restart({self.job_id: bad}), [])
        self.assertEqual(self.restart({str(uuid4()): PLAN}), [])
        with patch.dict(os.environ, {'VOD_RESTART_PERIODS': 'not json'}):
            self.assertEqual(worker.restart_job_periods(), [])
        self.assertEqual(worker.get_job(self.job_id)['status'], 'ready_for_review')

    def test_a_game_with_no_job_gets_one_linked_to_its_review_and_runs_on_the_periods(self):
        new_id = str(uuid4())
        review_id = str(uuid4())
        create = {'review_id': review_id.upper(), 'title': 'Game 2', 'vod_url': 'https://www.twitch.tv/videos/9', 'players': 'lineup'}
        self.assertEqual(self.restart({new_id: {**PLAN, 'create': create}}), [new_id])
        job = worker.get_job(new_id)
        self.assertEqual((job['status'], job['metadata']['review_id'], job['metadata']['game_id']),
                         ('retrieving', review_id, review_id))  # normalised, so the review finds it
        self.assertEqual(job['metadata']['vod_url'], 'https://www.twitch.tv/videos/9')
        self.assertEqual(job['metadata']['replay_phase'], 'analyze_periods')
        self.assertEqual(len(job['metadata']['periods']), 3)
        with worker.connect() as db:
            self.assertEqual(db.execute('SELECT owner FROM jobs WHERE id=?', (new_id,)).fetchone()['owner'], 'o')

    def test_no_job_and_no_usable_create_data_creates_nothing(self):
        for create in (None, {'review_id': 'r'}, {'review_id': 'r', 'vod_url': 'http://x/1'}):
            new_id = str(uuid4())
            self.assertEqual(self.restart({new_id: {**PLAN, 'create': create}}), [])
            with self.assertRaises(worker.Problem):
                worker.get_job(new_id)

    def test_a_restart_can_attach_a_lineup_to_saved_analysis(self):
        lineup = 'Calgary lineup: LW l Setty l, C l Richy 19 l, RW RipTopRight, LD imona_plain, RD BxbbyBxnds, G XxPASTRNAK88'
        self.restart({self.job_id: {**PLAN, 'players': lineup}})
        self.assertEqual(worker.get_job(self.job_id)['metadata']['players'], lineup)

    def test_an_overtime_period_is_kept_when_given(self):
        plan = {**PLAN, 'periods': PLAN['periods'] + [['Overtime 1', 1550, 1700]], 'end': 3770}
        self.restart({self.job_id: plan})
        meta = worker.get_job(self.job_id)['metadata']
        self.assertTrue(meta['overtime_confirmed'])
        self.assertEqual(meta['period_units'][-1]['label'], 'Overtime 1')


if __name__ == '__main__':
    unittest.main()
