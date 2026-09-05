import { createHash, randomUUID } from 'node:crypto';
import { AppServer } from './transport.js';
import { ModelCatalog } from './models.js';
import { CodexError } from './errors.js';
import { PROVIDER } from './runtime.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const transcriptShape = messages => messages.map(m => ({ role: m.role, content: m.content }));
const historyHash = messages => hash(transcriptShape(messages));
const contentHash = content => hash(content.filter(b => !(b.type === 'text' || b.type === 'reasoning') || b.text));
const keyOf = options => options.sessionId ? `${options.sessionId}:${options.purpose ?? 'conversation'}` : randomUUID();

export function contentText(blocks) {
  return blocks.map(block => {
    if (block.type === 'text') return block.text;
    if (block.type === 'reasoning') return '';
    if (block.type === 'tool-call') return `[Tool call ${block.id}: ${block.name}] ${block.arguments}`;
    if (block.type === 'tool-result') return `[${block.isError ? 'Failed tool result' : 'Tool result'} ${block.toolCallId}]\n${contentText(block.content)}`;
    throw new CodexError(`DSH Connect currently accepts text and text tool results; unsupported content: ${block.type}.`, 'UNSUPPORTED_CONTENT');
  }).filter(Boolean).join('\n');
}
export function inputFor(messages, rebuild = false) {
  if (messages.length === 1 && messages[0].role === 'user' && !messages[0].content.some(b => b.type === 'tool-result')) return contentText(messages[0].content);
  const transcript = messages.map(m => ({ role: m.role, source: m.source?.kind ?? m.role, content: contentText(m.content) }));
  return (rebuild ? 'Harness conversation history follows as JSON. Continue from its last message. Tool results in this history have already been executed; do not repeat a tool merely to reconstruct history.\n' : 'New Harness messages follow as JSON, in order:\n') + JSON.stringify(transcript);
}
export function toolSpecs(tools = []) {
  const names = new Set();
  return tools.map(tool => {
    if (typeof tool.name !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(tool.name) || names.has(tool.name)) throw new CodexError('Dynamic tool names must be unique and contain 1–64 letters, digits, underscores or hyphens.', 'INVALID_REQUEST');
    names.add(tool.name);
    if (!tool.parameters || tool.parameters.type !== 'object' || Array.isArray(tool.parameters)) throw new CodexError(`Tool ${tool.name} requires an object JSON Schema.`, 'INVALID_REQUEST');
    return { type: 'function', name: tool.name, description: tool.description ?? '', inputSchema: tool.parameters };
  });
}
function usageDelta(total, previous = {}) {
  const diff = name => Math.max(0, (total[name] ?? 0) - (previous[name] ?? 0));
  return { inputTokens: Math.max(0, diff('inputTokens') - diff('cachedInputTokens') - diff('cacheWriteInputTokens')), outputTokens: diff('outputTokens'), cacheReadTokens: diff('cachedInputTokens'), cacheWriteTokens: diff('cacheWriteInputTokens'), reasoningTokens: diff('reasoningOutputTokens') };
}

// Implements the host's public adapter interface without a duplicate DSH runtime.
export class CodexAdapter {
  sessions = new Map();
  busy = new Set();
  constructor(server = new AppServer(), catalog = new ModelCatalog(server), { idleTimeoutMs = 300_000, maxSessions = 128 } = {}) {
    this.server = server;
    this.catalog = catalog;
    this.idleTimeoutMs = idleTimeoutMs;
    this.maxSessions = maxSessions;
  }
  providerInfo() { return { id: PROVIDER, name: 'DSH Connect · ChatGPT' }; }
  providerRetryPolicy() {}
  listModels() { return this.catalog.list(); }
  resolveModel(provider, model, signal) { return this.catalog.resolve(provider, model, signal); }
  async prepareCall(provider, model, signal) { return { model: await this.resolveModel(provider, model, signal), stream: options => this.stream(options) }; }
  async clear() {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(sessions.map(s => this.server.release(s.threadId, s.turnId)));
  }
  reusable(s, options, signature) {
    if (!s || s.generation !== this.server.generation || s.signature !== signature) return false;
    const index = options.messages.findLastIndex(m => m.role === 'assistant');
    const previous = options.messages[index];
    const replay = previous?.source?.replayState?.response;
    return index === s.inputCount && replay?.kind === 'dsh-connect' && replay.marker === s.marker && historyHash(options.messages.slice(0, index)) === s.inputHash && contentHash(previous.content) === s.outputHash;
  }
  async fresh(options, specs, signature, key) {
    const old = this.sessions.get(key);
    if (old) await this.server.release(old.threadId, old.turnId);
    this.sessions.delete(key);
    for (const [id, session] of this.sessions) {
      if (!this.busy.has(id) && (Date.now() - session.touched > 30 * 60_000 || this.sessions.size >= this.maxSessions)) {
        this.sessions.delete(id);
        await this.server.release(session.threadId, session.turnId);
      }
    }
    if (this.sessions.size >= this.maxSessions) throw new CodexError('All Codex sessions are busy; retry after a running turn finishes.', 'CODEX_BUSY');
    const threadId = await this.server.startThread({
      model: options.model, cwd: process.cwd(), approvalPolicy: 'never', sandbox: 'read-only', ephemeral: true,
      baseInstructions: [options.system ?? '', 'You are the model inside DeepSeek Harness. Harness owns the conversation and tool execution. Use only the supplied dynamic tools, one at a time. Never use native Codex tools.'].filter(Boolean).join('\n\n'),
      dynamicTools: specs,
    }, options.signal);
    const session = { threadId, generation: this.server.generation, signature, touched: Date.now(), pending: [], billed: {}, turnId: undefined };
    this.sessions.set(key, session);
    return session;
  }
  async *stream(options) {
    options.signal?.throwIfAborted();
    if (options.stop !== undefined || options.temperature !== undefined || options.maxTokens !== undefined) throw new CodexError('Codex app-server does not support stop, temperature, or maxTokens overrides.', 'UNSUPPORTED_OPTION');
    if (!options.messages?.length) throw new CodexError('At least one conversation message is required.', 'INVALID_REQUEST');
    for (const message of options.messages) contentText(message.content); // Validate nested content before starting anything.
    const specs = toolSpecs(options.tools);
    const signature = hash({ system: options.system, specs, model: options.model, effort: options.reasoningEffort, cwd: process.cwd() });
    const key = keyOf(options);
    if (this.busy.has(key)) throw new CodexError('A Codex response is already running for this Harness session.', 'CODEX_BUSY');
    this.busy.add(key);
    let session;
    let finished = false;
    try {
      await this.server.start(options.signal);
      const account = await this.server.account(options.signal);
      if (account?.type !== 'chatgpt') throw new CodexError('Sign in with ChatGPT in Settings → DSH Connect, or run dsh-connect-login.', 'MISSING_CREDENTIAL');
      session = this.sessions.get(key);
      const reuse = this.reusable(session, options, signature);
      if (!reuse) session = await this.fresh(options, specs, signature, key);
      if (session.pending.length) {
        const results = new Map(options.messages.flatMap(m => m.content).filter(b => b.type === 'tool-result').map(b => [b.toolCallId, b]));
        for (const call of session.pending) {
          const result = results.get(call.callId);
          if (!result) throw new CodexError('Harness has not supplied the pending tool result.', 'INVALID_REQUEST');
          this.server.respond(call.requestId, { contentItems: [{ type: 'inputText', text: contentText(result.content) || '(no output)' }], success: !result.isError });
        }
        session.pending = [];
      } else {
        const incoming = reuse ? options.messages.slice(session.inputCount + 1) : options.messages;
        if (!incoming.length) throw new CodexError('No new Harness messages were supplied.', 'INVALID_REQUEST');
        session.turnId = await this.server.startTurn(session.threadId, { model: options.model, ...(options.reasoningEffort ? { effort: options.reasoningEffort } : {}), input: [{ type: 'text', text: inputFor(incoming, !reuse) }] }, options.signal);
        session.closedItems = new Set();
      }
      session.inputCount = options.messages.length;
      session.inputHash = historyHash(options.messages);
      const open = new Map();
      const emitted = [];
      let nextIndex = 0;
      const end = block => { open.delete(block.key); session.closedItems.add(block.itemId); const content = { type: block.type, text: block.text }; emitted[block.index] = content; return { type: 'block-end', index: block.index, block: content }; };
      const finish = kind => {
        session.marker = randomUUID();
        session.outputHash = contentHash(emitted.filter(Boolean));
        session.touched = Date.now();
        finished = true;
        return { type: 'finish', reason: { kind }, replayState: { response: { kind: 'dsh-connect', version: 2, marker: session.marker } } };
      };
      while (true) {
        const timeout = AbortSignal.timeout(this.idleTimeoutMs);
        const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
        let event;
        try { event = await this.server.nextEvent(session.threadId, signal); }
        catch (error) { if (!options.signal?.aborted && timeout.aborted) throw new CodexError('Codex stopped sending events. Retry to reconnect.', 'CODEX_TIMEOUT'); throw error; }
        const { method, params } = event;
        const eventTurn = params.turnId ?? params.turn?.id;
        if (eventTurn && session.turnId && eventTurn !== session.turnId) continue;
        if (method === 'thread/tokenUsage/updated') { session.usage = params.tokenUsage?.total; continue; }
        if (method === 'error' && !params.willRetry) throw new CodexError(params.error?.message ?? 'Codex turn failed.');
        const type = method === 'item/agentMessage/delta' ? 'text' : method === 'item/reasoning/summaryTextDelta' ? 'reasoning' : undefined;
        if (type) {
          const key = `${params.itemId}:${type}`;
          let block = open.get(key);
          if (!block) {
            block = { key, itemId: params.itemId, index: nextIndex++, type, text: '' };
            open.set(key, block);
            yield { type: 'block-start', index: block.index, blockType: type };
          }
          const text = params.delta ?? '';
          block.text += text;
          yield { type: type === 'text' ? 'text-delta' : 'reasoning-delta', index: block.index, text };
        }
        if (method === 'item/completed') {
          const item = params.item;
          const blocks = [...open.values()].filter(b => b.itemId === item?.id);
          // Some app-server paths send only the final item, with no deltas.
          if (!blocks.length && item?.type === 'agentMessage' && item.text && !session.closedItems.has(item.id)) {
            const block = { key: `${item.id}:text`, itemId: item.id, index: nextIndex++, type: 'text', text: item.text };
            yield { type: 'block-start', index: block.index, blockType: 'text' };
            yield { type: 'text-delta', index: block.index, text: item.text };
            yield end(block);
          }
          for (const block of blocks) yield end(block);
        }
        if (method === 'item/tool/call') {
          const { callId, tool, arguments: args } = params;
          if (event.requestId === undefined || typeof callId !== 'string' || !specs.some(t => t.name === tool)) {
            if (event.requestId !== undefined) this.server.respond(event.requestId, { success: false, contentItems: [{ type: 'inputText', text: 'Unknown or malformed Harness tool call.' }] });
            throw new CodexError('Codex requested an unknown or malformed dynamic tool.', 'PROTOCOL_ERROR');
          }
          for (const block of [...open.values()]) yield end(block);
          const index = nextIndex++;
          const content = { type: 'tool-call', id: callId, name: tool, arguments: JSON.stringify(args ?? {}) };
          session.pending = [{ requestId: event.requestId, callId }];
          emitted[index] = content;
          yield { type: 'block-start', index, blockType: 'tool-call' };
          yield { type: 'tool-call-delta', index, id: callId, name: tool, argumentsDelta: content.arguments };
          yield { type: 'block-end', index, block: content };
          if (session.usage) { yield { type: 'usage', usage: usageDelta(session.usage, session.billed) }; session.billed = session.usage; }
          yield finish('tool-calls');
          return;
        }
        if (method === 'turn/completed') {
          if (params.turn?.status === 'failed') throw new CodexError(params.turn.error?.message ?? 'Codex turn failed.');
          if (params.turn?.status === 'interrupted') throw new CodexError('Codex turn was interrupted.', 'ABORTED');
          for (const block of [...open.values()]) yield end(block);
          if (session.usage) { yield { type: 'usage', usage: usageDelta(session.usage, session.billed) }; session.billed = session.usage; }
          session.turnId = undefined;
          yield finish('stop');
          return;
        }
      }
    } finally {
      if (session && (!finished || !options.sessionId || options.purpose)) {
        this.sessions.delete(key);
        await this.server.release(session.threadId, session.turnId);
      }
      this.busy.delete(key);
    }
  }
}
