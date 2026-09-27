import unittest
from unittest.mock import patch
import live_periods


class LivePeriodTests(unittest.TestCase):
    def test_parse_period_labels(self):
        self.assertEqual(live_periods.parse_period('1ST 18:42'), 1)
        self.assertEqual(live_periods.parse_period('2ND PERIOD'), 2)
        self.assertEqual(live_periods.parse_period('3RD 04:11'), 3)
        self.assertEqual(live_periods.parse_period('OT 2:03'), 4)
        self.assertIsNone(live_periods.parse_period('REPLAY'))

    @patch('live_periods.time.monotonic')
    def test_requires_confirmed_forward_transition(self, monotonic):
        monotonic.side_effect=[0, 300, 301, 700, 701]
        w=live_periods.LivePeriodWatcher('https://example.test/live.m3u8','/tmp/test-live-periods')
        w.started=0
        w._observe(2)
        self.assertNotIn(2,w.boundaries)
        w._observe(2)
        self.assertEqual(w.boundaries[2],300)
        w._observe(3)
        self.assertNotIn(3,w.boundaries)
        w._observe(3)
        self.assertEqual(w.boundaries[3],700)
        ranges=w.period_ranges(1100)
        self.assertEqual([r['label'] for r in ranges],['Period 1','Period 2','Period 3'])
        self.assertEqual(ranges[0]['end'],300)
        self.assertEqual(ranges[1]['start'],300)
        self.assertEqual(ranges[2]['end'],1100)

    def test_incomplete_boundaries_fall_back(self):
        w=live_periods.LivePeriodWatcher('https://example.test/live.m3u8','/tmp/test-live-periods')
        w.boundaries={1:0.0,2:350.0}
        self.assertEqual(w.period_ranges(1000),[])


if __name__=='__main__':
    unittest.main()
