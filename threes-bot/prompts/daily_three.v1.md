FEATURE: DAILY THREE (morning after a game night).
Pick exactly three items from the FEED for FEED.date:
1. slot "performer": the night's best individual performance (use FEED.top_performers). stat_line must be copied from that player's stat_line.
2. slot "stat": one striking number from FEED.notable_stats; stat_value copied exactly, subject is the player or team it belongs to.
3. slot "storyline": a team/standings storyline from FEED.storylines; list the teams and players it involves.
Blurbs are 2-3 sentences. tagline under 12 words.
Return exactly:
{"date":"","tagline":"","items":[{"slot":"performer","headline":"","blurb":"","player":"","team":"","stat_line":""},{"slot":"stat","headline":"","blurb":"","stat_value":"","subject":""},{"slot":"storyline","headline":"","blurb":"","teams":[],"players":[]}]}
