// Factory body compiled by scripts/build.mjs. No Node imports or browser bundler.
const React = require('react');
const h = React.createElement;
const inject = ['slots'];
const styles = {
  root: { maxWidth: 820, display: 'flex', flexDirection: 'column', gap: 20, color: 'var(--dsw-alias-label-primary)' },
  card: { padding: 20, border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 12, background: 'var(--dsw-alias-bg-layer-3)' },
  row: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
  muted: { color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.6 },
  button: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, padding: '8px 14px', background: 'var(--dsw-alias-bg-layer-1)', color: 'inherit', cursor: 'pointer' },
  table: { width: '100%', borderCollapse: 'collapse', textAlign: 'left', lineHeight: 2.1 },
  code: { fontFamily: 'monospace', fontSize: 12, overflowWrap: 'anywhere' },
  footer: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, fontSize: 12, borderTop: '1px solid var(--dsw-alias-border-l2)', paddingTop: 12 },
  link: { color: 'var(--dsw-alias-label-secondary)', textUnderlineOffset: 3 },
  issue: { color: 'var(--dsw-alias-state-error-primary, #c44)', lineHeight: 1.5 },
};
async function request(path = '', method = 'GET', signal) {
  const response = await fetch('/api/dsh-connect' + path, { method, credentials: 'same-origin', headers: { accept: 'application/json' }, signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Codex connection is unavailable.');
  return body;
}
function CodexSettings() {
  const [state, setState] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [waiting, setWaiting] = React.useState(false);
  const [authUrl, setAuthUrl] = React.useState('');
  const load = React.useCallback(async signal => {
    const next = await request('', 'GET', signal);
    setState(next);
    if (next.authenticated) { setWaiting(false); setAuthUrl(''); }
    return next;
  }, []);
  React.useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [load]);
  React.useEffect(() => {
    if (!waiting) return;
    const controller = new AbortController();
    let timer;
    const poll = async () => {
      try { const next = await load(controller.signal); if (next.authenticated) return; }
      catch (e) { if (!controller.signal.aborted) setError(e.message); }
      if (!controller.signal.aborted) timer = setTimeout(poll, 2000);
    };
    timer = setTimeout(poll, 2000);
    const expiry = setTimeout(() => { setWaiting(false); setAuthUrl(''); setError('Sign-in timed out. Check the SSH tunnel and start again.'); }, 5 * 60_000);
    return () => { controller.abort(); clearTimeout(timer); clearTimeout(expiry); };
  }, [waiting, load]);
  async function act(path) {
    setBusy(true); setError('');
    const popup = path === '/login' ? window.open('about:blank', '_blank') : null;
    if (popup) popup.opener = null;
    try {
      const result = await request(path, 'POST');
      if (path === '/login') {
        setAuthUrl(result.authUrl); setWaiting(true);
        if (popup) popup.location.href = result.authUrl;
      } else { setState(path === '/refresh' ? result : await load()); }
    } catch (e) { popup?.close(); setError(e.message); }
    finally { setBusy(false); }
  }
  const button = (label, action, extra = {}) => h('button', { type: 'button', style: styles.button, disabled: busy, onClick: action, ...extra }, label);
  return h('section', { style: styles.root },
    h('div', null, h('h2', { style: { marginBottom: 8 } }, 'DSH Connect'), h('p', { style: styles.muted }, 'Your ChatGPT models, connected to DeepSeek Harness.')),
    h('div', { style: styles.card },
      h('div', { style: styles.row, role: 'status', 'aria-live': 'polite' },
        h('strong', null, state ? state.authenticated ? 'Connected' : state.connectionIssue ? 'Connection unavailable' : 'Sign-in required' : 'Checking connection…'),
        state?.planType ? h('span', { style: styles.muted }, state.planType) : null),
      state ? h('p', { style: styles.muted }, `Plugin ${state.pluginVersion} · ${state.codexVersion}`) : null,
      h('div', { style: styles.row },
        state?.authenticated ? button('Sign out', () => act('/logout')) : button(waiting ? 'Waiting for sign-in…' : 'Sign in with ChatGPT', () => act('/login'), { disabled: busy || waiting }),
        button('Refresh connection & models', () => act('/refresh')),
        waiting ? button('Stop waiting', () => { setWaiting(false); setAuthUrl(''); }) : null),
      authUrl ? h('p', null, h('a', { href: authUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Continue sign-in')) : null,
      error || state?.connectionIssue ? h('p', { style: styles.issue, role: 'alert' }, error || state.connectionIssue) : null),
    !state?.authenticated ? h('div', { style: styles.card },
      h('strong', null, 'Signing in from another computer'),
      h('p', { style: styles.muted }, 'Keep this SSH tunnel open on the computer running your browser before signing in. It forwards the login callback to the agent VM.'),
      h('code', { style: styles.code }, 'ssh -N -o ExitOnForwardFailure=yes -L 1455:127.0.0.1:1455 user@harness-host'),
      h('p', { style: styles.muted }, 'For terminal sign-in on the server: dsh-connect-login --device-auth')) : null,
    h('div', { style: styles.card },
      h('h3', { style: { marginTop: 0 } }, 'Models'),
      h('p', { style: styles.muted }, state ? `Source: ${state.modelSource}. Account access is checked when you send a message.` : 'Loading model catalog…'),
      state?.discoveryIssue ? h('p', { style: styles.muted }, state.discoveryIssue) : null,
      h('table', { style: styles.table }, h('thead', null, h('tr', null, h('th', null, 'Model'), h('th', null, 'Model ID'))), h('tbody', null,
        ...(state?.models ?? []).map(model => h('tr', { key: model.id }, h('td', null, model.name), h('td', { style: styles.code }, model.id)))))),
    h('p', { style: styles.muted }, 'Supports text, reasoning, and Harness tool calls. Image attachments are not supported by this provider yet.'),
    h('footer', { style: styles.footer },
      h('a', { href: 'https://github.com/Canary-Builds/dhs-connect/issues', target: '_blank', rel: 'noopener noreferrer', style: styles.link }, 'Report an issue'),
      h('a', { href: 'https://canarybuilds.com', target: '_blank', rel: 'noopener noreferrer', style: { ...styles.link, marginLeft: 'auto' } }, 'Canary Builds'))
  );
}
function apply(ctx) {
  ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'dsh-connect', label: () => 'DSH Connect', order: 11 }, CodexSettings));
}
