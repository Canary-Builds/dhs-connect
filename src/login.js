#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { runtime } from './runtime.js';
import { safeMessage } from './errors.js';

try {
  const launch = runtime();
  await mkdir(launch.env.CODEX_HOME, { recursive: true, mode: 0o700 });
  const args = process.argv.slice(2);
  const child = spawn(launch.command, ['login', ...args], { env: launch.env, stdio: 'inherit' });
  child.on('error', error => { console.error(safeMessage(error)); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
} catch (error) { console.error(safeMessage(error)); process.exitCode = 1; }
