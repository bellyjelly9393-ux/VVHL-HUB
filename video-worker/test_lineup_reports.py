"""Line chemistry: every lineup line, defense pair and player gets a report the lockers can match."""
import json
import os
import unittest
from unittest.mock import patch

import worker
from report_schema import lineup_roster, lineup_units

LINEUP = 'Calgary lineup: LW offtheyrk, C thenny32, RW geocustom, LD WhyKayWins, RD matt_0_5, G Kudolken'
TEXT = {k: 'x' for k in ('summary', 'patterns', 'strengths', 'corrections', 'tactical_report', 'player_report',
                         'professional_writeup')}


class LineupReports(unittest.TestCase):
    def test_lineup_text_becomes_one_line_and_one_pair(self):
        roster = lineup_roster(LINEUP)
        self.assertEqual([n for _, n in roster], ['offtheyrk', 'thenny32', 'geocustom', 'WhyKayWins', 'matt_0_5', 'Kudolken'])
        self.assertEqual([(u['type'], u['players']) for u in lineup_units(roster)],
                         [('line', ['offtheyrk', 'thenny32', 'geocustom']), ('defense_pair', ['WhyKayWins', 'matt_0_5'])])
        self.assertEqual(lineup_roster('Oct 6 stream, Game 1: THREE regulation periods plus one real overtime.'), [])

    def test_gamertags_with_spaces_and_a_trailing_sentence(self):
        wed = 'Calgary lineup: LW l Setty l, C l Richy 19 l, RW RipTopRight, LD imona_plain, RD BxbbyBxnds, G XxPASTRNAK88'
        self.assertEqual([n for _, n in lineup_roster(wed)],
                         ['l Setty l', 'l Richy 19 l', 'RipTopRight', 'imona_plain', 'BxbbyBxnds', 'XxPASTRNAK88'])
        self.assertEqual(lineup_roster(LINEUP + '. Analyze all three regulation periods, keep timestamps.')[-1], ('G', 'Kudolken'))

    def rollup(self, lineup):
        sent = []
        chunk = {'label': 'Period 1', 'start': 0, 'end': 120, 'review': {'summary': 's', 'observations': [
            {'timestamp': 10, 'source': 'gameplay', 'player': 'THENNY32', 'note': 'n'},
            {'timestamp': 40, 'source': 'gameplay', 'player': 'geocustom', 'note': 'n'}]}}
        model = {**TEXT, 'player_reports': [{'player': 'THENNY32', 'strengths': 'Support', 'evidence_timestamps': [10]},
                                            {'player': 'Opponent Guy', 'strengths': 'x', 'evidence_timestamps': []}],
                 'unit_reports': [{'label': 'Top', 'type': 'line', 'players': ['thenny32', 'geocustom'], 'summary': 'Pair'}]}
        def fake(step, payload, parse, escalate=True):
            sent.append(payload)
            return parse({'status': 'completed', 'output': [{'content': [{'type': 'output_text', 'text': json.dumps(model)}]}]}), None
        with patch.object(worker, 'ai_configured', return_value=True), patch.object(worker, 'request_routed', side_effect=fake):
            return worker.build_rollup([chunk], step='game_rollup', lineup=lineup), sent

    def test_game_report_names_every_lineup_player_and_unit(self):
        report, sent = self.rollup(LINEUP)
        prompt = sent[0]['input'][0]['content'][0]['text']
        self.assertIn('TEAM LINEUP', prompt)
        self.assertIn('LD WhyKayWins, RD matt_0_5', prompt)
        self.assertIn('at most 4 unit_reports', prompt)
        players = [p['player'] for p in report['player_reports']]
        self.assertEqual(sorted(players), sorted(['thenny32', 'offtheyrk', 'geocustom', 'WhyKayWins', 'matt_0_5', 'Kudolken']))
        self.assertNotIn('Opponent Guy', players)  # opponents never get a locker report
        self.assertEqual(report['player_reports'][0]['player'], 'thenny32')  # verbatim gamertag for the locker
        units = {tuple(u['players']) for u in report['unit_reports']}
        self.assertIn(('offtheyrk', 'thenny32', 'geocustom'), units)
        self.assertIn(('WhyKayWins', 'matt_0_5'), units)
        thin = [u for u in report['unit_reports'] if u['players'] == ['WhyKayWins', 'matt_0_5']][0]
        self.assertEqual(thin['summary'], 'Insufficient evidence this game')
        self.assertIsNone(thin['rating']['score'])

    def test_lineup_sized_caps_survive_the_smallest_budget(self):
        text = worker.output_budget(0.15, 14, lineup_units=2, lineup_players=6)
        self.assertIn('at most 2 unit_reports and 6 player_reports', text)

    def test_without_a_lineup_nothing_is_invented(self):
        report, sent = self.rollup('')
        self.assertNotIn('TEAM LINEUP (identity', sent[0]['input'][0]['content'][0]['text'])
        self.assertEqual([p['player'] for p in report['player_reports']], ['THENNY32'])


if __name__ == '__main__':
    unittest.main()
