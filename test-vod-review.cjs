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
