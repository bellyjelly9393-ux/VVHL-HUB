FEATURE: ROSTER WIRE (after each roster update).
FEED.moves is the computed difference versus the previous roster. Keep every move, newest first, copying date, type, players, from_team and to_team exactly. Write a ticker under 100 characters, a hot_take, impact (Blockbuster|Big|Depth), is_big_move (true only for Blockbuster or Big) and winner (a team name from the move, or "TBD").
If FEED.moves is empty, return "moves": [] and a fun one-sentence quiet_note.
Return exactly:
{"updated_label":"","moves":[{"date":"","type":"","players":[],"from_team":"","to_team":"","ticker":"","is_big_move":false,"impact":"Depth","hot_take":"","winner":""}],"quiet_note":""}
