# LGCHL league feed (S55): live ticker + War Room

Status: **live in Supabase** (project `lrgllzvwgvqagcpiyvfd`, applied 2026-10-04). The site side is on
branch `feature/live-ticker` and is not deployed yet.

## Pipeline
```
pg_cron ──▶ private.lgchl_kick_sync(mode) ──pg_net──▶ Edge Function lgchl-league-sync ──▶ LeagueGaming
                                                              │ (service role upserts)
             public.lgchl_teams · lgchl_games · lgchl_standings_snapshots · lgchl_sync_runs
                         │ public read-only views
             lgchl_standings_current · lgchl_games_board (big_game flag)
                         │ PostgREST + publishable key
             api/lgchl-scores.js (Vercel, no LG traffic) ──▶ live-ticker.js   ·   War Room landing
```

### Supabase objects
* **Migrations**
  * `lgchl_league_feed`: tables, views, RLS, trigger, kick function.
  * `lgchl_league_sync_schedule`: cron jobs.
  * Copies are in `supabase/migrations/`.
* **Tables**
  * `lgchl_teams` (62 rows): abbr, nickname, league, conference, division, logo path.
  * `lgchl_games` (2,046 rows): `lg_game_id` PK; away/home LG team ids; scores; `status`
    (scheduled/final/postponed/cancelled); `game_at` (UTC, parsed from LG's US Eastern labels);
    `source_url`.
    * `decided_in` (REG/OT/SO) exists but is null. Schedule pages don't show OT.
    * A trigger stops a final from ever being downgraded.
  * `lgchl_standings_snapshots`: a new row only when a team's standings line changes.
  * `lgchl_sync_runs`: run log and resume cursor. Service role only; no policies.
* **RLS**
  * Enabled on all four tables.
  * SELECT is open to anon + authenticated on teams, games and standings snapshots.
  * Writes are service role only. anon INSERT returns 401; anon `lgchl_sync_runs` returns 401.
  * Views use `security_invoker = true`.
* **Function**: `lgchl-league-sync` (`verify_jwt=false`, custom `x-sync-token` check)
  * Uses the same token and fetch pattern as `lg-stats-sync`: plain GET, identified User-Agent,
    one request at a time with a 1.5 s pause.
  * Stops and records the error if LG returns a Cloudflare challenge. We do not try to bypass it.
  * Source: `supabase/functions/lgchl-league-sync/`. Parsers are in `lib.ts`, which is pure and
    tested against saved HTML.
* **Schedule** (pg_cron, as postgres)
  | job | cron | does |
  |---|---|---|
  | `lgchl-league-full` | `15 */6 * * *` | standings + all 62 team schedule pages (64 LG requests, about 12 MB, ~5 min across 2 calls) |
  | `lgchl-league-delta` | `*/10 0-5,23 * * 0,1,2,3` | only when games started 35 min+ ago (within 8 h) have no score: re-reads the fewest team pages that cover them (greedy vertex cover, ≤34 pages for a 93-game night), then standings |
  | `lgchl-league-worker` | `*/3 * * * *` | resumes a running refresh after its 100 s call budget. Pure SQL check, no request when idle |

### Big games (OHL / QMJHL)
The rule is computed live in `lgchl_games_board` from `lgchl_standings_current`. Teams are ranked
in their conference by PTS, then GD, then GF. A game is `big_game` when ANY of these is true
(`big_reasons` lists which):
* `top4_clash`: both teams are top 4 in their conference.
* `leader_chase`: one team leads the conference and the other is within 2 PTS of it.
* `division_race`: same division, both in the top half of the conference, within 1 PT of each other.

Notes:
* The rule uses **current** standings, so past finals are re-judged as the standings move.
* On 2026-10-04 it picks 9 of the 57 OHL/QMJHL games tonight: OHL 4, QMJHL 5.

### Site API: `GET /api/lgchl-scores`
* `view=ticker` (default): `last_night`, `today`, and `next_night` when today is empty.
  * `scope=featured` (default): all WHL games + OHL/QMJHL `big_game`. Other scopes: `whl`, `big`, `all`.
  * Calgary Hitmen games are excluded (the Hitmen block shows them). Pass `hitmen=1` to include them.
  * About 32 KB. CDN `s-maxage=120`.
* `view=season`: all 2,046 games with `big`, plus standings and teams. For the War Room landing crawl.
* `view=standings`.
* Reads use the publishable key only, with a 60 s in-memory cache that falls back to the last good
  copy. Vercel never contacts LG.

### Ticker (`live-ticker.js`)
* Order: Hitmen rail first, then the `LGCHL · League scores` plate, then the league section:
  * finals by league: "WHL · Tue, Sep 29 · Final", "OHL big games · …";
  * in progress / awaiting;
  * tonight's slate by time slot.
* `data-league` on the script tag: `featured` (default) | `whl` | `big` | `all` | `off`.

## Operations
* **Health**: `select * from lgchl_sync_runs order by id desc limit 5;`. Look at `error` and `pages_failed`.
* **Manual run** (SQL editor): `select private.lgchl_kick_sync('full');`
* **Pause**: `select cron.alter_job(job_id, active := false) from cron.job where jobname like 'lgchl-%';`

## Hitmen block (`GET /api/live-ticker`)
Since 2026-10-04 the Hitmen block reads the same public views, so it needs no service key or session:
* **Games**: `lgchl_games_board` rows where LG team 412 is the away or home team (66 games).
* **Record**: the official LG standings line from `lgchl_standings_current` (W-L-OTL; W includes OT wins).
* **Streak and last 5**: worked out from the finals.

The old staff-only read of `hitmen_schedule_games` is retired. A read-only diff of the two sources:
* Same 66 games, times, weeks, home/away, statuses and scores.
* `hitmen_schedule_games` has no postponed/cancelled rows and no OT flags, and only 3 of its 9 finals
  have an LG link.
* LG spells two names differently: "Chicoutimi Sagueneens" and "Tri City Americans".

Gap: LG schedule rows have no OT flag. Per-game results therefore show W/L only, but the record
still counts OTL correctly because it comes from the standings.
