import assert from 'node:assert/strict';
import {parseSignups,parseRosters,combine} from '../api/hitmen-market.js';
const rows=Array.from({length:100},(_,i)=>`<tr><td>${i}</td><td>Player ${i}</td><td>Center</td><td>East</td><td>PS5</td><td>Team</td><td>date</tr>`).join('');
const signups=parseSignups('Primary Position Preferred EA Server'+rows);
assert.equal(signups.length,100);
assert.equal(signups[0].status,'unverified');
assert.throws(()=>parseSignups('<html>Log in</html>'));
const rosterRows=Array.from({length:10},(_,i)=>`<tr><td>${i+1}. <a href="index.php?userid=${i+1}">Player ${i}</a> C</td><td>3<span>M</span></td></tr>`).join('');
const rosters=parseRosters(`<table><th>Calgary Hitmen</th>${rosterRows}</table>`);
assert.equal(rosters[0].salary,3000000);
const joined=combine(signups,rosters);
assert.equal(joined.length,100);
assert.equal(joined[0].key,'signup:player 0'); // Notes retain their key when signed.
assert.equal(joined[0].lg_id,1);
assert.equal(joined[0].status,'unavailable');
assert.equal(joined[99].status,'unverified');
assert.equal(combine(signups,[rosters[0],{...rosters[0],lg_id:999}])[0].status,'unverified');
assert.throws(()=>parseRosters('<html>source error</html>'));
console.log('Signup parsing, split salary markup, identity matching, ambiguous names and fail-closed checks passed.');
