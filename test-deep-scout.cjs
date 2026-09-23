const {test,afterEach}=require('node:test');const assert=require('node:assert/strict');
const handler=require('./api/chelscout-deepthink.js');
const original=global.fetch;const oldG=process.env.GEMINI_API_KEY,oldA=process.env.ANTHROPIC_API_KEY;
afterEach(()=>{global.fetch=original;for(const [k,v] of [['GEMINI_API_KEY',oldG],['ANTHROPIC_API_KEY',oldA]])if(v===undefined)delete process.env[k];else process.env[k]=v;});
function response(){return {code:0,body:null,setHeader(){},status(n){this.code=n;return this;},json(x){this.body=x;return this;}};}
function mock({member=true,citation='[E1]',geminiFail=false}={}){const calls=[];global.fetch=async(url,opts)=>{calls.push({url,opts});let body=[];
if(url.includes('/auth/v1/user'))body={id:'manager'};
else if(url.includes('team_memberships'))body=member?[{role:'gm'}]:[];
else if(url.includes('team_scouting_pool'))body=[{scouting_player_id:'p1',status:'priority',scouting_players:{id:'p1',gamertag:'Setty',primary_position:'LW'}}];
else if(url.includes('generativelanguage')){if(geminiFail)return {ok:false,status:503};body={candidates:[{finishReason:'STOP',content:{parts:[{thought:true,text:'PRIVATE'},{text:'Evidence brief [E1]'}]}}]};}
else if(url.includes('anthropic'))body={stop_reason:'end_turn',content:[{type:'thinking',thinking:'PRIVATE'},{type:'text',text:'Projected support role '+citation}]};
return {ok:true,json:async()=>body};};return calls;}
const req=body=>({method:'POST',headers:{authorization:'Bearer test'},body:{question:'Compare our lineups',playerNames:['Setty'],...body}});
test('anonymous calls are rejected before any database or paid model request',async()=>{const calls=mock(),r=response();await handler({method:'POST',headers:{},body:{}},r);assert.equal(r.code,401);assert.equal(calls.length,0);});
test('non-management cannot call paid models',async()=>{const calls=mock({member:false}),r=response();await handler(req(),r);assert.equal(r.code,403);assert.equal(calls.length,3);});
test('oversized requests fail before any network access',async()=>{const calls=mock(),r=response();await handler(req({playerNames:Array(25).fill('Setty')}),r);assert.equal(r.code,400);assert.equal(calls.length,0);});
test('missing deep provider returns explicit configuration error',async()=>{delete process.env.ANTHROPIC_API_KEY;mock();const r=response();await handler(req(),r);assert.equal(r.code,503);assert.match(r.body.error,/ANTHROPIC_API_KEY/);});
test('deep mode uses both passes and returns records without private thinking',async()=>{process.env.GEMINI_API_KEY='test';process.env.ANTHROPIC_API_KEY='test';const calls=mock(),r=response();await handler(req(),r);assert.equal(r.code,200);assert.equal(r.body.sources[0].data.scouting_players.gamertag,'Setty');assert.doesNotMatch(JSON.stringify(r.body),/PRIVATE/);const call=calls.find(c=>c.url.includes('anthropic'));const body=JSON.parse(call.opts.body);assert.equal(body.thinking.budget_tokens,4096);assert.match(body.messages[0].content,/Evidence brief/);assert.doesNotMatch(body.messages[0].content,/PRIVATE/);});
test('failed evidence pass falls back transparently to original evidence',async()=>{process.env.GEMINI_API_KEY='test';process.env.ANTHROPIC_API_KEY='test';mock({geminiFail:true});const r=response();await handler(req(),r);assert.equal(r.code,200);assert.equal(r.body.evidenceModel,null);assert.match(r.body.coverage.warnings.join(' '),/original records/);});
test('fabricated record references cannot pass validation',async()=>{process.env.ANTHROPIC_API_KEY='test';delete process.env.GEMINI_API_KEY;mock({citation:'[E999]'});const r=response();await handler(req(),r);assert.equal(r.code,502);assert.match(r.body.error,/unavailable evidence/);});
test('unknown names are surfaced instead of substituted',async()=>{mock();const p=await handler._test.contextFor('Bearer test',['Nobody']);assert.deepEqual(p.coverage.unmatchedNames,['Nobody']);assert.deepEqual(p.coverage.selectedPlayers,[]);});
