const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../demo/state.js');
const C = require('../demo/config.js');
const { createFake, SERVERS } = require('../demo/bridge.js');

const SHARED = SERVERS[0].id, VPS = SERVERS[1].id;
const SHOP = `${SHARED}:/home/u1234567/domains/shop.example/public_html`;
const STAGING = `${SHOP}/staging`;
const CLINIC = `${SHARED}:/home/u1234567/domains/clinic.example/public_html`;
const PORTFOLIO = `${SHARED}:/home/u1234567/domains/portfolio.example/public_html`;
const NEWS = `${VPS}:/var/www/news`;
const BLOG = `${VPS}:/var/www/blog`;

// Node's mock timers fire a timer set by another timer only on the next tick, so the clock moves in
// small steps: every fake delay is a multiple of 10 ms
const wait = (t, ms) => { for (let i = 0; i < ms; i += 10) t.mock.timers.tick(10); };
const settle = t => wait(t, 60000);   // long after anything the fake does

// A fake started at a fixed time, on fake timers
function boot(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-10-23T12:00:00Z') });
  const events = [], pushes = [];
  const fake = createFake({ S, C, onEvent: name => events.push(name) });
  fake.connect((event, data) => pushes.push({ event, data }));
  return { fake, events, pushes, site: id => fake.state.sites[id] };
}

test('on start it lists both servers and finds every case the tool handles', t => {
  const { fake, site } = boot(t);
  assert.equal(fake.state.listing, true);
  settle(t);
  assert.equal(fake.state.listing, false);
  assert.equal(Object.keys(fake.state.sites).length, 6);
  assert.ok(fake.state.checked > Date.parse('2026-10-23T12:00:00Z'));
  assert.equal(site(SHOP).status, 'duplicate');
  assert.equal(site(STAGING).status, 'duplicate');
  assert.match(site(STAGING).reason, /^Shares its database with https:\/\/shop\.example$/);
  assert.equal(site(PORTFOLIO).status, 'up-to-date');
  assert.deepEqual([CLINIC, NEWS, BLOG].map(id => site(id).status), ['pending', 'pending', 'pending']);
  assert.equal(site(NEWS).unavailable.find(i => i.name === 'jetpack').needs, 'PHP 8.3');
  assert.ok(site(CLINIC).skipped.some(i => i.name === 'elementor-pro'));
  assert.ok(site(NEWS).pending.some(i => i.type === 'core' && i.next === '7.1.3'));
  assert.ok(new Set(Object.values(fake.state.sites).map(s => s.wp)).size >= 3);
  assert.ok(site(PORTFOLIO).lastFull && !site(CLINIC).lastFull);
});

test('it lists in about three seconds, both servers at once', t => {
  const { fake } = boot(t);
  wait(t, 3000);
  assert.equal(fake.state.listing, false);
  assert.equal(Object.values(fake.state.sites).filter(s => s.status === 'checking').length, 0);
});

test('connect sends the whole state with its log, then pushes it without the log', t => {
  const { pushes } = boot(t);
  assert.equal(pushes[0].event, 'state');
  assert.ok(Array.isArray(pushes[0].data.log));
  settle(t);
  const later = pushes.slice(1);
  assert.ok(later.some(p => p.event === 'state'));
  assert.ok(later.filter(p => p.event === 'state').every(p => !('log' in p.data)));
  assert.ok(later.filter(p => p.event === 'log').every(p => typeof p.data === 'string'));
  assert.ok(later.some(p => p.event === 'log' && p.data.startsWith(`{"server":"${SHARED}"`)));
});

test('every fake address is a reserved name', t => {
  const { fake } = boot(t);
  settle(t);
  for (const s of Object.values(fake.state.sites)) assert.match(s.url, /^https:\/\/[a-z0-9.-]+\.(example|test)(\/|$)/);
  for (const s of fake.state.config.servers) assert.match(s.host, /\.(example|test)$/);
});

test('the servers answer like the tool', t => {
  const { fake } = boot(t);
  settle(t);
  for (const { id } of SERVERS) assert.deepEqual(fake.state.servers[id], { ssh: true, message: null, rsync: true });
  assert.match(fake.state.publicKey, /^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI[A-Za-z0-9+/]{43} wp-updater$/);
  assert.equal(fake.state.hardlinks, true);
});

test('check for updates lists again, and only one listing runs at a time', async t => {
  const { fake } = boot(t);
  assert.deepEqual(await fake.request('/api/list'), { status: 409 });
  settle(t);
  const before = fake.state.checked;
  assert.deepEqual(await fake.request('/api/list'), { status: 202 });
  assert.equal(fake.state.listing, true);
  settle(t);
  assert.ok(fake.state.checked > before);
});
