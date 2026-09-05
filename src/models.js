import { PROVIDER } from './runtime.js';
import { CodexError } from './errors.js';

const basic = ['low', 'medium', 'high', 'xhigh'];
// Fallback metadata was checked against the operator's working Codex catalog.
// Live account metadata wins; catalog membership never gates a model request.
export const CURATED = [
  ['gpt-6-astra', 'GPT-6 Astra', [...basic, 'max']],
  ['gpt-5.6-sol', 'GPT-5.6 Sol', [...basic, 'max']],
  ['gpt-5.6-terra', 'GPT-5.6 Terra', [...basic, 'max']],
  ['gpt-5.6-luna', 'GPT-5.6 Luna', [...basic, 'max']],
  ['gpt-5.5', 'GPT-5.5', basic],
  ['gpt-5.2', 'GPT-5.2', basic],
].map(([id, name, efforts]) => ({ id, model: id, displayName: name, supportedReasoningEfforts: efforts.map(reasoningEffort => ({ reasoningEffort })), defaultReasoningEffort: 'medium' }));

export class ModelCatalog {
  live = [];
  expires = 0;
  source = 'curated';
  discoveryIssue;
  constructor(server, { ttlMs = 60_000 } = {}) { this.server = server; this.ttlMs = ttlMs; }
  invalidate() { this.expires = 0; this.live = []; this.source = 'curated'; }
  async refresh(signal, force = false) {
    if (!force && this.expires > Date.now()) return;
    try {
      const live = await this.server.models(signal);
      this.live = live.filter(m => typeof (m.model ?? m.id) === 'string' && !m.hidden);
      this.discoveryIssue = this.live.length ? undefined : 'Account discovery returned no models; curated models remain available.';
      this.source = this.live.length ? 'account + curated' : 'curated';
    } catch (error) {
      if (signal?.aborted) throw error;
      this.discoveryIssue = 'Account model discovery is unavailable; using the saved and curated list.';
      this.source = this.live.length ? 'cached + curated' : 'curated';
    }
    this.expires = Date.now() + this.ttlMs;
  }
  entries() {
    const merged = new Map(CURATED.map(m => [m.model, m]));
    for (const m of this.live) merged.set(m.model ?? m.id, { ...merged.get(m.model ?? m.id), ...m });
    return [...merged.values()];
  }
  info(m) {
    return { provider: PROVIDER, id: m.model ?? m.id, name: m.displayName ?? m.model ?? m.id, inputModalities: ['text'] };
  }
  async list(signal) { await this.refresh(signal); return this.entries().map(m => this.info(m)); }
  async resolve(provider, id, signal) {
    signal?.throwIfAborted();
    if (provider !== PROVIDER || typeof id !== 'string' || !id.trim()) throw new CodexError('A valid Codex provider and model ID are required.', 'INVALID_REQUEST');
    await this.refresh(signal);
    const m = this.entries().find(m => m.model === id || m.id === id) ?? { id };
    const efforts = (m.supportedReasoningEfforts ?? []).filter(e => typeof e.reasoningEffort === 'string').map(e => ({ id: e.reasoningEffort, name: e.reasoningEffort, ...(e.description ? { description: e.description } : {}) }));
    return { ...this.info(m), id, ...(efforts.length ? { reasoning: { efforts, ...(efforts.some(e => e.id === m.defaultReasoningEffort) ? { defaultEffort: m.defaultReasoningEffort } : {}) } } : {}) };
  }
}
