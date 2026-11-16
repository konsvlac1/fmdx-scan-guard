# Scan Guard for FM-DX Webserver

**Scan Guard keeps automatic "band-scanning" robots away from your public FM-DX tuner,
so real listeners can always use it.**

Some people run computer programs that connect to public FM-DX tuners and tune them
through the whole FM band (87.5, 87.6, 87.7 … 108.0 MHz) to make station lists.
While such a robot is running, nobody else can use your tuner.

Scan Guard watches **how** each visitor changes the frequency:

- A **robot** changes frequency in perfectly even steps, at a perfectly steady speed,
  through a large part of the band. Scan Guard recognises this and blocks it for one hour.
- A **person** tunes in an irregular way: jumps to presets, types a frequency,
  holds the arrow keys, stops to listen. Scan Guard leaves people alone.
- **You (the admin)**, and programs running on your own server or your own home
  network, are **never** blocked.

Scan Guard starts in **watch mode**: for the first days it only writes down what it
*would* block, so you can see it working before it blocks anyone.

---

## What you need

- **FM-DX Webserver version 1.4** (on a Raspberry Pi, a Linux PC or Windows).
- About **10 minutes**.
- You must be able to **restart** FM-DX Webserver and log in as **admin**.

You also need to know **which folder FM-DX Webserver is in**. It is the folder that contains
the folders `server`, `plugins` and `web`. For example:
- Raspberry Pi / Linux: `/home/pi/fm-dx-webserver` (replace `pi` with your user name)
- Windows: `C:\fm-dx-webserver`, or wherever you unpacked it

---

## Install on a Raspberry Pi or Linux

**Step 1.** Open a terminal on the Pi (or connect with SSH).

**Step 2.** Copy these three lines, paste them into the terminal and press Enter.
Change `/home/pi/fm-dx-webserver` in the last line to your FM-DX folder:

```
cd ~
wget -O scan-guard.zip https://github.com/konsvlac1/fmdx-scan-guard/archive/refs/heads/main.zip && unzip -o scan-guard.zip
sudo node fmdx-scan-guard-main/install.js /home/pi/fm-dx-webserver
```

You should see lines with ✓ and "Scan Guard is installed".

**Step 3.** Go to **[Turn it on](#turn-it-on-windows-and-linux)** below.

---

## Install on Windows

**Step 1.** Click this link to download Scan Guard:
https://github.com/konsvlac1/fmdx-scan-guard/archive/refs/heads/main.zip

**Step 2.** Open your **Downloads** folder, right-click **fmdx-scan-guard-main.zip**
and choose **Extract All…**, then **Extract**.

**Step 3.** Press the **Windows key**, type **cmd** and press **Enter**. A black window opens.

**Step 4.** Type this line and press Enter. Change `C:\fm-dx-webserver` to your FM-DX folder,
and keep the quotes:

```
node "%USERPROFILE%\Downloads\fmdx-scan-guard-main\fmdx-scan-guard-main\install.js" "C:\fm-dx-webserver"
```

> If you get "cannot find module", the extracted folder is in a slightly different place.
> Open the extracted folder, find **install.js**, hold **Shift**, right-click it,
> choose **Copy as path**, and paste that path after `node ` instead.

You should see lines with ✓ and "Scan Guard is installed".

---

## Turn it on (Windows and Linux)

1. Open your FM-DX page in the browser and **log in as admin**.
2. Go to **Setup → Plugins**, put a tick at **Scan Guard**, and press **Save**.
3. **Restart FM-DX Webserver**:
   - Windows: close the FM-DX window and start FM-DX again.
   - Raspberry Pi / Linux, if FM-DX runs as a service: `sudo systemctl restart fm-dx-webserver`
4. Done. In the FM-DX messages you will see: **`[Scan Guard] active, mode: watch`**

---

## The first days: watch mode

In watch mode Scan Guard blocks nobody. It only writes down what it would have blocked,
in the file **`scanguard.log`** in your FM-DX folder.

- **Windows:** open the FM-DX folder and double-click `scanguard.log`.
- **Linux:** `tail /home/pi/fm-dx-webserver/scanguard.log`

Each line shows the time, the internet address, and the reason, for example
*"band sweep, 87.50→92.50 MHz, 50 even steps, 0.6 s/tune"*.
If the file does not exist yet, nothing suspicious has happened.

## Start blocking: enforce mode

When you are happy with what you saw in the log:

1. Open the file **`plugins_configs/scanguard.json`** in your FM-DX folder
   (Windows: right-click → Open with → Notepad. Linux: `nano`).
2. Change `"mode": "watch"` to `"mode": "enforce"`.
3. Save the file. **No restart is needed.**

From then on robots are disconnected and blocked for one hour.
To go back, change `enforce` back to `watch`.

## Unblock someone

A block ends by itself after one hour. To end it earlier, simply restart FM-DX Webserver.

To never block a certain address, write it in `whitelist` in `plugins_configs/scanguard.json`,
for example: `"whitelist": ["203.0.113.7"]`.

## Remove Scan Guard

Run the installer again with `--uninstall` at the end, then restart FM-DX Webserver.
- Linux: `sudo node fmdx-scan-guard-main/install.js /home/pi/fm-dx-webserver --uninstall`
- Windows: the same line as when installing, with ` --uninstall` added at the end.

Everything goes back exactly as it was.

## After you update FM-DX Webserver

An FM-DX update can undo Scan Guard's three lines in `server/index.js`.
Just run the install step again (the same line as before). It is safe to run it more than once.

---

## Questions

**Will my listeners notice anything?**
No. Normal tuning (buttons, presets, typing a frequency, mouse wheel, holding the arrow keys)
is never blocked.

**Can it block me?**
No. When you are logged in as admin you are never blocked. Your own home network and
programs on the server itself (like the Scanner plugin) are never blocked either.

**Does it stop AI robots that read my web page?**
No, that is a different problem. Scan Guard only protects the **tuner**.

**Is it free?**
Yes, under the MIT licence (see below).

---

## For advanced users

### How it decides

| Behaviour | What Scan Guard does in enforce mode |
|---|---|
| **Band sweep**: 50+ tunes in a row in one direction with the same step (≤ 0.5 MHz), covering 5+ MHz, each frequency held 0.4 s or longer, at a machine-steady rhythm | disconnect + ban for 60 min |
| **One-way walk**: 40+ tunes always upward (or downward) over 5+ MHz at a machine-steady rhythm (for example a list of known stations) | disconnect + ban for 60 min |
| **Too many changes**: more than 300 frequency changes in 5 minutes | further tune commands are ignored for a minute; the client stays connected |
| **Keeps going while slowed down**: 60 ignored tunes within 5 minutes | disconnect + ban for 60 min |

- **Exempt:** admin sessions, LAN/loopback clients, and whitelisted addresses.
- **Not counted:** repeated tunes to the same frequency (key repeat, RDS reset).
- **Address used:** the **last** `X-Forwarded-For` entry, the one your reverse proxy adds, so a fake header cannot dodge a ban.
- **How bans are kept:** in memory. A restart clears them.

### Settings (`plugins_configs/scanguard.json`, read again automatically when changed)

| Setting | Default | Meaning |
|---|---|---|
| `mode` | `watch` | `watch` = only log, `enforce` = slow down / disconnect / ban |
| `maxTunesPer5Minutes` | 300 | frequency changes allowed in 5 minutes |
| `sweepMinSteps` | 50 | even steps in a row that count as a sweep |
| `sweepMinSpanMHz` | 5.0 | minimum width of a sweep |
| `sweepMaxStepMHz` | 0.5 | larger jumps are not sweep steps |
| `monotonicMinSteps` | 40 | tunes in one direction that count as a walk |
| `monotonicMinSpanMHz` | 5.0 | minimum width of a walk |
| `sweepMinSecondsPerTune` | 0.4 | faster runs are key scrolling by a person |
| `maxRhythmVariation` | 0.15 | how steady the rhythm must be to look automated |
| `throttledHitsToBan` | 60 | ignored tunes within 5 minutes before a ban |
| `banMinutes` | 60 | length of a ban |
| `whitelist` | `[]` | addresses that are never touched |
| `telegramLabel` | `TEF FM-DX` | name used in Telegram messages |

### Telegram messages (optional)

Create a file `.scanguard-telegram` in the home folder of the user that runs FM-DX
(file mode 600). It sends at most one message per minute.
```
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_CHAT_ID=123456789
```

### Admin endpoints (admin login required)

- `GET /scanguard/status`: current bans and watched addresses
- `POST /scanguard/unban?ip=1.2.3.4`: lift a ban

### Files

- `install.js`: the installer. It copies `ScanGuard.js` + `ScanGuard/` into `plugins/` and adds three lines to `server/index.js` (the same change as `core-hook.patch`, made against FM-DX 1.4.2).
- `test/run.sh`: simulated robots and people, no tuner needed: `bash test/run.sh enforce`.

## License

MIT, see [LICENSE](LICENSE).
