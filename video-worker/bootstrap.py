"""Starts the existing VOD worker plus automatic live-stream ingestion."""
import json
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
                'reviewVersion': worker.REVIEW_VERSION,
                'revision': os.getenv('RAILWAY_GIT_COMMIT_SHA', 'unknown'),
                'frameStepSeconds': worker.FRAME_STEP,
                'retentionHours': worker.RETENTION / 3600,
                'aiConfigured': worker.ai_configured(),
                'aiProvider': worker.ai_config()[0],
                'aiModel': worker.ai_config()[2],
                'aiModelRouting': worker.model_routing(),
                'maxUploadBytes': worker.MAX_UPLOAD,
                'maxActiveJobs': worker.MAX_ACTIVE_JOBS,
                'autoReleaseTwitchMedia': worker.AUTO_RELEASE_TWITCH_MEDIA,
                'replayAdminEnabled': bool(worker.REPLAY_ADMIN_TOKEN),
                'storage': worker.storage_status(),
                'liveIngestion': live_pipeline.configured(),
                'liveProvider': 'twitch' if live_pipeline.configured() else None,
                'replayRetrieval': 'twitch',
                'twitchAuthConfigured': replay.twitch_auth_configured(),
            })
        return super().dispatch()


def main():
    worker.initialize()
    try:  # which model each step will use (model names only, never keys)
        print('VOD model routing:', json.dumps(worker.model_routing()), flush=True)
    except Exception as exc:
        print(f'VOD model routing unavailable: {type(exc).__name__}', flush=True)
    worker.confirm_overtime_jobs()
    worker.resume_listed_jobs()
    seeded = replay.seed_replay_test_batch()
    replay.start_seed_status_monitor(seeded)
    threading.Thread(target=worker.work_loop, daemon=True, name='wildman-vod-review').start()
    live_pipeline.start()
    ThreadingHTTPServer(('0.0.0.0', int(os.getenv('PORT', '8080'))), Handler).serve_forever()


if __name__ == '__main__':
    main()

