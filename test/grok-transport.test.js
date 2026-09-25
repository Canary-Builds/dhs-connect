import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { GrokServer } from '../src/grok-transport.js';

const fake = fileURLToPath(new URL('./fake-grok.cjs', import.meta.url));
function server(t, mode = 'ok') {
  const instance = new GrokServer({ launch: () => ({ command: process.execPath, args: [fake, mode], cwd: undefined }), requestTimeoutMs: 200, turnTimeoutMs: 200 });
  t.after(() => instance.close());
  return instance;
}

test('grok ACP handshake reports a cached login and streams a turn', async t => {
  const grok = server(t);
  assert.equal((await grok.account()).type, 'grok');
  const id = await grok.openSession({ model: 'grok-4' });
  grok.beginPrompt(id, 'hi');
  assert.equal((await grok.nextEvent(id)).sessionUpdate, 'agent_message_chunk');
  const done = await grok.nextEvent(id);
  assert.equal(done.sessionUpdate, 'turn_complete');
  assert.equal(done.usage.output_tokens, 1);
});

test('grok without a cached login stays signed out instead of hanging', async t => {
  const grok = server(t, 'signed-out');
  assert.equal((await grok.account()).type, 'none');
});

test('grok initialization failure rejects', async t => {
  await assert.rejects(server(t, 'malformed').start(), /malformed/);
});
