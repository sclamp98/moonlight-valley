# Moonlight Valley — pets / bed / lamp / treadmill update

Copy these over your project (folder structure is kept). Nothing else changed.

| File | |
|---|---|
| `hall.js` | modified — all four changes live here |
| `assets/treadmill/treadmill_base.png` | new — the machine on its own (cut from your video, runner taken out) |
| `assets/treadmill/treadmill_male_run_00..19.png`, `treadmill_female_run_00..19.png` | new — the 20 frames of one stride loop, straight from your video (male + female runner) |
| `tools/build_treadmill_assets.py` | new — how the frames were cut (same workflow as the walk/emote frames) |
| `tools/test_treadmill.py` | new — `python tools/test_treadmill.py` |

## What changed
1. **Pets removed** — the dog and cat items are gone from the Main Hall and their sprite sheets are no longer requested.
   Optional tidy-up I could not do (those files were not in the ZIPs I had): delete `assets/hall/a_dog.png`, `assets/hall/a_cat.png` and the `dog` / `cat` entries in `hallart.js`.
2. **Bed** — the "Lie down" prompt only existed on a thin strip at the *foot* of the bed (behind the HUD / nightstand), so walking up to the side found nothing. Added a prompt zone on the left side of the bed.
   The existing sleep flow is untouched and still follows the same rule (night, or energy ≤ 30; otherwise "You're not tired yet…"). E can no longer re-trigger the bed while the sleep/morning fade is running.
3. **Lamp** — removed only the floor lamp beside the cellar stairs (+ its collider, + the warm glow that belonged to it). Stairs, other lamps/lights and furniture untouched.
4. **Treadmill** — there was no treadmill object in the game, so one was added to the Gaming Room (bottom row, right of the ping-pong table).
   E on the prompt puts you on it, running (your frames, in order, looping at the video's 24 fps). E stops → you stand still on it (your own sprite). E runs again. Esc eases to a stop and steps off; when stopped, any move key steps off. While running you cannot walk away. Starting/stopping cross-fades and ramps the stride speed. Works with the mobile Interact button + stick (they send E / arrow keys).
   Co-op: the state (0/1/2) rides on the existing `pos` presence packet — no new message type; the partner sees you stand/run, can't take the machine while you're on it (message), and nobody's movement is locked.
