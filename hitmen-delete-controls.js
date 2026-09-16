(() => {
  const db=()=>window.VVHLBackend?.db;
  const auth=()=>window.VVHLBackend?.state||{};
  const TEAM_NAME='Calgary Hitmen';
  let teamId='';

  function canManage(){
    const s=auth();
    if(!s.user||!teamId)return false;
    if(String(s.profile?.role||'').toLowerCase()==='admin')return true;
    return (s.memberships||[]).some(m=>m.team_id===teamId&&m.active!==false&&['owner','gm','agm'].includes(String(m.role||'').toLowerCase()));
  }

  async function getTeam(){
    if(teamId)return teamId;
    const {data,error}=await db().from('teams').select('id').eq('name',TEAM_NAME).maybeSingle();
    if(error)throw error;
    teamId=data?.id||'';
    return teamId;
  }

  async function deleteSession(session){
    if(!confirm(`Delete "${session.label}"? This removes the Hitmen session, its game slots, and its Game Center mirror. This cannot be undone.`))return;
    const btn=document.querySelector(`[data-delete-hitmen-session="${CSS.escape(session.id)}"]`);
    if(btn){btn.disabled=true;btn.textContent='Deleting…';}
    try{
      const {error}=await db().rpc('delete_hitmen_session',{target_session:session.id});
      if(error)throw error;
      const status=document.getElementById('hitmenStatus');
      if(status){status.textContent='Scouting session deleted from Hitmen controls and Game Center.';status.className='hitmen-status success';}
      setTimeout(()=>location.reload(),450);
    }catch(e){
      if(btn){btn.disabled=false;btn.textContent='Delete';}
      const status=document.getElementById('hitmenStatus');
      if(status){status.textContent=e.message||'Could not delete session.';status.className='hitmen-status error';}
    }
  }

  async function render(){
    if(!db()||!auth().user)return;
    try{
      await getTeam(); if(!canManage())return;
      let panel=document.getElementById('hitmenDeletePanel');
      const history=document.getElementById('sessionHistory');
      if(!history)return;
      if(!panel){
        panel=document.createElement('div');
        panel.id='hitmenDeletePanel';
        panel.className='private-note';
        panel.style.marginTop='14px';
        history.insertAdjacentElement('afterend',panel);
      }
      const {data,error}=await db().from('team_competitive_sessions').select('id,label,status,created_at').eq('team_id',teamId).order('created_at',{ascending:false}).limit(20);
      if(error)throw error;
      const rows=data||[];
      panel.innerHTML=rows.length?`<strong>Delete old / test sessions</strong><div class="hitmen-actions" style="margin-top:10px;align-items:center">${rows.map(s=>`<button type="button" class="small-btn" data-delete-hitmen-session="${s.id}" title="Delete this session and its Game Center mirror">Delete · ${String(s.label||'Session').replace(/[<>&\"]/g,'')}</button>`).join('')}</div>`:'<strong>No stored Hitmen sessions to delete.</strong>';
      panel.querySelectorAll('[data-delete-hitmen-session]').forEach(b=>b.addEventListener('click',()=>{
        const s=rows.find(x=>x.id===b.dataset.deleteHitmenSession); if(s)deleteSession(s);
      }));
    }catch(e){console.error('Hitmen delete controls',e);}
  }

  window.addEventListener('vvhl-auth-change',()=>setTimeout(render,250));
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(render,650));else setTimeout(render,650);
})();