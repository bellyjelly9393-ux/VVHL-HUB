# Scheduled opponent scouting refresh

The existing Season 55 schedule determines which opponents are pulled. Opponents with games in the next eight days are processed first, followed by all other remaining scheduled/postponed opponents. Refreshes stop when there are no future games.

Automatic runs: **Sunday, Monday, Tuesday and Saturday, 11:30 p.m. America/New_York**. Sunday to Tuesday are the game nights, so each night gets a fresh pull of LG player stats, rosters and EA shot-location totals right after the games (each pull also saves a shot-history snapshot, so changes between nights show up as new shots per player). The database converts local time on each lightweight two-minute tick, including daylight-saving changes. A unique local-date run key prevents duplicate scheduled runs. Management can also use **Refresh Opponent Stats** on `hitmen-opponents.html`; repeated clicks join an active run.

The existing LG stats importer fetches current Season 55 regular-season skater and goalie data. The opponent worker links it to current rosters by LG user ID, with an exact gamertag fallback only when no ID is available. Historical gamertag changes, partial sources, source dates and unmatched players remain visible. Missing numbers are null, not invented zeros. Goalie save percentage is displayed on a 0–100 scale.

The worker also retrieves LG rosters and the already-linked EA club feeds (members, club/season information and private, regular and playoff match logs). EA club results are not automatically treated as league games. LG player season totals can include earlier teams after a trade and must not be summed into team standings. Public APIs may refuse requests or omit stats; coverage and original source dates are retained.

Each successful pull preserves a dated source snapshot in the existing scouting tables. Roster snapshots include observed arrivals and departures; these do not establish that a trade happened. Incomplete teams, duplicate identities and suspicious roster shrinkage preserve the previous roster. Management line assignments and scouting notes are not overwritten. The legacy manual roster button uses the same safer transaction.

The existing ChelScout pregame/GM context reads these source snapshots, player stats, current personnel and Calgary matchup history. This refresh does not automatically publish AI conclusions or reinterpret raw statistics as reviewed film evidence. Use **Generate Pregame Report** after checking freshness; previously saved reports remain unchanged.

## Operations

- SQL: `docs/sql/opponent_refresh.sql` (already uses established `lg_sync_settings` token, never exposed to clients).
- Edge Function: `supabase/functions/hitmen-opponent-refresh/index.ts`, bundled with `lib/opponent-refresh.mjs`.
- Function gateway JWT verification is off because the function validates the existing private `x-sync-token` before processing. Queue requests use the management-only database RPC. Claim/commit RPCs are service-only.
- A worker claims at most three tasks per batch, uses leases, retries failed sources up to three times, and commits snapshots and current stats atomically. Failed sources leave prior evidence intact. A stale worker cannot commit after its lease is replaced.
- `hitmen_opponent_refresh_runs` and `hitmen_opponent_refresh_tasks` provide durable progress and per-source failures. Read access follows existing Calgary team access rules; clients cannot write those tables directly.
- Local tests: `node --test test-opponent-refresh.mjs`. CI additionally checks Deno, existing VOD/ChelScout regressions and desktop/mobile dashboard behavior. SQL rollback checks exercise auth and incomplete-roster protection without committing test changes.

No new AI provider keys, login flows or changes to the VOD worker are required.
