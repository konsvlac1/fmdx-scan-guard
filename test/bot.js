// Test bot: sweeps the band on a public FM-DX server like an automated scanner.
// Usage: node bot.js <url> <tunes> <ms per tune>
const WebSocket = require(process.env.WS_PATH || 'ws');
const [url, n = 60, ms = 600] = process.argv.slice(2);
const origin = new URL(url).origin.replace('wss:', 'https:');
let sent = 0, closed = false;
function connect(label) {
    return new Promise(res => {
        const ws = new WebSocket(url.replace('https', 'wss') + '/text', { headers: { Origin: origin, 'User-Agent': 'scan-guard-test-bot/1.0' } });
        ws.on('open', () => res(ws));
        ws.on('close', (code, reason) => { closed = true; console.log(`${label}: closed by server, code ${code} "${reason}" after ${sent} tunes`); res(null); });
        ws.on('error', e => { console.log(`${label}: error ${e.message}`); res(null); });
    });
}
(async () => {
    const ws = await connect('sweep');
    if (!ws) return;
    let f = 87.5;
    for (let i = 0; i < Number(n) && !closed; i++) {
        ws.send('T' + Math.round(f * 1000)); sent++; f += 0.1;
        await new Promise(r => setTimeout(r, Number(ms)));
    }
    if (!closed) { console.log(`sweep: finished ${sent} tunes, never disconnected`); ws.close(); }
    await new Promise(r => setTimeout(r, 1500));
    closed = false;
    const again = await connect('reconnect');
    if (again) { console.log('reconnect: allowed'); again.close(); }
    process.exit(0);
})();
