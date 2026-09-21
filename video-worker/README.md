# Wildman video scouting worker

The website and the persistent Python worker are separate deployments. A green
Vercel deployment does not mean Railway has deployed the same Git commit.
`GET /health` exposes `revision`, `reviewVersion`, actual upload cap, retention,
and configuration presence; it does not prove API billing or model access.

## Current review flow

1. Management signs into Postgame Desk, selects a game and uploads MP4/MOV directly
   to the HTTPS worker. Optional format, gamertags, period ranges and replay offset
   provide context. Blank ranges use best-effort OCR, then full-recording fallback.
2. FFmpeg validates the recording (maximum two hours and 4K). The worker reviews
   overlapping 120-second sections at a six-second frame interval. Rate-limit retries
   may increase overview spacing to 12 seconds; each chunk records its actual spacing.
3. For each chunk containing gameplay observations, a separate pass reviews at most
   one eight-second sequence at two frames/second. This pass does not receive the
   first-pass verdict. It can contradict it. It is still sampled vision, not puck tracking.
4. A synthesis pass writes seven report sections, using only supplied evidence and
   the hockey rubric in `hockey_review.py`. Uncertain identity, missing evidence,
   sparse motion and single-play observations must remain explicit. Game format
   matters; 4s should not be judged as a five-skater system.
5. Postgame Desk displays the full report and evidence. Only completed reports can
   be imported. Re-import replaces that report's bounded generated block while
   preserving surrounding notes. Save Draft persists it privately; publishing is separate.

Chunk evidence and closer passes are saved before synthesis. Retry resumes completed
work. Fresh scouting review explicitly clears old worker analysis and uses API credits;
existing saved website drafts remain unchanged. Legacy unbounded imports are preserved
rather than guessing where a user's own edits end.

## Deployment

- Railway service: `wildman-video-worker`, branch `feature/video-review-worker`, root
  `/video-worker`, Dockerfile build, one instance, persistent `/data` volume.
- Required: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `OPENAI_API_KEY`, `OPENAI_MODEL`.
  The model must support image input, Responses API and strict JSON schema.
- Auth validates the Supabase user on private requests. Explicit approved UUIDs in
  `VIDEO_REVIEW_USER_IDS`, admin/commissioner profiles or active owner/GM/AGM memberships
  can access the worker. Individual jobs remain creator-only.
- `ALLOWED_ORIGINS`: exact trusted website origins. The two named Wildman PR previews
  are included explicitly; do not replace this with a wildcard. Preflight and actual
  responses use the same acceptance rule.
- `/api/video-review-config` defaults to the existing public Railway service URL.
  `VIDEO_WORKER_URL` overrides it; an explicit empty value disables the connection.
  This URL is public configuration, not a credential.
- Check the actual cap using `/health` (the existing service was configured for
  200 MiB). Code defaults are 700 MiB upload, 1800 MiB disk and 24-hour media retention.
  Reports persist in SQLite. Back up `/data/jobs.sqlite`; monitor volume capacity.
- Keep proxy limits compatible with uploads. Configure API spend limits independently
  of this app. Never expose keys in frontend code.

Twitch replay retrieval exists via `/reviews/{id}/analyze`, using a saved review and
its authenticated access check. Mobile `/channel/v/ID` links normalize to `/videos/ID`.
Twitch may reject retrieval; local MP4 upload avoids that dependency. Postgame Desk's
replay field is a reference for its uploaded file, not a download command. For a
trimmed file, enter the original replay offset to keep evidence links accurate.
Live capture is a separate queue integration in `live_pipeline.py` requiring
`WORKER_QUEUE_SECRET` and the existing database RPCs. Neither mode is a substitute for
checking a real game's footage and report.

## Verification

```sh
python -m unittest discover -s video-worker -v
node --test test-video-review-report.cjs
node --check video-review.js
```

Tests cover real generated video extraction, HTTP upload/CORS/creator isolation,
resumable evidence and synthesis, bounded closer passes, report import completeness,
re-import preservation and replay offsets. AI responses are mocked. Real hockey
accuracy and authenticated production upload/save/reload require a real recording
and a management account; never describe these tests as proving that accuracy.
