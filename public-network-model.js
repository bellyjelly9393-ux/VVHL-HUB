/* Shared public selectors. Canonical IDs retain all team/game/player relationships. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WildmanPublicModel = factory();
})(typeof window === 'undefined' ? globalThis : window, function() {
  const id = (rows, key) => (rows || []).find(row => String(row.id) === String(key));
  const stamp = value => { const n = Date.parse(value); return Number.isFinite(n) ? n : 0; };
  const publicEvent = event => event && event.is_public !== false && event.is_sandbox !== true;
  const events = state => (state.events || []).filter(publicEvent);
  const games = state => (state.games || []).filter(game =>
    publicEvent(id(state.events, game.event_id)) &&
    game.is_public !== false && game.is_sandbox !== true && game.not_required !== true &&
    game.source_provider !== 'hitmen-workspace' && game.source_payload?.not_required !== true);
  const upcoming = (rows, now = Date.now()) => rows.filter(g => ['scheduled','upcoming'].includes(g.status) && stamp(g.scheduled_at) >= now).sort((a,b) => stamp(a.scheduled_at)-stamp(b.scheduled_at));
  const recent = rows => rows.filter(g => g.status === 'final').sort((a,b) => stamp(b.scheduled_at)-stamp(a.scheduled_at));
  const teamGames = (state, teamId) => games(state).filter(g => g.home_team_id === teamId || g.away_team_id === teamId);
  const score = g => g.status === 'scheduled' || g.status === 'upcoming' ? 'VS' :
    g.home_score == null || g.away_score == null ? 'Score pending' : g.home_score + '–' + g.away_score;
  const lgEvent = e => /leaguegaming|\blg(?:chl|ahl|nhl)?\b/i.test([e.name,e.organizer,e.source_provider,e.league_name].filter(Boolean).join(' '));
  const lgGames = state => games(state).filter(g => lgEvent(id(state.events, g.event_id)));
  const featuredEvent = (state, configured) => id(events(state), configured) ||
    events(state).find(e => e.is_featured === true) ||
    events(state).find(e => ['live','active','registration','upcoming'].includes(e.status)) || events(state)[0];
  const provenance = row => {
    const value = [row.source_label,row.source_type,row.source_provider,row.stat_source].filter(Boolean).join(' · ');
    return value || 'Published network data · source detail unavailable';
  };
  const standings = (state, eventId) => (state.teamStats || []).filter(s => s.event_id === eventId && s.rank != null).sort((a,b) => Number(a.rank)-Number(b.rank));
  const ticker = (state, wildmanId, now = Date.now()) => {
    const live = games(state).filter(g => g.status === 'live');
    const priority = g => g.home_team_id === wildmanId || g.away_team_id === wildmanId ? 0 : lgEvent(id(state.events,g.event_id)) ? 1 : 2;
    return [...live.sort((a,b) => priority(a)-priority(b)), ...upcoming(games(state),now)].slice(0,10);
  };
  return { id, stamp, publicEvent, events, games, upcoming, recent, teamGames, score, lgEvent, lgGames, featuredEvent, provenance, standings, ticker };
});
