// Scan Guard admin endpoints (admin login required, same site only):
//   GET  /scanguard/status        mode, current bans, watched addresses, recent events
//   POST /scanguard/mode?mode=watch|enforce
//   POST /scanguard/unban?ip=...  lift a ban
const router = require('../../server/endpoints');
const guard = require('./guard-core');
const { logInfo } = require('../../server/console');

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

router.get('/scanguard/status', adminOnly, (req, res) => res.json({ ...guard.status(), events: guard.recentEvents(15) }));
router.post('/scanguard/mode', adminOnly, (req, res) => {
    const ok = guard.setMode(String(req.query.mode || ''));
    res.status(ok ? 200 : 400).json({ ok, mode: guard.status().mode });
});
router.post('/scanguard/unban', adminOnly, (req, res) => res.json({ unbanned: guard.unban(String(req.query.ip || '')) }));

logInfo(`[Scan Guard] active, mode: ${guard.status().mode}`);
