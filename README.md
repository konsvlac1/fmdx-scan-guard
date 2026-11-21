# Scan Guard for FM-DX Webserver

*by konvlachos*

🇬🇷 [Οδηγίες στα ελληνικά](README.el.md)

**Scan Guard protects your public FM-DX Webserver in two ways:**

### 1. It keeps AI crawlers off your website 🚫
Companies like OpenAI (ChatGPT), Anthropic (Claude), Perplexity, Google (for AI training),
Common Crawl, ByteDance (TikTok) and Meta send robots ("crawlers") that read websites to
train their AI. Scan Guard does the same as sites like Piratenscan.fm:
- it tells these AI crawlers to stay away (with a file called `robots.txt`), and
- if they come anyway, they are **refused** (error 403), for the page, the files
  and the tuner.

Normal visitors, phone apps and normal search engines (Google search, Bing) are **not** affected.
This is **on from the start**; you can switch it off in the shield window.

### 2. It keeps band-scanning robots off your tuner 📻
Some people run programs that connect to public FM-DX tuners and tune them through the
whole FM band (87.5, 87.6, 87.7 … 108.0 MHz) to make station lists. While such a robot
is running, nobody else can use your tuner.

Scan Guard watches **how** each visitor changes the frequency:
- A **robot** changes frequency in perfectly even steps, at a perfectly steady speed,
  through a large part of the band. Scan Guard recognises this and blocks it for one hour.
- A **person** tunes in an irregular way: jumps to presets, types a frequency,
  holds the arrow keys, stops to listen. Scan Guard leaves people alone.
- **You (the admin)**, and programs running on your own server or your own home
  network, are **never** blocked.

This part starts in **watch mode**: for the first days it only writes down what it
*would* block, so you can see it working before it blocks anyone.

---

## In short: 5 steps

1. **Download and install** Scan Guard with one command ([Raspberry Pi / Linux](#install-on-a-raspberry-pi-or-linux) or [Windows](#install-on-windows)).
2. **Switch it on** in your FM-DX page: Setup → Plugins → tick *Scan Guard* → Save.
3. **Restart** FM-DX Webserver.
4. AI crawlers are blocked straight away. For band-scanning robots, **wait a few days**
   and look at what it noticed: click the **shield 🛡** button, or open **Setup → Scan Guard**.
5. When you are happy, click **Enforce** in the same window. Done.

Each step is explained below. You do not need to know programming.

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

**Step 1.** Open a **terminal**. That is the window where you type commands.
- If the Pi has a screen: click the **Raspberry menu → Accessories → Terminal**.
- If you work from another computer: connect to the Pi with SSH (for example with the program PuTTY on Windows).

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
2. Open the **admin panel** (Setup). You can type your page address with `/setup` at the end,
   for example `https://your-fmdx-page.example/setup`.
3. Go to **Plugins**, put a tick at **Scan Guard**, and press **Save**.
4. **Restart FM-DX Webserver**:
   - Windows: close the FM-DX window and start FM-DX again.
   - Raspberry Pi / Linux, if FM-DX runs as a service: `sudo systemctl restart fm-dx-webserver`
5. Done. In the FM-DX messages you will see:
   **`[Scan Guard] active, band scanners: watch, AI crawlers: block`**

---

## The first days: watch mode

In watch mode Scan Guard blocks nobody. It only writes down what it would have blocked.

**To see what it noticed:**
1. Open your FM-DX page and log in as **admin**.
2. Open the **settings menu** (the gear ⚙ button). Under "You are logged in as an administrator"
   there is a row of small square buttons:

   ![The admin buttons: lock, key, person, shield, sign out](docs/admin-buttons.png)

   Click the **shield**. It is the 4th button, just before **Sign out**.
   Only you (the admin) see this button; listeners never see it.

   **Or** open the admin panel (Setup) and click the tab **🛡 Scan Guard**,
   right below **Plugins**. It has exactly the same buttons.
3. A window opens with **Recent events**, for example
   *"would have been blocked (watch mode): band sweep, 87.50→92.50 MHz"*.
   If it says "Nothing suspicious so far", no robot has come yet.

(Everything is also written to the file `scanguard.log` in your FM-DX folder.)

## Start blocking: enforce mode

When you are happy with what you saw:

1. Click the **shield 🛡** button, or open **Setup → Scan Guard**.
2. Click **🛡 Enforce**. That's all, no restart needed.

From then on robots are disconnected and blocked for one hour.
The shield button is **lit** while Scan Guard is in enforce mode.
To go back, click **👁 Watch**.

## Test it yourself (optional, a little technical)

You can play the robot yourself to see Scan Guard react. The test robot tunes your
tuner from 87.5 MHz upward in steps of 0.1 MHz, one step every 0.6 seconds,
like a real band scanner. Your listeners will hear the frequency change for about a minute.

1. Use a computer on **another internet connection** than your FM-DX server
   (another house, or a laptop on your phone's hotspot). From the server's own
   network you are treated as "your own network" and never blocked.
   That computer needs Node.js; a second FM-DX server is perfect.
2. Download Scan Guard there (the same download as in the install steps).
3. Run (change the address to your own FM-DX page):
   - Linux: `WS_PATH=/home/pi/fm-dx-webserver/node_modules/ws node fmdx-scan-guard-main/test/bot.js https://your-fmdx-page.example 70 600`
   - Windows: `set WS_PATH=C:\fm-dx-webserver\node_modules\ws` and then
     `node fmdx-scan-guard-main\test\bot.js https://your-fmdx-page.example 70 600`

   (`WS_PATH` points to the `ws` part that every FM-DX installation already has.)
4. What you should see:
   - **Watch mode:** the robot finishes all its steps. In the shield 🛡 window you see
     *"would have been blocked (watch mode)"* after about 50 steps.
   - **Enforce mode:** the robot stops with *"closed by server … Automated scanning is not
     allowed on this tuner"* after about 50 steps, and the shield window shows
     *"blocked for automated scanning"*.
5. Afterwards press **Unblock** in the shield window, so that computer can use the tuner again.

## Unblock someone

A block ends by itself after one hour. To end it earlier, click the **shield 🛡** button
and press **Unblock** next to the address. (Restarting FM-DX also clears all blocks.)

To never block a certain address, write it in `whitelist` in `plugins_configs/scanguard.json`,
for example: `"whitelist": ["203.0.113.7"]`.

## Remove Scan Guard

Run the installer again with `--uninstall` at the end, then restart FM-DX Webserver.
- Linux: `sudo node fmdx-scan-guard-main/install.js /home/pi/fm-dx-webserver --uninstall`
- Windows: the same line as when installing, with ` --uninstall` added at the end.

Everything goes back exactly as it was.

## After you update FM-DX Webserver

An FM-DX update can undo Scan Guard's lines in `server/index.js`.
Just run the install step again (the same line as before). It is safe to run it more than once.

---

## Questions

**The shield window or Setup tab says "One more step is needed"?**
Scan Guard was copied into the `plugins` folder by hand, so the lines it needs in `server/index.js` are missing.
Press **🔧 Fix it now** in that note, then restart FM-DX. (Running the install step does the same.)

**Will my listeners notice anything?**
No. Normal tuning (buttons, presets, typing a frequency, mouse wheel, holding the arrow keys)
is never blocked.

**Can it block me?**
No. When you are logged in as admin you are never blocked. Your own home network and
programs on the server itself (like the Scanner plugin) are never blocked either.

**The log says "slowed down: too many changes" — what does that mean?**
It is the gentlest step, a warning *before* any block. A client that changes the frequency
more than **300 times in 5 minutes** (about once a second, non-stop — a rate a person never
reaches by hand) has its tune commands **ignored for about a minute**; it stays connected and
is **not** disconnected or banned. Only if it keeps hammering (60 ignored tunes within 5 minutes)
is it then disconnected and blocked for an hour. In **watch mode** nothing is actually slowed or
blocked — it is only written in the log. A normal listener never triggers this.

**Does it stop AI robots that read my web page?**
Yes, the ones that say who they are (ChatGPT, Claude, Perplexity, Common Crawl, ByteDance,
Meta, Amazon and others). A robot that pretends to be a normal browser cannot be recognised
by its name; if it scans your tuner, the band-scan protection still catches it.

**Can I see that AI crawlers are blocked?**
Yes. Open `https://your-fmdx-page.example/robots.txt` in your browser: you see the list of
AI crawlers that are asked to stay away. The shield window shows how many were refused.

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

### AI crawlers

- `/robots.txt` is served by Scan Guard: `Disallow: /` for GPTBot, OAI-SearchBot, ChatGPT-User,
  ClaudeBot, Claude-SearchBot, Claude-User, Claude-Web, anthropic-ai, PerplexityBot, Perplexity-User,
  CCBot, Bytespider, Amazonbot, Meta-ExternalAgent, Meta-ExternalFetcher, FacebookBot, cohere-ai,
  cohere-training-data-crawler, MistralAI-User, DuckAssistBot, YouBot, Diffbot, ImagesiftBot, Timpibot,
  omgili, AI2Bot, Ai2Bot-Dolma, PanguBot, Kangaroo Bot, Webzio-Extended, Applebot-Extended,
  Google-Extended; `Allow: /` for everyone else.
- Requests whose User-Agent contains one of these names get **403**, including the tuner
  WebSocket (Google-Extended and Applebot-Extended are robots.txt tokens only).
- Other responses get `X-Robots-Tag: noai, noimageai`.
- Refusals are logged as `AI_BLOCK`, at most once per crawler and address per hour.

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
| `maxRhythmVariation` | 0.10 | how steady the rhythm must be to look automated |
| `throttledHitsToBan` | 60 | ignored tunes within 5 minutes before a ban |
| `banMinutes` | 60 | length of a ban |
| `whitelist` | `[]` | addresses that are never touched |
| `telegramLabel` | `TEF FM-DX` | name used in Telegram messages |
| `aiCrawlers` | `block` | `block` = robots.txt + 403 for AI crawlers, `off` = do nothing |
| `blockSearchEngines` | `false` | `true` = robots.txt also asks Google, Bing etc. to stay away |

### Telegram messages (optional)

Create a file `.scanguard-telegram` in the home folder of the user that runs FM-DX
(file mode 600). It sends at most one message per minute.
```
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_CHAT_ID=123456789
```

### Admin endpoints (admin login required)

- `GET /scanguard/status`: mode, current bans, watched addresses, recent events
- `POST /scanguard/mode?mode=watch|enforce`: switch mode
- `POST /scanguard/unban?ip=1.2.3.4`: lift a ban
- `POST /scanguard/ai?mode=block|off`: AI crawler blocking on or off

The shield button in the admin quick buttons and the Setup tab use these. POST requests are only
accepted from the server's own page (Origin check).

### Files

- `install.js`: the installer. It copies `ScanGuard.js` + `ScanGuard/` into `plugins/` and adds four small line groups to `server/index.js` (the same change as `core-hook.patch`, made against FM-DX 1.4.2).
- `test/run.sh`: simulated robots and people, no tuner needed: `bash test/run.sh enforce`.
- `test/bot.js`: a test robot for a real server (see "Test it yourself").

## License

MIT, see [LICENSE](LICENSE).
