const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const writes = [];
const fields = new Map();
const document = {
  readyState: 'loading', addEventListener() {},
  getElementById(id) { if (!fields.has(id)) fields.set(id, {textContent:'',dataset:{}}); return fields.get(id); }
};
const database = {from(table) {
  let operation = 'select', payload;
  const query = {
    select() {return query;}, eq() {return query;}, order() {return query;}, limit() {return query;},
    update(value) {operation='update';payload=value;return query;},
    insert(value) {operation='insert';payload=value;return query;},
    upsert(value) {operation='upsert';payload=value;return query;},
    maybeSingle() {return query;}, single() {return query;},
    then(resolve, reject) {
      if (operation !== 'select') writes.push({table,operation,payload});
      let data;
      if (operation==='select') data=table==='vod_review_sessions'?{team_id:'team'}:[];
      else if(table==='vod_review_segments'&&operation==='insert') data={id:'segment',...payload};
      return Promise.resolve({data,error:null}).then(resolve,reject);
    }
  }; return query;
}};
const sandbox = {document, window:{VVHLBackend:{db:database,state:{user:{id:'user'}}}},
  MutationObserver:class {}, setTimeout(){}, console};
const code = fs.readFileSync('vod-pipeline.js','utf8').replace(/\}\)\(\);\s*$/, 'window.testAPI={ingest,importDetectedPeriods};})();');
vm.runInNewContext(code,sandbox);
(async()=>{
 const api=sandbox.window.testAPI;
 const report=Object.fromEntries(['summary','patterns','strengths','corrections','tactical_report','player_report','professional_writeup'].map(k=>[k,'Synthetic test evidence']));
 const job={result:{duration:120.35,period_detection:'full_game_fallback',game_rollup:report,chunks:[{start:0,end:120.35,label:'Full recording',review:{summary:'Fixture',observations:[{timestamp:10.4,source:'gameplay',note:'Fixture'}, {timestamp:150,source:'gameplay',note:'Out of range'}]}}]}};
 await api.ingest(job,'review');
 assert.equal(writes.find(w=>w.table==='vod_review_segments'&&w.operation==='insert').payload.end_seconds,121);
 const markers=writes.find(w=>w.table==='vod_review_markers').payload;
 assert.equal(markers.length,1);
 assert.equal(markers[0].timestamp_seconds,10);
 const saved=writes.find(w=>w.table==='vod_review_sessions').payload;
 assert.equal(saved.professional_writeup,report.professional_writeup);
 assert.equal(saved.worker_result,job.result);
 writes.length=0;
 await assert.rejects(api.ingest({result:{chunks:job.result.chunks,game_rollup:{summary:'Partial'}}},'review'),/incomplete/);
 assert.equal(writes.length,0);
 await api.importDetectedPeriods('review',{result:{period_detection:'auto',duration:120.35,detected_periods:[{start:0,end:40.1},{start:40.1,end:80.2},{start:80.2,end:120.35}]}});
 for(const seg of writes.find(w=>w.operation==='upsert').payload) {
   assert.ok(Number.isInteger(seg.start_seconds)&&Number.isInteger(seg.end_seconds));
 }
 console.log('PASS: report sections, persisted evidence, fractional timestamps, invalid markers, incomplete report rejection');
})().catch(e=>{console.error(e);process.exitCode=1;});
