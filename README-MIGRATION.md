# Moonlight Valley — co-op through Vercel + Ably

## Why
Direct browser-to-browser (WebRTC) links fail between some networks (VPNs, mobile hotspots, strict NATs) unless a relay server is added.
This migration makes both players connect **outward** over normal HTTPS/WebSocket to a realtime service (Ably), coordinated by two small
Vercel functions. Vercel Functions can't hold a persistent WebSocket room open for you, so the realtime part is Ably; Vercel only creates
rooms and hands out short-lived, room-limited tokens.

## What goes where
- **Through Ably (tiny JSON messages):** movement, chat, emotes, and the cinema's play / pause / seek / speed / link-change messages.
- **Never through Vercel or Ably:** video. Every browser plays YouTube or Google Drive itself. Drive tokens stay in each browser.
- **Vercel functions:** `POST /api/room` (make a room + invite code) and `POST /api/auth` (check the code, return an Ably token for that one room).

## Files in this ZIP (all paths relative to the project root)
| File | Purpose |
|---|---|
| `api/_mv.js` | helpers: config, HMAC room keys, Ably token signing (not an endpoint) |
| `api/room.js` | `POST /api/room` creates a room and the invite code `MV2.<room>.<key>` |
| `api/auth.js` | `POST /api/auth` verifies the code and returns an Ably token limited to channel `mv:<room>` |
| `cinema/relay.js` | `RelayLink`: drop-in replacement for the co-op link, using Ably |
| `cinema/vendor/ably.min.js`, `cinema/vendor/ABLY-LICENSE.txt` | Ably browser SDK 1.2.50 (Apache-2.0), served from your own site (no CDN) |
| `cinema/config.js` **(edited)** | adds `coopTransport: "auto"` and `apiBase: "/api"` |
| `cinema/room.js` **(edited, 1 line)** | creates the relay link when appropriate |
| `cinema/ui.js` **(edited)** | co-op panel: no reply-code step in relay mode |
| `index.html` **(edited, 1 line)** | loads `cinema/relay.js` |
| `patches/edited-files.patch` | exact diff of the four edited files (apply if you've changed them yourself) |
| `tools/dev_api.js`, `tools/fake_ably.js`, `tools/test_relay.py` | local test stand-in for Ably + the test |
| `.env.example` | the two environment variables (placeholders only) |

Not touched: `cinema/net.js` (the old direct link stays for localhost/offline development), `cinema/session.js`, the Drive code, emotes, game code, assets.

## Setup (once)
1. Create a free account at ably.com, make an app, and copy an API key (format `appId.keyId:secret`). Prefer a key limited to Publish, Subscribe and Presence on channels `mv:*`.
2. Vercel -> your project -> Settings -> Environment Variables: add `ABLY_API_KEY` and `MV_ROOM_SECRET` (see `.env.example`) for Production and Preview.
3. Copy this ZIP's files into your project (keep the paths). For `config.js`, `room.js`, `ui.js`, `index.html` either copy them or apply `patches/edited-files.patch` (`patch -p1 < patches/edited-files.patch`) if you have your own changes. Keep your own `googleClientId`.
4. Redeploy (a new deployment is needed for the env vars and the `api/` folder). No `package.json` or build step is needed.

## Using it
Open the game on your Vercel address. Host: Co-op -> **Invite my partner** -> send the `MV2…` code. Partner: Co-op -> **I have an invite** -> paste -> **Join**. No reply code. Both players are connected when each shows "Connected".
`coopTransport: "auto"` uses the relay on any real website and the old direct link on `localhost` / `127.x`; set `"relay"` to force it anywhere, or `"p2p"` for the old link.

## Security model
- The invite code is the only credential for a room (like the old codes): share it privately. A room holds two players; a third is refused.
- `ABLY_API_KEY` and `MV_ROOM_SECRET` exist only in Vercel. The browser only receives a token valid for one channel, for one hour (renewed automatically).
- Codes expire after 12 hours. `/api/room` is open to anyone who finds it (it stores nothing), so a stranger could create rooms and use up your Ably quota; if that matters, add rate limiting or a password later.

## Costs and limits (read before relying on it)
- Ably and Vercel both have free tiers. **I could not read Ably's current pricing page from my environment, so I have not verified its message or connection limits.** Check ably.com/pricing. The game keeps traffic low (a still player sends about one message per second, a moving player about ten) but two players walking continuously for hours is a lot of messages.
- Vercel Functions on Hobby are free within Vercel's limits; this app makes about one `/api/auth` call per player per hour.

## Tests (run locally, no accounts needed)
`python tools/test_relay.py` starts `tools/dev_api.js` (the real `api/*.js` + a local stand-in for Ably) and two separate browsers. It does **not** contact real Ably.

## Known limitations
- Not tested against real Ably or a real Vercel deployment, and not tested between two real networks: this environment can't reach them. Please test with the steps below.
- If Ably or the API is unreachable, the game shows a clear error; there is no automatic fallback to the old direct link.
- If a player reloads the page they must paste the invite again. Rooms are not saved.

## Manual test plan
1. Same laptop, two browsers: both open the Vercel URL, invite/join, walk around, play a video together.
2. Same Wi-Fi, two devices: same.
3. Different networks (the case that failed before, VPN included): same, and the partner's avatar must move and the video must pause/seek on both.
4. Disconnect: turn off Wi-Fi on one device for 10 s, turn it on: both should return to "Connected".
