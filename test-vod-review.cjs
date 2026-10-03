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
