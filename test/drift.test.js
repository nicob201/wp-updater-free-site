// demo/app.js is the tool's page as it ships. When a release needs something the fake doesn't do, these
// fail, instead of the demo breaking quietly
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createFake, run, PORTED_FROM } = require('../demo/bridge.js');

const read = file => fs.readFileSync(path.join(__dirname, '..', 'demo', file), 'utf8');
const APP = read('app.js');
const S = run(read('state.js'));
const C = run(read('config.js'));
const routes = () => [...new Set([...APP.matchAll(/'(\/api\/\w+)'/g)].map(m => m[1]))];

test('the fake answers every route app.js calls', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const fake = createFake({ S, C });
  const posted = routes().filter(r => r !== '/api/events');   // events is the EventSource, which connect() serves
  assert.ok(posted.length >= 6, 'app.js calls fewer routes than expected: did the regex stop matching?');
  for (const r of posted) assert.notEqual((await fake.request(r)).status, 404, `app.js calls ${r}, which the fake doesn't answer`);
  assert.ok(routes().includes('/api/events'));
});

test('the fake sets every state field app.js reads', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const fake = createFake({ S, C });
  for (const name of new Set([...APP.matchAll(/\bstate\.(\w+)/g)].map(m => m[1])))
    assert.ok(name in fake.state, `app.js reads state.${name}, which the fake never sets`);
});

test("a module that requires something the demo doesn't have stops loudly", () => {
  assert.throws(() => run("const util = require('node:util'); module.exports = util.format('x');"), /requires node:util, which the demo doesn't have/);
  assert.match(C.validate({ servers: [{ name: 'New', host: 'new.example', user: 'me' }] }).servers[0].id, /^[a-f0-9]{8}$/);
});

test('app.js listens only to the events the fake sends', () => {
  assert.deepEqual([...APP.matchAll(/source\.addEventListener\('(\w+)'/g)].map(m => m[1]), ['state', 'log']);
});

test('the bridge was checked against the tool files of this release', () => {
  const now = JSON.parse(read('upstream.json'));
  const changed = Object.keys(now).filter(f => PORTED_FROM[f] !== now[f]);
  assert.deepEqual(changed, [], `The release changed ${changed.join(', ')}: compare demo/bridge.js with them, then copy their hashes from demo/upstream.json into PORTED_FROM`);
  assert.deepEqual(Object.keys(PORTED_FROM), Object.keys(now));
});
