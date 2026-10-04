-- pg_cron schedule for the lgchl-league-sync Edge Function (pattern: lg-stats-worker -> lg_kick_worker()).
-- Full refresh every 6 h; light pending-finals check every 10 min during LG game windows
-- (games Sun-Tue 7:00-10:30 PM ET = 23:00-03:05 UTC, so Sun-Wed UTC 23:00-05:59 covers late reports);
-- the worker job resumes a multi-call refresh (a full run needs ~2 calls of ~100 s).
select cron.schedule('lgchl-league-full', '15 */6 * * *', $$select private.lgchl_kick_sync('full')$$);
select cron.schedule('lgchl-league-delta', '*/10 0-5,23 * * 0,1,2,3', $$select private.lgchl_kick_sync('delta')$$);
select cron.schedule('lgchl-league-worker', '*/3 * * * *', $$select private.lgchl_kick_sync('continue')$$);
