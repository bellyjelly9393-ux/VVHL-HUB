const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { parseArgs, buildPacket, assertNoSecret } = require('./scripts/grok-code.cjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wildman-grok-code-'));
execFileSync('git', ['init', '-q'], { cwd: dir });
for (const [name, text] of Object.entries({ 'file with spaces.js': 'const x = 1;', '.env': 'SECRET=value', 'untracked.js': 'private', 'large.js': 'a'.repeat(80001), 'secret.js': 'const apiKey="0123456789abcdefghijk";', 'binary.js': '\0' })) fs.writeFileSync(path.join(dir, name), text);
fs.symlinkSync(path.join(dir, 'file with spaces.js'), path.join(dir, 'link.js'));
execFileSync('git', ['add', '--', 'file with spaces.js', '.env', 'large.js', 'secret.js', 'binary.js', 'link.js'], { cwd: dir });
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const options = file => parseArgs(['--question', 'Review this code', '--file', file]);
test('help and invalid argument handling', () => {
  assert.equal(parseArgs(['--help']).help, true);
  for (const args of [[], ['--file'], ['--question', 'q', '--file', 'a.js', '--mode', 'bad'], ['--api-key', 'secret']]) assert.throws(() => parseArgs(args));
});
test('only explicitly selected tracked file contents are included; spaces preserved', () => {
  const p = buildPacket(options('file with spaces.js'), dir);
  assert.deepEqual(p.files, [{ path: 'file with spaces.js', content: 'const x = 1;' }]);
});
test('untracked, environment, binary, large, credential and symlink files blocked', () => {
  for (const file of ['untracked.js', '.env', 'large.js', 'secret.js', 'binary.js', 'link.js', '../outside.js']) assert.throws(() => buildPacket(options(file), dir), file);
});
test('secret values in questions blocked without echoing the secret', () => {
  const value = 'xai-' + 'a'.repeat(30);
  assert.throws(() => assertNoSecret(value, 'question'), e => /credential/.test(e.message) && !e.message.includes(value));
});
test('dry run succeeds without credentials or network and leaves source untouched', () => {
  const helper = path.join(__dirname, 'scripts/grok-code.cjs');
  const result = spawnSync(process.execPath, [helper, '--question', 'Review', '--file', 'file with spaces.js', '--dry-run'], { cwd: dir, encoding: 'utf8', env: { ...process.env, OPENROUTER_API_KEY: '' } });
  assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).sent, false);
  assert.equal(fs.readFileSync(path.join(dir, 'file with spaces.js'), 'utf8'), 'const x = 1;');
});
test('live helper without credentials fails clearly before sending', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'scripts/grok-code.cjs'), '--question', 'Review', '--file', 'file with spaces.js'], { cwd: dir, encoding: 'utf8', env: { ...process.env, OPENROUTER_API_KEY: '' } });
  assert.equal(result.status, 1); assert.match(result.stderr, /OPENROUTER_API_KEY/);
});
