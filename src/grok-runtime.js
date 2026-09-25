import { accessSync, constants } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { configuration } from './runtime.js';
import { CodexError } from './errors.js';

export const GROK_PROVIDER = 'xai-grok';

export function allowedGrokHost(hostname) {
  return hostname === 'x.ai' || hostname.endsWith('.x.ai') || hostname === 'grok.com' || hostname.endsWith('.grok.com');
}

export function grokHome(env = process.env, config = configuration(env)) {
  const configured = env.DSH_GROK_HOME?.trim() || config.grokHome;
  return configured ? resolve(configured) : join(homedir(), '.grok');
}

export function grokRuntime(env = process.env) {
  const config = configuration(env);
  const explicit = env.DSH_GROK_BIN?.trim() || config.grokBin;
  const candidates = explicit ? [resolve(explicit)] : (env.PATH || '').split(delimiter).filter(Boolean).map(dir => join(dir, process.platform === 'win32' ? 'grok.exe' : 'grok'));
  const command = candidates.find(path => { try { accessSync(path, constants.X_OK); return true; } catch { return false; } });
  if (!command) throw new CodexError('Grok executable not found. Install the official Grok CLI or set DSH_GROK_BIN to its executable path.', 'GROK_BINARY_MISSING');
  const home = grokHome(env, config);
  const childEnv = { ...env, GROK_HOME: home };
  const extraNoProxy = env.DSH_CONNECT_NO_PROXY ?? config.noProxy;
  if (extraNoProxy) {
    const noProxy = [...new Set([env.NO_PROXY, env.no_proxy, extraNoProxy].filter(Boolean).flatMap(s => s.split(',')).map(s => s.trim()).filter(Boolean))].join(',');
    childEnv.NO_PROXY = noProxy;
    childEnv.no_proxy = noProxy;
  }
  return { command, env: childEnv, home, cwd: join(tmpdir(), 'dsh-connect-grok') };
}
export function grokInstalled(env = process.env) {
  try { grokRuntime(env); return true; }
  catch (error) {
    if (error.code === 'GROK_BINARY_MISSING') return false;
    throw error;
  }
}
