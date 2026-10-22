FEATURE: PICK YOUR 3 — PROMPT A (prices + preview).
Rules for readers: pick 3 skaters, max 1 per team, $30 cap. Scoring: goal 3, assist 2, shot on goal 0.5, hit 0.25, team win 1, hat trick +3. Picks lock at the week's first puck drop.
Prices are already set in FEED.players (computed from points per game first, then the last 3 games, then matchup when available). Copy player, team, price, opponents and is_value_pick exactly. Write a short note per player and a punchy intro that mentions the $30 cap.
Return exactly:
{"week_label":"","intro":"","players":[{"player":"","team":"","price":0,"opponents":[],"is_value_pick":false,"note":""}]}
