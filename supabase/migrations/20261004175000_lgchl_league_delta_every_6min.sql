-- Game-night pending-finals check: every 10 min -> every 6 min (same game windows).
-- Full 6-hour refresh and the resume worker are unchanged.
-- NOT YET APPLIED to production: apply only after Seth approves.
select cron.alter_job(
  job_id   := (select jobid from cron.job where jobname = 'lgchl-league-delta'),
  schedule := '*/6 0-5,23 * * 0,1,2,3'
);
