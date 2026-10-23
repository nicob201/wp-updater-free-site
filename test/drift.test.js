// demo/app.js is the tool's page as it ships. When a release needs something the fake doesn't do, these
// fail, instead of the demo breaking quietly
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../demo/state.js');
const C = require('../demo/config.js');
const { createFake } = require('../demo/bridge.js');

const APP = fs.readFileSync(path.join(__dirname, '..', 'demo', 'app.js'), 'utf8');
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
