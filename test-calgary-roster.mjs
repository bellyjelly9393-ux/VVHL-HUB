import test from 'node:test';
import assert from 'node:assert/strict';
import { calgaryRows, reconcile, insertSql, fold } from './lib/calgary-roster.mjs';
const lg = calgaryRows([
  {team: 'Calgary Hitmen', uid: 1, name: 'gtcoop73', position: 'LW', roster_role: 'Active'},
  {team: 'Calgary Hitmen', uid: 2, name: 'Bauer l 43 l', position: 'RD', roster_role: 'Training Camp'},
  {team: 'Calgary Hitmen', uid: 3, name: 'hxmiltonnn', position: 'G', roster_role: 'Training Camp'},
  {team: 'Calgary Hitmen', uid: 4, name: "O'Neil", position: 'C', roster_role: 'Training Camp'},
  {team: 'Vancouver Giants', uid: 5, name: 'BruinsFan195', position: 'RW', roster_role: 'Training Camp'}]);
const snap = [
  {gamertag: 'gtcoop73', roster_class: 'active_roster', position: 'LW'},
  {gamertag: 'Bauer I 43 I', roster_class: 'training_camp', position: 'RD'},
  {gamertag: 'BruinsFan195', roster_class: 'training_camp', position: 'RW'}];
test('only Calgary rows, TC classed as training_camp', () => {
  assert.equal(lg.length, 4);
  assert.deepEqual(lg.map(r => r.roster_class), ['active_roster', 'training_camp', 'training_camp', 'training_camp']);
});
test('I/l twins match, new TC is added, departures are reported not deleted', () => {
  const r = reconcile(lg, snap);
  assert.deepEqual(r.add.map(x => x.gamertag), ['hxmiltonnn', "O'Neil"]);
  assert.deepEqual(r.twin, [{ours: 'Bauer I 43 I', lg: 'Bauer l 43 l'}]);
  assert.deepEqual(r.departed, [{gamertag: 'BruinsFan195', roster_class: 'training_camp'}]);
  assert.equal(fold('IIII metro'), fold('Illl metro'));
});
test('insert SQL is insert-only and quoted', () => {
  const sql = insertSql(reconcile(lg, snap).add);
  assert.match(sql, /'O''Neil'/);
  assert.doesNotMatch(sql, /\b(delete|update|truncate|drop)\b/i);
  assert.equal((sql.match(/on conflict/g) || []).length, 3);
});
