/* Hitmen Media Room: published team announcements and nightly wire. */
(() => {
  const API='https://lrgllzvwgvqagcpiyvfd.supabase.co/rest/v1/media_posts';
  const KEY='sb_publishable_9GD6JhLzUGgoPNtahx7eQQ_JDARGIaP';
  const lead=document.getElementById('hmRoomLead');
  const list=document.getElementById('hmRoomUpdates');
  const status=document.getElementById('hmRoomStatus');
  if(!lead||!list)return;

  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const sortKey=p=>Date.parse(p.source_metrics?.sort_at||p.published_at||p.created_at)||0;
  const dateLabel=v=>{const d=v?new Date(v+'T12:00:00'):null;return d&&!isNaN(d)?d.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'}).toUpperCase():'TEAM UPDATE'};

  function leadCard(p,finals){
    const m=p?.source_metrics||{};
    const leaders=(m.night_leaders||[]).slice(0,3).map(x=>'<div class="hm-room-leader"><b>'+esc(x.player)+'</b><span>'+esc(x.line)+'</span></div>').join('');
    const games=finals.map(x=>{const a=x.source_metrics||{};return '<span>'+esc((a.result||'')+' '+(a.final||''))+' · '+esc(a.opponent||'Opponent')+'</span>'}).join('');
    return '<article class="hm-room-night"><div><div class="hm-room-kicker">'+esc(dateLabel(m.game_date))+' · NIGHT WRAP</div><h3>'+esc(p?.title||'Hitmen Media Room')+'</h3><p>'+esc(p?.body||'Latest Calgary Hitmen game-night updates will appear here.')+'</p><div class="hm-room-games">'+games+'</div><div class="hm-room-leaders">'+leaders+'</div></div><div class="hm-room-record"><div><small>NIGHT</small><b>'+esc(m.night_record||'—')+'</b></div><div><small>SEASON</small><b>'+esc(m.record||'—')+'</b></div></div></article>';
  }

  function card(p){
    const m=p.source_metrics||{};
    const win=m.result==='W';
    return '<article class="hm-room-card"><header><small>'+esc(dateLabel(m.game_date))+(m.game_no?' · GAME '+esc(m.game_no):'')+'</small><span class="hm-room-result'+(win?' is-win':'')+'">'+esc((m.result||'')+' '+(m.final||''))+'</span></header><h3>'+esc(p.title)+'</h3><p>'+esc(p.body)+'</p><footer><span>LGCHL S55</span><span>PLAYER STALLS LINKED</span><span>VOD '+esc(String(m.vod_status||'PENDING').toUpperCase())+'</span></footer></article>';
  }

  async function load(){
    const qs=[
      ['select','id,title,body,post_type,source_metrics,published_at,created_at'],
      ['post_type','eq.announcement'],
      ['published','eq.true'],
      ['source_metrics->>team','eq.Calgary Hitmen'],
      ['order','published_at.desc'],
      ['limit','24']
    ].map(([k,v])=>encodeURIComponent(k)+'='+encodeURIComponent(v)).join('&');
    try{
      const r=await fetch(API+'?'+qs,{headers:{apikey:KEY,Authorization:'Bearer '+KEY},cache:'no-store'});
      if(!r.ok)throw new Error('HTTP '+r.status);
      const rows=(await r.json()).filter(p=>String(p.source_metrics?.media_key||'').startsWith('hitmen-')).sort((a,b)=>sortKey(b)-sortKey(a));
      const wrap=rows.find(p=>String(p.source_metrics?.media_key||'').includes('night-wrap'))||rows[0];
      const key=wrap?.source_metrics?.game_date;
      const finals=rows.filter(p=>p!==wrap&&p.source_metrics?.game_date===key&&p.source_metrics?.final).sort((a,b)=>sortKey(a)-sortKey(b));
      lead.innerHTML=leadCard(wrap,finals);
      list.innerHTML=finals.length?finals.map(card).join(''):'<div class="hm-recap-empty">Final game updates will appear here as the desk publishes them.</div>';
      if(status)status.textContent=wrap?.source_metrics?.status==='final'?'NIGHT FINAL':'MEDIA LIVE';
    }catch(e){
      console.error('Hitmen media room',e);
      lead.innerHTML='<div class="hm-recap-empty">The media desk could not be loaded right now. Refresh to try again.</div>';
      if(status)status.textContent='RETRY';
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',load);else load();
})();