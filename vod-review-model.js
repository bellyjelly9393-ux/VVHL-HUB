(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.WildmanVODReview=api;
})(typeof window==='object'?window:globalThis,()=>{
  'use strict';
  const systems=['offensive_structure','defensive_structure','forecheck','breakout','neutral_zone','entries','exits','puck_support','rush_offense','cycle_offense','slot_creation','shot_selection','defensive_zone_coverage','slot_protection','rush_defense','transition_after_turnovers','special_teams','repeatable_strengths','repeatable_problems','opponent_adjustments','next_game_adjustments'];
  const text=v=>typeof v==='string'?v:'';
  const array=v=>Array.isArray(v)?v:[];
  function periodErrors(review,segments,{approved=false}={}){
    const errors=[],periods=segments.filter(s=>['period','overtime'].includes(s.segment_type)).sort((a,b)=>a.start_seconds-b.start_seconds);
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
  function baseline(reports){
    const unique=new Map();
    for(const r of reports){
      if(r.evidence?.verification!=='approved'||!r.ai_review_id)continue;
      const score=rating(r.evidence?.rating);if(score)unique.set(r.ai_review_id,score.score);
    }
    const scores=[...unique.values()];
    return {games:scores.length,score:scores.length?Math.round(scores.reduce((a,b)=>a+b,0)/scores.length):null};
  }
  return {systems,periodErrors,documentFor,rating,baseline};
});
