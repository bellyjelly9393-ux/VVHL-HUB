// Schema validation + fact-check for Threes Bot outputs. Pure; no I/O.
export type Feature = "daily_three" | "trio_power_rankings" | "duo_index" | "roster_wire" | "pick3_preview" | "pick3_recap";
export const FEATURES: Feature[] = ["daily_three", "trio_power_rankings", "duo_index", "roster_wire", "pick3_preview", "pick3_recap"];
type J = any;

const GRADES = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "F"];
const BANNED = /\b(sync(ed|ing|s)?|database|scrap(e|er|ed|ing)|feed|supabase|api|leaguegaming|data source|json)\b/i;
// nations that are NOT in this league; mentioning them means invention
const FOREIGN = ["Finland", "Czechia", "Czech Republic", "Russia", "Denmark", "Norway", "Austria", "France", "Slovenia", "Belarus", "Hungary"];

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const sentences = (s: string) => (s.trim().match(/[^.!?]+[.!?]+(["')\]]+)?/g) ?? [s]).filter((x) => x.trim().length > 1).length;

function leaves(x: J, strs: Set<string>, nums: Set<string>) {
  if (x === null || x === undefined) return;
  if (typeof x === "number") { addNum(nums, x); return; }
  if (typeof x === "string") { strs.add(x); for (const m of x.matchAll(/[+-]?\d+(\.\d+)?/g)) addNum(nums, Number(m[0])); return; }
  if (Array.isArray(x)) { x.forEach((v) => leaves(v, strs, nums)); return; }
  if (typeof x === "object") Object.values(x).forEach((v) => leaves(v, strs, nums));
}
function addNum(nums: Set<string>, n: number) { nums.add(String(Math.abs(n))); nums.add(Math.abs(n).toFixed(2).replace(/\.?0+$/, "")); }

export interface Check { ok: boolean; reasons: string[]; checked: Record<string, number> }

export function validate(feature: Feature, out: J, feed: J): Check {
  const r: string[] = []; const checked: Record<string, number> = { names: 0, numbers: 0, strings: 0 };
  const fail = (m: string) => r.push(m);
  if (!out || typeof out !== "object" || Array.isArray(out)) return { ok: false, reasons: ["output is not a JSON object"], checked };
  if ("error" in out) {
    if (Object.keys(out).length !== 1 || typeof out.error !== "string") fail("error output must be exactly {\"error\": string}");
    if (!feed?.insufficient) fail("model returned error but feed has data");
    return { ok: r.length === 0, reasons: r, checked };
  }
  if (feed?.insufficient) fail("feed is insufficient but output is not {\"error\"}");

  const fs = new Set<string>(), fn = new Set<string>(); leaves(feed, fs, fn);
  const name = (v: J, where: string) => { checked.names++; if (typeof v !== "string" || !fs.has(v)) fail(`${where}: "${v}" not found in feed`); };
  const str = (v: J, where: string, opt: { max?: number; words?: [number, number]; sentences?: [number, number] } = {}) => {
    checked.strings++;
    if (typeof v !== "string" || !v.trim()) { fail(`${where}: missing text`); return; }
    if (opt.max && v.length >= opt.max) fail(`${where}: ${v.length} chars (limit <${opt.max})`);
    if (opt.words) { const w = words(v); if (w < opt.words[0] || w > opt.words[1]) fail(`${where}: ${w} words (want ${opt.words[0]}-${opt.words[1]})`); }
    if (opt.sentences) { const s = sentences(v); if (s < opt.sentences[0] || s > opt.sentences[1]) fail(`${where}: ${s} sentences (want ${opt.sentences[0]}-${opt.sentences[1]})`); }
    if (BANNED.test(v)) fail(`${where}: mentions data source/plumbing ("${v.match(BANNED)![0]}")`);
    for (const f of FOREIGN) if (new RegExp(`\\b${f}\\b`).test(v)) fail(`${where}: mentions non-league team "${f}"`);
    for (const m of v.matchAll(/[+-]?\d+(\.\d+)?/g)) { checked.numbers++; if (!fn.has(String(Math.abs(Number(m[0])))) && !fn.has(Math.abs(Number(m[0])).toFixed(2).replace(/\.?0+$/, ""))) fail(`${where}: number ${m[0]} not in feed`); }
  };
  const eq = (a: J, b: J, where: string) => { checked.numbers++; if (JSON.stringify(a) !== JSON.stringify(b)) fail(`${where}: ${JSON.stringify(a)} != feed ${JSON.stringify(b)}`); };
  const keys = (o: J, ks: string[], where: string) => { if (!o || typeof o !== "object") { fail(`${where}: missing object`); return false; } for (const k of ks) if (!(k in o)) fail(`${where}.${k}: missing`); for (const k of Object.keys(o)) if (!ks.includes(k)) fail(`${where}.${k}: unexpected key`); return true; };
  const arr = (v: J, where: string) => { if (!Array.isArray(v)) { fail(`${where}: not an array`); return []; } return v; };

  if (feature === "daily_three") {
    keys(out, ["date", "tagline", "items"], "$"); eq(out.date, feed.date, "date");
    str(out.tagline, "tagline", { words: [1, 11] });
    const it = arr(out.items, "items"); if (it.length !== 3) fail(`items: ${it.length} (want 3)`);
    const slots = ["performer", "stat", "storyline"];
    it.forEach((x: J, i: number) => {
      const w = `items[${i}]`; if (x?.slot !== slots[i]) fail(`${w}.slot: "${x?.slot}" (want ${slots[i]})`);
      str(x.headline, w + ".headline", { max: 70 }); str(x.blurb, w + ".blurb", { sentences: [2, 3] });
      if (x.slot === "performer") { keys(x, ["slot", "headline", "blurb", "player", "team", "stat_line"], w); name(x.player, w + ".player"); name(x.team, w + ".team");
        const p = (feed.top_performers ?? []).find((q: J) => q.player === x.player); if (!p) fail(`${w}.player not in top_performers`); else { eq(x.team, p.team, w + ".team"); eq(x.stat_line, p.stat_line, w + ".stat_line"); } }
      if (x.slot === "stat") { keys(x, ["slot", "headline", "blurb", "stat_value", "subject"], w); name(x.subject, w + ".subject"); str(String(x.stat_value), w + ".stat_value"); }
      if (x.slot === "storyline") { keys(x, ["slot", "headline", "blurb", "teams", "players"], w); arr(x.teams, w + ".teams").forEach((t: J, j: number) => name(t, `${w}.teams[${j}]`)); arr(x.players, w + ".players").forEach((t: J, j: number) => name(t, `${w}.players[${j}]`)); }
    });
  }
  if (feature === "trio_power_rankings") {
    keys(out, ["week_label", "rankings", "riser", "faller"], "$"); eq(out.week_label, feed.week_label, "week_label");
    const rk = arr(out.rankings, "rankings"); const teams = feed.teams ?? [];
    if (rk.length !== teams.length) fail(`rankings: ${rk.length} teams (want ${teams.length})`);
    eq(rk.map((x: J) => x.rank), teams.map((_: J, i: number) => i + 1), "rankings[].rank sequence");
    const seen = new Set<string>();
    rk.forEach((x: J, i: number) => {
      const w = `rankings[${i}]`; keys(x, ["rank", "team", "last_rank", "movement", "record", "trio_grade", "vibe", "take", "key_players"], w);
      const t = teams.find((q: J) => q.team === x.team); if (!t) { fail(`${w}.team "${x.team}" not in feed`); return; }
      if (seen.has(x.team)) fail(`${w}.team duplicated`); seen.add(x.team);
      eq(x.record, t.record, w + ".record"); eq(x.last_rank ?? null, t.last_rank ?? null, w + ".last_rank");
      const mv = t.last_rank == null ? "new" : x.rank < t.last_rank ? "up" : x.rank > t.last_rank ? "down" : "same"; eq(x.movement, mv, w + ".movement");
      if (!GRADES.includes(x.trio_grade)) fail(`${w}.trio_grade "${x.trio_grade}" invalid`);
      str(x.vibe, w + ".vibe", { words: [3, 5] }); str(x.take, w + ".take", { sentences: [2, 2] });
      const tp = new Set((t.top_players ?? []).map((p: J) => p.player));
      const kp = arr(x.key_players, w + ".key_players"); if (!kp.length) fail(`${w}.key_players empty`);
      kp.forEach((p: J) => { checked.names++; if (!tp.has(p)) fail(`${w}.key_players "${p}" not a top player of ${x.team}`); });
      if (![...tp].some((p) => typeof x.take === "string" && x.take.includes(p as string))) fail(`${w}.take names no player from ${x.team}`);
    });
    for (const k of ["riser", "faller"]) { if (keys(out[k], ["team", "note"], k)) { name(out[k].team, k + ".team"); str(out[k].note, k + ".note"); } }
  }
  if (feature === "duo_index") {
    keys(out, ["week_label", "top_duos", "odd_couple", "needs_counseling"], "$"); eq(out.week_label, feed.week_label, "week_label");
    const d = arr(out.top_duos, "top_duos"); if (d.length !== (feed.top_duos ?? []).length) fail(`top_duos: ${d.length} (feed ${feed.top_duos?.length})`);
    d.forEach((x: J, i: number) => { const f = feed.top_duos?.[i] ?? {}, w = `top_duos[${i}]`;
      keys(x, ["rank", "players", "team", "nickname", "games_together", "record_together", "goal_diff_per_game", "points_per_game", "breakdown"], w);
      for (const k of ["rank", "players", "team", "games_together", "record_together", "goal_diff_per_game", "points_per_game"]) eq(x[k], f[k], `${w}.${k}`);
      str(x.nickname, w + ".nickname", { max: 70 }); str(x.breakdown, w + ".breakdown"); });
    const teamsOf = new Set(d.map((x: J) => x.team)); if (teamsOf.size !== d.length) fail("top_duos: more than one pair per team");
    for (const [k, c] of [["odd_couple", "odd_couple_candidates"], ["needs_counseling", "needs_counseling_candidates"]]) {
      if (keys(out[k], ["players", "team", "note"], k)) { const ok = (feed[c] ?? []).some((q: J) => JSON.stringify(q.players) === JSON.stringify(out[k].players) && q.team === out[k].team); if (!ok) fail(`${k}: pair not in ${c}`); str(out[k].note, k + ".note"); } }
  }
  if (feature === "roster_wire") {
    keys(out, ["updated_label", "moves", "quiet_note"], "$"); eq(out.updated_label, feed.updated_label, "updated_label");
    const m = arr(out.moves, "moves"); if (m.length !== (feed.moves ?? []).length) fail(`moves: ${m.length} (feed ${feed.moves?.length})`);
    m.forEach((x: J, i: number) => { const w = `moves[${i}]`; keys(x, ["date", "type", "players", "from_team", "to_team", "ticker", "is_big_move", "impact", "hot_take", "winner"], w);
      const f = (feed.moves ?? []).find((q: J) => JSON.stringify(q.players) === JSON.stringify(x.players) && q.type === x.type);
      if (!f) fail(`${w}: move not in feed`); else for (const k of ["date", "from_team", "to_team"]) eq(x[k], f[k], `${w}.${k}`);
      str(x.ticker, w + ".ticker", { max: 100 }); str(x.hot_take, w + ".hot_take");
      if (!["Blockbuster", "Big", "Depth"].includes(x.impact)) fail(`${w}.impact invalid`); if (x.is_big_move !== (x.impact !== "Depth")) fail(`${w}.is_big_move inconsistent with impact`);
      if (x.winner !== "TBD" && ![x.from_team, x.to_team].includes(x.winner)) fail(`${w}.winner not a team in the move`); });
    for (let i = 1; i < m.length; i++) if (m[i - 1].date < m[i].date) fail("moves not newest first");
    if (m.length === 0) str(out.quiet_note, "quiet_note", { sentences: [1, 2] });
  }
  if (feature === "pick3_preview") {
    keys(out, ["week_label", "intro", "players"], "$"); eq(out.week_label, feed.week_label, "week_label"); str(out.intro, "intro");
    const p = arr(out.players, "players"); if (!p.length) fail("players empty");
    p.forEach((x: J, i: number) => { const w = `players[${i}]`; keys(x, ["player", "team", "price", "opponents", "is_value_pick", "note"], w);
      const f = (feed.players ?? []).find((q: J) => q.player === x.player); if (!f) { fail(`${w}.player "${x.player}" not in feed`); return; }
      for (const k of ["team", "price", "opponents", "is_value_pick"]) eq(x[k], f[k], `${w}.${k}`);
      if (x.price < 4 || x.price > 15) fail(`${w}.price out of $4-15`); str(x.note, w + ".note"); });
  }
  if (feature === "pick3_recap") fail("pick3_recap requires site-scored results (not built)");
  return { ok: r.length === 0, reasons: r, checked };
}

/** Parse model text to JSON (strict: whole text must be one object, tolerate ```json fences). */
export function parseModelJson(text: string): { ok: true; value: J } | { ok: false; reason: string } {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { const v = JSON.parse(t); return { ok: true, value: v }; } catch (e) { return { ok: false, reason: "model output is not valid JSON: " + (e as Error).message }; }
}

export function titleFor(feature: Feature, out: J, period: string): string {
  if (out?.error) return `${feature} ${period}: ${out.error}`.slice(0, 200);
  if (feature === "daily_three") return `Daily Three — ${out.date}: ${out.tagline}`;
  if (feature === "trio_power_rankings") return `Trio Power Rankings — ${out.week_label}`;
  if (feature === "duo_index") return `Duo Index — ${out.week_label}`;
  if (feature === "roster_wire") return `Roster Wire — ${out.updated_label}`;
  if (feature === "pick3_preview") return `Pick Your 3 — ${out.week_label} prices`;
  return `${feature} ${period}`;
}
