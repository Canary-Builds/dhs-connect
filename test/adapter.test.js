import test from 'node:test';
import assert from 'node:assert/strict';
import { CodexAdapter } from '../src/adapter.js';
import { ModelCatalog } from '../src/models.js';
import { EventQueue } from '../src/transport.js';
const user = text => ({ role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } });
const options = messages => ({ provider: 'openai-codex', model: 'gpt-6-astra', sessionId: 'session-a', messages, system: 'test' });
const collect = async gen => { const chunks = []; for await (const c of gen) chunks.push(c); return chunks; };
const assistant = chunks => ({ role: 'assistant', content: chunks.filter(c => c.type === 'block-end').map(c => c.block), source: { kind: 'model', provider: 'openai-codex', replayState: chunks.at(-1).replayState } });
class FakeServer {
  generation = 1; threads = []; turns = []; released = []; responses = []; queues = new Map();
  auth = { type: 'chatgpt' }; discovered = []; onTurn = () => {};
  async start() {}
  async account() { return this.auth; }
  async models() { if (this.discoveryError) throw Error('offline'); return this.discovered; }
  async startThread(params) { this.threads.push(params); const id = `thread-${this.threads.length}`; this.queues.set(id, new EventQueue()); return id; }
  async startTurn(id, params) { const turn = 'turn-' + (this.turns.length + 1); this.turns.push({ id, params, turn }); this.onTurn(id, turn); return turn; }
  event(id, method, params, requestId) { this.queues.get(id).push({ method, params, requestId }); }
  done(id, turn, text = 'done') { this.event(id, 'item/agentMessage/delta', { itemId: turn, turnId: turn, delta: text }); this.event(id, 'turn/completed', { turn: { id: turn, status: 'completed' } }); }
  nextEvent(id, signal) { return this.queues.get(id).take(signal); }
  respond(id, result) { this.responses.push({ id, result }); this.onResponse?.(id, result); }
  async release(id, turn) { this.released.push({ id, turn }); }
}
test('catalog survives discovery failure, deduplicates and accepts unlisted model IDs', async () => {
  const s = new FakeServer(), c = new ModelCatalog(s);
  s.discoveryError = true;
  assert.ok((await c.list()).some(m => m.id === 'gpt-6-astra'));
  assert.equal((await c.resolve('openai-codex', 'future-model')).id, 'future-model');
  s.discoveryError = false;
  s.discovered = [{ id: 'gpt-6-astra', displayName: 'Account Astra', supportedReasoningEfforts: [{ reasoningEffort: 'max' }], defaultReasoningEffort: 'max' }];
  await c.refresh(undefined, true);
  assert.equal((await c.list()).filter(m => m.id === 'gpt-6-astra').length, 1);
  assert.equal((await c.resolve('openai-codex', 'gpt-6-astra')).reasoning.defaultEffort, 'max');
});
test('new threads include prior user, assistant and tool-result history', async () => {
  const s = new FakeServer(), a = new CodexAdapter(s);
  s.onTurn = (id, turn) => s.done(id, turn);
  const history = [user('remember violet'), { role: 'assistant', content: [{ type: 'text', text: 'remembered' }] }, user('what color?')];
  await collect(a.stream(options(history)));
  assert.match(s.turns[0].params.input[0].text, /remember violet/);
  assert.match(s.turns[0].params.input[0].text, /remembered/);
  assert.equal(s.threads[0].sandbox, 'read-only');
});
test('continuation reuses matching history and closes unfinished blocks', async () => {
  const s = new FakeServer(), a = new CodexAdapter(s);
  s.onTurn = (id, turn) => s.done(id, turn);
  const history = [user('first')];
  const chunks = await collect(a.stream(options(history)));
  assert.equal(chunks.at(-2).type, 'block-end');
  history.push(assistant(chunks), user('second'));
  await collect(a.stream(options(history)));
  assert.equal(s.threads.length, 1);
  assert.equal(s.turns[1].params.input[0].text, 'second');
});
test('changed system, tools, model or edited history rebuilds safely', async () => {
  for (const change of ['system', 'tools', 'model', 'history']) {
    const s = new FakeServer(), a = new CodexAdapter(s);
    s.onTurn = (id, turn) => s.done(id, turn);
    const history = [user('first')], chunks = await collect(a.stream(options(history)));
    history.push(assistant(chunks), user('next'));
    const request = options(history);
    if (change === 'history') request.messages[0] = user('edited');
    else if (change === 'tools') request.tools = [{ name: 'lookup', description: '', parameters: { type: 'object', properties: {} } }];
    else request[change] = 'changed';
    await collect(a.stream(request));
    assert.equal(s.threads.length, 2, change);
    assert.equal(s.released.length, 1, change);
  }
});
test('dynamic tool result returns to its request and continues the original turn', async () => {
  const s = new FakeServer(), a = new CodexAdapter(s);
  s.onTurn = (id, turn) => s.event(id, 'item/tool/call', { threadId: id, turnId: turn, callId: 'call-a', tool: 'lookup', arguments: { number: 7 } }, 99);
  s.onResponse = () => s.done('thread-1', 'turn-1', 'tool accepted');
  const history = [user('look it up')];
  const request = { ...options(history), tools: [{ name: 'lookup', description: '', parameters: { type: 'object', properties: {} } }] };
  const first = await collect(a.stream(request));
  assert.equal(first.at(-1).reason.kind, 'tool-calls');
  history.push(assistant(first), { role: 'user', content: [{ type: 'tool-result', toolCallId: 'call-a', content: [{ type: 'text', text: 'seven' }] }] });
  const second = await collect(a.stream(request));
  assert.equal(second.at(-1).reason.kind, 'stop');
  assert.equal(s.turns.length, 1);
  assert.equal(s.responses[0].id, 99);
  assert.equal(s.responses[0].result.contentItems[0].text, 'seven');
});
test('after process restart tool results are reconstructed, never sent to stale request IDs', async () => {
  const s = new FakeServer(), a = new CodexAdapter(s);
  s.onTurn = (id, turn) => s.event(id, 'item/tool/call', { turnId: turn, callId: 'call-a', tool: 'lookup', arguments: {} }, 99);
  const messages = [user('look it up')];
  const request = { ...options(messages), tools: [{ name: 'lookup', parameters: { type: 'object' } }] };
  const first = await collect(a.stream(request));
  messages.push(assistant(first), { role: 'user', content: [{ type: 'tool-result', toolCallId: 'call-a', content: [{ type: 'text', text: 'already executed' }] }] });
  s.generation++;
  s.onTurn = (id, turn) => s.done(id, turn);
  await collect(a.stream(request));
  assert.equal(s.responses.length, 0);
  assert.match(s.turns[1].params.input[0].text, /already executed/);
});
test('usage subtracts cached input and is emitted before finish', async () => {
  const s = new FakeServer(), a = new CodexAdapter(s);
  s.onTurn = (id, turn) => {
    s.event(id, 'thread/tokenUsage/updated', { turnId: turn, tokenUsage: { total: { inputTokens: 100, cachedInputTokens: 30, outputTokens: 12, reasoningOutputTokens: 4 } } });
    s.done(id, turn);
  };
  const chunks = await collect(a.stream(options([user('hi')])));
  assert.equal(chunks.at(-2).usage.inputTokens, 70);
  assert.equal(chunks.at(-2).usage.cacheReadTokens, 30);
});
test('abort and consumer cancellation release the native turn', async () => {
  const s = new FakeServer(), a = new CodexAdapter(s);
  s.onTurn = (id, turn) => s.event(id, 'item/agentMessage/delta', { itemId: 'item', turnId: turn, delta: 'text' });
  const gen = a.stream(options([user('hello')]));
  await gen.next();
  await gen.return();
  assert.equal(s.released.length, 1);
  assert.equal(a.busy.size, 0);
  assert.equal(a.sessions.size, 0);
});
test('conflicting calls reject, auxiliary calls have their own thread', async () => {
  const s = new FakeServer(), a = new CodexAdapter(s);
  s.onTurn = (id, turn) => s.done(id, turn);
  const req = options([user('hello')]);
  const gen = a.stream(req);
  await gen.next();
  await assert.rejects(collect(a.stream(req)), /already running/);
  await collect(a.stream({ ...req, purpose: 'session-title' }));
  assert.equal(s.threads.length, 2);
  await gen.return();
});
test('unsupported nested images and invalid schemas fail before a native thread starts', async () => {
  const s = new FakeServer(), a = new CodexAdapter(s);
  await assert.rejects(collect(a.stream(options([{ role: 'user', content: [{ type: 'tool-result', content: [{ type: 'image', attachment: {} }] }] }]))), /unsupported content: image/);
  await assert.rejects(collect(a.stream({ ...options([user('hello')]), tools: [{ name: 'bad', parameters: {} }] })), /JSON Schema/);
  assert.equal(s.threads.length, 0);
});
test('missing login produces a useful error', async () => {
  const s = new FakeServer(), a = new CodexAdapter(s); s.auth = null;
  await assert.rejects(collect(a.stream(options([user('hello')]))), /Sign in with ChatGPT/);
});
test('late completed items after a tool boundary do not duplicate streamed text', async () => {
  const s = new FakeServer(), a = new CodexAdapter(s);
  s.onTurn = (id, turn) => {
    s.event(id, 'item/agentMessage/delta', { itemId: 'comment', turnId: turn, delta: 'Checking now.' });
    s.event(id, 'item/tool/call', { turnId: turn, callId: 'call-a', tool: 'lookup', arguments: {} }, 99);
  };
  s.onResponse = () => {
    s.event('thread-1', 'item/completed', { item: { id: 'comment', type: 'agentMessage', text: 'Checking now.' } });
    s.done('thread-1', 'turn-1', 'Finished.');
  };
  const messages = [user('lookup')];
  const request = { ...options(messages), tools: [{ name: 'lookup', parameters: { type: 'object' } }] };
  const first = await collect(a.stream(request));
  messages.push(assistant(first), { role: 'user', content: [{ type: 'tool-result', toolCallId: 'call-a', content: [{ type: 'text', text: 'value' }] }] });
  const second = await collect(a.stream(request));
  assert.equal(second.filter(c => c.type === 'text-delta').map(c => c.text).join(''), 'Finished.');
});
