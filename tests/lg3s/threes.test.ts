import { assert, assertEquals } from "jsr:@std/assert@1";
import { freshDb, pgStore, fakeLG, fixture, IDS, RAW } from "./harness.ts";
import { run } from "../../supabase/functions/lg3s-sync/core.ts";
import { urls } from "../../supabase/functions/lg3s-sync/fetcher.ts";
import { validate } from "../../supabase/functions/lg3s-threes-bot/validate.ts";

const site = JSON.parse(Deno.readTextFileSync(`${RAW}/lg3s-season1-data.json`));
const roster = new Set<number>(site.players.map((p: any) => p.id));
const q = async (db: any, s: string, p: unknown[] = []) => (await db.query(s, p)).rows as any[];
const EV: Record<string, unknown> = {};
let DB: any;
async function db() {
  if (DB) return DB;
  DB = await freshDb(); const st = pgStore(DB, roster);
  const m = new Map<string, string | number>(IDS.map((id) => [urls.game(id), fixture(id)])); m.set(urls.standings(), Deno.readTextFileSync(`${RAW}/lg_standing.html`));
  const lg = fakeLG(m);
  for (const t of ["2026-10-22T13:00:00Z", "2026-10-22T13:11:00Z"]) await run(st, lg, "backfill", { ids: IDS, now: t });
  return DB;
}
const feed = async (f: string, p: string) => (await q(await db(), `select public.lg3s_threes_feed($1,$2) r`, [f, p]))[0].r;

Deno.test("feeds come only from verified games; daily three for 2026-10-21", async () => {
  const f = await feed("daily_three", "2026-10-21");
  assertEquals(f.games.length, 18); assertEquals(f.source_game_ids.length, 18);
  assertEquals(f.top_performers[0].player, "x Buddha I43I"); assertEquals(f.top_performers[0].points, 31);
  const none = await feed("daily_three", "2026-10-22"); assertEquals(none.insufficient, true);
  EV.daily_top3 = f.top_performers.slice(0, 3); EV.notable = f.notable_stats;
});

Deno.test("duo index: 4-game minimum not met after Week 1 night 1 → insufficient", async () => {
  const f = await feed("duo_index", "S1-W01@2026-10-21");
  assertEquals(f.top_duos, []); assertEquals(f.insufficient, true); assertEquals(f.max_games_together, 3);
  assert(validate("duo_index", { error: f.insufficient_reason }, f).ok);
  assert(!validate("duo_index", { week_label: "Week 1", top_duos: [], odd_couple: {}, needs_counseling: {} }, f).ok);
  // min 3 shows ranking + one-pair-per-team rule works
  const f3 = (await q(await db(), `select private.lg3s_feed_duo_index(1, '2026-10-21', 3) r`))[0].r;
  assertEquals(new Set(f3.top_duos.map((d: any) => d.team)).size, f3.top_duos.length);
  EV.duo_min3_preview = f3.top_duos;
});

Deno.test("power rankings feed: 12 teams, standings order, last_rank null", async () => {
  const f = await feed("trio_power_rankings", "S1-W01@2026-10-21");
  assertEquals(f.teams.length, 12); assertEquals(f.teams[0].team, "Slovakia"); assert(f.teams.every((t: any) => t.last_rank === null));
  assertEquals(f.week_complete, false);
});

Deno.test("pick3 prices: $4-15, top5 >= $13, 3 value picks <= $7, SOG+hits used", async () => {
  const f = await feed("pick3_preview", "S1-W02");
  const ps = f.players; console.log('pick3 players', ps.length, ps.filter((p: any) => p.price >= 13).length, ps.filter((p: any) => p.is_value_pick).map((p: any) => p.price)); assert(ps.length >= 30);
  assert(ps.every((p: any) => p.price >= 4 && p.price <= 15));
  assertEquals(ps.filter((p: any) => p.price >= 13).length, 5);
  const v = ps.filter((p: any) => p.is_value_pick); assertEquals(v.length, 3); assert(v.every((p: any) => p.price <= 7));
  assertEquals(f.pricing_inputs.matchup_status.startsWith("unavailable"), true);
  EV.pick3_top = ps.slice(0, 6); EV.pick3_value = v;
});

Deno.test("roster wire: baseline then diff detects signed/released/moved", async () => {
  const d = await db();
  const base = site.players.map((p: any) => ({ lg_user_id: p.id, gamertag: p.n, lg_team_id: p.t, position: p.p }));
  await q(d, `select public.lg3s_ingest_roster($1::jsonb)`, [JSON.stringify({ captured_at: "2026-10-21T12:00:00Z", source: "t", rows: base })]);
  let f = await feed("roster_wire", "latest"); assertEquals(f.is_baseline, true); assertEquals(f.moves, []);
  const un = (await q(d, `select public.lg3s_ingest_roster($1::jsonb) r`, [JSON.stringify({ captured_at: "2026-10-22T12:00:00Z", source: "t", rows: base })]))[0].r;
  assertEquals(un.unchanged, true);
  const next = base.filter((p: any) => p.lg_user_id !== base[0].lg_user_id).map((p: any) => p.lg_user_id === base[1].lg_user_id ? { ...p, lg_team_id: 342 } : p);
  next.push({ lg_user_id: 999999, gamertag: "New Guy", lg_team_id: 341, position: "C" });
  await q(d, `select public.lg3s_ingest_roster($1::jsonb)`, [JSON.stringify({ captured_at: "2026-10-23T12:00:00Z", source: "t", rows: next })]);
  f = await feed("roster_wire", "latest");
  assertEquals(f.moves.map((m: any) => m.type).sort(), ["moved", "released", "signed"]);
  const good = { updated_label: f.updated_label, quiet_note: "", moves: f.moves.map((m: any) => ({ ...m, ticker: "Move made.", is_big_move: false, impact: "Depth", hot_take: "We will see.", winner: "TBD" })) };
  const c = validate("roster_wire", good, f); assert(c.ok, c.reasons.join("; "));
  EV.roster_diff = f.moves;
});

Deno.test("fact-check rejects invented player, wrong stat line, data-source mention, long headline", async () => {
  const f = await feed("daily_three", "2026-10-21"); const t = f.top_performers[0];
  const good = { date: "2026-10-21", tagline: "Slovakia came to cook.", items: [
    { slot: "performer", headline: "Buddha goes nuclear", blurb: `${t.player} put up ${t.points} points. Everyone else took notes.`, player: t.player, team: t.team, stat_line: t.stat_line },
    { slot: "stat", headline: "Goals everywhere", blurb: `The night produced ${f.notable_stats.total_goals} goals. Goalies need a hug.`, stat_value: String(f.notable_stats.total_goals), subject: "Slovakia" },
    { slot: "storyline", headline: "Perfect starts", blurb: "Some teams went perfect. Others went home.", teams: ["Slovakia"], players: [t.player] }] };
  const ok = validate("daily_three", good, f); assert(ok.ok, ok.reasons.join("; "));
  const bad = structuredClone(good);
  bad.items[0].player = "Wayne Gretzky"; bad.items[1].blurb = "Per the LeagueGaming sync, 999 goals were scored. Wild."; bad.items[2].headline = "x".repeat(75); bad.items[0].stat_line = "9G 9A 18P";
  bad.items[2].blurb = "Finland is coming. Watch out.";
  const no = validate("daily_three", bad, f); assert(!no.ok);
  for (const k of ["not found in feed", "mentions data source", "number 999", "chars (limit <70)", "non-league team"]) assert(no.reasons.some((r) => r.includes(k)), k);
  EV.factcheck_good = ok; EV.factcheck_bad = no.reasons;
});

Deno.test("store: dedupe by feature+period, needs_review replaced, error output not stored as post", async () => {
  const d = await db(); const s = (p: any) => q(d, `select public.lg3s_store_threes($1::jsonb) r`, [JSON.stringify(p)]).then((r) => r[0].r);
  const a = await s({ feature: "daily_three", period_key: "2026-10-21", title: "t", status: "needs_review", reasons: ["x"], output: {}, prompt_version: 1 });
  const b = await s({ feature: "daily_three", period_key: "2026-10-21", title: "t", status: "pending_review", output: { ok: 1 }, prompt_version: 1 });
  const c = await s({ feature: "daily_three", period_key: "2026-10-21", title: "t", status: "pending_review", output: { ok: 2 }, prompt_version: 1 });
  const e = await s({ feature: "duo_index", period_key: "S1-W01", status: "error_output", output: { error: "x" }, prompt_version: 1 });
  assertEquals([a.run_status, b.run_status, c.run_status, e.run_status], ["stored_needs_review", "stored_pending_review", "duplicate", "error_output"]);
  assertEquals((await q(d, `select count(*)::int n from lg3s_editorial_posts where feature is not null`))[0].n, 1);
  assertEquals((await q(d, `select count(*)::int n from lg3s_editorial_posts where status='published'`))[0].n, 0);
  Deno.writeTextFileSync("tests/threes_evidence.json", JSON.stringify(EV, null, 1));
});
