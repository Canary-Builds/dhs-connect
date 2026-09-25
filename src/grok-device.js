import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { grokRuntime, allowedGrokHost } from './grok-runtime.js';
import { CodexError } from './errors.js';

export function parseDeviceLogin(text) {
  const urls = text.match(/https:\/\/[^\s"'<>]+/g) ?? [];
  const authUrl = urls.map(url => url.replace(/[),.;]+$/g, '')).find(url => {
    try { return new URL(url).protocol === 'https:' && allowedGrokHost(new URL(url).hostname); }
    catch { return false; }
  }) ?? null;
  const userCode = text.match(/\b[A-Z0-9]{4,}-[A-Z0-9]{4,}\b/)?.[0] ?? null;
  return { authUrl, userCode };
}

export class GrokLogin {
  child;
  output = '';
  authUrl;
  userCode;
  error;
  done = true;
  async start() {
    if (this.child) return this.snapshot();
    const launch = grokRuntime();
    await mkdir(launch.home, { recursive: true, mode: 0o700 });
    const child = spawn(launch.command, ['login', '--device-auth'], { env: launch.env, stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;
    this.output = '';
    this.authUrl = undefined;
    this.userCode = undefined;
    this.error = undefined;
    this.done = false;
    const onData = chunk => {
      this.output = (this.output + chunk.toString()).slice(-8000);
      const parsed = parseDeviceLogin(this.output);
      if (parsed.authUrl) this.authUrl = parsed.authUrl;
      if (parsed.userCode) this.userCode = parsed.userCode;
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', error => { this.error = error; this.done = true; this.child = undefined; });
    child.on('exit', code => {
      this.done = true;
      this.child = undefined;
      if (code) this.error = new CodexError(`Grok login exited (${code}).`, 'GROK_LOGIN_FAILED');
    });
    const started = Date.now();
    while (!this.authUrl && !this.done && Date.now() - started < 20_000) await new Promise(resolve => setTimeout(resolve, 100));
    if (!this.authUrl) throw new CodexError(this.error?.message || 'Grok did not return a sign-in URL. Run dsh-connect-grok-login on the server.', 'GROK_LOGIN_FAILED');
    const url = new URL(this.authUrl);
    if (url.protocol !== 'https:' || !allowedGrokHost(url.hostname)) throw new CodexError('Grok returned an unexpected sign-in address.', 'GROK_LOGIN_FAILED');
    return this.snapshot();
  }
  snapshot() {
    return { authUrl: this.authUrl ?? null, userCode: this.userCode ?? null, pending: Boolean(this.child) && !this.done };
  }
  stop() {
    this.child?.kill();
    this.child = undefined;
    this.done = true;
  }
  async logout() {
    this.stop();
    let launch;
    try { launch = grokRuntime(); }
    catch { return; }
    await new Promise(resolve => {
      const child = spawn(launch.command, ['logout'], { env: launch.env, stdio: 'ignore' });
      const timer = setTimeout(() => { child.kill(); resolve(); }, 5000);
      child.on('exit', () => { clearTimeout(timer); resolve(); });
      child.on('error', () => { clearTimeout(timer); resolve(); });
    });
  }
}
