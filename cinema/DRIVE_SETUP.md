# Google Drive in the Cinema Room — setup

Drive videos play inside the game's own player (a `<video>` element). There is **no server and no secret**: each player signs in
with their own Google account, the game asks Google for a short-lived read-only token (kept in memory only, never saved), and
streams the file through the official Drive API. Nothing is ever made public by the game.

## One-time setup (whoever hosts the game files)
1. Google Cloud Console → create/select a project.
2. **APIs & Services → Library →** enable **Google Drive API**.
3. **OAuth consent screen:** User type External, add both players' Google accounts as **Test users** (fine for two people; no verification needed in Testing mode).
   Scope used: `https://www.googleapis.com/auth/drive.readonly`.
   While the app is in *Testing* mode Google shows an "unverified app" warning at sign-in; that is expected. Press Advanced → Continue. Only the listed test users can sign in.
4. **Credentials → Create credentials → OAuth client ID → Web application.**
   Under **Authorised JavaScript origins** add the exact origin(s) the game is served from. An origin is scheme + host + port, with no path and no trailing slash, and it must match what is in the address bar:
   - Local play: the game has no fixed port; it is plain static files, so it uses whatever you start. For example `python3 -m http.server 8000` in the project folder is played at `http://localhost:8000/index.html`, so add `http://localhost:8000`. Change the number if you use another port. `http://localhost:8000` and `http://127.0.0.1:8000` are different origins; add the one you actually open.
   - Hosted play: your own HTTPS address, e.g. `https://<your-host>` (add the exact one you use; none is assumed here).
   - Opening `index.html` by double-click (`file://`) will NOT work: Google sign-in and the streaming helper both need http(s).
   Changes can take a few minutes to apply. No redirect URI is needed.
5. The Client ID is set in `cinema/config.js` → `googleClientId` (the only place). It is a public identifier, not a secret.
   Do NOT add a client secret anywhere; this flow does not use one.
6. The game must be served over **https** (or localhost) — the streaming helper (`cinema-sw.js`) is a service worker.

## Sharing the video
Both players need access. Share the file with **both Google accounts** (Viewer is enough), or set "Anyone with the link".
The game never changes sharing. The owner must allow downloading (Drive refuses apps otherwise).
Supported formats are what the browser decodes from the original file: MP4 (H.264/AAC), WebM; MKV/AVI/HEVC often fail.

## Supported links
`drive.google.com/file/d/<id>/view`, `/open?id=<id>`, `/uc?id=<id>`, `docs.google.com/file/d/<id>`, and a bare file id. Folders are refused.

## Tests
`python tools/test_cinema.py` (YouTube fake, two browsers), `python tools/test_cinema_drive.py` (two browsers + local stand-in Drive API),
`node tools/test_cinema.js` (pure logic).

## Connecting the two players (co-op link)
Co-op needs no server: one player makes an invite code, the other pastes it and sends back a reply code, then the first pastes that.
Press each button once and wait for its message. Pasting the same reply again is safe; a reply to an OLDER invite is refused with a clear message (use the newest invite).

### If Co-op stays on "Connecting…"
The game now says why after ~20 s and fails with a reason after ~40 s. Open the browser console on both sides and look at lines starting with `[coop` (they show ICE candidate types, ICE state and data-channel state; never addresses or SDP).
- Two *different* browsers on one computer: browsers hide their local address behind a private `….local` name that another browser often cannot look up, and if the STUN servers are blocked (VPN, firewall, offline) there is no other route. Fix for testing: use two windows of the SAME browser, or in Chrome/Edge set `chrome://flags/#enable-webrtc-hide-local-ips-with-mdns` to Disabled (Firefox: `media.peerconnection.ice.obfuscate_host_addresses` = false) in both, or turn the VPN off and allow the browser through the firewall.
- Different networks that block direct connections need a TURN relay: put one in `iceServers` in `cinema/config.js`.
