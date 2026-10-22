// lg3s-sync — isolated LG3S ingestion. Invoked by pg_cron via private.lg3s_kick_sync(mode)
// with the same x-sync-token header pattern used by lgchl-league-sync (token read from DB, never logged).
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { run, type Store } from "./core.ts";
import { makeFetcher } from "./fetcher.ts";

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });

function supabaseStore(db: any): Store {
  const must = (r: { data: any; error: any }): any => { if (r.error) throw new Error(r.error.message); return r.data; };
  return {
    async snapshot(s) { return must(await db.from("lg3s_source_snapshots").insert(s).select("id").single()).id; },
    async rpc(fn, args) { return must(await db.rpc(fn, args)); },
    async standings(rows) { must(await db.from("lg3s_standings_snapshots").insert(rows)); },
    async pendingGameIds(now, look, days) {
      const hi = new Date(Date.parse(now) + look * 60000).toISOString(), lo = new Date(Date.parse(now) - days * 86400000).toISOString();
      return must(await db.from("lg3s_games").select("lg_game_id").lte("scheduled_at", hi).gte("scheduled_at", lo)
        .not("verification_status", "in", "(verified,corrected)").not("status", "in", "(postponed,cancelled)").order("scheduled_at").limit(40)).map((r: any) => r.lg_game_id);
    },
    async recentVerifiedIds(days) {
      return must(await db.from("lg3s_games").select("lg_game_id").in("verification_status", ["verified", "corrected"])
        .gte("scheduled_at", new Date(Date.now() - days * 86400000).toISOString()).limit(60)).map((r: any) => r.lg_game_id);
    },
    async teamIds() { return must(await db.from("lg3s_teams").select("lg_team_id")).map((r: any) => r.lg_team_id); },
  };
}

Deno.serve(async (req) => {
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: cfg } = await db.from("lg_sync_settings").select("value").eq("key", "sync_token").maybeSingle();
  if (!cfg?.value || req.headers.get("x-sync-token") !== cfg.value) return json({ error: "unauthorized" }, 401);
  const body = await req.json().catch(() => ({}));
  const mode = String(body.mode ?? "gamenight");
  if (!["schedule", "gamenight", "sweep", "backfill"].includes(mode)) return json({ error: "bad mode" }, 400);
  const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter((n: number) => Number.isSafeInteger(n) && n >= 921000 && n < 930000).slice(0, 40) : undefined;

  // single-flight: skip if a run started < 15 min ago is still running
  const { data: running } = await db.from("lg3s_sync_runs").select("id").eq("status", "running").gte("started_at", new Date(Date.now() - 15 * 60000).toISOString()).limit(1);
  if (running?.length) return json({ skipped: "run in progress" });
  await db.from("lg3s_sync_runs").update({ status: "failed", finished_at: new Date().toISOString(), errors: [{ error: "stalled" }] }).eq("status", "running");
  const { data: runRow } = await db.from("lg3s_sync_runs").insert({ mode }).select("id").single();

  const fetcher = makeFetcher({ minIntervalMs: 2000, maxRequests: 45 });
  const out = await run(supabaseStore(db), fetcher, mode, { ids, reparse: body.reparse === true });
  const st = fetcher.stats();
  await db.from("lg3s_sync_runs").update({ status: out.status, finished_at: new Date().toISOString(), requests: st.requests, games_checked: out.results.length,
    changes: out.results.filter((r: any) => !["unchanged"].includes(r.action)), errors: out.errors }).eq("id", runRow?.id);
  return json({ run: runRow?.id, ...out, fetch: st });
});
