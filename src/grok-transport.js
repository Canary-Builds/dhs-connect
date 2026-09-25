import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir } from 'node:fs/promises';
import { EventQueue } from './transport.js';
import { abortable, CodexError } from './errors.js';
import { grokRuntime } from './grok-runtime.js';
import { VERSION } from './runtime.js';

const CACHED = new Set(['cached_token', 'xai.cached_token']);

export class GrokServer {
  child;
  starting;
  generation = 0;
  nextId = 1;
  pending = new Map();
  queues = new Map();
  signedIn = false;
  cwd;
  constructor({ launch, requestTimeoutMs = 30_000, turnTimeoutMs = 300_000 } = {}) {
    this.launch = launch ?? (() => { const r = grokRuntime(); return { command: r.command, args: ['agent', 'stdio'], cwd: r.cwd, env: r.env }; });
    this.requestTimeoutMs = requestTimeoutMs;
    this.turnTimeoutMs = turnTimeoutMs;
  }
  async start(signal) {
    if (!this.starting) {
      const start = this.boot();
      this.starting = start;
      start.catch(() => { if (this.starting === start) this.starting = undefined; });
    }
    return abortable(this.starting, signal);
  }
  async boot() {
    const launch = this.launch();
    this.cwd = launch.cwd;
    if (launch.cwd) await mkdir(launch.cwd, { recursive: true, mode: 0o700 });
    const child = spawn(launch.command, launch.args, { cwd: launch.cwd, env: launch.env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    this.generation++;
    this.queues.clear();
    this.signedIn = false;
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      if (this.child !== child) return;
      try { this.receive(JSON.parse(line)); }
      catch { this.fail(child, new CodexError('Grok sent malformed protocol data. Retry to start a fresh process.', 'PROTOCOL_ERROR')); }
    });
    child.stderr.on('data', () => {});
    child.on('error', () => this.fail(child, new CodexError('Could not start the managed Grok executable.', 'GROK_START_FAILED')));
    child.stdin.on('error', () => this.fail(child, new CodexError('Grok input pipe closed.', 'GROK_DISCONNECTED')));
    child.on('exit', (code, signal) => this.fail(child, new CodexError(`Grok exited (${signal ?? code ?? 'unknown'}). Retry to reconnect.`, 'GROK_DISCONNECTED')));
    try {
      const init = await this.rpc('initialize', {
        protocolVersion: 1,
        clientInfo: { name: 'dsh_connect', title: 'DSH Connect', version: VERSION },
        clientCapabilities: {},
      });
      const methods = Array.isArray(init?.authMethods) ? init.authMethods : [];
      const cached = methods.find(method => CACHED.has(method.id || method.methodId));
      if (cached) {
        try {
          await this.rpc('authenticate', { methodId: cached.id || cached.methodId, _meta: { headless: true } });
          this.signedIn = true;
        } catch { this.signedIn = false; }
      } else this.signedIn = methods.length === 0;
    } catch (error) { this.fail(child, error); throw error; }
  }
  fail(child, error) {
    if (this.child !== child) return;
    this.child = undefined;
    this.starting = undefined;
    this.signedIn = false;
    for (const pending of [...this.pending.values()]) pending.reject(error);
    for (const queue of this.queues.values()) queue.fail(error);
    child.kill();
    const timer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 2000);
    timer.unref();
  }
  send(message) {
    if (!this.child || !this.child.stdin.writable) throw new CodexError('Grok is disconnected.', 'GROK_DISCONNECTED');
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  }
  rpc(method, params, signal, timeoutMs = this.requestTimeoutMs) {
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const finish = (fn, value) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        this.pending.delete(id);
        fn(value);
      };
      const abort = () => finish(reject, signal.reason ?? new CodexError('Grok request was cancelled.', 'ABORTED'));
      const timer = setTimeout(() => finish(reject, new CodexError(`Grok ${method} timed out.`, 'GROK_TIMEOUT')), timeoutMs);
      this.pending.set(id, { resolve: value => finish(resolve, value), reject: error => finish(reject, error) });
      signal?.addEventListener('abort', abort, { once: true });
      try { this.send({ id, method, params }); }
      catch (error) { finish(reject, error); }
    });
  }
  receive(message) {
    if (!message || typeof message !== 'object') throw new Error('Invalid message');
    if (message.method === 'session/request_permission' && message.id !== undefined) {
      const options = message.params?.options ?? [];
      const reject = options.find(option => /reject|deny|cancel/i.test(`${option.kind ?? ''} ${option.name ?? ''} ${option.optionId ?? ''}`));
      const outcome = reject ? { outcome: 'selected', optionId: reject.optionId } : { outcome: 'cancelled' };
      this.send({ id: message.id, result: { outcome } });
      return;
    }
    if (!message.method && message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (message.error) pending?.reject(new CodexError(message.error.message ?? 'Grok rejected the request.', 'GROK_RPC_ERROR'));
      else pending?.resolve(message.result);
      return;
    }
    if (message.method === 'session/update') {
      const sessionId = message.params?.sessionId;
      if (typeof sessionId === 'string') this.queue(sessionId).push(message.params.update ?? {});
    }
  }
  queue(id) {
    if (!this.queues.has(id)) this.queues.set(id, new EventQueue());
    return this.queues.get(id);
  }
  nextEvent(id, signal) { return this.queue(id).take(signal); }
  async account(signal) {
    await this.start(signal);
    return { type: this.signedIn ? 'grok' : 'none' };
  }
  async discoverModels() { return []; }
  async openSession({ cwd = this.cwd, model } = {}, signal) {
    await this.start(signal);
    if (!this.signedIn) throw new CodexError('Sign in with Grok in Settings → DSH Connect, or run dsh-connect-grok-login.', 'MISSING_CREDENTIAL');
    const result = await this.rpc('session/new', { cwd: cwd || process.cwd(), mcpServers: [], ...(model ? { _meta: { model } } : {}) }, signal);
    const sessionId = result?.sessionId ?? result?.session?.id;
    if (typeof sessionId !== 'string') throw new CodexError('Grok returned no session ID.', 'PROTOCOL_ERROR');
    this.queue(sessionId);
    return sessionId;
  }
  async configure(sessionId, { model, effort } = {}, signal) {
    const set = async (configId, value) => {
      if (!value) return;
      await this.rpc('session/set_config_option', { sessionId, configId, value: { value } }, signal);
    };
    try { await set('model', model); } catch { /* The prompt still names the requested model. */ }
    try { await set('reasoning_effort', effort); } catch { /* Reasoning effort is optional. */ }
  }
  beginPrompt(sessionId, text, signal) {
    this.queue(sessionId);
    const generation = this.generation;
    const result = this.rpc('session/prompt', { sessionId, prompt: [{ type: 'text', text }] }, signal, this.turnTimeoutMs);
    const deliver = (fn, value) => {
      if (this.generation !== generation || !this.queues.has(sessionId)) return;
      fn(this.queues.get(sessionId), value);
    };
    result.then(
      value => deliver(queue => queue.push({ sessionUpdate: 'turn_complete', stopReason: value?.stopReason ?? value?.stop_reason ?? 'end_turn', usage: value?.usage })),
      error => deliver(queue => queue.fail(error)),
    );
    return result;
  }
  async cancel(sessionId) {
    const queue = this.queues.get(sessionId);
    queue?.fail(new CodexError('Grok turn was released.', 'ABORTED'));
    this.queues.delete(sessionId);
    if (!this.child || !sessionId) return;
    await this.rpc('session/cancel', { sessionId }, undefined, 5000).catch(() => {});
  }
  close() {
    if (this.child) this.fail(this.child, new CodexError('Grok provider stopped.', 'GROK_DISCONNECTED'));
  }
}
