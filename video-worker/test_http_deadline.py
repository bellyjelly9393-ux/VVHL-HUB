import json
import unittest
from unittest.mock import patch

import worker


class TrickleResponse:
    """A provider that keeps the socket alive with whitespace and never finishes."""
    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self, size):
        return b' '


class FinishedResponse(TrickleResponse):
    def __init__(self, payload):
        self.data = json.dumps(payload).encode()

    def read(self, size):
        chunk, self.data = self.data[:size], self.data[size:]
        return chunk


class HttpDeadlineTests(unittest.TestCase):
    def test_keepalive_trickle_cannot_hang_forever(self):
        clock = iter(range(0, 10**6, 5))  # each read advances 5 seconds
        with patch.object(worker.urllib.request, 'urlopen', return_value=TrickleResponse()), \
                patch.object(worker.time, 'monotonic', side_effect=lambda: next(clock)):
            with self.assertRaises(TimeoutError):
                worker.http_json('https://example.test', {}, {'x': 1}, deadline=60)

    def test_normal_response_is_parsed(self):
        with patch.object(worker.urllib.request, 'urlopen',
                          return_value=FinishedResponse({'status': 'completed'})):
            self.assertEqual(worker.http_json('https://example.test', {}), {'status': 'completed'})

    def test_deadline_is_retried_like_a_network_timeout(self):
        calls = []
        def stuck_then_ok(url, headers, payload=None):
            calls.append(1)
            if len(calls) == 1:
                raise TimeoutError('request exceeded its total deadline')
            return {'status': 'completed'}
        with patch.dict('os.environ', {'OPENAI_API_KEY': 'k', 'OPENAI_MODEL': 'm', 'AI_PROVIDER': 'openai'}), \
                patch.object(worker, 'gm_profile', return_value=None), \
                patch.object(worker, 'http_json', side_effect=stuck_then_ok), \
                patch.object(worker.STOP, 'wait', return_value=False):
            self.assertEqual(worker.request_ai({'max_output_tokens': 100})['status'], 'completed')
        self.assertEqual(len(calls), 2)


if __name__ == '__main__':
    unittest.main()
