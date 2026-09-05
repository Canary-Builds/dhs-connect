export function safeMessage(error) {
  return String(error?.message ?? error ?? 'Codex failed')
    .replace(/https?:\/\/[^\s"<>]*\?[^\s"<>]*/gi, '[URL query redacted]')
    .replace(/\b(?:sk-|gh[pousr]_|tskey-|eyJ)[\w./+=-]+/g, '[redacted]')
    .replace(/(?:bearer\s+)[^\s"']+/gi, 'Bearer [redacted]')
    .replace(/(?:access_token|refresh_token|id_token|api_key|password)\s*["']?\s*[:=]\s*["']?[^\s,"'}]+/gi, '[credential redacted]')
    .slice(0, 1000);
}
export class CodexError extends Error {
  constructor(message, code = 'CODEX_ERROR') {
    super(safeMessage(message));
    this.name = 'CodexError';
    this.code = code;
    this.failure = { message: this.message, code };
  }
}
export function abortable(promise, signal) {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
