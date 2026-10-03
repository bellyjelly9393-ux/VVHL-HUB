import copy
import unittest
from pathlib import Path
from unittest.mock import patch

import worker
from report_schema import verified_report


class ScoutSequenceTests(unittest.TestCase):
    def test_requests_keep_the_shared_chelscout_gm_instructions(self):
        profile = {'model': 'shared-gm-model', 'instructions': 'Evaluate support, risk and next-game adjustments.'}
        with patch.object(worker, 'ai_config', return_value=('OpenRouter', 'test', profile['model'], 'https://example.test')), \
                patch.object(worker, 'gm_profile', return_value=profile), \
                patch.object(worker, 'http_json', return_value={'status': 'completed'}) as request:
            worker.request_ai({'input': []})
            sent = request.call_args.args[2]
            self.assertEqual(sent['model'], profile['model'])
            self.assertIn(profile['instructions'], sent['instructions'])
            self.assertIn('recording timestamps', sent['instructions'])

    def chunk(self):
        return {'label': 'Period 2', 'start': 600, 'end': 720,
                'review': {'observations': [{'source': 'gameplay', 'timestamp': 640,
                                            'player': 'A', 'impact': 'negative'}]}}

    def test_streamed_sequence_uses_clip_offsets_but_keeps_game_timestamps(self):
        chunk = self.chunk()
        result = {'chunks': [chunk]}
        metadata = {'players': 'Confirmed game roster', 'previous_chunk': 'old verdict'}
        detail = {'observations': [{'source': 'gameplay', 'timestamp': 640, 'player': 'A'}]}
        with patch.object(worker, 'extract_frames', return_value=['frame']) as frames, \
                patch.object(worker, 'analyze', return_value=detail) as analyze, \
                patch.object(worker, 'update') as update, \
                patch.object(worker, 'AI_CHUNK_PAUSE', 0):
            worker.review_sequences('job', Path('/tmp/scout-fixture/source.mp4'), [chunk], metadata,
                                    result, source_offset=600, frame_size='640:360')
            self.assertEqual(frames.call_args.args[2:], (36, 44, .5, '640:360'))
            self.assertEqual(analyze.call_args.args[1]['start'], 636)
            self.assertEqual(analyze.call_args.args[1]['end'], 644)
            self.assertEqual(analyze.call_args.args[2]['players'], 'Confirmed game roster')
            self.assertNotIn('previous_chunk', analyze.call_args.args[2])
            self.assertTrue(chunk['sequence_checked'])
            self.assertEqual(chunk['sequence_review']['review'], detail)
            update.assert_called_once()
            worker.review_sequences('job', Path('/tmp/scout-fixture/source.mp4'), [chunk], metadata,
                                    result, source_offset=600)
            analyze.assert_called_once()

    def test_failed_sequence_is_retriable_without_marking_it_reviewed(self):
        chunk = self.chunk()
        with patch.object(worker, 'extract_frames', return_value=['frame']), \
                patch.object(worker, 'analyze', side_effect=worker.Problem(502, 'Try again')), \
                patch.object(worker, 'update') as update:
            with self.assertRaises(worker.Problem):
                worker.review_sequences('job', Path('/tmp/scout-fixture/source.mp4'), [chunk], {},
                                        {'chunks': [chunk]}, source_offset=600)
            self.assertNotIn('sequence_checked', chunk)
            update.assert_not_called()

    def test_closer_evidence_survives_validation_without_inflating_one_play(self):
        chunk = self.chunk()
        chunk['review']['observations'] = []
        chunk['sequence_review'] = {'start': 636, 'end': 644, 'review': {'observations': [
            {'source': 'gameplay', 'timestamp': 636, 'player': 'A'},
            {'source': 'gameplay', 'timestamp': 644, 'player': 'A'},
            {'source': 'gameplay', 'timestamp': 700, 'player': 'A'}]}}
        report = {'game_rating': {'score': 95}, 'player_reports': [
            {'player': 'A', 'rating': {'score': 95}, 'evidence_timestamps': [636, 644, 700]}]}
        actual = verified_report(report, [chunk])
        self.assertEqual(actual['player_reports'][0]['evidence_timestamps'], [636, 644])
        self.assertIsNone(actual['player_reports'][0]['rating']['score'])
        self.assertIsNone(actual['game_rating']['score'])
        second = copy.deepcopy(chunk)
        second.update(start=720, end=840)
        second['sequence_review'].update(start=756, end=764)
        second['sequence_review']['review']['observations'] = [
            {'source': 'gameplay', 'timestamp': 760, 'player': 'A'}]
        report['player_reports'][0].update(rating={'score': 70}, evidence_timestamps=[636, 760])
        actual = verified_report(report, [chunk, second])
        self.assertEqual(actual['player_reports'][0]['rating']['score'], 70)

    def test_twitch_period_review_runs_before_synthesis_and_cleanup(self):
        chunk = self.chunk()
        metadata = {'period_units': [{'label': 'Period 2', 'start': 600, 'end': 720}],
                    'period_unit_index': 0, 'replay_phase': 'analyze_periods'}
        result = {'chunks': [chunk], 'period_reports': []}
        order = []
        with patch.object(worker, 'get_job', return_value={'metadata': metadata, 'result': result}), \
                patch('pathlib.Path.exists', return_value=True), \
                patch('pathlib.Path.unlink', side_effect=lambda **k: order.append('cleanup')), \
                patch.object(worker, 'probe', return_value=120), \
                patch.object(worker, 'segments', return_value=[{'start': 0, 'end': 120}]), \
                patch.object(worker, 'update'), patch.object(worker, 'update_metadata'), \
                patch.object(worker, 'ai_configured', return_value=True), \
                patch.object(worker, 'AUTO_RELEASE_TWITCH_MEDIA', False), \
                patch.object(worker, 'review_sequences', side_effect=lambda *a, **k: order.append('closer')) as closer, \
                patch.object(worker, 'build_rollup', side_effect=lambda *a: order.append('report') or {'summary': 'Reviewed'}):
            worker.process_streamed_replay('job')
            self.assertEqual(order[:3], ['closer', 'report', 'cleanup'])
            self.assertEqual(closer.call_args.kwargs['source_offset'], 600)
            self.assertEqual(closer.call_args.args[2], [chunk])


if __name__ == '__main__':
    unittest.main()
