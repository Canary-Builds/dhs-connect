import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { trustedRequest, createController, API_PATH } from '../src/http.js';
import { ModelCatalog } from '../src/models.js';
const request = (overrides = {}) => ({ method: 'GET', url: API_PATH, socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080' }, ...overrides });
test('generated client registers exactly the package name and its settings section', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  let registration;
  vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), { window: { __ModuleLoader__: { load: value => { registration = value; } } } });
  assert.equal(registration.id, pkg.name);
  const react = { createElement: (...args) => args, useState: value => [value, () => {}], useEffect() {}, useCallback: fn => fn };
  const client = registration.factory(name => { assert.equal(name, 'react'); return react; });
  let slot;
  client.apply({ slots: { inject: (name, callback) => callback(), register: (meta, component) => { slot = { meta, component }; } } });
  assert.equal(slot.meta.id, 'dsh-connect');
  assert.equal(slot.meta.label(), 'DSH Connect');
  assert.equal(client.CodexSettings()[0], 'section');
});
test('control endpoints preserve loopback and same-origin checks', () => {
  assert.equal(trustedRequest(request()), true);
  assert.equal(trustedRequest(request({ socket: { remoteAddress: '::ffff:127.0.0.1' } })), true);
  assert.equal(trustedRequest(request({ socket: { remoteAddress: '192.168.20.2' } })), false);
  assert.equal(trustedRequest(request({ headers: { host: 'evil.test' } })), false);
  assert.equal(trustedRequest(request({ headers: { host: '127.0.0.1:3080', origin: 'https://evil.test' } })), false);
  assert.equal(trustedRequest(request({ headers: { host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site' } })), false);
});
test('settings and picker share the curated fallback even when account discovery fails', async () => {
  const server = { account: async () => ({ type: 'chatgpt', planType: 'pro' }), models: async () => { throw new Error('unavailable'); } };
  const catalog = new ModelCatalog(server);
  const controller = createController(server, catalog, { sessions: new Map() }, { version: async () => 'codex-cli test' });
  const status = await controller.status();
  assert.deepEqual(status.models, await catalog.list());
  assert.equal(status.authenticated, true);
  assert.equal(status.modelSource, 'curated');
  assert.equal(JSON.stringify(status).includes('access_token'), false);
});
test('untrusted requests cannot sign out or initiate login', async () => {
  let called = false;
  const controller = createController({ request: async () => { called = true; } }, {}, {}, {});
  const res = new EventEmitter();
  res.writeHead = status => { res.status = status; };
  res.end = body => { res.body = JSON.parse(body); };
  await controller.route.handler(request({ method: 'POST', url: API_PATH + '/logout', headers: { host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site' } }), res);
  assert.equal(res.status, 403);
  assert.equal(called, false);
});
