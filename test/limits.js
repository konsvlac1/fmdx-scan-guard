// Assertion tests for Scan Guard's band limit + rate/burst settings (no FM-DX or tuner needed).
// Self-contained: builds its own throwaway app dir. Usage: node limits.js
// Exits 0 if every assertion passes, 1 otherwise.
const EventEmitter = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');

let clock = 1_800_000_000_000;
Date.now = () => clock;

let fails = 0;
function ok(cond, name) { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) fails++; }

// Build a disposable app: server/server_config.js + the real ScanGuard plugin, loaded fresh.
function makeGuard(serverConfig, scanguardConfig) {
    const app = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-'));
    fs.mkdirSync(path.join(app, 'server'), { recursive: true });
    fs.mkdirSync(path.join(app, 'plugins'), { recursive: true });
    fs.mkdirSync(path.join(app, 'plugins_configs'), { recursive: true });
    fs.writeFileSync(path.join(app, 'server/server_config.js'), 'module.exports = ' + JSON.stringify({ serverConfig }) + ';');
    fs.writeFileSync(path.join(app, 'server/console.js'), 'module.exports={logInfo(){},logWarn(){},logError(){}};');
    fs.cpSync(path.join(__dirname, '../ScanGuard'), path.join(app, 'plugins/ScanGuard'), { recursive: true });
    fs.writeFileSync(path.join(app, 'plugins_configs/scanguard.json'), JSON.stringify(scanguardConfig));
    process.env.HOME = app;
    return require(path.join(app, 'plugins/ScanGuard/guard-core.js'));
}

function client(guard, ip, opts = {}) {
    const ws = new EventEmitter(); ws.closed = false;
    ws.close = () => { if (!ws.closed) { ws.closed = true; ws.emit('close'); } };
    const req = { headers: { 'x-forwarded-for': opts.xff || ip }, socket: { remoteAddress: '192.168.1.1' }, session: opts.admin ? { isAdminAuthenticated: true } : {} };
    return { ws, req };
}
const tune = (guard, c, mhz) => guard.allowTune(c.ws, c.req, 'T' + Math.round(mhz * 1000));
const isBanned = (guard, ip) => !!guard.status().bans.find(b => b.ip === ip);

const SC = { plugins: ['ScanGuard/scanguard.js'], webserver: { tuningLimit: true, tuningLowerLimit: 100, tuningUpperLimit: 108 }, defaultFreq: 103.3 };

// ---- Part 1: band 'auto' follows the webserver's limit; 'block'/'kick'; burst; window; back-compat
(function () {
    const guard = makeGuard(SC, { mode: 'enforce', bandGuard: 'auto' });

    // auto active (server has tuningLimit on): in-band tune passes, below-band tune is dropped
    const a = client(guard, '203.0.113.10');
    ok(tune(guard, a, 103.5) === true, 'auto: in-band 103.5 allowed');
    ok(tune(guard, a, 90.0) === false, 'auto: out-of-band 90.0 dropped (below 100)');
    ok(tune(guard, a, 120.0) === false, 'auto: out-of-band 120.0 dropped (above 108)');
    ok(!a.ws.closed, 'auto/block: client stays connected (not kicked)');

    // admin + LAN are exempt from the band guard
    const adm = client(guard, '203.0.113.11', { admin: true });
    ok(tune(guard, adm, 90.0) === true, 'auto: admin out-of-band allowed (exempt)');
    const lan = client(guard, '127.0.0.1');
    ok(tune(guard, lan, 90.0) === true, 'auto: LAN out-of-band allowed (exempt)');

    // the band's effective range is reported
    const st = guard.status();
    ok(st.band.mode === 'auto' && st.band.lower === 100 && st.band.upper === 108, 'status reports band 100-108');
})();

// ---- Part 2: 'kick' bans a repeat off-band offender and reports the configured range
(function () {
    const guard = makeGuard(SC, { mode: 'enforce', bandGuard: 'kick', bandLowerMHz: 87.5, bandUpperMHz: 108, offBandStrikesToKick: 4 });
    const b = client(guard, '203.0.113.20');
    for (let i = 0; i < 3; i++) { clock += 200; tune(guard, b, 86.5 - i * 0.1); }
    ok(!isBanned(guard, '203.0.113.20') && !b.ws.closed, 'kick: 3 off-band tries -> not yet banned');
    clock += 200; tune(guard, b, 86.1);
    ok(isBanned(guard, '203.0.113.20') && b.ws.closed, 'kick: 4th off-band try -> disconnected + banned');
    ok(tune(guard, client(guard, '203.0.113.21'), 95.0) === true, 'kick: in-band tune from another client still allowed');
})();

// ---- Part 3: fast burst (sustained) vs a short arrow-key burst
(function () {
    const guard = makeGuard(SC, { mode: 'enforce', bandGuard: 'off', maxTunesPerMinute: 120 });
    // sustained 130/min across a full minute -> banned
    const bot = client(guard, '203.0.113.30');
    for (let i = 0; i < 140; i++) { clock += 450; tune(guard, bot, 101 + ((i * 37) % 70) * 0.1); }  // scattered, ~2.2/s for ~63 s
    const bbot = guard.status().bans.find(x => x.ip === '203.0.113.30');
    ok(bbot && bbot.reason === 'too fast', 'burst: 130+/min sustained -> banned (too fast)');

    // a person holding the arrow key: many tunes but over a short span -> NOT banned
    const guard2 = makeGuard(SC, { mode: 'enforce', bandGuard: 'off', maxTunesPerMinute: 120 });
    const arrow = client(guard2, '198.51.100.30');
    let f = 100;
    for (let i = 0; i < 160 && f <= 108; i++) { clock += 40; tune(guard2, arrow, f); f += 0.1; }   // dense ~13 s burst
    ok(!isBanned(guard2, '198.51.100.30'), 'burst: dense but short arrow-key sweep -> NOT banned');
})();

// ---- Part 4: shorter rate window reacts sooner; legacy maxTunesPer5Minutes still honored
(function () {
    // window = 2 min, threshold 100: 120 in-band changes within 2 min -> throttled (dropped)
    const guard = makeGuard(SC, { mode: 'enforce', bandGuard: 'off', rateWindowMinutes: 2, maxTunesPerMinute: 100000 });
    // overwrite threshold key the back-compat way:
    guard.setLimits({ maxTunesPerWindow: 100 });
    const c = client(guard, '203.0.113.40');
    let dropped = 0;
    for (let i = 0; i < 130; i++) { clock += 800; const r = tune(guard, c, 100 + (i % 80) * 0.1); if (r === false) dropped++; }  // ~104 s
    ok(dropped > 0, 'window: 100+/2min threshold throttles (some tunes dropped)');

    // legacy config: only maxTunesPer5Minutes present, no new keys -> still throttles at 300/5min
    const legacy = makeGuard(SC, { mode: 'enforce', maxTunesPer5Minutes: 300 });
    const lc = client(legacy, '203.0.113.41');
    let drop2 = 0;
    for (let i = 0; i < 360; i++) { clock += 800; const r = tune(legacy, lc, 100 + (i % 80) * 0.1); if (r === false) drop2++; }  // ~288 s
    ok(drop2 > 0, 'back-compat: legacy maxTunesPer5Minutes still throttles');
})();

// ---- Part 5: auto is a no-op on a server that never set a tuning limit (don't surprise anyone)
(function () {
    const noLimit = { plugins: ['ScanGuard/scanguard.js'], webserver: { tuningLimit: false, tuningLowerLimit: 100, tuningUpperLimit: 108 } };
    const guard = makeGuard(noLimit, { mode: 'enforce', bandGuard: 'auto' });
    const c = client(guard, '203.0.113.50');
    ok(tune(guard, c, 90.0) === true, 'auto-off: no webserver limit -> out-of-band 90.0 still allowed');
    ok(guard.status().band.lower === null, 'auto-off: status reports no active band');
    // but an explicit range still works even when the webserver limit is off
    const guard2 = makeGuard(noLimit, { mode: 'enforce', bandGuard: 'block', bandLowerMHz: 87.5, bandUpperMHz: 108 });
    ok(tune(guard2, client(guard2, '203.0.113.51'), 86.0) === false, 'block + explicit range works even with webserver limit off');
})();

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
