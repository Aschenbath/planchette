# Planchette

**A thousand hands. One message.**

A candlelit spirit board for Twitch chat, made for an OBS Browser Source. Votes guide the planchette; ordinary chatter makes the wood tremble. A letter speaks when voted hands settle long enough to hear it.

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

1. Serve this folder using the command above, and leave that terminal running while OBS uses it. A static host also works.
2. Add a **Browser Source**, turn **Local file** off, and set its URL to `http://127.0.0.1:8000/?channel=your_channel&sound=0`. Set width **1920**, height **1080**.
3. Add `&bg=0` to make the area around the board transparent. The board itself stays opaque so its letters remain readable. For the offline demo, use `?demo=1&sound=0`; the **Local file** option with `index.html` also runs the default demo.
4. Use **Interact** to adjust settings. To enable chimes, remove `sound=0`, click the sound button, and enable **Control audio via OBS** if you want this source in the OBS mixer.

All settings are encoded in the page URL. Copy that URL into the Browser Source after configuring it. There is no local storage or server-side state. Reloading starts a fresh séance.

Browser audio policies may require a click before sound can play. The sound button shows whether the audio context has actually been unlocked. With `sound=0`, no audio context is created. Browsers without WebAudio still run the board silently.

## How to play

- Send one letter or number, or exactly **yes**, **no**, **goodbye**, or **bye**. Agree with other viewers to make the spring stronger. A window progress ring shows a letter beginning to manifest.
- Rest over a glyph at low speed for the dwell time to speak it. It glows, sounds a soft synthesized chime, and appears in **From beyond**. YES and NO appear as complete words.
- The same glyph cannot repeat until the window leaves its neighborhood and returns. The demo also moves away between repeated letters, including the two Ls in HELLO.
- **GOODBYE** keeps the message in **Echoes**, clears the strip, and begins another séance. The three most recent nonempty messages are kept in memory. The strip holds up to 120 characters.
- **Close the circle** ends a séance from the page. In demo mode, it also moves on to the next phrase.
- Press **M** to toggle sound; press **Space** to pause or resume the demo. Controls work with a keyboard, and motion preferences reduce decorative animation. The essential spring motion remains visible.

### Votes and drift

Matching ignores case, surrounding spaces, punctuation, and emoji: `h!` votes H, and `bye` votes GOODBYE. Repeated-letter emotes such as `aaa` and `www`, sentences, and other chatter are **drift**, not votes. Each viewer gets one vote; their next vote replaces it. Votes fade exponentially and expire after seven seconds. Ordinary chatter adds a seeded tremble lasting at most 1.5 seconds, capped across the entire crowd at 12% of one hand; it leaves an existing vote to decay. The leading vote group gets the spring target, a 15% switching threshold steadies close ties, and minority votes can offset the target by at most 12 board pixels. Only a glyph with live votes can speak. Without votes the board wanders and invites a single letter. This replaces the original letter-centroid model, which let English sentences pull toward S/T. The demo mixes single-glyph votes with chatter through the same input path.

Spring stiffness is `min(19, 1.5 + 13.5 × agreement + min(4, live vote weight × 0.2)) × strength`, where agreement is the winner's live vote weight divided by all live votes plus recent non-voting chat (which fades and expires like a vote). A lone viewer or a unanimous room gets a decisive spring; a scattered busy room stays loose. Non-voting chat can slow a vote but can never select a glyph.

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
- **app.js** — procedural Canvas artwork; damped linear and angular springs; expiring votes and drift; shared dwell detection, sound, demo, statistics, and IRC.
- **README.md** — operation and implementation notes.
- **LICENSE** — MIT, copyright 2026 Nash Aschenbath.

The page uses a cached, textured board and a cached wooden token. Only threads, pulse effects, particles, and motion are redrawn each frame. Physics uses small time steps; elapsed time is capped after a suspended frame to avoid jumps. There are at most **80 drawn vote threads**, **700 votes**, **700 drift hands**, **700 neutral activity records**, **96 particles**, and **300 physics message ingestions per second**. Votes, drift, and neutral activity use separate caps so ordinary chatter cannot evict votes. All incoming messages still count toward the rolling 60-second traffic total; unique chatters are counted over 30 seconds, with a 10,000-entry safety cap. These bounds trade unlimited crowd detail for predictable rendering during raids.

Live mode connects anonymously to `wss://irc-ws.chat.twitch.tv:443` using `PASS SCHMOOPIIE`, a random `justinfan` nick, and `JOIN #channel`. Each outgoing IRC command gets its own WebSocket frame, including the request for `twitch.tv/tags` and `twitch.tv/commands`; batching these commands prevented the original version from joining. It parses escaped IRC tags and buffered CRLF lines, answers PING, handles server RECONNECT, watches for stalled sockets, and reconnects with jittered exponential backoff up to about 30 seconds. Changing sources closes the old socket and invalidates its callbacks.

**Demo mode makes no network requests.** To respect the offline build requirement, no Google Fonts stylesheet is loaded: the design tries a locally installed **Cormorant Garamond** (a Google Fonts typeface), then Baskerville, Palatino/Book Antiqua, and Georgia. Install Cormorant Garamond separately if you want that particular face; it is optional. No remote assets, analytics, or font requests are included. The only external connection in live mode is Twitch IRC.

## Validation

Syntax and replay checks use plain Node without dependencies:

```sh
node --check app.js
node test/replay.test.cjs
```

The app targets modern Canvas/WebSocket browsers and OBS's Chromium browser source. Rendering is sized for 1920 × 1080 and uses bounded effects and cached artwork; actual 60 fps depends on OBS composition and hardware. Live Twitch access requires an internet connection and Twitch's anonymous IRC service. Offline verification cannot guarantee the availability of that external service.

Replay verification: a single viewer sending H at 0 seconds, I at 5 seconds, and goodbye at 10 seconds speaks exactly **H, I, GOODBYE**, each within three seconds of its vote, at both 60 and 120 physics steps per second. Two H votes against one Y vote speak only **H**; a unanimous 5,000-message raid also speaks only **H** and stays inside the board. Neutral activity is checked for vote separation, expiry, clearing, and its 700-viewer cap. kaicenat's 903 messages still produce three signs, **O, W, YES**, backed by its standalone votes; summit1g's 77 messages produce none. Removing qualifying votes makes both recordings silent. Eight synthetic users voting H, then I, spell **HI** within ten seconds over either recording; the tests also inject at the middle and end, at 60 and 120 physics steps per second. Five A votes against three Z votes settle within 4.7 board pixels of A. Parsing, vote replacement, expiry, bounded drift, dwell eligibility, tie switching, and all 39 glyph centres are checked. The concentric alphabet arcs have no overlapping glyph windows (minimum clearance 5.43 board pixels).
