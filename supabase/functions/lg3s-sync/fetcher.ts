// Polite LG fetcher: >= 2 s between requests (global), identifiable UA, in-run cache, retry w/ exponential backoff,
// circuit-breaker on Cloudflare challenge / 403 / 429 / 5xx so an outage never produces writes.
export const LG_BASE = "https://www.leaguegaming.com/forums/index.php?leaguegaming/league";
export const urls = {
  game: (id: number) => `${LG_BASE}&action=league&page=game&gameid=${id}`,
  schedule: (teamId: number) => `${LG_BASE}&action=league_page&page=team_page_schedule&teamid=${teamId}&leagueid=154&seasonid=1`,
  standings: () => `${LG_BASE}&action=league&page=standing&leagueid=154&seasonid=1`,
};
export type FetchResult = { url: string; status: number; body: string; fromCache: boolean };
export class SourceOutage extends Error { constructor(public status: number, msg: string) { super(msg); } }

export function makeFetcher(opts: { minIntervalMs?: number; maxRetries?: number; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; maxRequests?: number } = {}) {
  const min = opts.minIntervalMs ?? 2000, maxRetries = opts.maxRetries ?? 3, f = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const cache = new Map<string, FetchResult>(); let last = 0; let requests = 0; let tripped: SourceOutage | null = null;
  async function get(url: string): Promise<FetchResult> {
    if (cache.has(url)) return { ...cache.get(url)!, fromCache: true };
    if (tripped) throw tripped;
    for (let attempt = 0; ; attempt++) {
      if (opts.maxRequests && requests >= opts.maxRequests) throw new SourceOutage(0, "request budget exhausted");
      const wait = last + min - Date.now(); if (wait > 0) await sleep(wait);
      last = Date.now(); requests++;
      let status = 0, body = "";
      try {
        const r = await f(url, { headers: { "user-agent": "ECM-LG3S-sync/1.0 (+https://wildmanhockey-elitechelmedia.app; polite <=1 req/2s)", accept: "text/html" }, signal: AbortSignal.timeout(20000) });
        status = r.status; body = await r.text();
      } catch (e) { status = 0; body = String(e); }
      const challenge = /<title>\s*(Just a moment|Attention Required)|cf-mitigated|_cf_chl_opt/i.test(body) && !/leaguepage|Regular Season/.test(body);
      if (status === 200 && !challenge) { const res = { url, status, body, fromCache: false }; cache.set(url, res); return res; }
      const retryable = status === 0 || status === 429 || status >= 500;
      if (!retryable || attempt >= maxRetries || challenge) { tripped = new SourceOutage(status, challenge ? "cloudflare challenge" : `HTTP ${status}`); throw tripped; }
      await sleep(Math.min(60000, 2000 * 2 ** attempt) + Math.floor(Math.random() * 500));
    }
  }
  return { get, stats: () => ({ requests, cached: cache.size, tripped: tripped?.message ?? null }) };
}
