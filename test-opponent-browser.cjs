const { chromium } = require('playwright');
const fs = require('node:fs');
const http = require('node:http');
const assert = require('node:assert/strict');
const html = fs.readFileSync('hitmen-opponents.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
const mock = `
window.calls=[];
const tables={
hitmen_opponent_refresh_runs:{id:'run',requested_at:'2026-10-03T20:00:00Z',finished_at:'2026-10-03T20:05:00Z'},
hitmen_opponent_refresh_tasks:[{opponent_name:'Test Team',source:'lg_chl',status:'partial',detail:{warnings:['Roster source unavailable; previous roster retained'],unmatched:['Unknown']}}],
hitmen_opponents:{id:'team',opponent_name:'Test Team',lg_roster_updated_at:'2026-10-01'},
hitmen_opponent_roster_players:[{gamertag:'Goalie <script>',position:'G',source_player_uid:1}],
hitmen_opponent_player_stats:[{gamertag:'Goalie <script>',source:'ea_nhl27',games_played:99,source_updated_at:'2026-10-03'}, {gamertag:'Goalie <script>',source:'lg_chl',games_played:3,goalie_save_pct:90,goalie_gaa:2.3,source_updated_at:'2026-10-01'}],
hitmen_opponent_source_snapshots:[],hitmen_opponent_pregame_reports:[]};
window.VVHLBackend={state:{user:{id:'manager'},profile:{role:'admin'},memberships:[]},db:{
from(name){let single=false;const q={select(){return q},eq(){return q},order(){return q},limit(){return q},single(){single=true;return q},maybeSingle(){single=true;return q},then(resolve){let data=tables[name]; if(single&&Array.isArray(data))data=data[0]||null;return Promise.resolve({data,error:null}).then(resolve)}};return q},
rpc(name,args){window.calls.push({name,args});return Promise.resolve({data:'run',error:null})}
}};
document.querySelector('[data-management-content]').hidden=false;
document.getElementById('hoiDetail').hidden=false;
`;
(async()=>{
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/html');res.end(req.url.endsWith('.css')?'':html);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true});
 try{
  for(const width of [390,1280]){
   const page=await browser.newPage({viewport:{width,height:850}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('https://**/*',r=>r.abort());
   await page.goto('http://127.0.0.1:'+server.address().port);
   await page.addScriptTag({content:mock});
   await page.addScriptTag({content:fs.readFileSync('hitmen-opponent-intel.js','utf8')});
   await page.addScriptTag({content:fs.readFileSync('hitmen-opponent-refresh.js','utf8')});
   await page.evaluate(()=>window.dispatchEvent(new CustomEvent('hitmen-opponent-selected',{detail:{id:'team',name:'Test Team'}})));
   await page.waitForFunction(()=>document.getElementById('hoiRoster').textContent.includes('LGCHL S55'));
   const roster=await page.locator('#hoiRoster').innerText();assert.match(roster,/90/);assert.match(roster,/2\.3/);assert.doesNotMatch(roster,/99/);assert.match(roster,/Goalie <script>/);
   assert.match(await page.locator('#hoiRefreshStatus').innerText(),/1 partial/);
   await page.locator('summary').filter({hasText:'Source status'}).click();assert.match(await page.locator('#hoiRefreshDetails').innerText(),/previous roster retained/);
   await page.locator('#hoiRefreshOpponents').click();assert.equal(await page.evaluate(()=>window.calls.length),1);
   await page.evaluate(()=>{window.VVHLBackend.state.profile.role='player';window.dispatchEvent(new Event('vvhl-auth-change'));});
   assert.equal(await page.locator('#hoiRefreshOpponents').isDisabled(),true);assert.deepEqual(errors,[]);await page.close();
  }
  console.log('PASS: desktop/mobile refresh status, source warnings, goalie stats, LG preference, escaping, management button');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exit(1)});
