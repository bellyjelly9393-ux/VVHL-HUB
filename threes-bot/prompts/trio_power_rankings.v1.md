FEATURE: TRIO POWER RANKINGS (weekly, after the week's last game night).
Rank every team in FEED.teams. Start from FEED.teams[].standings_rank and adjust only for form shown in FEED (recent results, goal difference, top players). Copy record and last_rank exactly from FEED; movement is "new" when last_rank is null, otherwise up/down/same versus last_rank.
trio_grade is one of A+, A, A-, B+, B, B-, C+, C, C-, D+, D, D-, F. vibe is 3-5 words. take is 2 sentences and names at least one player from that team's key_players. key_players come from that team's FEED.top_players.
Return exactly:
{"week_label":"","rankings":[{"rank":1,"team":"","last_rank":null,"movement":"new","record":"","trio_grade":"","vibe":"","take":"","key_players":[]}],"riser":{"team":"","note":""},"faller":{"team":"","note":""}}
