const readline = require('node:readline');
const mode = process.argv[2];
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
readline.createInterface({ input: process.stdin }).on('line', line => {
  const req = JSON.parse(line);
  if (req.method === 'initialize') {
    if (mode === 'exit') process.exit(7);
    if (mode === 'malformed') return process.stdout.write('not-json\n');
    if (mode === 'timeout') return;
    return send({ id: req.id, result: {} });
  }
  if (req.method === 'initialized') return;
  if (req.method === 'crash') return process.exit(9);
  if (req.method === 'hang') return;
  if (req.method === 'unknown-request') {
    send({ id: 'server-request', method: 'item/commandExecution/requestApproval', params: {} });
    return send({ id: req.id, result: {} });
  }
  if (req.method === 'model/list') return send({ id: req.id, result: { data: req.params.cursor ? [{ id: 'second' }] : [{ id: 'first' }], nextCursor: req.params.cursor ? null : 'page-two' } });
  if (req.id !== undefined && req.method) send({ id: req.id, result: { account: { type: 'chatgpt' } } });
});
