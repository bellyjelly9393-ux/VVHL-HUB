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

  function renderAnalysisText(text){
    return String(text||'').split(/\r?\n/).map(line=>{
      const raw=line.trimEnd(),t=raw.trim();
      if(!t)return '<div class="gm-ai-analysis-gap"></div>';
      const inline=s=>esc(s).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\[(E\d+)\]/g,'<span class="gm-ai-cite">[$1]</span>');
      if(/^###\s+/.test(t))return '<h4>'+inline(t.replace(/^###\s+/,''))+'</h4>';
      if(/^##\s+/.test(t))return '<h3>'+inline(t.replace(/^##\s+/,''))+'</h3>';
      if(/^#\s+/.test(t))return '<h2>'+inline(t.replace(/^#\s+/,''))+'</h2>';
      if(/^[-*]\s+/.test(t))return '<div class="gm-ai-analysis-bullet"><span>•</span><p>'+inline(t.replace(/^[-*]\s+/,''))+'</p></div>';
      if(/^\d+[.)]\s+/.test(t)){const m=t.match(/^(\d+)[.)]\s+(.*)$/);return '<div class="gm-ai-analysis-bullet"><span>'+esc(m[1])+'.</span><p>'+inline(m[2])+'</p></div>';}
      return '<p>'+inline(t)+'</p>';
    }).join('');
  }

  function usageText(usage){
    if(!usage)return'';
    const input=usage.prompt_tokens??usage.input_tokens,output=usage.completion_tokens??usage.output_tokens,total=usage.total_tokens;
    const parts=[];if(input!=null)parts.push('input '+Number(input).toLocaleString());if(output!=null)parts.push('output '+Number(output).toLocaleString());if(total!=null)parts.push('total '+Number(total).toLocaleString());
    return parts.join(' · ');
  }

  let analysisGeneration=0;
  async function deepAsk(){
    if(!team||!canUse())return;
    const question=$('gmAiQuestion').value.trim();if(!question)return;
    const generation=++analysisGeneration, userId=auth().user.id;
    $('gmAiDeepAsk').disabled=true;$('gmAiAsk').disabled=true;
    setStatus('LOADING EVIDENCE · ANALYZING');
    try{
      const {data,error}=await db().auth.getSession();if(error)throw error;
      if(!data.session?.access_token)throw new Error('Sign in again before analyzing.');
      const response=await fetch('/api/chelscout-deepthink',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+data.session.access_token},body:JSON.stringify({question,playerNames:$('gmAiPlayers').value.split('\n').map(x=>x.trim()).filter(Boolean),scenario:$('gmAiScenario').value.trim(),mode:$('gmAiMode').value,lens:$('gmAiLens')?.value||'auto'}),signal:AbortSignal.timeout(115000)});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'Analysis failed.');
      if(generation!==analysisGeneration||auth().user?.id!==userId)return;
      const coverage=result.coverage||{},matched=(coverage.matchedOpponents||[]).join(', ')||'None',players=(coverage.selectedPlayers||[]).join(', ')||'None',warn=(coverage.warnings||[]);
      $('gmAiAnswer').innerHTML=
        '<div class="gm-ai-analysis-head"><div><div class="eyebrow">'+esc(result.engine||'WILDMAN HOCKEY OPS')+'</div><h3>'+esc(String(result.lens||'general').replaceAll('_',' ').toUpperCase())+' ANALYSIS</h3></div><div class="gm-ai-analysis-meta"><span>'+esc(result.model||'Claude')+'</span><span>'+esc((result.reasoningEffort||'').toUpperCase())+' REASONING</span></div></div>'+
        '<div class="gm-ai-analysis-body">'+renderAnalysisText(result.answer)+'</div>'+
        '<details class="gm-ai-evidence"><summary>Evidence packet & coverage · '+esc(String(coverage.evidenceRecords??result.sources?.length??0))+' records</summary>'+
          '<div class="gm-ai-coverage-grid"><div><small>Players</small><b>'+esc(players)+'</b></div><div><small>Opponents</small><b>'+esc(matched)+'</b></div><div><small>Selection</small><b>'+esc(coverage.selection||'—')+'</b></div><div><small>Usage</small><b>'+esc(usageText(result.usage)||'—')+'</b></div></div>'+
          (warn.length?'<div class="gm-ai-warnings">'+warn.map(x=>'<p>'+esc(x)+'</p>').join('')+'</div>':'')+
          (result.sources||[]).map(x=>'<details class="gm-ai-source"><summary>['+esc(x.id)+'] '+esc(x.source)+(x.meta?.evidenceClass?' · '+esc(String(x.meta.evidenceClass).replaceAll('_',' ')):'')+'</summary><pre>'+esc(JSON.stringify(x.data,null,2))+'</pre></details>').join('')+
        '</details>';
      setStatus('CLAUDE ANALYSIS READY');
    }catch(e){if(generation===analysisGeneration&&auth().user?.id===userId){$('gmAiAnswer').textContent=e.name==='TimeoutError'?'Analysis timed out. Try fewer players or Quick mode.':e.message;setStatus('ANALYSIS UNAVAILABLE');}}
    finally{if(generation===analysisGeneration){$('gmAiDeepAsk').disabled=false;$('gmAiAsk').disabled=false;}}
  }
  $('gmAiDeepAsk')?.addEventListener('click',deepAsk);
  window.addEventListener('vvhl-auth-change',()=>{analysisGeneration++;$('gmAiAnswer').textContent='Ask a new question to load evidence for this session.';$('gmAiDeepAsk').disabled=false;$('gmAiAsk').disabled=false;});

  $('gmAiAsk')?.addEventListener('click',ask);
  $('gmAiQuestion')?.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter')ask();});
  document.querySelectorAll('[data-gm-example]').forEach(b=>b.addEventListener('click',()=>{$('gmAiQuestion').value=b.dataset.gmExample;if(b.dataset.gmLens&&$('gmAiLens'))$('gmAiLens').value=b.dataset.gmLens;if(b.dataset.gmLens)deepAsk();else ask();}));

  window.addEventListener('vvhl-auth-change',init);
  if(auth().user)init();
})();