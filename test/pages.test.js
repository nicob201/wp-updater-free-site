// The landing pages, read as text: links that go somewhere, the commands people copy, and the promises
// the pages make
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const EN = read('index.html');
const attrs = (html, name) => [...html.matchAll(new RegExp(`\\s${name}="([^"]*)"`, 'g'))].map(m => m[1]);
const CLICKS = ['get-started-nav', 'get-started-hero', 'get-started-mid', 'get-started-how', 'get-started-final', 'try-demo',
                'star-nav', 'star-hero', 'star-final', 'copy-install', 'copy-demo', 'demo-reset', 'open-issue'];

test('every in-page link points at a section that exists', () => {
  const ids = new Set(attrs(EN, 'id'));
  for (const href of attrs(EN, 'href').filter(h => h.startsWith('#') && h.length > 1))
    assert.ok(ids.has(href.slice(1)), `${href} has no section`);
});

test('the demo frame loads /demo/', () => assert.match(EN, /<iframe[^>]+src="\/demo\/"/));

test('the copy boxes hold the README commands, one per line', () => {
  const copies = attrs(EN, 'data-copy').map(c => c.replace(/&#10;/g, '\n'));
  const clone = 'git clone https://github.com/nicob201/wp-updater-free.git\ncd wp-updater-free\n';
  assert.ok(copies.includes(`${clone}docker compose up -d`));
  assert.ok(copies.includes(`${clone}docker compose --profile demo up -d`));
});

test('Get started opens the Quick start of the README', () => {
  assert.ok(attrs(EN, 'href').filter(h => h === 'https://github.com/nicob201/wp-updater-free#quick-start').length >= 5);
});

test("the footer credits the author and links the author's pages", () => {
  for (const url of ['https://github.com/nicob201', 'https://nicolas-boscasso.vercel.app/', 'https://www.linkedin.com/in/nicolas-boscasso/'])
    assert.ok(attrs(EN, 'href').includes(url), url);
  assert.match(EN, /Made for the love of it ♥ by Nicolas Boscasso/);
  assert.match(EN, /<span data-version>/);
});

test('it has the FAQ comparison and says what is not built yet', () => {
  assert.match(EN, /Why not ManageWP or MainWP\?/);
  assert.match(EN, /id="next"[\s\S]*Planned, not in the tool yet\./);
  assert.ok(attrs(EN, 'href').includes('https://github.com/nicob201/wp-updater-free/issues/new'));
});

test('every tracked click has a known name, and each one is used once', () => {
  assert.deepEqual(attrs(EN, 'data-goatcounter-click').sort(), [...CLICKS].sort());
});

test('links that open GitHub in a new tab keep the page safe', () => {
  for (const tag of EN.match(/<a [^>]*target="_blank"[^>]*>/g) || []) assert.match(tag, /rel="noopener"/, tag);
});

test('each copy box shows exactly what its button copies', () => {
  const boxes = [...EN.matchAll(/<pre><code>([\s\S]*?)<\/code><\/pre>\s*<button class="copy-button"[^>]*data-copy="([^"]*)"/g)];
  assert.equal(boxes.length, 2);
  for (const [, shown, copied] of boxes) assert.equal(shown, copied.replace(/&#10;/g, '\n'));
});
