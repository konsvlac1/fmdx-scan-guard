// Scan Guard page part: a shield button in the admin quick buttons (settings menu)
// that opens a small panel with Watch / Enforce, current bans and recent events.
// Only admins get this row, so listeners and tune-password users see nothing and send no requests.
(function () {
    'use strict';

    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    let panel = null;
    let button = null;

    const css = `
#sg-panel { position: fixed; z-index: 100000; top: 50%; left: 50%; transform: translate(-50%, -50%);
  width: min(560px, 94vw); max-height: 86vh; overflow: auto; box-sizing: border-box; padding: 18px 20px;
  background: var(--color-1, #1b1b1b); color: var(--color-text, #fff); border-radius: 14px;
  border: 1px solid var(--color-4, #888); box-shadow: 0 10px 40px rgba(0,0,0,.6); font-size: 14px; text-align: left; }
#sg-backdrop { position: fixed; inset: 0; z-index: 99999; background: rgba(0,0,0,.45); }
#sg-panel h2 { margin: 0 0 4px; font-size: 18px; display: flex; align-items: center; gap: 8px; }
#sg-panel .sg-sub { margin: 0 0 14px; opacity: .75; font-size: 13px; }
#sg-panel button { width: auto !important; height: auto !important; min-width: 0 !important; margin: 0 !important;
  padding: 8px 16px !important; border-radius: 10px !important; cursor: pointer; font-size: 14px !important;
  background: var(--color-2, #333) !important; color: var(--color-text, #fff) !important; border: 1px solid transparent !important; }
#sg-panel button.sg-on { background: var(--color-4, #5a5) !important; color: var(--color-main, #000) !important; font-weight: 700; }
#sg-panel .sg-modes { display: flex; gap: 10px; margin-bottom: 8px; flex-wrap: wrap; }
#sg-panel .sg-help { font-size: 13px; opacity: .85; margin: 6px 0 16px; line-height: 1.4; }
#sg-panel h3 { margin: 16px 0 6px; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; opacity: .8; }
#sg-panel table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
#sg-panel td { padding: 5px 6px; border-top: 1px solid rgba(255,255,255,.1); vertical-align: top; }
#sg-panel .sg-empty { opacity: .6; font-size: 13px; }
#sg-panel .sg-close { position: absolute; top: 10px; right: 12px; padding: 2px 10px !important; font-size: 18px !important; }
#sg-panel .sg-small { padding: 3px 10px !important; font-size: 12px !important; }
#sg-panel .sg-ban { color: #ff8a80; font-weight: 700; }
`;

    function addStyle() {
        if (document.getElementById('sg-style')) return;
        const st = document.createElement('style');
        st.id = 'sg-style';
        st.textContent = css;
        document.head.appendChild(st);
    }

    async function api(method, url) {
        const r = await fetch(url, { method, credentials: 'same-origin' });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
        return r.json();
    }

    function when(iso) {
        const d = new Date(iso);
        return isNaN(d) ? '' : d.toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    }

    const EVENT_TEXT = {
        BAN: 'blocked for automated scanning',
        REFUSED: 'tried again while blocked',
        THROTTLE: 'slowed down: too many changes',
        UNBAN: 'unblocked by admin',
        MODE: 'mode changed'
    };

    function render(st) {
        const enforce = st.mode === 'enforce';
        if (button) button.classList.toggle('active', enforce);
        const bans = (st.bans || []).map(b => `<tr><td>${esc(b.ip)}</td><td>${esc(b.reason)}</td><td>until ${esc(when(b.until))}</td>
            <td><button class="sg-small" data-unban="${esc(b.ip)}">Unblock</button></td></tr>`).join('');
        const events = (st.events || []).map(e => {
            const what = e.event === 'BAN' && e.mode === 'watch' ? 'would have been blocked (watch mode)' : (EVENT_TEXT[e.event] || e.event);
            return `<tr><td>${esc(when(e.time))}</td><td>${esc(e.ip === '-' ? '' : e.ip)}</td>
                <td><span class="${e.event === 'BAN' ? 'sg-ban' : ''}">${esc(what)}</span>${e.note ? '<br><span style="opacity:.7">' + esc(e.note) + '</span>' : ''}</td></tr>`;
        }).join('');
        panel.querySelector('.sg-body').innerHTML = `
            <div class="sg-modes">
              <button data-mode="watch" class="${enforce ? '' : 'sg-on'}">👁 Watch</button>
              <button data-mode="enforce" class="${enforce ? 'sg-on' : ''}">🛡 Enforce</button>
            </div>
            <div class="sg-help">${enforce
                ? '<b>Enforce:</b> automatic band-scanning robots are disconnected and blocked for an hour.'
                : '<b>Watch:</b> nobody is blocked. Scan Guard only writes down what it <i>would</i> block.'}
              People, the admin and your own network are never blocked.</div>
            <h3>Blocked now</h3>
            ${bans ? `<table>${bans}</table>` : '<div class="sg-empty">Nobody is blocked.</div>'}
            <h3>Recent events</h3>
            ${events ? `<table>${events}</table>` : '<div class="sg-empty">Nothing suspicious so far.</div>'}`;
    }

    async function refresh() {
        try { render(await api('GET', '/scanguard/status')); }
        catch (e) { panel.querySelector('.sg-body').innerHTML = `<div class="sg-empty">Could not load Scan Guard (${esc(e.message)}). Are you logged in as admin?</div>`; }
    }

    // FM-DX tunes on arrow keys, B and R: keep keys inside the panel while it is open
    function keyGuard(e) {
        if (!panel) return;
        if (e.key === 'Escape') { close(); }
        e.stopPropagation();
    }

    function close() {
        if (!panel) return;
        panel.remove();
        document.getElementById('sg-backdrop')?.remove();
        panel = null;
        window.removeEventListener('keydown', keyGuard, true);
    }

    function open() {
        if (panel) return;
        addStyle();
        const bd = document.createElement('div');
        bd.id = 'sg-backdrop';
        bd.addEventListener('click', close);
        panel = document.createElement('div');
        panel.id = 'sg-panel';
        panel.setAttribute('role', 'dialog');
        panel.innerHTML = `<button class="sg-close" aria-label="Close">×</button>
            <h2>🛡 Scan Guard <span style="font-size:12px;font-weight:400;opacity:.7">by konvlachos</span></h2><p class="sg-sub">Protects this tuner from automatic band-scanning robots.</p>
            <div class="sg-body"><div class="sg-empty">Loading…</div></div>`;
        panel.addEventListener('click', async ev => {
            const t = ev.target.closest('button');
            if (!t) return;
            ev.preventDefault();
            ev.stopPropagation();
            if (t.classList.contains('sg-close')) return close();
            try {
                if (t.dataset.mode) render({ ...(await api('POST', '/scanguard/mode?mode=' + t.dataset.mode)), ...(await api('GET', '/scanguard/status')) });
                if (t.dataset.unban) { await api('POST', '/scanguard/unban?ip=' + encodeURIComponent(t.dataset.unban)); await refresh(); }
            } catch (e) { alert('Scan Guard: ' + e.message); }
        });
        document.body.appendChild(bd);
        document.body.appendChild(panel);
        window.addEventListener('keydown', keyGuard, true);
        refresh();
    }

    function addButton() {
        // The admin row is the one with the admin lock (tune-password users get a row without it)
        const lock = document.getElementById('dashboard-lock-admin');
        const bar = lock && lock.closest('.admin-quick-dashboard');
        if (!bar || document.getElementById('dashboard-scanguard')) return !!bar;
        button = document.createElement('div');
        button.className = 'icon tooltip';
        button.id = 'dashboard-scanguard';
        button.setAttribute('role', 'button');
        button.setAttribute('tabindex', '0');
        button.setAttribute('aria-label', 'Scan Guard: watch or enforce');
        button.setAttribute('data-tooltip', 'Scan Guard<br>Watch / Enforce');
        button.title = 'Scan Guard: Watch / Enforce';
        button.innerHTML = '<i class="fa-solid fa-shield-halved"></i>';
        button.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); open(); });
        button.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
        // Just before "Sign out"
        const signOut = bar.querySelector('.logout-link');
        if (signOut) bar.insertBefore(button, signOut); else bar.appendChild(button);
        // Show the current mode on the button (lit = enforce)
        api('GET', '/scanguard/status').then(st => button.classList.toggle('active', st.mode === 'enforce')).catch(() => {});
        return true;
    }

    function start() {
        if (addButton()) return;
        let tries = 0;
        const t = setInterval(() => { if (addButton() || ++tries > 20) clearInterval(t); }, 500);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
