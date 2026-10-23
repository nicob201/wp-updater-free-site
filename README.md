# WP Updater site

The landing page of [WP Updater](https://github.com/nicob201/wp-updater-free), a free tool that keeps all your WordPress sites up to date from your computer.

## The demo

`demo/` is the tool's real page, taken from a release tag, running against `demo/bridge.js` instead of the tool's local server. The bridge answers the same routes as the tool's `server.js` and feeds the tool's own `lib/state.js` the lines `updater.sh` would print, for fake servers with fake sites. What the page shows is decided by the tool's code, and nothing in it touches the network.

Try it locally (it's a static site, with no build step):

```sh
python3 -m http.server 8080
```

Open <http://localhost:8080/demo/>. Reload the page to start over.

## Update the demo

To move the demo to the latest release of the tool:

```sh
node scripts/sync-demo.js
```

Then try the demo, run the tests and commit. Don't edit the copied files by hand (everything in `demo/` except `bridge.js`): CI checks that they match the tag in `demo/version.txt`, and every Monday it checks that the tag is still the latest release. When a release needs something the bridge doesn't do, `test/drift.test.js` fails.

## Tests

```sh
node --test test/*.test.js
```

They need Node.js 24 or newer and nothing else.

## License

[MIT](LICENSE)
