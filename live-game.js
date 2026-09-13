const LIVE_FEED_URL = 'https://lrgllzvwgvqagcpiyvfd.supabase.co/functions/v1/wildman-live-feed';
const REFRESH_MS = 20000;

function esc(value='') {
  return String(value).replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
}

function statusLabel(status) {
  return ({scheduled:'UPCOMING',pregame:'PREGAME',live:'LIVE',intermission:'INTERMISSION',final:'FINAL',postponed:'POSTPONED',cancelled:'CANCELLED'})[status] || 'PRE-EVENT';
}

function formatStage(game) {
  return [game?.stage, game?.round_label].filter(Boolean).join(' · ') || 'Tournament';
}

function chooseGame(games=[]) {
  for (const state of ['live','intermission','pregame']) {
    const g = games.find(x => x.status === state);
    if (g) return g;
  }
  const now = Date.now();
  const upcoming = games.filter(g => g.scheduled_at && ['scheduled','pregame'].includes(g.status) && new Date(g.scheduled_at).getTime() >= now).sort((a,b) => new Date(a.scheduled_at)-new Date(b.scheduled_at));
  if (upcoming[0]) return upcoming[0];
  return [...games].filter(g => g.status === 'final').sort((a,b) => new Date(b.scheduled_at)-new Date(a.scheduled_at))[0] || games[0];
}

function buildStream(game={}) {
  const mount = document.querySelector('[data-live-stream]');
  if (!mount) return;
  const params = new URLSearchParams(location.search);
  const override = params.get('stream');
  let provider = game.stream_provider || 'none';
  let channel = game.stream_channel || '';
  if (override?.startsWith('twitch:')) { provider='twitch'; channel=override.slice(7); }
  if (override?.startsWith('youtube:')) { provider='youtube'; channel=override.slice(8); }

  if (provider === 'twitch' && channel) {
    const parent = encodeURIComponent(location.hostname);
    mount.innerHTML = `<iframe src="https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&parent=${parent}&autoplay=false" allowfullscreen loading="eager" title="Wildman Hockey Twitch stream"></iframe>`;
    return;
  }
  if (provider === 'youtube' && channel) {
    mount.innerHTML = `<iframe src="https://www.youtube.com/embed/${encodeURIComponent(channel)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="eager" title="Wildman Hockey live stream"></iframe>`;
    return;
  }
  mount.innerHTML = `<div class="live-stream-empty"><div class="live-play-icon">▶</div><strong>STREAM FEED READY</strong><span>The player activates automatically when a Twitch channel or YouTube video is attached to the game.</span><small>Twitch + YouTube supported</small></div>`;
}

function eventRecord(games) {
  const finals = games.filter(g => g.status === 'final');
  const w = finals.filter(g => g.wildman_score > g.opponent_score).length;
  const l = finals.filter(g => g.wildman_score < g.opponent_score).length;
  return `${w}-${l}`;
}

function eventGoalDiff(games) {
  return games.filter(g => g.status === 'final').reduce((n,g) => n + g.wildman_score - g.opponent_score, 0);
}

function renderResults(games) {
  const body = document.querySelector('[data-results-body]');
  if (!body) return;
  body.innerHTML = [...games].sort((a,b)=>new Date(a.scheduled_at)-new Date(b.scheduled_at)).map(g => {
    const date = g.scheduled_at ? new Date(g.scheduled_at).toLocaleDateString([], {month:'short',day:'numeric'}) : 'TBD';
    const final = g.status === 'final';
    const result = final ? (g.wildman_score > g.opponent_score ? 'W' : 'L') : statusLabel(g.status);
    const vod = g.vod_url ? `<a href="${esc(g.vod_url)}" target="_blank" rel="noopener">Watch</a>` : 'Pending';
    const recap = g.recap_url ? `<a href="${esc(g.recap_url)}">Breakdown</a>` : 'Pending';
    return `<tr><td>${esc(date)}</td><td>${esc(g.opponent_name || 'TBD')}</td><td>${esc(formatStage(g))}</td><td>${esc(result)}</td><td>${final ? g.wildman_score : '—'}</td><td>${final ? g.opponent_score : '—'}</td><td>${vod}</td><td>${recap}</td></tr>`;
  }).join('');
}

function renderStandings(rows=[]) {
  const body = document.querySelector('[data-standings-body]');
  if (!body) return;
  body.innerHTML = rows.length ? rows.map(r => `<tr><td>${esc(r.seed ?? '—')}</td><td>${esc(r.team_name)}</td><td>${r.games_played}</td><td>${r.wins}</td><td>${r.losses}</td><td>${r.ot_losses}</td><td>${r.goals_for}</td><td>${r.goals_against}</td><td>${r.points}</td></tr>`).join('') : '<tr><td colspan="9">Standings populate when the official group is published.</td></tr>';
}

function leaders(stats, playersById) {
  const totals = new Map();
  stats.forEach(s => {
    const t = totals.get(s.player_id) || {goals:0,assists:0,points:0};
    t.goals += s.goals || 0; t.assists += s.assists || 0; t.points += (s.goals || 0) + (s.assists || 0);
    totals.set(s.player_id,t);
  });
  return [['GOALS','goals'],['ASSISTS','assists'],['POINTS','points']].map(([stat,key]) => {
    const top = [...totals.entries()].sort((a,b)=>b[1][key]-a[1][key])[0];
    return top ? {stat,value:top[1][key],player:playersById[top[0]] || 'Wildman'} : {stat,value:0,player:'TBD'};
  });
}

async function loadLiveData() {
  try {
    const res = await fetch(LIVE_FEED_URL, {headers:{'x-wildman-site':'road-to-pro-public'}, cache:'no-store'});
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const games = data.games || [];
    const game = chooseGame(games);
    const playersById = Object.fromEntries((data.players || []).map(p => [p.id,p.gamertag]));
    const record = eventRecord(games);
    const diff = eventGoalDiff(games);

    document.querySelectorAll('[data-live-status]').forEach(el => el.textContent = statusLabel(game?.status || data.event?.status));
    document.querySelectorAll('[data-live-stage]').forEach(el => el.textContent = formatStage(game));
    document.querySelectorAll('[data-live-record]').forEach(el => el.textContent = record);
    document.querySelectorAll('[data-live-goaldiff]').forEach(el => el.textContent = diff > 0 ? `+${diff}` : String(diff));
    document.querySelectorAll('[data-live-opponent]').forEach(el => el.textContent = game?.opponent_name || 'TBD');
    document.querySelectorAll('[data-live-wildman-score]').forEach(el => el.textContent = game?.wildman_score ?? 0);
    document.querySelectorAll('[data-live-opponent-score]').forEach(el => el.textContent = game?.opponent_score ?? 0);
    document.querySelectorAll('[data-live-period]').forEach(el => el.textContent = game?.period ? `P${game.period}` : '—');
    document.querySelectorAll('[data-live-clock]').forEach(el => el.textContent = game?.clock || '—');
    document.querySelectorAll('[data-live-game-label]').forEach(el => el.textContent = game?.game_number ? `Game ${game.game_number}` : 'Next Wildman Game');

    const lineupMount = document.querySelector('[data-live-lineup]');
    if (lineupMount) {
      const rows = (data.roster || []).map(x => ({slot:x.position || x.roster_role || 'ROSTER',player:playersById[x.player_id] || 'TBD'}));
      lineupMount.innerHTML = rows.map(x => `<div class="live-lineup-row"><span>${esc(x.slot)}</span><b>${esc(x.player)}</b></div>`).join('');
    }

    const leaderMount = document.querySelector('[data-live-leaders]');
    if (leaderMount) leaderMount.innerHTML = leaders(data.stats || [], playersById).map(x => `<div class="live-leader"><span>${x.stat}</span><strong>${x.value}</strong><small>${esc(x.player)}</small></div>`).join('');

    renderResults(games);
    renderStandings(data.standings || []);
    buildStream(game || {});

    const updated = document.querySelector('[data-live-updated]');
    if (updated) updated.textContent = `Synced ${new Date(data.generated_at || Date.now()).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}`;
  } catch (err) {
    const updated = document.querySelector('[data-live-updated]');
    if (updated) updated.textContent = 'Live database temporarily unavailable';
    console.warn('Wildman live center:', err);
  }
}

loadLiveData();
setInterval(loadLiveData, REFRESH_MS);
