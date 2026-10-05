import json, os, tempfile, time, unittest
from pathlib import Path
from uuid import uuid4
os.environ['DATA_DIR'] = tempfile.mkdtemp()
import worker, replay

class NeedsPeriodsFix(unittest.TestCase):
    def setUp(self):
        worker.ROOT = Path(os.environ['DATA_DIR']); worker.initialize()
    def insert(self, status, meta, result=None):
        jid = str(uuid4())
        with worker.connect() as db:
            db.execute('INSERT INTO jobs VALUES (?,?,?,?,?,?,?)', (jid, 'owner', time.time(), status, json.dumps(meta), json.dumps(result or {}), ''))
        return jid
    def test_restart_keeps_streamed_replay_waiting(self):
        jid = self.insert('needs_periods', {'streamed_replay': True, 'source_kind': 'twitch_replay'})
        up = self.insert('needs_periods', {'periods': []})
        worker.initialize()
        self.assertEqual(worker.get_job(jid)['status'], 'needs_periods')
        self.assertEqual(worker.get_job(up)['status'], 'queued')
    def test_finished_scan_returns_to_needs_periods_without_download(self):
        meta = {'streamed_replay': True, 'source_kind': 'twitch_replay', 'vod_url': 'https://www.twitch.tv/videos/1',
                'source_start_seconds': 2700, 'source_end_seconds': 4700, 'replay_phase': 'scan_periods',
                'scan_units': [{'start': 0, 'end': 240}], 'scan_unit_index': 1}
        jid = self.insert('retrieving', meta, {'period_spans': []})
        replay.retrieve(jid)
        job = worker.get_job(jid)
        self.assertEqual(job['status'], 'needs_periods')
        self.assertEqual(job['result']['stage'], 'needs_period_boundaries')


    def test_seed_can_skip_ocr_with_confirmed_periods(self):
        owner = str(uuid4())
        review_id = str(uuid4())
        os.environ['REPLAY_TEST_SEED_TOKEN'] = 'confirmed-periods-test-v1'
        os.environ['REPLAY_TEST_SEED'] = json.dumps([{
            'owner': owner,
            'review_id': review_id,
            'title': 'Confirmed periods',
            'vod_url': 'https://www.twitch.tv/videos/123456',
            'source_start_seconds': 1,
            'source_end_seconds': 1440,
            'game_format': '6s',
            'periods': [
                {'label': 'Period 1', 'start': 0, 'end': 432},
                {'label': 'Period 2', 'start': 432, 'end': 816},
                {'label': 'Period 3', 'start': 816, 'end': 1439},
            ],
        }])
        try:
            seeded = replay.seed_replay_test_batch()
            self.assertEqual(len(seeded), 1)
            job = worker.get_job(seeded[0]['job_id'], owner)
            meta = job['metadata']
            self.assertEqual(job['status'], 'retrieving')
            self.assertTrue(meta['streamed_replay'])
            self.assertEqual(meta['replay_phase'], 'analyze_periods')
            self.assertEqual(meta['period_source'], 'manual')
            self.assertEqual(meta['period_unit_index'], 0)
            self.assertEqual([p['label'] for p in meta['periods']], ['Period 1', 'Period 2', 'Period 3'])
            self.assertTrue(meta['period_units'])
            self.assertEqual(meta['period_units'][0]['label'], 'Period 1')
        finally:
            os.environ.pop('REPLAY_TEST_SEED', None)
            os.environ.pop('REPLAY_TEST_SEED_TOKEN', None)

if __name__ == '__main__':
    unittest.main()
