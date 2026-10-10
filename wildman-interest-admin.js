(()=>{'use strict';
const TEAM='5f36117c-7a51-4514-bf70-d4c672b41e48',STATES=['new','contacted','waitlist','accepted','declined'];
const $=id=>document.getElementById(id),S={rows:[],loading:false};const db=()=>window.VVHLBackend?.db;
const state=()=>window.VVHLBackend?.state||{};
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function allowed(){const s=state();if(!s.user)return false;if(['admin','commissioner'].includes(String(s.profile?.role||'').toLowerCase()))return true;return (s.memberships||[]).some(m=>m.team_id===TEAM&&m.active!==false&&['owner','gm','agm'].includes(String(m.role).toLowerCase()));}
function notice(s){$('interestAdminStatus').textContent=s;}
function counts(){const data=S.rows;const result=[['Total',data.length],['Franchise',data.filter(x=>x.program==='franchise').length],['HUT',data.filter(x=>x.program==='hut').length],['New',data.filter(x=>x.status==='new').length]];$('interestCounts').innerHTML=result.map(([label,n])=>'<div class="wm-stat"><small>'+label+'</small><strong>'+n+'</strong></div>').join('');}
function render(){
  counts();const p=$('interestFilter').value,st=$('interestStatusFilter').value;
  const rows=S.rows.filter(x=>(p==='all'||x.program===p)&&(st==='all'||x.status===st));
  $('interestRows').innerHTML=rows.length?rows.map(x=>'<article class="wm-card interest-entry" data-id="'+esc(x.id)+'" style="margin-bottom:12px"><div class="eyebrow">'+esc(x.program.toUpperCase())+' · '+esc(new Date(x.created_at).toLocaleString())+'</div><h3>'+esc(x.gamertag)+' · '+esc(x.platform)+'</h3><p><b>EMAIL:</b> '+esc(x.email)+' · <b>DISCORD:</b> '+esc(x.discord_handle)+'</p><p><b>DIVISION:</b> '+esc(x.division||'n/a')+'</p><p>'+esc(x.notes||'No additional notes')+'</p><label>Status <select data-status>'+STATES.map(k=>'<option value="'+k+'"'+(x.status===k?' selected':'')+'>'+k+'</option>').join('')+'</select></label><label>Private notes <textarea data-notes maxlength="1200" rows="2" style="width:100%">'+esc(x.admin_notes||'')+'</textarea></label><button type="button" class="small-btn" data-save>Save Status</button><span data-item-status></span></article>').join(''):'<p class="empty-state">No submissions match these filters.</p>';
  $('interestRows').querySelectorAll('[data-save]').forEach(b=>b.addEventListener('click',async()=>{
    const item=b.closest('[data-id]'),id=item.dataset.id,status=item.querySelector('[data-status]').value,admin_notes=item.querySelector('[data-notes]').value.trim();
    if(!STATES.includes(status))return;b.disabled=true;item.querySelector('[data-item-status]').textContent='Saving…';
    const r=await db().from('wildman_program_interest').update({status,admin_notes,reviewed_at:new Date().toISOString()}).eq('id',id);
    if(r.error)item.querySelector('[data-item-status]').textContent='Save failed: '+r.error.message;
    else {const row=S.rows.find(x=>x.id===id);if(row){row.status=status;row.admin_notes=admin_notes;}item.querySelector('[data-item-status]').textContent='Saved';counts();}
    b.disabled=false;
  }));
}
async function load(){
 if(!allowed()||!db()||S.loading)return;S.loading=true;notice('Loading private interest list…');
 try{const r=await db().from('wildman_program_interest').select('id,program,gamertag,email,discord_handle,platform,division,notes,status,admin_notes,created_at').order('created_at',{ascending:false}).limit(300);
 if(r.error)throw r.error;S.rows=r.data||[];notice('Showing '+S.rows.length+' latest expressions of interest.');render();}
 catch(e){notice('Could not load intake: '+e.message);}
 finally{S.loading=false;}
}
function gate(){
 const ok=allowed();document.querySelector('[data-interest-dashboard]').hidden=!ok;$('interestRestricted').hidden=ok;
 if(ok)load();
}
window.addEventListener('vvhl-auth-change',gate);
$('refreshInterest')?.addEventListener('click',load);
$('interestFilter')?.addEventListener('change',render);
$('interestStatusFilter')?.addEventListener('change',render);
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',gate);else gate();
})();