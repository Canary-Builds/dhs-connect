import { isIP } from 'node:net';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { runtime, VERSION } from './runtime.js';
import { safeMessage } from './errors.js';

export const API_PATH = '/api/dsh-connect';
const isLoopback = host => host === '::1' || (isIP(host) === 4 && host.startsWith('127.'));
export function trustedRequest(req) {
  const remote = req.socket?.remoteAddress?.replace(/^::ffff:/, '');
  if (!isLoopback(remote ?? '') || req.headers['sec-fetch-site'] === 'cross-site') return false;
  try {
    const host = new URL(`http://${req.headers.host}`);
    const name = host.hostname.replace(/^\[|\]$/g, '');
    if (name !== 'localhost' && !isLoopback(name)) return false;
    return !req.headers.origin || new URL(req.headers.origin).origin === host.origin;
  } catch { return false; }
}
export async function binaryVersion() {
  const r = runtime();
  const { stdout } = await promisify(execFile)(r.command, ['--version'], { env: r.env, timeout: 5000 });
  return /^codex-cli [\w.+-]+/.exec(stdout)?.[0] ?? 'unknown';
}
export function createController(server, catalog, adapter, { version = binaryVersion } = {}) {
  let versionPromise;
  async function status(signal) {
    let account;
    let connectionIssue;
    try { account = await server.account(signal); }
    catch (error) { if (signal?.aborted) throw error; connectionIssue = safeMessage(error); }
    const models = await catalog.list(signal);
    versionPromise ??= version().catch(() => 'unavailable');
    return {
      pluginVersion: VERSION, codexVersion: await versionPromise, authenticated: account?.type === 'chatgpt',
      planType: account?.type === 'chatgpt' ? account.planType ?? null : null,
      models, modelSource: catalog.source, discoveryIssue: catalog.discoveryIssue ?? null,
      connectionIssue: connectionIssue ?? null, activeSessions: adapter.sessions.size,
      capabilities: ['Text streaming', 'Harness tool calls', 'Reasoning', 'Conversation recovery'],
    };
  }
  const json = (res, code, body) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(JSON.stringify(body));
  };
  async function handler(req, res) {
    if (!trustedRequest(req)) return json(res, 403, { error: 'Use the trusted Harness UI to manage Codex.' });
    const controller = new AbortController();
    const disconnected = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', disconnected);
    try {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (req.method === 'GET' && path === API_PATH) return json(res, 200, await status(controller.signal));
      if (req.method === 'POST' && path === `${API_PATH}/refresh`) {
        await catalog.refresh(controller.signal, true);
        return json(res, 200, await status(controller.signal));
      }
      if (req.method === 'POST' && path === `${API_PATH}/login`) {
        const login = await server.request('account/login/start', { type: 'chatgpt', useHostedLoginSuccessPage: true, appBrand: 'chatgpt' }, controller.signal);
        const url = new URL(login.authUrl);
        if (url.protocol !== 'https:' || url.hostname !== 'auth.openai.com') throw new Error('Codex returned an unexpected sign-in address.');
        catalog.invalidate();
        return json(res, 200, { authUrl: login.authUrl });
      }
      if (req.method === 'POST' && path === `${API_PATH}/logout`) {
        await adapter.clear();
        await server.request('account/logout', {}, controller.signal);
        catalog.invalidate();
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: 'Unknown DSH Connect endpoint.' });
    } catch (error) {
      if (!res.destroyed) return json(res, 503, { error: safeMessage(error) });
    } finally { res.off('close', disconnected); }
  }
  return { status, route: { kind: 'prefix', path: API_PATH, handler } };
}
