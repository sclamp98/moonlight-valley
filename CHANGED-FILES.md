# Moonlight Valley — phone / tablet support

| File | Status | What |
|---|---|---|
| `mobile.js` | NEW | Touch controls: joystick (bottom-left), Interact (bottom-right), Use (hold), Emote wheel (☺ button → radial wheel: Kiss/Hug/Slap/Kneel/Grab), Backpack, More menu (Map/Travel/Cook/Drop/Full screen), close button for panels. Sends the same key events the game already reads, so no game logic changed. Does nothing on desktop. Also caps canvas pixel-ratio at 2 on phones. |
| `mobile.css` | NEW | Phone layout (landscape + portrait, safe areas, scrolling panels, 44px+ touch targets). All rules scoped to `html.mv-touch`. |
| `manifest.webmanifest`, `icons/icon-192.png`, `icons/icon-512.png` | NEW | Ready for "Add to Home Screen" (no service worker, so no caching surprises). |
| `index.html` | EDITED | viewport/PWA meta tags, a small inline touch-detect script, `mobile.css` link, `mobile.js` script (before `profile.js`). Also contains the `ui-modern.css` link from the previous update. |
| `hall.js` | EDITED (1 line) | The Neo Geo cabinet (`arcade_red`) is only created when NOT on a phone: `...(window.MV_MOBILE ? [] : [it("arcade_red", …)])`. Desktop unchanged. |
| `cinema/emotes.js` | EDITED (1 line) | On phones the key-hint text over your partner ("K Kiss  U Hug …") is not drawn; `if (window.MV_MOBILE) return;` at the top of `drawPrompt`. Desktop unchanged. |
| `tools/test_mobile.py`, `screenshots/` | NEW | Test + screenshots (not needed for deploy). |

If your live `index.html` / `hall.js` differ from mine, apply just those edits by hand (they're small and marked with comments) instead of overwriting.
Needs `ui-modern.css` from the previous ZIP to be deployed too.

## How to test on a phone
Open the site on the phone (landscape is best). Left thumb: joystick. Right thumb: ✋ = interact (or tap the prompt pill / dialogue), Use = tool (hold), 🎒 backpack, ☺ emotes, ⋯ map/travel/cook/drop/full screen. Hotbar is tappable. In the Gaming Room there is one arcade machine → Whack-a-Mole, Memory Lights, How Fast?. Add `?mobile=1` to the URL to force touch mode on a desktop browser; `?mobile=0` forces it off.

## Tested (emulated in Chromium with real touch events, incl. two-finger)
58/58 mobile checks: joystick 8-way, release stops, Interact while holding the stick (exactly one press), Use hold, backpack/close/tap-outside, hotbar tap, emote + more menus, map, prompt text, one arcade machine only, all 3 mini-games started and played by touch, no overlap/off-screen at 7 screen sizes (iPhone SE/Pro Max, Android, small Android, tablet; landscape + portrait), desktop unaffected. Desktop suites still pass (UI 24/24, farming 24, breakables 55, weapons 20, map 17, profile 15, arcade rules 27).

## NOT tested — please check on real devices
- Real Android Chrome / iPhone Safari / real phones (only emulation; no physical device available).
- Mobile ↔ desktop co-op over Ably, cinema, subtitles, chat: your current relay/cinema/chat files weren't available to me, and I had no second device. Controls send ordinary keys, so these shouldn't change, but they are unverified.
- iPhone Safari has no Fullscreen API for pages (the button is hidden there); use "Add to Home Screen" for full-screen play.
## Limits
- "Run": the game has no run/sprint mechanic, so there is no Run button (adding one would be a new gameplay rule).
- Joystick is 8-direction (like WASD) because the game's movement is digital.
- The map can't be opened indoors (existing game rule).
