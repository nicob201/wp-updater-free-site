// Stands in for WP Updater's local bridge (server.js) in the browser, so the tool's real page (app.js)
// runs against fake servers with fake sites. It answers the same routes with the same codes and messages,
// and feeds the tool's own lib/state.js the lines updater.sh would print: what the page shows is decided
// by the tool's code, not by an imitation of it. Nothing here touches the network.
(() => {
  // How long each fake line takes to arrive, in ms: short, but slow enough to watch
  const T = { line: 150, site: 400, dump: 900, download: 450, check: 700, copy: 1600, size: 350, test: 800 };
  const PUSH = 200;   // like server.js: at most one state push every 200 ms
  // A well-formed public key with no private key anywhere: pasting it into a server opens nothing
  const KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIECV9omAIBfDR3ci+dvhCz6dHfvj3J4yAYueD0DVQ90 wp-updater';
  const SERVERS = [
    { id: 'a1b2c3d4', name: 'Shared hosting', host: 'shared.example', port: 65002, user: 'u1234567', path: '' },
    { id: 'e5f6a7b8', name: 'VPS', host: 'vps.example', port: 22, user: 'deploy', path: '/var/www' },
  ];
  const DAY = 86400000;

  // A plugin or theme as `wp plugin list --format=json` prints it
  const item = (name, version, next = '', more = {}) =>
    ({ name, status: 'active', update: next ? 'available' : 'none', version, update_version: next, ...more });
  const site = (path, url, db, bytes, software) =>
    ({ path, url, db: { name: db, host: 'localhost', prefix: 'wp_' }, bytes, ...software });

  // What each fake server holds, by user@host:port, as updater.sh would find it there
  function newWorld() {
    const domain = name => `/home/u1234567/domains/${name}/public_html`;
    const shop = () => ({
      wp: '6.9.1', core: [{ version: '7.1.3' }],
      plugins: [item('woocommerce', '11.2.0', '11.2.1'), item('elementor-pro', '4.0.1', '4.3.2')],
      themes: [item('astra', '4.14.0', '4.14.1')],
    });
    return {
      'u1234567@shared.example:65002': [
        site(domain('shop.example'), 'https://shop.example', 'u1234567_shop', 2400000000, shop()),
        // A staging copy left in a subfolder, on the live site's database: the tool flags both
        site(`${domain('shop.example')}/staging`, 'https://shop.example/staging', 'u1234567_shop', 2100000000, shop()),
        site(domain('clinic.example'), 'https://clinic.example', 'u1234567_clinic', 850000000, {
          wp: '7.1.3', core: [],
          plugins: [item('contact-form-7', '6.1.1', '6.1.2'), item('elementor-pro', '4.0.1', '4.3.2')],
          themes: [item('hello-elementor', '3.4.4')],
        }),
        site(domain('portfolio.example'), 'https://portfolio.example', 'u1234567_folio', 320000000, {
          wp: '7.1.3', core: [], plugins: [item('akismet', '5.6')], themes: [item('twentytwentyfive', '1.4')],
        }),
      ],
      'deploy@vps.example:22': [
        site('/var/www/news', 'https://news.example', 'news', 1300000000, {
          wp: '7.0.2', core: [{ version: '7.1.3' }],
          plugins: [item('akismet', '5.5', '5.6'),
                    item('jetpack', '15.0', '15.3', { update: 'unavailable', requires: '6.8', requires_php: '8.3' })],
          themes: [item('twentytwentyfour', '1.3')],
        }),
        site('/var/www/blog', 'https://blog.example', 'blog', 540000000, {
          wp: '6.8.3', core: [{ version: '7.1.3' }],
          plugins: [item('classic-editor', '1.6.7', '1.6.8')], themes: [item('twentytwentyfive', '1.3', '1.4')],
        }),
      ],
    };
  }

  // The same rule as folderName in lib/backups.js: https://example.com/blog/ → example.com_blog
  const folderName = url => url.replace(/^.*?:\/\//, '').replace(/[/:]/g, '_').replace(/_+$/, '');
  const serverKey = srv => `${srv.user}@${srv.host}:${srv.port}`;
  const iso = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

  // How long a fake line takes after the previous one
  function delay(line, prev) {
    if (line.startsWith('=====')) return T.site;
    if (prev.endsWith(': database backup')) return T.dump;
    if (prev.endsWith(': copying files')) return T.copy;
    if (line.startsWith('Downloading')) return T.download;
    if (/^== \S+: OK$/.test(line)) return T.check;
    if (line.includes('"bytes"')) return T.size;
    return T.line;
  }

  // A fake run of updater.sh: each line arrives after its delay, then done(). A function among the lines is
  // what the script does to the server at that point: it runs right after the line before it. kill() stops
  // the run for good, like killing the process
  function play(lines, onLine, done = () => {}) {
    let i = 0, prev = '', timer = null;
    const next = () => {
      while (typeof lines[i] === 'function') lines[i++]();
      if (i === lines.length) return done();
      const line = lines[i++];
      timer = setTimeout(() => { prev = line; onLine(line); next(); }, delay(line, prev));
    };
    next();
    return { kill: () => clearTimeout(timer) };
  }

  // wp core update installs the highest version offered
  const newest = core => core.map(c => c.version).sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))[0];
  const updatable = (items, exclude) => items.filter(x => x.update === 'available' && !exclude.includes(x.name));

  // What `updater.sh --apply` prints for one site, as WP-CLI prints it, and what it does to the site
  function updateLines(id, s, exclude) {
    const lines = [`== ${id}: database backup`, `== ${id}: updating`, () => upgrade(s, exclude)];
    if (s.core.length) {
      const v = newest(s.core);
      lines.push(`Updating to version ${v} (en_US)...`,
        `Downloading update from https://downloads.wordpress.org/release/wordpress-${v}-no-content.zip...`,
        'Unpacking the update...', 'Installing the latest version...', 'Success: WordPress updated successfully.');
    }
    for (const [type, items] of [['plugin', s.plugins], ['theme', s.themes]]) {
      const todo = updatable(items, exclude);
      if (!todo.length) continue;
      for (const x of todo) lines.push(`Downloading update from https://downloads.wordpress.org/${type}/${x.name}.${x.update_version}.zip...`,
        'Unpacking the update...', 'Installing the latest version...', `Removing the old version of the ${type}...`,
        `${type[0].toUpperCase()}${type.slice(1)} updated successfully.`);
      lines.push('name\told_version\tnew_version\tstatus', ...todo.map(x => `${x.name}\t${x.version}\t${x.update_version}\tUpdated`),
        `Success: Updated ${todo.length} of ${todo.length} ${type}s.`);
    }
    lines.push('Success: Translations are up to date.', `== ${id}: OK`);
    return lines;
  }

  // The site after `wp core update`, `wp plugin update --all --exclude=…` and `wp theme update --all --exclude=…`
  function upgrade(s, exclude) {
    if (s.core.length) Object.assign(s, { wp: newest(s.core), core: [] });
    for (const x of [...updatable(s.plugins, exclude), ...updatable(s.themes, exclude)])
      Object.assign(x, { version: x.update_version, update: 'none', update_version: '' });
  }

  function createFake({ S, C, onEvent = () => {} }) {
    const world = newWorld();
    // The backups on "this computer", by user@host/folder, as lib/backups.js finds them on disk
    const disk = new Map([['u1234567@shared.example/portfolio.example', { date: iso(Date.now() - 2 * DAY), bytes: 318000000 }]]);
    const state = S.newState();
    state.publicKey = KEY;
    state.hardlinks = true;
    const clients = new Set();
    let config;
    let listing = [];   // the listings in progress, one per server
    let measuring = { ids: [], runs: [] };   // the measurings in progress, one per server
    let pendingSend = null;

    function applyConfig(c) {
      config = c;
      state.config = c;
      const servers = {};
      for (const s of c.servers) servers[s.id] = state.servers[s.id] || { ssh: null, message: null, rsync: null };
      state.servers = servers;
    }

    // ---- Live events ----

    function changed() {
      if (pendingSend) return;
      pendingSend = setTimeout(() => {
        pendingSend = null;
        const { log: _, ...withoutLog } = state;   // the full log goes only on connect; after that, line by line
        for (const send of clients) send('state', withoutLog);
      }, PUSH);
    }

    function log(line) { for (const send of clients) send('log', line); }

    function connect(send) {
      send('state', state);
      clients.add(send);
    }

    // ---- The fake updater.sh ----

    // What `updater.sh --json` prints for a server
    function listingLines(srv) {
      const found = world[serverKey(srv)] || [];
      const skip = config.excludedSites.filter(id => id.startsWith(`${srv.id}:`)).map(id => id.slice(9));
      const todo = found.filter(s => !skip.includes(s.path));
      return [
        JSON.stringify({ server: srv.id, sites: found.map(s => s.path), skipped: found.filter(s => skip.includes(s.path)).map(s => s.path) }),
        ...todo.flatMap((s, i) => [
          `===== [${i + 1}/${todo.length}] ${srv.id}:${s.path}`,
          JSON.stringify({ site: `${srv.id}:${s.path}`, url: s.url, db: s.db, wp: s.wp, exclude: config.exclude,
                           core: s.core, plugins: s.plugins, themes: s.themes }),
        ]),
      ];
    }

    const worldSite = (srv, path) => (world[serverKey(srv)] || []).find(s => s.path === path);

    // What `updater.sh --backup` prints for one site, and the copy it leaves on disk
    function backupLines(id, srv, s) {
      return [`== ${id}: database backup`, `== ${id}: copying files`, `== ${id}: OK`,
              () => disk.set(`${srv.user}@${srv.host}/${folderName(s.url)}`, { date: iso(Date.now()), bytes: s.bytes })];
    }

    // What one updater.sh call per server prints for a run, one server after another, like lib/run.js
    function runLines(ids, kind) {
      const exclude = config.exclude;
      return config.servers.flatMap(srv => {
        const paths = ids.filter(id => id.startsWith(`${srv.id}:`)).map(id => id.slice(9));
        return paths.flatMap((path, i) => {
          const id = `${srv.id}:${path}`, s = worldSite(srv, path);
          return [`===== [${i + 1}/${paths.length}] ${id}`, ...(kind === 'backup' ? backupLines(id, srv, s) : updateLines(id, s, exclude))];
        });
      });
    }

    // What `updater.sh --sizes` prints for a site
    function sizeLine(srv, id) {
      const s = worldSite(srv, id.slice(9));
      return JSON.stringify(s ? { site: id, bytes: s.bytes } : { site: id, error: 'could not measure' });
    }

    // ---- What server.js does with it ----

    // One listing per server, all at once. restart: stop the one in progress
    function list({ clearReview = false, restart = false } = {}) {
      if (state.run?.active || (listing.length && !restart)) return false;
      for (const p of listing) p.kill();
      S.startListing(state, { clearReview, servers: config.servers.map(s => s.id) });
      changed();
      listing = [];
      let left = config.servers.length;
      if (!left) { S.endListing(state, Date.now(), 0); changed(); return true; }
      for (const srv of config.servers) {
        listing.push(play(listingLines(srv), line => { S.listingLine(state, line, Date.now()); log(line); changed(); }, () => {
          if (--left) return;
          listing = [];
          S.endListing(state, Date.now(), 0);
          refreshBackups();
          changed();
        }));
      }
      return true;
    }

    // What's on disk for each site, and which can't be backed up because another site would use its folder
    function refreshBackups() {
      const dir = s => {
        const srv = config.servers.find(x => x.id === s.server);
        return srv && s.url && s.status !== 'excluded' && `${srv.user}@${srv.host}/${folderName(s.url)}`;
      };
      const sites = Object.values(state.sites);
      for (const s of sites) {
        const srv = config.servers.find(x => x.id === s.server);
        s.lastFull = (srv && s.url && disk.get(`${srv.user}@${srv.host}/${folderName(s.url)}`)) || null;
        const mate = dir(s) && sites.find(o => o !== s && dir(o) === dir(s));
        s.backupNote = mate ? `Shares its backup folder with ${mate.url}` : null;
      }
    }

    // Every fake server answers, and has rsync
    function probeAll() {
      setTimeout(() => {
        for (const srv of config.servers) Object.assign(state.servers[srv.id], { ssh: true, message: null, rsync: true });
        changed();
      }, T.line);
    }

    // A measuring replaces the one in progress: what that one didn't measure yet ends as unknown
    function measure(ids) {
      for (const r of measuring.runs) r.kill();
      S.endSizes(state, measuring.ids);
      measuring = { ids, runs: [] };
      S.startSizes(state, ids);
      for (const srv of config.servers) {
        const own = ids.filter(id => id.startsWith(`${srv.id}:`));
        if (!own.length) continue;
        measuring.runs.push(play(own.map(id => sizeLine(srv, id)), line => { S.sizeLine(state, line); changed(); },
                                 () => { S.endSizes(state, own); changed(); }));
      }
      changed();
    }

    // An update or a backup, one server after another
    function start(ids, kind = 'update') {
      S.startRun(state, ids, Date.now(), kind);
      play([...runLines(ids, kind), 'END code=0'], line => { S.runLine(state, line, Date.now()); log(line); changed(); }, finishRun);
      changed();
    }

    // After an update, a listing confirms the sites ended up up to date. A backup only changed what's on disk
    function finishRun() {
      if (state.run.kind === 'update') list();
      else { refreshBackups(); changed(); }
    }

    // ---- API (the handlers of server.js, with the same codes and messages) ----

    function update(body) {
      if (state.run?.active || listing.length) return { status: 409 };
      const ids = body?.sites;
      const valid = id => typeof id === 'string' && C.SITE_ID.test(id) && config.servers.some(s => s.id === id.slice(0, 8))
        && state.sites[id]?.pending.length > 0 && ['pending', 'review'].includes(state.sites[id].status);
      if (!Array.isArray(ids) || !ids.length || !ids.every(valid)) return { status: 400 };
      start([...new Set(ids)]);
      onEvent('demo-update');
      return { status: 202 };
    }

    // Why nothing else can start now, or null
    function busy() {
      if (state.run?.active) return `${state.run.kind === 'backup' ? 'A backup' : 'An update'} is running. Try again when it finishes.`;
      return listing.length ? 'The sites are being checked. Try again when it finishes.' : null;
    }

    // Copying only reads: duplicates can be copied. A site needs its address, a server that answers and
    // has rsync, and a folder of its own
    function backup(body) {
      if (busy()) return { status: 409, data: { error: busy() } };
      const ids = body?.sites;
      const valid = id => {
        const s = typeof id === 'string' && C.SITE_ID.test(id) && state.sites[id];
        const srv = s && config.servers.find(x => x.id === s.server) && state.servers[s.server];
        return !!srv && srv.ssh !== false && srv.rsync !== false && !!s.url
          && !['excluded', 'checking', 'error'].includes(s.status) && s.backupNote === null;
      };
      if (!Array.isArray(ids) || !ids.length || !ids.every(valid)) return { status: 400, data: { error: "These sites can't be backed up right now." } };
      start([...new Set(ids)], 'backup');
      onEvent('demo-backup');
      return { status: 202 };
    }

    function sizes(body) {
      if (busy()) return { status: 409, data: { error: busy() } };
      const ids = body?.sites;
      const valid = id => typeof id === 'string' && C.SITE_ID.test(id) && !!state.sites[id] && config.servers.some(s => s.id === id.slice(0, 8));
      if (!Array.isArray(ids) || !ids.length || !ids.every(valid)) return { status: 400, data: { error: "These sites can't be measured." } };
      measure([...new Set(ids)]);
      return { status: 202 };
    }

    function saveConfig(body) {
      if (state.run?.active) return { status: 409, data: { error: busy() } };
      let next;
      try { next = C.validate(body); } catch (err) { return { status: 400, data: { error: err.message } }; }
      applyConfig(next);
      list({ clearReview: true, restart: true });
      probeAll();
      changed();
      return { status: 200, data: { config: next } };
    }

    // Any well-formed server answers: a server the fake doesn't know just has no WordPress sites
    async function testServer(body) {
      try { C.validate({ servers: [{ ...body, name: 'test', id: '00000000' }] }); }
      catch (err) { return { status: 400, data: { error: err.message } }; }
      await new Promise(resolve => setTimeout(resolve, T.test));
      return { status: 200, data: { ok: true, message: 'OK' } };
    }

    // The POST routes app.js calls. No X-WPU or Origin checks: no other website can reach this fake
    async function request(route, body) {
      if (route === '/api/list') return { status: list({ clearReview: true }) ? 202 : 409 };
      if (route === '/api/update') return update(body);
      if (route === '/api/backup') return backup(body);
      if (route === '/api/sizes') return sizes(body);
      if (route === '/api/config') return saveConfig(body);
      if (route === '/api/test') return testServer(body);
      return { status: 404 };
    }

    applyConfig(C.validate({ servers: SERVERS, exclude: ['elementor-pro'], excludedSites: [] }));
    probeAll();
    list();
    return { state, connect, request };
  }

  // ---- In the page ----

  // What the tool's modules require: config.js uses fs only to load and save its file, which the fake never
  // does, and crypto only for the ids of new servers. Anything else is a release the bridge doesn't know yet
  const MODULES = {
    'node:fs': {},
    'node:crypto': { randomBytes: n => ({ toString: () => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, '0')).join('') }) },
  };
  function require(name) {
    if (!(name in MODULES)) throw new Error(`The tool's code requires ${name}, which the demo doesn't have: update demo/bridge.js.`);
    return MODULES[name];
  }

  // Runs one of the tool's CommonJS modules and returns its exports. Loaded as plain scripts, their top-level
  // names would clash with app.js's
  function run(text) {
    const module = { exports: {} };
    new Function('module', 'exports', 'require', text)(module, module.exports, require);
    return module.exports;
  }

  async function load(file, fetch) {
    const res = await fetch(file);
    if (!res.ok) throw new Error(`${file} answered ${res.status}`);
    return run(await res.text());
  }

  // What server.js sends: JSON when there's data, else the status as text
  const reply = ({ status, data }) => (data
    ? new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
    : new Response(String(status), { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }));

  // The landing counts what visitors do in the demo, when it has GoatCounter and the same origin
  function count(name) {
    try { window.parent.goatcounter?.count?.({ path: name, event: true }); } catch {}
  }

  // Before app.js runs: its fetch('/api/…') and EventSource('/api/events') reach the fake instead
  function install() {
    const realFetch = window.fetch.bind(window);
    const ready = Promise.all([load('state.js', realFetch), load('config.js', realFetch)])
      .then(([S, C]) => createFake({ S, C, onEvent: count }));

    window.fetch = async (input, init = {}) => {
      const url = new URL(input instanceof Request ? input.url : input, location.href);
      if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return realFetch(input, init);
      let body;
      try { body = init.body === undefined ? undefined : JSON.parse(init.body); } catch { return reply({ status: 400 }); }
      return reply(await (await ready).request(url.pathname, body));
    };

    window.EventSource = class extends EventTarget {
      constructor() {
        super();
        this.onopen = this.onerror = null;
        ready.then(fake => {
          this.onopen?.(new Event('open'));
          fake.connect((event, data) => this.dispatchEvent(new MessageEvent(event, { data: JSON.stringify(data) })));
        }, () => this.onerror?.(new Event('error')));   // the page shows it's not connected
      }
    };
  }

  if (typeof window === 'undefined') module.exports = { createFake, run, T, SERVERS };
  else install();
})();
