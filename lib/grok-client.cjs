'use strict';

const DEFAULT_MODEL = 'x-ai/grok-4.7';
const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const fail = (status, message) => Object.assign(new Error(message), { status });

async function requestGrok({ system, prompt, mode = 'deep', apiKey = process.env.OPENROUTER_API_KEY,
  model = process.env.GROK_MODEL || DEFAULT_MODEL, fetchImpl = global.fetch }) {
  if (!apiKey) throw fail(503, 'Set OPENROUTER_API_KEY securely before using Grok.');
  if (!/^x-ai\/grok-[a-z0-9.:-]+$/.test(model)) throw fail(503, 'GROK_MODEL must name an x-ai/grok model on OpenRouter.');
  if (!['quick', 'deep', 'max'].includes(mode)) throw fail(400, 'Invalid Grok analysis depth.');
  const effort = mode === 'max' ? 'xhigh' : mode === 'deep' ? 'high' : 'low';
  let r;
  try {
    r = await fetchImpl(ENDPOINT, {
      method: 'POST', redirect: 'error',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json',
        'HTTP-Referer': 'https://wildmanhockey-elitechelmedia.app', 'X-Title': 'Wildman Hockey · Grok' },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
        reasoning: { effort, exclude: true }, temperature: 0.15,
        max_tokens: mode === 'max' ? 15000 : mode === 'deep' ? 10000 : 5500 }),
      signal: AbortSignal.timeout(108000)
    });
  } catch (e) {
    throw fail(502, e.name === 'TimeoutError' ? 'Grok timed out. Narrow the question and retry.' : 'Unable to reach Grok through OpenRouter.');
  }
  let data;
  try { data = JSON.parse(await r.text()); } catch { throw fail(502, 'Grok returned an unreadable response.'); }
  if (!r.ok || data?.error) {
    if (r.status === 429) throw fail(429, 'Grok is rate limited. Wait briefly and retry.');
    if (r.status === 402) throw fail(503, 'OpenRouter credits are required for Grok. Check the connected OpenRouter account.');
    if ([401, 403].includes(r.status)) throw fail(503, 'The server OpenRouter key cannot access Grok. Check its model permissions.');
    throw fail(502, 'Grok is unavailable through OpenRouter. Retry or select Claude.');
  }
  const choice = data?.choices?.[0], answer = choice?.message?.content;
  if (choice?.finish_reason === 'length') throw fail(502, 'Grok reached its output limit. Narrow the question and retry.');
  if (typeof answer !== 'string' || !answer.trim()) throw fail(502, 'Grok returned no usable answer.');
  if (data.model && !String(data.model).startsWith('x-ai/')) throw fail(502, 'OpenRouter returned an unexpected model for Grok.');
  return { answer, model: data.model || model, usage: data.usage || {}, effort, provider: 'grok' };
}

module.exports = { requestGrok, DEFAULT_MODEL, ENDPOINT };
