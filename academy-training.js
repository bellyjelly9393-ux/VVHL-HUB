(()=>{"use strict";
const form=document.getElementById("trainingIntakeForm");
const section=document.getElementById("trainingFormSection");
const locked=document.getElementById("trainingLocked");
const message=document.getElementById("trainingMessage");
const list=document.getElementById("myTrainingIntakeList");

function escapeHtml(value=""){return String(value).replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[ch]));}

async function loadMine(){
  const state=window.VVHLBackend?.state;
  if(!state?.user||!list)return;
  const {data,error}=await window.VVHLBackend.db
    .from("academy_training_intakes")
    .select("id,gamertag,platform,training_track,game_mode,package_interest,status,created_at")
    .eq("user_id",state.user.id)
    .order("created_at",{ascending:false})
    .limit(6);
  if(error){list.innerHTML='<p class="training-muted">Could not load your previous requests.</p>';return;}
  if(!data?.length){list.innerHTML='<p class="training-muted">No training requests yet. Your first submission will appear here.</p>';return;}
  list.innerHTML=data.map(row=>`
    <article class="training-request">
      <div><b>${escapeHtml(row.training_track)}</b><span>${escapeHtml(row.game_mode||row.platform)}</span></div>
      <div><small>Package interest</small><strong>${escapeHtml(row.package_interest)}</strong></div>
      <div><small>Status</small><strong class="training-status">${escapeHtml(row.status)}</strong></div>
      <div><small>Submitted</small><span>${new Date(row.created_at).toLocaleDateString()}</span></div>
    </article>`).join("");
}

function applyAuth(state){
  const signedIn=Boolean(state?.user);
  if(section)section.hidden=!signedIn;
  if(locked)locked.hidden=signedIn;
  if(signedIn){
    const profile=state.profile||{};
    const gamertag=document.getElementById("trainingGamertag");
    const discord=document.getElementById("trainingDiscord");
    const platform=document.getElementById("trainingPlatform");
    if(gamertag&&!gamertag.value&&profile.display_name)gamertag.value=profile.display_name;
    if(discord&&!discord.value&&profile.discord_handle)discord.value=profile.discord_handle;
    if(platform&&!platform.value&&profile.platform){
      const option=[...platform.options].find(o=>o.value.toLowerCase().includes(String(profile.platform).toLowerCase())||String(profile.platform).toLowerCase().includes(o.value.toLowerCase()));
      if(option)platform.value=option.value;
    }
    loadMine();
  }
}

window.addEventListener("vvhl-auth-change",e=>applyAuth(e.detail));
if(window.VVHLBackend?.state)applyAuth(window.VVHLBackend.state);

form?.addEventListener("submit",async e=>{
  e.preventDefault();
  const state=window.VVHLBackend?.state;
  if(!state?.user){location.href="signup.html";return;}
  const track=document.querySelector('input[name="trainingTrack"]:checked')?.value;
  if(!track){message.textContent="Choose a training path.";return;}
  const button=document.getElementById("trainingSubmit");
  button.disabled=true;
  message.textContent="Submitting…";
  const payload={
    user_id:state.user.id,
    gamertag:document.getElementById("trainingGamertag").value.trim(),
    platform:document.getElementById("trainingPlatform").value,
    training_track:track,
    game_mode:document.getElementById("trainingMode").value||null,
    primary_position:document.getElementById("trainingPrimaryPosition").value||null,
    secondary_position:document.getElementById("trainingSecondaryPosition").value||null,
    experience_level:document.getElementById("trainingExperience").value,
    current_team_or_league:document.getElementById("trainingLeague").value.trim()||null,
    discord_handle:document.getElementById("trainingDiscord").value.trim()||null,
    goals:document.getElementById("trainingGoals").value.trim(),
    availability:document.getElementById("trainingAvailability").value.trim()||null,
    timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||"America/Toronto",
    package_interest:document.getElementById("trainingPackage").value
  };
  const {error}=await window.VVHLBackend.db.from("academy_training_intakes").insert(payload);
  button.disabled=false;
  if(error){message.textContent=error.message;return;}
  message.textContent="Training intake submitted. Wildman management can now review it.";
  form.reset();
  if(state.profile?.display_name)document.getElementById("trainingGamertag").value=state.profile.display_name;
  await loadMine();
});
})();