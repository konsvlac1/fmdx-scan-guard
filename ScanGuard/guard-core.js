// Scan Guard core: protects a public FM-DX tuner from automated band-scanning bots
// and keeps AI crawlers off the website.
//
// AI crawlers (aiCrawlers: "block" by default):
//   - /robots.txt tells the known AI crawlers (GPTBot, ClaudeBot, PerplexityBot,
//     Google-Extended, CCBot, Bytespider, ...) to stay away; everyone else is allowed
//   - a crawler that comes anyway gets 403 for pages, files and the tuner connection
//   (called from a third hook: httpGuard(req, res, next) before FM-DX serves anything)
//
// Band scanners are handled by two small hooks in server/index.js:
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
    maxRhythmVariation: 0.10,    // variation of the time between tunes (0 = a metronome; people are far above)
    throttledHitsToBan: 60,     // tune attempts ignored within 5 minutes before a ban
    banMinutes: 60,
    whitelist: [],              // addresses never touched
    telegramLabel: 'TEF FM-DX',
    aiCrawlers: 'block',        // 'block' = robots.txt + 403 for AI crawlers, 'off' = do nothing
    blockSearchEngines: false,  // true = robots.txt also asks Google, Bing etc. to stay away

    // Band limit: keep clients inside the tuner's frequency range, even a direct websocket/API
    // client that bypasses the browser dial (e.g. a bot tuning below the FM band).
    bandGuard: 'auto',          // 'auto' = follow the webserver's own tuning limit; 'off'; 'block' = drop out-of-band tunes; 'kick' = also disconnect repeat offenders
    bandLowerMHz: null,         // low edge in MHz; null = use the webserver's tuningLowerLimit
    bandUpperMHz: null,         // high edge in MHz; null = use the webserver's tuningUpperLimit
    allowedBands: [],           // optional list of allowed ranges [[lo,hi],...] in MHz (e.g. LW/MW/SW/FM but NOT OIRT).
                                // When set, a tune is allowed only inside one of these bands; the single lower/upper above
                                // is ignored. Leave empty to use the single lower/upper range instead.
    offBandStrikesToKick: 4,    // out-of-band tune attempts (within the rate window) before a kick (bandGuard: 'kick')
    resetFreqOnKick: true,      // after an out-of-band kick, snap the tuner back to the default frequency

    // Rate limit: how fast is "too fast". The window is configurable so action can come sooner.
    rateWindowMinutes: 5,       // window for the sustained-rate check (lower = reacts sooner)
    maxTunesPerMinute: 120      // hard cap: more changes than this in any 60 s is a bot -> disconnect
};

// AI crawlers and AI assistants that fetch pages. Names as they appear in robots.txt;
// the ones marked robotsOnly do not have their own User-Agent (they are a robots.txt token).
const AI_BOTS = [
    'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User',
    'Claude-Web', 'anthropic-ai', 'PerplexityBot', 'Perplexity-User', 'CCBot', 'Bytespider',
    'Amazonbot', 'Meta-ExternalAgent', 'Meta-ExternalFetcher', 'FacebookBot', 'cohere-ai',
    'cohere-training-data-crawler', 'MistralAI-User', 'DuckAssistBot', 'YouBot', 'Diffbot',
    'ImagesiftBot', 'Timpibot', 'omgili', 'AI2Bot', 'Ai2Bot-Dolma', 'PanguBot', 'Kangaroo Bot',
    'Webzio-Extended', 'Applebot-Extended', 'Google-Extended'
];
const ROBOTS_ONLY = ['Applebot-Extended', 'Google-Extended'];
const AI_UA = new RegExp('(' + AI_BOTS.filter(b => !ROBOTS_ONLY.includes(b))
    .map(b => b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[ _-]?')).join('|') + ')', 'i');
const aiStats = { blocked: 0, since: new Date().toISOString(), lastLog: new Map() };

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

// The frequency range to enforce, or null = do nothing.
//   'off'               -> null
//   'auto'              -> the webserver's own limits, but only when its tuningLimit is on
//   'block' / 'kick'    -> bandLowerMHz/UpperMHz if set, else the webserver's limits
// If no usable range is known, returns null (so 'block' without any limits never blocks everything).
function bandLimits() {
    const mode = config.bandGuard;
    if (mode === 'off') return null;
    const wc = (serverConfig() || {}).webserver || {};
    if (mode === 'auto' && !wc.tuningLimit) return null;
    let lower = config.bandLowerMHz, upper = config.bandUpperMHz;
    if (lower == null) lower = wc.tuningLowerLimit;
    if (upper == null) upper = wc.tuningUpperLimit;
    lower = Number(lower); upper = Number(upper);
    if (!isFinite(lower) || !isFinite(upper) || lower >= upper) return null;
    return { lower, upper };
}

// Parse an allowed-bands value into [[lo,hi],...] MHz. Accepts an array of [lo,hi] pairs / {lo,hi}
// objects, or a string like "0.144-27, 87.5-108". Invalid or empty -> [].
function parseBands(v) {
    if (!v) return [];
    let arr = v;
    if (typeof v === 'string') arr = v.split(',').map(s => s.trim()).filter(Boolean).map(s => s.split('-').map(x => Number(x.trim())));
    if (!Array.isArray(arr)) return [];
    const out = [];
    for (const b of arr) {
        let lo, hi;
        if (Array.isArray(b)) { lo = Number(b[0]); hi = Number(b[1]); }
        else if (b && typeof b === 'object') { lo = Number(b.lo != null ? b.lo : b.lower); hi = Number(b.hi != null ? b.hi : b.upper); }
        if (isFinite(lo) && isFinite(hi) && lo < hi) out.push([lo, hi]);
    }
    return out.sort((a, b) => a[0] - b[0]);
}

// The set of allowed frequency ranges, or null = no restriction. A custom allowedBands list (e.g. a
// SW band AND the FM band, but NOT the OIRT gap in between) takes precedence over the single range.
function allowedRanges() {
    if (config.bandGuard === 'off') return null;
    const bands = parseBands(config.allowedBands);
    if (bands.length) return bands;
    const b = bandLimits();
    return b ? [[b.lower, b.upper]] : null;
}

// Best-effort: put the tuner back on the default frequency after an out-of-band kick.
// Uses the plugins API so it works even on a non-public tuner; silently skipped if unavailable.
function resetTuner() {
    if (!config.resetFreqOnKick || config.mode !== 'enforce') return;
    try {
        const api = require('../../server/plugins_api');
        if (!api || typeof api.sendPrivilegedCommand !== 'function') return;
        const sc = serverConfig() || {};
        let f = Number(sc.defaultFreq);
        if (!isFinite(f) || f <= 0) { const r = allowedRanges(); f = (r && r.length) ? r[0][0] : 0; }
        if (f > 0) api.sendPrivilegedCommand('T' + Math.round(f * 1000), true);
    } catch (_) { /* no tuner write available: ignore */ }
}

function cleanIp(ip) {
    return String(ip || '').trim().replace(/^::ffff:/, '');
}

// The address to judge. A client can put anything in the FIRST X-Forwarded-For entry,
// but each proxy appends the address it saw. Walking from the right, skip the local
// addresses of our own proxies; the first public address is the real visitor.
// (Only local addresses are skipped, so a fake header can never hide the visitor.)
function guardIp(request) {
    const chain = [...String(request.headers['x-forwarded-for'] || '').split(',').map(cleanIp).filter(Boolean),
                   cleanIp(request.socket && request.socket.remoteAddress)].filter(Boolean);
    for (let i = chain.length - 1; i >= 0; i--) {
        if (!isLocal(chain[i])) return chain[i];
    }
    return chain[chain.length - 1] || '';
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
        s = { tunes: [], sockets: new Set(), throttledUntil: 0, throttledHits: [], lastRateLog: 0, offBand: [], lastOffBandLog: 0, lastSeen: now() };
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

function aiCrawlerName(ua) {
    const m = String(ua || '').match(AI_UA);
    return m ? m[1] : null;
}

function robotsTxt() {
    const lines = ['# Robots policy (Scan Guard for FM-DX Webserver)', '# AI crawlers are not welcome on this site.', ''];
    for (const b of AI_BOTS) lines.push(`User-agent: ${b}`);
    lines.push('Disallow: /', '');
    lines.push('User-agent: *');
    lines.push(config.blockSearchEngines ? 'Disallow: /' : 'Allow: /');
    return lines.join('\n') + '\n';
}

// Third hook: runs before FM-DX serves any page or file
function httpGuard(req, res, next) {
    try {
        if (!enabled()) return next();
        loadConfig();
        if (config.aiCrawlers !== 'block') return next();
        if (req.method === 'GET' && req.path === '/robots.txt') {
            res.type('text/plain').set('Cache-Control', 'public, max-age=3600').send(robotsTxt());
            return;
        }
        const bot = aiCrawlerName(req.headers['user-agent']);
        if (bot) {
            aiStats.blocked++;
            const ip = guardIp(req);
            const t = now();
            const key = bot + ' ' + ip;
            if (t - (aiStats.lastLog.get(key) || 0) > 60 * 60 * 1000) {          // one log line per crawler and address per hour
                aiStats.lastLog.set(key, t);
                log('AI_BLOCK', ip, { bot, path: req.path, note: `${bot} asked for ${req.path}` });
            }
            res.status(403).type('text/plain').send('AI crawlers are not allowed on this site.\n');
            return;
        }
        res.set('X-Robots-Tag', 'noai, noimageai');
    } catch (e) { /* never break the server */ }
    next();
}

function setAiMode(mode) {
    if (mode !== 'block' && mode !== 'off') return false;
    let current = {};
    try { current = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (_) { current = { ...DEFAULTS }; }
    current.aiCrawlers = mode;
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(current, null, 2));
    configMtime = 0;
    loadConfig();
    log('MODE', '-', { note: `AI crawlers: ${mode} (by admin)` });
    return true;
}

function onConnect(ws, request) {
    try {
        if (!enabled()) return false;
        loadConfig();
        if (config.aiCrawlers === 'block' && aiCrawlerName(request.headers['user-agent'])) {
            aiStats.blocked++;
            try { ws.close(1008, 'AI crawlers are not allowed on this site'); } catch (_) { /* ignore */ }
            return true;
        }
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

        const t = now();
        const winMs = Math.max(1, Number(config.rateWindowMinutes) || 5) * 60 * 1000;
        const retentionMs = Math.max(10 * 60 * 1000, winMs);

        const s = state(ip);
        if (!s.sockets.has(ws)) {
            s.sockets.add(ws);
            ws.once('close', () => s.sockets.delete(ws));
        }
        if (activeBan(ip) && config.mode === 'enforce') {
            try { ws.close(1008, 'Automated scanning is not allowed on this tuner'); } catch (_) { /* ignore */ }
            return false;
        }

        // 0. Band limit: keep the dial inside the configured range. Dropping the command here means
        //    it never reaches the tuner, so an out-of-band tune simply does not work (the client may
        //    still appear in FM-DX's "Command received" log - it was received, just not forwarded).
        const ranges = allowedRanges();
        if (ranges && !ranges.some(([lo, hi]) => f >= lo - 1e-6 && f <= hi + 1e-6)) {
            const desc = ranges.map(r => r[0] + '-' + r[1]).join(', ');
            s.offBand = (s.offBand || []).filter(x => t - x < winMs);
            s.offBand.push(t);
            if (t - (s.lastOffBandLog || 0) > 60 * 1000) {
                s.lastOffBandLog = t;
                log('OFF_BAND', ip, { freq: f, allowed: desc, note: `${f.toFixed(2)} MHz is outside the allowed band(s): ${desc} MHz` });
            }
            if (config.bandGuard === 'kick' && s.offBand.length >= config.offBandStrikesToKick) {
                s.offBand = [];
                resetTuner();
                ban(ip, s, 'tuning outside the band', { note: `${config.offBandStrikesToKick} out-of-band tunes` });
            }
            return config.mode !== 'enforce';
        }

        const last = s.tunes[s.tunes.length - 1];
        if (last && Math.abs(last.f - f) < 0.0015) return true;   // same frequency again (key repeat, RDS reset)
        s.tunes.push({ t, f });
        s.tunes = s.tunes.filter(x => t - x.t < retentionMs).slice(-3000);

        // 1. Fast burst: far more changes in a minute than a person makes, kept up for most of that
        //    minute. The sweep checks below skip fast runs on purpose (fast = a person scrolling), so
        //    a quick API bot slips past them; this cap catches it and disconnects at once. The "span"
        //    test keeps out a person holding the arrow key: they fly across the band but stop within
        //    ~15 s (they reach the edge), whereas a bot hammers continuously.
        const recent = s.tunes.filter(x => t - x.t < 60 * 1000);
        if (recent.length > config.maxTunesPerMinute) {
            const span = recent[recent.length - 1].t - recent[0].t;
            if (span >= 30 * 1000) {
                ban(ip, s, 'too fast', { tunesPerMinute: recent.length, note: `${recent.length} frequency changes in 1 min, kept up for ${Math.round(span / 1000)} s` });
                return config.mode !== 'enforce';
            }
        }

        // 2. Sweep through the band
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

        // 3. Too many frequency changes, sustained over the rate window (5 min by default)
        const perWindow = s.tunes.filter(x => t - x.t < winMs).length;
        if (perWindow > config.maxTunesPer5Minutes || s.throttledUntil > t) {
            if (perWindow > config.maxTunesPer5Minutes) s.throttledUntil = t + 60 * 1000;
            s.tunes.pop();                                    // an ignored tune does not count as tuning
            s.throttledHits = s.throttledHits.filter(x => t - x < winMs);
            s.throttledHits.push(t);
            if (t - s.lastRateLog > 60 * 1000) {
                s.lastRateLog = t;
                log('THROTTLE', ip, { tunesWindow: perWindow, windowMin: config.rateWindowMinutes, note: `${perWindow} frequency changes in ${config.rateWindowMinutes} min` });
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
    const b = bandLimits();
    return {
        enabled: enabled(),
        mode: config.mode,
        ai: { mode: config.aiCrawlers, blockedSinceStart: aiStats.blocked, since: aiStats.since },
        band: { mode: config.bandGuard, lower: b ? b.lower : null, upper: b ? b.upper : null, setLower: config.bandLowerMHz, setUpper: config.bandUpperMHz, bands: parseBands(config.allowedBands), ranges: allowedRanges() },
        rate: { windowMinutes: config.rateWindowMinutes, maxPerWindow: config.maxTunesPer5Minutes, maxPerMinute: config.maxTunesPerMinute },
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

// Save the band / rate settings (from the Setup page). Only known keys, each range-checked;
// written to scanguard.json with the same write-and-reload pattern as setMode / setAiMode.
function setLimits(partial) {
    loadConfig();
    let current = {};
    try { current = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (_) { current = { ...DEFAULTS }; }
    const p = partial || {};
    const num = v => { const n = Number(v); return isFinite(n) ? n : null; };
    if (['auto', 'off', 'block', 'kick'].includes(p.bandGuard)) current.bandGuard = p.bandGuard;
    if (p.bandLowerMHz !== undefined) current.bandLowerMHz = (p.bandLowerMHz === null || p.bandLowerMHz === '') ? null : num(p.bandLowerMHz);
    if (p.bandUpperMHz !== undefined) current.bandUpperMHz = (p.bandUpperMHz === null || p.bandUpperMHz === '') ? null : num(p.bandUpperMHz);
    if (current.bandLowerMHz != null && current.bandUpperMHz != null && current.bandLowerMHz >= current.bandUpperMHz) { current.bandLowerMHz = null; current.bandUpperMHz = null; }
    if (p.allowedBands !== undefined) current.allowedBands = parseBands(p.allowedBands);
    const rw = num(p.rateWindowMinutes); if (rw && rw >= 1 && rw <= 60) current.rateWindowMinutes = Math.round(rw);
    const mw = num(p.maxTunesPerWindow); if (mw && mw >= 10) current.maxTunesPer5Minutes = Math.round(mw);
    const mm = num(p.maxTunesPerMinute); if (mm && mm >= 10) current.maxTunesPerMinute = Math.round(mm);
    const sk = num(p.offBandStrikesToKick); if (sk && sk >= 1) current.offBandStrikesToKick = Math.round(sk);
    if (p.resetFreqOnKick !== undefined) current.resetFreqOnKick = !!p.resetFreqOnKick;
    try {
        fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(current, null, 2));
    } catch (_) { return false; }
    configMtime = 0;
    loadConfig();
    const bandNote = (config.allowedBands && config.allowedBands.length) ? 'bands ' + config.allowedBands.map(r => r[0] + '-' + r[1]).join('/') : `${config.bandLowerMHz == null ? 'auto' : config.bandLowerMHz}-${config.bandUpperMHz == null ? 'auto' : config.bandUpperMHz}`;
    log('LIMITS', '-', { note: `band ${config.bandGuard} ${bandNote} MHz, rate ${config.maxTunesPer5Minutes}/${config.rateWindowMinutes}min, burst ${config.maxTunesPerMinute}/min (by admin)` });
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

module.exports = { onConnect, allowTune, httpGuard, status, unban, setMode, setAiMode, setLimits, recentEvents, _test: { tailRun, guardIp, aiCrawlerName, robotsTxt, bandLimits, parseBands, allowedRanges, setConfig: c => { config = { ...DEFAULTS, ...c }; } } };
