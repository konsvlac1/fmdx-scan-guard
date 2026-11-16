// Scan Guard core: protects a public FM-DX tuner from automated band-scanning bots.
//
// Called from two small hooks in server/index.js:
//   onConnect(ws, request)            -> true = refuse this connection (address is banned)
//   allowTune(ws, request, command)   -> false = drop this tune command
//
// Detection is based on how a client tunes, not on who it says it is:
//   - sweep: a long run of tunes walking one way through the band with an even step,
//            each frequency held for a while, at a machine-steady rhythm, covering
//            several MHz -> disconnect + temporary ban
//            (a person holding an arrow key moves far faster, and a person clicking
//            and listening is not metronome-steady, so neither counts as a sweep)
//   - rate:  more than maxTunesPer5Minutes frequency changes in 5 minutes
//            -> extra commands are ignored for a minute (the client stays connected)
//   - still hammering while throttled -> disconnect + temporary ban
// Admin sessions, LAN/loopback clients (the server's own Scanner/Autotune plugins)
// and whitelisted addresses are never touched.
//
// Settings: plugins_configs/scanguard.json (created with defaults on first run).
// Log: scanguard.log in the FM-DX folder (not reachable from the web).

const fs = require('fs');
const path = require('path');
const https = require('https');

const APP_DIR = path.join(__dirname, '../..');
const CONFIG_PATH = path.join(APP_DIR, 'plugins_configs/scanguard.json');
const LOG_PATH = path.join(APP_DIR, 'scanguard.log');
const TELEGRAM_PATH = path.join(process.env.HOME || '/home/konvlachos', '.scanguard-telegram');
const PLUGIN_ENTRY = 'ScanGuard/scanguard.js';

const DEFAULTS = {
    mode: 'watch',              // 'watch' = only log, 'enforce' = throttle / kick / ban
    maxTunesPer5Minutes: 300,   // sustained rate; short key-scroll bursts never reach it
    sweepMinSteps: 50,          // tunes in a row with the same step in the same direction
    sweepMinSpanMHz: 5.0,
    sweepMaxStepMHz: 0.5,
    monotonicMinSteps: 40,      // any one-way walk (e.g. a list of known frequencies)
    monotonicMinSpanMHz: 5.0,
    sweepMinSecondsPerTune: 0.4,// faster runs are key scrolling by a person, not a scan
    maxRhythmVariation: 0.15,    // variation of the time between tunes (0 = a metronome; people are far above)
    throttledHitsToBan: 60,     // tune attempts ignored within 5 minutes before a ban
    banMinutes: 60,
    whitelist: [],              // addresses never touched
    telegramLabel: 'TEF FM-DX'
};

let config = { ...DEFAULTS };
let configMtime = 0;

const clients = new Map();      // ip -> state
const bans = new Map();         // ip -> { until, reason }
let lastTelegram = 0;

function now() { return Date.now(); }

function loadConfig() {
    try {
        const st = fs.statSync(CONFIG_PATH);
        if (st.mtimeMs !== configMtime) {
            config = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
            configMtime = st.mtimeMs;
        }
    } catch (e) {
        if (e.code === 'ENOENT') {
            try {
                fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
                fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULTS, null, 2));
            } catch (_) { /* read-only: keep defaults */ }
        }
    }
    return config;
}

function serverConfig() {
    try { return require('../../server/server_config').serverConfig; } catch (e) { return {}; }
}

function enabled() {
    const plugins = serverConfig().plugins || [];
    return plugins.includes(PLUGIN_ENTRY);
}

function cleanIp(ip) {
    return String(ip || '').trim().replace(/^::ffff:/, '');
}

// The address to judge. Behind our proxy the client can put anything in the FIRST
// X-Forwarded-For entry, but the LAST one is added by the proxy itself.
function guardIp(request) {
    const xff = String(request.headers['x-forwarded-for'] || '').split(',').map(cleanIp).filter(Boolean);
    if (xff.length) return xff[xff.length - 1];
    return cleanIp(request.socket && request.socket.remoteAddress);
}

function allIps(request) {
    const xff = String(request.headers['x-forwarded-for'] || '').split(',').map(cleanIp).filter(Boolean);
    return [...xff, cleanIp(request.socket && request.socket.remoteAddress)].filter(Boolean);
}

function isLocal(ip) {
    return !ip || ip === '127.0.0.1' || ip === '::1' || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
}

function isExempt(ip, request) {
    const s = request.session || {};
    if (s.isAdminAuthenticated) return true;
    if (isLocal(ip)) return true;
    return (config.whitelist || []).map(cleanIp).includes(ip);
}

function log(event, ip, details) {
    const line = JSON.stringify({ time: new Date().toISOString(), mode: config.mode, event, ip, ...details });
    try { fs.appendFileSync(LOG_PATH, line + '\n'); } catch (_) { /* ignore */ }
    try {
        const { logWarn } = require('../../server/console');
        logWarn(`[Scan Guard] ${config.mode === 'enforce' ? '' : '(watch) '}${event} ${ip} ${details.note || ''}`);
    } catch (_) { /* ignore */ }
}

function telegram(text) {
    if (now() - lastTelegram < 60 * 1000) return;            // at most one message a minute
    let token, chat;
    try {
        const conf = fs.readFileSync(TELEGRAM_PATH, 'utf8');
        token = (conf.match(/^TELEGRAM_BOT_TOKEN=(.*)$/m) || [])[1];
        chat = (conf.match(/^TELEGRAM_CHAT_ID=(.*)$/m) || [])[1];
    } catch (_) { return; }
    if (!token || !chat) return;
    lastTelegram = now();
    const body = JSON.stringify({ chat_id: chat.trim().replace(/^"|"$/g, ''), text, disable_web_page_preview: true });
    const req = https.request({
        host: 'api.telegram.org', path: `/bot${token.trim().replace(/^"|"$/g, '')}/sendMessage`, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: 8000
    });
    req.on('error', () => {});
    req.on('timeout', () => req.destroy());
    req.end(body);
}

function state(ip) {
    let s = clients.get(ip);
    if (!s) {
        s = { tunes: [], sockets: new Set(), throttledUntil: 0, throttledHits: [], lastRateLog: 0, lastSeen: now() };
        clients.set(ip, s);
    }
    s.lastSeen = now();
    return s;
}

function activeBan(ip) {
    const b = bans.get(ip);
    if (!b) return null;
    if (b.until <= now()) { bans.delete(ip); return null; }
    return b;
}

function ban(ip, s, reason, details) {
    const until = now() + config.banMinutes * 60 * 1000;
    log('BAN', ip, { reason, minutes: config.banMinutes, ...details });
    telegram(`🛡️ ${config.telegramLabel}: Scan Guard ${config.mode === 'enforce' ? 'banned' : 'would ban'} ${ip} for ${config.banMinutes} min.\nReason: ${reason}${details.note ? ' (' + details.note + ')' : ''}`);
    s.tunes = [];                                  // a new run is needed before the next detection
    if (config.mode !== 'enforce') return;
    bans.set(ip, { until, reason });
    for (const ws of s.sockets) {
        try { ws.close(1008, 'Automated scanning is not allowed on this tuner'); } catch (_) { /* ignore */ }
    }
}

// Longest run at the end of the history where every step has the same sign
// (and, for "even", the same size).
function tailRun(tunes, even) {
    if (tunes.length < 3) return null;
    let i = tunes.length - 1;
    const first = tunes[i].f - tunes[i - 1].f;
    if (Math.abs(first) < 0.001) return null;
    while (i > 0) {
        const step = tunes[i].f - tunes[i - 1].f;
        if (Math.sign(step) !== Math.sign(first)) break;
        if (even && Math.abs(step - first) > 0.0015) break;
        if (even && Math.abs(step) > config.sweepMaxStepMHz) break;
        i--;
    }
    const run = tunes.slice(i);
    const gaps = [];
    for (let k = 1; k < run.length; k++) gaps.push(run[k].t - run[k - 1].t);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const sd = Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length);
    return {
        steps: run.length - 1,
        span: Math.abs(run[run.length - 1].f - run[0].f),
        rhythm: mean > 0 ? sd / mean : 0,
        secondsPerTune: mean / 1000,
        from: run[0].f, to: run[run.length - 1].f
    };
}

function onConnect(ws, request) {
    try {
        if (!enabled()) return false;
        loadConfig();
        for (const ip of allIps(request)) {
            const b = activeBan(ip);
            if (b && config.mode === 'enforce') {
                try { ws.close(1008, 'Automated scanning is not allowed on this tuner'); } catch (_) { /* ignore */ }
                log('REFUSED', ip, { reason: b.reason, note: `banned until ${new Date(b.until).toISOString()}` });
                return true;
            }
        }
    } catch (e) { /* never break the server */ }
    return false;
}

function allowTune(ws, request, command) {
    try {
        if (!enabled()) return true;
        loadConfig();
        const ip = guardIp(request);
        if (isExempt(ip, request)) return true;
        const f = Number(String(command).slice(1)) / 1000;
        if (!isFinite(f)) return true;

        const s = state(ip);
        if (!s.sockets.has(ws)) {
            s.sockets.add(ws);
            ws.once('close', () => s.sockets.delete(ws));
        }
        if (activeBan(ip) && config.mode === 'enforce') {
            try { ws.close(1008, 'Automated scanning is not allowed on this tuner'); } catch (_) { /* ignore */ }
            return false;
        }

        const t = now();
        const last = s.tunes[s.tunes.length - 1];
        if (last && Math.abs(last.f - f) < 0.0015) return true;   // same frequency again (key repeat, RDS reset)
        s.tunes.push({ t, f });
        s.tunes = s.tunes.filter(x => t - x.t < 10 * 60 * 1000).slice(-3000);

        // 1. Sweep through the band
        const even = tailRun(s.tunes, true);
        if (even && even.steps >= config.sweepMinSteps && even.span >= config.sweepMinSpanMHz && even.rhythm <= config.maxRhythmVariation && even.secondsPerTune >= config.sweepMinSecondsPerTune) {
            ban(ip, s, 'band sweep', { steps: even.steps, note: `${even.from.toFixed(2)}→${even.to.toFixed(2)} MHz, ${even.steps} even steps, ${even.secondsPerTune.toFixed(1)} s/tune` });
            return config.mode !== 'enforce';
        }
        const oneWay = tailRun(s.tunes, false);
        if (oneWay && oneWay.steps >= config.monotonicMinSteps && oneWay.span >= config.monotonicMinSpanMHz && oneWay.rhythm <= config.maxRhythmVariation && oneWay.secondsPerTune >= config.sweepMinSecondsPerTune) {
            ban(ip, s, 'one-way frequency walk', { steps: oneWay.steps, note: `${oneWay.from.toFixed(2)}→${oneWay.to.toFixed(2)} MHz, ${oneWay.steps} tunes, ${oneWay.secondsPerTune.toFixed(1)} s/tune` });
            return config.mode !== 'enforce';
        }

        // 2. Too many frequency changes, sustained over 5 minutes
        const perWindow = s.tunes.filter(x => t - x.t < 5 * 60 * 1000).length;
        if (perWindow > config.maxTunesPer5Minutes || s.throttledUntil > t) {
            if (perWindow > config.maxTunesPer5Minutes) s.throttledUntil = t + 60 * 1000;
            s.tunes.pop();                                    // an ignored tune does not count as tuning
            s.throttledHits = s.throttledHits.filter(x => t - x < 5 * 60 * 1000);
            s.throttledHits.push(t);
            if (t - s.lastRateLog > 60 * 1000) {
                s.lastRateLog = t;
                log('THROTTLE', ip, { tunes5min: perWindow, note: `${perWindow} frequency changes in 5 min` });
            }
            if (s.throttledHits.length >= config.throttledHitsToBan) {
                s.throttledHits = [];
                ban(ip, s, 'kept tuning while slowed down', { note: `${config.throttledHitsToBan} ignored tunes in 5 min` });
            }
            return config.mode !== 'enforce';
        }
    } catch (e) { /* never break the server */ }
    return true;
}

function status() {
    loadConfig();
    const t = now();
    return {
        enabled: enabled(),
        mode: config.mode,
        bans: [...bans.entries()].filter(([, b]) => b.until > t).map(([ip, b]) => ({ ip, reason: b.reason, until: new Date(b.until).toISOString() })),
        watching: [...clients.entries()].filter(([, s]) => t - s.lastSeen < 10 * 60 * 1000)
            .map(([ip, s]) => ({ ip, tunesLast10Min: s.tunes.length, throttled: s.throttledUntil > t }))
    };
}

function setMode(mode) {
    if (mode !== 'watch' && mode !== 'enforce') return false;
    loadConfig();
    let current = {};
    try { current = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (_) { current = { ...DEFAULTS }; }
    current.mode = mode;
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(current, null, 2));
    configMtime = 0;
    loadConfig();
    log('MODE', '-', { note: `switched to ${mode} by admin` });
    return true;
}

function recentEvents(n = 15) {
    try {
        const lines = fs.readFileSync(LOG_PATH, 'utf8').trim().split('\n').slice(-n).reverse();
        return lines.map(l => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
    } catch (_) { return []; }
}

function unban(ip) {
    const had = bans.delete(cleanIp(ip));
    if (had) log('UNBAN', cleanIp(ip), { note: 'by admin' });
    return had;
}

// Forget idle clients
setInterval(() => {
    const t = now();
    for (const [ip, s] of clients) if (t - s.lastSeen > 30 * 60 * 1000 && s.sockets.size === 0) clients.delete(ip);
    for (const [ip, b] of bans) if (b.until <= t) bans.delete(ip);
}, 5 * 60 * 1000).unref();

loadConfig();

module.exports = { onConnect, allowTune, status, unban, setMode, recentEvents, _test: { tailRun, guardIp, setConfig: c => { config = { ...DEFAULTS, ...c }; } } };
