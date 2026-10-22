import { PGlite } from "npm:@electric-sql/pglite@0.2";
import type { Store } from "../../supabase/functions/lg3s-sync/core.ts";
export const RAW = "/workspace/lg3s-audit/raw";
export const IDS = Array.from({ length: 18 }, (_, i) => 921533 + i);
export const fixture = (id: number) => Deno.readTextFileSync(`${RAW}/lg_game_${id}.html`);

export async function freshDb() {
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create schema if not exists private;`);
  // Only the LG3S migrations. This repo's supabase/migrations directory also contains
  // LGCHL and Hitmen SQL that calls pg_cron / pg_net, which this isolated suite does not apply.
  for (const f of [...Deno.readDirSync("supabase/migrations")].map((e) => e.name).sort()) {
    if (!/^202610221[357]/.test(f)) continue;
    await db.exec(Deno.readTextFileSync(`supabase/migrations/${f}`));
  }
  await db.exec(`grant usage on schema public to anon, authenticated, service_role; grant all on all tables in schema public to service_role;`);
  return db;
}
export function pgStore(db: PGlite, roster?: Set<number>): Store {
  const q = async (s: string, p: unknown[] = []) => (await db.query<any>(s, p)).rows;
  return {
    async snapshot(s) { return (await q(`insert into lg3s_source_snapshots(kind,source_id,url,http_status,sha256,payload_hash,bytes,parse_error) values($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [s.kind, s.source_id, s.url, s.http_status, s.sha256, s.payload_hash ?? null, s.bytes, s.parse_error ?? null]))[0].id; },
    async rpc(fn, args) { const [k] = Object.keys(args); return (await q(`select public.${fn}($1::jsonb) r`, [JSON.stringify(args[k])]))[0].r; },
    async standings(rows) { for (const r of rows) await q(`insert into lg3s_standings_snapshots(source,group_code,lg_team_id,rank,gp,w,l,otw,otl,pts,gf,ga,gd,streak,source_url,payload_hash) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      ["source", "group_code", "lg_team_id", "rank", "gp", "w", "l", "otw", "otl", "pts", "gf", "ga", "gd", "streak", "source_url", "payload_hash"].map((k) => (r as any)[k])); },
    async pendingGameIds(now, look, days) { return (await q(`select lg_game_id from lg3s_games where scheduled_at <= $1::timestamptz + make_interval(mins=>$2) and scheduled_at >= $1::timestamptz - make_interval(days=>$3) and verification_status not in ('verified','corrected') order by scheduled_at`, [now, look, days])).map((r) => Number(r.lg_game_id)); },
    async recentVerifiedIds() { return (await q(`select lg_game_id from lg3s_games where verification_status in ('verified','corrected')`)).map((r) => Number(r.lg_game_id)); },
    async teamIds() { return (await q(`select lg_team_id from lg3s_teams order by 1`)).map((r) => r.lg_team_id); },
    rosterUserIds: roster ? async () => roster : undefined,
  };
}
/** Fake LG: url -> html (mutable), records request count; never touches the network. */
export function fakeLG(map: Map<string, string | number>) {
  let n = 0;
  return { n: () => n, get: async (url: string) => { n++; const v = map.get(url); if (v === undefined) throw new Error("unmapped " + url); if (typeof v === "number") { const { SourceOutage } = await import("../../supabase/functions/lg3s-sync/fetcher.ts"); throw new SourceOutage(v, `HTTP ${v}`); } return { status: 200, body: v, fromCache: false }; } };
}
