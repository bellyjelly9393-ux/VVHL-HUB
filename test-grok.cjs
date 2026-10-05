const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { requestGrok } = require('./lib/grok-client.cjs');
const handler = require('./api/chelscout-deepthink.js');
const originalFetch = global.fetch, oldKey = process.env.OPENROUTER_API_KEY, oldModel = process.env.GROK_MODEL;
afterEach(() => { global.fetch = originalFetch; for (const [key, value] of [['OPENROUTER_API_KEY', oldKey], ['GROK_MODEL', oldModel]]) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
const response = (body, status = 200) => ({ ok: status === 200, status, text: async () => JSON.stringify(body) });
const answer = { model: 'x-ai/grok-4.7', choices: [{ message: { content: 'Supported plan [E1]', reasoning: 'PRIVATE' }, finish_reason: 'stop' }], usage: { total_tokens: 20 } };
const req = (extra = {}) => ({ method: 'POST', headers: { authorization: 'Bearer manager' }, body: { question: 'Evaluate our team', provider: 'grok', ...extra } });
const res = () => ({ code: 0, setHeader() {}, status(n) { this.code = n; return this; }, json(b) { this.body = b; return this; } });
function fixture({ member = true, saveFails = false, providerStatus = 200, citation = '[E1]' } = {}) {
  const calls = []; process.env.OPENROUTER_API_KEY = 'fixture'; delete process.env.GROK_MODEL;
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    if (url.includes('/auth/v1/user')) return response({ id: 'manager' });
    if (url.includes('team_memberships')) return response(member ? [{ role: 'gm' }] : []);
    if (url.includes('openrouter.ai')) return response(providerStatus === 200 ? { ...answer, choices: [{ message: { content: 'Plan ' + citation } }] } : { error: { message: 'private upstream detail' } }, providerStatus);
    if (url.includes('hitmen_ai_analysis_runs')) return response({}, saveFails ? 500 : 200);
    return response([]);
  }; return calls;
}
test('Grok model, reasoning depth and fixed destination; private reasoning excluded', async () => {
  let sent; const result = await requestGrok({ apiKey: 'test', system: 'hockey', prompt: 'question', mode: 'max', model: 'x-ai/grok-4.7', fetchImpl: async (url, opts) => { sent = { url, opts }; return response(answer); } });
  assert.equal(sent.url, 'https://openrouter.ai/api/v1/chat/completions');
  const body = JSON.parse(sent.opts.body); assert.equal(body.model, 'x-ai/grok-4.7'); assert.equal(body.reasoning.effort, 'xhigh'); assert.equal(body.reasoning.exclude, true);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE/); assert.equal(sent.opts.redirect, 'error');
});
test('missing key and foreign model rejected before paid requests', async () => {
  const fetchImpl = () => { throw Error('must not call'); };
  await assert.rejects(requestGrok({ apiKey: '', fetchImpl }), /OPENROUTER_API_KEY/);
  await assert.rejects(requestGrok({ apiKey: 'key', model: 'other/model', fetchImpl }), /GROK_MODEL/);
});
for (const [status, message] of [[402, /credits/], [401, /permissions/], [429, /rate limited/], [500, /unavailable/]]) {
  test('Grok provider status ' + status + ' gives actionable sanitized error', async () => {
    await assert.rejects(requestGrok({ apiKey: 'key', fetchImpl: async () => response({ error: { message: 'SECRET' } }, status) }), e => message.test(e.message) && !e.message.includes('SECRET'));
  });
}
test('empty, truncated and malformed model output fails', async () => {
  for (const bad of [{ choices: [] }, { choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] }]) {
    await assert.rejects(requestGrok({ apiKey: 'key', fetchImpl: async () => response(bad) }));
  }
  await assert.rejects(requestGrok({ apiKey: 'key', fetchImpl: async () => ({ ok: true, text: async () => '<html>' }) }), /unreadable/);
});
test('Grok is inaccessible to anonymous and non-management callers', async () => {
  const calls = fixture({ member: false }); let r = res();
  await handler({ ...req(), headers: {} }, r); assert.equal(r.code, 401); assert.equal(calls.length, 0);
  r = res(); await handler(req(), r); assert.equal(r.code, 403); assert.ok(!calls.some(c => c.url.includes('openrouter')));
});
test('client cannot choose arbitrary providers or models', async () => {
  const calls = fixture(), r = res(); await handler(req({ provider: 'external' }), r);
  assert.equal(r.code, 400); assert.equal(calls.length, 0);
});
test('Grok gets existing hockey framework and appends a model-labeled history record', async () => {
  const calls = fixture(), r = res(); await handler(req({ mode: 'deep' }), r);
  assert.equal(r.code, 200); assert.equal(r.body.provider, 'grok'); assert.equal(r.body.saved, true);
  const paid = calls.filter(c => c.url.includes('openrouter')); assert.equal(paid.length, 1);
  const body = JSON.parse(paid[0].opts.body); assert.match(body.messages[0].content, /RESULT|result/); assert.equal(body.model, 'x-ai/grok-4.7');
  const saved = JSON.parse(calls.find(c => c.url.includes('hitmen_ai_analysis_runs')).opts.body);
  assert.equal(saved.usage.provider, 'grok'); assert.equal(saved.created_by, 'manager'); assert.deepEqual(saved.evidence_ids, ['E1']);
  assert.ok(calls.filter(c => c.opts?.method === 'POST').every(c => /openrouter|hitmen_ai_analysis_runs/.test(c.url)));
});
test('Grok failure and fabricated citations never save or silently call Claude', async () => {
  for (const options of [{ providerStatus: 500 }, { citation: '[E999]' }]) {
    const calls = fixture(options), r = res(); await handler(req(), r); assert.equal(r.code, 502);
    assert.equal(calls.filter(c => c.url.includes('openrouter')).length, 1);
    assert.ok(!calls.some(c => c.url.includes('hitmen_ai_analysis_runs')));
  }
});
test('unsaved answer is explicitly marked instead of pretending history succeeded', async () => {
  fixture({ saveFails: true }); const r = res(); await handler(req(), r);
  assert.equal(r.code, 200); assert.equal(r.body.saved, false); assert.ok(r.body.coverage.warnings.some(w => w.includes('could not be saved')));
});
test('requests without provider still select the existing Claude model', async () => {
  const calls = fixture(), r = res(), input = req(); delete input.body.provider;
  await handler(input, r); assert.equal(r.code, 200); assert.equal(r.body.provider, 'claude');
  assert.equal(JSON.parse(calls.find(c => c.url.includes('openrouter')).opts.body).model, process.env.CLAUDE_MODEL || 'anthropic/claude-opus-5.5');
});
