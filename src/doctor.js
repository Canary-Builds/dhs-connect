#!/usr/bin/env node
import { AppServer } from './transport.js';
import { ModelCatalog } from './models.js';
import { CodexAdapter } from './adapter.js';
import { createController } from './http.js';
import { codexInstalled } from './runtime.js';
import { GrokServer } from './grok-transport.js';
import { GrokCatalog } from './grok-models.js';
import { GrokAdapter } from './grok-adapter.js';
import { GrokLogin } from './grok-device.js';
import { safeMessage } from './errors.js';
const server = new AppServer();
const grokServer = new GrokServer();
const grokLogin = new GrokLogin();
try {
  const catalog = new ModelCatalog(server);
  const adapter = new CodexAdapter(server, catalog);
  const grokCatalog = new GrokCatalog(grokServer);
  const grok = { server: grokServer, catalog: grokCatalog, adapter: new GrokAdapter(grokServer, grokCatalog), login: grokLogin };
  const controller = createController(server, catalog, adapter, { installed: codexInstalled, grok });
  const status = await controller.status(AbortSignal.timeout(60_000));
  console.log(JSON.stringify(status, null, 2));
  const chatgptOk = status.installed !== false && status.authenticated && !status.connectionIssue;
  const grokOk = status.grok?.authenticated && !status.grok.connectionIssue;
  if (!chatgptOk && !grokOk) process.exitCode = 1;
} catch (error) { console.error(safeMessage(error)); process.exitCode = 1; }
finally { server.close(); grokServer.close(); grokLogin.stop(); }