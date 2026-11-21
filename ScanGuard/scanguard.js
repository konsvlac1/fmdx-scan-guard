// Scan Guard page part:
//   - main page: a shield button in the admin quick buttons (settings menu) that opens
//     a small window with Watch / Enforce, AI crawlers, current bans and recent events
//   - Setup page (/setup): the same controls in their own "Scan Guard" tab
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
.sg-box { text-align: left; font-size: 14px; }
#scanguard .sg-box { max-width: 760px; margin: 0 auto; }
#sg-backdrop { position: fixed; inset: 0; z-index: 99999; background: rgba(0,0,0,.45); }
.sg-box h2 { margin: 0 0 4px; font-size: 18px; display: flex; align-items: center; gap: 8px; }
.sg-box .sg-sub { margin: 0 0 14px; opacity: .75; font-size: 13px; }
.sg-box button { width: auto !important; height: auto !important; min-width: 0 !important; margin: 0 !important;
  padding: 8px 16px !important; border-radius: 10px !important; cursor: pointer; font-size: 14px !important;
  background: var(--color-2, #333) !important; color: var(--color-text, #fff) !important; border: 1px solid transparent !important; }
.sg-box button.sg-on { background: var(--color-4, #5a5) !important; color: var(--color-main, #000) !important; font-weight: 700; }
.sg-box .sg-modes { display: flex; gap: 10px; margin-bottom: 8px; flex-wrap: wrap; }
.sg-box .sg-help { font-size: 13px; opacity: .85; margin: 6px 0 16px; line-height: 1.4; }
.sg-box h3 { margin: 16px 0 6px; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; opacity: .8; }
.sg-box table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.sg-box td { padding: 5px 6px; border-top: 1px solid rgba(255,255,255,.1); vertical-align: top; }
.sg-box .sg-empty { opacity: .6; font-size: 13px; }
.sg-box .sg-close { position: absolute; top: 10px; right: 12px; padding: 2px 10px !important; font-size: 18px !important; }
.sg-box .sg-small { padding: 3px 10px !important; font-size: 12px !important; }
.sg-box .sg-ban { color: #ff8a80; font-weight: 700; }
.sg-box .sg-about { margin: 2px 0 14px; padding: 10px 14px; border-radius: 10px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.12); font-size: 13px; line-height: 1.45; }
.sg-box .sg-about > summary { cursor: pointer; font-weight: 700; opacity: .9; list-style: none; }
.sg-box .sg-about > summary::-webkit-details-marker { display: none; }
.sg-box .sg-about > summary::before { content: '\\25B8\\00a0'; }
.sg-box .sg-about[open] > summary::before { content: '\\25BE\\00a0'; }
.sg-box .sg-about p { margin: 8px 0 0; opacity: .9; }
.sg-box .sg-row { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin: 8px 0 2px; }
.sg-box .sg-num { width: 68px; padding: 3px 6px; font-size: 13px; border-radius: 6px; border: 1px solid rgba(255,255,255,.25);
    background: rgba(255,255,255,.08); color: inherit; }
.sg-box .sg-note { opacity: .6; font-size: 12px; }
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
        OFF_BAND: 'tuning outside the band (dropped)',
        UNBAN: 'unblocked by admin',
        MODE: 'setting changed',
        LIMITS: 'limits changed',
        AI_BLOCK: 'AI crawler refused'
    };

    function render(st, box) {
        const enforce = st.mode === 'enforce';
        const aiOn = !st.ai || st.ai.mode === 'block';
        const band = st.band || {};
        const bandMode = band.mode || 'auto';
        const rate = st.rate || { windowMinutes: 5, maxPerWindow: 300, maxPerMinute: 120 };
        const bandNote = {
            off: '<b>Off:</b> no frequency limit is enforced.',
            auto: band.lower != null
                ? `<b>Auto:</b> using this server's own tuning limit, <b>${esc(band.lower)}&ndash;${esc(band.upper)} MHz</b>. Out-of-band tunes are dropped.`
                : "<b>Auto:</b> this server has no tuning limit set, so nothing is enforced. Turn on the webserver's tuning limit, or pick Block/Disconnect and set a range below.",
            block: band.lower != null ? `<b>Block:</b> out-of-band tunes are dropped (dial stays in <b>${esc(band.lower)}&ndash;${esc(band.upper)} MHz</b>); the listener stays connected.` : '<b>Block:</b> set a range below (or turn on the webserver\'s tuning limit) &mdash; without one, nothing is enforced.',
            kick: band.lower != null ? `<b>Disconnect:</b> out-of-band tunes are dropped and a repeat offender is disconnected, blocked for an hour and the dial is reset to default (range <b>${esc(band.lower)}&ndash;${esc(band.upper)} MHz</b>).` : '<b>Disconnect:</b> set a range below (or turn on the webserver\'s tuning limit) &mdash; without one, nothing is enforced.'
        }[bandMode] || '';
        const bandsList = (band.bands && band.bands.length) ? band.bands.map(r => r[0] + '-' + r[1]).join(', ') : '';
        const bandsDesc = bandsList ? bandsList.split(', ').map(x => esc(x)).join(', ') : '';
        const compact = !!(box && box.closest && box.closest('#sg-panel'));   // the small popup window vs the full Setup tab
        const openAttr = compact ? '' : ' open';                              // show the explainer open on the Setup page
        if (button) button.classList.toggle('active', enforce);
        const bans = (st.bans || []).map(b => `<tr><td>${esc(b.ip)}</td><td>${esc(b.reason)}</td><td>until ${esc(when(b.until))}</td>
            <td><button class="sg-small" data-unban="${esc(b.ip)}">Unblock</button></td></tr>`).join('');
        const events = (st.events || []).map(e => {
            const what = e.event === 'BAN' && e.mode === 'watch' ? 'would have been blocked (watch mode)' : (EVENT_TEXT[e.event] || e.event);
            return `<tr><td>${esc(when(e.time))}</td><td>${esc(e.ip === '-' ? '' : e.ip)}</td>
                <td><span class="${e.event === 'BAN' ? 'sg-ban' : ''}">${esc(what)}</span>${e.note ? '<br><span style="opacity:.7">' + esc(e.note) + '</span>' : ''}</td></tr>`;
        }).join('');
        const hookNote = st.hookInstalled === false
            ? `<p style="color:#f66"><b>One more step is needed:</b> Scan Guard must add a few lines to FM-DX's <code>server/index.js</code>, otherwise it protects nothing.<br>
               <button data-act="installhook">🔧 Fix it now</button> then restart FM-DX.</p>`
            : (st.hookAddedNow ? `<p style="color:#fc6"><b>✅ Done. Now restart FM-DX</b> (close it and start it again). After that Scan Guard protects your tuner.</p>` : '');
        box.querySelector('.sg-body').innerHTML = hookNote + `
            <details class="sg-about"${openAttr}>
              <summary>&#8505;&#65039; What is Scan Guard, and what problem does it solve?</summary>
              <p>Your tuner is a <b>single radio that everyone shares</b>. Automated <b>band-scanning robots</b> &mdash; for example sites that index public tuners (such as piratenscanner.nl) &mdash; connect and change the frequency hundreds of times a minute to sweep the whole band. While a robot scans, the dial keeps jumping, so <b>real listeners cannot listen</b>, and the robot also uses up bandwidth and a listener slot. Some <b>AI crawlers</b> (ChatGPT, Claude, Perplexity&hellip;) read the site automatically too.</p>
              <p>Scan Guard watches <b>how fast and how regularly</b> each visitor changes the frequency. A person tunes a few times, irregularly; a robot tunes far too fast and too evenly. <b>In Watch mode it only writes down what it finds &mdash; nobody is affected.</b> In <b>Enforce</b> mode it acts: a client making too many changes has its <b>tuning stopped for about a minute</b> (&ldquo;slowed down&rdquo;), and an obvious band-scanner is <b>disconnected and blocked for an hour</b>. It also asks AI crawlers to stay away (robots.txt) and refuses them if they ignore it. <b>People, the admin and your own network are never touched.</b></p>
            </details>
            <h3>Band-scanning robots</h3>
            <div class="sg-modes">
              <button data-mode="watch" class="${enforce ? '' : 'sg-on'}">👁 Watch</button>
              <button data-mode="enforce" class="${enforce ? 'sg-on' : ''}">🛡 Enforce</button>
            </div>
            <div class="sg-help">${enforce
                ? '<b>Enforce (protecting now):</b> band-scanning robots are slowed down, and obvious scanners are disconnected and blocked for an hour.'
                : '<b>Watch (safe start):</b> nobody is slowed or blocked yet &mdash; Scan Guard only writes down what it <i>would</i> do, so you can watch it work first. Switch to Enforce once the log looks right.'}
              <br>A visitor is treated as a robot when it <b>sweeps the band</b> in even steps, <b>walks one way</b> through many frequencies, changes frequency <b>more than ${esc(rate.maxPerMinute)} times in a minute</b>, or makes <b>${esc(rate.maxPerWindow)}+ changes in ${esc(rate.windowMinutes)} minutes</b>. People, the admin and your own network are never affected.</div>
            <h3>Band limit (keep tuning inside the band)</h3>
            <div class="sg-modes">
              <button data-band="auto" class="${bandMode === 'auto' ? 'sg-on' : ''}">Auto</button>
              <button data-band="off" class="${bandMode === 'off' ? 'sg-on' : ''}">Off</button>
              <button data-band="block" class="${bandMode === 'block' ? 'sg-on' : ''}">Block</button>
              <button data-band="kick" class="${bandMode === 'kick' ? 'sg-on' : ''}">Disconnect</button>
            </div>
            <div class="sg-help">${bandsDesc ? `<b>Allowed bands:</b> ${bandsDesc} MHz &mdash; anything outside these is blocked, including the <b>OIRT band</b> and the gaps between your bands.` : bandNote}
              <div class="sg-row">Allowed bands <input class="sg-num" style="width:210px" id="sg-bands" type="text" placeholder="e.g. 0.144-27, 87.5-108" value="${bandsList}"> MHz
                <button class="sg-small" data-save="bands">Save bands</button>
                <span class="sg-note">list every allowed range &mdash; blocks the OIRT band and the gaps in between</span></div>
              <div class="sg-row">Single range <input class="sg-num" id="sg-band-lo" type="number" step="0.1" placeholder="${band.lower != null ? esc(band.lower) : 'auto'}" value="${band.setLower != null ? esc(band.setLower) : ''}">&ndash;<input class="sg-num" id="sg-band-hi" type="number" step="0.1" placeholder="${band.upper != null ? esc(band.upper) : 'auto'}" value="${band.setUpper != null ? esc(band.setUpper) : ''}"> MHz
                <button class="sg-small" data-save="band">Save range</button>
                <span class="sg-note">used only when no bands are listed above (blank = the server's own tuning limit)</span></div>
              <br>This also stops a client that tunes <b>outside the allowed band(s) through the raw API</b> (not the normal dial). The out-of-band command is dropped, so the tuner does not move &mdash; it may still show in FM-DX's &ldquo;Command received&rdquo; log (received, but not forwarded).</div>
            <h3>React faster</h3>
            <div class="sg-help">
              <div class="sg-row">Allow up to <input class="sg-num" id="sg-max-win" type="number" min="10" step="10" value="${esc(rate.maxPerWindow)}"> changes in <input class="sg-num" id="sg-win" type="number" min="1" max="60" value="${esc(rate.windowMinutes)}"> min
                <button class="sg-small" data-save="rate">Save</button></div>
              <div class="sg-row">Hard cap <input class="sg-num" id="sg-max-min" type="number" min="10" step="10" value="${esc(rate.maxPerMinute)}"> changes / minute <span class="sg-note">anything faster is a bot &rarr; disconnected at once</span></div>
              <span class="sg-note">Lower the window (e.g. 2&nbsp;min) or the per-minute cap to act sooner on a spammer.</span></div>
            <h3>AI crawlers (ChatGPT, Claude, Perplexity …)</h3>
            <div class="sg-modes">
              <button data-ai="block" class="${aiOn ? 'sg-on' : ''}">🚫 Block</button>
              <button data-ai="off" class="${aiOn ? '' : 'sg-on'}">Allow</button>
            </div>
            <div class="sg-help">${aiOn
                ? `AI crawlers are told to stay away (robots.txt) and refused if they come anyway. Refused since the last restart: <b>${esc((st.ai || {}).blockedSinceStart || 0)}</b>.`
                : 'AI crawlers are allowed to read this site.'}
              Normal visitors, apps and search engines are not affected.</div>
            <h3>Band-scanning robots: blocked now</h3>
            ${bans ? `<table>${bans}</table>` : '<div class="sg-empty">Nobody is blocked.</div>'}
            <h3>Recent events</h3>
            <div class="sg-help"><b>Watch mode:</b> nothing here actually happened &mdash; it only shows what Enforce mode <i>would</i> do. <b>Slowed down</b> = that client changed frequency too fast for the window, so its <b>tuning stopped working for ~1 minute</b>; it stays connected &mdash; a warning, not a block. <b>Tuning outside the band</b> = an out-of-band tune (often the raw API) was dropped; the dial did not move. <b>Blocked</b> = disconnected and barred for an hour (a band sweep, a &ldquo;too fast&rdquo; burst, or repeated out-of-band tries). A normal listener never reaches these; admin and your own network are always exempt.</div>
            ${events ? `<table>${events}</table>` : '<div class="sg-empty">Nothing suspicious so far.</div>'}`;
    }

    async function refresh(box) {
        try { render(await api('GET', '/scanguard/status'), box); }
        catch (e) { box.querySelector('.sg-body').innerHTML = `<div class="sg-empty">Could not load Scan Guard (${esc(e.message)}). Are you logged in as admin?</div>`; }
    }

    // Buttons inside a Scan Guard box (window or Setup tab)
    function wire(box) {
        box.addEventListener('click', async ev => {
            const t = ev.target.closest('button');
            if (!t) return;
            ev.preventDefault();
            ev.stopPropagation();
            if (t.classList.contains('sg-close')) return close();
            try {
                if (t.dataset.act === 'installhook') await api('POST', '/scanguard/installhook');
                if (t.dataset.mode) await api('POST', '/scanguard/mode?mode=' + t.dataset.mode);
                if (t.dataset.ai) await api('POST', '/scanguard/ai?mode=' + t.dataset.ai);
                if (t.dataset.band) await api('POST', '/scanguard/limits?bandGuard=' + t.dataset.band);
                if (t.dataset.save === 'band') {
                    const lo = box.querySelector('#sg-band-lo').value.trim();
                    const hi = box.querySelector('#sg-band-hi').value.trim();
                    await api('POST', '/scanguard/limits?bandLowerMHz=' + encodeURIComponent(lo) + '&bandUpperMHz=' + encodeURIComponent(hi));
                }
                if (t.dataset.save === 'bands') {
                    const bands = box.querySelector('#sg-bands').value.trim();
                    await api('POST', '/scanguard/limits?allowedBands=' + encodeURIComponent(bands));
                }
                if (t.dataset.save === 'rate') {
                    const q = ['rateWindowMinutes=' + encodeURIComponent(box.querySelector('#sg-win').value.trim()),
                               'maxTunesPerWindow=' + encodeURIComponent(box.querySelector('#sg-max-win').value.trim()),
                               'maxTunesPerMinute=' + encodeURIComponent(box.querySelector('#sg-max-min').value.trim())].join('&');
                    await api('POST', '/scanguard/limits?' + q);
                }
                if (t.dataset.unban) await api('POST', '/scanguard/unban?ip=' + encodeURIComponent(t.dataset.unban));
                await refresh(box);
            } catch (e) { alert('Scan Guard: ' + e.message); }
        });
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
        panel.className = 'sg-box';
        panel.setAttribute('role', 'dialog');
        panel.innerHTML = `<button class="sg-close" aria-label="Close">×</button>
            <h2>🛡 Scan Guard <span style="font-size:12px;font-weight:400;opacity:.7">by konvlachos</span></h2><p class="sg-sub">Protects this tuner from band-scanning robots and this site from AI crawlers.</p>
            <div class="sg-body"><div class="sg-empty">Loading…</div></div>`;
        wire(panel);
        document.body.appendChild(bd);
        document.body.appendChild(panel);
        window.addEventListener('keydown', keyGuard, true);
        refresh(panel);
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

    // Setup page: a "Scan Guard" tab right after "Plugins"
    function addSetupTab() {
        const pluginsLi = document.querySelector('ul.nav li[data-panel="plugins-tab"]');
        const pluginsPanel = document.getElementById('plugins-tab');
        if (!pluginsLi || !pluginsPanel || document.getElementById('scanguard')) return !!pluginsLi;
        addStyle();
        const li = document.createElement('li');
        li.setAttribute('role', 'tab');
        li.setAttribute('data-panel', 'scanguard');
        li.setAttribute('tabindex', '0');
        li.innerHTML = '<a href="#" role="tab" tabindex="-1" aria-controls="scanguard"><i class="fa-solid fa-fw fa-shield-halved"></i> Scan Guard</a>';
        pluginsLi.after(li);

        const tab = document.createElement('div');
        tab.className = 'panel-full m-0 tab-content no-bg';
        tab.id = 'scanguard';
        tab.setAttribute('role', 'tabpanel');
        tab.style.display = 'none';
        tab.innerHTML = `<h2>Scan Guard</h2>
            <div class="panel-100 p-bottom-20"><div class="sg-box">
              <p class="sg-sub">Protects this tuner from band-scanning robots and this site from AI crawlers.</p>
              <div class="sg-body"><div class="sg-empty">Loading…</div></div>
            </div></div>`;
        pluginsPanel.after(tab);
        wire(tab.querySelector('.sg-box'));

        // Same behaviour as the Setup page's own tabs (they may already be wired up)
        let filled = false;
        li.addEventListener('click', e => {
            e.preventDefault();
            filled = true;
            document.querySelectorAll('ul.nav li').forEach(x => { x.classList.remove('active'); x.setAttribute('aria-selected', 'false'); });
            li.classList.add('active');
            li.setAttribute('aria-selected', 'true');
            if (document.activeElement && document.activeElement.closest && document.activeElement.closest('ul.nav')) li.focus({ preventScroll: true });
            history.replaceState(null, '', '#scanguard');
            document.querySelectorAll('.tab-content').forEach(x => { x.style.display = 'none'; });
            tab.style.display = 'block';           // the Setup stylesheet hides tabs by default
            refresh(tab.querySelector('.sg-box'));
        });
        li.addEventListener('keydown', e => { if (e.key === 'Enter') li.click(); });
        window.addEventListener('hashchange', () => { if (location.hash === '#scanguard') li.click(); });
        // Direct link /setup#scanguard: the Setup page shows its first tab while starting,
        // so keep selecting ours until it stays visible (up to 5 s)
        if (location.hash === '#scanguard') {
            let n = 0;
            const t = setInterval(() => {
                if (tab.style.display === 'none' || !tab.offsetParent || !filled) li.click();
                else if (++n > 3) clearInterval(t);
            }, 300);
            setTimeout(() => clearInterval(t), 5000);
        }
        return true;
    }

    function start() {
        if (addSetupTab()) return;
        if (addButton()) return;
        let tries = 0;
        const t = setInterval(() => { if (addButton() || ++tries > 20) clearInterval(t); }, 500);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
