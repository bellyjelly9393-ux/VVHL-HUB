// LG3S (LeagueGaming leagueid=154) public HTML parsers. Pure functions, no I/O.
// Attribution rule: every player/goalie line is credited to the team shown IN THAT GAME's
// box score (team_bar section + row crest), never via roster lookup.
export const LEAGUE_ID = 154;
export const SEASON_ID = 1;
export const LG_TZ = "America/New_York"; // verified: EA submit stamps ~25 min after listed start

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export const clean = (s: unknown) =>
  String(s ?? "").replace(/<[^>]*>/g, " ")
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
      e[0] === "#" ? String.fromCodePoint(parseInt(e.slice(e[1].toLowerCase() === "x" ? 2 : 1), e[1].toLowerCase() === "x" ? 16 : 10)) : ENT[e.toLowerCase()] ?? m)
    .replace(/\s+/g, " ").trim();
const int = (s: string): number | null => { const t = clean(s).replace(/,/g, "").replace(/^\+/, ""); return /^-?\d+$/.test(t) ? Number(t) : null; };
const num = (s: string): number | null => { const t = clean(s).replace(/[,%]/g, ""); return /^-?\d*\.?\d+$/.test(t) ? Number(t) : null; };
const mmss = (s: string): number | null => { const m = /^(\d+):([0-5]\d)$/.exec(clean(s)); return m ? +m[1] * 60 + +m[2] : null; };

type Cell = { html: string; tag: string };
type Table = { rows: { cls: string; cells: Cell[] }[]; html: string };
export function tables(html: string): Table[] {
  const out: Table[] = []; const stack: Table[] = [];
  const src = html.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  let cell: Cell | null = null;
  for (const tok of src.match(/<[^>]+>|[^<]+/g) || []) {
    const cur = stack[stack.length - 1];
    if (/^<table\b/i.test(tok)) { if (cell) cell.html += tok; stack.push({ rows: [], html: "" }); cell = null; continue; }
    if (/^<\/table/i.test(tok)) { const t = stack.pop(); if (t) out.push(t); cell = null; continue; }
    if (!cur) continue;
    cur.html += tok;
    if (stack.length > 1) { /* nested */ }
    let m;
    if ((m = /^<tr\b([^>]*)>/i.exec(tok))) { cur.rows.push({ cls: (/class\s*=\s*"([^"]*)"/i.exec(m[1])?.[1] ?? "").trim(), cells: [] }); cell = null; continue; }
    if (/^<\/tr/i.test(tok)) { cell = null; continue; }
    if ((m = /^<(td|th)\b/i.exec(tok))) { if (!cur.rows.length) cur.rows.push({ cls: "", cells: [] }); cell = { html: tok, tag: m[1].toLowerCase() }; cur.rows[cur.rows.length - 1].cells.push(cell); continue; }
    if (/^<\/(td|th)/i.test(tok)) { cell = null; continue; }
    if (cell) cell.html += tok;
  }
  return out;
}

/** Convert LG wall-clock (Eastern) to a UTC ISO string, DST-safe. */
export function etToUtc(y: number, mo: number, d: number, h: number, mi: number): string {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const off = (t: number) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: LG_TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - t;
  };
  let t = guess - off(guess); t = guess - off(t);
  return new Date(t).toISOString();
}
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const to24 = (h: number, ap: string) => (ap.toLowerCase() === "pm" ? (h % 12) + 12 : h % 12);
/** Season 1 starts Oct 2026; Jan–Aug dates belong to 2027. */
export const seasonYear = (month: number, startYear = 2026) => (month >= 9 ? startYear : startYear + 1);

export class ParseError extends Error { constructor(public code: string, msg: string) { super(msg); } }

export function assertRealPage(html: string) {
  if (!html || html.length < 2000) throw new ParseError("empty", "Empty or truncated page");
  if (/<title>\s*(Just a moment|Attention Required)|_cf_chl_opt|cf-mitigated/i.test(html) && !/leaguepage|Regular Season|team_box_icon/.test(html)) throw new ParseError("challenge", "Cloudflare challenge page");
  if (/name=["']password/i.test(html) && !/Player Stats|Goalie Stats|Regular Season/i.test(html)) throw new ParseError("login", "Login wall");
}

// ---------------- schedule ----------------
export type ScheduledGame = { lg_game_id: number; away_lg_team_id: number; home_lg_team_id: number; scheduled_at: string; et_label: string; listed_score: [number, number] | null };
export function parseSchedule(html: string, startYear = 2026): ScheduledGame[] {
  assertRealPage(html);
  if (!/leagueid=154/.test(html)) throw new ParseError("wrong_league", "Not an LG3S page");
  const out = new Map<number, ScheduledGame>();
  for (const t of tables(html)) for (const r of t.rows) {
    const h = r.cells.map((c) => c.html).join(" ");
    const g = /page=game&(?:amp;)?gameid=(\d+)/.exec(h); if (!g) continue;
    const teams = [...h.matchAll(/teamid=(\d+)&(?:amp;)?leagueid=154/g)].map((m) => +m[1]);
    const dm = /(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w* (\w{3}) (\d{1,2}) (\d{1,2}):(\d\d)\s*([ap]m)/i.exec(clean(h));
    if (teams.length !== 2 || !dm) throw new ParseError("schedule_row", `Unrecognized schedule row for game ${g[1]}`);
    const mo = MONTHS.indexOf(dm[2].toLowerCase()) + 1;
    const sc = /(\d+)\s+vs\s+(\d+)/.exec(clean(h));
    out.set(+g[1], { lg_game_id: +g[1], away_lg_team_id: teams[0], home_lg_team_id: teams[1], et_label: dm[0],
      scheduled_at: etToUtc(seasonYear(mo, startYear), mo, +dm[3], to24(+dm[4], dm[6]), +dm[5]), listed_score: sc ? [+sc[1], +sc[2]] : null });
  }
  return [...out.values()].sort((a, b) => a.lg_game_id - b.lg_game_id);
}

// ---------------- standings ----------------
export type StandingRow = { group: string; rank: number; lg_team_id: number; gp: number; w: number; l: number; otw: number; otl: number; pts: number; streak: string; gf: number; ga: number; gd: number; forfeit: boolean };
export function parseStandings(html: string): StandingRow[] {
  assertRealPage(html);
  const out: StandingRow[] = [];
  for (const t of tables(html)) {
    const grp = /Group\s+([A-Z])/.exec(clean(t.rows[0]?.cells[0]?.html ?? ""))?.[1]; if (!grp) continue;
    const hdr = t.rows[1]?.cells.map((c) => clean(c.html)) ?? [];
    const want = ["GP", "W", "L", "OTW", "OTL", "PTS", "STK", "F", "A", "GD"];
    if (want.some((k, i) => hdr[i] !== k)) continue; // other group-labelled widgets on the page
    for (const r of t.rows.slice(2)) {
      const id = /teamid=(\d+)/.exec(r.cells[0]?.html ?? "")?.[1]; if (!id) continue;
      const v = r.cells.slice(1).map((c) => clean(c.html));
      out.push({ group: grp, rank: int(/(\d+)\)/.exec(clean(r.cells[0].html))?.[1] ?? "") ?? 0, lg_team_id: +id, gp: +v[0], w: +v[1], l: +v[2], otw: +v[3], otl: +v[4], pts: +v[5], streak: v[6], gf: +v[7], ga: +v[8], gd: +v[9], forfeit: /ff_team/.test(r.cells[0].html) });
    }
  }
  if (out.length !== 12 || new Set(out.map((r) => r.lg_team_id)).size !== 12) throw new ParseError("standings_layout", `Expected 12 unique teams, got ${out.length}`);
  return out;
}

// ---------------- game ----------------
export type SkaterLine = { kind: "skater"; lg_user_id: number | null; gamertag: string; position: string | null; lg_team_id: number; crest_team_id: number | null;
  g: number; a: number; p: number; plus_minus: number | null; toi_s: number | null; shots: number | null; shot_attempts: number | null; hits: number | null; takeaways: number | null; giveaways: number | null; blocks: number | null; interceptions: number | null; pim_s: number | null; pass_pct: number | null; flags: string[] };
export type GoalieLine = { kind: "goalie"; lg_user_id: number | null; gamertag: string; position: "G"; lg_team_id: number | null; crest_team_id: number | null;
  shots_against: number; save_pct: number | null; goals_against: number; saves: number; gaa: number | null; flags: string[] };
export type ParsedGame = {
  lg_game_id: number; status_text: string; is_final: boolean; away_lg_team_id: number; home_lg_team_id: number;
  away_score: number | null; home_score: number | null; scheduled_at: string | null; et_label: string | null;
  periods: { lg_team_id: number; goals: number[] }[]; team_stats: Record<number, Record<string, number | string | null>>;
  skaters: SkaterLine[]; goalies: GoalieLine[]; ea_results: { periods: string; submitted_by: string; submitted_et: string }[]; parse_warnings: string[];
};

export function parseGame(html: string, expectedId: number): ParsedGame {
  assertRealPage(html);
  const W: string[] = [];
  const ids = new Set([...html.matchAll(/gameid=(\d+)/g)].map((m) => +m[1]));
  if (!ids.has(expectedId)) throw new ParseError("identity", `Page does not reference game ${expectedId}`);
  if (!/leagueid=154/.test(html)) throw new ParseError("wrong_league", "Not an LG3S page");
  const head = /lg_main_header_total_row[\s\S]*?(?=<div class="row lg_main_header_total_row|<table)/.exec(html)?.[0];
  if (!head) throw new ParseError("header", "Game header not found");
  const hTeams = [...head.matchAll(/teamid=(\d+)&(?:amp;)?leagueid=154/g)].map((m) => +m[1]);
  if (hTeams.length < 2) throw new ParseError("header", "Header team ids missing");
  const [away, home] = [hTeams[0], hTeams[hTeams.length - 1]];
  const scores = [...head.matchAll(/class="lg_game_header">\s*(\d*)\s*</g)].map((m) => (m[1] === "" ? null : +m[1]));
  const status = clean(/font-size:40px;?">([^<]*)</.exec(head)?.[1] ?? "");
  const dt = /([A-Z][a-z]+day) ([A-Z][a-z]+) (\d{1,2})\w\w (\d{4}), (\d\d):(\d\d) ([AP]M)/.exec(clean(head));
  const scheduled_at = dt ? etToUtc(+dt[4], MONTHS.indexOf(dt[2].slice(0, 3).toLowerCase()) + 1, +dt[3], to24(+dt[5], dt[7]), +dt[6]) : null;
  const g: ParsedGame = { lg_game_id: expectedId, status_text: status, is_final: /^FINAL\b/i.test(status), away_lg_team_id: away, home_lg_team_id: home,
    away_score: scores[0] ?? null, home_score: scores[1] ?? null, scheduled_at, et_label: dt?.[0] ?? null, periods: [], team_stats: { [away]: {}, [home]: {} }, skaters: [], goalies: [], ea_results: [], parse_warnings: W };
  const sides = [away, home];
  for (const t of tables(html)) {
    const title = clean(t.rows[0]?.cells[0]?.html ?? "");
    if (/^Period Stats/i.test(title)) {
      for (const r of t.rows) {
        const id = /teamid=(\d+)/.exec(r.cells[0]?.html ?? "")?.[1];
        if (id && sides.includes(+id)) g.periods.push({ lg_team_id: +id, goals: r.cells.slice(1).map((c) => int(c.html) ?? NaN) });
      }
    } else if (t.rows.some((r) => r.cells.length === 3 && /^Goals$/i.test(clean(r.cells[1].html)))) {
      for (const r of t.rows) if (r.cells.length === 3) {
        const k = clean(r.cells[1].html).toLowerCase().replace(/[^a-z]/g, "_"); if (!k) continue;
        [0, 2].forEach((i, j) => { const raw = clean(r.cells[i].html); g.team_stats[sides[j]][k] = /^\d+$/.test(raw) ? +raw : raw; });
      }
    } else if (/^Player Stats/i.test(title)) {
      const hdrRow = t.rows.find((r) => r.cls.includes("alt2"));
      const labels = (hdrRow?.cells ?? []).filter((c) => c.tag === "th").map((c) => clean(c.html)).slice(1); // after "Players"
      const need = ["G", "A", "P", "+/-", "TOI", "Shots"]; if (need.some((k) => !labels.includes(k))) throw new ParseError("skater_layout", "Skater header changed: " + labels.join(","));
      let team: number | null = null;
      for (const r of t.rows) {
        const bar = /team_bar(\d+)/.exec(r.cells[0]?.html ?? ""); if (bar) { team = +bar[1]; if (!sides.includes(team)) throw new ParseError("skater_team", `Section team ${team} not in game`); continue; }
        if (r === hdrRow || r.cells.length < 3 + need.length) continue;
        const nameCell = r.cells[2].html;
        const uid = /page=team_user&(?:amp;)?userid=(\d+)/.exec(nameCell)?.[1] ?? /userid=(\d+)/.exec(r.cells[0].html)?.[1];
        const tag = clean(/<a[^>]*team_user[^>]*>([\s\S]*?)<\/a>/.exec(nameCell)?.[1] ?? "") || clean(nameCell).replace(/\(.*$/, "").trim();
        const crest = /team\/p16\/team(\d+)\./.exec(nameCell)?.[1];
        const v = (k: string) => r.cells[3 + labels.indexOf(k)]?.html ?? "";
        if (team == null) throw new ParseError("skater_team", "Skater row before any team section");
        const flags: string[] = [];
        if (!uid) flags.push("missing_lg_user_id");
        if (crest && +crest !== team) flags.push(`crest_team_mismatch:${crest}`);
        const [sog, att] = clean(v("Shots")).split("/").map((x) => int(x));
        const line: SkaterLine = { kind: "skater", lg_user_id: uid ? +uid : null, gamertag: tag, position: /\((LW|C|RW|LD|RD|D|W)\)/.exec(clean(nameCell))?.[1] ?? null, lg_team_id: team, crest_team_id: crest ? +crest : null,
          g: int(v("G")) ?? NaN, a: int(v("A")) ?? NaN, p: int(v("P")) ?? NaN, plus_minus: int(v("+/-")), toi_s: mmss(v("TOI")), shots: sog ?? null, shot_attempts: att ?? null,
          hits: int(v("H")), takeaways: int(v("TA")), giveaways: int(v("GA")), blocks: int(v("BK")), interceptions: int(v("INT")), pim_s: mmss(v("PIM")), pass_pct: num(v("PAS%")), flags };
        g.skaters.push(line);
      }
    } else if (/^Goalie Stats/i.test(title)) {
      const hdrRow = t.rows.find((r) => r.cls.includes("alt2"));
      const labels = (hdrRow?.cells ?? []).map((c) => clean(c.html)).slice(1);
      const need = ["S", "Sv%", "GA", "Sv", "GAA"]; if (need.some((k) => !labels.includes(k))) throw new ParseError("goalie_layout", "Goalie header changed: " + labels.join(","));
      for (const r of t.rows) {
        if (r === hdrRow || r.cells.length < 3 + need.length) continue;
        const nameCell = r.cells[2].html;
        const uid = /page=team_user&(?:amp;)?userid=(\d+)/.exec(nameCell)?.[1];
        const crest = /team\/p16\/team(\d+)\./.exec(nameCell)?.[1];
        const v = (k: string) => r.cells[3 + labels.indexOf(k)]?.html ?? "";
        const flags: string[] = []; if (!uid) flags.push("missing_lg_user_id");
        const team = crest && sides.includes(+crest) ? +crest : null; if (team == null) flags.push("goalie_team_unresolved");
        g.goalies.push({ kind: "goalie", lg_user_id: uid ? +uid : null, gamertag: clean(/<a[^>]*team_user[^>]*>([\s\S]*?)<\/a>/.exec(nameCell)?.[1] ?? ""), position: "G", lg_team_id: team, crest_team_id: crest ? +crest : null,
          shots_against: int(v("S")) ?? NaN, save_pct: num(v("Sv%")), goals_against: int(v("GA")) ?? NaN, saves: int(v("Sv")) ?? NaN, gaa: num(v("GAA")), flags });
      }
    } else if (/^EA Sports API Results/i.test(title)) {
      for (const r of t.rows) if (r.cells.length === 4 && /load_api_game/.test(r.cells[0].html)) g.ea_results.push({ periods: clean(r.cells[1].html), submitted_by: clean(r.cells[2].html), submitted_et: clean(r.cells[3].html) });
    }
  }
  if (g.is_final && !g.skaters.length) W.push("final_without_player_table");
  return g;
}
