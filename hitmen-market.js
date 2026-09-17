(() => {
  const root=document.getElementById('hitmenMarket'), db=()=>window.VVHLBackend.db, auth=()=>window.VVHLBackend.state;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=v=>new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD',maximumFractionDigits:0}).format(v);
  let team='',players=[],targets=[],reports=[],reviews=[],selected='',version=null,dirty=false,busy=false,last='',lastFetch=0,generation=0;
  const $=id=>document.getElementById(id);
  const options=(values,current)=>values.map(v=>`<option value="${esc(v)}" ${v===current?'selected':''}>${esc(v)}</option>`).join('');
  const checked=r=>{if(r.error)throw r.error;return r.data;};
  const note=s=>{$('marketMessage').textContent=s;};
  const status=p=>p.status==='unavailable'?'unavailable':p.missing_from_source?'unverified':(targets.find(t=>t.player_key===p.key)?.eligibility||'unverified');
  function shell(){
    root.innerHTML=`<div class="eyebrow">SEASON 55 · SHARED MANAGEMENT</div><h2>Hitmen Bidding Board</h2>
    <p>LG signups are the starting pool. Eligibility must be confirmed before bidding. Rostered players stay in history with your notes.</p>
    <div id="marketCap" class="hitmen-status"></div><p id="marketMessage" role="status">Loading shared board…</p>
    <div class="hitmen-actions"><button id="marketSync" class="small-btn">Refresh LG data</button><span id="marketUpdated"></span></div>
    <div class="hitmen-toolbar" style="display:flex;flex-wrap:wrap;gap:10px;margin:16px 0">
    <input id="marketSearch" class="field" type="search" placeholder="Search player name" aria-label="Search player name">
    <select id="marketPosition" class="field" aria-label="Position">${options(['All positions','LW','C','RW','LD','RD','G'])}</select>
    <select id="marketAvailability" class="field" aria-label="Eligibility">${options(['Unsigned / unverified','All players','Confirmed eligible','Unavailable'])}</select>
    <select id="marketPriority" class="field" aria-label="Board priority">${options(['All priorities','watch','target','pass'])}</select>
    <select id="marketServer" class="field" aria-label="Server">${options(['All servers','East','Central','West'])}</select></div>
    <p id="marketCount"></p><div class="hitmen-grid"><div id="marketPlayers" style="max-height:650px;overflow:auto"></div><section id="marketDetail" aria-label="Player details">Select a player to plan bids or record scouting.</section></div>`;
    ['marketSearch','marketPosition','marketAvailability','marketPriority','marketServer'].forEach(id=>$(id).addEventListener('input',renderList));
    $('marketSync').onclick=()=>sync();
  }
  function renderList(){
    const query=$('marketSearch').value.trim().toLowerCase(),pos=$('marketPosition').value,avail=$('marketAvailability').value,priority=$('marketPriority').value,server=$('marketServer').value;
    const visible=players.filter(p=>p.name.toLowerCase().includes(query)&&(pos==='All positions'||p.position===pos)&&(server==='All servers'||p.server===server)&&(priority==='All priorities'||targets.find(t=>t.player_key===p.key)?.priority===priority)&&(avail==='All players'||(avail==='Unavailable'?['unavailable','ineligible'].includes(status(p)):avail==='Confirmed eligible'?status(p)==='confirmed':!['unavailable','ineligible'].includes(status(p)))));
    $('marketCount').textContent=`${visible.length} matching players · displaying up to 100; narrow search for more`;
    $('marketPlayers').innerHTML=visible.slice(0,100).map(p=>`<button class="hitmen-player" style="width:100%;text-align:left;color:inherit" data-player="${esc(p.key)}"><span><strong>${esc(p.name)}</strong><small>${esc(p.position)} · ${esc(p.server||'Server unknown')} · ${esc(p.team||p.platform||'Signup')}</small><small>${status(p)==='confirmed'?'Eligibility confirmed by management':status(p)==='unavailable'?'Rostered / unavailable':status(p)==='ineligible'?'Marked ineligible':'Eligibility unverified'}</small></span><b>${targets.find(t=>t.player_key===p.key)?.priority==='target'?'TARGET':'VIEW'}</b></button>`).join('')||'<p>No players match these filters.</p>';
    $('marketPlayers').querySelectorAll('[data-player]').forEach(b=>b.onclick=()=>{if(dirty&&!confirm('Discard unsaved player changes?'))return;selected=b.dataset.player;dirty=false;renderDetail();});
    const roster=players.filter(p=>p.team==='Calgary Hitmen'&&!p.training_camp),spent=roster.reduce((s,p)=>s+(p.salary||0),0),planned=targets.filter(t=>t.priority==='target'&&!['unavailable','ineligible'].includes(status(players.find(p=>p.key===t.player_key)||{})));
    const targetTotal=planned.reduce((s,t)=>s+t.target_bid,0),maxTotal=planned.reduce((s,t)=>s+t.max_bid,0);
    $('marketCap').textContent=last?`Cap $30,000,000 · LG roster spend ${money(spent)} · Remaining ${money(30000000-spent)} · Planned ${money(targetTotal)} · After planned ${money(30000000-spent-targetTotal)} · At all bid limits ${money(30000000-spent-maxTotal)} · Roster ${roster.length}/17${30000000-spent-maxTotal<0?' · WARNING: maximum bids exceed cap':''}${roster.length+planned.length>17?' · WARNING: targets exceed roster slots':''}`:'Cap plan awaiting a successful LG import.';
    $('marketUpdated').textContent=last?`LG snapshot: ${new Date(last).toLocaleString()} · refresh every 5 minutes while open`:'No successful LG import yet';
  }
  function renderDetail(){
    const p=players.find(p=>p.key===selected);if(!p)return;
    const t=targets.find(t=>t.player_key===selected)||{};version=t.updated_at||null;
    const history=reports.filter(r=>r.player_key===selected),games=new Set(history.map(r=>r.review_id).filter(Boolean));
    $('marketDetail').innerHTML=`<h3>${esc(p.name)}</h3><p>${esc(p.position)} · ${esc(p.team||'No CHL roster match')} ${p.lg_id?`· LG ID ${p.lg_id}`:'· Identity awaiting LG ID match'}</p>
    <form id="marketPlan"><label>Priority<select class="field" name="priority">${options(['watch','target','pass'],t.priority||'watch')}</select></label>
    <label>Target bid ($)<input class="field" name="target_bid" type="number" min="0" max="30000000" step="1" value="${t.target_bid||0}" required></label>
    <label>Maximum bid ($)<input class="field" name="max_bid" type="number" min="0" max="30000000" step="1" value="${t.max_bid||0}" required></label>
    <label>Eligibility<select class="field" name="eligibility">${options(['unverified','confirmed','ineligible'],t.eligibility||'unverified')}</select></label>
    <label>Eligibility evidence<input class="field" name="eligibility_note" value="${esc(t.eligibility_note||'')}" placeholder="Source / date checked"></label>
    <label>Shared notes<textarea class="field" name="notes">${esc(t.notes||'')}</textarea></label><button class="small-btn primary">Save shared plan</button></form>
    <h3>Scouting history</h3><p>${history.length} reports · ${games.size} linked game reviews</p>
    <form id="marketReport"><label>Link game review<select class="field" name="review_id"><option value="">General observation</option>${reviews.map(r=>`<option value="${r.id}">${esc(r.title)} · ${esc(r.game_date)}</option>`).join('')}</select></label><label>Summary<textarea class="field" name="summary" required></textarea></label><label>Strengths<textarea class="field" name="strengths"></textarea></label><label>Concerns<textarea class="field" name="concerns"></textarea></label><button class="small-btn">Add scouting report</button></form>
    ${history.map(r=>{const review=reviews.find(v=>v.id===r.review_id);return `<article><small>${new Date(r.created_at).toLocaleString()}</small><p>${esc(r.summary)}</p><p>Strengths: ${esc(r.strengths||'—')}</p><p>Concerns: ${esc(r.concerns||'—')}</p>${review?`<details><summary>${esc(review.title)} — game report</summary><p>${esc(review.full_game_summary||'Game analysis pending.')}</p><a href="vod-lab.html?team=calgary-hitmen&review=${review.id}">Open game review</a></details>`:''}</article>`;}).join('')}`;
    $('marketDetail').querySelectorAll('label').forEach(el=>{el.style.display='block';el.style.marginBottom='10px';});
    $('marketDetail').querySelectorAll('.field').forEach(el=>el.style.width='100%');
    $('marketDetail').oninput=()=>{dirty=true;};
    $('marketPlan').onsubmit=savePlan;$('marketReport').onsubmit=saveReport;
  }
  async function savePlan(e){e.preventDefault();const data=Object.fromEntries(new FormData(e.target));data.target_bid=Number(data.target_bid);data.max_bid=Number(data.max_bid);
    if(data.max_bid<data.target_bid)return note('Maximum bid must be at least the target bid.');
    if(data.eligibility==='confirmed'&&!data.eligibility_note.trim())return note('Add the source/date used to confirm eligibility.');
    data.updated_at=new Date().toISOString();data.team_id=team;data.player_key=selected;data.season=55;
    try{const result=version?await db().from('hitmen_bid_targets').update(data).eq('team_id',team).eq('season',55).eq('player_key',selected).eq('updated_at',version).select():await db().from('hitmen_bid_targets').insert(data).select();const rows=checked(result);if(!rows.length)throw Error('Another manager changed this player. Reopen the player before saving.');dirty=false;await load();renderDetail();note('Shared plan saved for Hitmen management.');}catch(err){note(err.message);}
  }
  async function saveReport(e){e.preventDefault();const data=Object.fromEntries(new FormData(e.target));data.review_id=data.review_id||null;
    try{checked(await db().from('hitmen_player_reports').insert({...data,team_id:team,player_key:selected,season:55}));dirty=false;await load();renderDetail();note('Scouting report saved.');}catch(err){note(err.message);}}
  async function load(){const token=generation;const result=await Promise.all([db().from('hitmen_market_snapshots').select('*').eq('team_id',team).maybeSingle(),db().from('hitmen_bid_targets').select('*').eq('team_id',team).eq('season',55),db().from('hitmen_player_reports').select('*').eq('team_id',team).eq('season',55).order('created_at',{ascending:false}),db().from('vod_review_sessions').select('id,title,game_date,full_game_summary').eq('team_id',team).order('game_date',{ascending:false})]);const [snapshot,t,r,v]=result.map(checked);if(token!==generation)return;if(snapshot){players=snapshot.payload.players;last=snapshot.fetched_at;}targets=t;reports=r;reviews=v;renderList();}
  async function sync(){if(busy||!team)return;busy=true;const token=generation;note('Checking LG signups and CHL rosters…');
    try{const response=await fetch('/api/hitmen-market');const payload=await response.json();if(!response.ok)throw Error(payload.error);if(token!==generation)return;
      const previous=players;
      payload.players=payload.players.map(p=>{const matches=previous.filter(old=>p.lg_id&&old.lg_id===p.lg_id);return matches.length===1?{...p,key:matches[0].key}:p;});
      const keys=new Set(payload.players.map(p=>p.key));
      for(const old of previous)if(!keys.has(old.key))payload.players.push({...old,status:'unverified',team:null,salary:null,missing_from_source:true});
      checked(await db().from('hitmen_market_snapshots').upsert({team_id:team,season:55,payload,fetched_at:payload.fetched_at}));lastFetch=Date.now();await load();note('LG data updated. Unmatched players remain unverified.');
    }catch(err){note('Refresh failed; keeping the last saved snapshot. '+err.message);}finally{busy=false;}}
  async function initialize(){generation++;team='';players=[];targets=[];reports=[];reviews=[];selected='';dirty=false;root.hidden=true;
    if(!auth()?.user)return;
    try{const t=checked(await db().from('teams').select('id').eq('name','Calgary Hitmen').maybeSingle());if(!t)return;
      if(auth().profile?.role!=='admin'&&!auth().memberships.some(m=>m.team_id===t.id&&m.active!==false&&['owner','gm','agm'].includes(m.role)))return;
      team=t.id;root.hidden=false;shell();await load();note('Shared board ready. LG eligibility is separate from signup status.');if(!last||Date.now()-new Date(last).getTime()>300000)await sync();
    }catch(err){if($('marketMessage'))note(err.message);}}
  window.addEventListener('vvhl-auth-change',initialize);
  setInterval(()=>{if(!team||document.hidden)return;load().catch(e=>note('Shared refresh failed: '+e.message));if(Date.now()-Math.max(lastFetch,new Date(last||0).getTime())>300000)sync();},30000);
  if(auth()?.user)initialize();
})();
