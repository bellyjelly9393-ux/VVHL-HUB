// Integrity checks for one parsed LG3S game. Pure; the DB RPC enforces the state machine.
import type { ParsedGame } from "./parse.ts";

export const PLACEHOLDER_USER_IDS = new Set([1]); // LG system account "LG" (observed 921540, ECU badge)
export type Check = { id: string; ok: boolean; blocking: boolean; detail: string };
export type Verification = { checks: Check[]; passed: boolean; flags: string[]; decided_in: "REG" | "OT" | "SO" | null; payload_hash: string; canonical: unknown };

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

export async function sha256(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** Canonical, ordering-stable payload; hash of this (not raw HTML) drives the stability window. */
export function canonical(g: ParsedGame) {
  const sk = [...g.skaters].sort((a, b) => (a.lg_team_id - b.lg_team_id) || ((a.lg_user_id ?? 0) - (b.lg_user_id ?? 0)) || a.gamertag.localeCompare(b.gamertag));
  const gl = [...g.goalies].sort((a, b) => ((a.lg_team_id ?? 0) - (b.lg_team_id ?? 0)) || ((a.lg_user_id ?? 0) - (b.lg_user_id ?? 0)));
  return { id: g.lg_game_id, st: g.status_text, a: g.away_lg_team_id, h: g.home_lg_team_id, as: g.away_score, hs: g.home_score, at: g.scheduled_at,
    p: g.periods.map((p) => [p.lg_team_id, p.goals]), sk: sk.map((s) => [s.lg_team_id, s.lg_user_id, s.gamertag, s.position, s.g, s.a, s.p, s.plus_minus, s.shots, s.toi_s, s.hits]),
    gl: gl.map((x) => [x.lg_team_id, x.lg_user_id, x.gamertag, x.shots_against, x.goals_against, x.saves]) };
}

export async function verifyGame(g: ParsedGame, opts: { rosterUserIds?: Set<number>; expectedTeams?: [number, number] } = {}): Promise<Verification> {
  const C: Check[] = []; const F: string[] = [];
  const add = (id: string, ok: boolean, detail: string, blocking = true) => C.push({ id, ok, blocking, detail });
  const sides = [g.away_lg_team_id, g.home_lg_team_id]; const score = [g.away_score, g.home_score];

  add("status_final", g.is_final, `status="${g.status_text}"`);
  add("scores_present", score.every((s) => Number.isInteger(s)), `score=${score.join("-")}`);
  if (opts.expectedTeams) add("teams_match_schedule", opts.expectedTeams[0] === sides[0] && opts.expectedTeams[1] === sides[1], `page ${sides} vs schedule ${opts.expectedTeams}`);

  // period scores
  let periodsLen = 0;
  sides.forEach((t, i) => {
    const p = g.periods.find((x) => x.lg_team_id === t);
    if (p) periodsLen = Math.max(periodsLen, p.goals.length);
    // Observed on LG (921537, 921540): period table all zeros while final/box score are complete.
    // That is "period data unavailable" (non-blocking flag), NOT a contradiction. Any non-zero mismatch blocks.
    const allZero = !!p && p.goals.every((x) => x === 0) && (score[i] ?? 0) > 0;
    if (allZero) { F.push(`period_stats_unavailable:${t}`); add(`period_sum_${t}`, true, `periods all 0 on source; final ${score[i]} (flagged)`, false); return; }
    const ok = !!p && p.goals.length >= 3 && p.goals.every(Number.isInteger) && sum(p.goals) === score[i];
    add(`period_sum_${t}`, ok, p ? `periods ${p.goals.join("-")} vs ${score[i]}` : "no period row");
  });
  const decided_in = periodsLen === 3 ? "REG" : periodsLen > 3 ? "OT" : null; // SO not yet observed on LG3S; treat >3 cols as OT/SO -> review
  if (periodsLen > 3) F.push("overtime_or_shootout_review");

  // team stats
  sides.forEach((t, i) => add(`teamstats_goals_${t}`, g.team_stats[t]?.goals === score[i], `team-stats goals ${g.team_stats[t]?.goals} vs ${score[i]}`));

  // skaters
  sides.forEach((t, i) => {
    const sk = g.skaters.filter((s) => s.lg_team_id === t);
    add(`skater_count_${t}`, sk.length >= 3, `${sk.length} skaters`);
    add(`skater_numbers_${t}`, sk.every((s) => [s.g, s.a, s.p].every((n) => Number.isInteger(n) && n >= 0) && s.p === s.g + s.a), "G/A/P integers and P=G+A");
    const G = sum(sk.map((s) => s.g)), A = sum(sk.map((s) => s.a));
    add(`skater_goals_eq_score_${t}`, G === score[i], `ΣG=${G} vs ${score[i]}`);
    add(`assists_consistent_${t}`, A <= 2 * G, `ΣA=${A} ≤ 2×ΣG=${2 * G}`);
    const sog = sk.map((s) => s.shots); const ts = g.team_stats[t]?.total_shots;
    if (sog.every((x) => x != null) && typeof ts === "number") add(`skater_sog_eq_team_shots_${t}`, sum(sog as number[]) === ts, `ΣSOG=${sum(sog as number[])} vs team ${ts}`, false);
    for (const s of sk) {
      if (s.lg_user_id == null) { F.push(`missing_id:${s.gamertag}@${t}`); add(`identity_${t}_${s.gamertag}`, false, "skater row has no LG userid"); }
      else if (PLACEHOLDER_USER_IDS.has(s.lg_user_id)) {
        F.push(`placeholder_account:${s.gamertag}(uid ${s.lg_user_id})@${t}`);
        add(`placeholder_no_points_${t}`, s.g === 0 && s.a === 0, `placeholder line ${s.gamertag} G${s.g} A${s.a}`);
      } else if (opts.rosterUserIds && !opts.rosterUserIds.has(s.lg_user_id)) F.push(`not_in_roster_snapshot:${s.gamertag}(uid ${s.lg_user_id})@${t}`);
      for (const f of s.flags) F.push(`${f}:${s.gamertag}`);
      if (s.flags.some((f) => f.startsWith("crest_team_mismatch"))) add(`crest_${s.lg_user_id}`, false, "row crest disagrees with team section");
    }
  });
  // duplicate player rows in one game
  const keys = g.skaters.map((s) => `${s.lg_user_id ?? s.gamertag}`); add("no_duplicate_skaters", new Set(keys).size === keys.length, `${keys.length} rows`);

  // goalies: credited by row crest; GA vs opponent score; SA vs opponent shots
  add("goalies_resolved", g.goalies.length >= 2 && g.goalies.every((x) => x.lg_team_id != null && x.lg_user_id != null), `${g.goalies.length} goalie rows`);
  sides.forEach((t, i) => {
    const gl = g.goalies.filter((x) => x.lg_team_id === t); const opp = score[1 - i] ?? NaN; const oppShots = g.team_stats[sides[1 - i]]?.total_shots;
    add(`goalie_present_${t}`, gl.length >= 1, `${gl.length} goalie(s)`);
    add(`goalie_sv_math_${t}`, gl.every((x) => x.saves === x.shots_against - x.goals_against && x.saves >= 0), "SV = SA − GA");
    const GA = sum(gl.map((x) => x.goals_against)), SA = sum(gl.map((x) => x.shots_against));
    if (GA === opp) add(`goalie_ga_eq_opp_${t}`, true, `ΣGA=${GA} = opp ${opp}`);
    else if (GA < opp) { add(`goalie_ga_eq_opp_${t}`, true, `ΣGA=${GA} < opp ${opp} (empty-net exception)`, false); F.push(`empty_net_exception:${t}:${opp - GA}`); }
    else add(`goalie_ga_eq_opp_${t}`, false, `ΣGA=${GA} > opp ${opp}`);
    if (typeof oppShots === "number") add(`goalie_sa_eq_opp_shots_${t}`, SA === oppShots || (GA < opp && SA <= oppShots), `ΣSA=${SA} vs opp shots ${oppShots}`);
  });

  const canon = canonical(g);
  return { checks: C, passed: C.every((c) => c.ok || !c.blocking), flags: [...new Set(F)], decided_in, payload_hash: await sha256(JSON.stringify(canon)), canonical: canon };
}

/** Standings computed ONLY from verified games. Points: regulation W=2 per LG table (W×2=PTS observed);
 * OTW/OTL points are NOT assumed — returned null and flagged until LG publishes/an OT game confirms it. */
export function computeStandings(games: { away: number; home: number; as: number; hs: number; decided_in: string | null }[], teams: number[]) {
  const t = new Map(teams.map((id) => [id, { lg_team_id: id, gp: 0, w: 0, l: 0, otw: 0, otl: 0, gf: 0, ga: 0, pts: 0 as number | null }]));
  for (const g of games) {
    const A = t.get(g.away)!, H = t.get(g.home)!; const ot = g.decided_in && g.decided_in !== "REG";
    A.gp++; H.gp++; A.gf += g.as; A.ga += g.hs; H.gf += g.hs; H.ga += g.as;
    const [win, lose] = g.as > g.hs ? [A, H] : [H, A];
    if (ot) { win.otw++; lose.otl++; } else { win.w++; lose.l++; }
  }
  for (const r of t.values()) r.pts = r.otw || r.otl ? null : r.w * 2;
  return [...t.values()];
}
