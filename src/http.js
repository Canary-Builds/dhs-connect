import { isIP } from 'node:net';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { runtime, VERSION } from './runtime.js';
import { grokRuntime, allowedGrokHost } from './grok-runtime.js';
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
async function commandVersion(resolveLaunch, pattern) {
  const launch = resolveLaunch();
  const { stdout } = await promisify(execFile)(launch.command, ['--version'], { env: launch.env, timeout: 5000 });
  return pattern.exec(stdout)?.[0] ?? stdout.trim().split('\n')[0] ?? 'unknown';
}
export async function binaryVersion() {
  return commandVersion(runtime, /^codex-cli [\w.+-]+/);
}
export function createController(server, catalog, adapter, { version = binaryVersion, grok } = {}) {
  let versionPromise;
  let grokVersionPromise;
  async function status(signal) {
    let account;
    let connectionIssue;
    try { account = await server.account(signal); }
    catch (error) { if (signal?.aborted) throw error; connectionIssue = safeMessage(error); }
    const models = await catalog.list(signal);
    versionPromise ??= version().catch(() => 'unavailable');
    let grokStatus = null;
    if (grok) {
      let grokAccount;
      let grokIssue;
      try { grokAccount = await grok.server.account(signal); }
      catch (error) { if (signal?.aborted) throw error; grokIssue = safeMessage(error); }
      const grokModels = await grok.catalog.list(signal);
      grokVersionPromise ??= commandVersion(grokRuntime, /^grok\s+\S+/i).catch(() => 'unavailable');
      const pending = grok.login.snapshot?.() ?? {};
      grokStatus = {
        authenticated: grokAccount?.type === 'grok',
        grokVersion: await grokVersionPromise,
        models: grokModels,
        modelSource: grok.catalog.source,
        discoveryIssue: grok.catalog.discoveryIssue ?? null,
        connectionIssue: grokIssue ?? null,
        authUrl: pending.authUrl ?? null,
        userCode: pending.userCode ?? null,
        pending: Boolean(pending.pending),
        activeSessions: grok.adapter.sessions?.size ?? 0,
      };
    }
    return {
      pluginVersion: VERSION, codexVersion: await versionPromise, authenticated: account?.type === 'chatgpt',
      planType: account?.type === 'chatgpt' ? account.planType ?? null : null,
      models, modelSource: catalog.source, discoveryIssue: catalog.discoveryIssue ?? null,
      connectionIssue: connectionIssue ?? null, activeSessions: adapter.sessions.size,
      capabilities: ['Text streaming', 'Harness tool calls', 'Reasoning', 'Conversation recovery'],
      grok: grokStatus,
    };
  }
  const json = (res, code, body) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(JSON.stringify(body));
  };
  async function handler(req, res) {
    if (!trustedRequest(req)) return json(res, 403, { error: 'Use the trusted Harness UI to manage DSH Connect.' });
    const controller = new AbortController();
    const disconnected = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', disconnected);
    try {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (req.method === 'GET' && path === API_PATH) return json(res, 200, await status(controller.signal));
      if (req.method === 'POST' && path === `${API_PATH}/refresh`) {
        await catalog.refresh(controller.signal, true);
        if (grok) await grok.catalog.refresh(controller.signal, true).catch(error => { if (controller.signal.aborted) throw error; });
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
      if (grok && req.method === 'POST' && path === `${API_PATH}/grok/login`) {
        const login = await grok.login.start();
        const url = new URL(login.authUrl);
        if (url.protocol !== 'https:' || !allowedGrokHost(url.hostname)) throw new Error('Grok returned an unexpected sign-in address.');
        grok.catalog.invalidate();
        return json(res, 200, { authUrl: login.authUrl, userCode: login.userCode ?? null });
      }
      if (grok && req.method === 'POST' && path === `${API_PATH}/grok/logout`) {
        await grok.adapter.clear();
        await grok.login.logout();
        grok.server.close();
        grok.catalog.invalidate();
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: 'Unknown DSH Connect endpoint.' });
    } catch (error) {
      if (!res.destroyed) return json(res, 503, { error: safeMessage(error) });
    } finally { res.off('close', disconnected); }
  }
  return { status, route: { kind: 'prefix', path: API_PATH, handler } };
}
