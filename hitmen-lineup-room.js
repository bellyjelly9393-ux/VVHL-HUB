(() => {
const TEAM='b0bcbdda-da9d-419d-8f61-b34937966d49',SEASON=55;
const POSITIONS=['LW','C','RW','LD','RD','G'];
const LINES=['L1','L2'];
const E=id=>document.getElementById(id),DB=()=>window.VVHLBackend?.db,ST=()=>window.VVHLBackend?.state||{};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const role=()=>{const s=ST(),p=String(s.profile?.role||'').toLowerCase();if(['admin','commissioner'].includes(p))return p;return String((s.memberships||[]).find(m=>m.team_id===TEAM&&m.active!==false)?.role||'').toLowerCase()};
const writable=()=>['admin','commissioner','owner','gm','agm'].includes(role());
const S={lockers:[],snapshots:[],opponents:[],schedule:[],lineups:[],availability:[],slots:{},current:null,lastAnalysis:null,lastAnalysisMeta:null};

function msg(text,bad=false){const x=E('lineupStatus');if(x){x.textContent=text;x.classList.toggle('error',bad)}}
function aiMsg(text){if(E('lineupAiStatus'))E('lineupAiStatus').textContent=text}
function lockerByPlayer(id){return S.lockers.find(x=>x.player_id===id)}
function snap(l){return S.snapshots.find(x=>x.id===l?.roster_snapshot_id)||{}}
function isTc(l){return l?.roster_class==='tc'||String(snap(l).acquisition||'').toLowerCase()==='prospect'}
function label(l){return l?l.gamertag+' · '+(l.position||'?')+(isTc(l)?' · TC':''):''}
function selectedIds(){return new Set(Object.values(S.slots).filter(Boolean))}
function fmtDate(v){return v?new Date(v).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'TBD'}
function currentGame(){
 const opp=E('lineupOpponent')?.value,date=E('lineupGameDate')?.value;
 return S.schedule.find(g=>g.opponent_name===opp&&(!date||String(g.scheduled_at||'').slice(0,10)===date))||
        S.schedule.find(g=>g.opponent_name===opp&&g.status==='scheduled')||null;
}
function playerOptions(slot){
 const pos=slot.split('_')[1];
 const rows=[...S.lockers].sort((a,b)=>{
   const am=a.position===pos?0:1,bm=b.position===pos?0:1;
   return am-bm+(isTc(a)-isTc(b))||a.gamertag.localeCompare(b.gamertag)
 });
 return '<option value="">Empty '+pos+'</option>'+
 rows.map(l=>'<option value="'+esc(l.player_id)+'">'+esc(label(l))+'</option>').join('');
}
function slotCard(line,pos){
 const key=line+'_'+pos,id=S.slots[key]||'',l=lockerByPlayer(id);
 return '<label class="hm-line-slot '+(l&&isTc(l)?'is-tc':'')+'" data-slot="'+key+'"><span class="hm-line-pos">'+pos+'</span>'+
 '<select class="select-field" data-line-slot="'+key+'">'+playerOptions(key)+'</select>'+
 '<small>'+(l?esc((isTc(l)?'TC · ':'')+(l.management_role||snap(l).acquisition||'Roster')):'Choose player')+'</small></label>';
}
function renderLines(){
 const root=E('lineupLines');if(!root)return;
 root.innerHTML=LINES.map((line,ix)=>'<article class="hm-line-board"><div class="hm-line-title"><div><small>UNIT '+(ix+1)+'</small><h3>LINE '+(ix+1)+'</h3></div><span>LW · C · RW · LD · RD · G</span></div><div class="hm-line-forwards">'+['LW','C','RW'].map(p=>slotCard(line,p)).join('')+'</div><div class="hm-line-defense">'+['LD','RD'].map(p=>slotCard(line,p)).join('')+'</div><div class="hm-line-goalie">'+slotCard(line,'G')+'</div></article>').join('');
 root.querySelectorAll('[data-line-slot]').forEach(sel=>{
   const key=sel.dataset.lineSlot;sel.value=S.slots[key]||'';
   sel.onchange=()=>{
     const id=sel.value;
     if(id){
       for(const [k,v] of Object.entries(S.slots)){if(k!==key&&v===id){sel.value=S.slots[key]||'';return msg('That player is already used in '+k.replace('_',' ')+'.',true)}}
       S.slots[key]=id;
     }else delete S.slots[key];
     renderLines();renderDepth();updateBattleLink();
   };
 });
}
function renderDepth(){
 const root=E('lineupDepth');if(!root)return;
 const used=selectedIds();
 const remaining=S.lockers.filter(l=>!used.has(l.player_id)).sort((a,b)=>(isTc(a)-isTc(b))||a.position.localeCompare(b.position)||a.gamertag.localeCompare(b.gamertag));
 root.innerHTML=remaining.length?remaining.map(l=>'<div class="hm-depth-player '+(isTc(l)?'is-tc':'')+'"><span><b>'+esc(l.gamertag)+'</b><small>'+esc(l.position||'—')+' · '+(isTc(l)?'TC':'SCRATCH / DEPTH')+(l.management_role?' · '+esc(l.management_role):'')+'</small></span><em>'+(isTc(l)?'TC':'DEPTH')+'</em></div>').join(''):'<div class="empty-state">Every available player is currently placed in a unit.</div>';
}
function dateAvailability(l){
 const date=E('lineupGameDate')?.value;
 return S.availability.find(a=>a.player_id===l.player_id&&a.game_date===date)||null;
}
function renderAvailability(){
 const root=E('lineupAvailability');if(!root)return;
 const date=E('lineupGameDate')?.value;
 if(!date){root.innerHTML='<div class="empty-state">Choose a game date to manage availability.</div>';return}
 root.innerHTML=S.lockers.map(l=>{const a=dateAvailability(l)||{},st=a.status||l.availability_status||'unknown';return '<div class="hm-avail-line" data-av-player="'+l.player_id+'"><span><b>'+esc(l.gamertag)+'</b><small>'+esc(l.position||'—')+(isTc(l)?' · TC':'')+'</small></span><select data-av-status><option value="unknown" '+(st==='unknown'?'selected':'')+'>Unknown</option><option value="available" '+(st==='available'?'selected':'')+'>Available</option><option value="maybe" '+(st==='maybe'?'selected':'')+'>Questionable</option><option value="unavailable" '+(st==='unavailable'?'selected':'')+'>Unavailable</option></select><input data-av-note value="'+esc(a.note||'')+'" placeholder="Note"><button data-av-save '+(writable()?'':'disabled')+'>Save</button></div>'}).join('');
 root.querySelectorAll('[data-av-save]').forEach(b=>b.onclick=()=>saveAvailability(b.closest('[data-av-player]')));
}
async function saveAvailability(row){
 const playerId=row.dataset.avPlayer,date=E('lineupGameDate').value,status=row.querySelector('[data-av-status]').value,note=row.querySelector('[data-av-note]').value.trim();
 if(!writable()||!date)return;
 const payload={player_id:playerId,team_id:TEAM,game_date:date,status,note:note||null,updated_by:ST().user.id,updated_at:new Date().toISOString()};
 const r=await DB().from('player_availability').upsert(payload,{onConflict:'player_id,game_date'}).select('*').single();
 if(r.error)return msg(r.error.message,true);
 const i=S.availability.findIndex(x=>x.player_id===playerId&&x.game_date===date);if(i>=0)S.availability[i]=r.data;else S.availability.push(r.data);
 msg('Availability saved.');renderAvailability();
}
function renderOpponentOptions(){
 const sel=E('lineupOpponent');if(!sel)return;
 const current=sel.value;
 const names=[...new Set(S.opponents.map(o=>o.opponent_name).concat(S.schedule.map(g=>g.opponent_name)).filter(Boolean))].sort();
 sel.innerHTML='<option value="">Choose opponent…</option>'+names.map(n=>'<option value="'+esc(n)+'">'+esc(n)+'</option>').join('');
 if(names.includes(current))sel.value=current;
}
function renderSaved(){
 const root=E('savedLineups');if(!root)return;
 E('lineupSavedCount').textContent=S.lineups.length;
 root.innerHTML=S.lineups.length?S.lineups.map(l=>'<article class="hm-saved-plan '+(l.is_active?'active':'')+'"><div><small>'+(l.is_active?'ACTIVE · ':'')+esc(String(l.status||'draft').toUpperCase())+'</small><h3>'+esc(l.game_label||'Hitmen lineup')+'</h3><p>'+esc(l.opponent_name||'Opponent TBD')+' · '+esc(l.game_date||'No date')+'</p></div><div><button data-load-lineup="'+l.id+'">Load</button>'+(writable()?'<button data-copy-lineup="'+l.id+'">Duplicate</button>':'')+'</div></article>').join(''):'<div class="empty-state">No saved post-bidding lineups yet.</div>';
 root.querySelectorAll('[data-load-lineup]').forEach(b=>b.onclick=()=>loadSaved(b.dataset.loadLineup,false));
 root.querySelectorAll('[data-copy-lineup]').forEach(b=>b.onclick=()=>loadSaved(b.dataset.copyLineup,true));
}
function loadSaved(id,copy){
 const l=S.lineups.find(x=>x.id===id);if(!l)return;
 S.current=copy?null:id;S.slots={};
 E('lineupLabel').value=(l.game_label||'')+(copy?' copy':'');E('lineupGameDate').value=l.game_date||'';E('lineupOpponent').value=l.opponent_name||'';E('lineupPlanStatus').value=copy?'draft':(l.status||'draft');E('lineupNotes').value=l.notes||'';
 (l.lineup_slots||[]).filter(x=>/^L[12]_/.test(x.slot)).forEach(x=>{if(x.player_id)S.slots[x.slot]=x.player_id});
 renderLines();renderDepth();renderAvailability();updateBattleLink();msg(copy?'Duplicate draft ready.':'Saved lineup loaded.');
}
function reset(){
 S.current=null;S.slots={};E('lineupLabel').value='';E('lineupGameDate').value='';E('lineupOpponent').value='';E('lineupPlanStatus').value='draft';E('lineupNotes').value='';S.lastAnalysis=null;S.lastAnalysisMeta=null;
 renderLines();renderDepth();renderAvailability();E('lineupAiAnswer').innerHTML='<div class="empty-state">Choose an opponent and build at least one complete line.</div>';E('savePregameReport').disabled=true;updateBattleLink();msg('New lineup draft ready.');
}
async function refreshLineups(){
 const r=await DB().from('lineups').select('*,lineup_slots(*)').eq('team_id',TEAM).eq('league','LGCHL').neq('lineup_type','bidding').order('updated_at',{ascending:false});
 if(r.error)throw r.error;S.lineups=r.data||[];renderSaved();
}
async function saveLineup(setActive=false){
 if(!writable())return msg('Owner, GM or AGM access is required to save lineups.',true);
 const uid=ST().user?.id;if(!uid)return;
 const game=currentGame();
 const base={team_id:TEAM,league:'LGCHL',game_date:E('lineupGameDate').value||null,game_label:E('lineupLabel').value.trim()||'Calgary Hitmen lineup',notes:E('lineupNotes').value.trim()||null,status:E('lineupPlanStatus').value,lineup_type:'game',week_label:null,salary_cap:null,opponent_name:E('lineupOpponent').value||null,schedule_game_id:game?.id||null,is_active:Boolean(setActive),updated_by:uid,updated_at:new Date().toISOString()};
 try{
   let id=S.current;
   if(setActive)await DB().from('lineups').update({is_active:false,updated_by:uid,updated_at:new Date().toISOString()}).eq('team_id',TEAM).eq('league','LGCHL');
   let r;
   if(id)r=await DB().from('lineups').update(base).eq('id',id).eq('team_id',TEAM).select('id').single();
   else{base.created_by=uid;r=await DB().from('lineups').insert(base).select('id').single();if(!r.error){id=r.data.id;S.current=id}}
   if(r.error)throw r.error;
   const del=await DB().from('lineup_slots').delete().eq('lineup_id',id);if(del.error)throw del.error;
   const rows=[];let order=0;
   for(const line of LINES)for(const pos of POSITIONS){const pid=S.slots[line+'_'+pos];if(pid){const l=lockerByPlayer(pid),a=dateAvailability(l);rows.push({lineup_id:id,slot:line+'_'+pos,sort_order:order++,player_id:pid,availability_status:a?.status||l?.availability_status||'unknown',note:isTc(l)?'TC call-up':null})}}
   const used=selectedIds();let s=1,tc=1;
   S.lockers.filter(l=>!used.has(l.player_id)).forEach(l=>rows.push({lineup_id:id,slot:(isTc(l)?'TC'+tc++:'S'+s++),sort_order:order++,player_id:l.player_id,availability_status:dateAvailability(l)?.status||l.availability_status||'unknown',note:isTc(l)?'TC depth':'Scratch / depth'}));
   if(rows.length){r=await DB().from('lineup_slots').insert(rows);if(r.error)throw r.error}
   await refreshLineups();msg(setActive?'Lineup saved and set ACTIVE.':'Lineup saved.');
 }catch(e){console.error(e);msg(e.message||'Could not save lineup.',true)}
}
function completeLines(){
 return LINES.filter(line=>POSITIONS.every(pos=>S.slots[line+'_'+pos]));
}
function lineupScenario(){
 const opp=E('lineupOpponent').value,game=currentGame(),complete=completeLines();
 const lines=LINES.map(line=>line+': '+POSITIONS.map(pos=>pos+' '+(lockerByPlayer(S.slots[line+'_'+pos])?.gamertag||'EMPTY')).join(' | ')).join('\n');
 const depth=S.lockers.filter(l=>!selectedIds().has(l.player_id)).map(l=>l.gamertag+' ('+l.position+(isTc(l)?', TC':'')+')').join(', ');
 return {opp,game,complete,text:'Calgary Hitmen Season 55 lineup for '+(opp||'opponent TBD')+'.\n'+lines+'\nDepth / scratches: '+depth+'.\nGame date: '+(E('lineupGameDate').value||'unknown')+'.\nManagement notes: '+(E('lineupNotes').value||'none')+'.'};
}
function renderAi(text){
 const inline=s=>esc(s).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\[(E\d+)\]/g,'<span class="hm-ai-cite">[$1]</span>');
 E('lineupAiAnswer').innerHTML=String(text||'').split(/\r?\n/).map(line=>{const t=line.trim();if(!t)return '<div class="hm-ai-gap"></div>';if(/^###\s+/.test(t))return '<h4>'+inline(t.replace(/^###\s+/,''))+'</h4>';if(/^##\s+/.test(t))return '<h3>'+inline(t.replace(/^##\s+/,''))+'</h3>';if(/^[-*]\s+/.test(t))return '<div class="hm-ai-bullet"><span>•</span><p>'+inline(t.replace(/^[-*]\s+/,''))+'</p></div>';return '<p>'+inline(t)+'</p>'}).join('');
}
async function analyze(){
 const x=lineupScenario();if(!x.opp)return msg('Choose the opponent before analyzing.',true);if(!x.complete.length)return msg('Complete at least one full 6s line before analyzing.',true);
 const names=[...new Set(Object.values(S.slots).map(id=>lockerByPlayer(id)?.gamertag).filter(Boolean))];
 try{
   aiMsg('LOADING EVIDENCE');E('analyzeLineup').disabled=true;E('reanalyzeLineup').disabled=true;
   const {data,error}=await DB().auth.getSession();if(error)throw error;if(!data.session?.access_token)throw new Error('Sign in again before analyzing.');
   const question='Analyze this Calgary Hitmen lineup against '+x.opp+'. Give an Executive Read, line-by-line matchup implications, advantages, risks, matchup assignments, 3-5 keys to win, opponent players/tendencies to watch, and explain how the two Calgary units complement or expose each other. Separate observed evidence, inference, and recommendation. Do not invent missing data.';
   const r=await fetch('/api/chelscout-deepthink',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+data.session.access_token},body:JSON.stringify({question,playerNames:names,scenario:x.text,mode:'deep',lens:'lineup'}),signal:AbortSignal.timeout(115000)});
   const result=await r.json();if(!r.ok)throw new Error(result.error||'Analysis failed.');
   S.lastAnalysis=result.answer||'';S.lastAnalysisMeta={model:result.model||null,sources:result.sources||[],coverage:result.coverage||{},game:x.game,opponent:x.opp};
   renderAi(S.lastAnalysis);aiMsg('ANALYSIS READY');E('savePregameReport').disabled=!writable();updateBattleLink();
 }catch(e){console.error(e);E('lineupAiAnswer').innerHTML='<div class="empty-state">'+esc(e.message||'Could not analyze lineup.')+'</div>';aiMsg('ANALYSIS ERROR')}
 finally{E('analyzeLineup').disabled=false;E('reanalyzeLineup').disabled=false}
}
async function saveReport(){
 if(!writable()||!S.lastAnalysis)return;
 const meta=S.lastAnalysisMeta||{},uid=ST().user?.id;
 const payload={team_id:TEAM,season:SEASON,opponent_name:meta.opponent||E('lineupOpponent').value,scheduled_game_id:meta.game?.id||currentGame()?.id||null,model:meta.model||'Wildman Hockey Ops',report:S.lastAnalysis,evidence_summary:{coverage:meta.coverage||{},source_ids:(meta.sources||[]).map(s=>s.id),lineup_id:S.current,lineup_slots:S.slots},created_by:uid};
 const r=await DB().from('hitmen_opponent_pregame_reports').insert(payload).select('id').single();
 if(r.error)return msg(r.error.message,true);E('savePregameReport').disabled=true;msg('Pregame report saved to Calgary opponent intelligence.');updateBattleLink();
}
function updateBattleLink(){
 const opp=E('lineupOpponent')?.value||'',date=E('lineupGameDate')?.value||'';
 E('battlePlanLink').href='hitmen-battle-plan.html?opponent='+encodeURIComponent(opp)+(date?'&date='+encodeURIComponent(date):'');
}
async function load(){
 if(!DB()||!ST().user)return;
 const [lockers,snaps,opps,schedule,avail]=await Promise.all([
   DB().from('team_player_lockers').select('*').eq('team_id',TEAM).eq('season',SEASON),
   DB().from('hitmen_roster_snapshot').select('*').eq('team_id',TEAM).eq('season',SEASON).eq('active',true).order('lg_slot'),
   DB().from('hitmen_opponents').select('*').eq('team_id',TEAM).eq('season',SEASON).order('opponent_name'),
   DB().from('hitmen_schedule_games').select('*').eq('team_id',TEAM).eq('season',SEASON).order('scheduled_at'),
   DB().from('player_availability').select('*').eq('team_id',TEAM)
 ]);
 const err=[lockers,snaps,opps,schedule,avail].find(x=>x.error)?.error;if(err){console.error(err);return msg(err.message||'Could not load lineup room.',true)}
 S.lockers=(lockers.data||[]).filter(l=>l.player_id);S.snapshots=snaps.data||[];S.opponents=opps.data||[];S.schedule=schedule.data||[];S.availability=avail.data||[];
 E('lineupRosterCount').textContent=S.lockers.filter(l=>!isTc(l)).length;E('lineupTcCount').textContent=S.lockers.filter(isTc).length;
 renderOpponentOptions();await refreshLineups();renderLines();renderDepth();renderAvailability();updateBattleLink();msg('Lineup Room ready · '+S.lockers.length+' player stalls loaded.');
}
E('lineupGameDate')?.addEventListener('change',()=>{renderAvailability();updateBattleLink()});
E('lineupOpponent')?.addEventListener('change',updateBattleLink);
E('saveLineup')?.addEventListener('click',()=>saveLineup(false));
E('activateLineup')?.addEventListener('click',()=>saveLineup(true));
E('newLineup')?.addEventListener('click',reset);
E('analyzeLineup')?.addEventListener('click',analyze);
E('reanalyzeLineup')?.addEventListener('click',analyze);
E('savePregameReport')?.addEventListener('click',saveReport);
window.addEventListener('vvhl-auth-change',()=>{if(ST().user)load()});
if(ST().user)load();
})();