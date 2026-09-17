(() => {
  const TEAM_NAME='Calgary Hitmen';
  const db=()=>window.VVHLBackend?.db;
  const auth=()=>window.VVHLBackend?.state||{};
  let teamId=''; let busy=false;
  function provider(url){const s=String(url||'').toLowerCase();if(s.includes('twitch.tv'))return'twitch';if(s.includes('youtu'))return'youtube';return url?'external':null;}
  async function team(){if(teamId)return teamId;const {data,error}=await db().from('teams').select('id').eq('name',TEAM_NAME).maybeSingle();if(error)throw error;teamId=data?.id||'';return teamId;}
  function canManage(){const s=auth();if(!s.user||!teamId)return false;if(String(s.profile?.role||'').toLowerCase()==='admin')return true;return(s.memberships||[]).some(m=>m.team_id===teamId&&m.active!==false&&['owner','gm','agm'].includes(String(m.role||'').toLowerCase()));}
  async function sync(){
    if(busy||!db()||!auth().user)return;busy=true;
    try{
      await team();if(!canManage())return;
      const {data:sessions,error:se}=await db().from('team_competitive_sessions').select('*').eq('team_id',teamId).order('created_at',{ascending:false}).limit(8);if(se)throw se;
      const ids=(sessions||[]).map(s=>s.id);if(!ids.length)return;
      const {data:games,error:ge}=await db().from('team_competitive_games').select('*').in('session_id',ids).eq('status','final').order('final_at',{ascending:false});if(ge)throw ge;
      if(!(games||[]).length)return;
      const gameIds=games.map(g=>g.id);
      const {data:existing,error:ee}=await db().from('vod_review_sessions').select('competitive_game_id').in('competitive_game_id',gameIds);if(ee)throw ee;
      const have=new Set((existing||[]).map(x=>x.competitive_game_id));
      const sessionMap=new Map((sessions||[]).map(s=>[s.id,s]));
      let created=0;
      for(const g of games){
        if(have.has(g.id))continue;
        const s=sessionMap.get(g.session_id);if(!s)continue;
        const title=`${s.label||'Calgary Hitmen'} · Game ${g.game_number}`;
        const {error}=await db().from('vod_review_sessions').insert({
          team_id:teamId,competitive_game_id:g.id,title,
          opponent_label:s.opponent_label||'Scouting Lobby',game_type:s.session_type||'scouting',
          game_date:g.final_at||g.started_at||new Date().toISOString(),vod_url:s.stream_url||g.source_url||null,
          source_provider:provider(s.stream_url||g.source_url),duration_seconds:null,status:'queued',
          created_by:auth().user.id
        });
        if(error&&error.code!=='23505')throw error;
        if(!error)created++;
      }
      if(created){
        const status=document.getElementById('hitmenStatus');
        if(status){status.textContent=`${created} finished game${created===1?'':'s'} sent automatically to the Hitmen VOD Lab.`;status.className='hitmen-status success';}
      }
    }catch(e){console.error('Hitmen VOD handoff',e);}finally{busy=false;}
  }
  document.addEventListener('click',e=>{if(e.target.closest('[data-final-game]'))setTimeout(sync,1000);});
  window.addEventListener('vvhl-auth-change',()=>setTimeout(sync,500));
  const start=()=>{setTimeout(sync,900);setInterval(()=>{if(!document.hidden)sync();},12000);};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();