# LGCHL league feed (S55): live ticker + War Room

Status: **prototype on `feature/live-ticker`**. Not deployed. No tables exist yet. The SQL is a
draft only (`docs/sql/lgchl_games_DRAFT.sql`, not applied).

## What LeagueGaming offers
* **No league-wide schedule, scores page or JSON** for league 39. I tried `page=schedule`, `scores`,
  `league_schedule` and others; none of them list games.
* **Standings**: `index.php?leaguegaming/league&action=league&page=standing&leagueid=39&seasonid=55`
  * One request returns 62 teams in 10 division tables.
  * Columns: GP W L OTW OTL PTS STK F A GD L10 Home Away. W includes OTW.
* **Per-team full schedule**: `action=league_page&page=team_page_schedule&teamid={id}&leagueid=39&seasonid=55`
  * Each page is about 186 KB.
  * It lists all 66 games for that team: `gameid`, away team then home team, score when final,
    and the date as "Sun Oct 04 09:00pm" (US Eastern, no year), plus week headers.
* **Game page**: `page=game&gameid={id}`
  * This is the only place OT/SO shows up (as period columns). Not used yet.
* **Coverage**
  * 62 teams × 66 = 2,046 unique games (each team page shows half of every game it plays in).
  * 93 games per night, Sun–Tue. Slots run 7:00–10:30 PM ET. Week 4 has an extra slot (124 games).
* **Update cadence**
  * LG writes a score to the schedule page once the game is reported. There is no push or feed.
  * Snapshot taken 2026-10-04: last finals were 2026-09-29 (93 games). Standings GP/W match the
    schedule finals exactly, so both pages update from the same source.
* **Request cost**
  * Full refresh: 63 requests, about 12 MB.
  * Game-night delta: re-read only the teams that cover every game that has started but has no
    score yet. A greedy vertex cover needs **34 pages** for a 93-game night. About 30 pages per
    10-minute window while games finish, then zero.
* **Cloudflare**
  * curl from the box gets 200. Node's built-in fetch from the same box gets the Cloudflare
    "Just a moment" challenge (403).
  * Supabase egress does reach LG today: `lg-stats-sync` (pg_cron `lg-stats-worker`) finished 130
    jobs in the last 21 days. Its last run was 2026-10-04 03:30Z.
  * We do **not** try to get around a challenge. If LG challenges our host, the feed serves its last
    good data as `crawl: "stale"`, or a 502 when it has none.

## Prototype (this branch)
* `api/_lgchl.js`: shared fetch, parse and cache module. It is not a route; the underscore keeps
  Vercel from deploying it.
  * Parsers: `parseStandings`, `parseTeamSchedule`, `parseLgDate` (ET → UTC, handles DST, picks the
    closest year).
  * Team table `TEAM_META` (abbr + nickname for all 62 teams).
  * Cache: full crawl every 6 h; delta every 10 min only while games are pending (gives up after 8 h).
  * Polite fetching: 2 requests at a time, 250 ms apart, identifying User-Agent.
  * Fetcher is injectable (`setHtmlFetcher`) so tests can use fixtures.
* `api/lgchl-scores.js`: `GET /api/lgchl-scores?view=ticker|season|standings`
  * `ticker`: `last_night` finals, `today` (finals, live, awaiting, scheduled) and `next_night` when
    today has no games. Includes only the teams it references. About 56 KB raw / 5 KB gzip.
    CDN `s-maxage=300, stale-while-revalidate=1800`.
  * `season`: every game, plus standings and teams. Meant for the War Room landing crawl, race
    panels and standings. CDN 15 min.
  * `standings`: standings + teams.
  * Team object: `{id,name,abbr,nick,logo,league,table,record,pts}`. The War Room mockups use
    `nick`; the ticker uses `abbr`.
* `live-ticker.js`
  * Hitmen rail first: finals, next game, S55 stats.
  * Then the separator plate `LGCHL · League scores`.
  * League section: finals grouped WHL → OHL → QMJHL, in-progress/awaiting games, then tonight's
    slate grouped by time slot.
  * Polls every 5 min. Re-renders only when the data changes.
  * Opt-out / scope: `data-league="whl|ohl|qmjhl|off"` on the script tag. Default is `all`.
  * If the Hitmen feed is unavailable (signed out, no service key), the ticker shows league scores only.
* Logos: `assets/lgchl/s55/team{id}.png` (originals, 62) and `assets/lgchl/s55/48/team{id}.webp`
  (48 px, 101 KB total).

## Long-term: a table + a scheduled worker
Replace the per-request crawl with one writer and many readers:

```
pg_cron ─▶ Edge Function lgchl-league-sync ─▶ lgchl_games / lgchl_teams / lgchl_standings_snapshots
                                                     ▲                         ▲
                          api/lgchl-scores.js (reads table) ──▶ live ticker   War Room landing
```

The swap is one function. `ensureFresh()` / `view()` in `api/_lgchl.js` would become a single
PostgREST select on `lgchl_games_board`. The response shape stays the same, so `live-ticker.js`
and the War Room do not change.

### Scheduler options
| Option | Pros | Cons |
|---|---|---|
| **Supabase Edge Function + pg_cron** (recommended; also War Room PLAN §4) | Same pattern as `lg-stats-sync` / `hitmen-opponent-refresh` (x-sync-token in `lg_sync_settings`). Writes with service role inside Supabase. Proven to reach LG. No Vercel secret needed. | Deno port of the parser (it's plain JS, so a small change). Wall-clock limits per call, so the 63-page full refresh may need to be split into batches like the opponent refresh. |
| Vercel cron (`vercel.json` `crons` → `/api/lgchl-sync`) | Same JS module as the prototype, no port. | Needs `SUPABASE_SERVICE_ROLE_KEY` on Vercel. Hobby crons run at most daily (Pro: any schedule). Cron calls are public URLs, so they need a `CRON_SECRET`. Vercel egress vs Cloudflare is untested. |
| Railway worker (`wildman-video-worker`) | Long-lived, no duration limits. Can also read game pages to fill `decided_in` (OT/SO). | It's the video capture worker: we'd mix concerns and risk capture jobs. Separate deploy and monitoring. Needs the service key there too. |

Suggested cadence:
* Full refresh every 6 h. It picks up schedule changes and new standings.
* Every 10 min from 23:00 to 04:59 UTC on Sun–Wed (UTC) during game nights.
* Optional: one game-page read per new final to fill OT/SO, about 93 requests per night spread out.
  Only worth it if the War Room needs OT detail.

### Naming to settle with War Room
PLAN.md §4 used `lgchl_league_games`, `lgchl_standings_snapshots` and `lgchl_teams`. This draft
uses `lgchl_games`. Pick one name before applying anything. The columns line up:
* PLAN `away_id` / `home_id` = `away_lg_team_id` / `home_lg_team_id` here.
* PLAN `ot` = `decided_in`.

## Decisions for Seth
1. **Permission.** Is it OK to crawl LG league-wide (about 63 requests every 6 h plus about 30 per
   10 min on game nights)? Or should we ask LG for a feed or an allowlist first?
2. **Read scope.** Public read (anon) vs authenticated-only for `lgchl_*`.
3. **Where the writer runs.** Edge Function (recommended), Vercel cron, or Railway.
4. **Default ticker scope.** All 3 leagues (about 93 finals + 93 upcoming on a game night, a long
   loop) vs WHL only. Hitmen games also appear in the league section; dedupe or keep.
5. **Logos.** 62 LG team crests are committed as site assets. Confirm we're fine re-hosting them.
