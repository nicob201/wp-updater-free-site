// Stands in for WP Updater's local bridge (server.js) in the browser, so the tool's real page (app.js)
// runs against fake servers with fake sites. It answers the same routes with the same codes and messages,
// and feeds the tool's own lib/state.js the lines updater.sh would print: what the page shows is decided
// by the tool's code, not by an imitation of it. Nothing here touches the network.
(() => {
  const ROUTES = ['events', 'list', 'update', 'backup', 'sizes', 'config', 'test'];
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

  // A fake run of updater.sh: each line arrives after its delay, then done(). kill() stops it for good,
  // like killing the process
  function play(lines, onLine, done = () => {}) {
    let i = 0, timer = null;
    const next = () => {
      if (i === lines.length) return done();
      const line = lines[i];
      timer = setTimeout(() => { i += 1; onLine(line); next(); }, delay(line, lines[i - 1] || ''));
    };
    next();
    return { kill: () => clearTimeout(timer) };
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

    // ---- API ----

    async function request(route) {
      if (route === '/api/list') return { status: list({ clearReview: true }) ? 202 : 409 };
      return { status: 404 };
    }

    applyConfig(C.validate({ servers: SERVERS, exclude: ['elementor-pro'], excludedSites: [] }));
    probeAll();
    list();
    return { state, connect, request };
  }

  if (typeof window === 'undefined') module.exports = { createFake, ROUTES, T, SERVERS };
})();
