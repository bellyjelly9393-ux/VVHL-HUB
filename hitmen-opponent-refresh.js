(() => {
  const TEAM='b0bcbdda-da9d-419d-8f61-b34937966d49';
  const E=id=>document.getElementById(id), db=()=>window.VVHLBackend?.db, state=()=>window.VVHLBackend?.state||{};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let selected=null,busy=false;
  const canManage=()=>state().profile?.role==='admin'||(state().memberships||[]).some(m=>m.team_id===TEAM&&m.active!==false&&['owner','gm','agm'].includes(String(m.role).toLowerCase()));
  const date=v=>v?new Date(v).toLocaleString():'not yet';
  async function load(){
    if(!db()||!state().user||busy)return;
    busy=true;
    try{
      const r=await db().from('hitmen_opponent_refresh_runs').select('*').eq('team_id',TEAM).eq('season',55).order('requested_at',{ascending:false}).limit(1).maybeSingle();
      if(r.error)throw r.error;
      if(!r.data){E('hoiRefreshStatus').textContent='Automatic schedule is configured. No refresh run yet.';return;}
      const q=await db().from('hitmen_opponent_refresh_tasks').select('opponent_name,source,status,detail,finished_at').eq('run_id',r.data.id).order('priority');
      if(q.error)throw q.error;
      const tasks=q.data||[],counts={};tasks.forEach(t=>counts[t.status]=(counts[t.status]||0)+1);
      E('hoiRefreshStatus').textContent='Last started '+date(r.data.requested_at)+' · '+(r.data.finished_at?'Finished':'In progress')+' · '+Object.entries(counts).map(([k,v])=>v+' '+k).join(' · ')+'. Failed sources retain their last saved evidence.';
      E('hoiRefreshDetails').innerHTML=tasks.map(t=>'<p><b>'+esc(t.opponent_name==='*'?'League rosters':t.opponent_name)+'</b> · '+esc(t.source)+' · '+esc(t.status)+(t.detail?.error?' — '+esc(t.detail.error):'')+(t.detail?.warnings?.length?' — '+esc(t.detail.warnings.join('; ')):'')+(t.detail?.unmatched?.length?' · No matched season stats: '+esc(t.detail.unmatched.join(', ')):'')+'</p>').join('');
      if(selected&&E('hoiRosterChanges')){
        const s=await db().from('hitmen_opponent_source_snapshots').select('fetched_at,payload').eq('team_id',TEAM).eq('season',55).eq('opponent_name',selected.name).eq('source','lg_roster').order('fetched_at',{ascending:false}).limit(1).maybeSingle();
        if(s.error)throw s.error;
        const p=s.data?.payload;
        E('hoiRosterChanges').textContent=p?'Roster checked '+date(s.data.fetched_at)+'. Arrivals: '+((p.arrivals||[]).map(x=>x.name).join(', ')||'none')+'. Departures: '+((p.departures||[]).map(x=>x.gamertag).join(', ')||'none')+'. Changes are observed roster differences, not confirmed trade transactions.':'No dated roster change comparison yet. Existing roster retained.';
      }
    }catch(e){E('hoiRefreshStatus').textContent='Refresh status unavailable: '+e.message;}
    finally{busy=false;}
  }
  async function refresh(){
    if(!canManage())return;
    const button=E('hoiRefreshOpponents');button.disabled=true;
    try{
      const r=await db().rpc('hitmen_request_opponent_refresh',{p_reason:'management'});if(r.error)throw r.error;
      E('hoiRefreshStatus').textContent=r.data?'Refresh queued. Upcoming opponents are prioritized; the worker checks the queue every two minutes.':'No future scheduled opponents remain in Season 55.';
      if(r.data)await load();
    }catch(e){E('hoiRefreshStatus').textContent='Could not queue refresh: '+e.message;}
    finally{button.disabled=!canManage();}
  }
  function bind(){const b=E('hoiRefreshOpponents');if(b){b.disabled=!canManage();b.onclick=refresh;}load();}
  window.addEventListener('hitmen-opponent-selected',e=>{selected=e.detail;load();});
  window.addEventListener('vvhl-auth-change',bind);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);else bind();
  setInterval(()=>{if(!document.hidden)load();},30000);
})();
