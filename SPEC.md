# Planchette — spec

A Twitch stream overlay (an OBS browser source) where chat moves a Ouija planchette together.

## How it works
- The page reads a channel's public chat anonymously over Twitch IRC WebSocket
  (`wss://irc-ws.chat.twitch.tv:443`, `PASS SCHMOOPIIE`, `NICK justinfan<random>`, `JOIN #channel`).
  No login, no token, no backend. Channel comes from `?channel=name`.
- The board: the classic layout. Arc of A–M, arc of N–Z, row 1–9 0, YES (top left), NO (top right), GOODBYE (bottom centre).
- Every chat message pulls the planchette. For each letter or digit in the message, add a small pull toward that glyph's
  position; the words "yes", "no", "goodbye"/"bye" pull to those corners as a whole. Pulls decay over a few seconds.
  The planchette moves with damped spring physics (mass, friction), so it drifts, overshoots and wobbles like hands on a
  real board. The more people agree, the faster it moves. This is the ideomotor effect, with thousands of hands.
- When the planchette's window rests over one glyph for DWELL ms (default 1600) with low speed, that glyph is spoken:
  it pulses, a soft sound plays (WebAudio, no files), and it is appended to the message strip at the bottom.
  A glyph can't be spoken twice in a row unless the planchette leaves and comes back.
- GOODBYE ends the séance: the message is kept in a short history list, then the strip clears.
  YES / NO are spoken as whole words.
- Streamer controls via URL params: `channel`, `dwell`, `strength`, `theme` (dark|parchment), `sound=0`, `demo=1`.
  Also chat commands from the broadcaster or mods only (IRC tags `badges`): `!seance` clears and starts,
  `!goodbye` ends. Must request tags capability (`CAP REQ :twitch.tv/tags`).
- Demo mode (`demo=1`) feeds simulated chat (a crowd that slowly converges on spelling words) so it can be tested
  and recorded without a live channel.
- Transparent background option (`bg=0`) for OBS.
- Small unobtrusive status line: connected channel, messages/minute, number of distinct chatters in the last 30 s.
- Each chatter's recent pull is drawn as a faint thread from the planchette toward the glyph (fun to watch),
  capped for performance.

## Constraints
- Plain HTML/CSS/JS, no build step, no dependencies, works offline except for Twitch chat. Files: `index.html`,
  `app.js`, `style.css`, plus `README.md` and `LICENSE` (MIT). Must run at 1920x1080 at 60 fps in OBS.
- Typography and look: hand-lettered Victorian board, serif display font from Google Fonts with system fallback,
  candlelit vignette. Tasteful, not cartoonish.
- Robust IRC: reconnect with backoff, handle PING/PONG, parse tags.
- Code readable and commented sparingly.
