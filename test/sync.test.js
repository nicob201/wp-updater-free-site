const test = require('node:test');
const assert = require('node:assert/strict');
const { demoPage, FILES, PORTED } = require('../scripts/sync-demo.js');

// The parts of the tool's public/index.html the sync rewrites
const SAMPLE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>WP Updater</title>
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<main id="view-sites" class="page"></main>
<script src="/app.js"></script>
</body>
</html>
`;

test('the demo page loads its files from its own folder and the bridge before app.js', () => {
  const out = demoPage(SAMPLE);
  assert.match(out, /<link rel="stylesheet" href="styles.css">/);
  assert.match(out, /<script src="bridge.js"><\/script>\s*<script src="app.js"><\/script>/);
  assert.match(out, /<meta name="robots" content="noindex">/);
  assert.doesNotMatch(out, /"\/(styles\.css|app\.js)"/);
});

test('a changed index.html stops the sync instead of shipping a broken demo', () => {
  assert.throws(() => demoPage(SAMPLE.replace('href="/styles.css"', 'href="/main.css"')), /index\.html changed/);
  assert.throws(() => demoPage(SAMPLE + '<script src="/app.js"></script>'), /index\.html changed/);
  assert.throws(() => demoPage(SAMPLE.replace('<meta charset="utf-8">', '<meta charset="UTF-8">')), /index\.html changed/);
});

test('a page that loads another file from the root stops the sync', () => {
  const extra = SAMPLE.replace('</body>', '<script src="/extra.js"></script>\n</body>');
  assert.throws(() => demoPage(extra), /index\.html loads \/extra\.js from the root/);
  // Other origins, protocol-relative URLs, data: and in-page links are fine
  assert.doesNotThrow(() => demoPage(SAMPLE.replace('</head>', '<link rel="preconnect" href="https://fonts.gstatic.com"><script src="//cdn.example/x.js"></script><a href="#settings"></a></head>')));
});

test('it copies the page and the two state modules', () => {
  assert.deepEqual(FILES.map(f => f[1]), ['index.html', 'app.js', 'styles.css', 'state.js', 'config.js']);
  assert.deepEqual(FILES.map(f => f[0]), ['public/index.html', 'public/app.js', 'public/styles.css', 'lib/state.js', 'lib/config.js']);
});

test('it records the tool files the bridge re-implements', () => {
  assert.deepEqual(PORTED, ['server.js', 'updater.sh', 'lib/backups.js', 'lib/run.js']);
});
