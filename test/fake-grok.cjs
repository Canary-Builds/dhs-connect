const readline = require('node:readline');
const mode = process.argv[2] || 'ok';
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
readline.createInterface({ input: process.stdin }).on('line', line => {
  const req = JSON.parse(line);
  if (req.method === 'initialize') {
    if (mode === 'exit') process.exit(7);
    if (mode === 'malformed') return process.stdout.write('not-json\n');
    if (mode === 'timeout') return;
    const authMethods = mode === 'signed-out' ? [{ id: 'xai.api_key' }] : [{ id: 'cached_token' }];
    return send({ id: req.id, result: { protocolVersion: 1, authMethods } });
  }
  if (req.method === 'authenticate') return send({ id: req.id, result: {} });
  if (req.method === 'session/new') return send({ id: req.id, result: { sessionId: 'sess-1' } });
  if (req.method === 'session/set_config_option') return send({ id: req.id, result: {} });
  if (req.method === 'session/prompt') {
    send({ method: 'session/update', params: { sessionId: req.params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { text: 'hello' } } } });
    return send({ id: req.id, result: { stopReason: 'end_turn', usage: { input_tokens: 4, output_tokens: 1 } } });
  }
  if (req.method === 'session/cancel') return send({ id: req.id, result: {} });
  if (req.method === 'session/request_permission') return;
  if (req.id !== undefined) send({ id: req.id, result: {} });
});
