(() => {
const TEAM='b0bcbdda-da9d-419d-8f61-b34937966d49',SEASON=55,POSITIONS=['LW','C','RW','LD','RD','G'];
const E=id=>document.getElementById(id),DB=()=>window.VVHLBackend?.db,ST=()=>window.VVHLBackend?.state||{};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const profileRole=()=>String(ST().profile?.role||'').toLowerCase();
const memberRole=()=>String((ST().memberships||[]).find(m=>m.team_id===TEAM&&m.active!==false)?.role||'').toLowerCase();
const writable=()=>['admin','commissioner'].includes(profileRole())||['owner','gm','agm'].includes(memberRole());
const S={lockers:[],opponents:[],schedule:[],lineups:[],reports:[],plans:[],current:null};
function status(t,bad=false){const e=E('battleStatus');if(e){e.textContent=t;e.style.color=bad?'#ff8f9a':''}}
function locker(id){return S.lockers.find(x=>x.player_id===id)}
function fmt(v){return v?new Date(v).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'TBD'}
function query(){return new URLSearchParams(location.search)}
function currentGame(){
 const opp=E('opponent')?.value,date=E('gameDate')?.value;
 return S.schedule.find(g=>g.opponent_name===opp&&(!date||String(g.scheduled_at||'').slice(0,10)===date))||
        S.schedule.find(g=>g.opponent_name===opp&&g.status==='scheduled')||null;
}
function currentOpponent(){return S.opponents.find(o=>o.opponent_name===E('opponent')?.value)}
function currentReport(){
 const opp=E('opponent')?.value,date=E('gameDate')?.value,game=currentGame();
 return S.reports.filter(r=>r.opponent_name===opp)
   .sort((a,b)=>{
      const ag=game&&a.scheduled_game_id===game.id?1:0,bg=game&&b.scheduled_game_id===game.id?1:0;
      if(ag!==bg)return bg-ag;
      return new Date(b.created_at||0)-new Date(a.created_at||0);
   })[0]||null;
}
function renderOpponentOptions(){
 const sel=E('opponent'),cur=sel.value;
 const names=[...new Set(S.opponents.map(o=>o.opponent_name).concat(S.schedule.map(g=>g.opponent_name)).filter(Boolean))].sort();
 sel.innerHTML='<option value="">Choose opponent…</option>'+names.map(n=>'<option value="'+esc(n)+'">'+esc(n)+'</option>').join('');
 const wanted=query().get('opponent')||cur;if(names.includes(wanted))sel.value=wanted;
}
function renderLineupOptions(){
 const sel=E('battleLineup'),cur=sel.value;
 const opp=E('opponent')?.value,date=E('gameDate')?.value;
 const rows=[...S.lineups].sort((a,b)=>{
   const aa=(a.is_active?4:0)+(opp&&a.opponent_name===opp?2:0)+(date&&a.game_date===date?1:0);
   const bb=(b.is_active?4:0)+(opp&&b.opponent_name===opp?2:0)+(date&&b.game_date===date?1:0);
   return bb-aa||new Date(b.updated_at||0)-new Date(a.updated_at||0);
 });
 sel.innerHTML='<option value="">No lineup selected</option>'+rows.map(l=>'<option value="'+l.id+'">'+esc((l.is_active?'ACTIVE · ':'')+(l.game_label||'Hitmen lineup')+(l.opponent_name?' · '+l.opponent_name:''))+'</option>').join('');
 const preferred=rows.find(l=>l.id===cur)||rows.find(l=>l.is_active&&(!opp||l.opponent_name===opp))||rows.find(l=>opp&&l.opponent_name===opp&&(!date||l.game_date===date));
 if(preferred)sel.value=preferred.id;
 renderLineup();
}
function renderLineup(){
 const id=E('battleLineup')?.value,l=S.lineups.find(x=>x.id===id),box=E('battleLineupSummary');
 if(!l){box.innerHTML='<div class="empty-state">Select a saved lineup to load the game-night units.</div>';return}
 const slots=l.lineup_slots||[];
 box.innerHTML=['L1','L2'].map(line=>'<article><small>'+line.replace('L','LINE ')+'</small><div class="battle-unit">'+POSITIONS.map(pos=>{const s=slots.find(x=>x.slot===line+'_'+pos),p=locker(s?.player_id);return '<div><b>'+pos+'</b><span>'+esc(p?.gamertag||'EMPTY')+'</span></div>'}).join('')+'</div></article>').join('');
}
function renderReport(){
 const r=currentReport(),box=E('battleAiReport');
 if(!r){box.innerHTML='<div class="empty-state">No saved AI matchup report for this opponent yet. Run the matchup analysis from the Lineup Room first.</div>';return}
 const text=String(r.report||'').split(/\r?\n/).slice(0,45).map(line=>{const t=line.trim();if(!t)return'';if(/^#{1,3}\s/.test(t))return '<h4>'+esc(t.replace(/^#{1,3}\s+/,''))+'</h4>';if(/^[-*]\s/.test(t))return '<p>• '+esc(t.replace(/^[-*]\s+/,''))+'</p>';return '<p>'+esc(t)+'</p>'}).join('');
 box.innerHTML='<div class="battle-ai-meta"><span>'+esc(r.model||'Wildman Hockey Ops')+'</span><span>'+esc(new Date(r.created_at).toLocaleString())+'</span></div>'+text;
}
function prefillOpponent(){
 const o=currentOpponent();if(!o)return;
 if(!E('danger').value)E('danger').value=o.danger_players||'';
 if(!E('tendencies').value)E('tendencies').value=o.tendencies||'';
 if(!E('keys').value&&o.matchup_plan)E('keys').value=o.matchup_plan;
}
function renderHistory(){
 const box=E('battleHistory');
 box.innerHTML=S.plans.length?S.plans.map(p=>'<article class="battle-history-card '+(p.status==='active'?'active':'')+'"><div><small>'+esc(p.status.toUpperCase())+' · '+esc(p.game_date||'NO DATE')+'</small><h3>'+esc(p.opponent_name)+'</h3><p>'+esc(p.keys_to_win||'No keys saved yet.')+'</p></div><button data-battle-load="'+p.id+'">Open</button></article>').join(''):'<div class="empty-state">No saved Battle Plans yet.</div>';
 box.querySelectorAll('[data-battle-load]').forEach(b=>b.onclick=()=>loadPlan(b.dataset.battleLoad));
}
function loadPlan(id){
 const p=S.plans.find(x=>x.id===id);if(!p)return;S.current=id;
 E('opponent').value=p.opponent_name||'';E('gameDate').value=p.game_date||'';E('battleLineup').value=p.lineup_id||'';E('battlePlanStatus').value=p.status||'draft';
 E('danger').value=p.danger_players||'';E('tendencies').value=p.tendencies||'';E('keys').value=p.keys_to_win||'';E('matchups').value=p.matchup_assignments||'';E('reminders').value=p.reminders||'';E('managementNotes').value=p.management_notes||'';
 renderLineupOptions();renderReport();status('Battle Plan loaded.');
 window.scrollTo({top:0,behavior:'smooth'});
}
async function save(forceActive=false){
 if(!writable())return status('Owner, GM or AGM access is required to save.',true);
 const opp=E('opponent').value;if(!opp)return status('Choose an opponent first.',true);
 const uid=ST().user?.id,game=currentGame(),report=currentReport(),lineupId=E('battleLineup').value||null;
 const payload={team_id:TEAM,season:SEASON,opponent_name:opp,game_date:E('gameDate').value||null,schedule_game_id:game?.id||null,lineup_id:lineupId,ai_pregame_report_id:report?.id||null,danger_players:E('danger').value.trim()||null,tendencies:E('tendencies').value.trim()||null,keys_to_win:E('keys').value.trim()||null,matchup_assignments:E('matchups').value.trim()||null,reminders:E('reminders').value.trim()||null,management_notes:E('managementNotes').value.trim()||null,status:forceActive?'active':E('battlePlanStatus').value,updated_by:uid,updated_at:new Date().toISOString()};
 try{
   if(forceActive){const off=await DB().from('hitmen_battle_plans').update({status:'draft',updated_by:uid,updated_at:new Date().toISOString()}).eq('team_id',TEAM).eq('season',SEASON).eq('status','active');if(off.error)throw off.error}
   let r;
   if(S.current)r=await DB().from('hitmen_battle_plans').update(payload).eq('id',S.current).eq('team_id',TEAM).select('*').single();
   else{payload.created_by=uid;r=await DB().from('hitmen_battle_plans').insert(payload).select('*').single()}
   if(r.error)throw r.error;S.current=r.data.id;
   const all=await DB().from('hitmen_battle_plans').select('*').eq('team_id',TEAM).eq('season',SEASON).order('updated_at',{ascending:false});if(all.error)throw all.error;S.plans=all.data||[];
   E('battlePlanStatus').value=r.data.status;renderHistory();status(forceActive?'Battle Plan saved and set ACTIVE.':'Battle Plan saved.');
 }catch(e){console.error(e);status(e.message||'Could not save Battle Plan.',true)}
}
async function load(){
 if(!DB()||!ST().user)return;
 const [lockers,opps,schedule,lineups,reports,plans]=await Promise.all([
   DB().from('team_player_lockers').select('id,player_id,gamertag,position,roster_class').eq('team_id',TEAM).eq('season',SEASON),
   DB().from('hitmen_opponents').select('*').eq('team_id',TEAM).eq('season',SEASON).order('opponent_name'),
   DB().from('hitmen_schedule_games').select('*').eq('team_id',TEAM).eq('season',SEASON).order('scheduled_at'),
   DB().from('lineups').select('*,lineup_slots(*)').eq('team_id',TEAM).eq('league','LGCHL').neq('lineup_type','bidding').order('updated_at',{ascending:false}),
   DB().from('hitmen_opponent_pregame_reports').select('*').eq('team_id',TEAM).eq('season',SEASON).order('created_at',{ascending:false}),
   DB().from('hitmen_battle_plans').select('*').eq('team_id',TEAM).eq('season',SEASON).order('updated_at',{ascending:false})
 ]);
 const err=[lockers,opps,schedule,lineups,reports,plans].find(x=>x.error)?.error;if(err)return status(err.message||'Could not load Battle Plan.',true);
 S.lockers=lockers.data||[];S.opponents=opps.data||[];S.schedule=schedule.data||[];S.lineups=lineups.data||[];S.reports=reports.data||[];S.plans=plans.data||[];
 renderOpponentOptions();
 const q=query(),date=q.get('date');if(date)E('gameDate').value=date;
 renderLineupOptions();prefillOpponent();renderReport();renderHistory();
 const active=S.plans.find(p=>p.status==='active'&&(!E('opponent').value||p.opponent_name===E('opponent').value));
 if(active&&!q.get('opponent')&&!q.get('date'))loadPlan(active.id);
 else status('Battle Plan ready.');
}
E('opponent')?.addEventListener('change',()=>{prefillOpponent();renderLineupOptions();renderReport()});
E('gameDate')?.addEventListener('change',()=>{renderLineupOptions();renderReport()});
E('battleLineup')?.addEventListener('change',renderLineup);
E('saveBattle')?.addEventListener('click',()=>save(false));
E('activateBattle')?.addEventListener('click',()=>save(true));
window.addEventListener('vvhl-auth-change',()=>{if(ST().user)load()});if(ST().user)load();
})();