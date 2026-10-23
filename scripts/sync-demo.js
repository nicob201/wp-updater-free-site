// Copies WP Updater's page and state modules from a release tag into demo/, where bridge.js stands in
// for the tool's local server.
// Usage: node scripts/sync-demo.js [tag]    copies that tag (no tag: the latest release)
//        node scripts/sync-demo.js --check  fails if demo/ doesn't match the tag in demo/version.txt
const fs = require('node:fs');
const path = require('node:path');

const REPO = 'nicob201/wp-updater-free';
const DEMO = path.join(__dirname, '..', 'demo');
const VERSION = path.join(DEMO, 'version.txt');
// [path in the tool, path in demo/]
const FILES = [
  ['public/index.html', 'index.html'],
  ['public/app.js', 'app.js'],
  ['public/styles.css', 'styles.css'],
  ['lib/state.js', 'state.js'],
  ['lib/config.js', 'config.js'],
];

// The tool's page loads its files from the root and talks to its own server; the demo lives in a folder
// and talks to bridge.js. Each anchor must be there exactly once, so a changed page stops the sync
// instead of shipping a demo that loads the wrong files
const EDITS = [
  ['<meta charset="utf-8">', '<meta charset="utf-8">\n<meta name="robots" content="noindex">'],
  ['href="/styles.css"', 'href="styles.css"'],
  ['<script src="/app.js"></script>', '<script src="bridge.js"></script>\n<script src="app.js"></script>'],
];

function demoPage(html) {
  for (const [from, to] of EDITS) {
    if (html.split(from).length !== 2) throw new Error(`index.html changed: "${from}" not found once. Update scripts/sync-demo.js.`);
    html = html.replace(from, () => to);
  }
  return html;
}

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res;
}

// What demo/ holds for a tag, by file name. Everything is fetched before anything is written:
// a failed fetch leaves demo/ as it was
async function build(tag) {
  const files = {};
  for (const [from, to] of FILES) {
    const text = await (await get(`https://raw.githubusercontent.com/${REPO}/${tag}/${from}`)).text();
    files[to] = to === 'index.html' ? demoPage(text) : text;
  }
  files['version.txt'] = `${tag}\n`;
  return files;
}

function differing(files) {
  return Object.keys(files).filter(name => {
    try { return fs.readFileSync(path.join(DEMO, name), 'utf8') !== files[name]; } catch { return true; }
  });
}

async function main(arg) {
  if (arg === '--check') {
    const tag = fs.readFileSync(VERSION, 'utf8').trim();
    const bad = differing(await build(tag));
    if (bad.length) throw new Error(`demo/ doesn't match ${tag}: ${bad.join(', ')}. Run node scripts/sync-demo.js ${tag}.`);
    console.log(`demo/ matches ${tag}`);
    return;
  }
  const tag = arg || (await (await get(`https://api.github.com/repos/${REPO}/releases/latest`)).json()).tag_name;
  const files = await build(tag);
  fs.mkdirSync(DEMO, { recursive: true });
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(DEMO, name), text);
  console.log(`demo/ now shows WP Updater ${tag}`);
}

if (require.main === module) main(process.argv[2]).catch(err => { console.error(err.message); process.exit(1); });

module.exports = { demoPage, FILES };
