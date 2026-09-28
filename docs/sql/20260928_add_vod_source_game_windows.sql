alter table public.vod_review_sessions
  add column if not exists source_start_seconds integer not null default 0,
  add column if not exists source_end_seconds integer,
  add column if not exists game_format text not null default '6s',
  add column if not exists scouting_context text;

comment on column public.vod_review_sessions.source_start_seconds is
  'Absolute start offset in the original VOD used when retrieving one game from a longer broadcast.';
comment on column public.vod_review_sessions.source_end_seconds is
  'Absolute end offset in the original VOD for ranged replay retrieval.';
comment on column public.vod_review_sessions.game_format is
  'Competitive game format supplied to the video scout, for example 6s or 4s.';
comment on column public.vod_review_sessions.scouting_context is
  'Optional lineup and player context supplied to the video scout; context only, not gameplay evidence.';
