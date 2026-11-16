// Simulate clients against Scan Guard with a fake clock.
const EventEmitter = require('events');
let clock = 1_800_000_000_000;
Date.now = () => clock;
const path = require('path');
const fs = require('fs');
const app = process.argv[2];
const mode = process.argv[3] || 'enforce';
fs.mkdirSync(path.join(app, 'plugins_configs'), { recursive: true });
fs.writeFileSync(path.join(app, 'plugins_configs/scanguard.json'), JSON.stringify({ mode }));
const guard = require(path.join(app, 'plugins/ScanGuard/guard-core.js'));

function client(ip, opts = {}) {
    const ws = new EventEmitter(); ws.closed = false;
    ws.close = () => { if (!ws.closed) { ws.closed = true; ws.emit('close'); } };
    const req = { headers: { 'x-forwarded-for': opts.xff || ip }, socket: { remoteAddress: '192.168.1.1' }, session: opts.admin ? { isAdminAuthenticated: true } : {} };
    return { ws, req, sent: 0, dropped: 0 };
}
function tune(c, mhz) {
    if (c.ws.closed) { c.dropped++; return; }
    const ok = guard.allowTune(c.ws, c.req, 'T' + Math.round(mhz * 1000));
    ok ? c.sent++ : c.dropped++;
}
const rnd = (a, b) => a + Math.random() * (b - a);
const results = [];
function run(name, ip, fn, opts) {
    const c = client(ip, opts); fn(c);
    const banned = guard.status().bans.find(b => b.ip === ip);
    results.push(`${name.padEnd(52)} sent ${String(c.sent).padStart(4)}  dropped ${String(c.dropped).padStart(4)}  ${c.ws.closed ? 'DISCONNECTED' : 'connected   '}  ${banned ? 'BANNED (' + banned.reason + ')' : 'not banned'}`);
}

// --- bots
run('BOT: sweep 87.5-108, 0.1 MHz, 2 s per frequency', '203.0.113.1', c => { for (let f = 87.5; f <= 108; f += 0.1) { clock += 2000 + rnd(-50, 50); tune(c, f); } });
{ const c = client('203.0.113.1'); const refused = guard.onConnect(c.ws, c.req); results.push(`${'BOT 203.0.113.1 reconnects right after the ban'.padEnd(52)} ${refused ? 'REFUSED' : 'allowed'}`); }
run('BOT: sweep 87.5-108, 0.1 MHz, 0.5 s per frequency', '203.0.113.2', c => { for (let f = 87.5; f <= 108; f += 0.1) { clock += 500 + rnd(-20, 20); tune(c, f); } });
run('BOT: known-station list upward, 3 s each', '203.0.113.3', c => { let f = 87.6; while (f < 107.9) { clock += 3000 + rnd(-100, 100); tune(c, f); f += [0.3, 0.5, 0.2, 0.8, 0.4][Math.floor(rnd(0, 5))]; } });
run('BOT: random order, 0.3 s each, 15 min', '203.0.113.4', c => { for (let i = 0; i < 3000; i++) { clock += 300; tune(c, 87.5 + Math.round(rnd(0, 205)) / 10); } });
run('BOT: spoofs X-Forwarded-For (real ip last)', '203.0.113.5', c => { for (let f = 87.5; f <= 100; f += 0.1) { clock += 1000; tune(c, f); } }, { xff: '1.2.3.4, 203.0.113.5' });
// --- people
run('PERSON: holds right arrow 87.5 -> 104 (key repeat)', '198.51.100.1', c => { for (let f = 87.5; f <= 104; f += 0.1) { clock += 35; tune(c, f); tune(c, f); } });
for (let r = 0; r < 20; r++) run('PERSON #' + r + ': clicks up, listens 2-15 s, 5 MHz', '198.51.101.' + r, c => { for (let f = 88; f <= 93; f += 0.1) { clock += rnd(2000, 15000); tune(c, f); } });
run('PERSON: clicks up steadily 3-5 s each, 5 MHz', '198.51.100.9', c => { for (let f = 88; f <= 93; f += 0.1) { clock += rnd(3000, 5000); tune(c, f); } });
run('PERSON: clicks up and listens 2-15 s each, 5 MHz', '198.51.100.2', c => { for (let f = 88; f <= 93; f += 0.1) { clock += rnd(2000, 15000); tune(c, f); } });
run('PERSON: presets + typing, 2 hours', '198.51.100.3', c => { const p = [91.3, 90.3, 92.0, 92.4, 99.5, 102.1, 105.0]; for (let i = 0; i < 400; i++) { clock += rnd(5000, 30000); tune(c, p[Math.floor(rnd(0, 7))] + (Math.random() < 0.3 ? 0.1 : 0)); } });
run('PERSON: DX session, scroll bursts + listening, 1 h', '198.51.100.4', c => { let f = 95; for (let i = 0; i < 120; i++) { const dir = Math.random() < 0.5 ? 1 : -1; for (let k = 0; k < rnd(3, 25); k++) { clock += 40; f = Math.min(108, Math.max(87.5, f + dir * 0.1)); tune(c, f); } clock += rnd(5000, 60000); } });
run('ADMIN: sweep with admin login', '198.51.100.5', c => { for (let f = 87.5; f <= 108; f += 0.1) { clock += 1000; tune(c, f); } }, { admin: true });
run('LAN: server own Scanner plugin (127.0.0.1)', '127.0.0.1', c => { for (let f = 87.5; f <= 108; f += 0.1) { clock += 1000; tune(c, f); } });
// banned bot comes back
clock += 61 * 60 * 1000;
{ const c = client('203.0.113.1'); const refused = guard.onConnect(c.ws, c.req); results.push(`${'BOT 203.0.113.1 reconnects after 61 min'.padEnd(52)} ${refused ? 'REFUSED' : 'allowed (ban expired)'}`); }
console.log(`mode: ${mode}\n` + results.join('\n'));
const log = fs.readFileSync(path.join(app, 'scanguard.log'), 'utf8').trim().split('\n');
console.log(`\nlog lines: ${log.length}; first BAN: ${log.find(l => l.includes('"BAN"'))}`);
process.exit(0);
