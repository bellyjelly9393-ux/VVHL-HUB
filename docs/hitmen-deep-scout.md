# Hitmen deep hockey analysis

The War Room AI page keeps the deterministic database shortlist and adds Quick/Deep analysis. Exact gamertags and a management scenario define the question. Empty player selection uses up to 24 priority/bid/scouted players, explicitly not an exhaustive search. The endpoint authenticates the Supabase session and Calgary management membership before accessing private records or AI providers.

Evidence includes team-scoped reports/VOD, selected-player season history and projections, saved Calgary lineups, roster and availability. Source records and coverage are returned alongside the answer. Unmatched names and unavailable data sources are displayed. Opponent rosters supplied as scenario text remain unverified; automatic LG schedule/roster ingestion is not implemented here.

Quick uses Gemini 2.5 Flash. Deep optionally uses Gemini to organize evidence and Sonnet 4.5 with extended thinking for the final recommendation. If the evidence pass fails, Sonnet reads the original records with a visible warning. Thinking blocks are not shown or sent as evidence. A valid citation ID establishes record existence, not that its contents prove the claim; management still checks reasoning and footage.

Configure GEMINI_API_KEY and ANTHROPIC_API_KEY server-side. Optional GEMINI_SCOUT_MODEL and ANTHROPIC_SCOUT_MODEL overrides must support the corresponding thinkingBudget or manual budget_tokens request shape. Defaults deliberately use explicit compatible model families, not a floating latest alias. The Vercel function allows 120 seconds; browser timeout is 115 seconds. API usage is billed to the project's provider accounts.

Tests: node --test test-deep-scout.cjs (8 mocked integration tests). Syntax checks pass. No paid model run or authenticated live browser verification has been performed. This does not implement a mathematically exhaustive lineup optimizer, automatic roster mutations, durable conversation storage, or a verified hockey-accuracy benchmark. Availability history is bounded to 120 latest rows and saved lineups to 12; unknown constraints must remain unknown.

Before calling recommendations proven: evaluate several known games with management, measure identity mistakes and unsupported claims, check position/cap/availability constraints and whether proposed counterplays match the footage. Deeper inference alone does not establish scouting accuracy.
