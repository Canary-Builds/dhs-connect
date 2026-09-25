import test from 'node:test';
import assert from 'node:assert/strict';
import { GrokAdapter, splitTool } from '../src/grok-adapter.js';
import { GrokCatalog } from '../src/grok-models.js';
import { EventQueue } from '../src/transport.js';
import { parseDeviceLogin } from '../src/grok-device.js';

const user = text => ({ role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } });
const options = messages => ({ provider: 'xai-grok', model: 'grok-4', sessionId: 'session-a', messages, system: 'test' });
const collect = async gen => { const chunks = []; for await (const chunk of gen) chunks.push(chunk); return chunks; };
const assistant = chunks => ({ role: 'assistant', content: chunks.filter(chunk => chunk.type === 'block-end').map(chunk => chunk.block), source: { kind: 'model', provider: 'xai-grok', replayState: chunks.at(-1).replayState } });

class FakeGrok {
  generation = 1;
  auth = { type: 'grok' };
  prompts = [];
  opened = [];
  cancelled = [];
  queues = new Map();
  async account() { return this.auth; }
  async discoverModels() { return []; }
  async openSession(params) { this.opened.push(params); const id = `s-${this.opened.length}`; this.queues.set(id, new EventQueue()); return id; }
  async configure() {}
  beginPrompt(id, text) { this.prompts.push({ id, text }); this.onPrompt?.(id, text); }
  nextEvent(id, signal) { return this.queues.get(id).take(signal); }
  async cancel(id) { this.cancelled.push(id); this.queues.get(id)?.fail(new Error('cancelled')); this.queues.delete(id); }
  push(id, update) { this.queues.get(id).push(update); }
}

test('grok catalog keeps curated models and accepts an unlisted id', async () => {
  const catalog = new GrokCatalog(new FakeGrok());
  assert.ok((await catalog.list()).some(model => model.id === 'grok-4' && model.provider === 'xai-grok'));
  assert.equal((await catalog.resolve('xai-grok', 'grok-custom')).id, 'grok-custom');
  await assert.rejects(catalog.resolve('openai-codex', 'grok-4'), /Grok provider/);
});

test('grok streams text, usage and reuses a matching continuation', async () => {
  const server = new FakeGrok();
  const adapter = new GrokAdapter(server, new GrokCatalog(server));
  server.onPrompt = id => {
    server.push(id, { sessionUpdate: 'agent_thought_chunk', content: { text: 'thinking' } });
    server.push(id, { sessionUpdate: 'agent_message_chunk', content: { text: 'hello' } });
    server.push(id, { sessionUpdate: 'turn_complete', usage: { input_tokens: 3, output_tokens: 1, reasoning_tokens: 2 } });
  };
  const history = [user('first')];
  const chunks = await collect(adapter.stream(options(history)));
  assert.equal(chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text).join(''), 'hello');
  assert.equal(chunks.filter(chunk => chunk.type === 'reasoning-delta').map(chunk => chunk.text).join(''), 'thinking');
  assert.equal(chunks.at(-2).usage.reasoningTokens, 2);
  assert.equal(chunks.at(-1).reason.kind, 'stop');
  history.push(assistant(chunks), user('second'));
  server.onPrompt = id => server.push(id, { sessionUpdate: 'turn_complete' });
  await collect(adapter.stream(options(history)));
  assert.equal(server.opened.length, 1);
  assert.equal(server.prompts[1].text, 'second');
});

test('grok tool marker becomes a harness tool call and is not shown as text', async () => {
  const server = new FakeGrok();
  const adapter = new GrokAdapter(server, new GrokCatalog(server));
  server.onPrompt = id => server.push(id, { sessionUpdate: 'agent_message_chunk', content: { text: 'Checking.\nDSH_TOOL {"name":"lookup","arguments":{"n":1}}' } });
  const chunks = await collect(adapter.stream({ ...options([user('look')]), tools: [{ name: 'lookup', description: 'find', parameters: { type: 'object', properties: {} } }] }));
  assert.equal(chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text).join(''), 'Checking.');
  assert.equal(chunks.find(chunk => chunk.type === 'block-end' && chunk.block.type === 'tool-call').block.name, 'lookup');
  assert.equal(chunks.at(-1).reason.kind, 'tool-calls');
  assert.equal(server.cancelled.length, 1);
  assert.equal(adapter.sessions.size, 0);
});

test('missing grok login fails before a session starts', async () => {
  const server = new FakeGrok();
  server.auth = { type: 'none' };
  const adapter = new GrokAdapter(server, new GrokCatalog(server));
  await assert.rejects(collect(adapter.stream(options([user('hi')]))), /Sign in with Grok/);
  assert.equal(server.opened.length, 0);
});

test('device login output keeps only an xAI address and code', () => {
  const parsed = parseDeviceLogin('Open https://auth.x.ai/device?user_code=1 and enter ABCD-EFGH. Ignore https://evil.example/phish');
  assert.equal(parsed.authUrl, 'https://auth.x.ai/device?user_code=1');
  assert.equal(parsed.userCode, 'ABCD-EFGH');
  assert.equal(splitTool('Hi\nDSH_TOOL {"name":"lookup","arguments":{}}').tool.name, 'lookup');
  assert.equal(splitTool('Hi\nDSH_TOOL {"name":').tool, null);
});
