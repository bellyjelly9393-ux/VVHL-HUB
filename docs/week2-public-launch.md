# Week 2 public launch audit and review

## Scope and existing architecture

VVHL-HUB is a static HTML/CSS/JavaScript site with Vercel serverless endpoints; there is no package manifest, build script, TypeScript project, or configured lint task. The existing GitHub Pages workflow deploys main only. The public redesign uses that architecture rather than introducing a framework.

Audited the public home, team and player/stall destinations, esports directory, event formats and Pro Series, Game Center, Wildman/Hitmen media, Academy, published reports, network shell, public Supabase loader, backend account handling, and both admin/management restrictions. Reviewed the existing LG public stats/logo API and game-source handler.

The protected Hitmen roster, schedule, team lockers, VOD/scouting reports, and management tools remain protected. Existing public esports loader removes Calgary operations teams. This filter is retained. The new public Hitmen room links to protected team access and publishes no private player/management data.

## Changed surfaces

- Replaced homepage and Academy presentation.
- Added Wildman Battle Room, public Hitmen Room, LG Network, Tournament Hub, Competition Center, Elite CHEL Media newsroom and published story reader.
- Updated public network navigation. Private navigation is not rewritten.
- Added shared brand/editorial configuration, public selectors and presentation adapter.
- Added clean Vercel aliases without changing existing protected aliases.
- Public network client now exposes its existing client alongside its existing state and refresh method, enabling reuse rather than a second client/backend.
- No API handlers, webhook behavior, video workers, authentication guards or database schema were changed.

## Reused data and destinations

- Existing esports-network.js reads esports teams, players, memberships, event entries/rosters, games and player/team event statistics.
- The new adapter reuses that client/state, and reads only published media_posts and status=published esports_game_reports.
- Reads only the existing Hitmen team ID and logo_url from teams for the brand crest.
- Relationships use team_id, game_id, player_id and source_team_id. No display-name joins were introduced.
- Player links retain esports-player.html?id= and all existing team/stall routes.
- Published tournament reports retain postgame.html?id=game_id.
- Game Center, Twitch/YouTube playback, multiview, Mux, FFmpeg/Railway and VOD/scouting routes are reused without pipeline changes.
- The newsroom story reader escapes published text and checks publication before rendering. It renders plain text; it does not interpret embedded HTML.

## Editorial setup

Change public-network-config.js through the normal branch/review workflow:
- roomName controls the Wildman room name.
- featuredEventId accepts a canonical public event ID, with an existing featured/current event as fallback.
- gameOfWeek is null until editorial selection. Set { gameId, previewPostId } using canonical IDs. Only an already-published preview is linked; no generated selection is published automatically.
- brands.hitmen.logo may hold a supplied approved crest URL; otherwise the existing teams.logo_url is used.
- Series classification uses published source_metrics.series.
- LG stories use linked event/game IDs or explicit coverage_scope=lg / league metadata. Broad coverage is not selected around Calgary display names.

No new admin suite or editorial database writes were added.

## Missing-data states and launch limits

- Game of the Week is unannounced until an editor configures a selection.
- Hitmen official crest depends on an approved existing team logo; unavailable assets use a clearly labeled pending state, not an invented logo.
- Public Hitmen roster/schedule/record/WHL standings and league-relative ranks are unavailable until an approved public source exists. Team sign-in links still open existing protected destinations.
- LG headlines/features/standings may be empty where current published records lack league association or source ranks.
- Source-provided ranks only; no inferred league ranks, probabilities or player valuations.
- Missing scores remain pending; sample/historical/fallback provenance is retained as supplied rather than relabeled official.
- No default zero records, invented headlines, scouting conclusions, prices, partnerships or prizes.
- Static story share previews currently use the newsroom metadata. Article-specific server-rendered social metadata is a post-launch enhancement.
- Dynamic tournament section is new; existing Pro Series-specific historical/bracket page remains available as event coverage.
- Registration links/states appear only from existing event fields. There is no advanced Wildman ranking/division system.
- No membership pricing or founding offer is published.

## Validation

CI workflow performs syntax/page-target/metadata checks, existing backend tests and public data/privacy selectors, then Chromium checks at 360, 390, 768 and 1440 pixels. Screenshots are uploaded as week2-public-review.

Browser QA visits every new/replaced public route, checks menu toggling and Escape, ticker fallback and page-wide overflow, then smoke-loads existing Wildman stalls, Game Center, Hitmen Media and an anonymously locked management page. It uses actual anonymous reads, not runtime mock APIs.

Build/type/lint: static site with no existing build/type/lint commands. Vercel deployment and changed-file syntax/static checks are the available equivalents. Authenticated private account journeys and full live/video playback require manual review; no credentials or paid analytical API calls are used in UI QA.

Review before manual merge. Do not auto-merge.

## After launch

Publish broader LG editorial stories and Game of the Week; provide approved public Calgary data and crest if absent; improve per-story social metadata; add approved Academy availability/booking/membership details. Future reusable team hubs and ranking/division engines remain outside this launch.
