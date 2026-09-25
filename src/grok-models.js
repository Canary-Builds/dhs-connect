import { GROK_PROVIDER } from './grok-runtime.js';
import { CodexError } from './errors.js';

const efforts = ['low', 'medium', 'high', 'xhigh'];
export const CURATED = [
  ['grok-4.7', 'Grok 4.7'],
  ['grok-4.6', 'Grok 4.6'],
  ['grok-4.5', 'Grok 4.5'],
  ['grok-4', 'Grok 4'],
  ['grok-build', 'Grok Build'],
].map(([id, name]) => ({ id, model: id, displayName: name, supportedReasoningEfforts: efforts.map(reasoningEffort => ({ reasoningEffort })), defaultReasoningEffort: 'medium' }));

export class GrokCatalog {
  live = [];
  expires = 0;
  source = 'curated';
  discoveryIssue;
  constructor(server, { ttlMs = 60_000 } = {}) { this.server = server; this.ttlMs = ttlMs; }
  invalidate() { this.expires = 0; this.live = []; this.source = 'curated'; }
  async refresh(signal, force = false) {
    if (!force && this.expires > Date.now()) return;
    try {
      const live = typeof this.server.discoverModels === 'function' ? await this.server.discoverModels(signal) : [];
      this.live = (live ?? []).filter(m => typeof (m.model ?? m.id) === 'string' && !m.hidden);
      this.discoveryIssue = undefined;
      this.source = this.live.length ? 'account + curated' : 'curated';
    } catch (error) {
      if (signal?.aborted) throw error;
      this.discoveryIssue = 'Grok model discovery is unavailable; using the curated list.';
      this.source = this.live.length ? 'cached + curated' : 'curated';
    }
    this.expires = Date.now() + this.ttlMs;
  }
  entries() {
    const merged = new Map(CURATED.map(m => [m.model, m]));
    for (const m of this.live) merged.set(m.model ?? m.id, { ...merged.get(m.model ?? m.id), ...m, model: m.model ?? m.id });
    return [...merged.values()];
  }
  info(m) {
    return { provider: GROK_PROVIDER, id: m.model ?? m.id, name: m.displayName ?? m.model ?? m.id, inputModalities: ['text'] };
  }
  async list(signal) { await this.refresh(signal); return this.entries().map(m => this.info(m)); }
  async resolve(provider, id, signal) {
    signal?.throwIfAborted();
    if (provider !== GROK_PROVIDER || typeof id !== 'string' || !id.trim()) throw new CodexError('A valid Grok provider and model ID are required.', 'INVALID_REQUEST');
    await this.refresh(signal);
    const m = this.entries().find(m => m.model === id || m.id === id) ?? { id, model: id };
    const options = (m.supportedReasoningEfforts ?? []).filter(e => typeof e.reasoningEffort === 'string').map(e => ({ id: e.reasoningEffort, name: e.reasoningEffort }));
    return { ...this.info(m), id, ...(options.length ? { reasoning: { efforts: options, ...(options.some(e => e.id === m.defaultReasoningEffort) ? { defaultEffort: m.defaultReasoningEffort } : {}) } } : {}) };
  }
}
