const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const fixture = () => {
  const query = { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { id: 'team', name: 'Calgary Hitmen' } }) };
  window.VVHLBackend = { state: { user: { id: 'manager' }, profile: { role: 'admin' }, memberships: [] }, db: { from: () => query, auth: { getSession: async () => ({ data: { session: { access_token: 'test' } } }) } } };
};
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } }), errors = [], requests = [];
      let fail = false, pending = null, defer = false;
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/*', async route => {
        const u = new URL(route.request().url()), name = u.pathname.slice(1);
        if (name === 'api/chelscout-deepthink') {
          const input = route.request().postDataJSON(); requests.push(input);
          assert.equal(route.request().headers().authorization, 'Bearer test');
          const send = () => route.fulfill({ status: fail ? 502 : 200, contentType: 'application/json', body: JSON.stringify(fail ? { error: 'Grok unavailable' } : {
            answer: input.provider + ' supported answer [E1]\n<script>window.bad=true</script>', model: input.provider === 'grok' ? 'x-ai/grok-4.7' : 'anthropic/claude-opus-5.5',
            provider: input.provider, depthMode: 'deep', nextDepth: 'max', lens: 'general', coverage: { evidenceRecords: 1 }, sources: [{ id: 'E1', source: 'Fixture', data: {} }]
          }) });
          if (defer) { pending = send; return; } return send();
        }
        if (name === 'backend.js') return route.fulfill({ contentType: 'application/javascript', body: '(' + fixture.toString() + ')();' });
        if (name.endsWith('.js') && name !== 'hitmen-gm-ai.js') return route.fulfill({ contentType: 'application/javascript', body: '' });
        const file = path.join(__dirname, name);
        if (u.hostname !== 'wildman.test' || !file.startsWith(__dirname + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 200, body: '' });
        return route.fulfill({ contentType: name.endsWith('.js') ? 'application/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html', body: fs.readFileSync(file) });
      });
      await page.goto('https://wildman.test/hitmen-gm-ai.html');
      await page.locator('[data-management-content]').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#gmAiProvider').inputValue(), 'claude');
      await page.locator('#gmAiQuestion').fill('How should we play tonight?');
      await page.locator('#gmAiDeepAsk').click();
      await page.waitForFunction(() => document.getElementById('gmAiStatus').textContent.startsWith('CLAUDE ANALYSIS READY'));
      assert.equal(requests[0].provider, 'claude');
      await page.locator('#gmAiProvider').selectOption('grok');
      assert.equal(await page.locator('#gmAiGoDeeper').isVisible(), false);
      await page.locator('#gmAiDeepAsk').click();
      await page.waitForFunction(() => document.getElementById('gmAiStatus').textContent.startsWith('GROK ANALYSIS READY'));
      assert.equal(requests[1].provider, 'grok');
      assert.equal(await page.locator('#gmAiHistory').getAttribute('open'), null);
      assert.match(await page.locator('#gmAiHistoryList').textContent(), /claude supported answer/);
      assert.equal(await page.evaluate(() => window.bad), undefined);
      await page.locator('#gmAiGoDeeper').click();
      await page.waitForFunction(() => !document.getElementById('gmAiDeepAsk').disabled);
      assert.equal(requests[2].mode, 'max'); assert.equal(requests[2].provider, 'grok');
      fail = true; await page.locator('#gmAiDeepAsk').click();
      await page.waitForFunction(() => document.getElementById('gmAiStatus').textContent === 'ANALYSIS UNAVAILABLE');
      assert.match(await page.locator('#gmAiHistoryList').textContent(), /grok supported answer/);
      assert.equal(await page.locator('#gmAiGoDeeper').isVisible(), false);
      fail = false; defer = true; await page.locator('#gmAiDeepAsk').click();
      await page.waitForFunction(() => document.getElementById('gmAiProvider').disabled);
      await page.evaluate(() => { window.VVHLBackend.state.user = null; window.dispatchEvent(new Event('vvhl-auth-change')); });
      while (!pending) await new Promise(resolve => setTimeout(resolve, 10));
      await pending();
      await page.waitForFunction(() => document.getElementById('gmAiAnswer').textContent.includes('Ask a new question'));
      assert.equal(await page.locator('#gmAiHistoryList').textContent(), '');
      assert.equal(await page.locator('#gmAiHistory').isVisible(), false);
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('PASS: Claude/Grok routing, comparison history, failures, mobile/desktop, safe rendering and logout isolation');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
