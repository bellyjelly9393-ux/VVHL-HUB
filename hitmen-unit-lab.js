(() => {
  const TEAM='b0bcbdda-da9d-419d-8f61-b34937966d49';
  const SEASON=55;
  const POS=['LW','C','RW','LD','RD'];
  const TYPES=['official','plan','what_if'];
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clamp=(v,a=0,b=100)=>Math.max(a,Math.min(b,Number(v)||0));
  const num=(...xs)=>{for(const x of xs){const n=Number(x);if(x!==null&&x!==''&&Number.isFinite(n))return n;}return null;};
  const norm=v=>String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,'');
  function canonPos(v){
    const p=String(v||'').trim().toLowerCase().replace(/[^a-z]/g,'');
    if(['lw','leftwing','leftwinger'].includes(p))return 'LW';
    if(['rw','rightwing','rightwinger'].includes(p))return 'RW';
    if(['c','center','centre'].includes(p))return 'C';
    if(['ld','leftdefense','leftdefence','leftdefenceman','leftdefenseman'].includes(p))return 'LD';
    if(['rd','rightdefense','rightdefence','rightdefenceman','rightdefenseman'].includes(p))return 'RD';
    if(['g','goalie','goaltender'].includes(p))return 'G';
    return String(v||'').trim().toUpperCase();
  }
  const money=v=>{const n=Number(v);if(!Number.isFinite(n))return '—';return n>=1e6?'$'+(n/1e6).toFixed(2).replace(/\.00$/,'')+'M':'$'+Math.round(n).toLocaleString();};
  const db=()=>window.VVHLBackend?.db;
  const st=()=>window.VVHLBackend?.state||{};
  const state={
    candidates:[],candidateMap:new Map(),plans:{},type:'plan',units:{},goalies:[],relationships:[],
    baseline:'league_average',opponent:null,salaryCap:30000000,loading:false,realtime:null,reloadTimer:null
  };

  function role(){
    if(String(st().profile?.role||'').toLowerCase()==='admin')return'admin';
    return (st().memberships||[]).find(m=>m.team_id===TEAM&&m.active!==false&&['owner','gm','agm'].includes(String(m.role||'').toLowerCase()))?.role||null;
  }
  const writable=()=>['admin','owner','gm','agm'].includes(String(role()||'').toLowerCase());

  function addCss(){
    if(document.querySelector('link[data-hm-unit-lab-css]'))return;
    const l=document.createElement('link');l.rel='stylesheet';l.href='hitmen-unit-lab.css?v=20260923';l.dataset.hmUnitLabCss='1';document.head.appendChild(l);
  }

  function inject(){
    addCss();
    const mount=$('hitmenUnitLab');
    if(!mount||$('hmuRoot'))return Boolean($('hmuRoot'));
    mount.innerHTML=`
      <article id="hmuRoot" class="hmu-shell">
        <div class="hmu-top">
          <div>
            <div class="eyebrow">SEASON 55 · LINE INTELLIGENCE</div>
            <h2>UNIT LAB</h2>
            <p>Build three five-man units using only players Calgary has placed on the Watch List or Bidding Board. Each position picker is locked to that position, so LW only shows left wings, C only shows centers, and so on.</p>
          </div>
          <div class="hmu-actions"><button id="hmuSuggest" class="hm-action">Suggest Lines</button><button id="hmuSave" class="hm-action primary">Save Shared Plan</button></div>
        </div>

        <div class="hmu-plan-tabs">
          <button data-hmu-type="official">Official</button>
          <button data-hmu-type="plan" class="active">Plan</button>
          <button data-hmu-type="what_if">What-if</button>
        </div>

        <div class="hmu-summary">
          <div><small>Players Set</small><strong id="hmuSet">0</strong></div>
          <div><small>Spots Left</small><strong id="hmuLeft">15</strong></div>
          <div><small>Projected Spend</small><strong id="hmuSpend">$0</strong></div>
          <div><small>Cap After Plan</small><strong id="hmuCap">$30M</strong></div>
          <div><small>Top Unit</small><strong id="hmuTopUnit">—</strong></div>
        </div>

        <div class="hmu-toolbar">
          <label>Compare against
            <select id="hmuBaseline">
              <option value="league_average">League Average</option>
              <option value="opponent">Opponent / League Average</option>
            </select>
          </label>
          <label>Plan label<input id="hmuLabel" placeholder="Season 55 opening plan"></label>
          <label>Salary cap<input id="hmuSalaryCap" type="number" step="250000" value="30000000"></label>
          <div class="hmu-status-wrap"><small>STATUS</small><span id="hmuStatus">Loading player intelligence…</span></div>
        </div>

        <div id="hmuUnits" class="hmu-units"></div>

        <div class="hmu-lower">
          <section class="hmu-panel">
            <div class="eyebrow">GOALIE DEPTH</div><h3>Goalies</h3>
            <div id="hmuGoalies" class="hmu-goalies"></div>
          </section>
          <section class="hmu-panel">
            <div class="eyebrow">NEXT UP</div><h3>Reserves</h3>
            <div id="hmuReserves" class="hmu-reserves"></div>
          </section>
        </div>
      </article>
      <div id="hmuModal" class="hmu-modal" hidden>
        <div class="hmu-modal-backdrop" data-hmu-close></div>
        <section class="hmu-modal-card" role="dialog" aria-modal="true">
          <div class="hmu-modal-head"><div><small id="hmuModalSub">UNIT</small><h3 id="hmuModalTitle">Unit read</h3></div><button data-hmu-close>×</button></div>
          <div id="hmuModalBody"></div>
        </section>
      </div>`;

    document.querySelectorAll('[data-hmu-type]').forEach(b=>b.onclick=()=>switchType(b.dataset.hmuType));
    $('hmuSave').onclick=savePlan;
    $('hmuSuggest').onclick=suggestLines;
    $('hmuBaseline').onchange=e=>{state.baseline=e.target.value;renderUnits();};
    $('hmuSalaryCap').oninput=e=>{state.salaryCap=Number(e.target.value)||30000000;renderSummary();};
    document.querySelectorAll('[data-hmu-close]').forEach(b=>b.onclick=closeModal);
    return true;
  }

  function blankUnits(){
    const o={};
    for(let i=1;i<=3;i++){o['unit'+i]={};for(const p of POS)o['unit'+i][p]=null;}
    return o;
  }

  function percentile(value,values){
    const valid=values.filter(Number.isFinite).sort((a,b)=>a-b);
    if(!valid.length||!Number.isFinite(value))return null;
    let below=0;for(const v of valid)if(v<value)below++;
    return valid.length===1?50:Math.round(100*below/(valid.length-1));
  }

  function ppgToScore(ppg,pos){
    if(!Number.isFinite(ppg))return null;
    const max=['LD','RD','D'].includes(pos)?2.2:4;
    return clamp(ppg/max*100);
  }

  function rawMetric(candidate,key){
    const s=candidate.stats||{},pre=candidate.pre||{},snap=pre.market_snapshot||{},career=pre.career_snapshot||{},last=career.latest_stats||{};
    const gp=num(s.games_played,last.gp);
    const ppg=num(gp&&s.points!=null?s.points/gp:null,last.ppg);
    const roleRank=(snap.rank&&snap.rank_pool)?clamp(100-(snap.rank-1)/Math.max(1,snap.rank_pool-1)*100):null;
    const overall=num(s.overall_rating,roleRank,candidate.rosterRatings?.overall_rating,50);
    const off=num(s.offense_rating,candidate.rosterRatings?.offense_rating,ppgToScore(ppg,candidate.pos),overall);
    const def=num(s.defense_rating,candidate.rosterRatings?.defense_rating,overall);
    const team=num(s.teamplay_rating,candidate.rosterRatings?.teamplay_rating,overall);
    const shotsPg=gp?num(s.shots)/gp:null;
    const astPg=gp?num(s.assists)/gp:null;
    const takePg=gp?num(s.takeaways)/gp:null;
    const givePg=gp?num(s.giveaways)/gp:null;
    const war=num(s.war);
    if(key==='overall')return clamp(overall);
    if(key==='scoring')return clamp(num(ppgToScore(ppg,candidate.pos),off));
    if(key==='shotVolume')return clamp(Number.isFinite(shotsPg)?shotsPg/6*100:off*.82);
    if(key==='passing')return clamp(num(s.passing_pct,Number.isFinite(astPg)?astPg/3*100:null,off*.9));
    if(key==='puckCare'){
      if(Number.isFinite(takePg)||Number.isFinite(givePg))return clamp(55+(takePg||0)*8-(givePg||0)*5);
      return clamp(team);
    }
    if(key==='possession')return clamp(num(Number.isFinite(war)?50+war*5:null,team,overall));
    if(key==='defense'){
      if(Number.isFinite(takePg))return clamp(def*.75+Math.min(100,takePg/4*100)*.25);
      return clamp(def);
    }
    if(key==='offense')return clamp(off);
    return clamp(overall);
  }

  function finalizeScores(candidates){
    for(const c of candidates){
      c.metrics={};
      for(const k of ['overall','scoring','shotVolume','passing','puckCare','possession','defense','offense'])c.metrics[k]=rawMetric(c,k);
    }
    const groups={F:candidates.filter(c=>['LW','C','RW','F'].includes(c.pos)),D:candidates.filter(c=>['LD','RD','D'].includes(c.pos)),G:candidates.filter(c=>c.pos==='G')};
    for(const c of candidates){
      const g=['LD','RD','D'].includes(c.pos)?groups.D:c.pos==='G'?groups.G:groups.F;
      c.positionRank={};
      for(const k of ['overall','offense','defense','scoring','passing','possession','shotVolume','puckCare']){
        const vals=g.map(x=>x.metrics[k]);
        c.positionRank[k]=percentile(c.metrics[k],vals);
      }
    }
  }

  function candidateCost(c){
    return num(c.capHit,c.bid?.target_price,c.pool?.market_price,c.pool?.market_details?.display_price,c.pre?.market_snapshot?.display_price,0)||0;
  }

  function candidateLabel(c){
    const rank=c.positionRank?.overall!=null?' · '+c.positionRank.overall+'th pct':'';
    return `${c.name} · ${c.pos||'?'}${rank}`;
  }

  function selectedKeys(){
    const s=new Set();
    for(const u of Object.values(state.units))for(const p of POS)if(u[p])s.add(u[p]);
    for(const g of state.goalies)if(g)s.add(g);
    return s;
  }

  function optionList(slot,current){
    const used=selectedKeys();
    const list=state.candidates.filter(c=>c.pos===slot).sort((a,b)=>(b.metrics.overall-a.metrics.overall)||a.name.localeCompare(b.name));
    const label='Choose '+slot+' · '+list.length+' player'+(list.length===1?'':'s');
    return '<option value="">'+esc(label)+'</option>'+list.map(c=>`<option value="${esc(c.key)}" ${c.key===current?'selected':''} ${used.has(c.key)&&c.key!==current?'disabled':''}>${esc(candidateLabel(c))}</option>`).join('');
  }

  function goalieOptions(current){
    const used=selectedKeys();
    const list=state.candidates.filter(c=>c.pos==='G').sort((a,b)=>b.metrics.overall-a.metrics.overall);
    return '<option value="">Choose G · '+list.length+' player'+(list.length===1?'':'s')+'</option>'+list.map(c=>`<option value="${esc(c.key)}" ${c.key===current?'selected':''} ${used.has(c.key)&&c.key!==current?'disabled':''}>${esc(candidateLabel(c))}</option>`).join('');
  }

  function unitPlayers(unitKey){
    const u=state.units[unitKey]||{};
    return POS.map(p=>state.candidateMap.get(u[p])).filter(Boolean);
  }

  function average(players,key){
    const vals=players.map(p=>p.metrics[key]).filter(Number.isFinite);
    return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null;
  }

  function baselineMetric(key){
    const pool=state.candidates.filter(c=>c.pos!=='G');
    return average(pool,key)||50;
  }

  function unitScore(unitKey){
    const ps=unitPlayers(unitKey);
    if(!ps.length)return {overall:0,filled:0,edge:0};
    const overall=average(ps,'overall')||0,off=average(ps,'offense')||0,def=average(ps,'defense')||0,pos=average(ps,'possession')||0;
    const fit=ps.length===5?100:ps.length/5*100;
    const score=clamp(overall*.45+off*.2+def*.2+pos*.1+fit*.05);
    return {overall:score,filled:ps.length,edge:score-baselineMetric('overall')};
  }

  function renderUnits(){
    const w=$('hmuUnits');if(!w)return;
    w.innerHTML=[1,2,3].map(i=>{
      const key='unit'+i,u=state.units[key]||{},score=unitScore(key);
      return `<section class="hmu-unit-card" data-unit="${key}">
        <div class="hmu-unit-head">
          <div><small>UNIT ${i}</small><h3>Unit ${i}</h3></div>
          <div class="hmu-unit-score"><strong>${score.filled?Math.round(score.overall)+'%':'—'}</strong><span>FIT SCORE</span></div>
        </div>
        <div class="hmu-edge"><span>vs league baseline</span><b class="${score.edge>=0?'pos':'neg'}">${score.filled?(score.edge>=0?'+':'')+score.edge.toFixed(1):'—'}</b></div>
        <div class="hmu-unit-slots">
          ${POS.map(pos=>`<label><span>${pos}</span><select data-hmu-slot="${key}:${pos}">${optionList(pos,u[pos])}</select></label>`).join('')}
        </div>
        <div class="hmu-unit-actions"><button class="hm-action" data-hmu-read="${key}">Full Read</button><button class="hm-action" data-hmu-clear="${key}">Clear Unit</button></div>
      </section>`;
    }).join('');
    w.querySelectorAll('[data-hmu-slot]').forEach(sel=>sel.onchange=()=>{
      const [unit,pos]=sel.dataset.hmuSlot.split(':');state.units[unit][pos]=sel.value||null;renderUnits();renderGoalies();renderSummary();renderReserves();
    });
    w.querySelectorAll('[data-hmu-read]').forEach(b=>b.onclick=()=>openRead(b.dataset.hmuRead));
    w.querySelectorAll('[data-hmu-clear]').forEach(b=>b.onclick=()=>{for(const p of POS)state.units[b.dataset.hmuClear][p]=null;renderUnits();renderSummary();renderReserves();});
  }

  function renderGoalies(){
    const w=$('hmuGoalies');if(!w)return;
    if(!state.candidates.some(c=>c.pos==='G')){w.innerHTML='<div class="hmu-empty">No goalie candidates are loaded yet.</div>';return;}
    if(!state.goalies.length)state.goalies=[null,null];
    w.innerHTML=[0,1].map(i=>`<label><span>G${i+1}</span><select data-hmu-goalie="${i}">${goalieOptions(state.goalies[i])}</select></label>`).join('');
    w.querySelectorAll('[data-hmu-goalie]').forEach(s=>s.onchange=()=>{state.goalies[Number(s.dataset.hmuGoalie)]=s.value||null;renderGoalies();renderSummary();renderReserves();});
  }

  function renderReserves(){
    const w=$('hmuReserves');if(!w)return;
    const used=selectedKeys();
    const list=state.candidates.filter(c=>!used.has(c.key)).sort((a,b)=>b.metrics.overall-a.metrics.overall).slice(0,10);
    w.innerHTML=list.length?list.map(c=>`<div class="hmu-reserve"><b>${esc(c.name)}</b><span>${esc(c.pos||'?')} · ${Math.round(c.metrics.overall)} overall · ${money(candidateCost(c))}</span></div>`).join(''):'<div class="hmu-empty">Everyone in the current pool is already assigned.</div>';
  }

  function renderSummary(){
    let filled=0,spend=0,top={i:null,s:-Infinity};
    [1,2,3].forEach(i=>{
      const key='unit'+i,s=unitScore(key);if(s.overall>top.s){top={i,s:s.overall};}
      const u=state.units[key]||{};for(const p of POS){if(u[p]){filled++;const c=state.candidateMap.get(u[p]);if(c)spend+=candidateCost(c);}}
    });
    for(const g of state.goalies){if(g){const c=state.candidateMap.get(g);if(c)spend+=candidateCost(c);}}
    $('hmuSet').textContent=filled;
    $('hmuLeft').textContent=Math.max(0,15-filled);
    $('hmuSpend').textContent=money(spend);
    $('hmuCap').textContent=money(state.salaryCap-spend);
    $('hmuCap').classList.toggle('negative',spend>state.salaryCap);
    $('hmuTopUnit').textContent=filled?('Unit '+top.i+' · '+Math.round(top.s)):'—';
  }

  function renderAll(){
    document.querySelectorAll('[data-hmu-type]').forEach(b=>b.classList.toggle('active',b.dataset.hmuType===state.type));
    $('hmuBaseline').value=state.baseline;
    $('hmuSalaryCap').value=state.salaryCap;
    renderUnits();renderGoalies();renderSummary();renderReserves();
  }

  function svgRadar(labels,values){
    const n=labels.length,cx=150,cy=125,r=88;
    const pts=(vals,scale=1)=>vals.map((v,i)=>{
      const a=-Math.PI/2+i*2*Math.PI/n,rr=r*clamp(v)/100*scale;
      return [cx+Math.cos(a)*rr,cy+Math.sin(a)*rr];
    });
    const grid=[.25,.5,.75,1].map(s=>`<polygon points="${pts(Array(n).fill(100),s).map(p=>p.join(',')).join(' ')}" />`).join('');
    const axes=labels.map((_,i)=>{const a=-Math.PI/2+i*2*Math.PI/n;return `<line x1="${cx}" y1="${cy}" x2="${cx+Math.cos(a)*r}" y2="${cy+Math.sin(a)*r}" />`;}).join('');
    const data=pts(values).map(p=>p.join(',')).join(' ');
    const text=labels.map((lab,i)=>{const a=-Math.PI/2+i*2*Math.PI/n,x=cx+Math.cos(a)*(r+25),y=cy+Math.sin(a)*(r+25);return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle">${esc(lab)}<tspan x="${x}" dy="11">${Math.round(values[i]||0)}</tspan></text>`;}).join('');
    return `<svg class="hmu-radar" viewBox="0 0 300 250" role="img"><g class="grid">${grid}${axes}</g><polygon class="shape" points="${data}"/>${text}</svg>`;
  }

  function readData(unitKey,mode){
    const ps=unitPlayers(unitKey);
    if(mode==='overall'){
      return {labels:POS,values:POS.map(pos=>{const c=ps.find(x=>x.assignedPos===pos)||state.candidateMap.get(state.units[unitKey]?.[pos]);return c?.positionRank?.overall??c?.metrics?.overall??0;})};
    }
    if(mode==='offense'){
      const keys=['scoring','shotVolume','passing','possession','puckCare'];
      return {labels:['Scoring','Shot volume','Passing','Possession','Puck care'],values:keys.map(k=>average(ps,k)||0)};
    }
    if(mode==='defense'){
      const keys=['defense','puckCare','possession','overall','passing'];
      return {labels:['Defense','Puck care','Possession','Overall','Outlet play'],values:keys.map(k=>average(ps,k)||0)};
    }
    const keys=['scoring','shotVolume','possession','passing','defense','puckCare'];
    return {labels:['Scoring','Shot volume','Possession','Passing','Defense','Puck care'],values:keys.map(k=>average(ps,k)||0)};
  }

  function driverRows(ps){
    const keys=[['Scoring','scoring'],['Defense','defense'],['Possession','possession'],['Passing','passing'],['Shot volume','shotVolume']];
    return keys.map(([label,key])=>{
      const v=average(ps,key)||0,b=baselineMetric(key),d=v-b,p=Math.min(100,Math.abs(d)*2.2+8);
      return `<div class="hmu-driver"><span>${label}</span><div><i class="${d>=0?'pos':'neg'}" style="width:${p}%"></i></div><b class="${d>=0?'pos':'neg'}">${d>=0?'+':''}${d.toFixed(1)}</b></div>`;
    }).join('');
  }

  function receipts(ps){
    const ids=new Set(ps.map(p=>p.scoutId).filter(Boolean));
    const rel=state.relationships.filter(r=>ids.has(r.player_a_id)&&ids.has(r.player_b_id));
    if(!rel.length)return '<p>These five do not have verified together-on-ice receipts yet. This read is projection-only.</p>';
    const gp=rel.reduce((a,r)=>a+(Number(r.games_sample)||0),0),avg=rel.reduce((a,r)=>a+(Number(r.chemistry_score)||0),0)/rel.length;
    return `<p>${rel.length} verified pair receipt${rel.length===1?'':'s'} · ${gp} shared-game samples · chemistry ${avg.toFixed(1)}.</p>`;
  }

  function playerRows(unitKey){
    const u=state.units[unitKey]||{};
    return POS.map(pos=>{
      const c=state.candidateMap.get(u[pos]);if(!c)return '';
      const s=c.stats||{},pre=c.pre||{},career=pre.career_snapshot||{},last=career.latest_stats||{};
      const gp=num(s.games_played,last.gp),pts=num(s.points),ppg=num(gp&&pts!=null?pts/gp:null,last.ppg);
      return `<div class="hmu-player-row"><div><b>${esc(c.name)}</b><span>${esc(pos)} · ${esc(c.pos||'?')}</span></div><div><strong>${ppg!=null?ppg.toFixed(2)+' PPG':'projection'}</strong><small>${gp!=null?gp+' GP · ':''}${c.positionRank.overall!=null?c.positionRank.overall+'th pct '+( ['LD','RD','D'].includes(c.pos)?'D':'F'):'data building'}</small></div></div>`;
    }).join('');
  }

  function modalContent(unitKey,mode){
    const ps=unitPlayers(unitKey),rd=readData(unitKey,mode);
    return `
      <div class="hmu-read-tabs">
        ${['line','overall','offense','defense'].map(x=>`<button data-hmu-mode="${x}" class="${x===mode?'active':''}">${x==='line'?'Line skills':x[0].toUpperCase()+x.slice(1)}</button>`).join('')}
      </div>
      <section class="hmu-read-card">
        <div class="eyebrow">THE SHAPE OF THIS FIVE</div>
        ${ps.length?svgRadar(rd.labels,rd.values):'<div class="hmu-empty">Fill the unit to generate a line shape.</div>'}
        <small class="hmu-read-note">0–100 values are Wildman projections from imported performance, role/rank evidence and current scouting data. Missing measures are clearly projection-weighted rather than presented as measured fact.</small>
      </section>
      <section class="hmu-read-card"><div class="eyebrow">WHAT DRIVES IT</div>${driverRows(ps)}</section>
      <section class="hmu-read-card"><div class="eyebrow">TOGETHER ON ICE · RECEIPTS</div><div class="hmu-receipts">${receipts(ps)}</div></section>
      <section class="hmu-read-card"><div class="eyebrow">PLAYERS</div><div class="hmu-player-list">${playerRows(unitKey)}</div></section>`;
  }

  function openRead(unitKey){
    const modal=$('hmuModal');if(!modal)return;
    $('hmuModalSub').textContent='CALGARY HITMEN · '+unitKey.replace('unit','UNIT ');
    $('hmuModalTitle').textContent=unitKey.replace('unit','Unit ')+' Intelligence';
    $('hmuModalBody').innerHTML=modalContent(unitKey,'line');
    modal.hidden=false;document.body.classList.add('hmu-open');
    bindReadTabs(unitKey);
  }
  function bindReadTabs(unitKey){
    $('hmuModalBody').querySelectorAll('[data-hmu-mode]').forEach(b=>b.onclick=()=>{
      $('hmuModalBody').innerHTML=modalContent(unitKey,b.dataset.hmuMode);bindReadTabs(unitKey);
    });
  }
  function closeModal(){const m=$('hmuModal');if(m)m.hidden=true;document.body.classList.remove('hmu-open');}

  function suggestLines(){
    const used=new Set(),units=blankUnits();
    const score=c=>c.metrics.overall;
    for(let i=1;i<=3;i++){
      for(const pos of POS){
        const pool=state.candidates.filter(c=>c.pos===pos&&!used.has(c.key)).sort((a,b)=>score(b)-score(a));
        const pick=pool[0];if(pick){units['unit'+i][pos]=pick.key;used.add(pick.key);}
      }
    }
    state.units=units;
    const gs=state.candidates.filter(c=>c.pos==='G').sort((a,b)=>b.metrics.overall-a.metrics.overall).slice(0,2);
    state.goalies=gs.map(g=>g.key);
    renderAll();status('Suggested lines built from position fit + Wildman overall projection. Review before saving.');
  }

  async function savePlan(){
    if(!writable())return status('Owner, GM or AGM access is required to save.',true);
    const uid=st().user?.id;if(!uid)return;
    const row={
      team_id:TEAM,season:SEASON,plan_type:state.type,label:$('hmuLabel').value.trim()||null,
      baseline_mode:state.baseline,salary_cap:state.salaryCap,units:state.units,goalies:state.goalies,
      reserves:[],updated_by:uid,updated_at:new Date().toISOString()
    };
    const existing=state.plans[state.type];
    try{
      status('Saving shared Unit Lab plan…');
      let r;
      if(existing)r=await db().from('hitmen_unit_plans').update(row).eq('id',existing.id).select('*').single();
      else r=await db().from('hitmen_unit_plans').insert({...row,created_by:uid}).select('*').single();
      if(r.error)throw r.error;
      state.plans[state.type]=r.data;
      status('Shared '+state.type.replace('_','-')+' unit plan saved ✓');
    }catch(e){status(e.message||'Could not save unit plan.',true);}
  }

  function switchType(type){
    if(!TYPES.includes(type))return;
    state.type=type;
    const p=state.plans[type];
    state.units=p?.units||blankUnits();
    state.goalies=Array.isArray(p?.goalies)?p.goalies:[null,null];
    state.baseline=p?.baseline_mode||'league_average';
    state.salaryCap=Number(p?.salary_cap)||30000000;
    $('hmuLabel').value=p?.label||'';
    renderAll();
    status((p?'Loaded saved ':'New ')+type.replace('_','-')+' view.');
  }

  function status(text,bad=false){
    const e=$('hmuStatus');if(!e)return;e.textContent=text;e.classList.toggle('bad',bad);
  }

  async function load(){
    if(state.loading||!db()||!st().user||!role())return;
    state.loading=true;status('Loading Calgary lineup intelligence…');
    try{
      const [bidsR,poolR,plansR,relsR]=await Promise.all([
        db().from('team_bid_board').select('scouting_player_id,target_price,max_price,priority,status,plan,note').eq('team_id',TEAM),
        db().from('team_scouting_pool').select('id,scouting_player_id,status,priority,projected_role,market_price,market_details,scouting_players(id,gamertag,primary_position,platform)').eq('team_id',TEAM).in('status',['watch','priority','bid_target']).range(0,999),
        db().from('hitmen_unit_plans').select('*').eq('team_id',TEAM).eq('season',SEASON),
        db().from('scouting_player_relationships').select('player_a_id,player_b_id,season,games_sample,chemistry_score,shared_metrics,notes').limit(1000)
      ]);
      for(const r of [bidsR,poolR,plansR,relsR])if(r.error)throw r.error;
      const bidMap=new Map((bidsR.data||[]).map(x=>[x.scouting_player_id,x]));
      const targetIds=new Set((bidsR.data||[]).map(x=>x.scouting_player_id));
      const pool=(poolR.data||[]).filter(x=>targetIds.has(x.scouting_player_id)||['watch','priority','bid_target'].includes(x.status));
      const scoutIds=[...new Set(pool.map(x=>x.scouting_player_id))];
      let stats=[],pres=[];
      if(scoutIds.length){
        const [sR,pR]=await Promise.all([
          db().from('scouting_season_stats').select('*').in('scouting_player_id',scoutIds).order('imported_at',{ascending:false}),
          db().from('team_pre_scout_reports').select('scouting_player_id,archetype,career_snapshot,market_snapshot,strengths,risks,confidence,summary').eq('team_id',TEAM).in('scouting_player_id',scoutIds)
        ]);
        if(sR.error)throw sR.error;if(pR.error)throw pR.error;stats=sR.data||[];pres=pR.data||[];
      }
      const latestStats=new Map();for(const s of stats)if(!latestStats.has(s.scouting_player_id))latestStats.set(s.scouting_player_id,s);
      const preMap=new Map(pres.map(x=>[x.scouting_player_id,x]));
      const candidates=[];
      const seen=new Set();
      for(const p of pool){
        const sp=p.scouting_players||{},name=sp.gamertag||'Unknown',nameKey=norm(name);
        if(seen.has(nameKey))continue;
        seen.add(nameKey);
        candidates.push({
          key:'s:'+p.scouting_player_id,kind:'scout',id:p.scouting_player_id,scoutId:p.scouting_player_id,name,
          pos:canonPos(sp.primary_position),platform:sp.platform||'',pool:p,bid:bidMap.get(p.scouting_player_id)||null,
          pre:preMap.get(p.scouting_player_id)||null,stats:latestStats.get(p.scouting_player_id)||null,rosterRatings:null
        });
      }
      finalizeScores(candidates);
      state.candidates=candidates;state.candidateMap=new Map(candidates.map(c=>[c.key,c]));
      state.relationships=relsR.data||[];
      state.plans={};for(const p of plansR.data||[])state.plans[p.plan_type]=p;
      const current=state.plans[state.type];
      state.units=current?.units||blankUnits();state.goalies=Array.isArray(current?.goalies)?current.goalies:[null,null];
      state.baseline=current?.baseline_mode||'league_average';state.salaryCap=Number(current?.salary_cap)||30000000;
      $('hmuLabel').value=current?.label||'';
      renderAll();
      const counts=POS.map(p=>p+': '+candidates.filter(c=>c.pos===p).length).join(' · ');
      status(`${candidates.length} Watch/Bid candidates loaded · ${counts}`);
      ensureRealtime();
    }catch(e){console.error(e);status(e.message||'Could not load Unit Lab.',true);}
    finally{state.loading=false;}
  }

  function ensureRealtime(){
    if(state.realtime||!db()?.channel)return;
    state.realtime=db().channel('hitmen-unit-lab-'+TEAM)
      .on('postgres_changes',{event:'*',schema:'public',table:'hitmen_unit_plans',filter:'team_id=eq.'+TEAM},scheduleReload)
      .on('postgres_changes',{event:'*',schema:'public',table:'team_bid_board',filter:'team_id=eq.'+TEAM},scheduleReload)
      .on('postgres_changes',{event:'*',schema:'public',table:'roster_entries',filter:'team_id=eq.'+TEAM},scheduleReload)
      .subscribe();
  }
  function scheduleReload(){clearTimeout(state.reloadTimer);state.reloadTimer=setTimeout(load,700);}

  function start(){if(!inject())return;load();}
  const obs=new MutationObserver(()=>{if(inject()&&st().user&&role()){load();obs.disconnect();}});
  window.addEventListener('vvhl-auth-change',()=>setTimeout(load,100));
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{start();obs.observe(document.body,{subtree:true,childList:true});});
  else{start();obs.observe(document.body,{subtree:true,childList:true});}
})();