(() => {
  const state = { initialized:false, loading:false, teamId:"", reviews:[], segments:[], markers:[], publications:[], selectedReviewId:"", selectedSegmentId:"" };
  const model = window.WildmanVODReview;
  let playerMatching = null;
  let publishing = false;
  let editingPeriod = false;
  let savingPeriod = false;
  let manualFieldsReviewId = "";
  let periodFieldsDirty = false;
  let reloadQueued = false;
  const $ = (id) => document.getElementById(id);
  const db = () => window.VVHLBackend?.db;
  const auth = () => window.VVHLBackend?.state || {};
  const esc = (v) => String(v ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[c]);

  function hasAccess(){ return Boolean(window.VVHLManagementGuard?.hasAccess?.(auth())); }
  function setStatus(message,tone=""){ const el=$("vodStatus"); if(!el)return; el.textContent=message; el.className=`vod-status ${tone}`.trim(); }
  function detectProvider(url){ const s=String(url||"").toLowerCase(); if(s.includes("twitch.tv")) return "twitch"; if(s.includes("youtube.com")||s.includes("youtu.be")) return "youtube"; return "external"; }
  function normalizeTwitchReplay(value){
    try{
      const u=new URL(String(value||"").trim());
      if(u.protocol!=="https:"||!["twitch.tv","www.twitch.tv"].includes(u.hostname.toLowerCase())) return "";
      const m=u.pathname.match(/^\/(?:videos|v)\/(\d+)\/?$/)||u.pathname.match(/^\/[^/]+\/v\/(\d+)\/?$/);
      return m?"https://www.twitch.tv/videos/"+m[1]:"";
    }catch{return "";}
  }
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
  // Segment and marker times are already absolute positions in the full VOD.
  function timestampLink(seconds,label){
    const url=currentReview()?.vod_url;
    if(!url||seconds==null||!Number.isFinite(Number(seconds)))return esc(label);
    const href=timestampUrl(url,Number(seconds));
    if(!/^https?:\/\//i.test(href))return esc(label);
    return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer" title="Review footage at ${esc(fmtTime(seconds))} in the full VOD">${esc(label)}</a>`;
  }
  function allowedTeams(){
    const a=auth(), role=String(a.profile?.role||"").toLowerCase();
    if(role==="admin") return a.teams||[];
    const ids=new Set((a.memberships||[]).filter(m=>m.active!==false).map(m=>m.team_id));
    return (a.teams||[]).filter(t=>ids.has(t.id));
  }
  function teamName(){ return allowedTeams().find(t=>t.id===state.teamId)?.name || "Team"; }
  function currentReview(){ return state.reviews.find(r=>r.id===state.selectedReviewId)||null; }
  function currentPublication(){ return state.publications.find(p=>p.review_id===state.selectedReviewId&&p.active)||null; }
  function currentSegment(){ return state.segments.find(s=>s.id===state.selectedSegmentId)||null; }
  function reviewSegments(reviewId=state.selectedReviewId){ return state.segments.filter(s=>s.review_id===reviewId&&!s.archived_at).sort((a,b)=>a.start_seconds-b.start_seconds||a.segment_index-b.segment_index); }
  function reviewMarkers(reviewId=state.selectedReviewId){ return state.markers.filter(m=>m.review_id===reviewId).sort((a,b)=>a.timestamp_seconds-b.timestamp_seconds); }
  function segmentHasAnalysis(segment){ return Boolean(String(segment?.analysis_summary||"").trim()); }

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
    // A refresh asked for while another is running (e.g. right after an approval) runs next,
    // instead of being dropped and leaving stale rows on screen.
    if(state.loading||editingPeriod){reloadQueued=true;return;}
    if(!db()||!hasAccess()||!state.teamId) return;
    reloadQueued=false;
    state.loading=true; setStatus(`Loading ${teamName()} VOD reviews…`);
    try{
      const [r,s,m,p]=await Promise.all([
        db().from("vod_review_sessions").select("*").eq("team_id",state.teamId).neq("status","archived").order("game_date",{ascending:false}),
        db().from("vod_review_segments").select("*").eq("team_id",state.teamId).order("start_seconds"),
        db().from("vod_review_markers").select("*").eq("team_id",state.teamId).order("timestamp_seconds"),
        db().from("vod_game_publications").select("review_id,active,report,published_at").eq("team_id",state.teamId)
      ]);
      if(r.error) throw r.error; if(s.error) throw s.error; if(m.error) throw m.error;if(p.error)throw p.error;
      state.reviews=r.data||[]; state.segments=s.data||[]; state.markers=m.data||[];state.publications=p.data||[];
      if(state.selectedReviewId&&!state.reviews.some(x=>x.id===state.selectedReviewId)){state.selectedReviewId="";state.selectedSegmentId="";}
      const requestedReview=new URLSearchParams(location.search).get("review");
      if(!state.selectedReviewId&&requestedReview&&state.reviews.some(x=>x.id===requestedReview)){
        state.selectedReviewId=requestedReview;
        state.selectedSegmentId="";
      }
      renderAll();
      if(requestedReview&&state.selectedReviewId===requestedReview){
        setTimeout(()=>document.getElementById("vodDetail")?.scrollIntoView({behavior:"smooth",block:"start"}),120);
      }
      setStatus(`${teamName()} VOD Lab ready · ${state.reviews.length} review${state.reviews.length===1?"":"s"}.`,"success");
    }catch(error){
      console.error(error);
      const schema=String(error?.message||"").toLowerCase().includes("vod_review")||String(error?.code||"").startsWith("PGRST");
      setStatus(schema?"Segmented VOD database is not available yet. The interface is deployed safely, but reviews cannot be saved until the schema finishes deploying.":(error.message||"Unable to load VOD reviews."),"error");
    }finally{state.loading=false;if(reloadQueued&&!editingPeriod)setTimeout(loadData,0);}
  }

  function renderKpis(){
    const active=model.activeSegments(state.segments),ids=new Set(active.map(s=>s.id));
    $("vodReviewCount").textContent=state.reviews.length;
    $("vodSegmentCount").textContent=active.length;
    $("vodCompleteCount").textContent=active.filter(s=>s.status==="complete").length;
    $("vodMarkerCount").textContent=state.markers.filter(m=>!m.segment_id||ids.has(m.segment_id)).length;
  }
  function renderLibrary(){
    const el=$("vodLibrary"); if(!el)return;
    if(!state.reviews.length){el.innerHTML=`<div class="vod-empty">No VOD reviews in this workspace yet.</div>`;return;}
    el.innerHTML=state.reviews.map(r=>{
      const segs=reviewSegments(r.id),done=segs.filter(s=>s.status==="complete").length;
      return `<div class="vod-library-entry"><button class="vod-row${r.id===state.selectedReviewId?" active":""}" data-vod-id="${esc(r.id)}"><strong>${esc(r.title)}</strong><span>${esc(r.opponent_label||"No opponent label")}</span><small>${esc(String(r.intake_mode||"scout").toUpperCase())} · ${esc(String(r.game_type||"scouting").replaceAll("_"," "))} · ${done}/${segs.length} segments complete · ${r.game_date?new Date(r.game_date).toLocaleDateString():"No date"}</small></button><button hidden type="button" class="small-btn" data-delete-vod="${esc(r.id)}" aria-label="Delete ${esc(r.title)}">Delete review</button></div>`;
    }).join("");
    el.querySelectorAll("[data-vod-id]").forEach(b=>b.addEventListener("click",()=>selectReview(b.dataset.vodId)));
    el.querySelectorAll("[data-delete-vod]").forEach(b=>b.addEventListener("click",()=>deleteReview(b.dataset.deleteVod)));
  }
  function renderDetail(){
    const r=currentReview(),empty=$("vodEmpty"),detail=$("vodDetail");
    if(!r){empty.hidden=false;detail.hidden=true;return;}
    empty.hidden=true;detail.hidden=false;
    $("vodDetailTeam").textContent=`${teamName()} · ${String(r.intake_mode||"scout").toUpperCase()} · ${String(r.game_type||"review").replaceAll("_"," ")}`;
    $("vodDetailTitle").textContent=r.title;
    const sourceStart=Math.max(0,Number(r.source_start_seconds)||0);
    const sourceEnd=r.source_end_seconds==null?null:Number(r.source_end_seconds);
    const sourceWindow=sourceEnd!=null?`VOD ${fmtTime(sourceStart)} → ${fmtTime(sourceEnd)}`:(sourceStart?`VOD from ${fmtTime(sourceStart)}`:"full VOD");
    $("vodDetailMeta").textContent=`${r.opponent_label||"Opponent not labeled"} · ${r.game_date?new Date(r.game_date).toLocaleString():"No date"} · ${r.duration_seconds!=null?fmtTime(r.duration_seconds):"length not set"} · ${sourceWindow}`;
    const link=$("vodOpenLink"); link.href=r.vod_url?timestampUrl(r.vod_url,sourceStart):"#"; link.style.display=r.vod_url?"inline-flex":"none";
    const manualBuilder=$("manualPeriodBuilder");
    const segs=reviewSegments();
    const p=(i)=>segs.find(s=>s.segment_type==="period"&&s.segment_index===i);
    const ots=segs.filter(s=>s.segment_type==="overtime").map(s=>fmtTime(s.start_seconds));
    const switchedReview=manualFieldsReviewId!==r.id;
    // Never overwrite times the manager is typing; refill only on a new game or after a save.
    if(switchedReview||!periodFieldsDirty){
      const absoluteEnd=sourceEnd!=null?sourceEnd:(r.duration_seconds!=null?sourceStart+Number(r.duration_seconds):null);
      $("period1Start").value=p(1)?fmtTime(p(1).start_seconds):"";
      $("period2Start").value=p(2)?fmtTime(p(2).start_seconds):"";
      $("period3Start").value=p(3)?fmtTime(p(3).start_seconds):"";
      $("periodVodEnd").value=p(1)&&absoluteEnd!=null?fmtTime(absoluteEnd):"";
      $("periodOtStarts").value=ots.join(", ");
      if($("periodSkips"))$("periodSkips").value=(Array.isArray(r.skip_ranges)?r.skip_ranges:[]).map(s=>`${fmtTime(s.start)}-${fmtTime(s.end)}`).join(", ");
      if(switchedReview&&$("periodTimesStatus"))$("periodTimesStatus").textContent="";
      manualFieldsReviewId=r.id;periodFieldsDirty=false;
    }
    if(manualBuilder&&switchedReview)manualBuilder.open=!(p(1)&&p(2)&&p(3));
    $("gameSummary").value=r.full_game_summary||""; $("gamePatterns").value=r.recurring_patterns||""; $("gameStrengths").value=r.strengths||""; $("gameCorrections").value=r.corrections||"";
    if($("gameTactical")) $("gameTactical").value=r.tactical_report||"";
    if($("gamePlayers")) $("gamePlayers").value=r.player_report||"";
    if($("gameProfessional")) $("gameProfessional").value=r.professional_writeup||"";
    renderSegments(); renderSegmentEditor(); renderGameLayers();
    window.dispatchEvent(new CustomEvent("vvhl-vod-rendered",{detail:{review:r,segments:reviewSegments(),publication:state.publications.find(p=>p.review_id===r.id)}}));
  }
  function renderSegments(){
    const el=$("segmentList"),segs=reviewSegments();
    if(!segs.length){
      renderArchivedSegments();
      const r=currentReview();
      const txt=r?.worker_status==="ready_for_review"
        ? "Full-game scouting analysis is ready. Automatic P1/P2/P3 detection was not confident enough for this recording, so the report below covers the available full-game evidence."
        : r?.worker_job_id&&r.worker_status!=="needs_periods"
          ? "Automatic capture or analysis is still processing. Periods will appear here if detection succeeds."
          : "No periods built yet. Use the manual fallback only if automatic detection asks for help.";
      el.innerHTML=[1,2,3].map(n=>`<article class="segment-card"><h4>Period ${n}</h4><span class="segment-pill">Awaiting detection</span><p>Time range pending</p><button class="small-btn" disabled>Review</button></article>`).join("")+`<p class="analysis-note">${esc(txt)}</p>`;return;
    }
    el.innerHTML=segs.map(s=>{
      const waiting=!segmentHasAnalysis(s)&&["queued","reviewing","needs_review"].includes(s.status);
      const displayStatus=waiting?"waiting_analysis":s.status;
      const displayLabel=s.status==="complete"?"APPROVED ✓":waiting?"waiting for analysis":String(s.status).replaceAll("_"," ");
      return `<article class="segment-card${s.id===state.selectedSegmentId?" selected":""}">
      <div class="segment-card-head"><div><h4>${esc(s.label)}</h4><small>${esc(fmtTime(s.start_seconds))} → ${esc(fmtTime(s.end_seconds))}${s.end_seconds!=null?` · ${fmtTime(s.end_seconds-s.start_seconds)}`:""}</small></div><span class="segment-pill ${esc(displayStatus)}">${esc(displayLabel)}</span></div>
      ${s.status==='complete'?'':`<p class="segment-preview">${esc((s.analysis_summary||"Waiting for period analysis.").slice(0,180))}</p>`}<div class="segment-card-actions"><button class="small-btn" type="button" data-segment-id="${esc(s.id)}" aria-expanded="${s.id===state.selectedSegmentId}">${s.id===state.selectedSegmentId?'Hide Report':s.status==='complete'?'View Report':'Review'}</button>${s.status==='complete'?`<button class="small-btn" type="button" data-reopen-segment="${esc(s.id)}">Reopen</button>`:segmentHasAnalysis(s)?`<button class="small-btn primary" type="button" data-quick-approve="${esc(s.id)}">Approve Period</button>`:''}<button class="small-btn" type="button" data-archive-segment="${esc(s.id)}">Archive</button></div>
    </article>`;
    }).join("");
    const ready=segs.filter(s=>segmentHasAnalysis(s)&&s.status!=="complete");
    if(ready.length>1)el.insertAdjacentHTML("beforeend",`<div class="segment-card-actions"><button class="small-btn primary" type="button" id="approveAllReadyPeriods">✓ Approve All Ready Periods (${ready.length})</button></div>`);
    el.querySelectorAll("[data-segment-id]").forEach(b=>b.addEventListener("click",()=>selectSegment(b.dataset.segmentId)));
    el.querySelectorAll("[data-quick-approve]").forEach(b=>b.addEventListener("click",()=>quickApproveSegment(b.dataset.quickApprove)));
    el.querySelectorAll("[data-archive-segment]").forEach(b=>b.addEventListener("click",()=>setSegmentArchive(b.dataset.archiveSegment,true)));
    el.querySelectorAll("[data-reopen-segment]").forEach(b=>b.addEventListener("click",()=>reopenSegment(b.dataset.reopenSegment)));
    renderArchivedSegments();
    el.querySelector("#approveAllReadyPeriods")?.addEventListener("click",approveAllReadyPeriods);
    el.querySelectorAll("[data-segment-open]").forEach(b=>b.addEventListener("click",()=>openSegmentById(b.dataset.segmentOpen)));
  }
  function renderSegmentEditor(){
    const s=currentSegment(),wrap=$("segmentEditorWrap"); if(!s){wrap.hidden=true;return;} wrap.hidden=false;
    $("segmentEditorTitle").textContent=s.label; $("segmentStart").value=fmtTime(s.start_seconds); $("segmentEnd").value=s.end_seconds==null?"":fmtTime(s.end_seconds);
    $("segmentStatus").value=s.status; $("segmentConfidence").value=s.confidence||"preliminary"; $("segmentSummary").value=s.analysis_summary||"";
    $("segmentOffense").value=s.offense_notes||""; $("segmentDefense").value=s.defense_notes||""; $("segmentTransition").value=s.transition_notes||""; $("segmentSpecial").value=s.special_teams_notes||"";
    $("segmentForecheck").value=s.forecheck_notes||"";$("segmentBreakout").value=s.breakout_notes||"";
    $("segmentPlayers").value=Array.isArray(s.player_notes)?s.player_notes.map(x=>typeof x==="string"?x:(x.note||JSON.stringify(x))).join("\n"):"";
    $("segmentTags").value=Array.isArray(s.tags)?s.tags.join(", "):"";
    renderPeriodContent(s); renderMarkers();
  }
  function renderMarkers(){
    const el=$("markerList"),s=currentSegment(); if(!el||!s)return;
    const rows=reviewMarkers().filter(m=>m.segment_id===s.id);
    if(!rows.length){el.innerHTML=`<div class="vod-empty">No timestamp markers for ${esc(s.label)} yet.</div>`;return;}
    el.innerHTML=rows.map(m=>`<div class="marker-row"><b>${timestampLink(m.timestamp_seconds,fmtTime(m.timestamp_seconds))}</b><small>${esc(String(m.category).replaceAll("_"," "))}${m.player_label?` · ${esc(m.player_label)}`:""}</small><span>${esc(m.note)}</span></div>`).join("");
  }
  function renderAll(){renderKpis();renderLibrary();renderDetail();}

  function selectReview(id){
    editingPeriod=false; state.selectedReviewId=id; state.selectedSegmentId=""; renderAll();
    const url=new URL(location.href);url.searchParams.set("review",id);history.replaceState(null,"",url);
    setTimeout(()=>document.getElementById("vodDetail")?.scrollIntoView({behavior:"smooth",block:"start"}),50);
  }
  function selectSegment(id){editingPeriod=false;state.selectedSegmentId=state.selectedSegmentId===id?"":id; renderSegments();renderSegmentEditor(); if(state.selectedSegmentId)document.getElementById("segmentEditorWrap")?.scrollIntoView({behavior:"smooth",block:"start"});}
  function openSegmentById(id){const r=currentReview(),s=state.segments.find(x=>x.id===id); if(!r?.vod_url||!s)return; window.open(timestampUrl(r.vod_url,s.start_seconds),"_blank","noopener");}

  async function createReview(){
    const title=$("newVodTitle").value.trim();
    const rawUrl=$("newVodUrl").value.trim();
    const provider=detectProvider(rawUrl);
    let duration=parseTime($("newVodDuration").value);
    const sourceStart=parseTime($("newVodSourceStart")?.value||"0:00") ?? 0;
    const sourceEnd=parseTime($("newVodSourceEnd")?.value);
    const user=auth().user;
    let url=rawUrl;

    if(provider==="twitch"&&rawUrl){
      const normalized=normalizeTwitchReplay(rawUrl);
      if(!normalized){
        return setStatus("Paste a Twitch VOD replay link such as twitch.tv/videos/123… or twitch.tv/channel/v/123…. A channel link by itself cannot be processed.","error");
      }
      url=normalized;
      $("newVodUrl").value=normalized;
    }

    if(!title) return setStatus("Give the VOD review a title first.","error");
    if($("newVodDuration").value.trim()&&duration==null) return setStatus("Game window length must look like 45:20 or 1:32:10.","error");
    if($("newVodSourceStart")?.value.trim()&&parseTime($("newVodSourceStart").value)==null) return setStatus("Game start must look like 12:30 or 1:02:15.","error");
    if($("newVodSourceEnd")?.value.trim()&&sourceEnd==null) return setStatus("Game end must look like 38:45 or 1:22:10.","error");
    if(sourceEnd!=null&&sourceEnd<=sourceStart) return setStatus("Game end must be after the game start.","error");
    if(sourceEnd!=null) duration=sourceEnd-sourceStart;
    const dateVal=$("newVodDate").value;
    const intakeMode=$("newVodIntakeMode")?.value||"scout";
    const payload={
      team_id:state.teamId,
      title,
      vod_url:url||null,
      source_provider:provider,
      opponent_label:$("newVodOpponent").value.trim()||null,
      game_type:$("newVodType").value,
      intake_mode:intakeMode,
      game_format:$("newVodFormat")?.value||"6s",
      scouting_context:$("newVodPlayers")?.value.trim()||null,
      game_date:dateVal?new Date(dateVal).toISOString():new Date().toISOString(),
      source_start_seconds:sourceStart,
      source_end_seconds:sourceEnd,
      duration_seconds:duration,
      created_by:user?.id||null,
      status:intakeMode==="archive"?"ready":"queued"
    };
    setStatus("Creating VOD review…");
    const {data,error}=await db().from("vod_review_sessions").insert(payload).select().single();
    if(error)return setStatus(error.message,"error");
    state.selectedReviewId=data.id;
    state.selectedSegmentId="";
    $("newVodTitle").value="";
    $("newVodOpponent").value="";
    $("newVodUrl").value="";
    $("newVodDuration").value="";
    if($("newVodSourceStart")) $("newVodSourceStart").value="0:00";
    if($("newVodSourceEnd")) $("newVodSourceEnd").value="";
    if($("newVodPlayers")) $("newVodPlayers").value="";
    if($("newVodFormat")) $("newVodFormat").value="6s";
    await loadData();
    setStatus(
      intakeMode==="scout"&&provider==="twitch"
        ?"Scout review created. Step 1: enter the period times below and save them. Step 2: press Analyze Game."
        :intakeMode==="scout"
          ?"Scout review created. Analyze Game will retrieve the recording and run scouting intelligence."
          :intakeMode==="media"
            ?"Media source created. It can feed broadcasts and postgame content without scouting analysis."
            :"Archive source saved. No analysis job will run unless you later change it to Scout.",
      "success"
    );
    if(intakeMode==="scout"){
      // Analysis starts only after the period times are entered; nothing is guessed from the scoreboard.
      const builder=$("manualPeriodBuilder");if(builder){builder.open=true;setTimeout(()=>builder.scrollIntoView({behavior:"smooth",block:"start"}),200);}
    }
  }

  async function createBatchReviews(){
    const status=$("batchVodStatus");
    const rawUrl=$("batchVodUrl")?.value.trim()||"";
    const url=normalizeTwitchReplay(rawUrl);
    const rawLines=($("batchVodWindows")?.value||"").split("\n").map(x=>x.trim()).filter(Boolean);
    if(!url){if(status)status.textContent="Paste a Twitch replay link such as twitch.tv/videos/123…";return;}
    if(!rawLines.length){if(status)status.textContent="Add at least one game window.";return;}
    if(rawLines.length>8){if(status)status.textContent="Use at most eight games per batch.";return;}
    const windows=[];
    for(let i=0;i<rawLines.length;i++){
      const parts=rawLines[i].split("|").map(x=>x.trim());
      if(parts.length<3||parts.length>4){if(status)status.textContent=`Line ${i+1} must be: Title | Start | End | Opponent`;return;}
      const [title,startText,endText,opponent=""]=parts;
      const start=parseTime(startText),end=parseTime(endText);
      if(!title||start==null||end==null||end<=start){if(status)status.textContent=`Line ${i+1} has an invalid title or time window.`;return;}
      windows.push({title,start,end,opponent});
    }
    const user=auth().user;
    const dateVal=$("batchVodDate")?.value;
    const gameDate=dateVal?new Date(dateVal).toISOString():new Date().toISOString();
    const gameType=$("batchVodType")?.value||"regular";
    const gameFormat=$("batchVodFormat")?.value||"6s";
    const context=$("batchVodPlayers")?.value.trim()||null;
    const payload=windows.map((game,index)=>({
      team_id:state.teamId,
      title:game.title||`Game ${index+1}`,
      vod_url:url,
      source_provider:"twitch",
      opponent_label:game.opponent||null,
      game_type:gameType,
      intake_mode:"scout",
      game_format:gameFormat,
      scouting_context:context,
      game_date:gameDate,
      source_start_seconds:game.start,
      source_end_seconds:game.end,
      duration_seconds:game.end-game.start,
      created_by:user?.id||null,
      status:"queued"
    }));
    if(status)status.textContent=`Creating ${payload.length} game reviews…`;
    const {data,error}=await db().from("vod_review_sessions").insert(payload).select("id,title");
    if(error){if(status)status.textContent=error.message;return;}
    const ids=(data||[]).map(x=>x.id);
    state.selectedReviewId=ids[0]||"";
    state.selectedSegmentId="";
    $("batchVodUrl").value=url;
    await loadData();
    if(status)status.textContent=`Created ${ids.length} games. Open each game, enter its period times, then press Analyze Game.`;
  }

  async function buildSegments(){
    const r=currentReview(); if(!r)return;
    const note=$("periodTimesStatus"),say=(text,tone)=>{if(note)note.textContent=text;setStatus(text,tone);};
    const plan=model.planPeriods({p1:$("period1Start").value,p2:$("period2Start").value,p3:$("period3Start").value,overtimes:$("periodOtStarts").value,end:$("periodVodEnd").value,skips:$("periodSkips")?.value||""});
    if(plan.errors.length)return say(plan.errors.join(" "),"error");
    say("Saving period times…","");
    // One database step: keeps periods whose times did not change (and their approval), archives
    // changed ones as history, adds new ones and sets the game window to Period 1 → game end.
    const {data,error}=await db().rpc("set_vod_period_windows",{target_review:r.id,expected_updated_at:r.updated_at,window_start:plan.window.start,window_end:plan.window.end,periods:plan.segments,skip_ranges:plan.skips});
    if(error)return say(error.message||"Period times were not saved.","error");
    periodFieldsDirty=false;
    await loadData(); state.selectedSegmentId="";renderAll();
    const changed=Number(data?.added||0)+Number(data?.archived||0);
    say(changed?"Period times saved. Press Analyze Game to analyze exactly these periods.":"Period times saved (no change).","success");
  }
  async function addCustomSegment(){
    const r=currentReview(); if(!r)return; const existing=state.segments.filter(s=>s.review_id===r.id&&s.segment_type==="custom"); const idx=Math.max(0,...existing.map(s=>s.segment_index))+1;
    const sourceStart=Math.max(0,Number(r.source_start_seconds)||0);
    const {data,error}=await db().from("vod_review_segments").insert({review_id:r.id,team_id:state.teamId,segment_type:"custom",segment_index:idx,label:`Custom ${idx}`,start_seconds:sourceStart,status:"queued"}).select().single();
    if(error)return setStatus(error.message,"error"); await loadData(); state.selectedSegmentId=data.id;renderAll();setStatus("Custom segment added. Set its timestamps and review it independently.","success");
  }

  function renderArchivedSegments(){
    const box=$("archivedPeriods"),list=$("archivedPeriodList");
    const archived=state.segments.filter(s=>s.review_id===state.selectedReviewId&&s.archived_at);
    box.hidden=!archived.length;
    list.innerHTML=archived.map(s=>`<div class="archived-period"><b>${esc(s.label)}</b><span>${esc(fmtTime(s.start_seconds))} → ${esc(fmtTime(s.end_seconds))} · ${esc(s.status)}</span><button class="small-btn" data-restore-segment="${esc(s.id)}">Restore</button></div>`).join('');
    list.querySelectorAll('[data-restore-segment]').forEach(b=>b.addEventListener('click',()=>setSegmentArchive(b.dataset.restoreSegment,false)));
  }
  async function setSegmentArchive(id,archive){
    const s=state.segments.find(x=>x.id===id&&x.review_id===state.selectedReviewId);if(!s)return;
    if(archive&&!confirm(`Archive ${s.label}? Evidence, timestamps and review history are preserved. Required P1/P2/P3 must be restored or replaced before publishing.`))return;
    try{
      const {error}=await db().rpc('set_vod_segment_archive',{target_segment:s.id,expected_updated_at:s.updated_at,archive_segment:archive});
      if(error)throw error;
      if(state.selectedSegmentId===s.id)state.selectedSegmentId='';
      await loadData();setStatus(`${s.label} ${archive?'archived. Restore it under Archived Periods.':'restored with its saved evidence.'}`,'success');
    }catch(e){setStatus(e.message||'Could not update period archive.','error');}
  }
  async function reopenSegment(id){
    const s=state.segments.find(x=>x.id===id&&x.review_id===state.selectedReviewId&&!x.archived_at);if(!s)return;
    try{
      const {error}=await db().rpc('reopen_vod_segment',{target_segment:s.id,expected_updated_at:s.updated_at});
      if(error)throw error;
      state.selectedSegmentId=s.id;await loadData();setStatus(`${s.label} reopened for review. Saved evidence retained.`,'success');
    }catch(e){setStatus(e.message||'Could not reopen period.','error');}
  }

  async function quickApproveSegment(id){
    if(savingPeriod)return;
    const s=state.segments.find(x=>x.id===id&&x.review_id===state.selectedReviewId);
    if(!s||s.status==="complete")return;
    if(!segmentHasAnalysis(s))return setStatus(`${s?.label||"Period"} cannot be approved until analysis evidence is imported.`,"error");
    savingPeriod=true;
    try{
      const {data,error}=await db().from("vod_review_segments").update({status:"complete",analyzed_by:auth().user?.id||null,updated_at:new Date().toISOString()}).eq("id",s.id).eq("updated_at",s.updated_at).select("id");
      if(error)throw error;if(!data?.length)throw new Error("This period changed elsewhere. Refresh before approving.");
      await loadData();setStatus(`${s.label} approved. No extra review screen required.`,"success");
    }catch(error){setStatus(error.message||"Could not approve period.","error");}
    finally{savingPeriod=false;}
  }

  async function approveAllReadyPeriods(){
    if(savingPeriod)return;
    const ready=reviewSegments().filter(s=>segmentHasAnalysis(s)&&s.status!=="complete");
    if(!ready.length)return setStatus("No analyzed periods are waiting for approval.","success");
    savingPeriod=true;
    try{
      for(const s of ready){
        const {data,error}=await db().from("vod_review_segments").update({status:"complete",analyzed_by:auth().user?.id||null,updated_at:new Date().toISOString()}).eq("id",s.id).eq("updated_at",s.updated_at).select("id");
        if(error)throw error;if(!data?.length)throw new Error(`${s.label} changed elsewhere. Refresh before approving the remaining periods.`);
      }
      await loadData();setStatus(`Approved ${ready.length} ready periods. Failed or evidence-free periods were left untouched.`,"success");
    }catch(error){await loadData();setStatus(error.message||"Could not approve all ready periods.","error");}
    finally{savingPeriod=false;}
  }

  async function saveSegment(decision="needs_review"){
    if(typeof decision!=="string")decision="needs_review";
    if(savingPeriod)return;
    const problems=model.periodErrors(currentReview(),reviewSegments());
    if(problems.length)return setStatus(problems.join(" "),"error");
    if(decision==="complete"&&!$("segmentSummary").value.trim())return setStatus("A period summary is required before approval.","error");
    const s=currentSegment(); if(!s)return; const start=parseTime($("segmentStart").value),end=parseTime($("segmentEnd").value);
    if(start==null||(end!=null&&end<start))return setStatus("Segment timestamps are invalid.","error");
    const playerNotes=$("segmentPlayers").value.split("\n").map(x=>x.trim()).filter(Boolean); const tags=$("segmentTags").value.split(",").map(x=>x.trim()).filter(Boolean);
    const payload={start_seconds:start,end_seconds:end,status:decision,confidence:$("segmentConfidence").value,analysis_summary:$("segmentSummary").value.trim()||null,forecheck_notes:$("segmentForecheck").value.trim()||null,breakout_notes:$("segmentBreakout").value.trim()||null,offense_notes:$("segmentOffense").value.trim()||null,defense_notes:$("segmentDefense").value.trim()||null,transition_notes:$("segmentTransition").value.trim()||null,special_teams_notes:$("segmentSpecial").value.trim()||null,player_notes:playerNotes,tags,updated_at:new Date().toISOString()};
    // Only an approval records the approver; saving or rejecting must not lock the period against new analysis.
    if(decision==="complete")payload.analyzed_by=auth().user?.id||null;
    savingPeriod=true;
    try{
      const {data,error}=await db().from("vod_review_segments").update(payload).eq("id",s.id).eq("updated_at",s.updated_at).select("id");
      if(error)throw error;if(!data?.length)throw new Error("This period changed elsewhere. Refresh before saving.");
      editingPeriod=false;await loadData();state.selectedSegmentId=s.id;renderAll();
      setStatus(decision==="complete"?`${s.label} approved.`:decision==="needs_review"?`${s.label} saved for review.`:`${s.label} rejected. Fix the period times if needed, then press Analyze Game to re-run it.`,"success");
    }catch(error){setStatus(error.message,"error");}finally{savingPeriod=false;}
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
    // A blank box keeps the saved text; the structured report is stored only once every period is approved,
    // so an early draft never outranks the next analysis.
    const keep=(id,current)=>($(id)?.value||"").trim()||current||null;
    const payload={full_game_summary:keep("gameSummary",r.full_game_summary),recurring_patterns:keep("gamePatterns",r.recurring_patterns),strengths:keep("gameStrengths",r.strengths),corrections:keep("gameCorrections",r.corrections),tactical_report:keep("gameTactical",r.tactical_report),player_report:keep("gamePlayers",r.player_report),professional_writeup:keep("gameProfessional",r.professional_writeup),status:"reviewing",updated_at:new Date().toISOString()};
    if(allDone&&!model.periodErrors(r,segs,{approved:true}).length)payload.review_document=editedDocument();
    const {error}=await db().from("vod_review_sessions").update(payload).eq("id",r.id); if(error)return setStatus(error.message,"error"); await loadData(); state.selectedReviewId=r.id;renderAll();setStatus("Game report draft saved. Publish after approving every period.","success");
  }
  async function archiveReview(){const r=currentReview();if(!r)return;const {error}=await db().from("vod_review_sessions").update({status:"archived",updated_at:new Date().toISOString()}).eq("id",r.id);if(error)return setStatus(error.message,"error");state.selectedReviewId="";state.selectedSegmentId="";await loadData();setStatus("VOD review archived.","success");}
  async function deleteReview(id){
    const r=typeof id==="string"?state.reviews.find(review=>review.id===id):currentReview();
    if(!r)return;
    if(!confirm(`Permanently delete '${r.title}' and its saved period analysis and markers? This cannot be undone.`))return;
    try{
      const {data,error}=await db().from("vod_review_sessions").delete().eq("id",r.id).eq("team_id",state.teamId).select("id");
      if(error)throw error;
      if(!data?.length)throw new Error("Review was not deleted. Refresh and check your management access.");
      if(state.selectedReviewId===r.id){state.selectedReviewId="";state.selectedSegmentId="";}
      await loadData();setStatus("VOD review deleted.","success");
    }catch(error){setStatus(error.message||"Could not delete review.","error");}
  }


  function renderPeriodContent(s){
    if(!s)return;
    $("periodEditFields").hidden=!editingPeriod;
    $("saveSegment").hidden=!editingPeriod;
    $("editSegment").textContent=editingPeriod?"Cancel Edit":"Edit";
    const canApprove=segmentHasAnalysis(s);
    for(const id of ['editSegment','rejectSegment','approveSegment'])$(id).hidden=s.status==='complete';
    $("approveSegment").disabled=editingPeriod||s.status==="complete"||!canApprove;
    $("approveSegment").title=canApprove?"":"Period analysis must be imported before approval.";
    const chunks=currentReview()?.worker_result?.chunks||[];
    const tactical=chunks.filter(c=>c.label===s.label).map(c=>c.review?.tactical||{});
    const field=k=>[...new Set(tactical.map(t=>t[k]).filter(Boolean))].join("\n");
    const sections=[["Period Summary",s.analysis_summary],["Offense",s.offense_notes||field("offense")],["Defense",s.defense_notes||field("defense")],["Transition",s.transition_notes||field("transition")],["Forecheck",s.forecheck_notes||field("forecheck")],["Breakout",s.breakout_notes||field("breakout")],["Player Notes",Array.isArray(s.player_notes)?s.player_notes.map(p=>typeof p==="string"?p:p.note||"").join("\n"):""]];
    if(s.special_teams_notes||field("special_teams"))sections.push(["Special Teams",s.special_teams_notes||field("special_teams")]);
    $("periodReviewContent").innerHTML=sections.map(([label,value])=>`<section><h4>${esc(label)}</h4><p>${esc(value||"Insufficient reviewed evidence.")}</p></section>`).join("");
    $("periodReviewContent").hidden=editingPeriod;
  }
  const scoreLabel=r=>r?`${r.score}/100 — ${r.reason||"Management review required"}`:"Not rated — insufficient reviewed evidence";
  function workerDocument(review,result){
    const rollup=result?.game_rollup||{};
    return model.documentFor({...review,worker_result:result,full_game_summary:rollup.summary||"",tactical_report:rollup.tactical_report||"",player_report:rollup.player_report||""});
  }
  function reportDocument(){
    const r=currentReview();if(!r)return model.documentFor({});
    let doc=r.review_document?.version===1?r.review_document:model.documentFor(r);
    doc=model.mergeDocuments(doc,model.documentFor(r));
    const approved=model.periodErrors(r,reviewSegments(),{approved:true}).length===0;
    if(approved&&r.pending_worker_result)doc=model.mergeDocuments(doc,workerDocument(r,r.pending_worker_result));
    // Fill any blank systems/player layers from the approved period notes, so a
    // missing or failed worker rollup never leaves the published report empty.
    if(approved)doc=model.mergeDocuments(doc,model.documentFromPeriods(r,reviewSegments()));
    return doc;
  }
  function renderGameLayers(){
    const doc=reportDocument(),problems=model.periodErrors(currentReview(),reviewSegments(),{approved:true});
    const pending=currentReview()?.pending_worker_result;
    const draft=document.getElementById('pendingAnalysisDraft');
    if(draft){
      draft.hidden=!pending;
      const mergedIntoPreview=Boolean(pending)&&problems.length===0;
      const summary=draft.querySelector('summary');
      if(summary)summary.textContent=mergedIntoPreview?'New Analysis Draft · merged into report preview':'New Analysis Draft · saved separately';
      const intro=draft.querySelector('[data-pending-intro]');
      if(intro)intro.textContent=mergedIntoPreview?'Approved periods are protected. Missing structured fields below are supplemented from this draft and will be saved when you publish.':'These suggestions do not replace approved reports. Approve the required periods before they can supplement the final report.';
      document.getElementById('pendingAnalysisContent').textContent=pending?[
        pending.game_rollup?.summary,
        ...(pending.period_reports||[]).map(p=>`${p.label}: ${p.report?.summary||'No summary'}`)
      ].filter(Boolean).join('\n\n')||'New period evidence is saved for comparison. Current reviewed reports remain unchanged.':'';
    }
    const section=(title,value)=>`<section><h4>${esc(title)}</h4><p>${esc(value||"Insufficient reviewed evidence.")}</p></section>`;
    const openLayers=new Set([...$("gameReviewLayers").querySelectorAll("details[open]")].map(d=>d.dataset.layer));
    $("gameReviewLayers").innerHTML=`<p class="analysis-note">${problems.length?esc(problems.join(" ")):"All periods approved. Review the three report layers before publishing."}</p><details data-layer="team"><summary>Team Systems Report</summary>${section("Game overall",scoreLabel(doc.game_rating))}${section("Result",doc.result)}${section("Process",doc.process||doc.summary)}<div class="period-review-content">${model.systems.map(k=>section(k.replaceAll("_"," "),doc.team_systems?.[k])).join("")}</div>${doc.tactical_report?section("Tactical evidence",doc.tactical_report):""}</details><details data-layer="units"><summary>Line / D-pair Reports</summary>${doc.units.length?doc.units.map(u=>section(`${u.label} · ${u.players.join(" / ")}`,[u.summary,u.strengths,u.concerns,u.adjustments,scoreLabel(u.rating)].filter(Boolean).join("\n"))).join(""):section("Unit evidence","No verified line or defense-pair report yet. Lineup names alone do not establish chemistry.")}</details><details data-layer="players"><summary>Individual Player Reports</summary>${doc.players.length?doc.players.map(p=>section(p.player,[p.strengths,p.concerns,p.habits,p.coach_note,scoreLabel(p.rating)].filter(Boolean).join("\n"))+`<p class="evidence-links">${(p.evidence_timestamps||[]).map(t=>timestampLink(t,fmtTime(t))).join(" · ")}</p>`).join(""):section("Player evidence",doc.player_report)}</details>`;
    $("gameReviewLayers").querySelectorAll("details").forEach(d=>{d.open=openLayers.has(d.dataset.layer);});
    $("publishVodReport").disabled=problems.length>0;
    renderPlayerMatches();
    renderReviewCompletion();
    let editor=$("structuredReportFields");
    if(!editor){editor=document.createElement("div");editor.id="structuredReportFields";editor.className="rollup-grid";$("gameReportEdits").append(editor);}
    const field=(path,label,value)=>`<label class="wide">${esc(label)}<textarea class="text-input" data-report-path="${esc(path)}">${esc(value||"")}</textarea></label>`;
    editor.innerHTML=field("result","Result",doc.result)+field("process","Process",doc.process)+model.systems.map(k=>field(`team_systems.${k}`,k.replaceAll("_"," "),doc.team_systems?.[k])).join("")+doc.units.map((u,i)=>['summary','strengths','concerns','adjustments'].map(k=>field(`units.${i}.${k}`,`${u.label}: ${k}`,u[k])).join("")).join("")+doc.players.map((p,i)=>['strengths','concerns','habits','coach_note'].map(k=>field(`players.${i}.${k}`,`${p.player}: ${k}`,p[k])).join("")).join("");
  }
  function editedDocument(){
    const doc=JSON.parse(JSON.stringify(reportDocument()));
    document.querySelectorAll('[data-report-path]').forEach(el=>{const keys=el.dataset.reportPath.split('.');let target=doc;for(const key of keys.slice(0,-1))target=target[key];target[keys.at(-1)]=el.value.trim();});
    // A blank box keeps the approved report's own text instead of wiping it (publishing requires a summary).
    const keep=(box,current)=>(box?.value||"").trim()||String(current||"").trim();
    doc.summary=keep($("gameSummary"),doc.summary);
    doc.tactical_report=keep($("gameTactical"),doc.tactical_report);
    doc.player_report=keep($("gamePlayers"),doc.player_report);
    doc.player_matches=playerMatching?.reviewId===state.selectedReviewId
      ? {...playerMatching.matches} : {...(currentReview()?.review_document?.player_matches||{})};
    return doc;
  }
  const playerNameKey=name=>String(name||"").trim().toLowerCase();
  function renderPlayerMatches(){
    const box=$("vodPlayerMatchRows");if(!box)return;
    const loaded=playerMatching?.reviewId===state.selectedReviewId;
    $("lookupVodChelNames").disabled=!loaded||publishing;
    $("saveVodPlayerMatches").disabled=!loaded||publishing||model.periodErrors(currentReview(),reviewSegments(),{approved:true}).length>0;
    if(!loaded){box.innerHTML="";$("vodPlayerMatchStatus").textContent="Load the game’s players to match names or review saved matches.";return;}
    const {candidates,matches,suggestions}=playerMatching;
    const groups=[["Played this game · official box score",candidates.filter(p=>p.played)],
      ["Listed in this game’s lineup",candidates.filter(p=>!p.played&&p.lineup)],
      ["Other team players · confirm participation",candidates.filter(p=>!p.played&&!p.lineup)]];
    const names=[...new Set(reportDocument().players.map(p=>p.player))];
    box.innerHTML=names.map((name,i)=>{
      const key=playerNameKey(name),exact=candidates.filter(p=>playerNameKey(p.gamertag)===key);
      const value=matches[key]??(exact.length===1?exact[0].id:"");
      const hints=suggestions.filter(s=>playerNameKey(s.name)===key).map(s=>s.gamertag);
      const chel=candidates.filter(p=>p.chelName&&playerNameKey(p.chelName)===key).map(p=>p.gamertag);
      const hint=[...new Set([...hints,...chel])];
      return `<label class="vod-player-match-row" for="vodMatch${i}"><span><strong>${esc(name)}</strong><small>${hint.length?'Suggested: '+esc(hint.join(' / '))+' · confirm below':value==='ignore'?'Excluded from team stalls':value?'Linked to one player':'Needs a match'}</small></span><select id="vodMatch${i}" class="select-field" data-vod-player-name="${esc(key)}"><option value="">Leave unmatched</option><option value="ignore" ${value==='ignore'?'selected':''}>Opponent / exclude from team stalls</option>${groups.filter(([,players])=>players.length).map(([label,players])=>`<optgroup label="${esc(label)}">${players.map(p=>`<option value="${esc(p.id)}" ${value===p.id?'selected':''}>${esc(p.gamertag)} · ${esc(p.position||'?')}${p.chelName?' · CHEL: '+esc(p.chelName):''}${p.lg_user_id?' · LG '+esc(p.lg_user_id):''}</option>`).join('')}</optgroup>`).join('')}</select></label>`;
    }).join('');
    box.querySelectorAll('select').forEach(el=>el.addEventListener('change',()=>{
      // Empty is retained explicitly: it clears a prior manual match on publish.
      playerMatching.matches[el.dataset.vodPlayerName]=el.value;
      $("vodPlayerMatchStatus").textContent="Unsaved matches. Save to update the existing reports.";
    }));
  }
  async function loadPlayerMatches(){
    const r=currentReview();if(!r)return;
    $("loadVodPlayerMatches").disabled=true;$("vodPlayerMatchStatus").textContent="Loading game participants…";
    try{
      const {data,error}=await db().rpc('vod_player_match_context',{target_review:r.id});if(error)throw error;
      if(currentReview()?.id!==r.id)return;
      playerMatching={reviewId:r.id,candidates:data.candidates||[],suggestions:data.suggestions||[],matches:data.matches||{}};
      renderPlayerMatches();
      const count=playerMatching.candidates.filter(p=>p.played).length;
      $("vodPlayerMatchStatus").textContent=count?`${count} players confirmed by this game’s box score. Other roster players are listed separately.`:'No official box-score participants are linked yet. Verify participation before choosing a roster player.';
    }catch(e){if(currentReview()?.id===r.id)$("vodPlayerMatchStatus").textContent=e.message||'Could not load players.';}
    finally{$("loadVodPlayerMatches").disabled=false;}
  }
  async function lookupChelNames(){
    const context=playerMatching;if(!context||context.reviewId!==state.selectedReviewId)return;
    const played=context.candidates.filter(p=>p.played||p.lineup);
    const candidates=played.length?played:context.candidates;
    $("lookupVodChelNames").disabled=true;$("vodPlayerMatchStatus").textContent="Checking ChelStats player names…";
    let found=0,failed=0;
    // Bounded concurrency avoids sending a whole roster at once.
    const queue=[...candidates];
    await Promise.all([0,1,2].map(async()=>{while(queue.length){
      const p=queue.shift();
      try{const response=await fetch('/api/chelstats-player?username='+encodeURIComponent(p.gamertag),{signal:AbortSignal.timeout(20000)});
        if(!response.ok)throw new Error('Lookup unavailable');const data=await response.json();
        if(data.profile?.chelName){p.chelName=data.profile.chelName;found++;}
      }catch{failed++;}
    }}));
    if(playerMatching!==context||state.selectedReviewId!==context.reviewId)return;
    renderPlayerMatches();$("vodPlayerMatchStatus").textContent=`${found} CHEL names found${failed?` · ${failed} lookups unavailable`:''}. Current profile names are suggestions; confirm against this game’s footage.`;
  }

  async function publishReport(){
    const r=currentReview();if(!r||publishing)return;
    const problems=model.periodErrors(r,reviewSegments(),{approved:true});if(problems.length)return setStatus(problems.join(" "),"error");
    publishing=true;
    $("publishVodReport").disabled=true;
    $("saveVodPlayerMatches").disabled=true;
    try{
      const {data,error}=await db().rpc("publish_vod_review",{target_review:r.id,expected_updated_at:r.updated_at,report:editedDocument()});
      if(error)throw error;
      await loadData();if(currentReview()?.id!==r.id)return;$("vodPlayerMatchStatus").textContent="Saved. Confirmed names update the existing player reports.";$("publishVodStatus").textContent=`Published approved report · ${data?.player_reports||0} player reports updated.${data?.unmatched_players?.length?' Unmatched player names need correction: '+data.unmatched_players.join(', '):''}`;
    }catch(error){$("publishVodStatus").textContent=error.message||"Publishing failed. Drafts remain private.";}
    finally{publishing=false;$("publishVodReport").disabled=model.periodErrors(currentReview(),reviewSegments(),{approved:true}).length>0;renderPlayerMatches();}
  }

  function renderReviewCompletion(){
    const check=$("reviewDoneCheck"),button=$("fileCompletedVod"),status=$("reviewDoneStatus"),r=currentReview();
    if(!check||!button||!status)return;
    if(!r){check.checked=false;check.disabled=true;button.disabled=true;status.textContent="";return;}
    const approved=model.periodErrors(r,reviewSegments(),{approved:true}).length===0;
    const published=Boolean(currentPublication());
    const ready=approved&&published;
    check.disabled=!ready;
    if(!ready)check.checked=false;
    button.disabled=!ready||!check.checked;
    status.textContent=!approved
      ?"Approve every required period before filing this review."
      :!published
        ?"Publish the scouting report first. Filing is unlocked after a successful publication."
        :"Published and protected. Check the box when management is finished with this review; filing removes it from the active library without deleting the evidence.";
  }

  async function fileCompletedReview(){
    const r=currentReview();if(!r)return;
    const problems=model.periodErrors(r,reviewSegments(),{approved:true});
    if(problems.length)return setStatus(problems.join(" "),"error");
    if(!currentPublication())return setStatus("Publish the approved scouting report before filing this review.","error");
    if(!$("reviewDoneCheck")?.checked)return setStatus("Check the management approval box before filing the review.","error");
    const button=$("fileCompletedVod");if(button)button.disabled=true;
    const {error}=await db().from("vod_review_sessions").update({status:"archived",updated_at:new Date().toISOString()}).eq("id",r.id).eq("team_id",state.teamId);
    if(error){renderReviewCompletion();return setStatus(error.message||"Could not file the completed review.","error");}
    state.selectedReviewId="";state.selectedSegmentId="";
    const url=new URL(location.href);url.searchParams.delete("review");history.replaceState(null,"",url);
    await loadData();
    setStatus("Review filed as complete. It has been removed from the active VOD library; approved evidence and published scouting reports are retained.","success");
  }

  function bind(){
    $("vodTeam")?.addEventListener("change",e=>{state.teamId=e.target.value;state.selectedReviewId="";state.selectedSegmentId="";loadData();});
    $("refreshVod")?.addEventListener("click",loadData); $("createVod")?.addEventListener("click",createReview); $("batchCreateVod")?.addEventListener("click",createBatchReviews); $("buildSegments")?.addEventListener("click",buildSegments);
    for(const id of ["period1Start","period2Start","period3Start","periodVodEnd","periodOtStarts","periodSkips"])$(id)?.addEventListener("input",()=>{periodFieldsDirty=true;}); $("addCustomSegment")?.addEventListener("click",addCustomSegment);
    $("editSegment")?.addEventListener("click",()=>{editingPeriod=!editingPeriod;if(!editingPeriod)renderSegmentEditor();else renderPeriodContent(currentSegment());});
    $("approveSegment")?.addEventListener("click",()=>saveSegment("complete"));
    $("rejectSegment")?.addEventListener("click",()=>saveSegment("rejected"));
    $("publishVodReport")?.addEventListener("click",publishReport);
    $("loadVodPlayerMatches")?.addEventListener("click",loadPlayerMatches);
    $("lookupVodChelNames")?.addEventListener("click",lookupChelNames);
    $("saveVodPlayerMatches")?.addEventListener("click",publishReport);
    $("reviewDoneCheck")?.addEventListener("change",renderReviewCompletion);
    $("fileCompletedVod")?.addEventListener("click",fileCompletedReview);
    $("saveSegment")?.addEventListener("click",saveSegment); $("addMarker")?.addEventListener("click",addMarker); $("openSegment")?.addEventListener("click",()=>currentSegment()&&openSegmentById(currentSegment().id)); $("copySegmentPacket")?.addEventListener("click",copySegmentPacket);
    $("buildRollup")?.addEventListener("click",buildRollup); $("saveRollup")?.addEventListener("click",saveRollup); $("archiveVod")?.addEventListener("click",archiveReview); $("deleteVod")?.addEventListener("click",deleteReview);
  }
  async function bootstrap(){
    if(!hasAccess()||!db())return; populateTeams(); if(!state.initialized){bind();state.initialized=true;} await loadData();
  }
  window.addEventListener("vvhl-auth-change",()=>setTimeout(bootstrap,0));
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>setTimeout(bootstrap,150));else setTimeout(bootstrap,150);
})();
