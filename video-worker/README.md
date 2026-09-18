# Wildman Video Review — first implementation

This adds a private Video Review panel to the existing Postgame Desk, with a local
recording preview, period markers, job history, progress, timestamped observations,
and an explicit import into the existing report editor. Import never writes player
stats or publishes reports. The existing Twitch/YouTube players are preserved.

## What runs now

- Python 3.12 standard library and FFmpeg; no pip dependencies.
- Authenticated MP4/MOV upload streamed to disk (700 MiB default cap).
- SQLite job persistence; one processing thread; restart resumes completed chunks.
- 120-second analysis windows with five seconds of overlap, bounded by period ranges.
- Sparse review: one JPEG every two seconds, up to 60 frames per window at 720p.
- OpenAI Responses API adapter, requiring an image-input model with structured outputs.
- Per-chunk summaries, timestamped observations, screenshot source classification,
  uncertainty notes and recorded API token usage. Reads visible intermission screens
  opportunistically; exact extraction accuracy has NOT been established on EA footage.
- Original recording retained for 24 hours by default. Transient JPEGs removed after
  each request. Reports remain in SQLite on the persistent disk. No duplicate MP4 clips.
- Global disk budget (1,800 MiB), one upload at a time, three pending jobs at most.

## Activation requirements

1. Run this container on a host supporting a long-running process, HTTPS, and a
   persistent volume mounted at `/data`. Use **one instance / one process**. This
   worker is not a Vercel request function. Back up `/data/jobs.sqlite` (SQLite online
   backup or stop the service first) to preserve reports; retain ownership restrictions.
2. Set environment variables from `.env.example` in the host's secret settings.
   `VIDEO_REVIEW_USER_IDS` is a comma-separated list of explicitly approved Supabase
   Auth account UUIDs. JWTs are validated against `/auth/v1/user` on every private request;
   a valid login alone is insufficient. No service-role database key is needed.
3. Set `OPENAI_API_KEY` and `OPENAI_MODEL` server-side. The model must support images,
   Responses API, and strict JSON schema. API billing is separate from this chat.
   Leave unset to validate uploaded recordings without claiming analysis occurred.
   Configure API project spend limits before processing long recordings.
4. Set `ALLOWED_ORIGINS` to the exact production site origin (and any intended preview).
   Set `VIDEO_WORKER_URL=https://your-worker-host` in the existing Vercel project.
   This public URL is exposed by `/api/video-review-config`; secrets are never exposed.
5. Keep reverse-proxy upload limits/timeouts compatible with the upload cap. Apply
   connection/rate limits at the proxy. Run behind TLS; do not expose port 8080 directly.
6. Sign in to Postgame Desk with an approved management account. Choose a game,
   upload one period, check evidence accuracy, and import the results into a draft.

The container does not load `.env` by itself. Example from the repository root:

```sh
docker build -t wildman-video-review video-worker
docker run --env-file video-worker/.env -p 8080:8080 -v wildman-video-data:/data wildman-video-review
```

Configure volume permissions for the container's `worker` user when using a bind mount.

## Current boundaries

- Pasted Twitch/YouTube URLs are replay references, **not video ingestion**. Upload is
  required. No arbitrary URL downloads, cookie extraction or browser-login bypass.
- Continuous live/HLS ingestion is not implemented. Add a tested broadcaster-owned
  feed adapter after deciding on the source platform and worker host.
- Sparse screenshots are not continuous video understanding. No reliable puck tracking,
  fast-pass reconstruction, exhaustive shot counts, audio analysis or player attribution
  is promised. A higher-frame-rate second pass is not implemented yet.
- The model compares visible stats and notes but does not authoritatively reconcile
  all shots/events. Exact duplicates are removed; near duplicates require review.
- Supplied player names are context only. No automatic player-profile or official-stat
  writes. Evidence goes to the selected game's existing report draft.
- Ready reports are section-by-section evidence bundles, not a separate AI-written
  whole-game synthesis. Existing postgame editing/publishing supplies the final write-up.
- Job access is creator-only. Sharing reviews across management accounts is future work.
- Upload retries require a new job; completed processing chunks are resumable.
- Report growth counts toward disk budget; archive reports and monitor capacity over time.
- Worker hosting, production credentials, live footage QA and paid API calls are not
  provisioned by committing this code. Missing configuration is visible in the UI.

## Verification

```sh
cd video-worker
python -m unittest -v
```

Tests use generated video and a clearly mocked analyzer: real FFmpeg extraction,
period boundaries, interrupted-processing resume, access rejection, and expiry.
They do not demonstrate hockey-analysis accuracy or a working paid API connection.

References: https://ffmpeg.org/ffmpeg-filters.html,
https://developers.openai.com/api/docs/guides/images-vision,
https://developers.openai.com/api/docs/guides/structured-outputs,
https://supabase.com/docs/reference/javascript/auth-getuser.
