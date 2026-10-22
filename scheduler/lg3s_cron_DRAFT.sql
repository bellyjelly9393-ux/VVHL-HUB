-- DRAFT — NOT APPLIED. Requires Seth's approval. One job, every 5 min; lg3s_tick() decides in ET (DST-safe).
-- Polls only when needed: ~2 kicks/day off-nights; on Wed/Thu/Fri ~12 polls/hour until every game is verified.
-- Each run: <= 45 LG requests at >= 2 s spacing (fetcher budget).
select cron.schedule('lg3s-tick', '*/5 * * * *', $$select private.lg3s_tick()$$);
-- Disable:  select cron.unschedule('lg3s-tick');
-- Alternative (Vercel cron) is NOT recommended: vercel.json has no crons today and this keeps LG3S off the web project.
