import { createHash, randomUUID } from 'node:crypto';
import { contentText, inputFor, toolSpecs } from './adapter.js';
import { CodexError } from './errors.js';
import { GROK_PROVIDER } from './grok-runtime.js';
import { GrokServer } from './grok-transport.js';
import { GrokCatalog } from './grok-models.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const historyHash = messages => hash(messages.map(m => ({ role: m.role, content: m.content })));
const contentHash = content => hash(content.filter(b => !(b.type === 'text' || b.type === 'reasoning') || b.text));
const keyOf = options => options.sessionId ? `${options.sessionId}:${options.purpose ?? 'conversation'}` : randomUUID();

export function toolPrompt(specs) {
  const rules = 'Do not use local files, shell, web, or built-in Grok tools. You are the model inside DeepSeek Harness, and Harness executes tools.';
  if (!specs.length) return rules;
  return [
    rules,
    'To call one Harness tool, end your reply with a single line and nothing after it:',
    'DSH_TOOL {"name":"tool_name","arguments":{}}',
    'Available tools:',
    JSON.stringify(specs.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.inputSchema }))),
  ].join('\n');
}

export function splitTool(buffer) {
  const at = buffer.indexOf('DSH_TOOL');
  if (at < 0) return { visible: buffer, tool: null };
  const visible = buffer.slice(0, at).replace(/\s+$/g, '');
  const match = buffer.slice(at).match(/^DSH_TOOL\s*(\{[\s\S]*\})\s*$/);
  if (!match) return { visible, tool: null };
  try {
    const tool = JSON.parse(match[1]);
    if (!tool || typeof tool.name !== 'string') return { visible, tool: null };
    return { visible, tool };
  } catch { return { visible, tool: null }; }
}

function usageFrom(usage) {
  if (!usage || typeof usage !== 'object') return;
  return {
    inputTokens: usage.inputTokens ?? usage.input_tokens ?? 0,
    outputTokens: usage.outputTokens ?? usage.output_tokens ?? 0,
    cacheReadTokens: usage.cacheReadTokens ?? usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? usage.cache_creation_input_tokens ?? 0,
    reasoningTokens: usage.reasoningTokens ?? usage.reasoning_tokens ?? 0,
  };
}

export class GrokAdapter {
  sessions = new Map();
  busy = new Set();
  constructor(server = new GrokServer(), catalog = new GrokCatalog(server), { maxSessions = 128 } = {}) {
    this.server = server;
    this.catalog = catalog;
    this.maxSessions = maxSessions;
  }
  providerInfo() { return { id: GROK_PROVIDER, name: 'DSH Connect · Grok' }; }
  providerRetryPolicy() {}
  listModels() { return this.catalog.list(); }
  resolveModel(provider, model, signal) { return this.catalog.resolve(provider, model, signal); }
  async prepareCall(provider, model, signal) { return { model: await this.resolveModel(provider, model, signal), stream: options => this.stream(options) }; }
  async clear() {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(sessions.map(session => this.server.cancel(session.sessionId)));
  }
  reusable(session, options, signature) {
    if (!session || session.generation !== this.server.generation || session.signature !== signature) return false;
    const index = options.messages.findLastIndex(message => message.role === 'assistant');
    const previous = options.messages[index];
    const replay = previous?.source?.replayState?.response;
    return index === session.inputCount && replay?.kind === 'dsh-connect' && replay.marker === session.marker && historyHash(options.messages.slice(0, index)) === session.inputHash && contentHash(previous.content) === session.outputHash;
  }
  async fresh(options, signature, key) {
    const old = this.sessions.get(key);
    if (old) await this.server.cancel(old.sessionId);
    this.sessions.delete(key);
    for (const [id, session] of this.sessions) {
      if (!this.busy.has(id) && (Date.now() - session.touched > 30 * 60_000 || this.sessions.size >= this.maxSessions)) {
        this.sessions.delete(id);
        await this.server.cancel(session.sessionId);
      }
    }
    if (this.sessions.size >= this.maxSessions) throw new CodexError('All Grok sessions are busy; retry after a running turn finishes.', 'GROK_BUSY');
    const sessionId = await this.server.openSession({ model: options.model }, options.signal);
    await this.server.configure(sessionId, { model: options.model, effort: options.reasoningEffort }, options.signal);
    const session = { sessionId, generation: this.server.generation, signature, touched: Date.now() };
    this.sessions.set(key, session);
    return session;
  }
  async *stream(options) {
    options.signal?.throwIfAborted();
    if (!options.messages?.length) throw new CodexError('At least one conversation message is required.', 'INVALID_REQUEST');
    for (const message of options.messages) contentText(message.content);
    const specs = toolSpecs(options.tools);
    const signature = hash({ system: options.system, specs, model: options.model, effort: options.reasoningEffort });
    const key = keyOf(options);
    if (this.busy.has(key)) throw new CodexError('A Grok response is already running for this Harness session.', 'GROK_BUSY');
    this.busy.add(key);
    let session;
    let finished = false;
    try {
      const account = await this.server.account(options.signal);
      if (account?.type !== 'grok') throw new CodexError('Sign in with Grok in Settings → DSH Connect, or run dsh-connect-grok-login.', 'MISSING_CREDENTIAL');
      session = this.sessions.get(key);
      const reuse = this.reusable(session, options, signature);
      if (!reuse) session = await this.fresh(options, signature, key);
      const incoming = reuse ? options.messages.slice(session.inputCount + 1) : options.messages;
      if (!incoming.length) throw new CodexError('No new Harness messages were supplied.', 'INVALID_REQUEST');
      const preface = [options.system, toolPrompt(specs)].filter(Boolean).join('\n\n');
      const text = (reuse ? '' : `${preface}\n\n`) + inputFor(incoming, !reuse);
      this.server.beginPrompt(session.sessionId, text, options.signal);
      session.inputCount = options.messages.length;
      session.inputHash = historyHash(options.messages);
      const open = new Map();
      const emitted = [];
      let nextIndex = 0;
      let usage;
      const end = block => {
        open.delete(block.key);
        const content = { type: block.type, text: block.text };
        emitted[block.index] = content;
        return { type: 'block-end', index: block.index, block: content };
      };
      const finish = (kind, keep = true) => {
        session.marker = randomUUID();
        session.outputHash = contentHash(emitted.filter(Boolean));
        session.touched = Date.now();
        finished = keep;
        return { type: 'finish', reason: { kind }, replayState: { response: { kind: 'dsh-connect', version: 2, marker: session.marker } } };
      };
      const toolCall = tool => {
        const index = nextIndex++;
        const callId = typeof tool.id === 'string' ? tool.id : randomUUID();
        const content = { type: 'tool-call', id: callId, name: tool.name, arguments: JSON.stringify(tool.arguments ?? {}) };
        emitted[index] = content;
        return [
          { type: 'block-start', index, blockType: 'tool-call' },
          { type: 'tool-call-delta', index, id: callId, name: content.name, argumentsDelta: content.arguments },
          { type: 'block-end', index, block: content },
        ];
      };
      while (true) {
        const update = await this.server.nextEvent(session.sessionId, options.signal);
        const kind = update.sessionUpdate;
        if (kind === 'agent_message_chunk' || kind === 'agent_thought_chunk') {
          const type = kind === 'agent_message_chunk' ? 'text' : 'reasoning';
          const delta = update.content?.text ?? update.text ?? '';
          let block = open.get(type);
          if (!block) {
            block = { key: type, index: -1, type, raw: '', emitted: 0, text: '', started: false };
            open.set(type, block);
          }
          block.raw += delta;
          const split = type === 'text' ? splitTool(block.raw) : { visible: block.raw, tool: null };
          const freshText = split.visible.slice(block.emitted);
          block.emitted = split.visible.length;
          block.text = split.visible;
          if (freshText) {
            if (!block.started) {
              block.started = true;
              block.index = nextIndex++;
              yield { type: 'block-start', index: block.index, blockType: type };
            }
            yield { type: type === 'text' ? 'text-delta' : 'reasoning-delta', index: block.index, text: freshText };
          }
          if (split.tool && specs.some(tool => tool.name === split.tool.name)) {
            if (block.started && block.text) yield end(block);
            else open.delete(type);
            for (const other of [...open.values()]) if (other.started && other.text) yield end(other);
            for (const event of toolCall(split.tool)) yield event;
            const mapped = usageFrom(usage);
            if (mapped) yield { type: 'usage', usage: mapped };
            yield finish('tool-calls', false);
            return;
          }
        }
        if (kind === 'turn_complete') {
          for (const block of [...open.values()]) {
            if (block.type === 'text') {
              const split = splitTool(block.raw);
              if (split.tool && specs.some(tool => tool.name === split.tool.name)) {
                if (block.started && split.visible) { block.text = split.visible; yield end(block); }
                for (const event of toolCall(split.tool)) yield event;
                yield finish('tool-calls', false);
                return;
              }
            }
            if (block.started && block.text) yield end(block);
          }
          usage = update.usage ?? usage;
          const mapped = usageFrom(usage);
          if (mapped) yield { type: 'usage', usage: mapped };
          yield finish('stop');
          return;
        }
      }
    } finally {
      if (session && (!finished || !options.sessionId || options.purpose)) {
        this.sessions.delete(key);
        await this.server.cancel(session.sessionId);
      }
      this.busy.delete(key);
    }
  }
}
