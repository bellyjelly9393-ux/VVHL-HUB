// node scripts/calgary-tc-check.mjs [snapshot.json]
// Read-only. Fetches the public LGCHL S55 roster page once, lists Calgary's active roster and Training
// Camp, and (given a JSON export of active hitmen_roster_snapshot rows) prints the reconcile plus
// insert-only SQL for new TC players. Writes nothing anywhere.
import fs from 'node:fs';
import { ROSTER_URL, parseRosters } from '../lib/opponent-refresh.mjs';
import { calgaryRows, reconcile, insertSql } from '../lib/calgary-roster.mjs';
const res = await fetch(ROSTER_URL, {headers: {'User-Agent': 'Wildman-Hockey-Esports/1.0 (Calgary roster check; manual)', Accept: 'text/html'}});
if (!res.ok) throw new Error('LG roster HTTP ' + res.status);
const lg = calgaryRows(parseRosters(await res.text()));
for (const cls of ['active_roster', 'training_camp']) {
  const rows = lg.filter(r => r.roster_class === cls);
  console.log(`\n${cls === 'training_camp' ? 'Training Camp' : 'Active roster'} (${rows.length})`);
  rows.forEach(r => console.log(`  ${r.position.padEnd(2)}  ${r.gamertag}  (LG uid ${r.uid})`));
}
if (process.argv[2]) {
  const r = reconcile(lg, JSON.parse(fs.readFileSync(process.argv[2], 'utf8')));
  console.log('\nReconcile:', JSON.stringify({add: r.add.map(x => `${x.roster_class}:${x.gamertag}`), twin: r.twin, moved: r.moved, departed: r.departed}, null, 1));
  console.log('\n-- insert-only SQL (review first; nothing is deleted or archived)\n' + insertSql(r.add));
}
