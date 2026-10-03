const {test,afterEach}=require('node:test');const assert=require('node:assert/strict');
const handler=require('./api/chelscout-deepthink.js');
const original=global.fetch,oldKey=process.env.OPENROUTER_API_KEY;
afterEach(()=>{global.fetch=original;if(oldKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=oldKey;});
function response(){return {code:0,body:null,setHeader(){},status(n){this.code=n;return this;},json(x){this.body=x;return this;}};}
function mock({member=true,citation='[E1]',providerFail=false}={}){const calls=[];global.fetch=async(url,opts)=>{calls.push({url,opts});let body=[],status=200;
if(url.includes('/auth/v1/user'))body={id:'manager'};
else if(url.includes('team_memberships'))body=member?[{role:'gm'}]:[];
else if(url.includes('scouting_players?'))body=[{id:'p1',gamertag:'Setty',primary_position:'LW'}];
else if(url.includes('vod_review_sessions?'))body=[{id:'approved',title:'Approved game'},{id:'draft',title:'Unapproved draft'}];
else if(url.includes('vod_game_publications?'))body=[{review_id:'approved',report:{summary:'Approved systems'},published_at:'2026-10-02'}];
else if(url.includes('vod_review_segments?'))body=[{id:'active',status:'complete'},{id:'archived',status:'complete',archived_at:'2026-10-03'},{id:'draft',status:'needs_review'}];
else if(url.includes('vod_review_markers?'))body=[{id:'usable',segment_id:'active'},{id:'historical',segment_id:'archived'},{id:'unapproved',segment_id:'draft'}];
else if(url.includes('openrouter.ai')){if(providerFail){status=503;body={error:{message:'Provider unavailable'}};}else body={choices:[{message:{content:'Projected support role '+citation,reasoning:'PRIVATE'}}]};}
return {ok:status===200,status,text:async()=>JSON.stringify(body)};};return calls;}
const req=body=>({method:'POST',headers:{authorization:'Bearer test'},body:{question:'Compare our lineups',playerNames:['Setty'],...body}});
test('anonymous calls are rejected before any database or paid model request',async()=>{const calls=mock(),r=response();await handler({method:'POST',headers:{},body:{}},r);assert.equal(r.code,401);assert.equal(calls.length,0);});
test('non-management cannot call paid models',async()=>{const calls=mock({member:false}),r=response();await handler(req(),r);assert.equal(r.code,403);assert.equal(calls.length,3);});
test('oversized requests fail before network access',async()=>{const calls=mock(),r=response();await handler(req({playerNames:Array(25).fill('Setty')}),r);assert.equal(r.code,400);assert.equal(calls.length,0);});
test('missing provider configuration is explicit',async()=>{delete process.env.OPENROUTER_API_KEY;mock();const r=response();await handler(req(),r);assert.equal(r.code,503);assert.match(r.body.error,/OPENROUTER_API_KEY/);});
test('current provider returns cited evidence without private reasoning',async()=>{process.env.OPENROUTER_API_KEY='test';const calls=mock(),r=response();await handler(req({mode:'deep'}),r);assert.equal(r.code,200);assert.doesNotMatch(JSON.stringify(r.body),/PRIVATE/);const body=JSON.parse(calls.find(c=>c.url.includes('openrouter.ai')).opts.body);assert.equal(body.reasoning.effort,'high');});
test('provider failure cannot create a fabricated report',async()=>{process.env.OPENROUTER_API_KEY='test';mock({providerFail:true});const r=response();await handler(req(),r);assert.equal(r.code,502);assert.match(r.body.error,/Provider unavailable/);});
test('fabricated record references cannot pass validation',async()=>{process.env.OPENROUTER_API_KEY='test';mock({citation:'[E999]'});const r=response();await handler(req(),r);assert.equal(r.code,502);assert.match(r.body.error,/unavailable evidence/);});
test('unknown names are surfaced instead of substituted',async()=>{mock();const p=await handler._test.contextFor('Bearer test',['Nobody'],'Compare players','','player');assert.deepEqual(p.coverage.unmatchedNames,['Nobody']);});
test('GM receives only active publications and approved periods',async()=>{const calls=mock();const packet=await handler._test.contextFor('Bearer test',[],'Review team systems','','general');const vods=packet.sources.filter(s=>s.source==='Opponent VOD review sessions');assert.deepEqual(vods.map(s=>s.data.id),['approved']);assert.equal(vods[0].data.approved_report.summary,'Approved systems');assert.ok(calls.some(c=>c.url.includes('vod_game_publications?')&&c.url.includes('active=eq.true')));assert.ok(calls.some(c=>c.url.includes('vod_review_segments?')&&c.url.includes('status=eq.complete')));});
test('GM excludes archived and unapproved period evidence and their markers',async()=>{
 const calls=mock();const packet=await handler._test.contextFor('Bearer test',[],'Review team systems','','general');
 assert.deepEqual(packet.sources.filter(s=>s.source==='Timestamped VOD segment analysis').map(s=>s.data.id),['active']);
 assert.deepEqual(packet.sources.filter(s=>s.source==='Timestamped VOD markers').map(s=>s.data.id),['usable']);
 assert.ok(calls.some(c=>c.url.includes('vod_review_segments?')&&c.url.includes('archived_at=is.null')));
});
