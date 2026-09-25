import { AppServer } from './transport.js';
import { ModelCatalog } from './models.js';
import { CodexAdapter } from './adapter.js';
import { createController } from './http.js';
import { PROVIDER, codexInstalled } from './runtime.js';
import { GrokServer } from './grok-transport.js';
import { GrokCatalog } from './grok-models.js';
import { GrokAdapter } from './grok-adapter.js';
import { GrokLogin } from './grok-device.js';
import { GROK_PROVIDER } from './grok-runtime.js';

export const name = 'llm-dsh-connect';
export const inject = ['llm'];
export function apply(ctx) {
  const server = new AppServer();
  const catalog = new ModelCatalog(server);
  const adapter = new CodexAdapter(server, catalog);
  const grokServer = new GrokServer();
  const grokCatalog = new GrokCatalog(grokServer);
  const grokAdapter = new GrokAdapter(grokServer, grokCatalog);
  const grokLogin = new GrokLogin();
  const controller = createController(server, catalog, adapter, { installed: codexInstalled, grok: { server: grokServer, catalog: grokCatalog, adapter: grokAdapter, login: grokLogin } });
  if (codexInstalled()) ctx.llm.registerAdapter([PROVIDER], adapter);
  ctx.llm.registerAdapter([GROK_PROVIDER], grokAdapter);
  ctx.effect(() => () => { server.close(); grokServer.close(); grokLogin.stop(); }, 'dsh-connect.shutdown');
  ctx.inject(['webServer'], web => {
    web.effect(() => web.webServer.register(controller.route), 'dsh-connect.settings');
  });
}
export default { name, inject, apply };
