import { AppServer } from './transport.js';
import { ModelCatalog } from './models.js';
import { CodexAdapter } from './adapter.js';
import { createController } from './http.js';
import { PROVIDER } from './runtime.js';

export const name = 'llm-dsh-connect';
export const inject = ['llm'];
export function apply(ctx) {
  const server = new AppServer();
  const catalog = new ModelCatalog(server);
  const adapter = new CodexAdapter(server, catalog);
  const controller = createController(server, catalog, adapter);
  ctx.llm.registerAdapter([PROVIDER], adapter);
  ctx.effect(() => () => server.close(), 'dsh-connect.shutdown');
  ctx.inject(['webServer'], web => {
    web.effect(() => web.webServer.register(controller.route), 'dsh-connect.settings');
  });
}
export default { name, inject, apply };
