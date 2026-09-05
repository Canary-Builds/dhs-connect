import assert from 'node:assert/strict';
import { AppServer } from '../src/transport.js';
import { ModelCatalog } from '../src/models.js';
import { CodexAdapter } from '../src/adapter.js';
import { safeMessage } from '../src/errors.js';
const server = new AppServer();
const adapter = new CodexAdapter(server, new ModelCatalog(server));
const user = text => ({ role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } });
const assistant = chunks => ({ role: 'assistant', content: chunks.filter(c => c.type === 'block-end').map(c => c.block), source: { kind: 'model', provider: 'openai-codex', model, replayState: chunks.at(-1).replayState } });
const collect = async options => { const chunks = []; for await (const c of adapter.stream(options)) chunks.push(c); return chunks; };
const text = chunks => chunks.filter(c => c.type === 'text-delta').map(c => c.text).join('');
const model = process.env.DSH_CONNECT_TEST_MODEL || 'gpt-6-astra';
const base = { provider: 'openai-codex', model, reasoningEffort: 'low', system: 'Follow the user exactly. This is an integration check. Do not use tools unless explicitly asked.', signal: AbortSignal.timeout(180_000) };
try {
  assert.equal((await server.account()).type, 'chatgpt');
  const models = await adapter.listModels();
  assert.ok(models.some(m => m.id === model));
  console.log('PASS: existing ChatGPT sign-in and model discovery.');
  const messages = [user('Remember this invented label: violet-otter-417. Reply with exactly READY.')];
  const request = { ...base, sessionId: 'connect-live-history', messages };
  const first = await collect(request);
  assert.equal(text(first).trim(), 'READY');
  messages.push(assistant(first), user('Reply with only the invented label I asked you to remember.'));
  // A fresh adapter simulates DSH restart and must reconstruct previous context.
  const recovered = new CodexAdapter(server, adapter.catalog);
  const chunks = [];
  for await (const c of recovered.stream(request)) chunks.push(c);
  assert.equal(text(chunks).trim(), 'violet-otter-417');
  await recovered.clear();
  console.log('PASS: real model streaming and transcript recovery in a fresh adapter.');
  const toolMessages = [user('You must call connect_probe once with {"input":"check"}. After its result, reply with only the value returned by that tool.')];
  const toolOptions = { ...base, sessionId: 'connect-live-tools', messages: toolMessages, tools: [{ name: 'connect_probe', description: 'Returns a test value. Call once when requested.', parameters: { type: 'object', properties: { input: { type: 'string' } }, required: ['input'], additionalProperties: false } }] };
  const toolStart = await collect(toolOptions);
  assert.equal(toolStart.at(-1).reason.kind, 'tool-calls');
  const call = toolStart.find(c => c.type === 'block-end' && c.block.type === 'tool-call').block;
  assert.equal(call.name, 'connect_probe');
  assert.equal(JSON.parse(call.arguments).input, 'check');
  toolMessages.push(assistant(toolStart), { role: 'user', source: { kind: 'tool', callId: call.id }, content: [{ type: 'tool-result', toolCallId: call.id, content: [{ type: 'text', text: 'CONNECT-TOOL-739' }] }] });
  const toolEnd = await collect(toolOptions);
  assert.equal(toolEnd.at(-1).reason.kind, 'stop');
  assert.equal(text(toolEnd).trim(), 'CONNECT-TOOL-739');
  console.log('PASS: real model dynamic tool request → Harness result → final response.');
} catch (error) { console.error(safeMessage(error)); process.exitCode = 1; }
finally { await adapter.clear(); server.close(); }
