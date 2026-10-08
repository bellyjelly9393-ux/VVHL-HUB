(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.WildmanVODReview=api;
})(typeof window==='object'?window:globalThis,()=>{
  'use strict';
  const systems=['offensive_structure','defensive_structure','forecheck','breakout','neutral_zone','entries','exits','puck_support','rush_offense','cycle_offense','slot_creation','shot_selection','defensive_zone_coverage','slot_protection','rush_defense','transition_after_turnovers','special_teams','repeatable_strengths','repeatable_problems','opponent_adjustments','next_game_adjustments'];
  const text=v=>typeof v==='string'?v:'';
  const array=v=>Array.isArray(v)?v:[];
  const activeSegments=segments=>array(segments).filter(s=>!s.archived_at);
  const hasAnalysis=s=>Boolean(text(s?.analysis_summary).trim());
  const protectedEvidence=s=>Boolean(s?.analyzed_by||s?.status==='complete');
  function reconcile(review={},segments=[],publication=null,job=null){
    const active=activeSegments(segments),periods=active.filter(s=>['period','overtime'].includes(s.segment_type));
    const bounds=periodErrors(review,periods),validPeriods=periods.filter(s=>s.end_seconds!=null&&Number(s.end_seconds)>Number(s.start_seconds)&&Number(s.start_seconds)>=Number(review.source_start_seconds||0)&&(review.source_end_seconds==null||Number(s.end_seconds)<=Number(review.source_end_seconds)));
    const periodEvidence=s=>hasAnalysis(s)||array(review.worker_result?.period_reports).some(p=>p.label===s.label&&text(p.report?.summary).trim());
    const evidence=validPeriods.filter(periodEvidence);
    const analysisComplete=!bounds.length&&periods.length>0&&periods.every(periodEvidence);
    const approved=analysisComplete&&periods.every(s=>s.status==='complete'&&hasAnalysis(s));
    const rawStatus=job?.status||review.worker_status||'';
    const rawFailure=['failed','expired'].includes(rawStatus);
    const writeup=Boolean(text(review.review_document?.summary||review.full_game_summary).trim());
    const published=Boolean(publication?.active&&approved&&text(publication.report?.summary).trim());
    const refreshing=published&&['retrieving','queued','processing','awaiting_ai'].includes(rawStatus);
    return {periods,usableEvidence:evidence.length>0,analysisComplete,approved,writeup,published,refreshing,
      recovered:rawFailure&&evidence.length>0,rawFailure,rawStatus,
      stages:[
        {name:'Game Review',label:'1 · Source',done:Boolean(review.id)},
        {name:'Periods',label:'2 · Split',done:!bounds.length},
        {name:rawFailure&&evidence.length?'Evidence Available':'Recording',label:'3 · Retrieve',done:evidence.length>0||['processing','awaiting_ai','needs_periods','ready_for_review'].includes(rawStatus),recovered:rawFailure&&evidence.length>0},
        {name:analysisComplete?'AI Analysis Complete':'AI Review',label:'4 · Analyze',done:analysisComplete,blocked:!analysisComplete&&rawStatus==='awaiting_ai'},
        {name:approved?'Human Approved':'Human Review',label:'5 · Verify',done:approved},
        {name:published?'Published':writeup?'Write-Up Saved':'Write-Up',label:'6 · Publish',done:published}
      ],
      next:refreshing?'Fresh VOD analysis is running. The current published report stays live until the new reviewed evidence is ready.':published?'Published scouting reports are current. Re-publish only after reviewed evidence changes.':approved?'All required periods are approved. Publish / Refresh Scouting Reports when ready.':analysisComplete?'Saved analysis is complete. Review and approve the remaining periods.':evidence.length?'Saved period evidence is preserved. Finish the remaining periods before publishing.':rawFailure?'Analysis stopped before it finished (the cause is not always the recording: AI credits, an AI limit or a download). Saved parts are kept. Use Continue / Retry once the cause is fixed.':'Analyze the game to detect periods and prepare scouting evidence.'};
  }
  function periodErrors(review,segments,{approved=false}={}){
    const errors=[],periods=activeSegments(segments).filter(s=>['period','overtime'].includes(s.segment_type)).sort((a,b)=>a.start_seconds-b.start_seconds);
    const start=Number(review.source_start_seconds||0),end=review.source_end_seconds==null?start+Number(review.duration_seconds):Number(review.source_end_seconds);
    if(!Number.isFinite(end)||end<=start)errors.push('Set a valid game window in Advanced Tools.');
    for(const n of [1,2,3])if(!periods.some(s=>s.segment_type==='period'&&s.segment_index===n))errors.push(`Period ${n} has not been detected or confirmed.`);
    periods.forEach((s,i)=>{
      if(s.end_seconds==null||!Number.isFinite(Number(s.start_seconds))||!Number.isFinite(Number(s.end_seconds))||s.end_seconds<=s.start_seconds||s.start_seconds<start||s.end_seconds>end)errors.push(`${s.label} falls outside the game window or has invalid times.`);
      if(i&&s.start_seconds<periods[i-1].end_seconds)errors.push(`${s.label} overlaps another period.`);
      if(approved&&(s.status!=='complete'||!text(s.analysis_summary).trim()))errors.push(`${s.label} still needs management approval and a summary.`);
    });
    return errors;
  }
  function rating(value){
    if(!value||typeof value.score!=='number'||!Number.isFinite(value.score)||value.score<0||value.score>100)return null;
    return {score:Math.round(value.score),reason:text(value.reason)};
  }
  function documentFor(review){
    const result=review.worker_result||{},rollup=result.game_rollup||{},offset=Number(review.source_start_seconds)||0;
    const timestamps=v=>[...new Set(array(v).filter(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0).map(n=>n+offset))];
    const players=array(rollup.player_reports).length?rollup.player_reports:array(result.chunks).flatMap(c=>array(c.review?.player_evaluations));
    const merged=new Map();
    for(const p of players){
      const name=text(p.player).trim();if(!name)continue;
      const key=name.toLowerCase(),row=merged.get(key)||{player:name,position:text(p.position),strengths:'',concerns:'',habits:'',coach_note:'',evidence_timestamps:[],rating:null};
      for(const k of ['strengths','concerns','habits','coach_note'])if(text(p[k])&&!row[k].includes(p[k]))row[k]=[row[k],p[k]].filter(Boolean).join('\n');
      row.evidence_timestamps=[...new Set([...row.evidence_timestamps,...timestamps(p.evidence_timestamps)])];
      // Only the game synthesis can assign a game rating; never average chunk scores.
      if(array(rollup.player_reports).length)row.rating=rating(p.rating);
      merged.set(key,row);
    }
    return {
      version:1,summary:text(review.full_game_summary||rollup.summary),
      team_systems:Object.fromEntries(systems.map(k=>[k,text(rollup.team_systems?.[k])])),
      tactical_report:text(review.tactical_report||rollup.tactical_report),
      result:text(rollup.result),process:text(rollup.process),game_rating:rating(rollup.game_rating),
      units:array(rollup.unit_reports).map(u=>({label:text(u.label),type:u.type==='defense_pair'?'defense_pair':'line',players:array(u.players).filter(p=>typeof p==='string'),summary:text(u.summary),strengths:text(u.strengths),concerns:text(u.concerns),adjustments:text(u.adjustments),rating:rating(u.rating),evidence_timestamps:timestamps(u.evidence_timestamps)})),
      players:[...merged.values()],player_report:text(review.player_report||rollup.player_report)
    };
  }
  // Approved period notes are reviewed evidence. When the worker's game rollup is
  // missing (failed/cleared job), build the structured report layers from them.
  const directSystems={offensive_structure:'offense_notes',defensive_structure:'defense_notes',forecheck:'forecheck_notes',breakout:'breakout_notes',transition_after_turnovers:'transition_notes',special_teams:'special_teams_notes'};
  const systemPatterns={
    breakout:/\bbreak ?outs?\b|first pass|retriev(al|als|e|es|ed|ing)\b|\bd[- ]to[- ]d\b/i,
    neutral_zone:/neutral[- ]zone|\bregroup|\bNZ\b/i,
    entries:/\bentr(y|ies)\b|carr(y|ied|ies) (the puck )?in|dump[- ]?in|zone entry/i,
    exits:/\bexit(s|ed|ing)?\b|clear(ed|ing|s)? the zone|\bchip(ped|s)? out/i,
    puck_support:/\bsupport(s|ed|ing)?\b|passing option|outlet/i,
    rush_offense:/\b(odd[- ]man|rush(es|ing)?|counter[- ]?attack|breakaway|2[- ]on[- ]1|3[- ]on[- ]2)\b/i,
    cycle_offense:/\bcycl(e|es|ed|ing)\b|low[- ]to[- ]high|below the (goal line|circles)|\bwall play|o[- ]?zone possession|offensive[- ]zone (possession|time|pressure)/i,
    slot_creation:/\b(slot|net[- ]front|inside|middle|backdoor|cross[- ]crease|high[- ]danger)\b/i,
    shot_selection:/\bshot(s)?\b|\bshoot(s|ing)?\b|\bscor(e|ed|es|ing)\b|\bgoal\b/i,
    defensive_zone_coverage:/d[- ]?zone|defensive[- ]zone|\bcoverage\b|\bbox\b|collaps(e|es|ed|ing)/i,
    slot_protection:/(protect|cover|defend|deny|denied|clog|clear)\w*[^.]{0,40}\b(slot|middle|net[- ]front|crease|inside)\b|\b(slot|crease|net[- ]front)\b[^.]{0,40}(protect|coverage|covered|defend)/i,
    rush_defense:/\b(gap|backcheck(ing)?|back[- ]?pressure|retreat(s|ed|ing)?|odd[- ]man|tracking back)\b/i,
    repeatable_strengths:/\b(consistent(ly)?|effective(ly)?|disciplined|strength|well[- ]executed|reliabl[ey]|repeated(ly)? (won|created|generated)|success(ful(ly)?)?)\b/i,
    repeatable_problems:/\b(struggl\w*|too (passive|slow|often|many)|turnover(s)?|giveaway(s)?|breakdown(s)?|lapse(s)?|issue|problem|concern|failed to|unable to|mistake(s)?)\b/i,
    opponent_adjustments:/\b(opponent|adjust(ed|s|ment|ments)?|counter(ed|s)?|exploit(ed|s|ing)?|respond(ed|s)?)\b/i,
    next_game_adjustments:/\b(should|need(s)? to|must|emphasi[sz]e|focus on|look for|improve|next game|going forward|recommend(ed)?)\b/i
  };
  const sentences=v=>text(v).split(/\n+/).filter(line=>!/^\s*needs review:/i.test(line)).join(' ').split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/).map(s=>s.trim()).filter(s=>s.length>25);
  function parsePlayerNote(note){
    const raw=typeof note==='string'?note:text(note?.note);
    const m=raw.match(/^(.+?)(?:\s+\(([^)]+)\))?\s+—\s+([\s\S]*)$/);if(!m)return null;
    const name=m[1].trim(),body=m[3];if(!name||name.length>60)return null;
    const out={player:name,position:text(m[2]).trim(),strengths:'',concerns:'',habits:'',coach_note:'',evidence_timestamps:[]};
    if(!/Strengths:/.test(body)){out.habits=body.trim();return out;}
    const field=label=>{const f=body.match(new RegExp(label+':\\s*([\\s\\S]*?)(?=\\s*\\|\\s*(?:Strengths|Concerns|Habits|Coach|Confidence):|$)'));const v=f?f[1].trim():'';return v==='—'?'':v;};
    out.strengths=field('Strengths');out.concerns=field('Concerns');out.habits=field('Habits');out.coach_note=field('Coach').replace(/\s*\|?\s*Confidence:[\s\S]*$/,'').trim();
    const ev=body.match(/\[evidence:\s*([^\]]+)\]/);
    if(ev)out.evidence_timestamps=ev[1].split(',').map(x=>parseInt(x,10)).filter(n=>Number.isFinite(n)&&n>=0);
    return out;
  }
  function documentFromPeriods(review={},segments=[]){
    const periods=activeSegments(segments).filter(s=>['period','overtime'].includes(s.segment_type)&&s.status==='complete'&&hasAnalysis(s)).sort((a,b)=>Number(a.start_seconds)-Number(b.start_seconds));
    const byPeriod=values=>values.filter(([,v])=>text(v).trim()).map(([label,v])=>`${label}: ${text(v).trim()}`).join('\n\n');
    const team_systems=Object.fromEntries(systems.map(k=>[k,'']));
    for(const [k,col] of Object.entries(directSystems))team_systems[k]=byPeriod(periods.map(s=>[s.label,s[col]]));
    for(const [k,pattern] of Object.entries(systemPatterns)){
      if(team_systems[k])continue;
      const seen=new Set();
      team_systems[k]=byPeriod(periods.map(s=>{
        const picked=[];
        for(const line of sentences([s.analysis_summary,s.offense_notes,s.defense_notes,s.transition_notes,s.forecheck_notes,s.breakout_notes,s.special_teams_notes].filter(Boolean).join('\n'))){
          if(picked.length>=4)break;
          const key=line.toLowerCase();if(seen.has(key)||!pattern.test(line))continue;
          seen.add(key);picked.push(line);
        }
        return [s.label,picked.join(' ')];
      }));
    }
    if(text(review.strengths).trim())team_systems.repeatable_strengths=text(review.strengths);
    if(text(review.corrections).trim())team_systems.repeatable_problems=text(review.corrections);
    const players=new Map();
    for(const s of periods)for(const note of array(s.player_notes)){
      const p=parsePlayerNote(note);if(!p)continue;
      const key=p.player.toLowerCase();
      const row=players.get(key)||{player:p.player,position:p.position,strengths:'',concerns:'',habits:'',coach_note:'',evidence_timestamps:[],rating:null};
      if(!row.position)row.position=p.position;
      for(const k of ['strengths','concerns','habits','coach_note'])if(p[k]&&!row[k].includes(p[k]))row[k]=[row[k],`${s.label}: ${p[k]}`].filter(Boolean).join('\n');
      row.evidence_timestamps=[...new Set([...row.evidence_timestamps,...p.evidence_timestamps])].sort((a,b)=>a-b);
      players.set(key,row);
    }
    const summary=text(review.full_game_summary).trim()||byPeriod(periods.map(s=>[s.label,s.analysis_summary]));
    return {version:1,summary,team_systems,tactical_report:text(review.tactical_report),result:'',process:'',game_rating:null,units:[],players:[...players.values()],player_report:text(review.player_report)};
  }
  function mergeDocuments(primary={},supplemental={}){
    const p=primary&&typeof primary==='object'?primary:{},s=supplemental&&typeof supplemental==='object'?supplemental:{};
    const pick=(a,b)=>text(a).trim()?text(a):text(b);
    const stamps=(...values)=>[...new Set(values.flatMap(v=>array(v)).filter(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0))].sort((a,b)=>a-b);
    const out={...p,version:1};
    out.summary=pick(p.summary,s.summary);
    out.result=pick(p.result,s.result);
    out.process=pick(p.process,s.process);
    out.tactical_report=pick(p.tactical_report,s.tactical_report);
    out.player_report=pick(p.player_report,s.player_report);
    out.game_rating=rating(p.game_rating)||rating(s.game_rating);
    out.team_systems=Object.fromEntries(systems.map(k=>[k,pick(p.team_systems?.[k],s.team_systems?.[k])]));

    const unitKey=u=>[text(u?.type),text(u?.label).toLowerCase(),array(u?.players).map(x=>text(x).toLowerCase()).sort().join('|')].join('::');
    const units=new Map();
    for(const source of [array(p.units),array(s.units)]){
      for(const u of source){
        const key=unitKey(u);if(!key.replaceAll(':',''))continue;
        const row=units.get(key)||{label:text(u.label),type:u.type==='defense_pair'?'defense_pair':'line',players:array(u.players).filter(x=>typeof x==='string'),summary:'',strengths:'',concerns:'',adjustments:'',rating:null,evidence_timestamps:[]};
        for(const k of ['label','summary','strengths','concerns','adjustments'])row[k]=pick(row[k],u[k]);
        if(!row.players.length)row.players=array(u.players).filter(x=>typeof x==='string');
        row.rating=rating(row.rating)||rating(u.rating);
        row.evidence_timestamps=stamps(row.evidence_timestamps,u.evidence_timestamps);
        units.set(key,row);
      }
    }
    out.units=[...units.values()];

    const players=new Map();
    for(const source of [array(p.players),array(s.players)]){
      for(const item of source){
        const name=text(item?.player).trim();if(!name)continue;
        const key=name.toLowerCase();
        const row=players.get(key)||{player:name,position:'',strengths:'',concerns:'',habits:'',coach_note:'',evidence_timestamps:[],rating:null};
        row.player=pick(row.player,item.player);
        row.position=pick(row.position,item.position);
        for(const k of ['strengths','concerns','habits','coach_note'])row[k]=pick(row[k],item[k]);
        row.rating=rating(row.rating)||rating(item.rating);
        row.evidence_timestamps=stamps(row.evidence_timestamps,item.evidence_timestamps);
        players.set(key,row);
      }
    }
    out.players=[...players.values()];
    return out;
  }

  function baseline(reports){
    const unique=new Map();
    for(const r of reports){
      if(r.evidence?.verification!=='approved'||!r.ai_review_id)continue;
      const score=rating(r.evidence?.rating);if(score)unique.set(r.ai_review_id,score.score);
    }
    const scores=[...unique.values()];
    return {games:scores.length,score:scores.length?Math.round(scores.reduce((a,b)=>a+b,0)/scores.length):null};
  }
  return {systems,periodErrors,documentFor,documentFromPeriods,parsePlayerNote,mergeDocuments,rating,baseline,activeSegments,hasAnalysis,protectedEvidence,reconcile};
});
