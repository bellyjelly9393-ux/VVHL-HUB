import fs from 'node:fs';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('./api/chelstats-player.js',import.meta.url),'utf8');
const {default:handler}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const originalFetch=globalThis.fetch;
try {
 for(const [upstreamName,expected] of [['ExampleGT','Jordan NHL'],['UnrelatedGT',null]]){
  globalThis.fetch=async()=>({ok:true,json:async()=>({Username:upstreamName,skplayername:'Jordan NHL',ShotsLocationOnIce1:1,identity:{displayName:'Jordan NHL'}})});
  let result;
  const res={setHeader(){},status(code){assert.equal(code,200);return this;},json(value){result=value;}};
  await handler({method:'GET',query:{username:'examplegt'}},res);
  assert.equal(result.profile.chelName,expected);
 }
 console.log('PASS: CHEL name belongs to the exact requested gamertag; unrelated profiles rejected');
} finally {globalThis.fetch=originalFetch;}
