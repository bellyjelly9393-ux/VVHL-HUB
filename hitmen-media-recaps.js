/* Hitmen Media: published game recaps.
   Reads public.media_posts (post_type = recap, published = true, source_metrics.team = Calgary Hitmen)
   through Supabase REST with the publishable key. RLS policy "Public read published media posts"
   only exposes published rows, so drafts never show here. */
(() => {
  const API = 'https://lrgllzvwgvqagcpiyvfd.supabase.co/rest/v1/media_posts';
  const KEY = 'sb_publishable_9GD6JhLzUGgoPNtahx7eQQ_JDARGIaP';
  const FIRST = 6;
  const list = document.getElementById('hmRecapList');
  if (!list) return;
  const more = document.getElementById('hmRecapMore');
  const count = document.getElementById('hmRecapCount');

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dateLabel = m => {
    const d = m.game_date ? new Date(m.game_date + 'T12:00:00') : null;
    return d && !isNaN(d) ? d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase() : '';
  };
  // The body ends with a plain-text "Three stars" block; the card renders stars from source_metrics instead.
  const paragraphs = body => {
    const cut = body.search(/\n\s*Three stars\s*\n/i);
    return (cut >= 0 ? body.slice(0, cut) : body).split(/\n\s*\n/).map(s => s.trim()).filter(Boolean)
      // A "## Header" line may be followed directly by its paragraph; split them apart.
      .flatMap(s => { const nl = s.indexOf('\n'); return s.startsWith('## ') && nl > 0 ? [s.slice(0, nl).trim(), s.slice(nl + 1).trim()] : [s]; })
      .filter(Boolean);
  };
  const STATS = [['shots', 'Shots'], ['power_play', 'Power play'], ['zone_time', 'Zone time'], ['passing', 'Passing'], ['faceoffs', 'Faceoffs'], ['takeaways_giveaways', 'Takeaways / giveaways']];
  const sortKey = p => {
    const m = p.source_metrics || {};
    return Date.parse(m.sort_at || m.ended_utc || (m.game_date ? m.game_date + 'T23:59:59Z' : '') || p.published_at) || 0;
  };
  // Paragraphs starting with "## " are section headers inside the full recap.
  const block = x => x.startsWith('## ') ? `<h4 class="hm-recap-sub">${esc(x.slice(3))}</h4>` : `<p>${esc(x)}</p>`;

  function card(p) {
    const m = p.source_metrics || {};
    const paras = paragraphs(p.body || '');
    const ledeAt = paras.findIndex(x => !x.startsWith('## '));
    const lede = ledeAt >= 0 ? paras[ledeAt] : '';
    const result = m.result === 'W' ? 'W' : m.result === 'L' ? 'L' : m.result === 'T' ? 'T' : '';
    const stars = (m.three_stars || []).slice(0, 3).map((s, i) =>
      `<li><b>${i + 1}</b><span>${esc(s.player)}<small>${esc(s.team)}</small></span><em>${esc(s.line)}</em></li>`).join('');
    const stats = STATS.filter(([k]) => m.key_stats && m.key_stats[k])
      .map(([k, label]) => `<div><small>${label}</small><strong>${esc(m.key_stats[k])}</strong></div>`).join('');
    const rest = paras.filter((_, i) => i !== ledeAt).map(block).join('');
    const source = m.source_label || 'LeagueGaming imported data';
    const gameId = Number(m.lg_game_id);
    const officialLink = Number.isSafeInteger(gameId) && gameId > 0 ? '<a class="hm-official-game-link" target="_blank" rel="noopener noreferrer" href="https://www.leaguegaming.com/forums/index.php?leaguegaming/league&action=league&page=game&gameid=' + gameId + '">Official LeagueGaming box score →</a>' : '';
    return `<article class="hm-recap">
  <header class="hm-recap-head">
    <div class="hm-recap-meta"><span>${esc(dateLabel(m))}</span>${m.game_no ? `<span>GAME ${esc(m.game_no)}</span>` : ''}${m.record ? `<span>RECORD ${esc(m.record)}</span>` : `<span>LGCHL S${esc(m.season || 55)}</span>`}</div>
    ${m.final ? `<div class="hm-recap-score${result === 'W' ? ' is-win' : ''}">${result ? `<b>${result}</b>` : ''}<strong>${esc(m.final)}</strong></div>` : ''}
  </header>
  ${m.opponent ? `<p class="hm-recap-opp">Calgary vs ${esc(m.opponent)}</p>` : ''}
  <h3>${esc(p.title)}</h3>
  ${m.dek ? `<p class="hm-recap-dek">${esc(m.dek)}</p>` : ''}
  <p class="hm-recap-lede">${esc(lede)}</p>
  ${officialLink ? '<p class="hm-recap-source">' + officialLink + '</p>' : ''}
  ${stars ? `<div class="hm-recap-stars"><small>THREE STARS</small><ol>${stars}</ol></div>` : ''}
  ${rest || stats ? `<details class="hm-recap-more"><summary>Read full recap</summary>${rest}${stats ? `<div class="hm-recap-stats">${stats}</div><p class="hm-recap-note">Calgary listed first. Source: ${esc(source)}.</p>` : ''}</details>` : ''}
</article>`;
  }

  function render(rows) {
    rows.sort((a, b) => sortKey(b) - sortKey(a));
    if (count) count.textContent = rows.length === 1 ? '1 RECAP' : rows.length + ' RECAPS';
    if (!rows.length) {
      list.innerHTML = '<div class="hm-recap-empty">Game recaps will appear here after the next Hitmen game night.</div>';
      return;
    }
    list.innerHTML = rows.map((p, i) => card(p).replace('<article class="hm-recap"', `<article class="hm-recap"${i >= FIRST ? ' hidden' : ''}`)).join('');
    if (more && rows.length > FIRST) {
      more.hidden = false;
      more.onclick = () => { list.querySelectorAll('.hm-recap[hidden]').forEach(el => { el.hidden = false; }); more.hidden = true; };
    }
  }

  async function load() {
    const qs = [
      ['select', 'id,title,body,source_metrics,published_at'],
      ['post_type', 'eq.recap'],
      ['published', 'eq.true'],
      ['source_metrics->>team', 'eq.Calgary Hitmen'],
      ['order', 'published_at.desc'],
      ['limit', '30']
    ].map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
    try {
      const r = await fetch(`${API}?${qs}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }, cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      render(await r.json());
    } catch (e) {
      console.error('Hitmen recaps', e);
      list.innerHTML = '<div class="hm-recap-empty">Recaps could not be loaded right now. Refresh to try again.</div>';
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load); else load();
})();
