import test from 'node:test';
import assert from 'node:assert/strict';
import {number,parseRosters,matchLeaguePlayers,eaMembers} from './lib/opponent-refresh.mjs';

test('missing stats remain unknown, real zeros survive',()=>{
  for(const v of [null,undefined,'',' ','—','N/A'])assert.equal(number(v),null);
  assert.equal(number('0'),0);
  assert.equal(eaMembers([{name:'Goalie',gamesPlayed:4}])[0].goals,null);
});
test('LG stable identity survives rename and stats retain source date/scope',()=>{
  const {rows,unmatched}=matchLeaguePlayers([{gamertag:'New GT',source_player_uid:42,position:'C',source_updated_at:'2026-10-03'}],[{gamertag:'Old GT',lg_user_id:42,player_kind:'skater',games_played:3,fetched_at:'2026-10-01',stats:{goals:0,assists:2,points:2,pim:'2:30',record:'2-0-1'}}]);
  assert.equal(rows[0].gamertag,'New GT');assert.equal(rows[0].goals,0);assert.equal(rows[0].pim,2.5);assert.equal(rows[0].source_updated_at,'2026-10-01');assert.equal(rows[0].raw_stats.source_gamertag,'Old GT');assert.deepEqual(unmatched,[]);
});
test('identity mismatches, punctuation collisions and ambiguous records are not attributed',()=>{
  const stats=[{gamertag:'A_B',lg_user_id:8,player_kind:'skater',stats:{goals:99}}];
  assert.equal(matchLeaguePlayers([{gamertag:'A_B',source_player_uid:9,position:'C'}],stats).rows.length,0);
  assert.equal(matchLeaguePlayers([{gamertag:'A B',position:'C'}],stats).rows.length,0);
  assert.equal(matchLeaguePlayers([{gamertag:'A_B',position:'C'}],[...stats,...stats]).rows.length,0);
});
test('goalie role uses goalie row and converts LG save fraction to percent',()=>{
  const r=matchLeaguePlayers([{gamertag:'G',source_player_uid:1,position:'G'}],[{lg_user_id:1,player_kind:'skater',stats:{goals:8}},{lg_user_id:1,player_kind:'goalie',stats:{savep:0.9,gaa:2.3,ggp:4}}]);
  assert.equal(r.rows[0].goalie_save_pct,90);assert.equal(r.rows[0].goals,null);assert.equal(r.rows[0].games_played,4);
});
test('LG challenge or incomplete roster page cannot produce destructive empty snapshot',()=>{
  assert.throws(()=>parseRosters('<h1>Access denied</h1>'),/incomplete/);
});
test('existing roster parser preserves spaces, stable IDs, roles and position',()=>{
  const html='<table><th>Team Name</th>'+Array.from({length:50},(_,i)=>'<tr><td>'+i+'. <a href="?userid='+(i+1)+'">Player '+i+'</a> LD AGM 1.5 M</td></tr>').join('')+'</table>';
  const p=parseRosters(html)[0];assert.equal(p.name,'Player 0');assert.equal(p.position,'LD');assert.equal(p.management_role,'AGM');assert.equal(p.salary,1500000);
});
test('EA snapshots keep club stats distinct and never fill missing assists with zero',()=>{
  const p=eaMembers({members:[{name:'A',gamesPlayed:'3',goals:'2'}]})[0];
  assert.equal(p.games_played,3);assert.equal(p.points,null);assert.match(p.raw_stats.scope,/not LG/);
});
