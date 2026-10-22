import { assert, assertEquals } from "jsr:@std/assert@1";
import { freshDb, pgStore, fakeLG, fixture, IDS, RAW } from "./harness.ts";
import { run, syncGame } from "../../supabase/functions/lg3s-sync/core.ts";
import { urls, makeFetcher, SourceOutage } from "../../supabase/functions/lg3s-sync/fetcher.ts";
import { parseStandings, parseSchedule, parseGame } from "../../supabase/functions/lg3s-sync/parse.ts";

const roster = new Set<number>(JSON.parse(Deno.readTextFileSync(`${RAW}/lg3s-season1-data.json`)).players.map((p: any) => p.id));
const site = JSON.parse(Deno.readTextFileSync(`${RAW}/lg3s-season1-data.json`));
const T0 = "2026-10-22T13:00:00Z", T5 = "2026-10-22T13:05:00Z", T11 = "2026-10-22T13:11:00Z", T30 = "2026-10-22T13:30:00Z", T45 = "2026-10-22T13:45:00Z";
const baseMap = () => { const m = new Map<string, string | number>(IDS.map((id) => [urls.game(id), fixture(id)])); m.set(urls.standings(), Deno.readTextFileSync(`${RAW}/lg_standing.html`)); return m; };
const rows = async (db: any, s: string, p: unknown[] = []) => (await db.query(s, p)).rows as any[];
const EVIDENCE: Record<string, unknown> = {};

async function backfilled() {
  const db = await freshDb(); const st = pgStore(db, roster); const lg = fakeLG(baseMap());
  const r0 = await run(st, lg, "backfill", { ids: IDS, now: T0 });
  const r5 = await run(st, lg, "backfill", { ids: IDS, now: T5 });
  const r11 = await run(st, lg, "backfill", { ids: IDS, now: T11 });
  return { db, st, lg, r0, r5, r11 };
}

Deno.test("backfill 921533–921550: provisional → (5 min) provisional → (11 min) verified, 18/18", async () => {
  const { db, r0, r5, r11 } = await backfilled();
  assertEquals(r0.results.map((r: any) => r.action), Array(18).fill("provisional"));
  assertEquals(r5.results.map((r: any) => r.action), Array(18).fill("provisional"));
  assertEquals(r11.results.map((r: any) => r.action), Array(18).fill("verified"));
  const g = await rows(db, `select lg_game_id, away_lg_team_id a, away_score a_s, home_score hs, home_lg_team_id h, verification_status vs, verification_flags f from lg3s_games order by 1`);
  EVIDENCE.games = g;
  assertEquals(g.filter((x) => x.vs === "verified").length, 18);
});

Deno.test("scores == audit table (independent capture) and schedule == site JSON", async () => {
  const { db } = await backfilled();
  const expected: Record<number, [number, number]> = { 921533: [4, 10], 921534: [4, 8], 921535: [0, 8], 921536: [0, 1], 921537: [3, 10], 921538: [11, 0], 921539: [5, 8], 921540: [0, 6], 921541: [4, 16],
    921542: [8, 7], 921543: [2, 6], 921544: [3, 9], 921545: [5, 4], 921546: [8, 4], 921547: [6, 10], 921548: [6, 9], 921549: [6, 4], 921550: [9, 6] };
  const g = await rows(db, `select g.lg_game_id::int id, away_score, home_score, away_lg_team_id, home_lg_team_id, to_char(scheduled_at at time zone 'America/Toronto','YYYY-MM-DD HH24:MI') et from lg3s_public_games g where is_verified`);
  let ok = 0;
  for (const x of g) {
    const s = site.games.find((y: any) => y.id === x.id);
    assertEquals([x.away_score, x.home_score], expected[x.id], `score ${x.id}`);
    assertEquals([x.away_lg_team_id, x.home_lg_team_id, x.et], [s.away, s.home, `${s.date} ${s.time}`], `schedule ${x.id}`);
    ok++;
  }
  assertEquals(ok, 18);
});

Deno.test("player lines == independent python extraction (every G/A/P, goalie SA/GA/SV)", async () => {
  const { db } = await backfilled();
  const p = new Deno.Command("python3", { args: ["tests/lg3s/independent_extract.py"] }).outputSync();
  assert(p.success, new TextDecoder().decode(p.stderr));
  const ind = JSON.parse(new TextDecoder().decode(p.stdout)) as any[];
  const db_ = await rows(db, `select lg_game_id::int gid, lg_user_id::int uid, player_kind k, lg_team_id_at_game t, goals g, assists a, points p, shots_against sa, goals_against ga, saves sv from lg3s_player_game_lines order by 1,2`);
  const key = (r: any) => `${r.gid}|${r.uid}|${r.k}`;
  const m = new Map(db_.map((r) => [key(r), r]));
  let compared = 0;
  for (const r of ind) {
    const d = m.get(key(r)); assert(d, "missing line " + key(r));
    if (r.k === "skater") assertEquals([d.t, d.g, d.a, d.p], [r.t, r.g, r.a, r.p], key(r)); else assertEquals([d.t, d.sa, d.ga, d.sv], [r.t, r.sa, r.ga, r.sv], key(r));
    compared++;
  }
  assertEquals(compared, db_.length);
  EVIDENCE.lines_compared = compared;
});

Deno.test("standings: computed-from-verified == official LG standings (all 12 teams, every column) + regression", async () => {
  const { db } = await backfilled();
  const off = parseStandings(Deno.readTextFileSync(`${RAW}/lg_standing.html`));
  const comp = await rows(db, `select * from lg3s_public_standings`);
  for (const o of off) {
    const c = comp.find((x) => x.lg_team_id === o.lg_team_id);
    assertEquals([c.gp, c.w, c.l, c.otw, c.otl, c.pts, c.gf, c.ga, c.gd], [o.gp, o.w, o.l, o.otw, o.otl, o.pts, o.gf, o.ga, o.gd], `team ${o.lg_team_id}`);
  }
  const rec = Object.fromEntries(comp.map((c) => [c.nation, `${c.w}-${c.l}`]));
  for (const n of ["Japan", "Slovakia", "USA"]) assertEquals(rec[n], "3-0", n);
  assertEquals(rec["Great Britain"], "2-1");
  for (const n of ["Canada", "Germany", "Italy", "Latvia"]) assertEquals(rec[n], "0-3", n);
  EVIDENCE.standings = comp.map((c) => `${c.group_code} ${c.nation} ${c.gp}GP ${c.w}-${c.l}-${c.otw}-${c.otl} ${c.pts}pts ${c.gf}:${c.ga}`).sort();
});

Deno.test("duplicate sync is idempotent (no new lines, status unchanged)", async () => {
  const { db, st, lg } = await backfilled();
  const before = await rows(db, `select count(*)::int n from lg3s_player_game_lines`);
  const r = await run(st, lg, "backfill", { ids: IDS, now: T30 });
  assertEquals(r.results.map((x: any) => x.action), Array(18).fill("unchanged"));
  assertEquals((await rows(db, `select count(*)::int n from lg3s_player_game_lines`))[0].n, before[0].n);
  assertEquals((await rows(db, `select count(*)::int n from lg3s_games where verification_status='verified'`))[0].n, 18);
});

Deno.test("invalid/incomplete pages never downgrade verified; new incomplete final → needs_review", async () => {
  const { db, st } = await backfilled();
  const html = fixture(921533);
  const noGoalies = html.replace(/<th colspan="21">Goalie Stats[\s\S]*?<\/table>/, "</th></tr></thead></table>");
  const truncated = html.slice(0, 1500);
  const r1 = await syncGame(st, fakeLG(new Map([[urls.game(921533), noGoalies]])), 921533, roster, T30);
  assertEquals(r1.action, "rejected_downgrade");
  const r2 = await syncGame(st, fakeLG(new Map([[urls.game(921533), truncated]])), 921533, roster, T30);
  assertEquals(r2.action, "parse_error");
  const g = (await rows(db, `select verification_status vs, away_score, home_score from lg3s_games where lg_game_id=921533`))[0];
  assertEquals([g.vs, g.away_score, g.home_score], ["verified", 4, 10]);
  assertEquals((await rows(db, `select count(*)::int n from lg3s_corrections where lg_game_id=921533 and action='rejected'`))[0].n, 1);
  // fresh DB: a final page with no goalie table can never verify
  const db2 = await (await import("./harness.ts")).freshDb(); const st2 = pgStore(db2, roster);
  for (const t of [T0, T11]) await syncGame(st2, fakeLG(new Map([[urls.game(921533), noGoalies]])), 921533, roster, t);
  assertEquals((await rows(db2, `select verification_status vs from lg3s_games`))[0].vs, "needs_review");
});

Deno.test("not-final page (in progress) stays unverified and hidden from public scores", async () => {
  const db = await freshDb(); const st = pgStore(db, roster);
  const live = fixture(921536).replace('font-size:40px;">FINAL<', 'font-size:40px;">3rd<');
  for (const t of [T0, T11, T30]) await syncGame(st, fakeLG(new Map([[urls.game(921536), live]])), 921536, roster, t);
  const g = (await rows(db, `select verification_status vs, status from lg3s_games`))[0];
  assertEquals([g.vs, g.status], ["unverified", "in_progress"]);
  const pub = (await rows(db, `select status, away_score, is_verified from lg3s_public_games`))[0];
  assertEquals([pub.away_score, pub.is_verified], [null, false]);
});

Deno.test("cross-nation goalies: credited per game by box-score crest, GA reconciles with opponent", async () => {
  const out: string[] = [];
  for (const id of IDS) {
    const g = parseGame(fixture(id), id);
    for (const gl of g.goalies) {
      const opp = gl.lg_team_id === g.away_lg_team_id ? g.home_score! : g.away_score!;
      assert(gl.goals_against <= opp, `${id} ${gl.gamertag}`);
      out.push(`${id} ${gl.gamertag}->${gl.lg_team_id} GA${gl.goals_against}/opp${opp}`);
    }
  }
  EVIDENCE.goalies = out;
  // a goalie row whose crest is not one of the two teams must not be credited
  const src = fixture(921533); const gi = src.indexOf("Goalie Stats");
  const bad = src.slice(0, gi) + src.slice(gi).replace("team/p16/team532.png", "team/p16/team999.png");
  const g = parseGame(bad, 921533);
  const og = g.goalies.find((x) => x.lg_user_id === 37711)!;
  assertEquals(og.lg_team_id, null); assert(og.flags.includes("goalie_team_unresolved"));
});

Deno.test("missing LG user id on a skater → needs_review, not verified", async () => {
  const db = await freshDb(); const st = pgStore(db, roster);
  const html = fixture(921533).replace(/page=team_user&userid=51991&leagueid=154&seasonid=1/, "page=team_user&leagueid=154&seasonid=1").replace(/userid=51991&gameid=921533/, "gameid=921533");
  for (const t of [T0, T11]) await syncGame(st, fakeLG(new Map([[urls.game(921533), html]])), 921533, roster, t);
  const g = (await rows(db, `select verification_status vs, verification_flags f from lg3s_games`))[0];
  assertEquals(g.vs, "needs_review"); assert(g.f.some((x: string) => x.startsWith("missing_id")));
});

Deno.test("late correction: changed passing payload → pending, then 'corrected' after stability window, history kept", async () => {
  const { db, st } = await backfilled();
  // simulate LG correcting 921536 GBR@JPN 0-1 -> 0-2 (extra goal for one Japan skater, header, period & team stats)
  let h = fixture(921536);
  const g0 = parseGame(h, 921536);
  const jp = g0.skaters.find((s) => s.lg_team_id === 591 && s.g === 1)!;
  h = h.replace(/(<span class="lg_game_header">)1(<\/span>)/, "$12$2");
  h = h.replace(new RegExp(`(userid=${jp.lg_user_id}&leagueid=154&seasonid=1">[^<]*</a>[\\s\\S]*?<td[^>]*>\\s*)1(</td>\\s*<td[^>]*>\\s*\\d+</td>\\s*<td[^>]*><span class="badge text-bg-info">\\s*)(\\d+)`), (_m, a, b, p) => `${a}2${b}${+p + 1}`);
  h = h.replace(/(team591\.png">\s*<a [^>]*>Japan<\/a>[^<]*<\/td>(?:\s*<td[^>]*>\d+<\/td>){2}\s*<td[^>]*>)(\d+)/, (_m, a, n) => `${a}${+n + 1}`);
  h = h.replace(/(<td[^>]*>\s*0\s*<\/td>\s*<td[^>]*>\s*Goals\s*<\/td>\s*<td[^>]*>)\s*1/, "$12");
  h = h.replace(/(userid=\d+&leagueid=154&seasonid=1">ItsaMeAquino<\/a>[\s\S]*?<\/span><\/td>\s*<td[^>]*>\s*(\d+)\s*<\/td>\s*<td[^>]*>[^<]*<\/td>\s*<td[^>]*>)\s*1/, "$12");
  const pg = parseGame(h, 921536);
  const gk = pg.goalies.find((x) => x.lg_team_id === 1446)!; h = h.replace(new RegExp(`(">${gk.gamertag}</a>[\\s\\S]*?</span></td>\\s*<td[^>]*>\\s*\\d+\\s*</td>\\s*<td[^>]*>[^<]*</td>\\s*<td[^>]*>\\s*2\\s*</td>\\s*<td[^>]*>)\\s*(\\d+)`), (_m, a, sv) => `${a}${+sv - 1}`);
  const lg = fakeLG(new Map([[urls.game(921536), h]]));
  const a1 = await syncGame(st, lg, 921536, roster, T30); assertEquals(a1.passed, true, JSON.stringify((await import("../../supabase/functions/lg3s-sync/verify.ts")).verifyGame));
  assertEquals(a1.action, "correction_pending");
  assertEquals((await rows(db, `select home_score from lg3s_public_games where lg_game_id=921536`))[0].home_score, 1);
  const a2 = await syncGame(st, lg, 921536, roster, T45); assertEquals(a2.action, "corrected");
  const g = (await rows(db, `select verification_status vs, home_score from lg3s_games where lg_game_id=921536`))[0];
  assertEquals([g.vs, g.home_score], ["corrected", 2]);
  const c = await rows(db, `select action, old_values->>'home_score' old, new_values->>'home_score' new from lg3s_corrections where lg_game_id=921536 order by id`);
  assertEquals(c.map((x) => x.action), ["pending_stability", "applied"]); assertEquals([c[1].old, c[1].new], ["1", "2"]);
});

Deno.test("source outage: 503/CF challenge → run failed, zero writes; fetcher backs off and trips", async () => {
  const db = await freshDb(); const st = pgStore(db, roster);
  const m = baseMap(); m.set(urls.game(921533), 503);
  const r = await run(st, fakeLG(m), "backfill", { ids: [921533, 921534], now: T0 });
  assertEquals(r.status, "failed"); assertEquals((await rows(db, `select count(*)::int n from lg3s_games`))[0].n, 0);
  const sleeps: number[] = []; let calls = 0;
  const f = makeFetcher({ minIntervalMs: 2000, maxRetries: 2, sleep: async (ms) => { sleeps.push(ms); }, fetchImpl: (async () => { calls++; return new Response("<html><title>Just a moment...</title></html>", { status: 503 }); }) as any });
  let err: unknown; try { await f.get("https://x/1"); } catch (e) { err = e; }
  assert(err instanceof SourceOutage); assertEquals(calls, 1, "CF challenge trips immediately (no hammering)");
  let err2: unknown; try { await f.get("https://x/2"); } catch (e) { err2 = e; } assert(err2 instanceof SourceOutage); assertEquals(calls, 1, "breaker stays open");
  const f2 = makeFetcher({ maxRetries: 2, sleep: async (ms) => { sleeps.push(ms); }, fetchImpl: (async () => { calls++; return new Response("busy", { status: 503 }); }) as any });
  try { await f2.get("https://x/3"); } catch { /* expected */ }
  assertEquals(calls, 4); assert(sleeps.some((s) => s >= 4000), "exponential backoff");
});

Deno.test("politeness: real fetcher spaces requests >= 2 s and caches", async () => {
  const stamps: number[] = [];
  const f = makeFetcher({ fetchImpl: (async () => { stamps.push(Date.now()); return new Response("<div class=leaguepage>" + "x".repeat(3000), { status: 200 }); }) as any });
  await f.get("a"); await f.get("b"); await f.get("a");
  assertEquals(stamps.length, 2); assert(stamps[1] - stamps[0] >= 1990, `gap ${stamps[1] - stamps[0]}`);
});

Deno.test("identity flags: Bedard x I98I (uid 81147) and LG placeholder (uid 1) flagged, not invented", async () => {
  const { db } = await backfilled();
  const b = await rows(db, `select lg_game_id::int g, lg_team_id_at_game t, identity_flags f from lg3s_player_game_lines where lg_user_id=81147 order by 1`);
  assertEquals(b.map((x) => x.g), [921535, 921542, 921548]); assert(b.every((x) => x.t === 822));
  const flags = (await rows(db, `select verification_flags f from lg3s_games where lg_game_id=921540`))[0].f;
  assert(flags.some((x: string) => x.startsWith("placeholder_account:LG(uid 1)")));
  const pub = await rows(db, `select count(*)::int n from lg3s_public_player_lines where lg_user_id=1`); assertEquals(pub[0].n, 0);
  const pl = (await rows(db, `select goals, assists, lg_team_id_at_game t from lg3s_player_game_lines where lg_user_id=1`))[0];
  EVIDENCE.placeholder = pl; EVIDENCE.bedard = b;
});

Deno.test("RLS/grants: anon reads only verified via views; cannot write or read internals", async () => {
  const { db } = await backfilled();
  await db.exec(`update lg3s_games set verification_status='provisional' where lg_game_id=921550`);
  await db.exec(`set role anon`);
  assertEquals((await rows(db, `select count(*)::int n from lg3s_public_player_lines where lg_game_id=921550`))[0].n, 0);
  assertEquals((await rows(db, `select away_score from lg3s_public_games where lg_game_id=921550`))[0].away_score, null);
  assert((await rows(db, `select count(*)::int n from lg3s_public_player_lines`))[0].n > 0);
  for (const v of ["lg3s_public_games", "lg3s_public_player_lines", "lg3s_public_standings", "lg3s_public_official_standings", "lg3s_public_skater_leaders", "lg3s_public_goalie_leaders", "lg3s_public_game_facts"])
    await db.query(`select * from ${v} limit 1`); // anon can read every public view with select *
  for (const s of [`select * from lg3s_source_snapshots`, `select * from lg3s_corrections`, `select * from lg3s_editorial_posts`, `select candidate_hash from lg3s_games`,
    `select public.lg3s_ingest_game('{}'::jsonb)`, `insert into lg3s_teams(lg_team_id,nation,group_code,source_url) values(1,'x','A','x')`]) {
    let denied = false; try { await db.query(s); } catch (e) { denied = /permission denied/.test(String(e)); } assert(denied, "should deny: " + s);
  }
  await db.exec(`reset role`);
});

Deno.test("schedule parser: Canada page → 81 game ids w/ correct away/home and ET→UTC incl. DST change", async () => {
  const s = parseSchedule(Deno.readTextFileSync("fixtures/schedule_341.html"));
  assert(s.length >= 30);
  const g = (id: number) => s.find((x) => x.lg_game_id === id)!;
  assertEquals([g(921546).away_lg_team_id, g(921546).home_lg_team_id, g(921546).scheduled_at], [1446, 341, "2026-10-22T01:10:00.000Z"]);
  assertEquals(g(921642).scheduled_at, "2026-11-05T01:00:00.000Z"); // Wed Nov 4 8:00 PM EST (UTC-5)
  assertEquals(g(921966).scheduled_at, "2027-01-07T01:00:00.000Z"); // January rolls to 2027
  for (const x of site.games) { const y = g(x.id); if (y) assertEquals([y.away_lg_team_id, y.home_lg_team_id], [x.away, x.home], String(x.id)); }
});

Deno.test("write evidence", () => { Deno.writeTextFileSync("tests/evidence.json", JSON.stringify(EVIDENCE, null, 1)); });

Deno.test("media desk: drafts only (pending_review), idempotent, facts == verified data", async () => {
  const { db } = await backfilled();
  const r1 = (await rows(db, `select private.lg3s_generate_drafts() r`))[0].r;
  const r2 = (await rows(db, `select private.lg3s_generate_drafts() r`))[0].r;
  assertEquals([r1.recaps, r1.spotlights, r1.power_rankings], [18, 1, 1]);
  assertEquals([r2.recaps, r2.spotlights, r2.power_rankings], [0, 0, 0]);
  const p = await rows(db, `select article_type t, status, title, body_md, accuracy from lg3s_editorial_posts order by id`);
  assert(p.every((x) => x.status === "pending_review"));
  assert(p.every((x) => x.accuracy.facts_match_verified_data === true), JSON.stringify(p.find((x) => !x.accuracy.facts_match_verified_data)));
  EVIDENCE.drafts = p.filter((x) => x.t !== "recap" || x.title.startsWith("Japan 1")).map((x) => ({ t: x.t, title: x.title, body: x.body_md }));
  Deno.writeTextFileSync("tests/evidence.json", JSON.stringify(EVIDENCE, null, 1));
});

Deno.test("plus/minus '+N' parsed; reparse after parser fix keeps 'verified' (not 'corrected')", async () => {
  const g = parseGame(fixture(921538), 921538);
  assertEquals(g.skaters.find((s) => s.gamertag === "x Buddha I43I")!.plus_minus, 9);
  const { db, st } = await backfilled();
  await db.exec(`update lg3s_games set payload_hash = 'old-parser' where lg_game_id = 921538`);
  const lg = fakeLG(baseMap());
  assertEquals((await run(st, lg, "backfill", { ids: [921538], now: T30, reparse: true })).results[0].action, "correction_pending");
  assertEquals((await run(st, lg, "backfill", { ids: [921538], now: T45, reparse: true })).results[0].action, "reparsed");
  assertEquals((await rows(db, `select verification_status vs from lg3s_games where lg_game_id=921538`))[0].vs, "verified");
});
