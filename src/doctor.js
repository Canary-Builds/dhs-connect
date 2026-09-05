#!/usr/bin/env node
import { AppServer } from './transport.js';
import { ModelCatalog } from './models.js';
import { CodexAdapter } from './adapter.js';
import { createController } from './http.js';
import { safeMessage } from './errors.js';
const server = new AppServer();
try {
  const catalog = new ModelCatalog(server);
  const controller = createController(server, catalog, new CodexAdapter(server, catalog));
  const status = await controller.status(AbortSignal.timeout(60_000));
  console.log(JSON.stringify(status, null, 2));
  if (status.connectionIssue || !status.authenticated) process.exitCode = 1;
} catch (error) { console.error(safeMessage(error)); process.exitCode = 1; }
finally { server.close(); }
