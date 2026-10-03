// Uses local fixtures only. No production login, database or paid AI requests.
const {chromium}=require('playwright');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=__dirname;
const fixture=()=>{
  const rows={vod_review_sessions:[{id:'game',team_id:'team',title:'Hitmen vs Test Opponent',opponent_label:'Test Opponent',game_date:'2026-10-01T20:00:00Z',vod_url:'https://www.twitch.tv/videos/123',source_start_seconds:1800,source_end_seconds:3260,duration_seconds:1460,status:'reviewing',worker_status:'ready_for_review',full_game_summary:'Reviewed synthetic game evidence',updated_at:'2026-10-01T21:00:00Z',worker_result:{chunks:[],game_rollup:{}}}],vod_review_segments:[1800,2200,2600].map((start,i)=>({id:'p'+(i+1),review_id:'game',team_id:'team',segment_type:'period',segment_index:i+1,label:'Period '+(i+1),start_seconds:start,end_seconds:i===2?3260:start+400,status:'needs_review',analysis_summary:'Synthetic period evidence',updated_at:'2026-10-01T21:00:00Z'})),vod_review_markers:[]};
  window.testRows=rows;window.published=[];
  function query(table){let filters=[],payload=null;const q={select(){return q},eq(k,v){filters.push(r=>r[k]===v);return q},neq(k,v){filters.push(r=>r[k]!==v);return q},in(k,v){filters.push(r=>v.includes(r[k]));return q},order(){return q},limit(){return q},update(v){payload=v;return q},then(resolve){let data=(rows[table]||[]).filter(r=>filters.every(f=>f(r)));if(payload)data.forEach(r=>Object.assign(r,payload));return Promise.resolve({data:JSON.parse(JSON.stringify(data)),error:null}).then(resolve)},maybeSingle(){return q.then(r=>({...r,data:r.data[0]||null}))}};return q;}
  window.VVHLBackend={db:{from:query,auth:{getSession:async()=>({data:{session:{access_token:'fixture'}}})},rpc:async(name,args)=>{window.published.push({name,args});return {data:{player_reports:0}}}},state:{user:{id:'manager'},profile:{role:'admin'},teams:[{id:'team',name:'Calgary Hitmen'}],teamId:'team'}};
  window.VVHLManagementGuard={hasAccess:()=>true};
  document.addEventListener('DOMContentLoaded',()=>{document.querySelector('[data-management-content]').hidden=false;document.getElementById('managementLockedMessage').hidden=true;});
};
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}});const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url()),name=u.pathname.slice(1);
   if(u.hostname!=='wildman.test')return route.fulfill({status:200,contentType:'application/json',body:'{}'});
   if(name==='backend.js')return route.fulfill({contentType:'application/javascript',body:`(${fixture.toString()})();`});
   if(['management-guard.js','script.js'].includes(name))return route.fulfill({contentType:'application/javascript',body:''});
   const filename=path.join(root,name);
   if(!filename.startsWith(root+path.sep)||!fs.existsSync(filename))return route.fulfill({status:404,body:''});
   return route.fulfill({contentType:name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'text/html',body:fs.readFileSync(filename)});
  });
  await page.goto('https://wildman.test/vod-lab.html?review=game');
  await page.locator('#segmentList .segment-card').first().waitFor();
  assert.equal(await page.locator('#segmentList .segment-card').count(),3);
  assert.equal(await page.locator('#vodPipelineAdvanced').getAttribute('open'),null);
  assert.equal(await page.locator('#periodEditFields').isVisible(),false);
  assert.equal(await page.locator('#publishVodReport').isDisabled(),true);
  await page.locator('[data-segment-id="p1"]').click();
  assert.equal(page.context().pages().length,1,'Review must not open a duplicate timestamp tab');
  await page.locator('#editSegment').click();
  assert.equal(await page.locator('#segmentStart').getAttribute('readonly'),'');
  await page.locator('#segmentSummary').fill('Management correction');
  await page.locator('#saveSegment').click();
  await page.waitForFunction(()=>window.testRows.vod_review_segments[0].analysis_summary==='Management correction');
  await page.waitForFunction(()=>document.getElementById('periodEditFields').hidden);
  for(const n of [1,2,3]){
   await page.locator(`[data-segment-id="p${n}"]`).click();
   await page.locator('#approveSegment').click();
   await page.waitForFunction(n=>window.testRows.vod_review_segments[n-1].status==='complete',n);
   await page.waitForFunction(()=>document.getElementById('vodStatus').textContent.includes('approved'));
  }
  assert.equal(await page.locator('#publishVodReport').isEnabled(),true);
  await page.locator('#publishVodReport').click();
  await page.waitForFunction(()=>window.published.length===1);
  assert.equal(await page.evaluate(()=>window.published[0].name),'publish_vod_review');
  await page.locator('[data-segment-id="p2"]').click();
  await page.locator('#rejectSegment').click();
  await page.waitForFunction(()=>window.testRows.vod_review_segments[1].status==='rejected');
  await page.waitForFunction(()=>document.getElementById('publishVodReport').disabled);
  await page.screenshot({path:'/tmp/wildman-vod-review-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'Mobile must not overflow');
  await page.screenshot({path:'/tmp/wildman-vod-review-mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS: compact cards, edit/save, read-only ranges, approval/publish/reject, desktop/mobile, no browser errors');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
