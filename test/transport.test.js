import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { AppServer, EventQueue } from '../src/transport.js';
import { safeMessage } from '../src/errors.js';
const fake = fileURLToPath(new URL('./fake-server.cjs', import.meta.url));
function server(t, mode = 'ok') {
  const instance = new AppServer({ launch: () => ({ command: process.execPath, args: [fake, mode] }), requestTimeoutMs: 200 });
  t.after(() => instance.close());
  return instance;
}
test('RPC handshake, response correlation and paginated discovery', async t => {
  const s = server(t);
  const [a, models] = await Promise.all([s.account(), s.models()]);
  assert.equal(a.type, 'chatgpt');
  assert.deepEqual(models.map(m => m.id), ['first', 'second']);
  assert.equal(s.generation, 1);
  assert.equal(s.pending.size, 0);
});
test('spawn failure rejects promptly and can retry', async t => {
  const s = server(t);
  s.launch = () => ({ command: '/nonexistent/dsh-connect', args: [] });
  await assert.rejects(s.start(), /Could not start/);
  s.launch = () => ({ command: process.execPath, args: [fake, 'ok'] });
  assert.equal((await s.account()).type, 'chatgpt');
});
for (const [mode, pattern] of [['exit', /exited/], ['malformed', /malformed/], ['timeout', /timed out/]]) {
  test(`initialization ${mode} rejects instead of hanging`, async t => { await assert.rejects(server(t, mode).start(), pattern); });
}
test('crash rejects existing and future queue consumers; next RPC reconnects', async t => {
  const s = server(t);
  await s.start();
  const queue = s.queue('thread-a');
  const waiting = assert.rejects(queue.take(), /exited/);
  await assert.rejects(s.request('crash'), /exited/);
  await waiting;
  await assert.rejects(queue.take(), /exited/);
  assert.equal((await s.account()).type, 'chatgpt');
  assert.equal(s.generation, 2);
});
test('request cancellation removes its waiter without killing another request', async t => {
  const s = server(t);
  await s.start();
  const controller = new AbortController();
  const result = assert.rejects(s.request('hang', {}, controller.signal), /cancelled/);
  controller.abort(new Error('cancelled'));
  await result;
  assert.equal((await s.account()).type, 'chatgpt');
  assert.equal(s.pending.size, 0);
});
test('queues isolate threads, respect pre-abort and clean listeners', async t => {
  const s = server(t);
  const a = s.queue('a'), b = s.queue('b');
  a.push('a-value'); b.push('b-value');
  assert.equal(await b.take(), 'b-value');
  assert.equal(await a.take(), 'a-value');
  const signal = AbortSignal.abort(new Error('cancelled'));
  assert.throws(() => a.take(signal), /cancelled/);
  const controller = new AbortController();
  const wait = assert.rejects(a.take(controller.signal), /cancelled/);
  controller.abort(new Error('cancelled'));
  await wait;
  assert.equal(a.waiters.length, 0);
});
test('queue overflow fails closed', async () => {
  const q = new EventQueue();
  for (let i = 0; i < 4097; i++) q.push(i);
  await assert.rejects(q.take(), /overflow/);
});
test('errors redact credential fields and authorization URL queries', () => {
  const message = safeMessage('access_token=example-sensitive-value https://auth.example/authorize?code=example-code Bearer example-bearer-value');
  assert.ok(!message.includes('example-sensitive-value'));
  assert.ok(!message.includes('example-code'));
  assert.ok(!message.includes('example-bearer-value'));
});
