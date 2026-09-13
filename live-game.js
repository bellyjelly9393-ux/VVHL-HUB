const LIVE_DATA_URL = 'data/live-game.json';
const REFRESH_MS = 20000;

function esc(value='') {
  return String(value).replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
}

function buildStream(data) {
  const mount = document.querySelector('[data-live-stream]');
  if (!mount) return;

  const params = new URLSearchParams(location.search);
  const override = params.get('stream');
  let provider = data.stream?.provider || '';
  let channel = data.stream?.channel || '';
  let youtubeId = data.stream?.youtubeId || '';

  if (override?.startsWith('twitch:')) {
    provider = 'twitch';
    channel = override.slice(7);
  } else if (override?.startsWith('youtube:')) {
    provider = 'youtube';
    youtubeId = override.slice(8);
  }

  if (provider === 'twitch' && channel) {
    const parent = encodeURIComponent(location.hostname);
    mount.innerHTML = `<iframe src="https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&parent=${parent}&autoplay=false" allowfullscreen loading="eager" title="Wildman Hockey Twitch stream"></iframe>`;
    return;
  }

  if (provider === 'youtube' && youtubeId) {
    mount.innerHTML = `<iframe src="https://www.youtube.com/embed/${encodeURIComponent(youtubeId)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="eager" title="Wildman Hockey live stream"></iframe>`;
    return;
  }

  mount.innerHTML = `<div class="live-stream-empty"><div class="live-play-icon">▶</div><strong>STREAM FEED READY</strong><span>Add the Twitch channel or YouTube video ID when the broadcast is announced.</span><small>Supports Twitch and YouTube embeds.</small></div>`;
}

function renderLive(data) {
  document.querySelectorAll('[data-live-status]').forEach(el => el.textContent = data.statusLabel || 'Pre-Event');
  document.querySelectorAll('[data-live-stage]').forEach(el => el.textContent = data.stage || '—');
  document.querySelectorAll('[data-live-record]').forEach(el => el.textContent = data.record || '0-0');
  document.querySelectorAll('[data-live-goaldiff]').forEach(el => el.textContent = Number(data.goalDiff) > 0 ? `+${data.goalDiff}` : String(data.goalDiff ?? 0));
  document.querySelectorAll('[data-live-opponent]').forEach(el => el.textContent = data.opponent || 'TBD');
  document.querySelectorAll('[data-live-wildman-score]').forEach(el => el.textContent = data.wildmanScore ?? 0);
  document.querySelectorAll('[data-live-opponent-score]').forEach(el => el.textContent = data.opponentScore ?? 0);
  document.querySelectorAll('[data-live-period]').forEach(el => el.textContent = data.period || '—');
  document.querySelectorAll('[data-live-clock]').forEach(el => el.textContent = data.clock || '—');
  document.querySelectorAll('[data-live-game-label]').forEach(el => el.textContent = data.gameLabel || 'Live Game');

  const lineup = document.querySelector('[data-live-lineup]');
  if (lineup) {
    lineup.innerHTML = (data.lineup || []).map(item => `<div class="live-lineup-row"><span>${esc(item.slot)}</span><b>${esc(item.player)}</b></div>`).join('');
  }

  const leaders = document.querySelector('[data-live-leaders]');
  if (leaders) {
    leaders.innerHTML = (data.leaders || []).map(item => `<div class="live-leader"><span>${esc(item.stat)}</span><strong>${esc(item.value)}</strong><small>${esc(item.player)}</small></div>`).join('');
  }

  const updated = document.querySelector('[data-live-updated]');
  if (updated && data.updatedAt) {
    const dt = new Date(data.updatedAt);
    updated.textContent = `Updated ${dt.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'})}`;
  }

  buildStream(data);
}

async function loadLiveData() {
  try {
    const res = await fetch(`${LIVE_DATA_URL}?v=${Date.now()}`, {cache:'no-store'});
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderLive(data);
  } catch (err) {
    const updated = document.querySelector('[data-live-updated]');
    if (updated) updated.textContent = 'Live feed temporarily unavailable';
    console.warn('Live game feed:', err);
  }
}

loadLiveData();
setInterval(loadLiveData, REFRESH_MS);
