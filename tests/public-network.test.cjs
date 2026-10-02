const {test}=require('node:test');
const assert=require('node:assert/strict');
const M=require('../public-network-model.js');
const base=()=>({events:[{id:'event',name:'LGCHL',is_public:true},{id:'private',is_public:false}],teams:[],teamStats:[],games:[]});
test('public selector excludes private, sandbox, cancelled slots and scouting bridge',()=>{
 const s=base();s.games=[
 {id:'safe',event_id:'event'},
 {id:'secret',event_id:'private'},
 {id:'sandbox',event_id:'event',is_sandbox:true},
 {id:'unused',event_id:'event',source_payload:{not_required:true}},
 {id:'scout',event_id:'event',source_provider:'hitmen-workspace'}];
 assert.deepEqual(M.games(s).map(g=>g.id),['safe']);
});
test('team joins use IDs even when display names coincide',()=>{
 const s=base();s.teams=[{id:'a',name:'Wildman'},{id:'b',name:'Wildman'}];s.games=[{id:'g',event_id:'event',home_team_id:'b',away_team_id:'c'}];
 assert.deepEqual(M.teamGames(s,'a'),[]);assert.equal(M.teamGames(s,'b')[0].id,'g');
});
test('unknown scores stay unknown and scheduled games do not imply a result',()=>{
 assert.equal(M.score({status:'live',home_score:2,away_score:null}),'Score pending');
 assert.equal(M.score({status:'scheduled',home_score:0,away_score:0}),'VS');
 assert.equal(M.score({status:'final',home_score:0,away_score:3}),'0–3');
});
test('standings require source ranks and retain event scope',()=>{
 const s=base();s.teamStats=[{event_id:'event',points:50},{event_id:'other',rank:1},{event_id:'event',rank:3},{event_id:'event',rank:2}];
 assert.deepEqual(M.standings(s,'event').map(r=>r.rank),[2,3]);
});
test('ticker prioritizes live flagship games, live LG, other live events, then future games',()=>{
 const s=base();s.events.push({id:'cup',name:'Community Cup'});
 s.games=[{id:'other',event_id:'cup',status:'live'},{id:'lg',event_id:'event',status:'live'},{id:'wm',event_id:'cup',status:'live',home_team_id:'wm'},{id:'future',event_id:'event',status:'scheduled',scheduled_at:'2026-10-10'},{id:'stale',event_id:'event',status:'scheduled',scheduled_at:'2025-01-01'}];
 assert.deepEqual(M.ticker(s,'wm',Date.parse('2026-10-01')).map(g=>g.id),['wm','lg','other','future']);
});
test('configured featured event must be public',()=>{
 const s=base();assert.equal(M.featuredEvent(s,'private').id,'event');
});
test('sample and historical provenance are retained rather than relabeled official',()=>{
 assert.match(M.provenance({source_label:'Edit-log sample',source_type:'historical'}),/Edit-log sample.*historical/);
});

test('missing or unsafe asset/registration URLs never become invented destinations',()=>{
 for(const value of [undefined,null,'','  ','javascript:alert(1)','data:text/html,test'])assert.equal(M.safeURL(value,'https://example.com/'),'');
 assert.equal(M.safeURL('assets/logo.png','https://example.com/'),'https://example.com/assets/logo.png');
});
