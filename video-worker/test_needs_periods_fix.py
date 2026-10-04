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

if __name__ == '__main__':
    unittest.main()
