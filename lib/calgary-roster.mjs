// Calgary's own LGCHL roster (active + Training Camp) from the public S55 roster page.
// Pure helpers: no network, no database. Used by scripts/calgary-tc-check.mjs and tests.
// Why this exists: nothing automated writes public.hitmen_roster_snapshot. The opponent refresh
// (lib/opponent-refresh.mjs) already downloads and parses the whole league roster page, including
// Calgary's Training Camp rows, but it only saves opponents. Calgary's rows were hand-loaded
// (2026-09-24 active, 2026-09-27 TC, 2026-10-03 active resync), so TC drifted.
export const CALGARY = 'Calgary Hitmen';
// LeagueGaming renders capital I and lower-case l identically; our roster was typed from LG pages.
export const fold = s => String(s || '').trim().replace(/[Il|]/g, 'l').toLowerCase();
const lc = s => String(s || '').trim().toLowerCase();

export function calgaryRows(parsed) {
  return parsed.filter(p => p.team === CALGARY).map(p => ({
    uid: p.uid, gamertag: p.name, position: p.position, salary: p.salary, management_role: p.management_role,
    roster_class: p.roster_role === 'Training Camp' ? 'training_camp' : 'active_roster'}));
}

/* lg: calgaryRows(...); snap: hitmen_roster_snapshot rows (active=true) for Calgary S55.
   Returns what an insert-only sync would do. Never proposes deletes: departures are reported only. */
export function reconcile(lg, snap) {
  const find = (row, pool) => pool.find(s => lc(s.gamertag) === lc(row.gamertag)) || (() => {
    const f = pool.filter(s => fold(s.gamertag) === fold(row.gamertag)); return f.length === 1 ? f[0] : null; })();
  const out = {add: [], confirmed: [], twin: [], moved: [], departed: []};
  for (const r of lg) {
    const s = find(r, snap);
    if (!s) { out.add.push(r); continue; }
    if (s.gamertag !== r.gamertag) out.twin.push({ours: s.gamertag, lg: r.gamertag});
    if (s.roster_class !== r.roster_class) out.moved.push({gamertag: s.gamertag, from: s.roster_class, to: r.roster_class});
    else out.confirmed.push({gamertag: s.gamertag, roster_class: s.roster_class, position: r.position, positionChanged: s.position !== r.position ? s.position : null});
  }
  for (const s of snap) if (!find(s, lg)) out.departed.push({gamertag: s.gamertag, roster_class: s.roster_class});
  return out;
}

const q = v => "'" + String(v).replace(/'/g, "''") + "'";
// Insert-only SQL for new Training Camp players (review before running). Active-roster changes are
// deliberately left to a human: they change counts, stalls and account links.
export function insertSql(add, team = 'b0bcbdda-da9d-419d-8f61-b34937966d49', season = 55) {
  const tc = add.filter(r => r.roster_class === 'training_camp');
  if (!tc.length) return '-- nothing to add';
  const vals = tc.map(r => `(${q(r.gamertag)},${q(r.position)})`).join(',');
  return [
    `insert into public.players (gamertag, primary_position, status, approved) select v.tag, v.pos, 'available', true from (values ${vals}) v(tag,pos) on conflict (gamertag) do nothing;`,
    `insert into public.hitmen_roster_snapshot (team_id, season, player_id, gamertag, position, salary, roster_class, active, source_label, source_updated_at) select ${q(team)}::uuid, ${season}, p.id, p.gamertag, v.pos, 750000, 'training_camp', true, 'LeagueGaming public Season 55 roster (Training Camp)', now() from (values ${vals}) v(tag,pos) join public.players p on p.gamertag = v.tag on conflict (team_id, season, gamertag) do nothing;`,
    `insert into public.team_player_lockers (team_id, season, roster_snapshot_id, player_id, gamertag, position, salary, jersey_name, roster_class) select s.team_id, s.season, s.id, s.player_id, s.gamertag, s.position, s.salary, s.gamertag, 'tc' from public.hitmen_roster_snapshot s join (values ${vals}) v(tag,pos) on s.gamertag = v.tag where s.team_id = ${q(team)}::uuid and s.season = ${season} and s.roster_class = 'training_camp' and s.active on conflict (team_id, season, gamertag) do nothing;`
  ].join('\n');
}
