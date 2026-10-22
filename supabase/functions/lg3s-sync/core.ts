import { parseGame, parseSchedule, parseStandings, ParseError } from "./parse.ts";
import { verifyGame, sha256, PLACEHOLDER_USER_IDS } from "./verify.ts";
import { urls, SourceOutage } from "./fetcher.ts";

export interface Store {
  snapshot(s: { kind: string; source_id: string; url: string; http_status: number; sha256: string; payload_hash?: string | null; bytes: number; parse_error?: string | null }): Promise<number>;
  rpc(fn: "lg3s_ingest_game" | "lg3s_upsert_schedule", args: Record<string, unknown>): Promise<any>;
  standings(rows: Record<string, unknown>[]): Promise<void>;
  pendingGameIds(nowIso: string, lookaheadMin: number, maxAgeDays: number): Promise<number[]>; // scheduled_at <= now+lookahead, not verified/corrected
  recentVerifiedIds(days: number): Promise<number[]>;
  teamIds(): Promise<number[]>;
  rosterUserIds?(): Promise<Set<number>>;
}
type Fetcher = { get(url: string): Promise<{ status: number; body: string; fromCache: boolean }> };

export async function buildPayload(html: string, id: number, roster?: Set<number>) {
  const g = parseGame(html, id);
  const v = await verifyGame(g, { rosterUserIds: roster });
  const lines = [
    ...g.skaters.map((s) => ({ ...s, is_placeholder: s.lg_user_id != null && PLACEHOLDER_USER_IDS.has(s.lg_user_id) })),
    ...g.goalies.map((x) => ({ ...x, is_placeholder: x.lg_user_id != null && PLACEHOLDER_USER_IDS.has(x.lg_user_id) })),
  ];
  return { parsed: g, verification: v, payload: {
    lg_game_id: id, scheduled_at: g.scheduled_at, away_lg_team_id: g.away_lg_team_id, home_lg_team_id: g.home_lg_team_id, is_final: g.is_final,
    away_score: g.away_score, home_score: g.home_score, decided_in: v.decided_in,
    period_stats: g.periods.every((p) => p.goals.every((x) => x === 0)) && (g.away_score ?? 0) + (g.home_score ?? 0) > 0 ? null : g.periods,
    team_stats: g.team_stats, checks: v.checks, flags: v.flags, passed: v.passed, payload_hash: v.payload_hash, source_url: urls.game(id), lines } };
}

export async function syncGame(store: Store, f: Fetcher, id: number, roster?: Set<number>, now?: string, reparse = false) {
  const url = urls.game(id);
  const r = await f.get(url);
  const raw = await sha256(r.body);
  try {
    const { payload, verification } = await buildPayload(r.body, id, roster);
    const snap = await store.snapshot({ kind: "game", source_id: String(id), url, http_status: r.status, sha256: raw, payload_hash: verification.payload_hash, bytes: r.body.length });
    const res = await store.rpc("lg3s_ingest_game", { p: { ...payload, snapshot_id: snap, ...(now ? { now } : {}), ...(reparse ? { reparse: true } : {}) } });
    return { id, ...res, passed: verification.passed, flags: verification.flags };
  } catch (e) {
    if (!(e instanceof ParseError)) throw e;
    await store.snapshot({ kind: "game", source_id: String(id), url, http_status: r.status, sha256: raw, bytes: r.body.length, parse_error: `${e.code}: ${e.message}` });
    return { id, action: "parse_error", error: e.code }; // no write to lg3s_games: invalid pages never touch stored data
  }
}

export async function syncSchedule(store: Store, f: Fetcher) {
  const all = new Map<number, ReturnType<typeof parseSchedule>[number]>();
  const conflicts: string[] = [];
  for (const t of await store.teamIds()) {
    const r = await f.get(urls.schedule(t));
    for (const g of parseSchedule(r.body)) {
      const prev = all.get(g.lg_game_id);
      if (prev && (prev.away_lg_team_id !== g.away_lg_team_id || prev.home_lg_team_id !== g.home_lg_team_id || prev.scheduled_at !== g.scheduled_at)) conflicts.push(String(g.lg_game_id));
      all.set(g.lg_game_id, g);
    }
  }
  const games = [...all.values()].filter((g) => !conflicts.includes(String(g.lg_game_id))).map((g) => ({ ...g, source_url: urls.game(g.lg_game_id) }));
  const changes = await store.rpc("lg3s_upsert_schedule", { p_games: games });
  return { games: games.length, conflicts, changes };
}

export async function syncStandings(store: Store, f: Fetcher) {
  const r = await f.get(urls.standings());
  const rows = parseStandings(r.body);
  const hash = await sha256(JSON.stringify(rows));
  await store.standings(rows.map((x) => ({ source: "lg_official", group_code: x.group, lg_team_id: x.lg_team_id, rank: x.rank, gp: x.gp, w: x.w, l: x.l, otw: x.otw, otl: x.otl, pts: x.pts, gf: x.gf, ga: x.ga, gd: x.gd, streak: x.streak, source_url: urls.standings(), payload_hash: hash })));
  return { rows: rows.length, hash };
}

/** mode: schedule | gamenight | sweep | backfill */
export async function run(store: Store, f: Fetcher, mode: string, opts: { ids?: number[]; now?: string; reparse?: boolean } = {}) {
  const out: any = { mode, results: [], errors: [] };
  const roster = await store.rosterUserIds?.();
  try {
    if (mode === "schedule") out.schedule = await syncSchedule(store, f);
    let ids: number[] = [];
    if (mode === "backfill") ids = opts.ids ?? [];
    if (mode === "gamenight" || mode === "sweep") ids = await store.pendingGameIds(opts.now ?? new Date().toISOString(), 15, 7);
    if (mode === "sweep") ids = [...new Set([...ids, ...(await store.recentVerifiedIds(7))])];
    for (const id of ids) out.results.push(await syncGame(store, f, id, roster, opts.now, opts.reparse === true && mode === "backfill"));
    if (mode !== "backfill" || ids.length) out.standings = await syncStandings(store, f);
  } catch (e) {
    if (e instanceof SourceOutage) out.errors.push({ outage: e.message, status: e.status }); else out.errors.push({ error: String(e) });
  }
  out.status = out.errors.length ? (out.results.length ? "partial" : "failed") : "ok";
  return out;
}
