"""Starts the existing VOD worker plus automatic live-stream ingestion."""
import os
import threading
from http.server import ThreadingHTTPServer
from urllib.parse import urlsplit

import worker
import live_pipeline
import replay


class Handler(worker.Handler):
    def dispatch(self):
        path = urlsplit(self.path).path.rstrip('/')
        if path == '/health' and self.command == 'GET':
            return self.reply(200, {
                'status': 'ok',
                'aiConfigured': bool(os.getenv('OPENAI_API_KEY') and os.getenv('OPENAI_MODEL')),
                'maxUploadBytes': worker.MAX_UPLOAD,
                'liveIngestion': live_pipeline.configured(),
                'liveProvider': 'twitch' if live_pipeline.configured() else None,
                'replayRetrieval': 'twitch',
                'twitchAuthConfigured': replay.twitch_auth_configured(),
            })
        return super().dispatch()


def main():
    worker.initialize()
    threading.Thread(target=worker.work_loop, daemon=True, name='wildman-vod-review').start()
    live_pipeline.start()
    ThreadingHTTPServer(('0.0.0.0', int(os.getenv('PORT', '8080'))), Handler).serve_forever()


if __name__ == '__main__':
    main()
