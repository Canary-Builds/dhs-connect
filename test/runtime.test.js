import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runtime, codexInstalled } from '../src/runtime.js';
import { grokRuntime, grokInstalled } from '../src/grok-runtime.js';

test('runtime keeps inherited proxy routing unless explicitly configured', t => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-connect-runtime-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { DSH_HOME: root, DSH_CODEX_BIN: process.execPath, NO_PROXY: 'localhost' };
  const result = runtime(env);
  assert.equal(result.command, process.execPath);
  assert.equal(result.env.NO_PROXY, 'localhost');
  assert.equal(result.env.no_proxy, undefined);
  assert.equal(env.CODEX_HOME, undefined);
});
test('machine configuration selects binary and home and appends only configured domains', t => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-connect-runtime-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'connect.json'), JSON.stringify({ codexBin: process.execPath, codexHome: join(root, 'state'), noProxy: 'example.test' }));
  const result = runtime({ DSH_HOME: root, NO_PROXY: 'localhost' });
  assert.equal(result.env.CODEX_HOME, join(root, 'state'));
  assert.equal(result.env.NO_PROXY, 'localhost,example.test');
});
test('grok configuration is optional and does not replace the Codex runtime', t => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-connect-runtime-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'connect.json'), JSON.stringify({ codexBin: process.execPath, grokBin: process.execPath, grokHome: join(root, 'grok') }));
  const codex = runtime({ DSH_HOME: root });
  const grok = grokRuntime({ DSH_HOME: root });
  assert.equal(codex.command, process.execPath);
  assert.equal(grok.command, process.execPath);
  assert.equal(grok.env.GROK_HOME, join(root, 'grok'));
  assert.equal(codex.env.GROK_HOME, undefined);
});
test('Grok does not require a Codex executable', t => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-connect-runtime-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { DSH_HOME: root, PATH: '', DSH_GROK_BIN: process.execPath };
  assert.equal(codexInstalled(env), false);
  assert.equal(grokInstalled(env), true);
  assert.throws(() => runtime(env), error => error.code === 'CODEX_BINARY_MISSING');
});
test('invalid configuration fails without disclosing its contents', t => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-connect-runtime-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'connect.json'), 'sensitive-test-content');
  assert.throws(() => runtime({ DSH_HOME: root }), error => error.code === 'INVALID_CONFIG' && !error.message.includes('sensitive-test-content'));
});
