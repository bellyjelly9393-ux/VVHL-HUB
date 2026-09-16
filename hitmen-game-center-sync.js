(() => {
  const TEAM_NAME = 'Calgary Hitmen';
  const db = () => window.VVHLBackend?.db;
  const auth = () => window.VVHLBackend?.state || {};
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const state = { team: null, syncing: false, timer: null };

  function provider(url){
    try{
      const h = new URL(url).hostname.toLowerCase();
      if(h.includes('twitch.tv')) return 'twitch';
      if(h.includes('youtube.com') || h.includes('youtu.be')) return 'youtube';
    }catch{}
    return 'external';
  }
  function sessionSlug(id){ return `lgchl-hitmen-scouting-${String(id).slice(0,8)}`; }
  function opponentSlug(id){ return `lgchl-scouting-lobby-${String(id).slice(0,8)}`; }
  function eventStatus(session,games){
    if(session.status === 'complete') return 'complete';
    if(games.some(g => g.status === 'live')) return 'live';
    return 'upcoming';
  }
  function gameStatus(v){ return v === 'not_required' ? 'cancelled' : (['scheduled','live','final','postponed','cancelled'].includes(v) ? v : 'scheduled'); }

  async function team(){
    if(state.team) return state.team;
    const {data,error}=await db().from('teams').select('id,name').eq('name',TEAM_NAME).maybeSingle();
    if(error) throw error;
    state.team=data;
    return data;
  }
  function canManage(){
    const s=auth();
    if(!s.user || !state.team) return false;
    if(String(s.profile?.role||'').toLowerCase()==='admin') return true;
    return (s.memberships||[]).some(m=>m.team_id===state.team.id && m.active!==false && ['owner','gm','agm'].includes(String(m.role||'').toLowerCase()));
  }
  async function latestSession(){
    const t=await team(); if(!t)return null;
    const {data,error}=await db().from('team_competitive_sessions').select('*').eq('team_id',t.id).order('created_at',{ascending:false}).limit(1).maybeSingle();
    if(error) throw error;
    return data;
  }
  async function sessionGames(sessionId){
    const {data,error}=await db().from('team_competitive_games').select('*').eq('session_id',sessionId).order('game_number');
    if(error) throw error;
    return data||[];
  }

  async function upsertPublicTeam(payload){
    const {data,error}=await db().from('esports_teams').upsert(payload,{onConflict:'slug'}).select('id,slug,name').single();
    if(error) throw error;
    return data;
  }
  async function upsertEvent(payload){
    const {data,error}=await db().from('esports_events').upsert(payload,{onConflict:'slug'}).select('id,slug,name').single();
    if(error) throw error;
    return data;
  }

  async function syncSession(session,{quiet=false}={}){
    if(!session?.stream_url) return null;
    if(state.syncing) return null;
    state.syncing=true;
    try{
      const games=await sessionGames(session.id);
      const hitmen=await upsertPublicTeam({
        slug:'calgary-hitmen-lgchl', name:'Calgary Hitmen LGCHL', abbreviation:'CGY', team_type:'external',
        source_provider:'hitmen-workspace', source_team_id:state.team.id, is_featured:false, is_owned:false,
        active:true, is_public:true, updated_at:new Date().toISOString()
      });
      const opponentName=(session.opponent_label||'Scouting Lobby').trim()||'Scouting Lobby';
      const opp=await upsertPublicTeam({
        slug:opponentSlug(session.id), name:opponentName, abbreviation:'SCOUT', team_type:'external',
        source_provider:'hitmen-workspace', source_team_id:`session:${session.id}:opponent`, is_featured:false, is_owned:false,
        active:true, is_public:true, updated_at:new Date().toISOString()
      });
      const ev=await upsertEvent({
        slug:sessionSlug(session.id), name:session.label||'Calgary Hitmen Scouting Night', organizer:'LGCHL Calgary Hitmen',
        game_title:'EA SPORTS NHL 27', event_type:'other', status:eventStatus(session,games),
        starts_on:new Date(session.created_at||Date.now()).toISOString().slice(0,10), ends_on:new Date(session.created_at||Date.now()).toISOString().slice(0,10),
        source_provider:'hitmen-workspace', source_event_id:session.id, active:true, is_public:true, is_sandbox:false,
        updated_at:new Date().toISOString()
      });
      const live=games.find(g=>g.status==='live');
      for(const g of games){
        const payload={
          event_id:ev.id, home_team_id:hitmen.id, away_team_id:opp.id,
          scheduled_at:g.started_at||session.scheduled_at||session.created_at||new Date().toISOString(),
          status:gameStatus(g.status), stage:'LGCHL Scouting', round_label:`${session.season_label||'Season 55'} · Practice BO${session.best_of||3}`,
          best_of:session.best_of||3, series_game_number:g.game_number,
          home_score:Number(g.team_score)||0, away_score:Number(g.opponent_score)||0,
          stream_provider:provider(session.stream_url), stream_url:session.stream_url,
          broadcast_title:`${session.label||'Calgary Hitmen Scouting'} · Game ${g.game_number}`,
          commentary_status:'none', source_provider:'hitmen-workspace', external_game_id:g.id,
          source_updated_at:new Date().toISOString(), updated_at:new Date().toISOString(),
          featured:live ? live.id===g.id : false,
          if_necessary:Number(g.game_number) > Math.floor((Number(session.best_of)||3)/2)+1,
          not_required:g.status==='not_required', session_label:session.label||'Scouting Night'
        };
        const {error}=await db().from('esports_games').upsert(payload,{onConflict:'source_provider,external_game_id'});
        if(error) throw error;
      }
      setBridgeStatus(`Game Center linked · ${games.length} game slot${games.length===1?'':'s'} · ${provider(session.stream_url).toUpperCase()}`,'good');
      if(!quiet) flash(`Stream synced to Game Center. ${live?`Game ${live.game_number} is LIVE.`:'Start a game when the lobby is ready.'}`);
      return ev;
    } finally { state.syncing=false; }
  }

  function setBridgeStatus(text,tone=''){
    const el=document.getElementById('gcBridgeStatus'); if(!el)return;
    el.textContent=text; el.dataset.tone=tone;
  }
  function flash(text){
    const el=document.getElementById('hitmenStatus'); if(el){el.textContent=text;el.className='hitmen-status success';}
  }
  function installBridge(){
    if(document.getElementById('gameCenterBridge')) return;
    const active=document.getElementById('activeSession'); if(!active)return;
    const box=document.createElement('div');
    box.id='gameCenterBridge'; box.className='game-center-bridge';
    box.innerHTML=`<div><div class="eyebrow">GAME CENTER BRIDGE</div><h4>Scouting Broadcast</h4><p>Paste the stream once. The Hitmen scouting series becomes the featured Game Center feed when a game is LIVE.</p></div><div class="game-center-bridge-controls"><input id="gcStreamUrl" class="field" type="url" placeholder="Twitch / YouTube stream URL"><button id="gcSyncStream" class="small-btn primary" type="button">Sync Stream</button><a class="small-btn" href="game-center.html" target="_blank" rel="noopener">Open Game Center</a></div><small id="gcBridgeStatus">Create a Hitmen scouting series, then attach the stream.</small>`;
    active.parentElement.insertBefore(box,active);
    document.getElementById('gcSyncStream').addEventListener('click',async()=>{
      try{
        const session=await latestSession(); if(!session)return setBridgeStatus('Create the scouting series first.','bad');
        const url=document.getElementById('gcStreamUrl').value.trim();
        if(!url)return setBridgeStatus('Paste the Twitch or YouTube stream link first.','bad');
        new URL(url);
        const {error}=await db().from('team_competitive_sessions').update({stream_url:url,updated_at:new Date().toISOString()}).eq('id',session.id);
        if(error)throw error;
        session.stream_url=url;
        const sourceInput=document.getElementById('sessionStream'); if(sourceInput)sourceInput.value=url;
        await syncSession(session);
      }catch(e){setBridgeStatus(e.message||'Could not sync the stream.','bad');}
    });
  }

  async function refreshBridge(){
    try{
      await team(); if(!canManage()) return;
      installBridge();
      const s=await latestSession();
      if(!s)return;
      const input=document.getElementById('gcStreamUrl'); if(input && !input.matches(':focus'))input.value=s.stream_url||'';
      if(s.stream_url) await syncSession(s,{quiet:true});
    }catch(e){console.error('Hitmen Game Center sync',e);setBridgeStatus(e.message||'Game Center sync unavailable.','bad');}
  }

  document.addEventListener('click',e=>{
    const hit=e.target.closest('#createSession,[data-start-game],[data-final-game],[data-pause-session]');
    if(hit) setTimeout(refreshBridge,900);
  });
  window.addEventListener('vvhl-auth-change',()=>setTimeout(refreshBridge,100));
  refreshBridge();
  state.timer=setInterval(()=>{if(!document.hidden)refreshBridge();},10000);
})();