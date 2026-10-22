// lg3s-threes-bot: feed (SQL, verified views) -> LLM (base + feature prompt) -> validate + fact-check -> store draft. Never publishes.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { validate, parseModelJson, titleFor, FEATURES, type Feature } from "./validate.ts";

const LLM_ENV = ["OPENROUTER_API_KEY", "XAI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GROK_MODEL"];
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });

async function callLLM(system: string, user: string, want?: string): Promise<{ text: string; model: string; usage: unknown } | { unavailable: string }> {
  const key = Deno.env.get("OPENROUTER_API_KEY");
  if (!key) return { unavailable: "OPENROUTER_API_KEY is not set on this Supabase project (it exists only on the Vercel server)" };
  const model = want || Deno.env.get("GROK_MODEL") || "x-ai/grok-4.7";
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", redirect: "error",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json", "X-Title": "Elitechel Media · Threes Bot" },
    body: JSON.stringify({ model, messages: [{ role: "system", content: system }, { role: "user", content: user }], temperature: 0.4, max_tokens: 6000,
      response_format: { type: "json_object" }, usage: { include: true } }), signal: AbortSignal.timeout(110000) });
  const d = await r.json().catch(() => null);
  if (!r.ok || !d?.choices?.[0]?.message?.content) throw new Error(`LLM HTTP ${r.status} (${model}): ${String(d?.error?.message ?? "").slice(0, 200)}`);
  return { text: d.choices[0].message.content, model: d.model || model, usage: d.usage ?? null };
}

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const tok = req.headers.get("x-sync-token");
  const { data: s } = await sb.from("lg_sync_settings").select("value").eq("key", "sync_token").maybeSingle();
  if (!tok || !s?.value || tok !== s.value) return json({ error: "unauthorized" }, 401);
  const body = await req.json().catch(() => ({}));
  if (body.mode === "diag") return json({ llm_env_present: Object.fromEntries(LLM_ENV.map((k) => [k, !!Deno.env.get(k)])) });

  const feature = body.feature as Feature, period = String(body.period ?? "");
  if (!FEATURES.includes(feature) || !period) return json({ error: "feature/period required" }, 400);
  const { data: feed, error: fe } = await sb.rpc("lg3s_threes_feed", { p_feature: feature, p_period: period });
  if (fe) return json({ error: fe.message }, 500);
  const { data: pr } = await sb.rpc("lg3s_threes_prompt", { p_feature: feature });
  const version = pr?.version ?? null;
  const key = period + (/^#[a-z0-9_-]{1,20}$/.test(String(body.store_key_suffix ?? "")) ? String(body.store_key_suffix) : "");
  const store = (o: Record<string, unknown>) => sb.rpc("lg3s_store_threes", { p: { feature, period_key: key, prompt_version: version, feed,
      source_game_ids: feed?.source_game_ids ?? [], week: /W(\d+)/.exec(period)?.[1] ?? null,
      game_night_date: feature === "daily_three" ? period : null, ...o } });

  // 1) model text: live LLM, or (test only) a supplied candidate that goes through the exact same checks
  let text: string, generator: string, usage: unknown = null;
  if (typeof body.candidate_text === "string") { text = body.candidate_text; generator = String(body.candidate_label ?? "supplied-candidate"); }
  else {
    const user = `FEED:\n${JSON.stringify(feed)}`;
    try {
      const models = [body.model, body.fallback_model].filter((m) => typeof m === "string" && m) as string[];
      let r: Awaited<ReturnType<typeof callLLM>> | null = null; const errs: string[] = [];
      for (const m of models.length ? models : [undefined as unknown as string]) { try { r = await callLLM(`${pr?.base}\n\n${pr?.feature}`, user, m); break; } catch (e) { errs.push((e as Error).message); } }
      if (!r) throw new Error(errs.join(" | "));
      if ("unavailable" in r) { const { data } = await store({ status: "llm_unavailable", reasons: [r.unavailable], generator: "openrouter" }); return json({ status: "llm_unavailable", reason: r.unavailable, run: data }); }
      text = r.text; generator = `openrouter:${r.model}`; usage = r.usage;
    } catch (e) { const { data } = await store({ status: "failed", reasons: [(e as Error).message], generator: "openrouter" }); return json({ status: "failed", run: data }, 502); }
  }
  // 2) parse + validate + fact-check
  const p = parseModelJson(text);
  const chk = p.ok ? validate(feature, p.value, feed) : { ok: false, reasons: [p.reason], checked: {} };
  const out = p.ok ? p.value : { raw: text.slice(0, 4000) };
  const isErr = p.ok && out && typeof out === "object" && "error" in out;
  const status = isErr && chk.ok ? "error_output" : chk.ok ? "pending_review" : "needs_review";
  const { data, error } = await store({ status, reasons: chk.reasons, generator, output: out, checks: { ...chk, prompt_version: version, base_version: pr?.base_version, usage },
    title: titleFor(feature, out, period), body_md: "```json\n" + JSON.stringify(out, null, 2) + "\n```" });
  if (error) return json({ error: error.message }, 500);
  return json({ status, reasons: chk.reasons, checked: chk.checked, run: data, prompt_version: version, generator, period_key: key, usage, output: out });
});
