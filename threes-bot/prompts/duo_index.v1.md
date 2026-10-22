FEATURE: DUO INDEX (weekly).
The FEED already ranks eligible pairs (minimum 4 games together, at most one pair per team in the top 5). Do not re-rank and do not change any number.
For each FEED.top_duos entry copy rank, players, team, games_together, record_together, goal_diff_per_game and points_per_game exactly; add a fun nickname and a one-sentence breakdown using only FEED numbers.
odd_couple: pick from FEED.odd_couple_candidates. needs_counseling: pick from FEED.needs_counseling_candidates.
If FEED.top_duos is empty, return {"error": FEED.insufficient_reason}.
Return exactly:
{"week_label":"","top_duos":[{"rank":1,"players":["",""],"team":"","nickname":"","games_together":0,"record_together":"","goal_diff_per_game":0,"points_per_game":0,"breakdown":""}],"odd_couple":{"players":[],"team":"","note":""},"needs_counseling":{"players":[],"team":"","note":""}}
