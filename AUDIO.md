# Moonlight Valley — music & sound system

## Files
| File | Status | What |
|---|---|---|
| `audio.js` | NEW | The whole audio engine: settings, mixer, synth voices, 7 music tracks + crossfading scene manager, 46 sound effects, ambience, game hooks, settings panel. |
| `audio.css` | NEW | Sound settings panel + 🔊 button (same look as the rest of the UI). |
| `index.html` | EDITED | Adds `<script src="audio.js">` (before `mobile.js`/`profile.js`) and `<link … audio.css>`. Also contains the earlier ui-modern / mobile lines. |
| `mobile.js`, `mobile.css` | EDITED | "🔊 Sound" entry in the ⋯ menu on phones (the floating button is desktop-only). |
| `tools/test_audio.py`, `tools/test_mobile.py` | NEW / UPDATED | Tests (not needed for deploy). |
No existing game, cinema, arcade, Ably or save files were changed. Needs the files from the two previous ZIPs (ui-modern, mobile) to be deployed.

## Assets & licences
There are **no audio files**. All music, effects and ambience are original and generated live in the browser (Web Audio API) by the code in `audio.js` — no samples, no third-party tracks, nothing copied from another game. They are part of Moonlight Valley and carry the same licence as the game (commercial use fine). Nothing to download, nothing to attribute. (This also means no large downloads and nothing that can be "missing".)

## What plays
**Music (crossfades 2–3 s, one track at a time):** Main Hall "Hearth" (piano arpeggios, nylon plucks, pad, C-major 7ths, 72 bpm) · Gaming Room "Pixel Lounge" (retro square-wave arps, bass, soft kick/hats, 116 bpm, dips while an arcade game is open) · Cinema Room "Low Light" (very slow ambient pads + bell notes; fades to silence while a video is playing, returns when paused/ended) · Outdoors by time of day: 6–11 "First Light", 11–17 "Meadow Walk", 17–20 "Golden Hour", 20–6 "Moonlit" (sparse music-box).
**Effects:** footsteps (grass / sand outdoors, wood in the hall, tile in the gaming room, carpet in the cinema; stride-based) · door open/close + area transitions · cinema enter/exit · inventory open/close · panel open/close · button clicks · hotbar select · dialogue · interact · tool swing · system notification / success / error · incoming chat message · friend joined / left / reconnected · co-op & arcade invitations · morning chime on a new day · arcade switch-on/off, menu select, Whack-a-Mole pop + hit, Memory Lights notes (4 pitches), countdown ticks, reaction GO + false start, result ding, win / lose / draw.
**Ambience (own volume slider):** wind (outdoors), birds (day), crickets (evening/night), rain (when it rains; muffled indoors), electrical hum (gaming room), faint room tone (house).
**Settings (🔊 button top-left on desktop; ⋯ → Sound on phones):** Master, Music, Sound effects, Ambient sliders with live % and a click preview, Mute/Unmute, saved in localStorage.

## Network / multiplayer
Sounds are triggered only by what this player's own game sees. Nothing is sent through Ably or WebRTC for audio. Events that can arrive twice (join, leave, reconnect, chat) are de-duplicated by key + time window.

## Browser rules
Audio starts only after the first click / key / touch (autoplay rules; iOS unlock included). It suspends when the tab is hidden or the page is left, and when muted (no CPU).

## Tested (Chromium, automated; 61 checks, all pass)
Autoplay lock → unlock · scene changes (morning/day/evening/night/hall/gaming/cinema) · smooth fades, only one track left after a fade, rapid flipping doesn't pile up tracks · door/footstep/inventory/notification/button sounds · arcade: switch-on, menu, Whack-a-Mole, Memory, GO, win/lose/draw · duplicate co-op events → one sound · cinema video playing → music silent, paused → returns · each slider changes only its own bus · mute · settings persist after reload · tab hidden → suspended · phone panel fits, first touch unlocks · every track (40 s) and all 46 effects rendered offline: finite, audible, no clipping, not too loud · no console errors, no broken assets. Other suites still pass (mobile 59/59, UI 24/24, farming, breakables, weapons, map, profile, arcade rules).

## NOT verified — please check
- **I cannot listen.** The tests prove the sounds are produced, at sane levels, at the right moments; whether the music is *beautiful* is your call. Tell me what to change (tempo, instruments, key, loudness) and I'll tune it.
- Real devices: iPhone Safari / Android Chrome. (iPhone: the silent/ring switch mutes web audio.)
- Co-op sounds hook the link events and `Cinema.onChat` that exist in the project I had; your latest chat/relay files weren't available, so check once that a real incoming chat message and a real friend joining each make a sound. If a toast/chat sound is missing, tell me the toast's class name.
- Not implemented because the game has no such feature: running, jumping, clothing selection (the wardrobe is only a message). Emote animations (kiss/hug…) have no dedicated sound yet.
