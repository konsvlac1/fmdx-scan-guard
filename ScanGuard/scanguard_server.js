// Scan Guard admin endpoints (admin login required, same site only):
//   GET  /scanguard/status        mode, current bans, watched addresses, recent events
//   POST /scanguard/mode?mode=watch|enforce
//   POST /scanguard/unban?ip=...  lift a ban
//   POST /scanguard/ai?mode=block|off  AI crawler blocking
//   POST /scanguard/limits        band limit + rate/burst settings (JSON body)
//   POST /scanguard/installhook   add the line groups to server/index.js ("Fix it now")
const path = require('path');
const router = require('../../server/endpoints');
const guard = require('./guard-core');
const { logInfo } = require('../../server/console');
const hook = require('./hook');

// The line groups Scan Guard needs in server/index.js (missing when the plugin was copied by hand)
const INDEX_JS = path.join(__dirname, '../../server/index.js');
const hookState = () => { try { return hook.status(INDEX_JS); } catch (_) { return { missing: 4, possible: false }; } };
let hookAddedNow = false;   // added by the button: works after the next restart

function adminOnly(req, res, next) {
    if (!(req.session && req.session.isAdminAuthenticated)) return res.status(403).json({ error: 'admin login required' });
    if (req.method === 'POST') {
        // Only from our own page: the browser always sends Origin on POST
        const origin = req.headers.origin;
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        if (origin) {
            try { if (new URL(origin).host !== host) return res.status(403).json({ error: 'wrong origin' }); }
            catch (_) { return res.status(403).json({ error: 'wrong origin' }); }
        }
    }
    next();
}

router.get('/scanguard/status', adminOnly, (req, res) => res.json({ ...guard.status(), events: guard.recentEvents(15),
    hookInstalled: hookState().missing === 0, hookAddedNow }));
router.post('/scanguard/mode', adminOnly, (req, res) => {
    const ok = guard.setMode(String(req.query.mode || ''));
    res.status(ok ? 200 : 400).json({ ok, mode: guard.status().mode });
});
router.post('/scanguard/ai', adminOnly, (req, res) => {
    const ok = guard.setAiMode(String(req.query.mode || ''));
    res.status(ok ? 200 : 400).json({ ok, ai: guard.status().ai });
});
router.post('/scanguard/limits', adminOnly, (req, res) => {
    const src = { ...(req.body || {}), ...(req.query || {}) };   // query wins; both are accepted
    const ok = guard.setLimits(src);
    const st = guard.status();
    res.status(ok ? 200 : 400).json({ ok, band: st.band, rate: st.rate });
});
router.post('/scanguard/installhook', adminOnly, (req, res) => {
    if (!req.headers.origin) return res.status(403).json({ error: 'This must come from the server\'s own page.' });
    let r;
    try { r = hook.install(INDEX_JS); } catch (e) { return res.status(500).json({ error: 'Could not change server/index.js: ' + e.message }); }
    if (r.unknown) return res.status(409).json({ error: 'server/index.js looks different (Scan Guard is made for FM-DX 1.4.x), so it was not changed.' });
    hookAddedNow = true;
    logInfo(`[Scan Guard] ${r.added} line group(s) added to server/index.js from the admin page; restart FM-DX to start protecting`);
    res.json({ ok: true });
});
router.post('/scanguard/unban', adminOnly, (req, res) => res.json({ unbanned: guard.unban(String(req.query.ip || '')) }));

{
    const st = guard.status();
    const bandNote = st.band.lower != null ? `band ${st.band.mode} ${st.band.lower}-${st.band.upper} MHz` : `band ${st.band.mode} (no limit active)`;
    logInfo(`[Scan Guard] active, band scanners: ${st.mode}, ${bandNote}, AI crawlers: ${st.ai.mode}${hookState().missing ? ' - WARNING: its lines are missing in server/index.js: press "Fix it now" in Setup → Scan Guard (or run install.js), then restart' : ''}`);
}
