import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { CodexError } from './errors.js';

export const VERSION = '0.3.0';
export const PROVIDER = 'openai-codex';
export function configuration(env = process.env) {
  const file = env.DSH_CONNECT_CONFIG || join(env.DSH_HOME || join(homedir(), '.dsh'), 'connect.json');
  if (!existsSync(file)) return {};
  try {
    const config = JSON.parse(readFileSync(file, 'utf8'));
    if (!config || Array.isArray(config) || typeof config !== 'object') throw new Error();
    for (const key of Object.keys(config)) {
      if (!['codexBin', 'codexHome', 'noProxy'].includes(key) || typeof config[key] !== 'string') throw new Error();
    }
    return config;
  } catch { throw new CodexError('Invalid DSH Connect configuration. Expected an object containing codexBin, codexHome or noProxy strings.', 'INVALID_CONFIG'); }
}
export function codexHome(env = process.env, config = configuration(env)) {
  const configured = env.DSH_CODEX_HOME?.trim() || config.codexHome;
  return configured ? resolve(configured) : join(homedir(), '.deepseek-harness', 'codex');
}
export function runtime(env = process.env) {
  const config = configuration(env);
  const explicit = env.DSH_CODEX_BIN?.trim() || config.codexBin;
  const candidates = explicit ? [resolve(explicit)] : (env.PATH || '').split(delimiter).filter(Boolean).map(dir => join(dir, process.platform === 'win32' ? 'codex.exe' : 'codex'));
  const command = candidates.find(path => { try { accessSync(path, constants.X_OK); return true; } catch { return false; } });
  if (!command) throw new CodexError('Codex executable not found. Install the official Codex CLI or set DSH_CODEX_BIN to its executable path.', 'CODEX_BINARY_MISSING');
  const childEnv = { ...env, CODEX_HOME: codexHome(env, config) };
  const extraNoProxy = env.DSH_CONNECT_NO_PROXY ?? config.noProxy;
  if (extraNoProxy) {
    const noProxy = [...new Set([env.NO_PROXY, env.no_proxy, extraNoProxy].filter(Boolean).flatMap(s => s.split(',')).map(s => s.trim()).filter(Boolean))].join(',');
    childEnv.NO_PROXY = noProxy;
    childEnv.no_proxy = noProxy;
  }
  return { command, env: childEnv };
}
// Harness owns tool execution, its permission checks, and agent delegation.
export const CODEX_ARGS = [
  ...['shell_tool', 'goals', 'apps', 'browser_use', 'computer_use', 'hooks', 'image_generation', 'in_app_browser', 'multi_agent', 'plugins', 'skill_search', 'tool_suggest', 'unified_exec', 'workspace_dependencies']
    .flatMap(feature => ['-c', `features.${feature}=false`]),
  '-c', 'web_search="disabled"', '-c', 'agents.enabled=false', '-c', 'tools.view_image=false', '-c', 'project_doc_max_bytes=0',
];
