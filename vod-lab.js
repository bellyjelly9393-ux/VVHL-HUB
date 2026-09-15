(() => {
  const state = { initialized:false, loading:false, teamId:"", reviews:[], segments:[], markers:[], selectedReviewId:"", selectedSegmentId:"" };
  const $ = (id) => document.getElementById(id);
  const db = () => window.VVHLBackend?.db;
  const auth = () => window.VVHLBackend?.state || {};
  const esc = (v) => String(v ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[c]);

  function hasAccess(){ return Boolean(window.VVHLManagementGuard?.hasAccess?.(auth())); }
  function setStatus(message,tone=""){ const el=$("vodStatus"); if(!el)return; el.textContent=message; el.className=`vod-status ${tone}`.trim(); }
  function detectProvider(url){ const s=String(url||"").toLowerCase(); if(s.includes("twitch.tv")) return "twitch"; if(s.includes("youtube.com")||s.includes("youtu.be")) return "youtube"; return "external"; }
  function parseTime(value){
    const s=String(value??"").trim(); if(!s) return null; if(/^\d+$/.test(s)) return Number(s);
    const parts=s.split(":").map(Number); if(parts.some(Number.isNaN)||parts.length>3) return null;
    if(parts.length===2) return parts[0]*60+parts[1];
    if(parts.length===3) return parts[0]*3600+parts[1]*60+parts[2];
    return null;
  }
  function fmtTime(seconds){
    if(seconds==null||Number.isNaN(Number(seconds))) return "—";
    const n=Math.max(0,Math.floor(Number(seconds))),h=Math.floor(n/3600),m=Math.floor((n%3600)/60),s=n%60;
    return h?`${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`:`${m}:${String(s).padStart(2,"0")}`;
  }
  function twitchTime(seconds){ const n=Math.max(0,Math.floor(seconds||0)); const h=Math.floor(n/3600),m=Math.floor((n%3600)/60),s=n%60; return `${h}h${m}m${s}s`; }
  function timestampUrl(url,seconds){
    if(!url) return "";
    try{
      const u=new URL(url); const host=u.hostname.toLowerCase();
      if(host.includes("youtu.be")){ u.searchParams.set("t",`${Math.floor(seconds)}s`); return u.toString(); }
      if(host.includes("youtube.com")){ u.searchParams.set("t",`${Math.floor(seconds)}s`); return u.toString(); }
      if(host.includes("twitch.tv")){ u.searchParams.set("t",twitchTime(seconds)); return u.toString(); }
      u.searchParams.set("t",String(Math.floor(seconds))); return u.toString();
    }catch{return url;}
  }
  function allowedTeams(){
    const a=auth(), role=String(a.profile?.role||"").toLowerCase();
    if(role==="admin") return a.teams||[];
    const ids=new Set((a.memberships||[]).filter(m=>m.active!==false).map(m=>m.team_id));
    return (a.teams||[]).filter(t=>ids.has(t.id));
  }
  function teamName(){ return allowedTeams().find(t=>t.id===state.teamId)?.name || "Team"; }
  function currentReview(){ return state.reviews.find(r=>r.id===state.selectedReviewId)||null; }
  function currentSegment(){ return state.segments.find(s=>s.id===state.selectedSegmentId)||null; }
  function reviewSegments(reviewId=state.selectedReviewId){ return state.segments.filter(s=>s.review_id===reviewId).sort((a,b)=>a.start_seconds-b.start_seconds||a.segment_index-b.segment_index); }
  function reviewMarkers(reviewId=state.selectedReviewId){ return state.markers.filter(m=>m.review_id===reviewId).sort((a,b)=>a.timestamp_seconds-b.timestamp_seconds); }

  function populateTeams(){
    const select=$("vodTeam"), teams=allowedTeams(); if(!select) return;
    select.innerHTML=teams.map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join("");
    const wanted=new URLSearchParams(location.search).get("team");
    if(!state.teamId){
      const byQuery=wanted?teams.find(t=>String(t.name).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")===wanted):null;
      state.teamId=byQuery?.id || auth().teamId || teams[0]?.id || "";
    }
    if(!teams.some(t=>t.id===state.teamId)) state.teamId=teams[0]?.id||"";
    select.value=state.teamId;
  }

  async function loadData(){
    if(state.loading||!db()||!hasAccess()||!state.teamId) return;
    state.loading=true; setStatus(`Loading ${teamName()} VOD reviews…`);
    try{
      const [r,s,m]=await Promise.all([
        db().from("vod_review_sessions").select("*").eq("team_id",state.teamId).neq("status","archived").order("game_date",{ascending:false}),
        db().from("vod_review_segments").select("*").eq("team_id",state.teamId).order("start_seconds"),
        db().from("vod_review_markers").select("*").eq("team_id",state.teamId).order("timestamp_seconds")
      ]);
      if(r.error) throw r.error; if(s.error) throw s.error; if(m.error) throw m.error;
      state.reviews=r.data||[]; state.segments=s.data||[]; state.markers=m.data||[];
      if(state.selectedReviewId&&!state.reviews.some(x=>x.id===state.selectedReviewId)){state.selectedReviewId="";state.selectedSegmentId="";}
      renderAll(); setStatus(`${teamName()} VOD Lab ready · ${state.reviews.length} review${state.reviews.length===1?"":"s"}.`,"success");
    }catch(error){
      console.error(error);
      const schema=String(error?.message||"").toLowerCase().includes("vod_review")||String(error?.code||"").startsWith("PGRST");
      setStatus(schema?"Segmented VOD database is not available yet. The interface is deployed safely, but reviews cannot be saved until the schema finishes deploying.":(error.message||"Unable to load VOD reviews."),"error");
    }finally{state.loading=false;}
  }

  function renderKpis(){
    $("vodReviewCount").textContent=state.reviews.length;
    $("vodSegmentCount").textContent=state.segments.length;
    $("vodCompleteCount").textContent=state.segments.filter(s=>s.status==="complete").length;
    $("vodMarkerCount").textContent=state.markers.length;
  }
  function renderLibrary(){
    const el=$("vodLibrary"); if(!el)return;
    if(!state.reviews.length){el.innerHTML=`<div class="vod-empty">No VOD reviews in this workspace yet.</div>`;return;}
    el.innerHTML=state.reviews.map(r=>{
      const segs=reviewSegments(r.id),done=segs.filter(s=>s.status==="complete").length;
      return `<button class="vod-row${r.id===state.selectedReviewId?" active":""}" data-vod-id="${esc(r.id)}"><strong>${esc(r.title)}</strong><span>${esc(r.opponent_label||"No opponent label")}</span><small>${esc(String(r.game_type||"scouting").replaceAll("_"," "))} · ${done}/${segs.length} segments complete · ${r.game_date?new Date(r.game_date).toLocaleDateString():"No date"}</small></button>`;
    }).join("");
    el.querySelectorAll("[data-vod-id]").forEach(b=>b.addEventListener("click",()=>selectReview(b.dataset.vodId)));
  }
  function renderDetail(){
    const r=currentReview(),empty=$("vodEmpty"),detail=$("vodDetail");
    if(!r){empty.hidden=false;detail.hidden=true;return;}
    empty.hidden=true;detail.hidden=false;
    $("vodDetailTeam").textContent=`${teamName()} · ${String(r.game_type||"review").replaceAll("_"," ")}`;
    $("vodDetailTitle").textContent=r.title;
    $("vodDetailMeta").textContent=`${r.opponent_label||"Opponent not labeled"} · ${r.game_date?new Date(r.game_date).toLocaleString():"No date"} · ${r.duration_seconds!=null?fmtTime(r.duration_seconds):"length not set"}`;
    const link=$("vodOpenLink"); link.href=r.vod_url||"#"; link.style.display=r.vod_url?"inline-flex":"none";
    $("periodVodEnd").value=r.duration_seconds!=null?fmtTime(r.duration_seconds):"";
    const segs=reviewSegments();
    const p=(i)=>segs.find(s=>s.segment_type==="period"&&s.segment_index===i);
    if(p(1)) $("period1Start").value=fmtTime(p(1).start_seconds);
    if(p(2)) $("period2Start").value=fmtTime(p(2).start_seconds);
    if(p(3)) $("period3Start").value=fmtTime(p(3).start_seconds);
    const ots=segs.filter(s=>s.segment_type==="overtime").map(s=>fmtTime(s.start_seconds));
    $("periodOtStarts").value=ots.join(", ");
    $("gameSummary").value=r.full_game_summary||""; $("gamePatterns").value=r.recurring_patterns||""; $("gameStrengths").value=r.strengths||""; $("gameCorrections").value=r.corrections||"";
    renderSegments(); renderSegmentEditor();
  }
  function renderSegments(){
    const el=$("segmentList"),segs=reviewSegments();
    if(!segs.length){el.innerHTML=`<div class="vod-empty">No periods built yet. Enter the period start timestamps above.</div>`;return;}
    el.innerHTML=segs.map(s=>`<article class="segment-card${s.id===state.selectedSegmentId?" selected":""}">
      <div class="segment-card-head"><div><h4>${esc(s.label)}</h4><small>${fmtTime(s.start_seconds)} → ${fmtTime(s.end_seconds)}${s.end_seconds!=null?` · ${fmtTime(s.end_seconds-s.start_seconds)}`:""}</small></div><span class="segment-pill ${esc(s.status)}">${esc(String(s.status).replaceAll("_"," "))}</span></div>
      <div class="segment-card-actions"><button class="small-btn" type="button" data-segment-id="${esc(s.id)}">Review</button><button class="small-btn" type="button" data-segment-open="${esc(s.id)}">Open Timestamp</button></div>
    </article>`).join("");
    el.querySelectorAll("[data-segment-id]").forEach(b=>b.addEventListener("click",()=>selectSegment(b.dataset.segmentId)));
    el.querySelectorAll("[data-segment-open]").forEach(b=>b.addEventListener("click",()=>openSegmentById(b.dataset.segmentOpen)));
  }
  function renderSegmentEditor(){
    const s=currentSegment(),wrap=$("segmentEditorWrap"); if(!s){wrap.hidden=true;return;} wrap.hidden=false;
    $("segmentEditorTitle").textContent=s.label; $("segmentStart").value=fmtTime(s.start_seconds); $("segmentEnd").value=s.end_seconds==null?"":fmtTime(s.end_seconds);
    $("segmentStatus").value=s.status; $("segmentConfidence").value=s.confidence||"preliminary"; $("segmentSummary").value=s.analysis_summary||"";
    $("segmentOffense").value=s.offense_notes||""; $("segmentDefense").value=s.defense_notes||""; $("segmentTransition").value=s.transition_notes||""; $("segmentSpecial").value=s.special_teams_notes||"";
    $("segmentPlayers").value=Array.isArray(s.player_notes)?s.player_notes.map(x=>typeof x==="string"?x:(x.note||JSON.stringify(x))).join("\n"):"";
    $("segmentTags").value=Array.isArray(s.tags)?s.tags.join(", "):""; renderMarkers();
  }
  function renderMarkers(){
    const el=$("markerList"),s=currentSegment(); if(!el||!s)return;
    const rows=reviewMarkers().filter(m=>m.segment_id===s.id);
    if(!rows.length){el.innerHTML=`<div class="vod-empty">No timestamp markers for ${esc(s.label)} yet.</div>`;return;}
    el.innerHTML=rows.map(m=>`<div class="marker-row"><b>${fmtTime(m.timestamp_seconds)}</b><small>${esc(String(m.category).replaceAll("_"," "))}${m.player_label?` · ${esc(m.player_label)}`:""}</small><span>${esc(m.note)}</span></div>`).join("");
  }
  function renderAll(){renderKpis();renderLibrary();renderDetail();}

  function selectReview(id){state.selectedReviewId=id; const first=reviewSegments(id)[0]; state.selectedSegmentId=first?.id||""; renderAll();}
  function selectSegment(id){state.selectedSegmentId=id; renderSegments();renderSegmentEditor(); document.getElementById("segmentEditorWrap")?.scrollIntoView({behavior:"smooth",block:"start"});}
  function openSegmentById(id){const r=currentReview(),s=state.segments.find(x=>x.id===id); if(!r?.vod_url||!s)return; window.open(timestampUrl(r.vod_url,s.start_seconds),"_blank","noopener");}

  async function createReview(){
    const title=$("newVodTitle").value.trim(),url=$("newVodUrl").value.trim(),duration=parseTime($("newVodDuration").value),user=auth().user;
    if(!title) return setStatus("Give the VOD review a title first.","error");
    if($("newVodDuration").value.trim()&&duration==null) return setStatus("VOD length must look like 45:20 or 1:32:10.","error");
    const dateVal=$("newVodDate").value;
    const payload={team_id:state.teamId,title,vod_url:url||null,source_provider:detectProvider(url),opponent_label:$("newVodOpponent").value.trim()||null,game_type:$("newVodType").value,game_date:dateVal?new Date(dateVal).toISOString():new Date().toISOString(),duration_seconds:duration,created_by:user?.id||null,status:"queued"};
    setStatus("Creating VOD review…"); const {data,error}=await db().from("vod_review_sessions").insert(payload).select().single();
    if(error)return setStatus(error.message,"error");
    state.selectedReviewId=data.id; state.selectedSegmentId=""; $("newVodTitle").value="";$("newVodOpponent").value="";$("newVodUrl").value="";$("newVodDuration").value="";
    await loadData(); setStatus("VOD review created. Add the actual period boundaries next.","success");
  }

  async function buildSegments(){
    const r=currentReview(); if(!r)return;
    const p1=parseTime($("period1Start").value),p2=parseTime($("period2Start").value),p3=parseTime($("period3Start").value),vodEnd=parseTime($("periodVodEnd").value);
    if([p1,p2,p3].some(v=>v==null)) return setStatus("Enter valid start timestamps for Periods 1, 2 and 3.","error");
    if(!(p1<p2&&p2<p3)) return setStatus("Period starts must be in order: P1 < P2 < P3.","error");
    const otStarts=$("periodOtStarts").value.split(",").map(v=>v.trim()).filter(Boolean).map(parseTime);
    if(otStarts.some(v=>v==null)) return setStatus("One of the OT timestamps is invalid.","error");
    const starts=[p1,p2,p3,...otStarts];
    if(starts.some((v,i)=>i&&v<=starts[i-1])) return setStatus("OT starts must come after Period 3 and remain in chronological order.","error");
    if(vodEnd!=null&&vodEnd<=starts[starts.length-1]) return setStatus("VOD end must be after the final segment start.","error");
    const defs=[
      {segment_type:"period",segment_index:1,label:"Period 1",start_seconds:p1,end_seconds:p2},
      {segment_type:"period",segment_index:2,label:"Period 2",start_seconds:p2,end_seconds:p3},
      {segment_type:"period",segment_index:3,label:"Period 3",start_seconds:p3,end_seconds:otStarts[0]??vodEnd}
    ];
    otStarts.forEach((start,i)=>defs.push({segment_type:"overtime",segment_index:i+1,label:`Overtime ${i+1}`,start_seconds:start,end_seconds:otStarts[i+1]??vodEnd}));
    const payload=defs.map(d=>({...d,review_id:r.id,team_id:state.teamId}));
    setStatus("Saving period boundaries…");
    const {error}=await db().from("vod_review_segments").upsert(payload,{onConflict:"review_id,segment_type,segment_index"}); if(error)return setStatus(error.message,"error");
    let del=db().from("vod_review_segments").delete().eq("review_id",r.id).eq("segment_type","overtime");
    if(otStarts.length) del=del.gt("segment_index",otStarts.length); const dres=await del; if(dres.error)return setStatus(dres.error.message,"error");
    const {error:uerr}=await db().from("vod_review_sessions").update({duration_seconds:vodEnd,status:"reviewing",overtime_count:otStarts.length,updated_at:new Date().toISOString()}).eq("id",r.id); if(uerr)return setStatus(uerr.message,"error");
    await loadData(); const first=reviewSegments(r.id)[0]; state.selectedSegmentId=first?.id||"";renderAll(); setStatus(`Built ${defs.length} review segment${defs.length===1?"":"s"}.`,"success");
  }

  async function addCustomSegment(){
    const r=currentReview(); if(!r)return; const existing=reviewSegments().filter(s=>s.segment_type==="custom"); const idx=Math.max(0,...existing.map(s=>s.segment_index))+1;
    const {data,error}=await db().from("vod_review_segments").insert({review_id:r.id,team_id:state.teamId,segment_type:"custom",segment_index:idx,label:`Custom ${idx}`,start_seconds:0,status:"queued"}).select().single();
    if(error)return setStatus(error.message,"error"); await loadData(); state.selectedSegmentId=data.id;renderAll();setStatus("Custom segment added. Set its timestamps and review it independently.","success");
  }

  async function saveSegment(){
    const s=currentSegment(); if(!s)return; const start=parseTime($("segmentStart").value),end=parseTime($("segmentEnd").value);
    if(start==null||(end!=null&&end<start))return setStatus("Segment timestamps are invalid.","error");
    const playerNotes=$("segmentPlayers").value.split("\n").map(x=>x.trim()).filter(Boolean); const tags=$("segmentTags").value.split(",").map(x=>x.trim()).filter(Boolean);
    const payload={start_seconds:start,end_seconds:end,status:$("segmentStatus").value,confidence:$("segmentConfidence").value,analysis_summary:$("segmentSummary").value.trim()||null,offense_notes:$("segmentOffense").value.trim()||null,defense_notes:$("segmentDefense").value.trim()||null,transition_notes:$("segmentTransition").value.trim()||null,special_teams_notes:$("segmentSpecial").value.trim()||null,player_notes:playerNotes,tags,analyzed_by:auth().user?.id||null,updated_at:new Date().toISOString()};
    setStatus(`Saving ${s.label} review…`); const {error}=await db().from("vod_review_segments").update(payload).eq("id",s.id); if(error)return setStatus(error.message,"error");
    await loadData(); state.selectedSegmentId=s.id;renderAll();setStatus(`${s.label} review saved.`,"success");
  }

  async function addMarker(){
    const r=currentReview(),s=currentSegment(); if(!r||!s)return; const t=parseTime($("markerTime").value),note=$("markerNote").value.trim();
    if(t==null||!note)return setStatus("Marker needs a valid VOD timestamp and a note.","error");
    if(t<s.start_seconds||(s.end_seconds!=null&&t>s.end_seconds))return setStatus(`That timestamp is outside ${s.label}. Use the absolute VOD time for this segment.`,"error");
    const payload={review_id:r.id,segment_id:s.id,team_id:state.teamId,timestamp_seconds:t,category:$("markerCategory").value,player_label:$("markerPlayer").value.trim()||null,note,created_by:auth().user?.id||null};
    const {error}=await db().from("vod_review_markers").insert(payload); if(error)return setStatus(error.message,"error");
    $("markerTime").value="";$("markerNote").value="";$("markerPlayer").value=""; await loadData(); state.selectedSegmentId=s.id;renderAll();setStatus("Timestamp marker saved.","success");
  }

  function copySegmentPacket(){
    const r=currentReview(),s=currentSegment(); if(!r||!s)return;
    const packet=[
      `VOD ANALYSIS PACKET`, `Team: ${teamName()}`, `Game: ${r.title}`, `Opponent: ${r.opponent_label||"Unlabeled"}`, `Segment: ${s.label}`,
      `Window: ${fmtTime(s.start_seconds)} to ${fmtTime(s.end_seconds)}`, `Source: ${timestampUrl(r.vod_url,s.start_seconds)}`,
      ``, `Analyze ONLY this segment. Focus on:`, `- offensive-zone entries, possession and chance creation`, `- breakout routes and neutral-zone transition`, `- defensive structure, gap control and slot protection`, `- forecheck pressure and puck recoveries`, `- turnovers, risky decisions and repeatable mistakes`, `- special teams / faceoff situations when present`, `- player-specific tendencies and notable sequences`, `- 3-7 timestamped key moments`, ``, `Return a concise period summary plus offense, defense, transition, special-teams, player notes and recurring tags.`
    ].join("\n");
    navigator.clipboard?.writeText(packet).then(()=>{$("copyFeedback").textContent="Copied";setTimeout(()=>$("copyFeedback").textContent="",1800);}).catch(()=>setStatus("Clipboard access was blocked by the browser.","error"));
  }
  function buildRollup(){
    const segs=reviewSegments(); if(!segs.length)return setStatus("Build the period segments first.","error");
    const reviewed=segs.filter(s=>s.analysis_summary||s.offense_notes||s.defense_notes||s.transition_notes||s.special_teams_notes);
    if(!reviewed.length)return setStatus("There are no period notes to roll up yet.","error");
    $("gameSummary").value=reviewed.map(s=>`${s.label}: ${s.analysis_summary||"No summary entered."}`).join("\n\n");
    const counts=new Map(); reviewed.flatMap(s=>Array.isArray(s.tags)?s.tags:[]).forEach(tag=>counts.set(tag,(counts.get(tag)||0)+1));
    const recurring=[...counts.entries()].filter(([,n])=>n>=2).sort((a,b)=>b[1]-a[1]);
    $("gamePatterns").value=recurring.length?recurring.map(([tag,n])=>`${tag}: appeared in ${n} segments`).join("\n"):"No repeated tags identified yet.";
    setStatus("Built a factual rollup draft from the saved period reviews. Edit it before saving.","success");
  }
  async function saveRollup(){
    const r=currentReview(); if(!r)return; const segs=reviewSegments(); const allDone=segs.length>0&&segs.every(s=>s.status==="complete");
    const payload={full_game_summary:$("gameSummary").value.trim()||null,recurring_patterns:$("gamePatterns").value.trim()||null,strengths:$("gameStrengths").value.trim()||null,corrections:$("gameCorrections").value.trim()||null,status:allDone?"complete":"reviewing",updated_at:new Date().toISOString()};
    const {error}=await db().from("vod_review_sessions").update(payload).eq("id",r.id); if(error)return setStatus(error.message,"error"); await loadData(); state.selectedReviewId=r.id;renderAll();setStatus(allDone?"Game report saved and VOD review marked complete.":"Game report saved. Unfinished segments remain in the review queue.","success");
  }
  async function archiveReview(){const r=currentReview();if(!r)return;const {error}=await db().from("vod_review_sessions").update({status:"archived",updated_at:new Date().toISOString()}).eq("id",r.id);if(error)return setStatus(error.message,"error");state.selectedReviewId="";state.selectedSegmentId="";await loadData();setStatus("VOD review archived.","success");}
  async function deleteReview(){const r=currentReview();if(!r)return;if(!confirm(`Delete '${r.title}' and all of its period analysis?`))return;const {error}=await db().from("vod_review_sessions").delete().eq("id",r.id);if(error)return setStatus(error.message,"error");state.selectedReviewId="";state.selectedSegmentId="";await loadData();setStatus("VOD review deleted.","success");}

  function bind(){
    $("vodTeam")?.addEventListener("change",e=>{state.teamId=e.target.value;state.selectedReviewId="";state.selectedSegmentId="";loadData();});
    $("refreshVod")?.addEventListener("click",loadData); $("createVod")?.addEventListener("click",createReview); $("buildSegments")?.addEventListener("click",buildSegments); $("addCustomSegment")?.addEventListener("click",addCustomSegment);
    $("saveSegment")?.addEventListener("click",saveSegment); $("addMarker")?.addEventListener("click",addMarker); $("openSegment")?.addEventListener("click",()=>currentSegment()&&openSegmentById(currentSegment().id)); $("copySegmentPacket")?.addEventListener("click",copySegmentPacket);
    $("buildRollup")?.addEventListener("click",buildRollup); $("saveRollup")?.addEventListener("click",saveRollup); $("archiveVod")?.addEventListener("click",archiveReview); $("deleteVod")?.addEventListener("click",deleteReview);
  }
  async function bootstrap(){
    if(!hasAccess()||!db())return; populateTeams(); if(!state.initialized){bind();state.initialized=true;} await loadData();
  }
  window.addEventListener("vvhl-auth-change",()=>setTimeout(bootstrap,0));
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>setTimeout(bootstrap,150));else setTimeout(bootstrap,150);
})();