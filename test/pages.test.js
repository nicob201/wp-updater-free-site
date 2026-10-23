// The landing pages, read as text: links that go somewhere, the commands people copy, the promises the
// pages make, and the two languages saying the same thing
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const EN = read('index.html');
const ES = read('es/index.html');
const attrs = (html, name) => [...html.matchAll(new RegExp(`\\s${name}="([^"]*)"`, 'g'))].map(m => m[1]);
const CLICKS = ['get-started-nav', 'get-started-hero', 'get-started-mid', 'get-started-how', 'get-started-final', 'try-demo',
                'star-nav', 'star-hero', 'star-final', 'copy-install', 'copy-demo', 'demo-reset', 'open-issue'];

// What each language must say, in its own words
const SITE = 'https://wp-updater-free.vercel.app';
const PAGES = [
  { lang: 'en', html: EN, url: `${SITE}/`, image: `${SITE}/assets/og.png`, locale: 'en_US', counts: /counts visits and clicks with <a[^>]*>GoatCounter<\/a>, with no cookies and no personal data/, start: 'https://github.com/nicob201/wp-updater-free#quick-start',
    made: /Made for the love of it ♥ by Nicolas Boscasso/, compare: /Why not ManageWP or MainWP\?/,
    planned: /id="next"[\s\S]*Planned, not in the tool yet\./,
    untested: /cPanel, SiteGround and VPS aren't tested yet/, dump: /mysqldump or mariadb-dump/,
    key: /SSH key[^.]*Docker volume/, keyInData: /SSH key[^.]*<span class="code-inline">data<\/span> folder/ },
  { lang: 'es', html: ES, url: `${SITE}/es/`, image: `${SITE}/assets/og-es.png`, locale: 'es_LA', counts: /cuenta visitas y clics con <a[^>]*>GoatCounter<\/a>, sin cookies ni datos personales/, start: 'https://github.com/nicob201/wp-updater-free/blob/main/README.es.md#inicio-rápido',
    made: /Desarrollado por amor al arte ♥ por Nicolas Boscasso/, compare: /¿Por qué no ManageWP o MainWP\?/,
    planned: /id="next"[\s\S]*Planeado, todavía no está en la herramienta\./,
    untested: /cPanel, SiteGround y VPS todavía no se probaron/, dump: /mysqldump o mariadb-dump/,
    key: /clave SSH[^.]*volumen de Docker/, keyInData: /clave SSH[^.]*carpeta <span class="code-inline">data<\/span>/ },
];

for (const p of PAGES) {
  const { html } = p;

  test(`${p.lang}: the page is in its language`, () => assert.match(html, new RegExp(`<html lang="${p.lang}"`)));

  test(`${p.lang}: every in-page link points at a section that exists`, () => {
    const ids = new Set(attrs(html, 'id'));
    for (const href of attrs(html, 'href').filter(h => h.startsWith('#') && h.length > 1))
      assert.ok(ids.has(href.slice(1)), `${href} has no section`);
  });

  test(`${p.lang}: the demo frame loads /demo/`, () => assert.match(html, /<iframe[^>]+src="\/demo\/"/));

  test(`${p.lang}: the copy boxes hold the README commands, one per line`, () => {
    const copies = attrs(html, 'data-copy').map(c => c.replace(/&#10;/g, '\n'));
    const clone = 'git clone https://github.com/nicob201/wp-updater-free.git\ncd wp-updater-free\n';
    assert.ok(copies.includes(`${clone}docker compose up -d`));
    assert.ok(copies.includes(`${clone}docker compose --profile demo up -d`));
  });

  test(`${p.lang}: each copy box shows exactly what its button copies`, () => {
    const boxes = [...html.matchAll(/<pre><code>([\s\S]*?)<\/code><\/pre>\s*<button class="copy-button"[^>]*data-copy="([^"]*)"/g)];
    assert.equal(boxes.length, 2);
    for (const [, shown, copied] of boxes) assert.equal(shown, copied.replace(/&#10;/g, '\n'));
  });

  test(`${p.lang}: Get started opens the Quick start of the README in the same language`, () => {
    assert.equal(attrs(html, 'href').filter(h => h === p.start).length, 5);
  });

  test(`${p.lang}: the footer credits the author and links the author's pages`, () => {
    for (const url of ['https://github.com/nicob201', 'https://nicolas-boscasso.vercel.app/', 'https://www.linkedin.com/in/nicolas-boscasso/'])
      assert.ok(attrs(html, 'href').includes(url), url);
    assert.match(html, p.made);
    assert.match(html, /<span data-version>/);
  });

  test(`${p.lang}: it has the FAQ comparison and says what is not built yet`, () => {
    assert.match(html, p.compare);
    assert.match(html, p.planned);
    assert.ok(attrs(html, 'href').includes('https://github.com/nicob201/wp-updater-free/issues/new'));
  });

  test(`${p.lang}: it says where the tool has been tried, and where not yet`, () => {
    assert.match(html, /Hostinger/);
    assert.match(html, p.untested);
    assert.match(html, p.dump);
  });

  test(`${p.lang}: it doesn't say the SSH key lives in the data folder`, () => {
    // With Docker, the only install the page describes, the key is in a Docker volume (compose.yaml)
    assert.doesNotMatch(html, p.keyInData);
    assert.match(html, p.key);
  });

  test(`${p.lang}: every tracked click has a known name, and each one is used once`, () => {
    assert.deepEqual(attrs(html, 'data-goatcounter-click').sort(), [...CLICKS].sort());
  });

  test(`${p.lang}: links that open in a new tab keep the page safe`, () => {
    for (const tag of html.match(/<a [^>]*target="_blank"[^>]*>/g) || []) assert.match(tag, /rel="noopener"/, tag);
  });

  test(`${p.lang}: it points at the other language, with full URLs as search engines need`, () => {
    assert.ok(html.includes(`<link rel="alternate" hreflang="en" href="${SITE}/">`));
    assert.ok(html.includes(`<link rel="alternate" hreflang="es" href="${SITE}/es/">`));
    assert.ok(html.includes(`<link rel="alternate" hreflang="x-default" href="${SITE}/">`));
    assert.ok(html.includes(`<link rel="canonical" href="${p.url}">`));
  });

  test(`${p.lang}: it counts visits and clicks with GoatCounter, and says so`, () => {
    assert.ok(html.includes('<script data-goatcounter="https://nicob201.goatcounter.com/count" async src="//gc.zgo.at/count.js"></script>'));
    assert.match(html, p.counts);
  });

  test(`${p.lang}: a shared link shows a title, a description and an image`, () => {
    const meta = name => html.match(new RegExp(`<meta (?:property|name)="${name}" content="([^"]*)">`))?.[1];
    assert.equal(meta('og:url'), p.url);
    assert.equal(meta('og:image'), p.image);
    assert.equal(meta('og:image:width'), '1200');
    assert.equal(meta('og:image:height'), '630');
    assert.equal(meta('og:locale'), p.locale);
    assert.equal(meta('og:type'), 'website');
    assert.equal(meta('twitter:card'), 'summary_large_image');
    assert.ok(meta('og:title') && meta('og:description') && meta('og:image:alt'));
    assert.equal(meta('og:title'), html.match(/<title>([^<]*)<\/title>/)[1]);
    assert.equal(meta('og:description'), meta('description'));
  });
}

test('the demo inside the page counts nothing by itself', () => {
  // It's an iframe: counted as page views, every visit would count twice. Demo use is counted through the parent
  assert.doesNotMatch(read('demo/index.html'), /goatcounter/);
});

test('the share images are 1200 × 630 PNGs', () => {
  for (const file of ['og.png', 'og-es.png']) {
    const png = fs.readFileSync(path.join(__dirname, '..', 'assets', file));
    assert.equal(png.subarray(1, 4).toString(), 'PNG', file);
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1200, 630], file);
  }
});

test('both languages have the same sections, hooks and tracked clicks, in the same order', () => {
  assert.deepEqual(attrs(ES, 'id'), attrs(EN, 'id'));
  assert.deepEqual(attrs(ES, 'data-goatcounter-click'), attrs(EN, 'data-goatcounter-click'));
  for (const hook of ['data-copy', 'data-stars', 'data-version', 'data-version-line'])
    assert.equal(ES.split(hook).length, EN.split(hook).length, hook);
});

test('both languages have the same markup, tag for tag', () => {
  // Only the text and the attributes that carry language or a link may differ: a card, an answer or a
  // button added to one page alone fails here
  const skeleton = html => html.match(/<[^>]+>/g).map(tag => tag.replace(/\s(?:href|hreflang|lang|aria-[a-z]+|title|content)="[^"]*"/g, ''));
  assert.deepEqual(skeleton(ES), skeleton(EN));
});

test('the Spanish page never sends people to the English README', () => {
  assert.ok(!ES.includes('wp-updater-free#quick-start'));
  assert.ok(!ES.includes('wp-updater-free#connect-your-server'));
  assert.ok(attrs(ES, 'href').includes('https://github.com/nicob201/wp-updater-free/blob/main/README.es.md#conecta-tu-servidor'));
});

test("the Spanish page marks the tool's English labels, so they read and sound as English", () => {
  const bare = ES.replace(/<(strong|h3) lang="en">[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, ' ');
  for (const label of ['Update all', 'Check for updates', 'Test connection', "Can't update here", 'Back up sites', 'Settings', 'Check', 'Sites'])
    assert.doesNotMatch(bare, new RegExp(`\\b${label}\\b`), label);
});

test('the Spanish page talks to "tú" and says what the English one says', () => {
  assert.doesNotMatch(ES, /\bSu clave SSH/);
  assert.match(ES, /encuentra por sí sola los sitios WordPress/);
});

test('the language switch marks the page it is on', () => {
  assert.match(EN, /<a aria-current="page" aria-label="English">EN<\/a>\s*<a href="\/es\/"/);
  assert.match(ES, /<a href="\/" hreflang="en" lang="en"[^>]*>EN<\/a>\s*<a aria-current="page" aria-label="Español">ES<\/a>/);
});
