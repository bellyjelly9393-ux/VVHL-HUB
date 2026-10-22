# Pick Your 3 — entry & scoring (PROPOSAL, not built)
Needs site code + user accounts (Supabase Auth), so deferred.
- Tables: lg3s_pick3_weeks(week, lock_at = min(scheduled_at) of the week, prices jsonb frozen from the approved pick3_preview post),
  lg3s_pick3_entries(user_id, week, picks bigint[3], total_price, created_at; unique(user_id, week)); RLS: owner insert/update while now() < lock_at.
- Validation trigger: exactly 3 distinct skaters, max 1 per nation, sum(price) <= 30, prices from the frozen week row only.
- Scoring view (after verification): per pick sum(private.lg3s_fpts(g,a,sog,hits,win)) over that week's VERIFIED games; corrections re-score automatically.
- Prompt B feed = scored results (mvp/bust/steal/picked_by_pct/weekly winner/season leader) computed in SQL; the LLM never recalculates.
- Site: entry form on lg3s-media.html (sign-in required), leaderboard read from a security_invoker view.
