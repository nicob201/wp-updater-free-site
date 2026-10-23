const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createFake, run, SERVERS, T } = require('../demo/bridge.js');

// The tool's modules, run the way the page runs them
const S = run(fs.readFileSync(path.join(__dirname, '..', 'demo', 'state.js'), 'utf8'));
const C = run(fs.readFileSync(path.join(__dirname, '..', 'demo', 'config.js'), 'utf8'));

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

test('an update brings the sites up to date and says what changed', async t => {
  const { fake, events, site } = boot(t);
  settle(t);
  assert.deepEqual(await fake.request('/api/update', { sites: [CLINIC, NEWS, BLOG] }), { status: 202 });
  assert.deepEqual(events, ['demo-update']);
  wait(t, T.site + T.line + T.dump);
  assert.equal(fake.state.run.active, true);
  assert.equal(site(CLINIC).status, 'updating');
  assert.equal(site(CLINIC).step, 'updating');
  assert.deepEqual([NEWS, BLOG].map(id => site(id).status), ['queued', 'queued']);
  settle(t);
  assert.equal(fake.state.run.active, false);
  assert.equal(fake.state.run.code, 0);
  assert.deepEqual(fake.state.run.done, [CLINIC, NEWS, BLOG]);
  assert.deepEqual([CLINIC, NEWS, BLOG].map(id => site(id).status), ['up-to-date', 'up-to-date', 'up-to-date']);
  assert.equal(site(NEWS).wp, '7.1.3');
  assert.deepEqual(site(NEWS).result.find(r => r.type === 'core'), { type: 'core', name: 'WordPress', before: '7.0.2', after: '7.1.3' });
  assert.deepEqual(site(NEWS).result.find(r => r.name === 'akismet'), { type: 'plugin', name: 'akismet', before: '5.5', after: '5.6' });
  assert.deepEqual(site(BLOG).result.find(r => r.type === 'theme'), { type: 'theme', name: 'twentytwentyfive', before: '1.3', after: '1.4' });
  assert.ok(fake.state.log.includes('Success: Translations are up to date.'));
});

test('excluded and unavailable items are never updated', async t => {
  const { fake, site } = boot(t);
  settle(t);
  await fake.request('/api/update', { sites: [CLINIC, NEWS] });
  settle(t);
  assert.ok(site(CLINIC).result.some(r => r.name === 'contact-form-7'));
  assert.equal(site(NEWS).wp, '7.1.3');
  assert.deepEqual(site(CLINIC).skipped.map(i => [i.name, i.current]), [['elementor-pro', '4.0.1']]);
  assert.ok(!site(CLINIC).result.some(r => r.name === 'elementor-pro'));
  const jetpack = site(NEWS).unavailable.find(i => i.name === 'jetpack');
  assert.deepEqual([jetpack.current, jetpack.needs], ['15.0', 'PHP 8.3']);
});

test('busy answers 409 like the tool', async t => {
  const { fake } = boot(t);   // the first listing is still running
  assert.deepEqual(await fake.request('/api/update', { sites: [CLINIC] }), { status: 409 });
  assert.deepEqual(await fake.request('/api/backup', { sites: [CLINIC] }),
    { status: 409, data: { error: 'The sites are being checked. Try again when it finishes.' } });
  settle(t);
  await fake.request('/api/update', { sites: [CLINIC] });
  assert.deepEqual(await fake.request('/api/sizes', { sites: [CLINIC] }),
    { status: 409, data: { error: 'An update is running. Try again when it finishes.' } });
  assert.deepEqual(await fake.request('/api/update', { sites: [NEWS] }), { status: 409 });
  assert.deepEqual(await fake.request('/api/list'), { status: 409 });
  settle(t);
  // The run and the listing after it are over
  assert.equal(fake.state.listing, false);
  assert.deepEqual(await fake.request('/api/update', { sites: [NEWS] }), { status: 202 });
});

test('sites with nothing to update answer 400', async t => {
  const { fake } = boot(t);
  settle(t);
  for (const sites of [[PORTFOLIO], [SHOP], ['0000ffff:/x'], [], 'all', [CLINIC, 'nope']])
    assert.deepEqual(await fake.request('/api/update', { sites }), { status: 400 }, JSON.stringify(sites));
  assert.deepEqual(await fake.request('/api/update'), { status: 400 });
});

test('sizes, then a backup, leave a full copy dated now', async t => {
  const { fake, events, site } = boot(t);
  settle(t);
  assert.deepEqual(await fake.request('/api/sizes', { sites: [PORTFOLIO, CLINIC] }), { status: 202 });
  assert.deepEqual([PORTFOLIO, CLINIC].map(id => site(id).size), [{ status: 'measuring' }, { status: 'measuring' }]);
  wait(t, T.size * 2);
  assert.deepEqual([PORTFOLIO, CLINIC].map(id => site(id).size), [{ status: 'done', bytes: 320000000 }, { status: 'done', bytes: 850000000 }]);
  assert.deepEqual(await fake.request('/api/backup', { sites: [CLINIC] }), { status: 202 });
  assert.deepEqual(events, ['demo-backup']);
  wait(t, T.site + T.line);
  assert.deepEqual(site(CLINIC).backup, { status: 'copying', step: 'database', reason: null });
  settle(t);
  assert.match(site(CLINIC).lastFull.date, /^2026-10-23T12:0\d:\d\dZ$/);
  assert.equal(site(CLINIC).lastFull.bytes, 850000000);
  assert.deepEqual(site(CLINIC).backup, { status: 'done', step: null, reason: null });
  assert.equal(site(CLINIC).status, 'pending');
  assert.deepEqual(await fake.request('/api/backup', { sites: ['0000ffff:/x'] }),
    { status: 400, data: { error: "These sites can't be backed up right now." } });
  assert.deepEqual(await fake.request('/api/sizes', { sites: ['0000ffff:/x'] }),
    { status: 400, data: { error: "These sites can't be measured." } });
});

test('a new measuring replaces the one in progress', async t => {
  const { fake, site } = boot(t);
  settle(t);
  await fake.request('/api/sizes', { sites: [SHOP, CLINIC] });
  wait(t, T.size);
  await fake.request('/api/sizes', { sites: [NEWS] });
  // SHOP was measured; CLINIC, cut halfway, ends unknown, like a killed --sizes
  assert.deepEqual([SHOP, CLINIC, NEWS].map(id => site(id).size.status), ['done', 'error', 'measuring']);
  settle(t);
  assert.equal(site(NEWS).size.status, 'done');
  assert.equal(site(CLINIC).size.status, 'error', 'the cut measuring still answered');
});

test('excluding the staging copy frees the live site', async t => {
  const { fake, site } = boot(t);
  settle(t);
  const r = await fake.request('/api/config', { ...fake.state.config, excludedSites: [STAGING] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.config.excludedSites, [STAGING]);
  assert.deepEqual(fake.state.config, r.data.config);
  settle(t);
  assert.equal(site(STAGING).status, 'excluded');
  assert.equal(site(SHOP).status, 'pending');
  await fake.request('/api/update', { sites: [SHOP] });
  settle(t);
  assert.equal(site(SHOP).status, 'up-to-date');
  assert.equal(site(SHOP).wp, '7.1.3');
  assert.deepEqual(site(SHOP).skipped.map(i => i.name), ['elementor-pro']);
});

test("invalid settings answer 400 with the tool's own message", async t => {
  const { fake } = boot(t);
  settle(t);
  const servers = fake.state.config.servers.map((s, i) => (i ? s : { ...s, host: 'bad host' }));
  assert.deepEqual(await fake.request('/api/config', { ...fake.state.config, servers }),
    { status: 400, data: { error: 'Server "Shared hosting": invalid host.' } });
  assert.equal(fake.state.config.servers[0].host, 'shared.example');
  assert.deepEqual(await fake.request('/api/config', { ...fake.state.config, exclude: ['Not A Slug'] }),
    { status: 400, data: { error: '"Not A Slug" is not a valid plugin or theme name (use its slug, e.g. elementor-pro).' } });
});

test('settings are locked while an update runs', async t => {
  const { fake } = boot(t);
  settle(t);
  await fake.request('/api/update', { sites: [CLINIC] });
  assert.deepEqual(await fake.request('/api/config', fake.state.config),
    { status: 409, data: { error: 'An update is running. Try again when it finishes.' } });
});

test('saving during a listing restarts it', async t => {
  const { fake, pushes, site } = boot(t);
  wait(t, T.site);   // the first site of each server is being listed
  assert.equal(fake.state.listing, true);
  assert.equal((await fake.request('/api/config', { ...fake.state.config, excludedSites: [STAGING] })).status, 200);
  const saved = pushes.length;
  settle(t);
  // The dropped listing numbers the shared server's sites out of 4; the new one, without staging, out of 3
  const late = pushes.slice(saved).filter(p => p.event === 'log' && / \[\d\/4\] /.test(p.data));
  assert.deepEqual(late, [], 'lines of the dropped listing arrived after the save');
  assert.ok(pushes.slice(saved).some(p => p.event === 'log' && / \[\d\/3\] /.test(p.data)));
  assert.equal(fake.state.listing, false);
  assert.deepEqual(Object.values(fake.state.sites).filter(s => s.status === 'checking'), []);
  assert.equal(site(STAGING).status, 'excluded');
  assert.equal(site(SHOP).status, 'pending');
});

test('a new server answers OK and has no sites', async t => {
  const { fake } = boot(t);
  settle(t);
  const answer = fake.request('/api/test', { host: 'mine.example', port: 22, user: 'me', path: '' });
  wait(t, T.test);
  assert.deepEqual(await answer, { status: 200, data: { ok: true, message: 'OK' } });
  const servers = [...fake.state.config.servers, { name: 'Mine', host: 'mine.example', port: 22, user: 'me', path: '' }];
  const r = await fake.request('/api/config', { ...fake.state.config, servers });
  assert.equal(r.status, 200);
  const mine = r.data.config.servers[2].id;
  assert.match(mine, /^[a-f0-9]{8}$/);
  settle(t);
  assert.deepEqual(fake.state.servers[mine], { ssh: true, message: null, rsync: true });
  assert.equal(Object.values(fake.state.sites).filter(s => s.server === mine).length, 0);
  assert.equal(Object.keys(fake.state.sites).length, 6);
  assert.deepEqual(await fake.request('/api/test', { host: '-bad', port: 22, user: 'me' }),
    { status: 400, data: { error: 'Server "test": invalid host.' } });
});

test('deleting a server drops its sites', async t => {
  const { fake } = boot(t);
  settle(t);
  await fake.request('/api/config', { ...fake.state.config, servers: [fake.state.config.servers[0]] });
  settle(t);
  assert.ok(Object.values(fake.state.sites).every(s => s.server === SHARED));
  assert.deepEqual(Object.keys(fake.state.servers), [SHARED]);
});

test("each server lists the sites under its sites path, like updater.sh's find", async t => {
  const { fake } = boot(t);
  settle(t);
  const listWith = async paths => {
    const servers = fake.state.config.servers.map(s => ({ ...s, path: paths[s.id] }));
    assert.equal((await fake.request('/api/config', { ...fake.state.config, servers })).status, 200);
    settle(t);
    return Object.keys(fake.state.sites).sort();
  };
  assert.deepEqual(await listWith({ [SHARED]: '', [VPS]: '/srv' }), [CLINIC, PORTFOLIO, SHOP, STAGING].sort());
  // ~ is the account's home folder, and a sites path can be one site
  assert.deepEqual(await listWith({ [SHARED]: '~/domains/clinic.example/', [VPS]: '/var/www/news' }), [CLINIC, NEWS].sort());
  // find looks 5 levels deep: from /home, staging's wp-load.php is 6 levels down
  assert.deepEqual(await listWith({ [SHARED]: '/home', [VPS]: '/var' }), [BLOG, CLINIC, NEWS, PORTFOLIO, SHOP].sort());
});

test('the live log reads like updater.sh and WP-CLI', async t => {
  const { fake } = boot(t);
  settle(t);
  await fake.request('/api/update', { sites: [NEWS] });
  settle(t);
  const from = fake.state.log.indexOf(`===== [1/1] ${NEWS}`);
  assert.deepEqual(fake.state.log.slice(from, fake.state.log.indexOf('END code=0', from) + 1), [
    `===== [1/1] ${NEWS}`,
    `== ${NEWS}: database backup`,
    `== ${NEWS}: updating`,
    'Updating to version 7.1.3 (en_US)...',
    'Downloading update from https://downloads.wordpress.org/release/wordpress-7.1.3-no-content.zip...',
    'Unpacking the update...',
    'Cleaning up files...',
    'No files found that need cleaning up',
    'Success: WordPress updated successfully.',
    'Success: WordPress database upgraded successfully from db version 61833 to 62012.',
    'Enabling Maintenance mode...',
    'Downloading update from https://downloads.wordpress.org/plugin/akismet.5.6.zip...',
    'Unpacking the update...',
    'Installing the latest version...',
    'Removing the old version of the plugin...',
    'Plugin updated successfully.',
    'Disabling Maintenance mode...',
    'name\told_version\tnew_version\tstatus',
    'akismet\t5.5\t5.6\tUpdated',
    'Success: Updated 1 of 1 plugins.',
    'Success: Theme already updated.',
    'Success: Translations are up to date.',
    'Success: Translations are up to date.',
    'Success: Translations are up to date.',
    'Success: The cache was flushed.',
    `== ${NEWS}: OK`,
    '',   // lib/run.js puts END on its own line
    'END code=0',
  ]);
});

test('an Update all of the three ready sites takes about 15 s, short enough to watch to the end', async t => {
  const { fake } = boot(t);
  settle(t);
  await fake.request('/api/update', { sites: [CLINIC, NEWS, BLOG] });
  wait(t, 12000);
  assert.equal(fake.state.run.active, true, 'too fast to follow');
  wait(t, 4000);
  assert.equal(fake.state.run.active, false, 'too slow for a landing page');
});
