(() => {
  const URL='https://lrgllzvwgvqagcpiyvfd.supabase.co';
  const KEY='sb_publishable_9GD6JhLzUGgoPNtahx7eQQ_JDARGIaP';
  const db=window.supabase?.createClient(URL,KEY); if(!db)return;
  const S={teams:[],events:[],games:[],selected:new Set()};
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[c]);
  const team=id=>S.teams.find(x=>x.id===id);
  const event=id=>S.events.find(x=>x.id===id);
  const fmt=v=>v?new Date(v).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'TBD';
  function twitchChannel(raw){try{const u=new URL(raw);return u.pathname.split('/').filter(Boolean).pop()||'';}catch{return String(raw||'').split('/').filter(Boolean).pop()||'';}}
  function youtubeId(raw){try{const u=new URL(raw);if(u.hostname.includes('youtu.be'))return u.pathname.slice(1);if(u.searchParams.get('v'))return u.searchParams.get('v');const p=u.pathname.split('/').filter(Boolean),i=p.findIndex(x=>x==='embed'||x==='live');return i>=0?p[i+1]||'':'';}catch{return '';}}
  function embed(g){const p=String(g.stream_provider||'').toLowerCase();if(p==='twitch'){const ch=twitchChannel(g.stream_url);return ch?`<iframe src="https://player.twitch.tv/?channel=${encodeURIComponent(ch)}&parent=${encodeURIComponent(location.hostname)}&autoplay=false" allowfullscreen title="Twitch stream"></iframe>`:'';}if(p==='youtube'){const id=youtubeId(g.stream_url);return id?`<iframe src="https://www.youtube.com/embed/${encodeURIComponent(id)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen title="YouTube stream"></iframe>`:'';}return '';}
  function label(g){return `${team(g.home_team_id)?.name||'TBD'} vs ${team(g.away_team_id)?.name||'TBD'}`;}
  function stateText(g){if(g.status==='live')return `LIVE${g.period?` · P${g.period}`:''}${g.clock?` · ${g.clock}`:''}`;if(g.status==='final')return `FINAL · ${g.home_score}-${g.away_score}`;return fmt(g.scheduled_at);}
  function eligible(){return S.games.filter(g=>g.stream_url&&['live','scheduled'].includes(g.status)).sort((a,b)=>(a.status==='live'?0:1)-(b.status==='live'?0:1)||Number(b.featured)-Number(a.featured)||new Date(a.scheduled_at||0)-new Date(b.scheduled_at||0));}
  function setFromQuery(){const ids=(new URLSearchParams(location.search).get('games')||'').split(',').filter(Boolean);ids.slice(0,4).forEach(id=>S.selected.add(id));}
  function syncQuery(){const ids=[...S.selected];const u=new URL(location.href);if(ids.length)u.searchParams.set('games',ids.join(','));else u.searchParams.delete('games');history.replaceState(null,'',u);}
  function render(){
    const rows=eligible(),picker=$('multiviewPicker'),grid=$('multiviewGrid'),status=$('multiviewStatus');
    [...S.selected].forEach(id=>{if(!rows.some(g=>g.id===id))S.selected.delete(id);});
    if(status)status.textContent=`${S.selected.size}/4 SELECTED · ${rows.filter(g=>g.status==='live').length} LIVE`;
    if(picker)picker.innerHTML=rows.length?rows.map(g=>`<label class="multi-pick"><input type="checkbox" data-multi-id="${g.id}" ${S.selected.has(g.id)?'checked':''}><div><strong>${esc(label(g))}</strong><small>${esc(event(g.event_id)?.name||'Tournament')} · ${esc(stateText(g))} · ${esc((g.stream_provider||'stream').toUpperCase())}${g.featured?' · FEATURED':''}</small></div></label>`).join(''):'<div class="empty-state">No stream URLs are assigned yet.</div>';
    picker?.querySelectorAll('[data-multi-id]').forEach(box=>box.onchange=()=>{const id=box.dataset.multiId;if(box.checked){if(S.selected.size>=4){box.checked=false;return;}S.selected.add(id);}else S.selected.delete(id);syncQuery();render();});
    const selected=rows.filter(g=>S.selected.has(g.id));
    if(grid)grid.innerHTML=selected.length?selected.map(g=>{const e=embed(g);return `<article class="multi-tile"><div class="multi-tile-head"><div><strong>${esc(label(g))}</strong><small>${esc(stateText(g))}${g.status!=='scheduled'?` · ${g.home_score}-${g.away_score}`:''}</small></div><a class="small-btn" href="live-game.html?id=${encodeURIComponent(g.id)}">Game</a></div>${e||`<div class="featured-placeholder"><div><strong>External stream</strong><p>${esc(g.stream_provider||'Provider')} cannot be embedded here.</p><a class="btn btn-primary" href="${esc(g.stream_url)}" target="_blank" rel="noopener">Open Stream</a></div></div>`}</article>`;}).join(''):'<div class="empty-state">Select up to four games above.</div>';
    const stamp=$('liveRefreshStamp');if(stamp)stamp.textContent=`Updated ${new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit',second:'2-digit'})}`;
  }
  async function load(first=false){const [teams,events,games]=await Promise.all([db.from('esports_teams').select('*').eq('active',true),db.from('esports_events').select('*').eq('active',true),db.from('esports_games').select('*')]);if([teams,events,games].some(x=>x.error)){console.error(teams.error||events.error||games.error);return;}S.teams=teams.data||[];S.events=events.data||[];S.games=games.data||[];if(first){setFromQuery();if(!S.selected.size){eligible().filter(g=>g.status==='live').slice(0,2).forEach(g=>S.selected.add(g.id));}}render();}
  $('clearMultiview')?.addEventListener('click',()=>{S.selected.clear();syncQuery();render();});
  load(true);setInterval(()=>{if(!document.hidden)load(false);},10000);
})();