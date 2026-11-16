// Scan Guard admin endpoints (admin login required):
//   GET  /scanguard/status        current bans and watched addresses
//   POST /scanguard/unban?ip=...  lift a ban
const router = require('../../server/endpoints');
const guard = require('./guard-core');
const { logInfo } = require('../../server/console');

function adminOnly(req, res, next) {
    if (req.session && req.session.isAdminAuthenticated) return next();
    res.status(403).json({ error: 'admin login required' });
}

router.get('/scanguard/status', adminOnly, (req, res) => res.json(guard.status()));
router.post('/scanguard/unban', adminOnly, (req, res) => res.json({ unbanned: guard.unban(String(req.query.ip || '')) }));

logInfo(`[Scan Guard] active, mode: ${guard.status().mode}`);
