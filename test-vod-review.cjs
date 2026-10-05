const {test}=require('node:test');
const assert=require('node:assert/strict');
const model=require('./vod-review-model.js');
const review={source_start_seconds:1800,source_end_seconds:3260};
const periods=()=>[1800,2200,2600].map((s,i)=>({label:`Period ${i+1}`,segment_type:'period',segment_index:i+1,start_seconds:s,end_seconds:i===2?3260:s+400,status:'complete',analysis_summary:'Reviewed evidence'}));
test('out-of-window legacy P3 cannot be approved or published',()=>{
 const p=periods();p[2].end_seconds=3320;assert.match(model.periodErrors(review,p,{approved:true}).join(' '),/outside/);
});
test('requires three real periods, approval, summary and non-overlap',()=>{
 assert.deepEqual(model.periodErrors(review,periods(),{approved:true}),[]);
 assert.ok(model.periodErrors(review,periods().slice(0,2)).length);
 const p=periods();p[1].status='needs_review';assert.match(model.periodErrors(review,p,{approved:true}).join(' '),/approval/);
 p[1].start_seconds=2190;assert.match(model.periodErrors(review,p).join(' '),/overlaps/);
});
test('OT remains its own period and must be approved',()=>{
 const p=periods();p[2].end_seconds=3100;p.push({segment_type:'overtime',segment_index:1,label:'Overtime 1',start_seconds:3100,end_seconds:3260,status:'needs_review'});
 assert.match(model.periodErrors(review,p,{approved:true}).join(' '),/Overtime 1/);
});
test('player evidence merges by exact normalized identity and uses original VOD offsets',()=>{
 const doc=model.documentFor({...review,worker_result:{chunks:[{review:{player_evaluations:[{player:'Player One',strengths:'Support',evidence_timestamps:[15]}]}},{review:{player_evaluations:[{player:'player one',concerns:'Gap',evidence_timestamps:[30]}]}}]}});
 assert.equal(doc.players.length,1);assert.deepEqual(doc.players[0].evidence_timestamps,[1815,1830]);assert.equal(doc.players[0].rating,null);assert.equal(doc.units.length,0);
});
test('baselines exclude drafts, invalid ratings and repeated publications',()=>{
 const r={ai_review_id:'game1',evidence:{verification:'approved',rating:{score:70}}};
 assert.deepEqual(model.baseline([r,r,{ai_review_id:'game2',evidence:{verification:'needs_review',rating:{score:100}}}]),{games:1,score:70});
 assert.equal(model.rating({score:NaN}),null);assert.equal(model.rating({score:101}),null);
});
test('approved durable evidence recovers retrieval and AI stages without a rerun',()=>{
 const r={...review,id:'game',worker_status:'failed',full_game_summary:'Reviewed report'};
 const state=model.reconcile(r,periods(),{active:true,report:{summary:'Published report'}});
 assert.equal(state.recovered,true);assert.equal(state.stages[2].name,'Evidence Available');
 assert.equal(state.stages[2].done,true);assert.equal(state.stages[3].done,true);
 assert.equal(state.approved,true);assert.equal(state.published,true);
 assert.doesNotMatch(state.next,/retry|failed/i);
});
test('draft writeups and worker ready flags cannot substitute for period evidence or publication',()=>{
 const p=periods();p[1].analysis_summary='';
 const state=model.reconcile({...review,id:'game',worker_status:'ready_for_review',full_game_summary:'Draft'},p);
 assert.equal(state.analysisComplete,false);assert.equal(state.published,false);assert.equal(state.stages[5].done,false);
});
test('archived windows are excluded while active OT and required periods still gate publication',()=>{
 const p=periods();p.push({segment_type:'overtime',segment_index:1,label:'Old OT',start_seconds:0,end_seconds:9000,status:'queued',archived_at:'2026-10-03'});
 assert.deepEqual(model.periodErrors(review,p,{approved:true}),[]);
 assert.equal(model.reconcile({...review,id:'game'},p).approved,true);
 p[0].archived_at='2026-10-03';
 assert.match(model.periodErrors(review,p).join(' '),/Period 1/);
});
test('a reopened human-edited period remains protected from automatic import',()=>{
 assert.equal(model.protectedEvidence({status:'needs_review',analyzed_by:'manager'}),true);
 assert.equal(model.protectedEvidence({status:'complete',analyzed_by:null}),true);
 assert.equal(model.protectedEvidence({status:'needs_review',analyzed_by:null}),false);
});
test('saved structured period reports complete AI analysis without granting human approval',()=>{
 const p=periods().map(s=>({...s,status:'needs_review',analysis_summary:''}));
 const r={...review,id:'game',worker_status:'failed',worker_result:{period_reports:p.map(s=>({label:s.label,report:{summary:'Saved structured evidence'}}))}};
 const state=model.reconcile(r,p);
 assert.equal(state.analysisComplete,true);assert.equal(state.recovered,true);assert.equal(state.approved,false);
 r.worker_result.period_reports.pop();assert.equal(model.reconcile(r,p).analysisComplete,false);
});

test('supplemental analysis fills missing structured detail without overwriting reviewed wording',()=>{
 const reviewed={version:1,summary:'Human reviewed summary',team_systems:{offensive_structure:'Reviewed offense'},units:[],players:[{player:'Player One',strengths:'Reviewed strength',concerns:'',habits:'',coach_note:'',evidence_timestamps:[1815],rating:null}]};
 const fresh={version:1,summary:'Fresh AI summary',team_systems:{offensive_structure:'AI offense',defensive_structure:'Detailed defense'},units:[{label:'Top Pair',type:'defense_pair',players:['LD','RD'],summary:'Pair detail',evidence_timestamps:[1900]}],players:[{player:'player one',strengths:'AI strength',concerns:'Needs cleaner exits',habits:'Activates often',coach_note:'Keep support underneath',evidence_timestamps:[1830],rating:{score:74,reason:'Structured synthesis'}}]};
 const merged=model.mergeDocuments(reviewed,fresh);
 assert.equal(merged.summary,'Human reviewed summary');
 assert.equal(merged.team_systems.offensive_structure,'Reviewed offense');
 assert.equal(merged.team_systems.defensive_structure,'Detailed defense');
 assert.equal(merged.units.length,1);
 assert.equal(merged.players.length,1);
 assert.equal(merged.players[0].strengths,'Reviewed strength');
 assert.equal(merged.players[0].concerns,'Needs cleaner exits');
 assert.deepEqual(merged.players[0].evidence_timestamps,[1815,1830]);
 assert.equal(merged.players[0].rating.score,74);
});
test('approved period notes fill blank report layers when the worker rollup is missing',()=>{
 const p=periods();
 p[0].offense_notes='Calgary kept possession on the walls.';p[0].defense_notes='Low slot held.';
 p[0].analysis_summary='Calgary used the neutral zone regroup to reset possession. Lethbridge protected the slot and kept the box tight.\n\nNeeds review: neutral zone frame unclear and blurry overall.';
 p[1].player_notes=['THE HITMAN HART (LD) — Strengths: Anchors the blue line. | Concerns: — | Habits: Slides D-to-D. | Coach: Activate weak side. | Confidence: high [evidence: 448, 454s]','Other Guy — Won a board battle.'];
 p[2].player_notes=['the hitman hart (LD) — Strengths: Covers the crease. | Concerns: No outlet. | Habits: — | Coach: — | Confidence: moderate [evidence: 844s]'];
 const doc=model.documentFromPeriods({full_game_summary:'Summary'},p);
 assert.equal(doc.team_systems.offensive_structure,'Period 1: Calgary kept possession on the walls.');
 assert.match(doc.team_systems.neutral_zone,/^Period 1: Calgary used the neutral zone regroup/);
 assert.doesNotMatch(doc.team_systems.neutral_zone,/Needs review/);
 assert.match(doc.team_systems.slot_protection,/protected the slot/);
 assert.equal(doc.players.length,2);
 const hart=doc.players.find(x=>x.player==='THE HITMAN HART');
 assert.equal(hart.position,'LD');assert.deepEqual(hart.evidence_timestamps,[448,454,844]);
 assert.equal(hart.strengths,'Period 2: Anchors the blue line.\nPeriod 3: Covers the crease.');
 assert.equal(hart.concerns,'Period 3: No outlet.');assert.equal(hart.coach_note,'Period 2: Activate weak side.');
 const saved={version:1,summary:'Saved',team_systems:Object.fromEntries(model.systems.map(k=>[k,k==='forecheck'?'Manager wording':''])),units:[],players:[]};
 const merged=model.mergeDocuments(saved,doc);
 assert.equal(merged.team_systems.forecheck,'Manager wording');assert.match(merged.team_systems.offensive_structure,/walls/);assert.equal(merged.players.length,2);
 const pending=periods();pending[0].status='needs_review';pending[0].offense_notes='Unapproved';
 assert.equal(model.documentFromPeriods({},pending).team_systems.offensive_structure,'');
});
