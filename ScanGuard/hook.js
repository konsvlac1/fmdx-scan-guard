// Scan Guard needs four small line groups in FM-DX's server/index.js. Used by install.js and by the
// "Fix it now" button (shield window / Setup tab) when the plugin was copied by hand.
'use strict';
const fs = require('fs');

const MARK = 'Scan Guard';
const HOOK_REQUIRE = "// Scan Guard (plugins/ScanGuard): optional, the server runs normally without it\nlet scanGuard = null;\ntry { scanGuard = require('../plugins/ScanGuard/guard-core'); } catch (e) { scanGuard = null; }\n\n";
const HOOK_CONNECT = "\n    // Scan Guard (plugins/ScanGuard): refuse addresses banned for automated band scanning\n    if (scanGuard && scanGuard.onConnect(ws, request)) return;\n";
const HOOK_HTTP = "// Scan Guard (plugins/ScanGuard): keep AI crawlers off the site\napp.use((req, res, next) => (scanGuard ? scanGuard.httpGuard(req, res, next) : next()));\n";
const HOOK_TUNE = "        // Scan Guard: drop tune commands from automated band scanners\n        if (scanGuard && command.startsWith(\"T\") && !scanGuard.allowTune(ws, request, command)) return;\n\n";

const ANCHOR_CONNECTION = "wss.on('connection'";
const ANCHOR_CLIENT = /const \{ ip: clientIp[^\n]*helpers\.getClient\(request\);\n/;
const ANCHOR_HTTP = 'app.use(express.urlencoded({ extended: true }));';
const ANCHOR_WRITE = /( *)if \(\(serverConfig\.publicTuner && !serverConfig\.lockToAdmin\)[^\n]*\n\s*output\.write\(`\$\{command\}\\n`\);/;

const HOOKS = [
    { has: HOOK_REQUIRE, ok: src => src.includes(ANCHOR_CONNECTION), add: src => src.replace(ANCHOR_CONNECTION, HOOK_REQUIRE + ANCHOR_CONNECTION) },
    { has: HOOK_CONNECT, ok: src => ANCHOR_CLIENT.test(src), add: src => src.replace(ANCHOR_CLIENT, m => m + HOOK_CONNECT) },
    { has: HOOK_TUNE, ok: src => ANCHOR_WRITE.test(src), add: src => src.replace(ANCHOR_WRITE, m => HOOK_TUNE + m) },
    { has: HOOK_HTTP, ok: src => src.includes(ANCHOR_HTTP), add: src => src.replace(ANCHOR_HTTP, HOOK_HTTP + ANCHOR_HTTP) }
];

function read(indexJs) {
    const raw = fs.existsSync(indexJs) ? fs.readFileSync(indexJs, 'utf8') : '';
    return { crlf: raw.includes('\r\n'), src: raw.replace(/\r\n/g, '\n') };
}
const write = (indexJs, crlf, text) => fs.writeFileSync(indexJs, crlf ? text.replace(/\n/g, '\r\n') : text);

// { missing: number of line groups not there yet, possible: false if index.js looks different }
function status(indexJs) {
    const { src } = read(indexJs);
    const missing = HOOKS.filter(h => !src.includes(h.has));
    return { missing: missing.length, possible: missing.every(h => h.ok(src)) };
}

// Adds the missing groups (backup: server/index.js.before-scanguard).
// Returns { added: n } or { added: 0, unknown: true } when index.js looks different (nothing changed).
function install(indexJs) {
    let { src, crlf } = read(indexJs);
    const missing = HOOKS.filter(h => !src.includes(h.has));
    if (!missing.length) return { added: 0 };
    if (missing.some(h => !h.ok(src))) return { added: 0, unknown: true };
    const backup = indexJs + '.before-scanguard';
    if (!fs.existsSync(backup) && !src.includes(MARK)) fs.copyFileSync(indexJs, backup);
    for (const h of missing) src = h.add(src);
    write(indexJs, crlf, src);
    return { added: missing.length };
}

// Removes all groups. Returns true if something was removed.
function uninstall(indexJs) {
    const { src, crlf } = read(indexJs);
    const out = [HOOK_REQUIRE, HOOK_CONNECT, HOOK_TUNE, HOOK_HTTP].reduce((t, h) => t.split(h).join(''), src);
    if (out === src) return false;
    write(indexJs, crlf, out);
    return true;
}

module.exports = { status, install, uninstall };
