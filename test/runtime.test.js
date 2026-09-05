import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runtime } from '../src/runtime.js';

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
test('invalid configuration fails without disclosing its contents', t => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-connect-runtime-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'connect.json'), 'sensitive-test-content');
  assert.throws(() => runtime({ DSH_HOME: root }), error => error.code === 'INVALID_CONFIG' && !error.message.includes('sensitive-test-content'));
});
