# Planchette

**A thousand hands. One message.**

A candlelit spirit board for Twitch chat, made for an OBS Browser Source. Every message adds a hand to the planchette. The room pulls, the wood drifts, and a letter only speaks when everyone settles long enough to hear it.

Plain HTML, CSS, and JavaScript. No installation, build, dependencies, account, token, or backend. The engraved board, wooden planchette, grain, threads, and chimes are generated locally.

## Run it

Open **index.html** in a modern browser. With no channel, it starts an **offline demo** automatically. A simulated crowd converges on letters, spells messages, and closes the circle with GOODBYE. This uses the same chat processing, physics, and dwell detection as the live board.

For a channel, use **Set the table** or append a query string:

```text
index.html?channel=your_channel
index.html?demo=1&theme=parchment&sound=0
index.html?channel=your_channel&bg=0&dwell=2000&strength=1.2
```

If your browser or OBS does not preserve query parameters on local files, serve this folder with an already installed Python:

```sh
python -m http.server 8000 --bind 127.0.0.1
```

Then open `http://localhost:8000/?demo=1` or `http://localhost:8000/?channel=your_channel`.

## In OBS

1. Add a **Browser Source**, width **1920**, height **1080**.
2. Use the local `index.html` file for the default offline demo, or the localhost URL above for query parameters. A static host also works; hosting is optional.
3. Set `channel=your_channel`. Use `bg=0` to make the area around the board transparent. The board itself stays opaque so its letters remain readable.
4. Use **Interact** to adjust settings or enable chimes. Enable **Control audio via OBS** if you want this source in the OBS mixer.

All settings are encoded in the page URL. Copy that URL into the Browser Source after configuring it. There is no local storage or server-side state. Reloading starts a fresh séance.

Browser audio policies may require a click before sound can play. The sound button shows whether the audio context has actually been unlocked. With `sound=0`, no audio context is created. Browsers without WebAudio still run the board silently.

## How to play

- Chat letters or numbers. Every ASCII letter or digit in a message pulls toward that glyph. Repeated characters add weight, with a per-message cap and one active hand per chatter to keep spam from taking over.
- Whole words **yes**, **no**, **goodbye**, and **bye** pull to their named destinations instead of their individual letters. Matching is case insensitive; `yesterday` remains a collection of letter pulls.
- Agree with other viewers to make the spring stronger. Hands fade over several seconds, leaving soft threads behind them. A window progress ring shows a letter beginning to manifest.
- Rest over a glyph at low speed for the dwell time to speak it. It glows, sounds a soft synthesized chime, and appears in **From beyond**. YES and NO appear as complete words.
- The same glyph cannot repeat until the window leaves its neighborhood and returns. The demo also moves away between repeated letters, including the two Ls in HELLO.
- **GOODBYE** keeps the message in **Echoes**, clears the strip, and begins another séance. The three most recent nonempty messages are kept in memory. The strip holds up to 120 characters.
- **Close the circle** ends a séance from the page. In demo mode, it also moves on to the next phrase.
- Press **M** to toggle sound; press **Space** to pause or resume the demo. Controls work with a keyboard, and motion preferences reduce decorative animation. The essential spring motion remains visible.

Broadcasters and moderators can send these exact commands (case insensitive):

| Command | Effect |
| --- | --- |
| `!seance` | Clear the current strip and pulls; start a fresh séance. Preserve past Echoes. |
| `!goodbye` | Archive the current message and clear the strip and pulls. |

Authority is read only from Twitch's `badges` IRC tag: `broadcaster/…` or `moderator/…`. Ordinary viewers' commands are ignored, rather than accidentally spelling command text on the board.

## URL settings

| Parameter | Default | Meaning |
| --- | --- | --- |
| `channel` | empty | Channel name, without `#`. Invalid or missing names fall back to the offline demo. |
| `demo` | `0` with a channel; otherwise `1` | `1` forces simulated chat and disables all Twitch connections, even with a channel specified. |
| `dwell` | `1600` | Milliseconds of low-speed rest to speak; clamped to 400–10000. |
| `strength` | `1` | Spring strength multiplier; clamped to 0.1–5. |
| `theme` | `dark` | `dark` for midnight and brass; `parchment` for an antique paper finish. |
| `sound` | `1` | `0` disables synthesized chimes; enabled audio still needs browser permission through an interaction. |
| `bg` | `1` | `0` makes the page background transparent for compositing. |

## Under the board

`SPEC.md` describes the starting concept; these five files implement it:

- **index.html** — accessible page structure, controls, message strip, history, and settings dialog.
- **style.css** — responsive Victorian typography, candlelit layout, parchment finish, transparent backdrop, and reduced-motion treatment.
- **app.js** — procedural Canvas artwork; damped linear and angular springs; expiring per-chatter pulls; dwell, sound, demo, statistics, and IRC.
- **README.md** — operation and implementation notes.
- **LICENSE** — MIT, copyright 2026 Nash Aschenbath.

The page uses a cached, textured board and a cached wooden token. Only threads, pulse effects, particles, and motion are redrawn each frame. Physics uses small time steps; elapsed time is capped after a suspended frame to avoid jumps. There are at most **80 drawn threads**, **700 active hands**, **96 particles**, and **300 physics message ingestions per second**. All incoming messages still count toward the rolling 60-second traffic total; unique chatters are counted over 30 seconds, with a 10,000-entry safety cap. A single chatter refreshes their hand rather than stacking new hands. These bounds trade unlimited crowd detail for predictable rendering during raids.

Live mode connects anonymously to `wss://irc-ws.chat.twitch.tv:443` using `PASS SCHMOOPIIE`, a random `justinfan` nick, and `JOIN #channel`. It requests `twitch.tv/tags` and `twitch.tv/commands`, parses escaped IRC tags and buffered CRLF lines, answers PING, handles server RECONNECT, watches for stalled sockets, and reconnects with jittered exponential backoff up to about 30 seconds. Changing sources closes the old socket and invalidates its callbacks.

**Demo mode makes no network requests.** To respect the offline build requirement, no Google Fonts stylesheet is loaded: the design tries a locally installed **Cormorant Garamond** (a Google Fonts typeface), then Baskerville, Palatino/Book Antiqua, and Georgia. Install Cormorant Garamond separately if you want that particular face; it is optional. No remote assets, analytics, or font requests are included. The only external connection in live mode is Twitch IRC.

## Validation

The JavaScript can be syntax-checked with Node without installing anything:

```sh
node --check app.js
```

The app targets modern Canvas/WebSocket browsers and OBS's Chromium browser source. Rendering is sized for 1920 × 1080 and uses bounded effects and cached artwork; actual 60 fps depends on OBS composition and hardware. Live Twitch access requires an internet connection and Twitch's anonymous IRC service. Offline verification cannot guarantee the availability of that external service.

Verified locally: `node --check app.js`; configuration, message weighting, tag parsing, permissions, spring settling, and decay checks; Edge visual checks for both finishes, 1920 × 1080 layout, a 390px mobile viewport, transparent background, and sound activation. Fourteen simulated IRC checks covered authentication, PING/PONG, fragmented lines, live glyph dwell, moderator commands, history, and reconnection. The offline demo completed HELLO (including repeated letters), IS ANYONE THERE, and YES. A 240-frame local Edge demo sample averaged about 165 fps; this is a browser measurement, not an OBS scene benchmark. No live Twitch connection was used for validation.
