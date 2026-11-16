# Scan Guard for FM-DX Webserver

Protects a **public FM-DX tuner** from automated band-scanning bots.

Some public tuners are used by scripts that sweep the whole FM band
(87.5, 87.6, 87.7 … 108.0) to log stations. While such a scan runs, the
tuner is busy and real listeners cannot use it. Scan Guard recognises
these scans by **how a client tunes** and stops them, while normal
listeners and DXers are not affected.

> **Status: 1.0.0, beta.** Running in watch mode on one server first.
> Start in `watch` mode, check the log for a few days, then switch to `enforce`.

## How it decides

| Behaviour | What Scan Guard does |
|---|---|
| **Band sweep**: 50+ tunes in a row in one direction with the same step (≤ 0.5 MHz), covering 5+ MHz, each frequency held 0.4 s or longer, at a machine-steady rhythm | disconnect + ban for 60 min |
| **One-way walk**: 40+ tunes always upward (or downward) over 5+ MHz at a machine-steady rhythm (e.g. a list of known stations) | disconnect + ban for 60 min |
| **Too many changes**: more than 300 frequency changes in 5 minutes | further tune commands are ignored for a minute; the client stays connected |
| **Keeps going while slowed down**: 60 ignored tunes within 5 minutes | disconnect + ban for 60 min |

Never touched:
- the **admin** login
- **LAN / localhost** clients (the server's own Scanner, Autotune and similar plugins)
- addresses in the **whitelist**

Designed not to catch people:
- **Holding an arrow key** to scroll the band is far faster than 0.4 s per frequency, and short bursts never reach the 5-minute limit.
- **Clicking through the band while listening** is not metronome-steady (the rhythm limit is a coefficient of variation of 0.15).
- **Repeated tunes to the same frequency** (key repeat, RDS reset) are not counted.

The address is taken from the **last** `X-Forwarded-For` entry (the one your
reverse proxy adds), so a bot cannot dodge a ban by sending a fake header.

Every decision is written to `scanguard.log` in the FM-DX folder (not reachable
from the web). It can optionally send a Telegram message, at most one per minute.

## Install

1. Copy `ScanGuard.js` and the `ScanGuard` folder into the FM-DX `plugins` folder.
2. Add the two small hooks to FM-DX's `server/index.js`. FM-DX plugins cannot
   intercept tune commands on their own. From the FM-DX folder:
   ```
   git apply /path/to/fmdx-scan-guard/core-hook.patch
   ```
   The patch is made against FM-DX 1.4.2. FM-DX runs normally if the plugin
   folder is missing. Re-apply the patch after an FM-DX update.
3. Enable **Scan Guard** in Setup → Plugins, then **restart** FM-DX.
4. The first start creates `plugins_configs/scanguard.json` with the defaults
   (`"mode": "watch"`).

## Settings (`plugins_configs/scanguard.json`)

Changes apply without a restart.

| Setting | Default | Meaning |
|---|---|---|
| `mode` | `watch` | `watch` = only log (and Telegram "would ban"), `enforce` = slow down / disconnect / ban |
| `maxTunesPer5Minutes` | 300 | frequency changes allowed in 5 minutes |
| `sweepMinSteps` | 50 | even steps in a row that count as a sweep |
| `sweepMinSpanMHz` | 5.0 | minimum width of a sweep |
| `sweepMaxStepMHz` | 0.5 | larger jumps are not sweep steps |
| `monotonicMinSteps` | 40 | tunes in one direction that count as a walk |
| `monotonicMinSpanMHz` | 5.0 | minimum width of a walk |
| `sweepMinSecondsPerTune` | 0.4 | faster runs are key scrolling by a person |
| `maxRhythmVariation` | 0.15 | how steady the rhythm must be to look automated |
| `throttledHitsToBan` | 60 | ignored tunes within 5 minutes before a ban |
| `banMinutes` | 60 | length of a ban (kept in memory; a restart clears it) |
| `whitelist` | `[]` | addresses that are never touched |
| `telegramLabel` | `TEF FM-DX` | name used in Telegram messages |

**Telegram (optional):** put a file `~/.scanguard-telegram` in the home folder
of the user that runs FM-DX, with mode 600:
```
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_CHAT_ID=123456789
```

## Admin endpoints

Admin login required:
- `GET /scanguard/status`: current bans and watched addresses
- `POST /scanguard/unban?ip=1.2.3.4`: lift a ban

## Test

Simulated bots and people, no FM-DX or tuner needed (Node 16+):
```
bash test/run.sh enforce
```
Expected: every bot is banned or slowed down, and no person, admin or LAN client is.

## Limits

- Scan Guard judges **behaviour on the tuner**, not identity. A bot that tunes
  slowly, irregularly and only a few frequencies looks like a person and is not
  stopped. It also no longer occupies the tuner much.
- It does not block AI web crawlers reading the page. Use `robots.txt` and a
  reverse-proxy rule for that.

## License

MIT, see [LICENSE](LICENSE).
