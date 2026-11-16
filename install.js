#!/usr/bin/env node
// Scan Guard installer for FM-DX Webserver (Linux, Raspberry Pi and Windows).
//
//   Install:    node install.js <FM-DX folder>
//   Uninstall:  node install.js <FM-DX folder> --uninstall
//
// It copies the plugin into <FM-DX folder>/plugins and adds three small lines
// to <FM-DX folder>/server/index.js (a backup is made first). Running it twice is safe.

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const uninstall = args.includes('--uninstall');
const dir = args.find(a => !a.startsWith('--'));

function fail(msg) {
    console.error('\n  ERROR: ' + msg + '\n');
    process.exit(1);
}

if (!dir) fail('Tell me where FM-DX Webserver is, for example:\n\n    node install.js /home/pi/fm-dx-webserver\n    node install.js C:\\fm-dx-webserver');

const app = path.resolve(dir);
const indexJs = path.join(app, 'server', 'index.js');
if (!fs.existsSync(indexJs)) fail(`"${app}" is not an FM-DX Webserver folder (server/index.js not found).`);

const MARK = 'Scan Guard';
const HOOK_REQUIRE = "// Scan Guard (plugins/ScanGuard): optional, the server runs normally without it\nlet scanGuard = null;\ntry { scanGuard = require('../plugins/ScanGuard/guard-core'); } catch (e) { scanGuard = null; }\n\n";
const HOOK_CONNECT = "\n    // Scan Guard (plugins/ScanGuard): refuse addresses banned for automated band scanning\n    if (scanGuard && scanGuard.onConnect(ws, request)) return;\n";
const HOOK_TUNE = "        // Scan Guard: drop tune commands from automated band scanners\n        if (scanGuard && command.startsWith(\"T\") && !scanGuard.allowTune(ws, request, command)) return;\n\n";

const ANCHOR_CONNECTION = "wss.on('connection'";
const ANCHOR_CLIENT = /const \{ ip: clientIp[^\n]*helpers\.getClient\(request\);\n/;
const ANCHOR_WRITE = /( *)if \(\(serverConfig\.publicTuner && !serverConfig\.lockToAdmin\)[^\n]*\n\s*output\.write\(`\$\{command\}\\n`\);/;

const pluginsDir = path.join(app, 'plugins');
const here = __dirname;

let src = fs.readFileSync(indexJs, 'utf8').replace(/\r\n/g, '\n');
const crlf = fs.readFileSync(indexJs, 'utf8').includes('\r\n');
function save(text) {
    fs.writeFileSync(indexJs, crlf ? text.replace(/\n/g, '\r\n') : text);
}

if (uninstall) {
    const before = src;
    src = src.split(HOOK_REQUIRE).join('').split(HOOK_CONNECT).join('').split(HOOK_TUNE).join('');
    if (src !== before) { save(src); console.log('  - removed the Scan Guard lines from server/index.js'); }
    for (const p of [path.join(pluginsDir, 'ScanGuard.js'), path.join(pluginsDir, 'ScanGuard')]) {
        if (fs.existsSync(p)) { fs.rmSync(p, { recursive: true, force: true }); console.log('  - removed ' + path.relative(app, p)); }
    }
    console.log('\n  Scan Guard is uninstalled. Restart FM-DX Webserver.\n');
    process.exit(0);
}

// 1. Copy the plugin
fs.mkdirSync(path.join(pluginsDir, 'ScanGuard'), { recursive: true });
fs.copyFileSync(path.join(here, 'ScanGuard.js'), path.join(pluginsDir, 'ScanGuard.js'));
for (const f of ['guard-core.js', 'scanguard.js', 'scanguard_server.js']) {
    fs.copyFileSync(path.join(here, 'ScanGuard', f), path.join(pluginsDir, 'ScanGuard', f));
}
console.log('  ✓ plugin copied to plugins/ScanGuard');

// 2. Add the hooks to server/index.js
if (src.includes(MARK)) {
    console.log('  ✓ server/index.js already has the Scan Guard lines');
} else {
    if (!src.includes(ANCHOR_CONNECTION) || !ANCHOR_CLIENT.test(src) || !ANCHOR_WRITE.test(src)) {
        fail('this FM-DX version looks different from what Scan Guard expects (made for FM-DX 1.4.x).\n  Nothing in server/index.js was changed. The plugin files were copied but will do nothing.');
    }
    const backup = indexJs + '.before-scanguard';
    if (!fs.existsSync(backup)) fs.copyFileSync(indexJs, backup);
    src = src.replace(ANCHOR_CONNECTION, HOOK_REQUIRE + ANCHOR_CONNECTION);
    src = src.replace(ANCHOR_CLIENT, m => m + HOOK_CONNECT);
    src = src.replace(ANCHOR_WRITE, m => HOOK_TUNE + m);
    save(src);
    console.log('  ✓ server/index.js updated (backup: server/index.js.before-scanguard)');
}

// 3. Same owner as the FM-DX folder (Linux, when run with sudo)
if (process.platform !== 'win32' && typeof process.getuid === 'function' && process.getuid() === 0) {
    const { uid, gid } = fs.statSync(app);
    for (const p of [path.join(pluginsDir, 'ScanGuard.js'), path.join(pluginsDir, 'ScanGuard'),
                     ...['guard-core.js', 'scanguard.js', 'scanguard_server.js'].map(f => path.join(pluginsDir, 'ScanGuard', f))]) {
        try { fs.chownSync(p, uid, gid); } catch (_) { /* ignore */ }
    }
}

console.log(`
  Scan Guard is installed. Next:
    1. Open your FM-DX page, log in as admin, go to Setup -> Plugins,
       tick "Scan Guard" and press Save.
    2. Restart FM-DX Webserver.
  It starts in WATCH mode: it only writes down what it would block.
`);
