(()=>{"use strict";
let rows=[];
const status=document.getElementById("traineeAdminStatus");
const content=document.getElementById("traineeAdminContent");
const list=document.getElementById("traineeList");
const stats=document.getElementById("traineeStats");
const esc=(v="")=>String(v).replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[ch]));

function renderStats(){
  const count=s=>rows.filter(r=>r.status===s).length;
  stats.innerHTML=`
    <div class="wm-stat"><div class="eyebrow">TOTAL</div><strong>${rows.length}</strong><span>Training requests</span></div>
    <div class="wm-stat"><div class="eyebrow">NEW</div><strong>${count("submitted")}</strong><span>Needs review</span></div>
    <div class="wm-stat"><div class="eyebrow">CONTACTED</div><strong>${count("contacted")}</strong><span>Follow-up started</span></div>
    <div class="wm-stat"><div class="eyebrow">ACCEPTED</div><strong>${count("accepted")}</strong><span>Academy trainees</span></div>`;
}
function filteredRows(){
  const s=document.getElementById("traineeStatusFilter")?.value||"";
  const t=document.getElementById("traineeTrackFilter")?.value||"";
  return rows.filter(r=>(!s||r.status===s)&&(!t||r.training_track===t));
}
function render(){
  renderStats();
  const data=filteredRows();
  if(!data.length){list.innerHTML='<div class="wm-card"><b>No trainee requests match this filter.</b></div>';return;}
  list.innerHTML=data.map(r=>`
    <article class="training-card" data-trainee-id="${r.id}" style="margin-bottom:16px">
      <div class="section-heading">
        <div><div class="eyebrow">${esc(r.training_track)} · ${esc(r.platform)}</div><h3>${esc(r.gamertag)}</h3></div>
        <span class="status-pill">${esc(r.status).toUpperCase()}</span>
      </div>
      <div class="training-grid">
        <div><small>MODE</small><p>${esc(r.game_mode||"Not specified")}</p></div>
        <div><small>POSITION</small><p>${esc(r.primary_position||"Not specified")}${r.secondary_position?" / "+esc(r.secondary_position):""}</p></div>
        <div><small>EXPERIENCE</small><p>${esc(r.experience_level)}</p></div>
        <div><small>TEAM / LEAGUE</small><p>${esc(r.current_team_or_league||"Not specified")}</p></div>
        <div><small>PACKAGE INTEREST</small><p><b>${esc(r.package_interest)}</b></p></div>
        <div><small>CONTACT</small><p>${esc(r.discord_handle||"Account email only")}</p></div>
      </div>
      <div style="margin-top:14px"><small>GOALS</small><p>${esc(r.goals)}</p></div>
      <div><small>AVAILABILITY</small><p>${esc(r.availability||"Not specified")}</p></div>
      <div class="training-grid" style="margin-top:14px">
        <label><span>Status</span><select class="select-field trainee-status"><option ${r.status==="submitted"?"selected":""}>submitted</option><option ${r.status==="reviewing"?"selected":""}>reviewing</option><option ${r.status==="contacted"?"selected":""}>contacted</option><option ${r.status==="accepted"?"selected":""}>accepted</option><option ${r.status==="closed"?"selected":""}>closed</option></select></label>
        <label><span>Management notes</span><textarea class="field trainee-notes" rows="3" placeholder="Private notes">${esc(r.management_notes||"")}</textarea></label>
      </div>
      <div class="training-submit-row" style="margin-top:12px"><button class="small-btn primary trainee-save" type="button">Save Review</button><span class="trainee-save-message"></span></div>
    </article>`).join("");
}
async function load(){
  const state=window.VVHLBackend?.state;
  if(!state?.user)return;
  if(String(state.profile?.role||"").toLowerCase()!=="admin"){
    status.textContent="Academy trainee review is currently restricted to Wildman admins.";
    content.hidden=true;return;
  }
  status.textContent="Authorized · Academy trainee records";
  content.hidden=false;
  const {data,error}=await window.VVHLBackend.db.from("academy_training_intakes").select("*").order("created_at",{ascending:false});
  if(error){list.innerHTML='<div class="wm-card"><b>Could not load trainee records.</b><p>'+esc(error.message)+'</p></div>';return;}
  rows=data||[];render();
}
window.addEventListener("vvhl-auth-change",()=>load());
document.getElementById("refreshTrainees")?.addEventListener("click",load);
document.getElementById("traineeStatusFilter")?.addEventListener("change",render);
document.getElementById("traineeTrackFilter")?.addEventListener("change",render);
list?.addEventListener("click",async e=>{
  const btn=e.target.closest(".trainee-save"); if(!btn)return;
  const card=btn.closest("[data-trainee-id]"), id=card.dataset.traineeId;
  const msg=card.querySelector(".trainee-save-message");
  btn.disabled=true;msg.textContent="Saving…";
  const {error}=await window.VVHLBackend.db.from("academy_training_intakes").update({
    status:card.querySelector(".trainee-status").value,
    management_notes:card.querySelector(".trainee-notes").value.trim()||null,
    updated_at:new Date().toISOString()
  }).eq("id",id);
  btn.disabled=false;
  msg.textContent=error?error.message:"Saved.";
  if(!error)await load();
});
if(window.VVHLBackend?.state?.user)load();
})();