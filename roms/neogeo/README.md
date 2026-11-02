# Neo Geo cabinet — adding your own games

Moonlight Valley does **not** include any Neo Geo games or BIOS. Only use ROM files you have the legal right to use
(for example backups of cartridges you own, or homebrew / freely distributable titles).

The cabinet hands the game to **EmulatorJS** (FBNeo core), a browser emulator that is loaded on demand inside a sandboxed frame
the first time you press Play. It is not part of this repo: by default it is fetched from `https://cdn.emulatorjs.org/stable/data/`.
To self-host it instead, download the EmulatorJS `data/` folder, put it on your site (e.g. `emulator/data/`) and set
`window.NEOGEO_CONFIG = { dataPath: "emulator/data/" }` in a small script before `cinema/neogeo.js` in `index.html`.

## Option A — load a ROM from your computer (nothing is uploaded or stored)
Press **Play Arcade** at the Neo Geo cabinet → **Load a ROM from your computer…** → pick the game's `.zip`.
Most Neo Geo sets also need the system BIOS: press **Load BIOS (neogeo.zip)…** first. It lasts until you leave the cabinet.

## Option B — install games on the site
1. Copy the game zips (e.g. `mslug.zip`) and, if you have it, `neogeo.zip` into this folder (`roms/neogeo/`).
2. Edit `games.json`:
```json
{
  "bios": "neogeo.zip",
  "games": [
    { "id": "mslug", "name": "Metal Slug", "file": "mslug.zip", "art": "mslug.png", "maker": "Nazca", "year": 1996 }
  ]
}
```
`art` is an optional picture in this folder. File names may only use letters, digits, `.`, `_`, `-`, `(`, `)` and must end in `.zip`.
3. Deploy. Installed games then show up as cards with a Play button.

If a file is missing, a ROM is not accepted by the emulator, or the emulator cannot be loaded, the cabinet shows a readable message and returns to the list.
