import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const TEAM_ID = "b0bcbdda-da9d-419d-8f61-b34937966d49";
const ALLOWED_TYPES = new Set(["roster","weekly_lines","transactions","game","box_score","schedule","stats","unknown"]);
const MANAGER_ROLES = new Set(["owner","gm","agm"]);
const CALGARY_TEAM_ID = TEAM_ID;
const LG_HOST = /(^|\.)leaguegaming\.com$/i;
const MAX_BODY_CHARS = 2_000_000;

function cors(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const allowed = origin === "https://wildmanhockey-elitechelmedia.app" ||
    /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin) ||
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "https://wildmanhockey-elitechelmedia.app",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function decode(s = "") {
  return String(s)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}
function clean(s = "") {
  return decode(String(s).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function sanitizeHtml(raw = "") {
  let s = String(raw).slice(0, 1_500_000);
  s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, " ")
    .replace(/<textarea\b[^>]*>[\s\S]*?<\/textarea>/gi, " ")
    .replace(/<(?:input|button|select|option|meta|link)\b[^>]*>/gi, " ")
    .replace(/<form\b[^>]*>/gi, "<div>")
    .replace(/<\/form>/gi, "</div>")
    .replace(/\s(?:value|name|nonce|data-csrf|data-token|data-auth|autocomplete|on[a-z]+)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  return s;
}

function safeUrl(raw: string) {
  const u = new URL(String(raw || ""));
  if (u.protocol !== "https:" || !LG_HOST.test(u.hostname)) throw new Error("Only LeagueGaming HTTPS pages are accepted.");
  u.username = ""; u.password = ""; u.hash = "";
  const keep = new Set(["leaguegaming/league","action","page","leagueid","seasonid","teamid","gameid","userid","user_id","week","games"]);
  for (const k of [...u.searchParams.keys()]) if (!keep.has(k)) u.searchParams.delete(k);
  return u.toString();
}

const PAGE_TYPES: Record<string,string> = {
  roster: "roster",
  game: "game",
  league_game_edit_log: "box_score",
  team_page_schedule: "schedule",
  team_page: "schedule",
  schedule: "schedule",
  player_stats: "stats",
  player_stats_advanced: "stats",
  standings: "stats",
};

function inferType(source: URL, supplied: string, title: string) {
  const page = String(source.searchParams.get("page") || "").toLowerCase();
  if (PAGE_TYPES[page]) return PAGE_TYPES[page];
  if (ALLOWED_TYPES.has(supplied) && supplied !== "unknown" && supplied !== "roster") return supplied;
  // Only the page id and title are trusted here, never body text (site navigation mentions every page type).
  const hay = (page + " " + title).toLowerCase();
  if (/weekly\s*lines|weekly_lines|lineup/.test(hay)) return "weekly_lines";
  if (/transaction|trade/.test(hay)) return "transactions";
  return "unknown";
}

const TEAM_ALIASES: Record<string,string> = {
  "Chicoutimi Sagueneens": "Chicoutimi Saguenéens",
  "Tri City Americans": "Tri-City Americans",
};

function parseRosters(html: string) {
  const players: any[] = [];
  for (const table of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const body = table[1];
    const sourceTeam = clean(
      body.match(/<th\b[^>]*>([\s\S]*?)<\/th>/i)?.[1] ||
      body.match(/class=["'][^"']*(?:team|header)[^"']*["'][^>]*>([\s\S]*?)<\//i)?.[1] ||
      ""
    );
    const team = TEAM_ALIASES[sourceTeam] || sourceTeam;
    if (!team) continue;
    let rosterRole = "Active";
    for (const row of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const label = clean(row[1]);
      if (/training camp/i.test(label)) rosterRole = "Training Camp";
      const links = [...row[1].matchAll(/<a\b[^>]*href=["']([^"']*(?:userid|user_id)=(\d+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)];
      const link = links.find(a => /page=team_user(?:&|&amp;|$)/.test(a[1]) && clean(a[3])) ||
        links.find(a => !/team_user_pk/.test(a[1]) && clean(a[3]));
      if (!link) continue;
      if (!/^\d+\./.test(label) && !/\b(LW|RW|LD|RD|C|G)\b/.test(label)) continue;
      const amount = label.match(/\b([\d.]+)\s*(M|K)\b/i);
      players.push({
        uid: Number(link[2]),
        name: clean(link[3]),
        team,
        source_team: sourceTeam,
        position: label.match(/\b(LW|RW|LD|RD|C|G)\b/)?.[1] || null,
        salary: amount ? Math.round(Number(amount[1]) * (amount[2].toUpperCase() === "M" ? 1000000 : 1000)) : null,
        management_role: /\bOwner\b/i.test(label) || /class=["'][^"']*\bbadge\b[^"']*["'][^>]*>\s*O\s*</i.test(row[1])
          ? "Owner" : /\bAGM\b/i.test(label) ? "AGM" : /\bGM\b/i.test(label) ? "GM" : null,
        roster_role: /training camp|\btc\b/i.test(label) ? "Training Camp" : rosterRole,
      });
    }
  }
  return [...new Map(players.map(p => [p.team + "|" + p.uid, p])).values()];
}


// ---- LG Public Log (page=league_game_edit_log) box scores ----
const LG_STAT_KEYS = new Set(["points","goals","assists","toi","puckpos","hits","pim","plusminus","pass_att","pass_com","deflections","interceptions","pk_clear","shots","shot_att","bs","giveaway","takeaway","gwg","ppg","shg","fow","fol","pendrawn","class","ecu","sog","savep","ga","sa","gaa","pchk","dsv","brks","bap","psp","gso_p"]);
const int = (v: unknown) => { const m = String(v ?? "").match(/-?\d+/); return m ? Number(m[0]) : null; };
const pimMinutes = (v: unknown) => { const t = String(v ?? "").trim(); return t.includes(":") ? int(t.split(":")[0]) : int(t); };

export function parsePublicLog(raw: string) {
  const text = String(raw || "").replace(/\r/g, "").trim();
  const lines = text.split(/\n+/).map(x => x.trim()).filter(Boolean);
  const lower = lines.map(x => x.toLowerCase());
  const userStart = lower.findIndex(x => x === "user stats");
  const teamStart = lower.findIndex(x => x === "team stats");
  const periodStart = lower.findIndex((x, i) => i > teamStart && x === "period stats");
  if (teamStart < 0) throw new Error("This is not a LeagueGaming Public Log (Team Stats section missing).");
  const teamEnd = periodStart > teamStart ? periodStart : lines.length;
  const teamLines = lines.slice(teamStart + 1, teamEnd).slice(0, 400);
  const scores: number[] = [];
  for (let i = 0; i < teamLines.length - 1; i++) {
    if (teamLines[i].toLowerCase() === "goals" && /^-?\d+$/.test(teamLines[i + 1])) scores.push(Number(teamLines[i + 1]));
  }
  if (scores.length < 2) for (const m of teamLines.join(" ").matchAll(/\bgoals\s+(-?\d+)\b/gi)) scores.push(Number(m[1]));
  if (scores.length < 2) throw new Error("Public Log found, but both team goal totals were not readable.");

  const players: any[] = [];
  if (userStart >= 0 && teamStart > userStart) {
    const seg = lines.slice(userStart + 1, teamStart);
    let current: any = null;
    for (let i = 0; i < seg.length; i++) {
      const line = seg[i], key = line.toLowerCase(), next = (seg[i + 1] || "").toLowerCase();
      if (["user","stat","save index"].includes(key) || /^save #?\d+$/i.test(line)) continue;
      if (!LG_STAT_KEYS.has(key) && next === "points") { current = { gamertag: line.slice(0, 100), raw: {} }; players.push(current); continue; }
      if (current && LG_STAT_KEYS.has(key) && i + 1 < seg.length) { current.raw[key] = seg[i + 1].slice(0, 40); i++; }
    }
  }
  const mapped = players.slice(0, 40).map(p => {
    const s = p.raw;
    const shotsAgainst = int(s.sa), goalsAgainst = int(s.ga);
    return {
      gamertag: p.gamertag, raw: s,
      goals: int(s.goals), assists: int(s.assists), points: int(s.points), plus_minus: int(s.plusminus),
      shots: int(s.shots ?? s.sog), hits: int(s.hits), pim: pimMinutes(s.pim),
      takeaways: int(s.takeaway), giveaways: int(s.giveaway), interceptions: int(s.interceptions), blocked_shots: int(s.bs),
      faceoff_wins: int(s.fow), faceoff_losses: int(s.fol), pass_attempts: int(s.pass_att), pass_completions: int(s.pass_com),
      ppg: int(s.ppg), shg: int(s.shg), gwg: int(s.gwg),
      shots_against: shotsAgainst, goals_against: goalsAgainst,
      saves: shotsAgainst != null && goalsAgainst != null ? shotsAgainst - goalsAgainst : null,
    };
  });
  const periodLines = periodStart > 0 ? lines.slice(periodStart + 1, periodStart + 200) : [];
  const saved = [...text.matchAll(/20\d{2}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/g)].at(-1)?.[0] || null;
  return { scores: scores.slice(0, 2), players: mapped, teamLines, periodLines, saved };
}

async function sha256(value: string) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json(req, { error: "Sign in to Wildman management first." }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const token = authHeader.slice(7);
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return json(req, { error: "Invalid Wildman session." }, 401);
  const userId = userData.user.id;

  const [{ data: profile }, { data: memberships }] = await Promise.all([
    admin.from("profiles").select("role").eq("id", userId).maybeSingle(),
    admin.from("team_memberships").select("team_id,role,active").eq("user_id", userId).eq("active", true),
  ]);
  const profileRole = String(profile?.role || "").toLowerCase();
  const allowed = profileRole === "admin" || profileRole === "commissioner" ||
    (memberships || []).some((m: any) => m.team_id === CALGARY_TEAM_ID && MANAGER_ROLES.has(String(m.role || "").toLowerCase()));
  if (!allowed) return json(req, { error: "Calgary Owner, GM, AGM, Commissioner or Admin access is required." }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json(req, { error: "Invalid capture payload." }, 400); }
  const serialized = JSON.stringify(body || {});
  if (serialized.length > MAX_BODY_CHARS) return json(req, { error: "LG capture is too large." }, 413);

  let sourceUrl: string;
  try { sourceUrl = safeUrl(String(body?.sourceUrl || "")); }
  catch (e) { return json(req, { error: String((e as Error).message || e) }, 400); }

  const source = new URL(sourceUrl);
  const safeHtml = sanitizeHtml(body?.html || "");
  const safeText = String(body?.text || clean(safeHtml)).slice(0, 400_000);
  const sourceTitle = String(body?.sourceTitle || "LeagueGaming").slice(0, 300);
  const captureType = inferType(source, String(body?.captureType || "unknown"), sourceTitle);
  const capturedAtRaw = String(body?.capturedAt || "");
  const capturedAt = Number.isFinite(Date.parse(capturedAtRaw)) ? new Date(capturedAtRaw).toISOString() : new Date().toISOString();
  const leagueId = Number(source.searchParams.get("leagueid") || body?.leagueId || 39);
  const season = Number(source.searchParams.get("seasonid") || body?.season || 55);
  const league = ({37:"LGHL",38:"LGAHL",39:"LGCHL",84:"LGECHL",112:"LGNCAA"} as Record<number,string>)[leagueId] || ("LG" + leagueId);
  const tables = Array.isArray(body?.tables) ? body.tables.slice(0, 120) : [];
  const digest = await sha256(captureType + "\n" + sourceUrl + "\n" + safeHtml + "\n" + safeText.slice(0, 100000));

  const payload = { html: safeHtml, text: safeText, tables, league_id: leagueId, season };
  let snapshotId: string;
  const inserted = await admin.from("lg_auth_snapshots").insert({
    captured_by: userId,
    // Public Logs are stored under the existing 'game' snapshot type; parsed.kind records the box score.
    capture_type: captureType === "box_score" ? "game" : captureType, league, season,
    source_url: sourceUrl, source_title: sourceTitle, captured_at: capturedAt,
    source_hash: digest, payload, parse_status: "captured",
  }).select("id").single();

  if (inserted.error) {
    if (inserted.error.code === "23505") {
      const { data: old } = await admin.from("lg_auth_snapshots").select("id,parse_status,parse_error,parsed,created_at").eq("source_hash", digest).maybeSingle();
      // An identical capture that failed before still fails; report the original reason instead of "ok".
      if (old?.parse_status === "error") return json(req, { error: old.parse_error || "This exact capture failed before.", captureType, duplicate: true }, 422);
      return json(req, { ok: true, duplicate: true, captureType, parsed: old?.parsed, snapshot: old });
    }
    return json(req, { error: "Could not store LG capture.", detail: inserted.error.message }, 500);
  }
  snapshotId = inserted.data.id;

  try {
    if (captureType === "roster") {
      const rows = parseRosters(safeHtml);
      const teams = new Set(rows.map((r:any) => r.team));
      if (rows.length < 50 || teams.size < 20) throw new Error(`Roster capture incomplete: ${rows.length} players across ${teams.size} teams. Open the full league Roster page and sync again.`);
      const { data: applied, error } = await admin.rpc("lg_apply_authenticated_roster_capture", {
        p_rows: rows,
        p_as_of: capturedAt,
        p_snapshot_id: snapshotId,
        p_league: league,
        p_season: season,
      });
      if (error) throw error;
      const parsed = { rows: rows.length, teams: teams.size, ...applied };
      await admin.from("lg_auth_snapshots").update({ parse_status: "parsed", parsed }).eq("id", snapshotId);
      return json(req, { ok: true, captureType, snapshotId, league, season, parsed,
        note: "Authenticated roster applied. Roster moves are candidates for review, not automatically labeled as official trades." });
    }

    if (captureType === "box_score") {
      const gameId = Number(source.searchParams.get("gameid") || 0);
      if (!Number.isSafeInteger(gameId) || gameId <= 0) throw new Error("Public Log URL has no LG game id.");
      const log = parsePublicLog(safeText);
      const { data: applied, error } = await admin.rpc("lg_apply_box_score", {
        p_snapshot_id: snapshotId, p_lg_game_id: gameId, p_scores: log.scores, p_players: log.players,
        p_team_stats: log.teamLines, p_period_stats: log.periodLines, p_saved_at: log.saved, p_captured_at: capturedAt,
      });
      if (error) throw error;
      await admin.from("lg_auth_snapshots").update({ parse_status: "parsed", parsed: { kind: "box_score", ...applied } }).eq("id", snapshotId);
      return json(req, { ok: true, captureType, snapshotId, league, season, parsed: applied,
        note: "Box score verified against the official LGCHL final and saved." });
    }

    const parsed = {
      staged: true,
      tables: tables.length,
      text_chars: safeText.length,
      note: captureType === "weekly_lines"
        ? "Weekly Lines captured safely. Normalized lineup parsing awaits a verified LG Weekly Lines sample."
        : captureType === "transactions"
          ? "Transaction page captured safely. Changes are staged for review; no trade type is auto-assigned from unverified text."
          : "Authenticated LeagueGaming page captured for downstream parsing."
    };
    await admin.from("lg_auth_snapshots").update({ parse_status: "partial", parsed }).eq("id", snapshotId);
    return json(req, { ok: true, captureType, snapshotId, league, season, parsed });
  } catch (e) {
    const message = String((e as Error)?.message || e).slice(0, 800);
    await admin.from("lg_auth_snapshots").update({ parse_status: "error", parse_error: message }).eq("id", snapshotId);
    return json(req, { error: message, captureType, snapshotId }, 422);
  }
});
