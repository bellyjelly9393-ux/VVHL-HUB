(() => {
  const TEAM_ID='b0bcbdda-da9d-419d-8f61-b34937966d49';
  const db=()=>window.VVHLBackend?.db;
  const state=()=>window.VVHLBackend?.state||{};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const moneyM=v=>v==null||v===''?'—':'$'+Number(v).toFixed(Number(v)<10?2:1).replace(/\.00$/,'')+'M';
  const money=v=>v==null||v===''?'—':'$'+Number(v).toLocaleString();
  const norm=v=>String(v||'').trim().toLowerCase().replace(/\s+/g,' ');
  let current=null,noteTimer=null;

  function ensure(){
    if(document.getElementById('hsDossier'))return;
    const root=document.createElement('div');
    root.id='hsDossier';root.className='hs-dossier-overlay';root.hidden=true;
    root.innerHTML=`<div class="hs-dossier-backdrop" data-hsd-close></div>
      <aside class="hs-dossier" role="dialog" aria-modal="true" aria-label="Player scouting dossier">
        <div id="hsDossierBody"></div>
      </aside>`;
    document.body.appendChild(root);
    root.addEventListener('click',e=>{if(e.target.closest('[data-hsd-close]'))close();});
  }
  function close(){const r=document.getElementById('hsDossier');if(r){r.hidden=true;document.body.classList.remove('hs-dossier-open');}}
  function show(html){ensure();document.getElementById('hsDossierBody').innerHTML=html;const r=document.getElementById('hsDossier');r.hidden=false;document.body.classList.add('hs-dossier-open');bind();}

  function arr(v){return Array.isArray(v)?v:[];}
  function latest(rows){return (rows||[]).slice().sort((a,b)=>new Date(b.created_at||b.imported_at||0)-new Date(a.created_at||a.imported_at||0))[0]||null;}
  function text(v){
    if(v==null)return'';
    if(Array.isArray(v))return v.map(text).filter(Boolean).join(' · ');
    if(typeof v==='object')return Object.values(v).map(text).filter(Boolean).join(' · ');
    return String(v).trim();
  }
  function first(...vals){return vals.map(text).find(Boolean)||'';}
  function num(...vals){for(const v of vals){const n=Number(v);if(Number.isFinite(n))return n;}return null;}
  function rawGet(o,paths){
    for(const path of paths){
      let v=o;
      for(const k of path.split('.'))v=v&&typeof v==='object'?v[k]:undefined;
      if(v!==undefined&&v!==null&&v!=='')return v;
    }
    return null;
  }

  function radar(spokes){
    const items=arr(spokes).map(s=>({label:first(s.label,s.name),value:Math.max(0,Math.min(100,num(s.value,s.score,s.fill!=null?Number(s.fill)*100:null)||0))})).filter(x=>x.label).slice(0,7);
    if(items.length<3)return '<div class="hsd-empty">No style radar imported yet.</div>';
    const cx=150,cy=135,R=92,n=items.length;
    const point=(i,r)=>{const a=-Math.PI/2+i*(Math.PI*2/n);return [cx+Math.cos(a)*r,cy+Math.sin(a)*r];};
    const grid=[.25,.5,.75,1].map(k=>'<polygon points="'+items.map((_,i)=>point(i,R*k).join(',')).join(' ')+'" />').join('');
    const axes=items.map((_,i)=>{const p=point(i,R);return '<line x1="'+cx+'" y1="'+cy+'" x2="'+p[0]+'" y2="'+p[1]+'" />';}).join('');
    const poly=items.map((it,i)=>point(i,R*it.value/100).join(',')).join(' ');
    const labels=items.map((it,i)=>{const p=point(i,R+28);return '<text x="'+p[0]+'" y="'+p[1]+'" text-anchor="middle"><tspan x="'+p[0]+'" dy="0">'+esc(String(Math.round(it.value)))+'</tspan><tspan class="lbl" x="'+p[0]+'" dy="14">'+esc(it.label)+'</tspan></text>';}).join('');
    return `<svg class="hsd-radar" viewBox="0 0 300 270" aria-label="Player style radar"><g class="grid">${grid}${axes}</g><polygon class="shape" points="${poly}" />${labels}</svg>`;
  }

  function careerTable(career){
    const rows=arr(career).slice(0,12);
    if(!rows.length)return '<div class="hsd-empty">No career history imported yet.</div>';
    return `<div class="hsd-table-wrap"><table class="hsd-table"><thead><tr><th>Season</th><th>League</th><th>Salary</th><th>Pos</th><th>GP</th><th>G</th><th>A</th><th>P</th><th>PPG</th></tr></thead><tbody>${rows.map(r=>`<tr>
      <td>S${esc(r.season??'—')}</td><td>${esc(r.league??r.league_short??'—')}</td><td>${esc(r.salary??r.salary_label??'—')}</td><td>${esc(r.pos??r.position??'—')}</td>
      <td>${esc(r.gp??'—')}</td><td>${esc(r.g??r.goals??'—')}</td><td>${esc(r.a??r.assists??'—')}</td><td>${esc(r.pts??r.points??'—')}</td><td>${esc(r.ppg??'—')}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function reportCard(r,label){
    return `<article class="hsd-report"><div class="hsd-report-top"><span>${esc(label)}</span><small>${esc(r.created_at||r.imported_at?new Date(r.created_at||r.imported_at).toLocaleDateString():'')}</small></div>
      ${r.overall_grade!=null?`<div class="hsd-report-grade">${esc(r.overall_grade)}/10</div>`:''}
      ${first(r.report_title,r.recommendation)?`<h4>${esc(first(r.report_title,r.recommendation))}</h4>`:''}
      ${r.summary?`<p>${esc(r.summary)}</p>`:''}
      ${r.strengths?`<p><b>Strengths:</b> ${esc(r.strengths)}</p>`:''}
      ${r.concerns?`<p><b>Concerns:</b> ${esc(r.concerns)}</p>`:''}
      ${r.notes?`<p>${esc(r.notes)}</p>`:''}
      ${r.recommendation&&!r.report_title?`<p><b>Recommendation:</b> ${esc(r.recommendation)}</p>`:''}
    </article>`;
  }

  function marketBand(fair,likely,walk){
    if(fair==null&&likely==null&&walk==null)return '<div class="hsd-empty">No market model imported yet.</div>';
    const base=Math.max(fair||0,likely||0,walk||0,1);
    const ceiling=Math.max(base*1.25,walk||0,3);
    const pos=Math.max(2,Math.min(98,((likely??fair??0)/ceiling)*100));
    const diff=fair!=null&&likely!=null?likely-fair:null;
    return `<div class="hsd-market-head"><small>expected market landing</small><b>${diff==null?'':moneyM(Math.abs(diff))+' '+(diff>=0?'over':'under')+' value'}</b></div>
      <div class="hsd-market"><div>STEAL</div><div>STRONG</div><div>GOOD</div><div>FAIR</div><div>OVER</div><div>WALK</div><span class="hsd-market-pin" style="left:${pos}%"><i></i><b>${moneyM(likely??fair)}</b></span></div>`;
  }

  function scoutAnswer(d,question){
    const p=d.pool.scouting_players||{},x=d.intel||{},ext=latest(d.external),own=latest(d.reports),raw=ext?.raw_payload||{};
    const role=first(d.pool.projected_role,x.role_chip,x.role_band,raw.meta);
    const read=first(ext?.summary,raw.summary,x.onice_read,arr(x.notes)[0],own?.notes);
    const bottom=first(ext?.recommendation,raw.bottom_line,own?.recommendation);
    const fair=num(x.fair_value_m,raw.fair_value_m,raw.fair_value);
    const likely=num(x.likely_price_m,raw.likely_price_m);
    const walk=num(x.walk_above_m,raw.walk_above_m);
    const career=arr(x.career),last=career[0]||{};
    const strengths=first(own?.strengths,ext?.strengths);
    const concerns=first(own?.concerns,ext?.concerns,arr(x.risks));
    const parts=[];
    parts.push((p.gamertag||x.player_name||'This player')+' projects as '+(role||'an unsettled role')+' for Calgary.');
    if(read)parts.push(read);
    if(last.gp!=null||last.ppg!=null)parts.push('Latest sample: '+(last.gp??'—')+' GP, '+(last.pts??last.points??'—')+' points, '+(last.ppg??'—')+' PPG.');
    if(strengths)parts.push('What helps: '+text(strengths)+'.');
    if(concerns)parts.push('What to verify: '+text(concerns)+'.');
    if(fair!=null||likely!=null)parts.push('Market read: fair value '+moneyM(fair)+', likely price '+moneyM(likely)+(walk!=null?', walk point '+moneyM(walk):'')+'.');
    if(d.pool.fit_grade!=null)parts.push('Calgary fit is '+d.pool.fit_grade+'/10 with priority '+(d.pool.priority??'not set')+'.');
    if(bottom)parts.push('Bottom line: '+bottom);
    if(question&&/bid|price|cost|market/i.test(question)&&likely==null&&fair==null)parts.push('There is not enough imported pricing data yet to make a useful market call.');
    return parts.filter(Boolean).join(' ');
  }

  async function fetchData(poolId){
    const pool=await db().from('team_scouting_pool')
      .select('id,scouting_player_id,status,priority,fit_grade,projected_role,target_bid,max_bid,management_note,updated_at,scouting_players(id,gamertag,platform,primary_position)')
      .eq('team_id',TEAM_ID).eq('id',poolId).single();
    if(pool.error)throw pool.error;
    const pid=pool.data.scouting_player_id;
    const [intel,reports,external,bid]=await Promise.all([
      db().from('team_chelscout_intel').select('*').eq('team_id',TEAM_ID).eq('scouting_player_id',pid).order('imported_at',{ascending:false}).limit(1),
      db().from('team_scouting_reports').select('*').eq('team_id',TEAM_ID).eq('scouting_player_id',pid).order('created_at',{ascending:false}),
      db().from('team_external_scouting_reports').select('*').eq('team_id',TEAM_ID).eq('scouting_player_id',pid).order('imported_at',{ascending:false}),
      db().from('team_bid_board').select('*').eq('team_id',TEAM_ID).eq('scouting_player_id',pid).limit(1)
    ]);
    const err=[intel,reports,external,bid].find(x=>x.error)?.error;if(err)throw err;
    return {pool:pool.data,intel:intel.data?.[0]||null,reports:reports.data||[],external:external.data||[],bid:bid.data?.[0]||null};
  }

  function build(d){
    const p=d.pool.scouting_players||{},x=d.intel||{},raw=x.raw_payload||{},ext=latest(d.external),own=latest(d.reports);
    const rawReport=ext?.raw_payload||{};
    const confidence=first(x.confidence,x.reliability,rawReport.confidence,raw.confidence);
    const role=first(d.pool.projected_role,x.role_chip,x.role_band,rawReport.meta,raw.role?.chip,raw.role?.band);
    const pos=first(p.primary_position,x.played_position,x.signed_position,rawReport.position);
    const fair=num(x.fair_value_m,rawReport.fair_value_m,rawReport.fair_value,raw.fv_by_league_x?.['39']?.fair_value_M);
    const likely=num(x.likely_price_m,rawReport.likely_price_m,raw.price?.likely_M);
    const walk=num(x.walk_above_m,rawReport.walk_above_m,raw.fv_by_league_x?.['39']?.zones?.walk_above_M);
    const read=first(ext?.summary,rawReport.summary,x.onice_read,arr(x.notes)[0],own?.notes);
    const bottom=first(ext?.recommendation,rawReport.bottom_line,own?.recommendation);
    const narrative=first(rawReport.narrative,ext?.summary,own?.notes);
    const last=arr(x.career)[0]||{};
    const onice=first(x.onice_read,raw.onice?.read);
    const poolRank=x.pool_rank!=null?x.pool_rank:null,poolN=x.pool_n!=null?x.pool_n:null;
    const names=arr(raw.name_history).map(v=>typeof v==='string'?v:v.name).filter(Boolean);
    const spokes=arr(x.dna?.spokes).length?x.dna.spokes:arr(raw.dna?.spokes);
    const reportCount=d.reports.length+d.external.length;
    const scoutSummary=scoutAnswer(d,'Give me an honest scouting report');
    const comps=arr(x.comparables).length?x.comparables:arr(raw.comparables);
    const compHtml=comps.slice(0,8).map(v=>{const label=typeof v==='string'?v:first(v.name,v.player,v.gamertag,v.label);return label?`<span>${esc(label)}</span>`:'';}).join('');
    const careerGp=arr(x.career).reduce((t,r)=>t+(Number(r.gp)||0),0);
    return `
      <header class="hsd-head">
        <div><h2>${esc(p.gamertag||x.player_name||'Player')}</h2><div class="hsd-badges">${confidence?`<span class="confidence">${esc(confidence.toUpperCase())}</span>`:''}${pos?`<span>${esc(pos)}</span>`:''}${role?`<span class="role">${esc(role)}</span>`:''}<span>${reportCount} report${reportCount===1?'':'s'}</span></div></div>
        <button class="hsd-ask-btn" data-hsd-jump-ask type="button">ASK</button>
        <button class="hsd-close" data-hsd-close type="button">×</button>
      </header>

      <div class="hsd-meta-strip"><span>CHL · S55</span><span>${careerGp||'—'} career GP</span><span>${esc(p.platform||'platform unconfirmed')}</span><span>${esc(d.pool.status||'unscouted')}</span></div>

      <div class="hsd-actions">
        <button data-hsd-status="watch" type="button">＋ Add to Plan</button>
        <button data-hsd-status="bid_target" type="button">★ Target</button>
        <button data-hsd-status="pass" type="button">Don’t target</button>
      </div>
      <label class="hsd-note"><span>PRIVATE MANAGEMENT NOTE · SAVES AS YOU TYPE</span><textarea id="hsdNote" placeholder="Fit, chemistry, availability, bidding plan, concerns…">${esc(d.pool.management_note||'')}</textarea><small id="hsdNoteStatus"></small></label>

      <section class="hsd-read">
        <small>THE READ</small>
        <h3>${esc(read||'No imported scouting read yet.')}</h3>
        ${bottom?`<p><b>Management call:</b> ${esc(bottom)}</p>`:''}
      </section>

      <section class="hsd-value-grid">
        <div><small>WILDMAN / SCOUT VALUE</small><strong>${moneyM(fair)}</strong><span>${d.pool.target_bid!=null?'Calgary target '+money(d.pool.target_bid):'target not set'}</span></div>
        <div><small>LIKELY PRICE</small><strong>${moneyM(likely)}</strong><span>${d.pool.max_bid!=null?'Calgary max '+money(d.pool.max_bid):walk!=null?'walk above '+moneyM(walk):'ceiling not set'}</span></div>
      </section>

      <section class="hsd-section">${marketBand(fair,likely,walk)}</section>

      <section class="hsd-section hsd-facts">
        <div><small>LAST SEASON</small><b>${esc([last.ppg!=null?last.ppg+' PPG':'',last.gp!=null?last.gp+' GP':'',last.pts!=null?last.pts+' PTS':''].filter(Boolean).join(' · ')||'—')}</b></div>
        <div><small>PROJECT HERE</small><b>${esc(first(x.projected_rank,raw.role?.proj,'—'))}</b></div>
        <div><small>ON THE ICE</small><b>${esc(onice||'—')}${x.onice_impact!=null?' · '+Number(x.onice_impact).toFixed(2):''}</b></div>
      </section>

      <section class="hsd-section">
        <h3>WHERE HE RANKS</h3>
        <div class="hsd-rank-row"><span>POOL</span><b>${poolRank!=null?esc(poolRank+' of '+(poolN??'—')):'—'}</b></div>
        <div class="hsd-rank-row"><span>PROJECTED ROLE</span><b>${esc(x.projected_rank||role||'—')}</b></div>
        <div class="hsd-rank-row"><span>FIT FOR CALGARY</span><b>${esc(d.pool.fit_grade!=null?d.pool.fit_grade+'/10':'—')}</b></div>
        <div class="hsd-rank-row"><span>PRIORITY</span><b>${esc(d.pool.priority??'—')}</b></div>
      </section>

      <section class="hsd-section">
        <h3>HOW HE PLAYS</h3>
        ${radar(spokes)}
        ${arr(spokes).length?`<div class="hsd-style-tags">${arr(spokes).slice(0,5).map(s=>`<span>${esc(first(s.label,s.name))}</span>`).join('')}</div>`:''}
      </section>

      ${compHtml?`<section class="hsd-section"><h3>PLAYS LIKE</h3><div class="hsd-comparables">${compHtml}</div></section>`:''}

      <section class="hsd-section"><h3>CAREER</h3>${careerTable(x.career)}</section>

      <section class="hsd-section"><h3>KNOWN NAMES</h3>
        <div class="hsd-names">${(names.length?names:[p.gamertag]).map(n=>`<span>${esc(n)}</span>`).join('')}</div>
      </section>

      <section class="hsd-section"><h3>SCOUTING REPORTS</h3>
        <div class="hsd-report-stack">${d.external.map(r=>reportCard(r,'CHELSCOUT')).join('')}${d.reports.map(r=>reportCard(r,'CALGARY MANAGEMENT')).join('')||'<div class="hsd-empty">No reports saved yet.</div>'}</div>
      </section>

      ${narrative?`<section class="hsd-section hsd-long-read"><div class="hsd-brandline">WILDMAN INTELLIGENCE</div><h3>FULL SCOUTING READ</h3><p>${esc(narrative)}</p></section>`:''}

      <section id="hsdScoutChat" class="hsd-scout-chat"><div class="hsd-scout-chat-head">WILDMAN SCOUT · ASK ABOUT ${esc(p.gamertag||x.player_name||'PLAYER')}</div><div id="hsdScoutAnswer" class="hsd-scout-answer">${esc(scoutSummary)}</div><form id="hsdAskForm" class="hsd-ask-form"><input id="hsdAskInput" placeholder="Ask about fit, price, role, risk…"><button type="submit">↑</button></form></section>

      <footer class="hsd-footer"><button data-hsd-close type="button">Close Dossier</button><span>Private Calgary Hitmen management workspace</span></footer>
    `;
  }

  async function open(poolId){
    if(!db()||!state().user)return;
    ensure();show('<div class="hsd-loading">Building player dossier…</div>');
    try{current=await fetchData(poolId);show(build(current));}
    catch(e){show('<div class="hsd-error"><button class="hsd-close" data-hsd-close type="button">×</button><h3>Could not load dossier</h3><p>'+esc(e.message||'Unknown error')+'</p></div>');}
  }

  async function setStatus(status){
    if(!current)return;
    const u=state().user.id;
    const patch={status,updated_by:u,updated_at:new Date().toISOString()};
    if(status==='bid_target'&&current.pool.priority==null)patch.priority=1;
    const q=await db().from('team_scouting_pool').update(patch).eq('id',current.pool.id);
    if(q.error)return;
    current.pool={...current.pool,...patch};
    if(status==='bid_target'){
      const existing=await db().from('team_bid_board').select('id').eq('team_id',TEAM_ID).eq('scouting_player_id',current.pool.scouting_player_id).maybeSingle();
      if(!existing.error&&!existing.data){
        await db().from('team_bid_board').insert({team_id:TEAM_ID,scouting_player_id:current.pool.scouting_player_id,status:'target',priority:current.pool.priority||1,target_price:current.pool.target_bid,max_price:current.pool.max_bid,plan:current.pool.projected_role||null,note:current.pool.management_note||null,updated_by:u,updated_at:new Date().toISOString()});
      }
    }
    document.querySelectorAll('[data-hsd-status]').forEach(b=>b.classList.toggle('active',b.dataset.hsdStatus===status));
    window.dispatchEvent(new CustomEvent('vvhl-auth-change',{detail:state()}));
  }

  function saveNote(){
    if(!current)return;
    clearTimeout(noteTimer);
    noteTimer=setTimeout(async()=>{
      const note=document.getElementById('hsdNote')?.value??'';
      const s=document.getElementById('hsdNoteStatus');if(s)s.textContent='Saving…';
      const q=await db().from('team_scouting_pool').update({management_note:note||null,updated_by:state().user.id,updated_at:new Date().toISOString()}).eq('id',current.pool.id);
      if(s)s.textContent=q.error?(q.error.message||'Could not save'):'Saved ✓';
      if(!q.error)current.pool.management_note=note;
    },650);
  }

  function bind(){
    document.querySelectorAll('[data-hsd-status]').forEach(b=>b.addEventListener('click',()=>setStatus(b.dataset.hsdStatus)));
    document.getElementById('hsdNote')?.addEventListener('input',saveNote);
    document.querySelector('[data-hsd-jump-ask]')?.addEventListener('click',()=>document.getElementById('hsdScoutChat')?.scrollIntoView({behavior:'smooth',block:'center'}));
    document.getElementById('hsdAskForm')?.addEventListener('submit',e=>{
      e.preventDefault();
      const input=document.getElementById('hsdAskInput'),answer=document.getElementById('hsdScoutAnswer');
      if(!current||!answer)return;
      answer.textContent=scoutAnswer(current,input?.value||'Give me an honest scouting report');
      if(input)input.value='';
    });
    document.addEventListener('keydown',escKey);
  }
  function escKey(e){if(e.key==='Escape')close();}

  document.addEventListener('click',e=>{
    const hit=e.target.closest('[data-hs-target],[data-hs-player]');
    if(!hit)return;
    const id=hit.dataset.hsTarget||hit.dataset.hsPlayer;
    if(id)setTimeout(()=>open(id),0);
  },true);

  window.HitmenDossier={open,close};
  ensure();
})();