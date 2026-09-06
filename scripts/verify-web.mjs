import { VERSION } from '../src/runtime.js';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
const base = process.env.DSH_WEB_URL ?? 'http://127.0.0.1:3080';
const hostRequire = createRequire(process.env.DSH_RUNTIME_PACKAGE ?? join(dirname(dirname(process.execPath)), 'lib/node_modules/@deepseek-ai/dsh/package.json'));
const rendererRequire = createRequire(hostRequire.resolve('@deepseek-ai/dsh-client-ui-trajectory/package.json'));
const React = rendererRequire('react');
const ReactDOMServer = rendererRequire('react-dom/server');
async function get(path) {
  const response = await fetch(base + path, { signal: AbortSignal.timeout(60_000) });
  assert.equal(response.status, 200, path);
  return response.text();
}
const html = await get('/');
const bootText = html.match(/globalThis\["__DSH_BOOT__"\]\s*=\s*([\s\S]*?)<\/script>/)[1];
const boot = JSON.parse(bootText.trim().replace(/;$/, ''));
assert.ok(!boot.entries.some(row => row.id === 'dsh-openai-oauth'));
const id = '@canary-builds/dsh-connect';
const row = boot.entries.find(entry => entry.id === id);
assert.ok(row);
const target = { mode: 'queue', pendingQueue: [], load(registration) { this.pendingQueue.push(registration); } };
const context = vm.createContext({ window: { __ModuleLoader__: target } });
const loaderId = '@deepseek-ai/dsh-client-modules';
const loaderRow = boot.entries.find(entry => entry.id === loaderId);
vm.runInContext(await get(loaderRow.url), context);
const registration = target.pendingQueue.pop();
const loaderExports = registration.factory(() => { throw Error('Unexpected bootstrap dependency'); });
const downloaded = new Map();
const modules = loaderExports.createClientModuleSystem(target, { id: loaderId, exports: loaderExports }, {
  boot, staticModules: { react: React, 'react/jsx-runtime': rendererRequire('react/jsx-runtime') },
  loadBundle: async url => { const source = await get(url); downloaded.set(url, source); vm.runInContext(source, context, { filename: url }); },
});
const plugin = await modules.import(id);
assert.equal(typeof plugin.apply, 'function');
let registered;
plugin.apply({ slots: { inject: (slot, callback) => callback(), register: (options, component) => { registered = { options, component }; } } });
assert.equal(registered.options.id, 'dsh-connect');
assert.equal(registered.component, plugin.CodexSettings);
const markup = ReactDOMServer.renderToStaticMarkup(React.createElement(plugin.CodexSettings));
assert.match(markup, /DSH Connect/);
assert.match(markup, /Models/);
const hash = createHash('sha1').update(downloaded.get(row.url)).digest('hex').slice(0, 12);
assert.equal(row.rev, hash);
const status = JSON.parse(await get('/api/dsh-connect'));
assert.equal(status.pluginVersion, VERSION);
assert.equal(status.authenticated, true);
assert.ok(status.models.length > 0);
assert.equal(status.connectionIssue, null);
const denied = await fetch(base + '/api/dsh-connect/logout', { method: 'POST', headers: { 'sec-fetch-site': 'cross-site' } });
assert.equal(denied.status, 403);
console.log(JSON.stringify({ clientImport: 'passed', settingsRender: 'passed', bundleRevision: row.rev, pluginVersion: status.pluginVersion, codexVersion: status.codexVersion, authenticated: status.authenticated, modelSource: status.modelSource, modelCount: status.models.length, crossSiteRequest: 'rejected' }, null, 2));
