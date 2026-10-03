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
        monotonic.side_effect=[300, 700]
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


    def test_game_clock_reset_can_confirm_next_period(self):
        reads = [
            {'at': 12, 'period': 1, 'clock_seconds': 18 * 60},
            {'at': 192, 'period': None, 'clock_seconds': 70},
            {'at': 204, 'period': None, 'clock_seconds': 19 * 60 + 20},
            {'at': 216, 'period': 2, 'clock_seconds': 18 * 60 + 40},
        ]
        inferred = live_periods.infer_period_ranges(reads, 300, initial_period=1, confirm_reads=2, interval=12)
        self.assertEqual(inferred['current_period'], 2)
        self.assertEqual([r['label'] for r in inferred['ranges']], ['Period 1', 'Period 2'])
        self.assertTrue(any(b['reason'] == 'clock_reset' for b in inferred['boundaries']))

    def test_period_ocr_requires_confirmation(self):
        reads = [
            {'at': 12, 'period': 1, 'clock_seconds': 1100},
            {'at': 120, 'period': 2, 'clock_seconds': 1190},
            {'at': 132, 'period': 2, 'clock_seconds': 1170},
        ]
        inferred = live_periods.infer_period_ranges(reads, 240, initial_period=1, confirm_reads=2, interval=12)
        self.assertEqual(inferred['current_period'], 2)
        self.assertEqual(len(inferred['ranges']), 2)


if __name__=='__main__':
    unittest.main()
