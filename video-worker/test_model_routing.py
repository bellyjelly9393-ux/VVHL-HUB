import json, os, tempfile, unittest
from unittest.mock import patch
os.environ.setdefault('DATA_DIR', tempfile.mkdtemp())
import worker

PROFILE = {'provider': 'openrouter', 'model': 'anthropic/claude-opus-5.5', 'instructions': 'GM rules.'}
BASE = {'OPENROUTER_API_KEY': 'test', 'AI_PROVIDER': 'openrouter'}
ROUTED = {**BASE, 'VOD_MODEL_BASIC': 'google/gemini-3.8-flash',
          'VOD_MODEL_DEEP': 'anthropic/claude-sonnet-5.5'}


def review_response(timestamp=3):
    review = {'summary': 'S', 'tactical': {}, 'uncertainties': [], 'player_evaluations': [],
              'observations': [{'timestamp': timestamp, 'source': 'gameplay', 'category': 'offense',
                                'impact': 'neutral', 'note': 'n', 'player': None}]}
    return {'status': 'completed', 'output': [{'content': [{'type': 'output_text', 'text': json.dumps(review)}]}]}


def clean_env(extra):
    worker._MODEL_COOLDOWN.clear()
    keys = ('VOD_ANALYZER_MODEL', 'VOD_MODEL_BASIC', 'VOD_MODEL_DEEP', 'VOD_MODEL_FALLBACK', 'VOD_MODEL_COOLDOWN_SECONDS',
            'OPENROUTER_MODEL', 'OPENAI_API_KEY', 'OPENAI_MODEL', 'HITMEN_GM_PROFILE_URL')
    env = {k: v for k, v in os.environ.items() if k not in keys}
    env.update(extra)
    return patch.dict(os.environ, env, clear=True)


class ModelRouting(unittest.TestCase):
    def chain(self, env, step):
        with clean_env(env), patch.object(worker, 'gm_profile', return_value=PROFILE):
            return worker.step_models(step)

    def test_unset_keeps_current_shared_gm_model_everywhere(self):
        for step in worker.MODEL_TIERS:
            self.assertEqual(self.chain(BASE, step), ['anthropic/claude-opus-5.5'])

    def test_worker_only_analyzer_override_beats_profile(self):
        env = {**BASE, 'VOD_ANALYZER_MODEL': 'anthropic/claude-sonnet-5.5'}
        for step in worker.MODEL_TIERS:
            self.assertEqual(self.chain(env, step), ['anthropic/claude-sonnet-5.5'])

    def test_basic_and_deep_routing_with_default_fallback(self):
        self.assertEqual(self.chain(ROUTED, 'overview'),
                         ['google/gemini-3.8-flash', 'anthropic/claude-sonnet-5.5'])
        for step in ('sequence', 'period_rollup', 'game_rollup'):
            self.assertEqual(self.chain(ROUTED, step), ['anthropic/claude-sonnet-5.5'])
        env = {**ROUTED, 'VOD_MODEL_BASIC': 'qwen/qwen3.8-27b:free',
               'VOD_MODEL_FALLBACK': 'google/gemini-3.8-flash'}
        self.assertEqual(self.chain(env, 'overview'), ['qwen/qwen3.8-27b:free', 'google/gemini-3.8-flash'])

    def test_invalid_model_id_is_rejected(self):
        with self.assertRaises(worker.Problem):
            self.chain({**BASE, 'VOD_MODEL_BASIC': 'bad model; rm'}, 'overview')

    def test_overview_uses_basic_and_sequence_uses_deep(self):
        sent = []
        def fake(url, headers, payload):
            sent.append(payload['model'])
            return review_response()
        with clean_env(ROUTED), patch.object(worker, 'gm_profile', return_value=PROFILE), \
                patch.object(worker, 'http_json', side_effect=fake):
            first = worker.analyze([], {'start': 0, 'end': 6}, {})
            closer = worker.analyze([], {'start': 0, 'end': 6}, {}, .5, step='sequence')
        self.assertEqual(sent, ['google/gemini-3.8-flash', 'anthropic/claude-sonnet-5.5'])
        self.assertEqual((first['model'], closer['model']), tuple(sent))

    def test_free_model_rate_limit_falls_back_without_long_backoff(self):
        import io, urllib.error
        sent = []
        def fake(url, headers, payload):
            sent.append(payload['model'])
            if payload['model'].endswith(':free'):
                raise urllib.error.HTTPError(url, 429, 'limited', {}, io.BytesIO(b'{}'))
            return review_response()
        env = {**ROUTED, 'VOD_MODEL_BASIC': 'qwen/qwen3.8-27b:free'}
        with clean_env(env), patch.object(worker, 'gm_profile', return_value=PROFILE), \
                patch.object(worker, 'http_json', side_effect=fake), \
                patch.object(worker.STOP, 'wait', return_value=False) as wait:
            review = worker.analyze([], {'start': 0, 'end': 6}, {})
        self.assertEqual(sent, ['qwen/qwen3.8-27b:free', 'anthropic/claude-sonnet-5.5'])
        self.assertEqual(review['model'], 'anthropic/claude-sonnet-5.5')
        wait.assert_not_called()

    def test_invalid_output_from_basic_model_falls_back(self):
        bad = {'status': 'completed', 'output': [{'content': [{'type': 'output_text', 'text': 'not json'}]}]}
        responses = iter([bad, review_response()])
        with clean_env(ROUTED), patch.object(worker, 'gm_profile', return_value=PROFILE), \
                patch.object(worker, 'http_json', side_effect=lambda *a: next(responses)):
            self.assertEqual(worker.analyze([], {'start': 0, 'end': 6}, {})['model'], 'anthropic/claude-sonnet-5.5')

    def test_billing_errors_never_fall_back(self):
        import io, urllib.error
        sent = []
        def fake(url, headers, payload):
            sent.append(payload['model'])
            raise urllib.error.HTTPError(url, 402, 'pay', {}, io.BytesIO(b'{}'))
        with clean_env(ROUTED), patch.object(worker, 'gm_profile', return_value=PROFILE), \
                patch.object(worker, 'http_json', side_effect=fake):
            with self.assertRaises(worker.Problem) as caught:
                worker.analyze([], {'start': 0, 'end': 6}, {})
        self.assertEqual(caught.exception.status, 402)
        self.assertEqual(sent, ['google/gemini-3.8-flash'])

    def test_deep_step_has_no_fallback(self):
        sent = []
        def fake(url, headers, payload):
            sent.append(payload['model'])
            return {'status': 'completed', 'output': []}
        with clean_env(ROUTED), patch.object(worker, 'gm_profile', return_value=PROFILE), \
                patch.object(worker, 'http_json', side_effect=fake):
            with self.assertRaises(worker.Problem):
                worker.build_rollup([{'review': {'summary': 'x'}}], step='period_rollup')
        self.assertEqual(sent, ['anthropic/claude-sonnet-5.5'])

    def test_profile_instructions_still_sent_to_routed_models(self):
        with clean_env(ROUTED), patch.object(worker, 'gm_profile', return_value=PROFILE), \
                patch.object(worker, 'http_json', return_value=review_response()) as request:
            worker.analyze([], {'start': 0, 'end': 6}, {})
        self.assertIn('GM rules.', request.call_args.args[2]['instructions'])

    FREE = {**BASE, 'VOD_MODEL_BASIC': 'qwen/qwen3.8-27b:free, dots-studio/dots-3-note-preview:free',
            'VOD_MODEL_FALLBACK': 'google/gemini-3.8-flash', 'VOD_MODEL_DEEP': 'anthropic/claude-sonnet-5.5'}

    def test_comma_list_rotates_free_models_then_paid_fallback(self):
        self.assertEqual(self.chain(self.FREE, 'overview'),
                         ['qwen/qwen3.8-27b:free', 'dots-studio/dots-3-note-preview:free', 'google/gemini-3.8-flash'])
        self.assertEqual(self.chain(self.FREE, 'sequence'), ['anthropic/claude-sonnet-5.5'])
        with self.assertRaises(worker.Problem):
            self.chain({**self.FREE, 'VOD_MODEL_DEEP': 'a/b,c/d'}, 'sequence')
        with self.assertRaises(worker.Problem):
            self.chain({**self.FREE, 'VOD_MODEL_BASIC': 'qwen/qwen3.8-27b:free,bad id'}, 'overview')

    def test_each_free_model_tried_in_order_then_cooldown_skips_limited_one(self):
        import io, urllib.error
        sent = []
        def fake(url, headers, payload):
            sent.append(payload['model'])
            if payload['model'] == 'qwen/qwen3.8-27b:free':
                raise urllib.error.HTTPError(url, 429, 'limited', {}, io.BytesIO(b'{}'))
            if payload['model'] == 'dots-studio/dots-3-note-preview:free':
                return {'status': 'completed', 'output': [{'content': [{'type': 'output_text', 'text': '{'}]}]}
            return review_response()
        with clean_env(self.FREE), patch.object(worker, 'gm_profile', return_value=PROFILE), \
                patch.object(worker, 'http_json', side_effect=fake), \
                patch.object(worker.STOP, 'wait', return_value=False) as wait:
            first = worker.analyze([], {'start': 0, 'end': 6}, {})
            second = worker.analyze([], {'start': 0, 'end': 6}, {})
        self.assertEqual(sent, ['qwen/qwen3.8-27b:free', 'dots-studio/dots-3-note-preview:free', 'google/gemini-3.8-flash',
                                'dots-studio/dots-3-note-preview:free', 'google/gemini-3.8-flash'])
        self.assertEqual((first['model'], second['model']), ('google/gemini-3.8-flash',) * 2)
        wait.assert_not_called()

    def test_402_on_free_list_stops_without_trying_paid_fallback(self):
        import io, urllib.error
        sent = []
        def fake(url, headers, payload):
            sent.append(payload['model'])
            raise urllib.error.HTTPError(url, 402, 'pay', {}, io.BytesIO(b'{}'))
        with clean_env(self.FREE), patch.object(worker, 'gm_profile', return_value=PROFILE), \
                patch.object(worker, 'http_json', side_effect=fake):
            with self.assertRaises(worker.Problem) as caught:
                worker.analyze([], {'start': 0, 'end': 6}, {})
        self.assertEqual(caught.exception.status, 402)
        self.assertEqual(sent, ['qwen/qwen3.8-27b:free'])


if __name__ == '__main__':
    unittest.main()
