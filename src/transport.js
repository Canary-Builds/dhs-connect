import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir } from 'node:fs/promises';
import { abortable, CodexError } from './errors.js';
import { runtime, CODEX_ARGS, VERSION } from './runtime.js';

export class EventQueue {
  values = [];
  waiters = [];
  error;
  push(value) {
    if (this.error) return;
    if (this.waiters.length) this.waiters.shift().resolve(value);
    else if (this.values.length >= 4096) this.fail(new CodexError('Codex event queue overflowed; retry the turn.', 'PROTOCOL_ERROR'));
    else this.values.push(value);
  }
  fail(error) {
    this.error = error;
    this.values = [];
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }
  take(signal) {
    signal?.throwIfAborted();
    if (this.error) return Promise.reject(this.error);
    if (this.values.length) return Promise.resolve(this.values.shift());
    return new Promise((resolve, reject) => {
      const finish = (fn, value) => {
        signal?.removeEventListener('abort', abort);
        this.waiters = this.waiters.filter(entry => entry !== waiter);
        fn(value);
      };
      const waiter = { resolve: value => finish(resolve, value), reject: error => finish(reject, error) };
      const abort = () => waiter.reject(signal.reason);
      this.waiters.push(waiter);
      signal?.addEventListener('abort', abort, { once: true });
    });
  }
}

export class AppServer {
  child;
  starting;
  generation = 0;
  nextId = 1;
  pending = new Map();
  queues = new Map();
  retired = new Set();
  lastFailure;
  stderrBytes = 0;
  constructor({ launch, requestTimeoutMs = 30_000 } = {}) {
    this.launch = launch ?? (() => { const r = runtime(); return { ...r, args: [...CODEX_ARGS, 'app-server', '--stdio'], cwd: r.env.CODEX_HOME }; });
    this.requestTimeoutMs = requestTimeoutMs;
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
    if (launch.cwd) await mkdir(launch.cwd, { recursive: true, mode: 0o700 });
    const child = spawn(launch.command, launch.args, { cwd: launch.cwd, env: launch.env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    this.generation++;
    this.retired.clear();
    this.queues.clear();
    this.stderrBytes = 0;
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      if (this.child !== child) return;
      try { this.receive(JSON.parse(line)); }
      catch { this.fail(child, new CodexError('Codex sent malformed protocol data. Retry to start a fresh process.', 'PROTOCOL_ERROR')); }
    });
    // Native stderr can contain request data or credentials. Never relay it to DSH logs.
    child.stderr.on('data', chunk => { this.stderrBytes += chunk.length; });
    child.on('error', () => this.fail(child, new CodexError('Could not start the managed Codex executable.', 'CODEX_START_FAILED')));
    child.stdin.on('error', () => this.fail(child, new CodexError('Codex input pipe closed.', 'CODEX_DISCONNECTED')));
    child.on('exit', (code, signal) => this.fail(child, new CodexError(`Codex exited (${signal ?? code ?? 'unknown'}). Retry to reconnect.`, 'CODEX_DISCONNECTED')));
    try {
      await this.rpc('initialize', { clientInfo: { name: 'dsh_connect', title: 'DSH Connect', version: VERSION }, capabilities: { experimentalApi: true } });
      this.send({ method: 'initialized', params: {} });
      this.lastFailure = undefined;
    } catch (error) { this.fail(child, error); throw error; }
  }
  fail(child, error) {
    if (this.child !== child) return;
    this.child = undefined;
    this.starting = undefined;
    this.lastFailure = error.message;
    for (const pending of [...this.pending.values()]) pending.reject(error);
    for (const queue of this.queues.values()) queue.fail(error);
    child.kill();
    const timer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 2000);
    timer.unref();
  }
  send(message) {
    if (!this.child || !this.child.stdin.writable) throw new CodexError('Codex is disconnected.', 'CODEX_DISCONNECTED');
    this.child.stdin.write(JSON.stringify(message) + '\n');
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
      const abort = () => finish(reject, signal.reason);
      const timer = setTimeout(() => finish(reject, new CodexError(`Codex ${method} timed out.`, 'CODEX_TIMEOUT')), timeoutMs);
      this.pending.set(id, { resolve: value => finish(resolve, value), reject: error => finish(reject, error) });
      signal?.addEventListener('abort', abort, { once: true });
      try { this.send({ id, method, params }); }
      catch (error) { finish(reject, error); }
    });
  }
  async request(method, params = {}, signal, timeoutMs) {
    await this.start(signal);
    return this.rpc(method, params, signal, timeoutMs);
  }
  receive(message) {
    if (!message || typeof message !== 'object') throw new Error('Invalid message');
    if (!message.method && message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (message.error) pending?.reject(new CodexError(message.error.message ?? 'Codex rejected the request.', 'CODEX_RPC_ERROR'));
      else pending?.resolve(message.result);
      return;
    }
    const { method, params = {}, id } = message;
    if (typeof method !== 'string') return;
    if (id !== undefined && method !== 'item/tool/call') {
      this.send({ id, error: { code: -32601, message: 'This provider supports Harness dynamic tools only.' } });
      return;
    }
    const threadId = params.threadId;
    if (typeof threadId !== 'string') return;
    if (this.retired.has(threadId)) {
      if (id !== undefined) this.respond(id, { contentItems: [{ type: 'inputText', text: 'Turn was cancelled.' }], success: false });
      return;
    }
    this.queue(threadId).push({ method, params, requestId: id });
  }
  queue(id) {
    if (!this.queues.has(id)) this.queues.set(id, new EventQueue());
    return this.queues.get(id);
  }
  nextEvent(id, signal) { return this.queue(id).take(signal); }
  respond(id, result) { this.send({ id, result }); }
  async account(signal) { return (await this.request('account/read', { refreshToken: false }, signal)).account; }
  async models(signal) {
    const models = [];
    let cursor;
    const seen = new Set();
    do {
      const result = await this.request('model/list', { limit: 100, ...(cursor ? { cursor } : {}) }, signal);
      models.push(...(result.data ?? []));
      cursor = result.nextCursor;
      if (cursor && seen.has(cursor)) throw new CodexError('Codex model pagination repeated a cursor.', 'PROTOCOL_ERROR');
      seen.add(cursor);
    } while (cursor);
    return models;
  }
  async startThread(params, signal) {
    const result = await this.request('thread/start', params, signal);
    if (typeof result.thread?.id !== 'string') throw new CodexError('Codex returned no thread ID.', 'PROTOCOL_ERROR');
    this.queue(result.thread.id);
    return result.thread.id;
  }
  async startTurn(threadId, params, signal) {
    const result = await this.request('turn/start', { threadId, ...params }, signal);
    if (typeof result.turn?.id !== 'string') throw new CodexError('Codex returned no turn ID.', 'PROTOCOL_ERROR');
    return result.turn.id;
  }
  interrupt(threadId, turnId) { return this.request('turn/interrupt', { threadId, turnId }, undefined, 5000); }
  async release(threadId, turnId) {
    this.retired.add(threadId);
    if (this.retired.size > 1024) this.retired.delete(this.retired.values().next().value);
    this.queues.get(threadId)?.fail(new CodexError('Thread was released.', 'ABORTED'));
    this.queues.delete(threadId);
    if (!this.child) return;
    if (turnId) await this.interrupt(threadId, turnId).catch(() => {});
    await this.request('thread/unsubscribe', { threadId }, undefined, 5000).catch(() => {});
  }
  close() {
    if (this.child) this.fail(this.child, new CodexError('Codex provider stopped.', 'CODEX_DISCONNECTED'));
  }
}
