const {test,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const handler=require('./api/chelscout-deepthink.js');
const original=global.fetch;
const oldKey=process.env.OPENROUTER_API_KEY;
afterEach(()=>{global.fetch=original;if(oldKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=oldKey;});
function response(){return {code:0,body:null,setHeader(){},status(n){this.code=n;return this;},json(x){this.body=x;return this;}};}
function mock({member=true,citation='[E1]',providerFail=false}={}){
 const calls=[];global.fetch=async(url,opts={})=>{
  calls.push({url,opts});let body=[];
  if(url.includes('/auth/v1/user'))body={id:'manager'};
  else if(url.includes('team_memberships'))body=member?[{role:'gm'}]:[];
  else if(url.includes('scouting_players?'))body=[{id:'p1',gamertag:'Setty',primary_position:'LW'}];
  else if(url.includes('/chat/completions')){
   body=providerFail?{error:{message:'Provider temporarily unavailable'}}:{model:'test-model',choices:[{message:{content:'Projected support role '+citation,reasoning:'PRIVATE'}}],usage:{}};
   return {ok:!providerFail,status:providerFail?503:200,text:async()=>JSON.stringify(body),json:async()=>body};
  }
  return {ok:true,status:200,text:async()=>JSON.stringify(body),json:async()=>body};
 };return calls;
}
const req=body=>({method:'POST',headers:{authorization:'Bearer test'},body:{question:'Evaluate Setty',playerNames:['Setty'],...body}});
test('anonymous calls are rejected before any database or paid model request',async()=>{
 const calls=mock(),r=response();await handler({method:'POST',headers:{},body:{}},r);assert.equal(r.code,401);assert.equal(calls.length,0);
});
test('non-management cannot call paid models',async()=>{
 const calls=mock({member:false}),r=response();await handler(req(),r);assert.equal(r.code,403);assert.equal(calls.length,3);assert.ok(!calls.some(c=>c.url.includes('/chat/completions')));
});
test('oversized requests fail before any network access',async()=>{
 const calls=mock(),r=response();await handler(req({playerNames:Array(25).fill('Setty')}),r);assert.equal(r.code,400);assert.equal(calls.length,0);
});
test('missing current provider returns explicit configuration error',async()=>{
 delete process.env.OPENROUTER_API_KEY;mock();const r=response();await handler(req(),r);assert.equal(r.code,503);assert.match(r.body.error,/OPENROUTER_API_KEY/);
});
test('deep analysis cites retrieved identities without returning private reasoning',async()=>{
 process.env.OPENROUTER_API_KEY='test';const calls=mock(),r=response();await handler(req({mode:'deep'}),r);
 assert.equal(r.code,200);assert.ok(r.body.sources.some(s=>s.meta.evidenceClass==='player_identity'&&s.data.id==='p1'));assert.doesNotMatch(JSON.stringify(r.body),/PRIVATE/);
 const call=calls.find(c=>c.url.includes('/chat/completions'));const body=JSON.parse(call.opts.body);assert.equal(body.reasoning.effort,'high');
 const packet=JSON.parse(body.messages.find(m=>m.role==='user').content);assert.equal(packet.evidencePacket.coverage.selectedPlayers[0],'Setty');assert.equal(r.body.advisory,true);
});
test('provider failures return an error without saving an analysis run',async()=>{
 process.env.OPENROUTER_API_KEY='test';const calls=mock({providerFail:true}),r=response();await handler(req(),r);
 assert.equal(r.code,502);assert.ok(!calls.some(c=>c.url.includes('hitmen_ai_analysis_runs')));
});
test('fabricated record references cannot pass validation',async()=>{
 process.env.OPENROUTER_API_KEY='test';mock({citation:'[E999]'});const r=response();await handler(req(),r);assert.equal(r.code,502);assert.match(r.body.error,/unavailable evidence/);
});
test('unknown names are surfaced instead of substituted',async()=>{
 mock();const p=await handler._test.contextFor('Bearer test',['Nobody'],'Evaluate Nobody','','player');assert.deepEqual(p.coverage.unmatchedNames,['Nobody']);assert.deepEqual(p.coverage.selectedPlayers,[]);
});
