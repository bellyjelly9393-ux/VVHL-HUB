(() => {
  const TEAM_NAME='Calgary Hitmen';
  const $=id=>document.getElementById(id);
  const db=()=>window.VVHLBackend?.db;
  const auth=()=>window.VVHLBackend?.state||{};
  let team=null;

  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=v=>v==null?'—':'$'+(Number(v)/1000000).toFixed(Number(v)%1000000?2:1)+'M';
  const score=v=>v==null?'—':Number(v).toFixed(0)+'/100';

  function canUse(){
    const s=auth();
    if(!s.user||!team)return false;
    if(String(s.profile?.role||'').toLowerCase()==='admin')return true;
    return (s.memberships||[]).some(m=>m.team_id===team.id&&m.active!==false&&['owner','gm','agm'].includes(String(m.role||'').toLowerCase()));
  }

  function enforce(){
    const ok=canUse();
    document.querySelectorAll('[data-management-content]').forEach(el=>el.hidden=!ok);
    const locked=$('managementLockedMessage');
    if(locked){
      locked.hidden=ok;
      if(!ok&&auth().user)locked.innerHTML='<b>Calgary Hitmen access not assigned.</b><p>GM MVP AI requires Wildman Admin or an active Calgary Owner, GM or AGM membership.</p>';
    }
    return ok;
  }

  async function init(){
    if(!db()||!auth().user)return;
    const {data,error}=await db().from('teams').select('id,name').eq('name',TEAM_NAME).maybeSingle();
    if(error){setStatus('DATABASE ERROR');return;}
    team=data;
    if(!enforce())return;
    setStatus('READY');
  }

  function setStatus(text){const el=$('gmAiStatus');if(el)el.textContent=text;}

  function answerText(query,search){
    const rows=search.results||[];
    if(!rows.length)return '<div class="eyebrow">GM MVP AI</div><h3>NO DATABASE MATCH.</h3><p>I did not find a player that matches the position/budget filters in the current Wildman intelligence data. That means no match, not permission to make one up.</p>';
    const top=rows[0];
    const pos=top.profile?.primary_position||'player';
    const val=top.valuation;
    const market=top.market||null;
    const budget=search.recognized?.budget;
    const parts=[
      '<div class="eyebrow">GM MVP AI</div>',
      '<h3>'+esc(top.profile?.gamertag||'TOP MATCH')+' LEADS THIS QUERY.</h3>',
      '<p>I found <strong>'+rows.length+'</strong> current database match'+(rows.length===1?'':'es')+(search.recognized?.position?' at <strong>'+esc(search.recognized.position)+'</strong>':'')+(budget?' under <strong>'+money(budget)+'</strong>':'')+(search.recognized?.marketFocus?' inside the imported ChelScout focus market':'')+'. '
    ];
    if(market){
      parts.push('The top match is a '+esc(pos)+(market.role?' projected as <strong>'+esc(market.role)+'</strong>':'')+(market.tier?' with a <strong>'+esc(String(market.tier).replaceAll('_',' '))+'</strong> market read':'')+(market.reach_pct!=null?' and <strong>'+esc(market.reach_pct)+'% reach</strong>':'')+'. ');
      if(val?.expected_market!=null||val?.fair_value!=null)parts.push('Market price/read: <strong>'+money(val?.expected_market??val?.fair_value)+'</strong>.');
    }else if(val){
      parts.push('The top match is a '+esc(pos)+' with Calgary fit <strong>'+score(val.team_fit_score)+'</strong>, expected market <strong>'+money(val.expected_market)+'</strong> and walk price <strong>'+money(val.walk_price)+'</strong>.');
    }else{
      parts.push('The top match is a '+esc(pos)+', but Calgary does not have a saved valuation snapshot for this player yet.');
    }
    parts.push(' Use the shortlist below as management evidence, not an automatic signing decision.</p>');
    return parts.join('');
  }

  function render(search){
    const rows=search.results||[];
    $('gmAiCount').textContent=rows.length+' MATCH'+(rows.length===1?'':'ES');
    $('gmAiAnswer').innerHTML=answerText(search.question,search);
    $('gmAiResults').innerHTML=rows.length?rows.map(({profile,valuation,market},i)=>`
      <article class="gm-ai-result">
        <div class="gm-ai-result-head">
          <div><div class="eyebrow">#${i+1} DATABASE MATCH</div><h3>${esc(profile.gamertag)}</h3></div>
          <span class="gm-ai-result-pos">${esc(profile.primary_position||'—')}</span>
        </div>
        <div class="gm-ai-metrics">
          <div class="gm-ai-metric"><small>MARKET</small><b>${money(valuation?.expected_market)}</b></div>
          <div class="gm-ai-metric"><small>VALUE</small><b>${money(valuation?.fair_value)}</b></div>
          <div class="gm-ai-metric"><small>REACH</small><b>${market?.reach_pct!=null?esc(market.reach_pct)+'%':'—'}</b></div>
          <div class="gm-ai-metric"><small>RANK</small><b>${market?.rank!=null?'#'+esc(market.rank):score(valuation?.performance_score)}</b></div>
        </div>
        ${market?'<div class="gm-ai-result-market">'+[market.tier&&String(market.tier).replaceAll('_',' '),market.role,market.server&&market.server+' server',market.projection&&'↑ '+market.projection].filter(Boolean).map(esc).join(' · ')+'</div>':''}
        <div class="gm-ai-result-actions">
          <a class="small-btn" href="hitmen-management.html?tab=pool">Scouting</a>
          <a class="small-btn" href="hitmen-management.html?tab=bids">Target Board</a>
        </div>
      </article>`).join(''):'<div class="empty-state">No matches returned from the current intelligence data.</div>';
  }

  async function ask(){
    const q=$('gmAiQuestion')?.value.trim();
    if(!q)return;
    if(!team||!canUse())return;
    if(!window.WildmanPlayerIntelligence?.databaseFirstPlayerSearch){
      setStatus('ENGINE OFFLINE');return;
    }
    try{
      setStatus('SEARCHING');
      $('gmAiAsk').disabled=true;
      const result=await window.WildmanPlayerIntelligence.databaseFirstPlayerSearch(q,{teamId:team.id,limit:8});
      render(result);
      setStatus('ANSWER READY');
    }catch(e){
      console.error(e);
      $('gmAiAnswer').innerHTML='<div class="eyebrow">GM MVP AI</div><h3>QUERY FAILED.</h3><p>'+esc(e.message||'Could not query player intelligence.')+'</p>';
      setStatus('ERROR');
    }finally{$('gmAiAsk').disabled=false;}
  }

  $('gmAiAsk')?.addEventListener('click',ask);
  $('gmAiQuestion')?.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter')ask();});
  document.querySelectorAll('[data-gm-example]').forEach(b=>b.addEventListener('click',()=>{$('gmAiQuestion').value=b.dataset.gmExample;ask();}));

  window.addEventListener('vvhl-auth-change',init);
  if(auth().user)init();
})();