"use strict";
/* ==========================================================
   Moonlight Valley — Step 1: foundation, movement, interaction
   Structure (each piece is a small class, easy to extend):
     CONFIG       tunable constants
     Input        keyboard state + one-shot key presses
     World        tile map, bounds, rendering
     Entity       base class for anything in the world
     Player       movable entity
     Interactable placeholder objects / NPCs
     Camera       smooth follow, clamped to the world
     UI           HUD (coords, hint) + world popups
     Game         main loop (requestAnimationFrame)
   ========================================================== */

const CONFIG = {
  TILE: 48,
  MAP_W: 72,           // tiles
  MAP_H: 56,           // tiles
  PLAYER_SIZE: 30,
  PLAYER_SPEED: 240,   // pixels per second
  INTERACT_RANGE: 70,  // pixels from player center to object center
  POPUP_MS: 1200,
  CAMERA_LERP: 10,     // higher = snappier follow
  PAGE_FADE_OUT: 0.2,  // seconds of fade-to-dark when walking onto the next map page
  PAGE_FADE_IN: 0.25,
  STAGE_SECONDS: 6,    // time per growth stage
  MAX_STAGE: 3,        // 1 = seedling, 2 = medium, 3 = ready
  COINS_PER_CROP: 10,
  PLAYER_HP: 100,
  HURT_INVULN: 0.8,       // seconds of immunity after being hit
  MONSTER_MAX: 16,
  START_SMALL: 10,
  START_BIG: 4,
  RESPAWN_SECONDS: 6,
  SPAWN_SAFE_DIST: 500,   // monsters never spawn this close to the player
  SEASON_DAYS: 7,         // days per season (a year = 4 seasons)
  DAY_SECONDS: 300,       // real seconds of daylight (6:00 am -> 8:00 pm) = 5 minutes
  NIGHT_SECONDS: 240,     // real seconds of night (8:00 pm -> 6:00 am) = 4 minutes, monsters roam
  DAY_START: 6, NIGHT_START: 20, DAY_END: 30,
  SEED_YIELD: [1, 3],     // seeds returned per harvest (min, max); a crop can override with seedYield
  NIGHT_MOBS: { small: 7, big: 2, max: 10 }, // every page's night wave when its own spec has none
  MAX_ENERGY: 100,
  TIRED_ENERGY: 30,       // you can only sleep at night, or once energy is at/below this
  CAN_MAX: 40,            // watering can capacity
  HOTBAR: 10,
  INV_SIZE: 20,
};

// Weapon stats live in data so upgrades/new weapons are just new objects.
// Weapons. Melee: damage/cooldown/reach/size/knockback. Ranged adds `ranged: { ammo, speed, range, pellets, spread, pierce }` and
// spends one ammo item per shot. `energy` = stamina per swing (default 1). `dir` = where the icon art points (for the swing/aim visual).
const MELEE_DIR = -Math.PI / 4, AIM_DIR = 0;
const WEAPONS = {
  stick:       { name: "Wooden Stick", damage: 12, cooldown: 0.4,  reach: 40, size: 64,  knockback: 260, dir: MELEE_DIR },
  dagger:      { name: "Dagger",       damage: 16, cooldown: 0.25, reach: 34, size: 52,  knockback: 180, dir: MELEE_DIR, swing: "thrust" },
  sword:       { name: "Rusty Sword",  damage: 26, cooldown: 0.4,  reach: 46, size: 74,  knockback: 320, dir: MELEE_DIR },
  steel_sword: { name: "Steel Sword",  damage: 40, cooldown: 0.45, reach: 52, size: 84,  knockback: 360, dir: MELEE_DIR },
  spear:       { name: "Spear",        damage: 32, cooldown: 0.55, reach: 92, size: 70,  knockback: 300, dir: MELEE_DIR, swing: "thrust" },
  war_axe:     { name: "War Axe",      damage: 70, cooldown: 0.85, reach: 50, size: 100, knockback: 520, dir: MELEE_DIR, energy: 3, swing: "chop" },
  bow:         { name: "Bow",          damage: 24, cooldown: 0.55, energy: 0, dir: AIM_DIR, ranged: { ammo: "arrow",  speed: 640, range: 560, kind: "arrow" } },
  crossbow:    { name: "Crossbow",     damage: 48, cooldown: 1.1,  energy: 0, dir: AIM_DIR, ranged: { ammo: "bolt",   speed: 820, range: 660, kind: "bolt", pierce: 1 } },
  pistol:      { name: "Pistol",       damage: 30, cooldown: 0.35, energy: 0, dir: AIM_DIR, ranged: { ammo: "bullet", speed: 980, range: 520, kind: "bullet", jitter: 0.04 } },
  shotgun:     { name: "Shotgun",      damage: 14, cooldown: 1.0,  energy: 0, dir: AIM_DIR, ranged: { ammo: "shell",  speed: 860, range: 300, kind: "pellet", pellets: 6, spread: 0.55 } },
  axe:         { name: "Axe",          damage: 9,  cooldown: 0.4,  reach: 40, size: 60,  knockback: 200 },
};

// How hard each melee weapon hits scenery (rocks, crates, bushes, trees...); anything not listed does 1.
const PROP_DMG = { steel_sword: 2, war_axe: 3 };

const _wIcons = {};
const weaponIcon = (css) => _wIcons[css] || (_wIcons[css] = Object.assign(new Image(), { src: `assets/fp/ic_${css}.png` }));

// Monster stats live in data so new types are one entry.
const MONSTER_TYPES = {
  small: { size: 26, hp: 30, speed: 55, chaseSpeed: 90, damage: 8,  reward: 20, aggro: 220, color: "#e05a5a" },
  big:   { size: 54, hp: 80, speed: 35, chaseSpeed: 62, damage: 20, reward: 50, aggro: 260, color: "#9c2a3c" },
};

// Item definitions live in data so new tools/crops/food are one entry each.
// `css` picks the inventory-icon (see assets/fp/ic_*.png + style.css). `type` drives behavior:
// "tool" items are used with Space/click on the tile in front, "seed" items plant, "food" items heal + restore energy.
const ITEMS = {
  axe:          { name: "Axe",           css: "axe",           type: "tool", tool: "axe",  desc: "Chops trees" },
  hoe:          { name: "Hoe",           css: "hoe",           type: "tool", tool: "hoe",  desc: "Tills grass into soil" },
  can:          { name: "Watering Can",  css: "can",           type: "tool", tool: "can",  desc: "Waters crops. Refill at water" },
  stick:        { name: "Wooden Stick",  css: "stick",         type: "weapon" },
  sword:        { name: "Rusty Sword",   css: "sword",         type: "weapon" },
  seeds:        { name: "Wheat Seeds",   css: "seeds",         type: "seed", crop: "wheat" },
  tomato_seeds: { name: "Tomato Seeds",  css: "tomato_seeds",  type: "seed", crop: "tomato" },
  wheat:        { name: "Wheat",         css: "wheat",         type: "crop" },
  tomato:       { name: "Tomato",        css: "tomato",        type: "crop" },
  egg:          { name: "Egg",           css: "egg",           type: "crop" },
  wood:         { name: "Wood",          css: "wood",          type: "crop" },
  bread:        { name: "Bread",         css: "bread",         type: "food", heal: 20, energy: 30 },
  fried_egg:    { name: "Fried Egg",     css: "fried_egg",     type: "food", heal: 15, energy: 28 },
  stew:         { name: "Tomato Stew",   css: "stew",          type: "food", heal: 35, energy: 60 },
  potion:       { name: "Health Potion", css: "potion",        type: "food", heal: 40, energy: 40 },
  gem:          { name: "Moon Gem",      css: "gem",           type: "treasure" },
  // materials: what breaking scenery drops (see matFor() in fpworld.js for what drops what)
  stone:        { name: "Stone",         css: "stone",        type: "material", desc: "Broken off rocks" },
  flower:       { name: "Flower",        css: "flower",       type: "material", desc: "A wildflower" },
  mushroom:     { name: "Mushroom",      css: "mushroom",     type: "material", desc: "Picked from the ground" },
  plank:        { name: "Wood Planks",   css: "plank",        type: "material", desc: "Salvaged from crates and fences" },
  fiber:        { name: "Plant Fiber",   css: "fiber",        type: "material", desc: "From bushes and straw" },
  dagger:       { name: "Dagger",        css: "dagger",        type: "weapon" },
  steel_sword:  { name: "Steel Sword",   css: "steel_sword",   type: "weapon" },
  spear:        { name: "Spear",         css: "spear",         type: "weapon" },
  war_axe:      { name: "War Axe",       css: "war_axe",       type: "weapon" },
  bow:          { name: "Bow",           css: "bow",           type: "weapon" },
  crossbow:     { name: "Crossbow",      css: "crossbow",      type: "weapon" },
  pistol:       { name: "Pistol",        css: "pistol",        type: "weapon" },
  shotgun:      { name: "Shotgun",       css: "shotgun",       type: "weapon" },
  arrow:        { name: "Arrows",        css: "arrow",         type: "ammo" },
  bolt:         { name: "Crossbow Bolts", css: "bolt",         type: "ammo" },
  bullet:       { name: "Bullets",       css: "bullet",        type: "ammo" },
  shell:        { name: "Shotgun Shells", css: "shell",        type: "ammo" },
};

// Crops: ids match fp.js (1 = wheat, 2 = tomato). `days` = watered days until ripe, `regrow` = days until the next fruit.
const CROP_IDS = [null, "wheat", "tomato"];
// `seedYield: [min, max]` = seeds handed back with every harvest (omit it to use CONFIG.SEED_YIELD).
const CROPS = {
  wheat:  { name: "Wheat",  seed: "seeds",        item: "wheat",  days: 4, seasons: ["spring", "summer", "autumn"], seedYield: [1, 3] },
  tomato: { name: "Tomato", seed: "tomato_seeds", item: "tomato", days: 6, regrow: 2, seasons: ["spring", "summer"], seedYield: [1, 3] },
};

// Shop price list: `buy` = coins to purchase, `sell` = coins received for one unit.
const SHOP_ITEMS = {
  seeds:        { buy: 15, sell: 5 },
  tomato_seeds: { buy: 30, sell: 10 },
  bread:        { buy: 45, sell: 25 },
  potion:       { buy: 60, sell: 20 },
  axe:          { buy: 60, sell: 20 },
  hoe:          { buy: 40, sell: 15 },
  can:          { buy: 40, sell: 15 },
  wheat:        { sell: 30 },
  tomato:       { sell: 60 },
  egg:          { sell: 25 },
  wood:         { sell: 8 },
  fried_egg:    { sell: 55 },
  stew:         { sell: 100 },
  gem:          { sell: 120 },
  stone:        { sell: 4 },
  flower:       { sell: 6 },
  mushroom:     { sell: 12 },
  plank:        { sell: 12 },
  fiber:        { sell: 2 },
  sword:        { sell: 40, cat: "weapons" },
  stick:        { sell: 3, cat: "weapons" },
  // Armory (cat "weapons"): `pack` = how many you get per purchase (ammo comes in packs)
  dagger:       { buy: 90,  sell: 40,  cat: "weapons" },
  spear:        { buy: 180, sell: 80,  cat: "weapons" },
  steel_sword:  { buy: 280, sell: 130, cat: "weapons" },
  war_axe:      { buy: 450, sell: 210, cat: "weapons" },
  bow:          { buy: 150, sell: 70,  cat: "weapons" },
  crossbow:     { buy: 380, sell: 180, cat: "weapons" },
  pistol:       { buy: 520, sell: 250, cat: "weapons" },
  shotgun:      { buy: 700, sell: 330, cat: "weapons" },
  arrow:        { buy: 30,  pack: 10, sell: 1, cat: "weapons" },
  bolt:         { buy: 50,  pack: 10, sell: 2, cat: "weapons" },
  bullet:       { buy: 80,  pack: 12, sell: 3, cat: "weapons" },
  shell:        { buy: 72,  pack: 6,  sell: 4, cat: "weapons" },
};

// Cooking recipes: one ingredient -> one result.
const RECIPES = [
  { result: "bread",     qty: 1, need: { wheat: 2 } },
  { result: "fried_egg", qty: 1, need: { egg: 1 } },
  { result: "stew",      qty: 1, need: { tomato: 2 } },
];

// Fixed-size slot array (unlike a compacting list, a slot's index is stable,
// which is what makes drag-and-drop between specific slots meaningful). Each
// slot is either null or { id, qty }. Used for both the player's bag and a
// chest's storage — same data shape, so items can move freely between them.
class Inventory {
  constructor(size) { this.size = size; this.slots = new Array(size).fill(null); }
  firstEmptyIndex() { return this.slots.findIndex((s) => !s); }
  // Adds anywhere: stacks onto a matching id first, else takes the first
  // empty slot. Returns false (and leaves the inventory untouched) if full.
  add(id, qty = 1) {
    for (const s of this.slots) if (s && s.id === id) { s.qty += qty; return true; }
    const idx = this.firstEmptyIndex();
    if (idx === -1) return false;
    this.slots[idx] = { id, qty };
    return true;
  }
  // true if every [id, qty] in `list` would fit (so a reward can be given all-or-nothing)
  canAddAll(list) {
    let free = this.slots.filter((s) => !s).length;
    for (const id of new Set(list.map((l) => l[0]))) if (!this.slots.some((s) => s && s.id === id)) free--;
    return free >= 0;
  }
  countOf(id) { return this.slots.reduce((n, s) => n + (s && s.id === id ? s.qty : 0), 0); }
  removeById(id, qty) { // spends `qty` across however many stacks hold it
    if (this.countOf(id) < qty) return false;
    let left = qty;
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      const s = this.slots[i];
      if (!s || s.id !== id) continue;
      const take = Math.min(s.qty, left);
      s.qty -= take; left -= take;
      if (s.qty <= 0) this.slots[i] = null;
    }
    return true;
  }
  removeAt(index, qty = 1) {
    const s = this.slots[index];
    if (!s) return false;
    s.qty -= qty;
    if (s.qty <= 0) this.slots[index] = null;
    return true;
  }
}

// Thin DOM wrapper around one grid element: builds its slot <div>s and
// re-renders them from an Inventory. Has no drag/click logic of its own —
// Game.setupInventoryDnD() owns interaction so player and chest grids share
// one implementation instead of each panel reinventing it.
class ItemGrid {
  constructor(gridEl, owner, getInventory) {
    this.el = gridEl;
    this.owner = owner;           // "player" or "chest" — tags each cell for the drag handler
    this.getInventory = getInventory; // () => Inventory | null (chest can be closed)
    this.cells = [];
  }
  build(size) {
    this.el.innerHTML = "";
    this.cells = [];
    for (let i = 0; i < size; i++) {
      const cell = document.createElement("div");
      cell.className = "inv-slot empty";
      cell.dataset.owner = this.owner;
      cell.dataset.index = i;
      this.el.appendChild(cell);
      this.cells.push(cell);
    }
  }
  render() {
    const inv = this.getInventory();
    if (!inv) return;
    if (this.cells.length !== inv.size) this.build(inv.size);
    inv.slots.forEach((item, i) => {
      const cell = this.cells[i];
      if (item) {
        const def = ITEMS[item.id];
        cell.className = `inv-slot filled item-${def.css}`;
        cell.title = def.type === "food" ? `${def.name} x${item.qty} (right-click to eat)` : `${def.name} x${item.qty}${def.desc ? " - " + def.desc : ""}`;
        cell.innerHTML = `<span class="inv-icon"></span>${item.qty > 1 ? `<span class="inv-qty">${item.qty}</span>` : ""}`;
      } else {
        cell.className = "inv-slot empty";
        cell.title = ""; cell.innerHTML = "";
      }
    });
  }
}

// ---- Sprite assets ----
// Player character: "male" or "female" — both sheets are loaded; this picks which draws.
CONFIG.PLAYER_CHARACTER = "male";
CONFIG.SPRITE_H = { player: 96, small: 34, big: 150 }; // on-screen display height (px)
CONFIG.WALK_BOB = 5;      // px of vertical bounce while walking (used when no real walk-cycle art exists)
CONFIG.WALK_STEP = 26;    // px travelled per bounce cycle (smaller = quicker steps)
CONFIG.WALK_CYCLE_DIST = 70; // px travelled per full 8-frame walk-cycle loop
CONFIG.EAT_ANIM_SECONDS = 2.0; // how long the eat clip (raise hand, chew, lower hand) plays once after consuming food
CONFIG.AUTOSAVE_MS = 15000;    // autosave interval
CONFIG.SAVE_KEY = "moonlightValleySave";
CONFIG.MAP_VERSION = 4;        // 4 = Pixel Farm RPG world; older saves keep coins, items and way-points

// One drawing per facing direction (no idle animation — these sheets are single-pose).
const CHAR_SPRITES = {
  male:   { down: ["assets/male_down.png"],   up: ["assets/male_up.png"],
            left: ["assets/male_left.png"],   right: ["assets/male_right.png"] },
  female: { down: ["assets/female_down.png"], up: ["assets/female_up.png"],
            left: ["assets/female_left.png"], right: ["assets/female_right.png"] },
};
// Monsters: two frames per direction bucket, alternated for a simple idle animation.
// "side" is a single left-facing pose, mirrored with ctx.scale(-1,1) for the other way.
const MONSTER_SPRITES = {
  small: { down: ["assets/small_down0.png", "assets/small_down1.png"],
            up:  ["assets/small_up0.png",   "assets/small_up1.png"],
            side:["assets/small_side0.png", "assets/small_side1.png"] },
  big:   { down: ["assets/big_down0.png", "assets/big_down1.png"],
            up:  ["assets/big_up0.png",   "assets/big_up1.png"],
            side:["assets/big_side0.png", "assets/big_side1.png"] },
};

// Loads a set of directional image sequences and hands back whichever frame
// is due this instant. Frames start loading immediately (new Image().src);
// until a direction's images are all decoded, frame() returns null so
// callers can fall back to a placeholder shape instead of a blank gap.
class DirSprite {
  constructor(byDirection) {
    this.dirs = {};
    for (const [dir, paths] of Object.entries(byDirection)) {
      this.dirs[dir] = paths.map((p) => Object.assign(new Image(), { src: p }));
    }
  }
  ready(dir) {
    const frames = this.dirs[dir];
    return !!frames && frames.every((im) => im.complete && im.naturalWidth > 0);
  }
  frame(dir, seconds, fps = 2) {
    const frames = this.dirs[dir];
    if (!frames || !frames.length || !this.ready(dir)) return null;
    const i = frames.length > 1 ? Math.floor(seconds * fps) % frames.length : 0;
    return frames[i];
  }
}

// A plain ordered sequence of frames (as opposed to DirSprite's per-direction
// bucket) — used for the video-derived walk/attack/eat animations, which are
// indexed by movement progress or by attack/eat-timer progress rather than
// by wall-clock time. ready() requires at least one frame so an empty
// sequence (e.g. no animation art for the female character) safely reports
// "not ready" instead of silently drawing undefined.
class ImgSeq {
  constructor(paths, meta = null) { this.frames = paths.map((p) => Object.assign(new Image(), { src: p })); this.meta = meta; }
  get length() { return this.frames.length; }
  ready() { return this.frames.length > 0 && this.frames.every((im) => im.complete && im.naturalWidth > 0); }
  at(i) { return this.frames[Math.max(0, Math.min(this.frames.length - 1, i))]; }
}

// Source sheets face right (walk/attack) or the viewer (eat); mirrored for the opposite horizontal
// direction. Frames cut from the character videos are drawn through drawVid() using the per-set
// metadata below: `ax` = x of the body anchor inside the (shared, per-set) canvas, `pad` = how far the
// canvas extends below the floor line, `refH` = head-to-toe height (in canvas px) of the standing pose.
// That keeps every video frame at exactly the same on-screen size / foot position as the static sprite.
const seqPaths = (name, n) => Array.from({ length: n }, (_, i) => `assets/${name}_${i}.png`);
const MALE_VID = { ax: 165, pad: 12, refH: 551 };           // front / back walk, standing, eat (movement video)
const MALE_ANIM = {
  walkRight: seqPaths("male_walk", 8),
  walkDown: seqPaths("male_walk_down", 8), walkDownMeta: MALE_VID,  // front walk cycle (from the movement video)
  walkUp: seqPaths("male_walk_up", 8), walkUpMeta: MALE_VID,        // back walk cycle (from the movement video)
  standDown: ["assets/male_stand_down.png"], standDownMeta: MALE_VID, // still standing, facing the viewer
  standUp: ["assets/male_stand_up.png"], standUpMeta: MALE_VID,       // still standing, back to the viewer
  attackRight: seqPaths("male_attack", 5),
  eat: seqPaths("male_eat", 20), eatMeta: MALE_VID,                  // raise hand -> chew -> lower hand (plays once)
};
// Female: every direction comes from her two character videos.
const FEMALE_ANIM = {
  walkRight: seqPaths("female_walk_right", 8), walkRightMeta: { ax: 163, pad: 4, refH: 618 },
  walkDown: seqPaths("female_walk_down", 8), walkDownMeta: { ax: 115, pad: 9, refH: 618 },
  walkUp: seqPaths("female_walk_up", 8), walkUpMeta: { ax: 106, pad: 10, refH: 618 },
  standDown: ["assets/female_stand_down.png"], standDownMeta: { ax: 115, pad: 3, refH: 618 },
  standUp: ["assets/female_stand_up.png"], standUpMeta: { ax: 104, pad: 3, refH: 618 },
  standRight: ["assets/female_stand_right.png"], standRightMeta: { ax: 75, pad: 3, refH: 618 },
  attackRight: seqPaths("female_attack", 10), attackRightMeta: { ax: 200, pad: 23, refH: 618 }, // two-handed swing (the game draws the blade)
  eat: seqPaths("female_eat", 24), eatMeta: { ax: 120, pad: 3, refH: 618 },
};
// Male weapon-use clips (weapons video). The weapon is part of the art, so the game's weapon-icon
// overlay is skipped while one plays. `dirs` = aim directions the clip is drawn for (others keep the
// original behaviour); `mirrorOn` = the aim direction that needs the clip flipped.
const MALE_WEAPON_ANIM = {
  sword:    { frames: seqPaths("male_sword", 9),    meta: { ax: 332, pad: 3, refH: 544 }, dirs: ["left", "right"], mirrorOn: "left" },
  bow:      { frames: seqPaths("male_bow", 8),      meta: { ax: 173, pad: 3, refH: 544 }, dirs: ["left", "right"], mirrorOn: "left" },
  crossbow: { frames: seqPaths("male_crossbow", 9), meta: { ax: 107, pad: 3, refH: 544 }, dirs: ["left", "right"], mirrorOn: "left" },
  pistol:   { frames: seqPaths("male_pistol", 6),   meta: { ax: 177, pad: 3, refH: 544 }, dirs: ["left", "right", "down"], mirrorOn: "right" },
};
// which clip each weapon uses (weapons not listed keep the original swing / overlay)
const WEAPON_CLIP = { sword: "sword", steel_sword: "sword", bow: "bow", crossbow: "crossbow", pistol: "pistol" };

// Every tool and weapon gets its own wind-up -> strike -> recovery timing (and, for the farming
// tools, a dig/pour "hold" phase) so each one reads as *that* implement rather than a reskinned
// generic poke. This table is the single source of truth: both the held-icon motion (drawSwing,
// below) and the up/down body lunge (Player.pickAnimFrame, used whenever there's no dedicated
// attack-pose art for that facing) read the same windup/strike/hold numbers, so the hand and the
// tool always reach each phase at the exact same instant — they can't drift apart.
const TOOL_FEEL = {
  chop:   { windup: 0.38, strike: 0.58 },   // axe: raise overhead, fast downward chop, slow pull-out
  dig:    { windup: 0.30, strike: 0.50, hold: 0.68 }, // hoe: raise, sharp plunge, brief dig-in wiggle, lift out
  pour:   { windup: 0.28, strike: 0.80 },   // can: lift into position, sustained tilted pour with a gentle rock, tip back up
  slash:  { windup: 0.30, strike: 0.55 },   // sword / stick / war axe: draw back, wide fast arc, follow-through
  thrust: { windup: 0.22, strike: 0.46 },   // dagger / spear: short, snappy jab out and back
};
const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);
const easeInCubic = (x) => x * x * x;
// How far the body leans into the swing (up/down facing only, where there's no dedicated attack
// art) — distinct per tool/weapon so an axe chop snaps forward hard while a watering-can pour
// barely nods and a dagger thrust is a quick, shallow poke.
function toolLunge(mode, t) {
  if (mode === "chop") {
    const f = TOOL_FEEL.chop;
    return t < f.strike ? easeInCubic(Math.min(1, t / f.strike)) * 9 : Math.max(0, 1 - easeOutCubic((t - f.strike) / (1 - f.strike))) * 9;
  }
  if (mode === "dig") {
    const f = TOOL_FEEL.dig;
    if (t < f.strike) return easeInCubic(Math.min(1, t / f.strike)) * 8;
    if (t < f.hold) return 8;
    return Math.max(0, 1 - (t - f.hold) / (1 - f.hold)) * 8;
  }
  if (mode === "pour") {
    const f = TOOL_FEEL.pour;
    if (t < f.windup) return easeOutCubic(t / f.windup) * 3;
    if (t < f.strike) return 3 + Math.sin(((t - f.windup) / (f.strike - f.windup)) * Math.PI * 2.5) * 1.1;
    return Math.max(0, 1 - (t - f.strike) / (1 - f.strike)) * 3;
  }
  if (mode === "thrust") {
    const f = TOOL_FEEL.thrust;
    return t < f.strike ? easeInCubic(Math.min(1, t / f.strike)) * 6 : Math.max(0, 1 - (t - f.strike) / (1 - f.strike)) * 6;
  }
  // "slash" and anything unmarked (plain weapon swing, planting, etc.): one broad, gentle nod
  const f = TOOL_FEEL.slash;
  return t < f.strike ? Math.sin(Math.min(1, t / f.strike) * (Math.PI / 2)) * 7 : Math.max(0, 1 - (t - f.strike) / (1 - f.strike)) * 7;
}

// Maps attack progress `t` through the SAME windup/strike/hold breakpoints as toolLunge/swingPose,
// but onto a 0..1 "how far through the body's swing-art frames are we" value instead of a pixel
// offset. Used to pick the left/right attackSeq frame, so the shared swing-art — one fixed set of
// frames reused by every tool and weapon — still reads with each tool's own timing: it lingers on
// the early frames through a slow windup, snaps through the middle frames at the strike, and (for
// hoe/can) holds near the end pose through the dig/pour "hold" phase, instead of a flat linear scrub
// that always looks and paces the same regardless of what's actually in hand.
function attackFramePhase(mode, t) {
  const f = TOOL_FEEL[mode] || TOOL_FEEL.slash;
  const wEnd = f.windup != null ? f.windup : f.strike * 0.5, sEnd = f.strike, hEnd = f.hold != null ? f.hold : sEnd;
  if (t < wEnd) return (t / wEnd) * 0.3;
  if (t < sEnd) return 0.3 + ((t - wEnd) / (sEnd - wEnd)) * 0.55;
  if (t < hEnd) return 0.85;
  return 0.85 + ((t - hEnd) / (1 - hEnd)) * 0.15;
}

// Where the hand actually grips each icon's art, and the angle the art is drawn at when rot=0.
// All the melee tool/weapon icons (axe/hoe/sword/dagger/spear/war-axe/steel-sword/stick, and the
// can, held by its top handle) are drawn on the same bottom-left-handle -> top-right-head diagonal,
// so one grip point/rest angle covers all of them; only the can's grip sits up at its handle loop
// instead of down at a blade's tang. The ranged icons (pistol/shotgun/bow/crossbow) are drawn
// pointing straight right, so their rest angle is 0. Rotating around the actual grip — instead of
// the icon's center, which just spins it in place like a coin — is what makes a swing read as the
// hand carrying the tool through an arc rather than a sprite tumbling near the body.
const ITEM_POSE = {
  chop:   { gx: 0.14, gy: 0.86, rest: -Math.PI / 4 },
  dig:    { gx: 0.14, gy: 0.86, rest: -Math.PI / 4 },
  slash:  { gx: 0.14, gy: 0.86, rest: -Math.PI / 4 },
  thrust: { gx: 0.14, gy: 0.86, rest: -Math.PI / 4 },
  pour:   { gx: 0.38, gy: 0.20, rest: -Math.PI / 4 },
};
const RANGED_GRIP = {
  pistol:   { gx: 0.32, gy: 0.76, rest: 0 },
  shotgun:  { gx: 0.20, gy: 0.55, rest: 0 },
  bow:      { gx: 0.50, gy: 0.55, rest: 0 },
  crossbow: { gx: 0.50, gy: 0.58, rest: 0 },
};
// Which swing "mode" (and so which ITEM_POSE grip/rest) each farming tool uses when it's just
// resting in hand, not mid-swing.
const TOOL_MODE = { axe: "chop", hoe: "dig", can: "pour" };
// The held-icon's offset/rotation/alpha for `mode` at normalized progress `t` (0..1), aimed along
// `ang`. Reads the exact same TOOL_FEEL windup/strike/hold breakpoints as toolLunge() above, so the
// tool in the hand and the body leaning into it always hit each phase at the same instant. `ox`/`oy`
// are a short reach FROM THE HAND (the grip pivot already sits at the hand anchor in drawSwing, so
// these only need to cover the blade/can travelling a little further out, not a whole body-width);
// `rot` is the tool's actual world-space angle (windup swings it opposite the strike, the strike
// sweeps it through `ang` and past, recovery eases it back) minus the art's own rest angle, so the
// icon visibly points where it's being used rather than spinning through an arbitrary rotation.
// `reach` (default 1) scales how far the swing travels outward — a spear jabs much further than a
// dagger, a steel sword arcs wider than a stick — without changing the shape of the motion itself.
function swingPose(mode, t, ang, reach = 1) {
  const feel = TOOL_FEEL[mode] || TOOL_FEEL.slash;
  const rest = (ITEM_POSE[mode] || ITEM_POSE.slash).rest;
  const wEnd = feel.windup != null ? feel.windup : feel.strike * 0.5, sEnd = feel.strike, hEnd = feel.hold != null ? feel.hold : sEnd;
  let dist, blade, alpha = 1;
  if (mode === "chop") { // axe / war axe: cock back overhead, fast downward chop, slow pull-out
    if (t < wEnd) { const e = easeOutCubic(t / wEnd); dist = 8 * reach; blade = ang - 2.5 * e; }
    else if (t < sEnd) { const e = easeInCubic((t - wEnd) / (sEnd - wEnd)); dist = (8 + 20 * e) * reach; blade = ang - 2.5 + 2.9 * e; }
    else { const e = (t - sEnd) / (1 - sEnd); dist = (28 - 6 * e) * reach; blade = ang + 0.4 - 0.3 * e; alpha = 1 - Math.max(0, e - 0.6) / 0.4; }
  } else if (mode === "dig") { // hoe: raise, plunge into the soil, a brief dig-in wiggle, lift out
    if (t < wEnd) { const e = easeOutCubic(t / wEnd); dist = (6 + 6 * e) * reach; blade = ang - 1.5 * e; }
    else if (t < sEnd) { const e = easeInCubic((t - wEnd) / (sEnd - wEnd)); dist = (12 + 12 * e) * reach; blade = ang - 1.5 + 1.5 * e; }
    else if (t < hEnd) { const wig = Math.sin(((t - sEnd) / Math.max(0.001, hEnd - sEnd)) * Math.PI * 3) * 0.12; dist = 24 * reach; blade = ang + wig; }
    else { const e = (t - hEnd) / (1 - hEnd); dist = (24 - 14 * e) * reach; blade = ang - 0.3 * e; alpha = 1 - Math.max(0, e - 0.7) / 0.3; }
  } else if (mode === "pour") { // watering can: lift, tip the spout toward the target, gentle rock while streaming, tip back up
    if (t < wEnd) { const e = easeOutCubic(t / wEnd); dist = 10 * e * reach; blade = ang - 0.2 + 1.1 * e; }
    else if (t < sEnd) { const rock = Math.sin(((t - wEnd) / (sEnd - wEnd)) * Math.PI * 2.5) * 0.12; dist = 14 * reach; blade = ang + 0.9 + rock; }
    else { const e = (t - sEnd) / (1 - sEnd); dist = (14 - 8 * e) * reach; blade = ang + 0.9 - 0.5 * e; alpha = 1 - Math.max(0, e - 0.6) / 0.4; }
  } else if (mode === "thrust") { // dagger / spear: pull back, snap forward to full reach, retract
    if (t < wEnd) { const e = easeOutCubic(t / wEnd); dist = (8 - 6 * e) * reach; blade = ang; }
    else if (t < sEnd) { const e = easeInCubic((t - wEnd) / (sEnd - wEnd)); dist = (2 + 30 * e) * reach; blade = ang; }
    else { const e = (t - sEnd) / (1 - sEnd); dist = (32 - 16 * e) * reach; blade = ang; alpha = 1 - Math.max(0, e - 0.7) / 0.3; }
  } else { // "slash": stick / sword / steel sword — draw back across the body, wide fast arc, follow-through
    if (t < wEnd) { const e = easeOutCubic(t / wEnd); dist = 10 * reach; blade = ang - 2.2 * e; }
    else if (t < sEnd) { const e = (t - wEnd) / (sEnd - wEnd); dist = (10 + 18 * e) * reach; blade = ang - 2.2 + 3.1 * e; }
    else { const e = (t - sEnd) / (1 - sEnd); dist = (28 - 8 * e) * reach; blade = ang + 0.9 - 0.6 * e; alpha = 1 - Math.max(0, e - 0.6) / 0.4; }
  }
  return { ox: Math.cos(blade) * dist, oy: Math.sin(blade) * dist, rot: blade - rest, alpha, windupEnd: wEnd, strikeEnd: sEnd };
}

// Shared draw helper: fit `img` into a box of the given display height (auto
// width), foot-anchored at (footX, footY), optionally mirrored horizontally,
// with an optional translucent tint (used for the hit-flash effect).
function drawSprite(ctx, img, footX, footY, displayH, mirror = false, tint = null) {
  const dw = displayH * (img.naturalWidth / img.naturalHeight);
  const x = footX - dw / 2, y = footY - displayH;
  ctx.save();
  if (mirror) { ctx.translate(footX, 0); ctx.scale(-1, 1); ctx.translate(-footX, 0); }
  ctx.drawImage(img, x, y, dw, displayH);
  if (tint) {
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = tint;
    ctx.fillRect(x, y, dw, displayH);
  }
  ctx.restore();
  return dw;
}

// Draw a video-cut frame: scale from its set metadata so the standing pose is SPRITE_H.player tall,
// body anchor on footX, canvas bottom `pad` below the floor line. Mirroring flips around the anchor.
function drawVid(ctx, img, meta, footX, footY, mirror = false, tint = null) {
  const k = CONFIG.SPRITE_H.player / meta.refH, dw = img.naturalWidth * k, dh = img.naturalHeight * k;
  const x = footX - meta.ax * k, y = footY + meta.pad * k - dh;
  ctx.save();
  if (mirror) { ctx.translate(footX, 0); ctx.scale(-1, 1); ctx.translate(-footX, 0); }
  ctx.drawImage(img, x, y, dw, dh);
  if (tint) { ctx.globalCompositeOperation = "source-atop"; ctx.fillStyle = tint; ctx.fillRect(x, y, dw, dh); }
  ctx.restore();
}

/* ---------- Input ---------- */
class Input {
  constructor() {
    this.down = new Set();
    this.pressed = new Set(); // keys pressed since last frame
    window.addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      if (k.startsWith("arrow") || k === " ") e.preventDefault();
      if (!this.down.has(k)) this.pressed.add(k);
      this.down.add(k);
    });
    window.addEventListener("keyup", (e) => this.down.delete(e.key.toLowerCase()));
    window.addEventListener("blur", () => this.down.clear());
  }
  axis() {
    const d = this.down;
    const x = (d.has("d") || d.has("arrowright") ? 1 : 0) - (d.has("a") || d.has("arrowleft") ? 1 : 0);
    const y = (d.has("s") || d.has("arrowdown") ? 1 : 0) - (d.has("w") || d.has("arrowup") ? 1 : 0);
    return { x, y };
  }
  wasPressed(key) { return this.pressed.has(key); }
  endFrame() { this.pressed.clear(); }
}

/* ---------- World ---------- */
class World {
  constructor() {
    this.tile = CONFIG.TILE;
    this.width = CONFIG.MAP_W * this.tile;
    this.height = CONFIG.MAP_H * this.tile;
  }
  // Deterministic pseudo-random per tile so the grass looks varied but stable.
  hash(x, y) {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) >>> 0) / 4294967295;
  }
  draw(ctx, camera) {
    if (this.village && this.village.ground) { // Pixel Crawler terrain (pre-rendered), else the plain fallback below
      this.village.ground.draw(ctx, camera, performance.now() / 1000, FP.season);
      return;
    }
    const t = this.tile;
    const x0 = Math.max(0, Math.floor(camera.x / t));
    const y0 = Math.max(0, Math.floor(camera.y / t));
    const x1 = Math.min(CONFIG.MAP_W - 1, Math.floor((camera.x + camera.w) / t));
    const y1 = Math.min(CONFIG.MAP_H - 1, Math.floor((camera.y + camera.h) / t));

    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const r = this.hash(tx, ty);
        const px = Math.round(tx * t - camera.x);
        const py = Math.round(ty * t - camera.y);
        ctx.fillStyle = (tx + ty) % 2 === 0 ? "#3f7d4a" : "#3a7545";
        ctx.fillRect(px, py, t, t);
        if (r > 0.72) { // grass tufts
          ctx.fillStyle = "#54985d";
          ctx.fillRect(px + r * 30, py + 10 + r * 20, 3, 8);
          ctx.fillRect(px + r * 30 + 6, py + 14 + r * 16, 3, 6);
        } else if (r < 0.03) { // rare flower
          ctx.fillStyle = "#f3ecc8";
          ctx.fillRect(px + 20, py + 20, 5, 5);
        }
      }
    }
    // World edge outline
    ctx.strokeStyle = "rgba(243,236,200,0.5)";
    ctx.lineWidth = 3;
    ctx.strokeRect(-camera.x, -camera.y, this.width, this.height);
  }
}

/* ---------- Entities ---------- */
// Push `e` out of solid `s` along one axis. Uses the movement direction when there is one,
// otherwise the nearest side (so a wide solid never throws you across itself).
function pushOutX(e, s, dir) {
  const toLeft = dir > 0 || (dir === 0 && e.cx < s.x + s.w / 2);
  e.x = toLeft ? s.x - e.w : s.x + s.w;
}
function pushOutY(e, s, dir) {
  const toTop = dir > 0 || (dir === 0 && e.cy < s.y + s.h / 2);
  e.y = toTop ? s.y - e.h : s.y + s.h;
}

class Entity {
  constructor(x, y, w, h) { this.x = x; this.y = y; this.w = w; this.h = h; }
  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }
  overlaps(o) {
    return this.x < o.x + o.w && this.x + this.w > o.x &&
           this.y < o.y + o.h && this.y + this.h > o.y;
  }
}

class Player extends Entity {
  constructor(x, y) {
    super(x, y, CONFIG.PLAYER_SIZE, CONFIG.PLAYER_SIZE);
    this.speed = CONFIG.PLAYER_SPEED;
    this.maxHp = CONFIG.PLAYER_HP;
    this.hp = this.maxHp;
    this.face = { x: 0, y: 1 };  // last movement direction (attack aim)
    this.dirKey = "down";
    this.sprite = new DirSprite(CHAR_SPRITES[CONFIG.PLAYER_CHARACTER]);
    this.hurtTimer = 0;
    this.attackTimer = 0;
    this.dead = false;
    this.walkDist = 0;   // distance travelled, drives the step-bob cycle
    this.moving = false; // true only while actually displacing this frame

    const male = CONFIG.PLAYER_CHARACTER === "male", anim = male ? MALE_ANIM : FEMALE_ANIM;
    this.walkSeq = new ImgSeq(anim.walkRight, anim.walkRightMeta);
    this.walkDownSeq = new ImgSeq(anim.walkDown, anim.walkDownMeta);
    this.walkUpSeq = new ImgSeq(anim.walkUp, anim.walkUpMeta);
    this.attackSeq = new ImgSeq(anim.attackRight, anim.attackRightMeta);
    this.eatSeq = new ImgSeq(anim.eat, anim.eatMeta);
    this.standDownSeq = new ImgSeq(anim.standDown || [], anim.standDownMeta);
    this.standUpSeq = new ImgSeq(anim.standUp || [], anim.standUpMeta);
    this.standSideSeq = new ImgSeq(anim.standRight || [], anim.standRightMeta);
    this.weaponClips = {};   // male only: sword / bow / crossbow / pistol clips
    if (male) for (const [id, c] of Object.entries(MALE_WEAPON_ANIM)) this.weaponClips[id] = Object.assign(new ImgSeq(c.frames, c.meta), { dirs: c.dirs, mirrorOn: c.mirrorOn });
    this.wClip = null;       // the weapon clip playing right now (set when an attack starts)
    this.swingMode = null;   // "chop" / "dig" / "pour" while a farming tool is in use — picks the body-lunge curve below
    this.eating = false;
    this.eatTimer = 0;
  }
  // Ticks the eat-gesture timer only. Called unconditionally every frame
  // (even while a menu has frozen the rest of update()) so the little
  // chew animation still finishes playing after eating from an open panel.
  tickEat(dt) {
    this.eatTimer = Math.max(0, this.eatTimer - dt);
    this.eating = this.eatTimer > 0;
  }
  startEating() { this.eating = true; this.eatTimer = CONFIG.EAT_ANIM_SECONDS; }
  update(dt, input, world, solids) {
    let { x, y } = input.axis();
    if (x || y) {
      const l = Math.hypot(x, y);
      this.face = { x: x / l, y: y / l };
      this.dirKey = Math.abs(y) > Math.abs(x) ? (y > 0 ? "down" : "up") : (x > 0 ? "right" : "left");
    }
    if (x && y) { x *= Math.SQRT1_2; y *= Math.SQRT1_2; } // even diagonal speed

    const startX = this.x, startY = this.y;

    // Move per-axis so the player slides along walls instead of sticking.
    this.x += x * this.speed * dt;
    this.x = Math.min(Math.max(0, this.x), world.width - this.w);
    for (const s of solids) if (this.overlaps(s)) pushOutX(this, s, x);
    this.y += y * this.speed * dt;
    this.y = Math.min(Math.max(0, this.y), world.height - this.h);
    for (const s of solids) if (this.overlaps(s)) pushOutY(this, s, y);

    // Bob only advances when actually displacing — walking into a wall
    // (or standing still) freezes the cycle instead of bouncing in place.
    const moved = Math.hypot(this.x - startX, this.y - startY);
    this.moving = moved > 0.01;
    if (this.moving) this.walkDist += moved;
  }
  // Picks which image to draw this frame: the eat gesture (front-facing,
  // overrides everything while active), a real attack swing or walk-cycle
  // frame when facing left/right and that art is loaded, or null to fall
  // back to the static per-direction sprite (used for up/down, and for any
  // character without video-derived animation frames).
  // Start the weapon-use clip for `weaponId` aimed along dirKey. Returns true when a clip will play
  // (the caller then skips the weapon-icon overlay because the weapon is already in the art).
  startWeaponAnim(weaponId) {
    this.wClip = null;
    const clip = this.weaponClips[WEAPON_CLIP[weaponId]];
    if (!clip || !clip.ready() || !clip.dirs.includes(this.dirKey)) return false;
    this.wClip = { seq: clip, mirror: this.dirKey === clip.mirrorOn };
    return true;
  }
  pickAnimFrame() {
    if (this.attackTimer > 0 && this.wClip) {
      const progress = Math.min(0.999, Math.max(0, 1 - this.attackTimer / (this.attackDur || 0.4)));
      return { img: this.wClip.seq.at(Math.floor(progress * this.wClip.seq.length)), mirror: this.wClip.mirror, bob: false, meta: this.wClip.seq.meta };
    }
    if (this.eating && this.eatSeq.ready()) {
      const t = CONFIG.EAT_ANIM_SECONDS - this.eatTimer;
      const i = Math.min(this.eatSeq.length - 1, Math.floor((t / CONFIG.EAT_ANIM_SECONDS) * this.eatSeq.length));
      return { img: this.eatSeq.at(i), mirror: false, bob: false, meta: this.eatSeq.meta };
    }
    const sideways = this.dirKey === "left" || this.dirKey === "right";
    const mirror = this.dirKey === "left"; // source art faces right
    if (this.attackTimer > 0 && !this.noSwing) {
      const progress = Math.min(0.999, Math.max(0, 1 - this.attackTimer / (this.attackDur || 0.4)));
      if (sideways && this.attackSeq.ready()) {
        // Same shared swing-art for every tool/weapon, but paced (attackFramePhase) and nudged
        // (a quarter-strength toolLunge, matching the tool icon's own dy in swingPose) to each
        // one's own windup/strike/hold timing, so the hand reads as reacting to *this* tool
        // instead of playing one generic scrub underneath whatever's drawn over it.
        const i = Math.floor(attackFramePhase(this.swingMode, progress) * this.attackSeq.length);
        const dy = toolLunge(this.swingMode, progress) * 0.25;
        return { img: this.attackSeq.at(i), mirror, bob: false, dy, meta: this.attackSeq.meta };
      }
      // No up/down attack art: reuse a walk-cycle pose and lunge the body forward and back, with a
      // lean timed to match whichever tool is out (see toolLunge) so the body and the tool move together.
      const seq = this.dirKey === "down" ? this.walkDownSeq : this.walkUpSeq;
      if (!sideways && seq.ready()) {
        const feel = TOOL_FEEL[this.swingMode] || TOOL_FEEL.slash;
        const lunge = toolLunge(this.swingMode, progress) * (this.dirKey === "down" ? 1 : -1);
        return { img: seq.at(progress < feel.strike ? 2 % seq.length : 6 % seq.length), mirror: false, bob: false, dy: lunge, meta: seq.meta };
      }
    }
    if (this.moving) { // real walk cycle in all four directions
      const seq = sideways ? this.walkSeq : this.dirKey === "down" ? this.walkDownSeq : this.walkUpSeq;
      if (seq.ready()) {
        const i = Math.floor((this.walkDist / CONFIG.WALK_CYCLE_DIST) * seq.length) % seq.length;
        return { img: seq.at(i), mirror: sideways && mirror, bob: false, meta: seq.meta };
      }
    }
    // Standing still: use the standing pose from the video (the male's side-facing idle keeps its
    // original static sprite; the female has a video-derived side pose too).
    const st = sideways ? this.standSideSeq : this.dirKey === "down" ? this.standDownSeq : this.standUpSeq;
    if (st.ready()) return { img: st.at(0), mirror: sideways && mirror, bob: false, meta: st.meta };
    return null;
  }
  draw(ctx, camera) {
    const footX = this.cx - camera.x, footY = this.y + this.h - camera.y;
    if (CONFIG.PLAYER_NAME) { // name tag
      ctx.save(); ctx.font = "bold 12px 'Trebuchet MS', sans-serif"; ctx.textAlign = "center"; ctx.lineWidth = 3; ctx.strokeStyle = "rgba(30,18,10,.85)";
      ctx.strokeText(CONFIG.PLAYER_NAME, footX, footY - CONFIG.SPRITE_H.player - 6); ctx.fillStyle = "#fde6b2"; ctx.fillText(CONFIG.PLAYER_NAME, footX, footY - CONFIG.SPRITE_H.player - 6); ctx.restore();
    }
    const anim = this.pickAnimFrame();
    const bob = !anim && this.moving ? Math.abs(Math.sin((this.walkDist / CONFIG.WALK_STEP) * Math.PI)) * CONFIG.WALK_BOB : 0;

    ctx.fillStyle = "rgba(0,0,0,0.25)"; // shadow (stays on the ground, doesn't bob)
    ctx.beginPath();
    ctx.ellipse(footX, footY + 2, this.w / 2 - bob * 0.4, 6 - bob * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();

    const tint = this.hurtTimer > 0 && Math.floor(this.hurtTimer * 16) % 2 ? "rgba(255,80,80,0.55)" : null;
    if (anim && anim.meta) { drawVid(ctx, anim.img, anim.meta, footX, footY + (anim.dy || 0), anim.mirror, tint); return; } // video-cut frame
    if (anim) { drawSprite(ctx, anim.img, footX, footY + (anim.dy || 0), CONFIG.SPRITE_H.player, anim.mirror, tint); return; }
    const img = this.sprite.frame(this.dirKey, performance.now() / 1000);
    if (img) { drawSprite(ctx, img, footX, footY - bob, CONFIG.SPRITE_H.player, false, tint); return; }

    // Placeholder box shown until the sprite sheet finishes loading.
    const px = Math.round(this.x - camera.x), py = Math.round(this.y - camera.y);
    ctx.fillStyle = tint ? "#ff6b6b" : "#e9c46a";
    ctx.fillRect(px, py, this.w, this.h);
    ctx.strokeStyle = "#1b2440"; ctx.lineWidth = 2;
    ctx.strokeRect(px, py, this.w, this.h);
    ctx.fillStyle = "#1b2440";
    ctx.fillRect(px + 8, py + 9, 4, 4); ctx.fillRect(px + 18, py + 9, 4, 4);
    ctx.fillStyle = "#fff";
    ctx.fillRect(px + this.w / 2 + this.face.x * 22 - 3, py + this.h / 2 + this.face.y * 22 - 3, 6, 6);
  }
}

class Interactable extends Entity {
  constructor({ x, y, w = 40, h = 40, name, color, prompt = "Interact", solid = true }) {
    super(x, y, w, h);
    this.name = name;
    this.color = color;
    this.prompt = prompt;
    this.solid = solid;
  }
  // Override or pass a callback later for real behavior (talk, open, harvest...).
  onInteract(game) { game.ui.popup(this, "Interacting..."); }
  draw(ctx, camera) {
    const px = Math.round(this.x - camera.x);
    const py = Math.round(this.y - camera.y);
    ctx.fillStyle = this.color;
    ctx.fillRect(px, py, this.w, this.h);
    ctx.strokeStyle = "rgba(15,22,48,0.8)";
    ctx.lineWidth = 2;
    ctx.strokeRect(px, py, this.w, this.h);
    ctx.fillStyle = "#f3ecc8";
    ctx.font = "12px 'Trebuchet MS', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(this.name, px + this.w / 2, py - 6);
  }
}

// A chest is real persistent storage: it owns its own Inventory, pre-filled
// with its starting loot, and the player drags items in and out of it (see
// Game.openChestUI). A one-time coin bonus still pops on the first open, as
// a bit of "treasure" flavor separate from the items sitting in its slots.
class Chest extends Interactable {
  constructor({ loot = [], coins = 0, slots = 8, ...rest }) {
    super({ prompt: "Open chest", color: "#b5763a", ...rest });
    this.coins = coins;
    this.opened = false;
    this.inv = new Inventory(slots);
    for (const { id, qty } of loot) this.inv.add(id, qty);
  }
  onInteract(game) {
    if (!this.opened) {
      this.opened = true;
      this.color = "#5c3d22"; // darker = opened at least once
      if (this.coins) { game.coins += this.coins; game.ui.popup(this, `+${this.coins} coins`); }
    }
    game.openChestUI(this);
  }
}

// A shopkeeper stall — opens the buy/sell panel. All the actual transaction
// logic lives in Game (buyItem/sellAt) since it needs the player's coins
// and inventory; this class is just the world object + interaction hook.
class Shop extends Interactable {
  constructor(opts) { super({ prompt: "Open shop", color: "#d1a054", ...opts }); }
  onInteract(game) { game.openShopUI(); }
}

// A fast-travel waypoint. Walking up to it unlocks it (one-time); actually
// traveling happens later from the travel map (press T), not immediately on
// interact, so visiting a point doesn't yank the player away mid-exploration.
class TravelPoint extends Interactable {
  constructor({ travelName, ...rest }) {
    super({ prompt: "Unlock way-point", color: "#6f8fd1", solid: false, ...rest });
    this.travelName = travelName;
    this.unlocked = false;
  }
  onInteract(game) {
    if (!this.unlocked) {
      this.unlocked = true;
      game.travelUnlocked[this.travelName] = true;
      game.ui.popup(this, "Way-point unlocked!");
    } else {
      game.ui.popup(this, "Already unlocked");
    }
  }
}

// An item lying on the ground — made by dropping something from the backpack (drag it out of the
// inventory panel, or press Q to drop whatever's on the selected hotbar slot). Anyone who walks up
// and presses E scoops the whole stack back into their own bag; nothing marks it as "belonging" to
// whoever dropped it, so it's exactly as pickable by the same player walking back over it as it would
// be by anyone else sharing this save. If the bag is full it says so and leaves the item sitting there
// instead of quietly discarding it.
class DroppedItem extends Interactable {
  constructor({ x, y, id, qty }) {
    super({ x, y, w: 20, h: 12, name: ITEMS[id].name, prompt: `Pick up ${ITEMS[id].name}`, solid: false });
    this.id = id; this.qty = qty; this.t = Math.random() * 6;
  }
  onInteract(game) {
    if (game.giveItem(this.id, this.qty, this.cx, this.y - 6)) game.removeObject(this);
  }
  draw(ctx, cam) {
    const x = this.cx - cam.x, y = this.y + this.h - cam.y;
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath(); ctx.ellipse(x, y, 11, 4, 0, 0, Math.PI * 2); ctx.fill();
    const im = weaponIcon(ITEMS[this.id].css);
    const bob = Math.sin(this.t + performance.now() / 500) * 1.6;
    if (im.complete && im.naturalWidth) { ctx.imageSmoothingEnabled = false; ctx.drawImage(im, x - 14, y - 28 + bob, 28, 28); }
    if (this.qty > 1) {
      ctx.font = "bold 11px 'Trebuchet MS', sans-serif"; ctx.textAlign = "center";
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(30,18,10,.85)"; ctx.strokeText(`x${this.qty}`, x, y - 2);
      ctx.fillStyle = "#fde6b2"; ctx.fillText(`x${this.qty}`, x, y - 2);
    }
  }
}

/* ---------- Monsters ---------- */
// Shared axis-separated movement so entities slide along walls.
function moveWithCollision(e, dx, dy, world, solids) {
  e.x = Math.min(Math.max(0, e.x + dx), world.width - e.w);
  for (const s of solids) if (e.overlaps(s)) pushOutX(e, s, dx);
  e.y = Math.min(Math.max(0, e.y + dy), world.height - e.h);
  for (const s of solids) if (e.overlaps(s)) pushOutY(e, s, dy);
}

class Monster extends Entity {
  constructor(type, x, y, world) {
    const def = MONSTER_TYPES[type];
    super(x, y, def.size, def.size);
    this.type = type;
    this.def = def;
    this.world = world;
    this.hp = def.hp;
    this.maxHp = def.hp;
    this.dir = { x: 0, y: 0 };
    this.wanderTimer = Math.random() * 2;
    this.flash = 0;          // seconds of white hit-flash left
    this.kx = 0; this.ky = 0; // knockback velocity
    this.dead = false;
    this.dirBucket = "down";
    this.mirror = false;
    this.walkDist = 0;
    this.moving = false;
    this.t = Math.random() * 5; this.attackAnim = 0;
  }

  update(dt, player, solids) {
    this.t += dt; this.attackAnim = Math.max(0, this.attackAnim - dt);
    if (!player.dead && Math.hypot(player.cx - this.cx, player.cy - this.cy) < this.w / 2 + 40) this.attackAnim = 0.3;
    const dx = player.cx - this.cx, dy = player.cy - this.cy;
    const dist = Math.hypot(dx, dy) || 1;
    const village = this.world.village;
    const playerSafe = village && village.safe(player.cx, player.cy); // monsters don't hunt you inside the village
    let speed;
    if (!player.dead && !playerSafe && dist < this.def.aggro) {          // CHASE
      this.dir = { x: dx / dist, y: dy / dist };
      speed = this.def.chaseSpeed;
    } else {                                              // WANDER
      this.wanderTimer -= dt;
      if (this.wanderTimer <= 0) {
        this.wanderTimer = 1 + Math.random() * 2;
        if (Math.random() < 0.4) this.dir = { x: 0, y: 0 };
        else { const a = Math.random() * Math.PI * 2; this.dir = { x: Math.cos(a), y: Math.sin(a) }; }
      }
      speed = this.def.speed;
    }
    const startX = this.x, startY = this.y;
    moveWithCollision(this, (this.dir.x * speed + this.kx) * dt, (this.dir.y * speed + this.ky) * dt, this.world, solids);
    if (village && village.safe(this.cx, this.cy)) { // never step into the village centre: undo and turn around
      this.x = startX; this.y = startY; this.kx = this.ky = 0;
      this.dir = { x: -this.dir.x, y: -this.dir.y };
    }
    const moved = Math.hypot(this.x - startX, this.y - startY);
    this.moving = moved > 0.01;
    if (this.moving) this.walkDist += moved;
    if (this.dir.x || this.dir.y) {
      if (Math.abs(this.dir.y) > Math.abs(this.dir.x)) { this.dirBucket = this.dir.y > 0 ? "down" : "up"; }
      else { this.dirBucket = "side"; this.mirror = this.dir.x > 0; } // art faces left by default
    }
    const decay = Math.exp(-8 * dt);
    this.kx *= decay; this.ky *= decay;
    if (this.flash > 0) this.flash -= dt;
  }

  draw(ctx, camera) {
    const footX = this.cx - camera.x, footY = this.y + this.h - camera.y;
    const tint = this.flash > 0 ? "rgba(255,255,255,0.8)" : null;
    const big = this.type === "big", scale = big ? 5.2 : 3.2;
    const dirKey = this.dirBucket === "side" ? (this.mirror ? "right" : "left") : this.dirBucket;
    ctx.fillStyle = "rgba(20,30,20,0.28)"; ctx.beginPath(); ctx.ellipse(footX, footY + 1, this.w * 0.55, this.w * 0.2, 0, 0, Math.PI * 2); ctx.fill();
    const near = this.attackAnim > 0;
    const anim = this.flash > 0 ? "hurt" : near ? "attack" : this.moving ? "walk" : "idle";
    const fps = anim === "walk" ? 8 : anim === "attack" ? 8 : 3;
    FP.drawChar(ctx, "skeleton", big ? "ember" : "bone", anim, dirKey, anim === "hurt" ? 0 : (this.t * fps) % FP.animLen("skeleton", anim), footX, footY, scale, tint);
    if (this.hp < this.maxHp) { // health bar once damaged
      const bx = footX - this.w / 2, barY = footY - 24 * scale - 4;
      ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(bx, barY, this.w, 5);
      ctx.fillStyle = "#6be07a"; ctx.fillRect(bx, barY, this.w * Math.max(0, this.hp / this.maxHp), 5);
    }
  }
}

class MonsterSystem {
  // opts = { small, big, max }: how many of each to start with and the cap (every map page sets its own)
  constructor(world, opts) { this.world = world; this.list = []; this.timer = 0; this.opts = opts || { small: CONFIG.START_SMALL, big: CONFIG.START_BIG, max: CONFIG.MONSTER_MAX }; }

  spawn(type, player, solids) {
    const size = MONSTER_TYPES[type].size;
    for (let tries = 0; tries < 30; tries++) {
      const m = new Monster(type, Math.random() * (this.world.width - size), Math.random() * (this.world.height - size), this.world);
      if (Math.hypot(m.cx - player.cx, m.cy - player.cy) < CONFIG.SPAWN_SAFE_DIST) continue;
      if (this.world.village && this.world.village.safe(m.cx, m.cy)) continue;
      if (solids.some((s) => m.overlaps(s))) continue;
      this.list.push(m);
      return;
    }
  }
  populate(player, solids) {
    this.list = [];
    for (let i = 0; i < this.opts.small; i++) this.spawn("small", player, solids);
    for (let i = 0; i < this.opts.big; i++) this.spawn("big", player, solids);
  }
  update(dt, player, solids) {
    for (const m of this.list) m.update(dt, player, solids);
    this.list = this.list.filter((m) => !m.dead);
    this.timer += dt;
    if (this.timer >= CONFIG.RESPAWN_SECONDS) {         // slow trickle back up to the cap
      this.timer = 0;
      if (WORLD.nightNow && this.list.length < this.opts.max) this.spawn(Math.random() < 0.7 ? "small" : "big", player, solids);
    }
  }
}

/* ---------- Camera ---------- */
class Camera {
  constructor() { this.x = 0; this.y = 0; this.w = 0; this.h = 0; }
  resize(w, h) { this.w = w; this.h = h; }
  follow(target, world, dt, snap = false) {
    const tx = target.cx - this.w / 2;
    const ty = target.cy - this.h / 2;
    const k = snap ? 1 : 1 - Math.exp(-CONFIG.CAMERA_LERP * dt); // frame-rate independent
    this.x += (tx - this.x) * k;
    this.y += (ty - this.y) * k;
    // Clamp to world; if the screen is larger than the world, center it.
    this.x = world.width  <= this.w ? (world.width  - this.w) / 2 : Math.min(Math.max(0, this.x), world.width  - this.w);
    this.y = world.height <= this.h ? (world.height - this.h) / 2 : Math.min(Math.max(0, this.y), world.height - this.h);
  }
}

/* ---------- UI ---------- */
class UI {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.coords = $("coords"); this.hint = $("hint");
    this.goldEl = $("gold"); this.timeEl = $("clock-time"); this.dateEl = $("clock-date"); this.seasonEl = $("clock-season"); this.wxEl = $("clock-wx");
    this.popups = []; // { target, text, until }
    this.healthFill = $("health-fill"); this.healthText = $("health-text");
    this.energyFill = $("energy-fill"); this.energyBox = $("energy");
    this.canEl = $("can-water"); this.canFill = $("can-fill");
    this.floaters = []; // { x, y, text, color, born }
    this._last = {};
  }
  set(key, el, text) { if (this._last[key] !== text) { this._last[key] = text; el.textContent = text; } }
  setCoords(p) { this.set("coords", this.coords, `${this.place ? this.place : ""}`); }
  setHealth(hp, max) {
    this.healthFill.style.width = `${(hp / max) * 100}%`;
    this.set("hp", this.healthText, `HP ${hp} / ${max}`);
  }
  setEnergy(e, max) {
    const f = Math.max(0, Math.min(1, e / max));
    this.energyFill.style.height = `${f * 100}%`;
    this.energyFill.style.background = f > 0.5 ? "#5cc94a" : f > 0.2 ? "#e8b93c" : "#d9534f";
    this.energyBox.title = `Energy ${Math.round(e)} / ${max}`;
  }
  setCan(show, water, max) {
    this.canEl.hidden = !show;
    if (show) this.canFill.style.width = `${(water / max) * 100}%`;
  }
  setClock(time, dt, weather) {
    const h = Math.floor(time) % 24, m = Math.floor((time % 1) * 6) * 10, ap = h >= 12 && h < 24 ? "pm" : "am", hh = h % 12 === 0 ? 12 : h % 12;
    this.set("time", this.timeEl, `${hh}:${String(m).padStart(2, "0")} ${ap}`);
    this.set("date", this.dateEl, `${dt.weekday}. ${dt.day}`);
    this.set("season", this.seasonEl, `${dt.seasonName}${dt.year > 1 ? " · Y" + dt.year : ""}`);
    if (this._last.wx !== weather) { this._last.wx = weather; this.wxEl.src = `assets/fp/wx_${weather}.png`; this.wxEl.title = weather[0].toUpperCase() + weather.slice(1); }
  }
  floatText(x, y, text, color) {
    this.floaters.push({ x, y, text, color, born: performance.now() });
  }
  drawFloaters(ctx, camera) {
    const now = performance.now(), life = 900;
    this.floaters = this.floaters.filter((f) => now - f.born < life);
    ctx.font = "bold 16px 'Trebuchet MS', sans-serif";
    ctx.textAlign = "center";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(40,24,14,0.92)";
    for (const f of this.floaters) {
      const t = (now - f.born) / life;
      const x = f.x - camera.x, y = f.y - camera.y - t * 40;
      ctx.globalAlpha = 1 - t * t;
      ctx.strokeText(f.text, x, y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, x, y);
    }
    ctx.globalAlpha = 1;
  }
  setStats(coins) { this.set("gold", this.goldEl, String(coins)); }
  setHint(text) {
    this.hint.hidden = !text;
    if (text) this.set("hinttext", this.hint, text);
  }
  popup(target, text) {
    this.popups = [{ target, text, until: performance.now() + Math.max(CONFIG.POPUP_MS * 1.6, 1200 + text.length * 45) }];
  }
  drawPopups(ctx, camera) {
    const now = performance.now(), total = 2400;
    this.popups = this.popups.filter((p) => p.until > now);
    for (const p of this.popups) {
      const life = (p.until - now) / total;
      const x = p.target.cx - camera.x, lh = 18;
      ctx.font = "bold 14px 'Trebuchet MS', sans-serif"; ctx.textAlign = "center";
      const lines = []; let cur = "";               // wrap long text (signs, villagers) to ~300px lines
      for (const w of p.text.split(" ")) { const t = cur ? cur + " " + w : w; if (ctx.measureText(t).width > 300 && cur) { lines.push(cur); cur = w; } else cur = t; }
      lines.push(cur);
      const w = Math.min(340, Math.max(...lines.map((l) => ctx.measureText(l).width)) + 26), h = lines.length * lh + 12;
      const y = p.target.y - camera.y - 24 - h - (1 - life) * 10;
      ctx.globalAlpha = Math.min(1, life * 3);
      ctx.fillStyle = "rgba(60,38,22,0.95)"; ctx.fillRect(Math.round(x - w / 2), Math.round(y), w, h);
      ctx.strokeStyle = "#e8c66a"; ctx.lineWidth = 2; ctx.strokeRect(Math.round(x - w / 2), Math.round(y), w, h);
      ctx.fillStyle = "#fde6b2";
      lines.forEach((l, i) => ctx.fillText(l, x, y + 18 + i * lh));
      ctx.globalAlpha = 1;
    }
  }
}

/* ---------- Game ---------- */
class Game {
  constructor() {
    this.canvas = document.getElementById("game");
    this.ctx = this.canvas.getContext("2d");
    this.input = new Input();
    this.world = new World();
    this.camera = new Camera();
    this.ui = new UI();
    this.farm = new Farm();
    this.coins = 100;
    this.crops = 0;     // lifetime harvest count
    this.tile = { tx: 0, ty: 0 };

    // Calendar: dayIndex 0 = Spring 1. Time is in hours (6.0 = 6:00 am ... 26.0 = 2:00 am the next morning).
    this.dayIndex = 0; this.time = CONFIG.DAY_START;
    this.energy = CONFIG.MAX_ENERGY; this.water = CONFIG.CAN_MAX;
    this.sel = 0;            // selected hotbar slot
    this.particles = []; this.deaths = []; this.confirm = null;
    this.setDay(0);

    this.inventory = new Inventory(CONFIG.INV_SIZE);
    for (const [id, q] of [["axe", 1], ["hoe", 1], ["can", 1], ["stick", 1], ["seeds", 15], ["tomato_seeds", 5]]) this.inventory.add(id, q); // starter hotbar
    this.openChest = null;   // Chest currently shown in the chest panel, if any
    this.uiMode = null;      // null | "inventory" | "chest" | "cook" — which overlay is up
    this.drag = null;        // in-flight drag/drop state, see setupInventoryDnD()

    this.overlayEl = document.getElementById("overlay");
    this.invBoxEl = document.getElementById("inventory-box");
    this.chestBoxEl = document.getElementById("chest-box");
    this.cookBoxEl = document.getElementById("cook-box");
    this.shopBoxEl = document.getElementById("shop-box");
    this.travelBoxEl = document.getElementById("travel-box");
    this.coinsLabelEl = document.getElementById("inv-coins");
    this.hotbarEl = document.getElementById("hotbar");
    this.confirmEl = document.getElementById("confirm");
    this.chestCoinsLabelEl = document.getElementById("chest-coins");
    this.toastEl = document.getElementById("toast");
    this.dialogEl = document.getElementById("dialog");
    this.dlg = null;         // { npc, i } while talking to an NPC

    this.invGrid = new ItemGrid(document.getElementById("inv-grid"), "player", () => this.inventory);
    this.chestGrid = new ItemGrid(document.getElementById("chest-grid"), "chest", () => this.openChest && this.openChest.inv);
    this.setupInventoryDnD();
    this.refreshPanels();

    // The world is a 3x3 grid of map pages (see areas.js). Pages are built the first time you enter them.
    this.pages = {};            // id -> { id, spec, area, objects, monsters, farm, populated }
    this.page = null;
    this.travelUnlocked = {};   // way-point name -> true
    this.savedPages = {};       // per-page save data (farm + chests), applied when that page is first built
    this.visited = { "0,0": true };
    this.fade = null;           // { phase: "out" | "in", t, dir } while walking between pages
    this.edgeCool = 0;

    this.weapon = WEAPONS.stick;
    this.slash = null; // { rect, until } for the swing visual
    this.projectiles = []; this.swing = null; this.muzzle = null;

    FP.absTime = () => this.dayIndex * 24 + this.time;   // the farm's reset timers run on the game clock
    const save = this.readSave();   // coins, inventory, way-points ... (page data is applied as pages get built)
    this.player = new Player(0, 0);
    const startId = save && save.mapVersion >= 4 && WORLD.pages[save.page] ? save.page : "0,0";
    this.enterPage(startId);
    this.player.x = this.spawn.x; this.player.y = this.spawn.y;
    if (save && save.mapVersion >= 4 && typeof save.playerX === "number") { this.player.x = save.playerX; this.player.y = save.playerY; this.unstick(); }
    if (save && typeof save.playerHp === "number") this.player.hp = save.playerHp;
    this.beginPage();
    this.nearest = null;

    this.gameOverEl = document.getElementById("gameover");
    document.getElementById("restart").addEventListener("click", () => this.restart());
    this.canvas.addEventListener("mousedown", (e) => { // click uses the selected item toward the cursor
      if (this.uiMode || this.fade || this.player.dead) return;
      const p = this.player;
      const dx = e.clientX - (p.cx - this.camera.x), dy = e.clientY - (p.cy - this.camera.y);
      const d = Math.hypot(dx, dy);
      if (d > 4) { p.dirKey = Math.abs(dy) > Math.abs(dx) ? (dy > 0 ? "down" : "up") : (dx > 0 ? "right" : "left"); p.face = { x: dx / d, y: dy / d }; }
      this.useSelected();
    });
    window.addEventListener("wheel", (e) => { if (!this.uiMode) this.selectSlot((this.sel + (e.deltaY > 0 ? 1 : CONFIG.HOTBAR - 1)) % CONFIG.HOTBAR); }, { passive: true });
    this.buildHotbar();
    document.getElementById("cf-yes").addEventListener("click", () => this.answerConfirm(true));
    document.getElementById("cf-no").addEventListener("click", () => this.answerConfirm(false));

    window.addEventListener("resize", () => this.resize());
    this.resize();
    this.camera.follow(this.player, this.world, 0, true);

    this.afterLoad();
    setInterval(() => this.saveGame(true), CONFIG.AUTOSAVE_MS);
    window.addEventListener("beforeunload", () => this.saveGame(false));

    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  /* ---------- Map pages ---------- */
  getPage(id) {
    if (this.pages[id]) return this.pages[id];
    const spec = WORLD.pages[id], t = CONFIG.TILE;
    const area = new WORLD.Area(this.world, spec);
    const objects = [];
    for (const tr of spec.travels || []) {
      const tp = new TravelPoint({ x: tr.tx * t - 17, y: tr.ty * t - 17, w: 34, h: 34, name: tr.name, travelName: tr.name });
      tp.unlocked = !!this.travelUnlocked[tr.name];
      objects.push(tp);
    }
    objects.push(...area.makeObjects(this)); // houses, kitchen, signs, chests, villagers, hens
    const pg = { id, spec, area, objects, monsters: new MonsterSystem(this.world, spec.mobs && spec.mobs.max > 0 ? spec.mobs : CONFIG.NIGHT_MOBS), farm: new Farm(), populated: false, day: this.dayIndex };
    const sv = this.savedPages[id];
    if (sv) { // apply what the save file remembers about this page
      const f = sv.farm;
      if (f && f.soil && f.soil.length === pg.farm.soil.length) for (const k of ["soil", "wet", "crop", "grown", "flag", "since"]) if (f[k]) pg.farm[k].set(f[k]);
      pg.farm.arm(FP.absTime());
      if (Array.isArray(sv.trees)) area.importTrees(sv.trees);
      area.importBroken(sv);   // rocks, crates, bushes, flowers... that were broken stay broken
      if (Array.isArray(sv.chests)) pg.objects.filter((o) => o instanceof Chest).forEach((chest, i) => {
        const c = sv.chests[i]; if (!c) return;
        chest.opened = c.opened; chest.inv.slots = c.slots.map((x) => (x ? { ...x } : null));
        while (chest.inv.slots.length < chest.inv.size) chest.inv.slots.push(null);
      });
      const hens = pg.objects.filter((o) => o instanceof WORLD.Hen);
      (sv.hens || []).forEach((fed, i) => { if (hens[i]) hens[i].fed = !!fed; });
      for (const [ex, ey] of sv.eggs || []) pg.objects.push(new WORLD.Egg({ fx: ex, fy: ey }));
      // days that passed while this page was not loaded: crops grow, trees regrow, fed hens lay
      for (let d = (sv.day == null ? this.dayIndex : sv.day) + 1; d <= this.dayIndex; d++) this.pageNight(pg, d);
    }
    return (this.pages[id] = pg);
  }
  // One night passes on a page: `d` is the day that is about to start.
  pageNight(pg, d) {
    const dt = FP.date(d), rain = ["rain", "storm"].includes(FP.weatherFor(d));
    pg.farm.dayTick(rain, dt.seasonKey);
    pg.farm.expire(d * 24 + CONFIG.DAY_START);   // soil left empty for a whole day reverts
    const r = FP.rng(d * 977 + pg.spec.seed);
    const fake = { farm: pg.farm };
    for (const t of pg.area.trees.slice()) t.dayTick(fake, r);
    pg.area.props.sort((a, b) => a.baseY - b.baseY);
    for (const h of pg.objects.filter((o) => o instanceof WORLD.Hen)) {
      if (!h.fed) continue;
      h.fed = false;
      if (pg.objects.filter((o) => o instanceof WORLD.Egg).length < 24) pg.objects.push(new WORLD.Egg({ fx: h.cx + (r() - 0.5) * 60, fy: h.y + h.h + (r() - 0.3) * 20 }));
    }
    pg.day = d;
  }
  // Make `id` the page the game is running on (does not move the player).
  enterPage(id) {
    if (this.page) this.page.area.ground.invalidate(); // free the pre-rendered terrain of the page we leave
    const pg = this.getPage(id);
    this.page = pg; this.pageId = id; this.visited[id] = true;
    this.village = pg.area; this.world.village = pg.area;
    this.objects = pg.objects; this.monsters = pg.monsters; this.farm = pg.farm;
    this.spawn = { ...pg.area.spawn };
    this.nearest = null; this.slash = null; this.projectiles = []; this.swing = null;
    if (this.ui) { this.ui.popups = []; this.ui.floaters = []; this.ui.place = pg.spec.name; }
    this.updateWorldMap();
    return pg;
  }
  // First visit: fill the page with monsters (never within sight of where the player stands).
  beginPage() {
    if (!this.page.populated) { this.page.populated = true; if (this.isNight) this.page.monsters.populate(this.player, this.getSolids()); }
    this.camera.follow(this.player, this.world, 0, true);
  }
  // If the player overlaps something solid (old save, new layout), nudge to the nearest free spot.
  unstick() {
    const p = this.player, solids = this.getSolids();
    if (!solids.some((o) => p.overlaps(o))) return;
    const x0 = p.x, y0 = p.y;
    for (let r = 8; r <= 480; r += 8) for (let a = 0; a < 16; a++) {
      p.x = Math.min(Math.max(0, x0 + Math.cos(a * Math.PI / 8) * r), this.world.width - p.w);
      p.y = Math.min(Math.max(0, y0 + Math.sin(a * Math.PI / 8) * r), this.world.height - p.h);
      if (!solids.some((o) => p.overlaps(o))) return;
    }
    p.x = this.spawn.x; p.y = this.spawn.y;
  }
  // Which edge (if any) the player is walking out through. Only the street openings count.
  edgeExit() {
    if (this.fade || this.edgeCool > 0) return null;
    const p = this.player, w = this.world, e = this.village.exits, T = CONFIG.TILE, a = this.input.axis();
    const span = (v, s) => v > s[0] * T - T / 2 && v < (s[1] + 1) * T + T / 2;
    if (a.x < 0 && e.W && p.x <= 2 && span(p.cy, e.W)) return "W";
    if (a.x > 0 && e.E && p.x + p.w >= w.width - 2 && span(p.cy, e.E)) return "E";
    if (a.y < 0 && e.N && p.y <= 2 && span(p.cx, e.N)) return "N";
    if (a.y > 0 && e.S && p.y + p.h >= w.height - 2 && span(p.cx, e.S)) return "S";
    return null;
  }
  // Called at the darkest point of the fade: move to the neighbouring page and stand at the matching street opening.
  switchPage(dir) {
    const cur = this.page.spec, d = { N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0] }[dir];
    const id = `${cur.gx + d[0]},${cur.gy + d[1]}`;
    if (!WORLD.pages[id]) return;
    const p = this.player, w = this.world, T = CONFIG.TILE, inset = T * 1.2;
    const oldX = p.x, oldY = p.y;
    this.enterPage(id);
    const span = this.village.exits[{ N: "S", S: "N", W: "E", E: "W" }[dir]] || [14, 15];
    const clampTo = (v, size) => Math.min(Math.max(v, span[0] * T + 2), (span[1] + 1) * T - size - 2);
    if (dir === "W") { p.x = w.width - p.w - inset; p.y = clampTo(oldY, p.h); }
    if (dir === "E") { p.x = inset; p.y = clampTo(oldY, p.h); }
    if (dir === "N") { p.y = w.height - p.h - inset; p.x = clampTo(oldX, p.w); }
    if (dir === "S") { p.y = inset; p.x = clampTo(oldX, p.w); }
    this.unstick();
    this.beginPage();
    this.edgeCool = 0.5;
    this.showMessage(this.page.spec.name);
    this.saveGame(true);
  }
  updateWorldMap() {
    const el = document.getElementById("wm-grid");
    if (!el) return;
    if (!el.children.length) for (let i = 0; i < 9; i++) el.appendChild(document.createElement("div"));
    for (let gy = -1; gy <= 1; gy++) for (let gx = -1; gx <= 1; gx++) {
      const id = `${gx},${gy}`, cell = el.children[(gy + 1) * 3 + gx + 1];
      cell.className = (id === this.pageId ? "cur " : "") + (this.visited[id] ? "vis" : "");
      cell.title = this.visited[id] ? WORLD.pages[id].name : "???";
    }
    const n = document.getElementById("wm-name"); if (n) n.textContent = this.page.spec.name;
  }

  // Everything that blocks movement: static village colliders (trees, rocks, water, fences) + solid objects (houses, stations, NPCs, chests).
  getSolids() {
    const live = this.objects.filter((o) => o.solid);
    return this.village ? this.village.solids.concat(live) : live;
  }

  // ---- NPC dialogue: E / Enter / click advances, Esc closes ----
  openDialog(npc) {
    this.closeAllPanels();
    this.uiMode = "dialog";
    this.dlg = { npc, i: 0, lines: npc.getLines ? npc.getLines(this) : npc.lines };
    this.dialogEl.hidden = false;
    this.showDialogLine();
  }
  showDialogLine() {
    const { npc, i, lines } = this.dlg, last = i >= lines.length - 1;
    this.dialogEl.querySelector(".dlg-name").textContent = npc.name;
    this.dialogEl.querySelector(".dlg-text").textContent = lines[i];
    this.dialogEl.querySelector(".dlg-foot").textContent = last ? "E to close" : `E to continue  (${i + 1}/${lines.length})`;
  }
  advanceDialog() {
    if (!this.dlg) return;
    this.dlg.i++;
    if (this.dlg.i >= this.dlg.lines.length) this.closeAllPanels(); else this.showDialogLine();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(window.innerWidth * dpr);
    this.canvas.height = Math.floor(window.innerHeight * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.camera.resize(window.innerWidth, window.innerHeight);
  }

  findNearest() {
    let best = null, bestD = CONFIG.INTERACT_RANGE;
    for (const o of this.objects) {
      if (o.asleep) continue;
      const d = Math.hypot(o.cx - this.player.cx, o.cy - this.player.cy);
      if (d < bestD) { best = o; bestD = d; }
    }
    return best;
  }

  /* ---------- calendar / weather ---------- */
  setDay(i) {
    this.dayIndex = i; this.date = FP.date(i); this.weather = FP.weatherFor(i); this.season = this.date.season; FP.season = this.date.seasonKey;
  }
  dateText() { return `${this.date.seasonName} ${this.date.day}`; }
  get raining() { return this.weather === "rain" || this.weather === "storm"; }
  hourNow() { return this.time; }
  get isNight() { return this.time >= CONFIG.NIGHT_START; }
  // Sleeping is only allowed at night or when you're tired (low energy)
  get canSleep() { return this.isNight || this.energy <= CONFIG.TIRED_ENERGY; }
  notTiredMessage() { this.showMessage("You're not tired yet - you can sleep at night, or when your energy runs low.", 2800); }
  // dusk / dawn: monsters only exist at night, villagers go to bed
  syncNight() {
    const n = this.isNight; WORLD.nightNow = n;
    if (n === this._wasNight) return;
    const first = this._wasNight === undefined; this._wasNight = n;
    for (const pg of Object.values(this.pages)) { pg.populated = false; pg.monsters.list = []; }
    if (n) {
      this.page.populated = true; this.page.monsters.populate(this.player, this.getSolids());
      if (!first) this.showMessage("Night falls - monsters are out! Fight them or sleep in your bed.", 4200);
    }
  }
  // the night ended while you were still up: a new day begins right where you stand
  dawn() {
    this.newDay();
    this.energy = Math.max(this.energy, Math.round(CONFIG.MAX_ENERGY * 0.5));
    this.showMessage(`Dawn breaks - you survived the night. ${this.date.weekday}. ${this.dateText()}`, 4000);
    this.saveGame(true);
  }

  // The night passes: crops grow, trees regrow, fed hens lay, a new season may begin.
  newDay() {
    const d = this.dayIndex + 1, oldSeason = this.season;
    this.setDay(d);
    this.time = CONFIG.DAY_START;
    for (const pg of Object.values(this.pages)) this.pageNight(pg, d);
    for (const pg of Object.values(this.pages)) pg.area.ground.invalidate();
    this.page.area.ground.key = null;
    this.syncNight();
    if (this.season !== oldSeason) this.seasonBanner = { text: `${this.date.seasonName} has begun`, t: 3.2 };
  }
  // Called in the dark at the end of the sleep fade.
  doSleep(passedOut) {
    this.closeAllPanels();
    if (this.pageId !== "0,0") this.enterPage("0,0");
    this.newDay();
    const p = this.player;
    p.hp = p.maxHp; p.dead = false; p.hurtTimer = 0;
    this.energy = passedOut ? Math.round(CONFIG.MAX_ENERGY * 0.6) : CONFIG.MAX_ENERGY;
    p.x = this.spawn.x; p.y = this.spawn.y; this.unstick();
    this.beginPage();
    this.saveGame(true);
    this.showMessage(`${this.date.weekday}. ${this.dateText()} - ${this.weather === "sun" ? "sunny" : this.weather}${passedOut ? " (you passed out last night)" : ""}`);
  }
  sleep(passedOut = false) {
    if (this.fade) return;
    if (!passedOut && !this.canSleep) { this.notTiredMessage(); return; }
    this.closeAllPanels();
    this.fade = { phase: "out", t: 0, sleep: true, pass: passedOut };
  }
  askConfirm(text, yes) {
    this.closeAllPanels();
    this.uiMode = "confirm"; this.confirm = { yes };
    this.confirmEl.hidden = false;
    this.confirmEl.querySelector(".cf-text").textContent = text;
  }
  answerConfirm(ok) {
    const c = this.confirm; this.closeAllPanels();
    if (ok && c) c.yes();
  }
  refillCan() {
    this.water = CONFIG.CAN_MAX; this.showMessage("Watering can refilled");
    this.burst(this.player.cx, this.player.cy, "#63b6e5", 8);
  }
  giveItem(id, qty = 1, x = null, y = null) {
    if (!this.inventory.add(id, qty)) { this.showMessage("Inventory Full"); return false; }
    if (x != null) this.ui.floatText(x, y, `+${qty} ${ITEMS[id].name}`, "#fde6b2");
    this.refreshPanels(); return true;
  }
  removeObject(o) { const i = this.objects.indexOf(o); if (i >= 0) this.objects.splice(i, 1); }
  burst(x, y, color, n = 8) {
    for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, v = 40 + Math.random() * 90; this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, t: 0, life: 0.5 + Math.random() * 0.4, color }); }
  }

  /* ---------- hotbar: the first CONFIG.HOTBAR inventory slots ---------- */
  buildHotbar() {
    this.hotbarEl.innerHTML = ""; this.hbCells = [];
    for (let i = 0; i < CONFIG.HOTBAR; i++) {
      const c = document.createElement("div"); c.className = "hb-slot"; c.dataset.i = i;
      c.innerHTML = `<span class="hb-key">${(i + 1) % 10}</span><span class="inv-icon"></span><span class="inv-qty"></span>`;
      c.addEventListener("click", () => this.selectSlot(i));
      this.hotbarEl.appendChild(c); this.hbCells.push(c);
    }
    this.renderHotbar();
  }
  selectSlot(i) { this.sel = i; this.renderHotbar(); const it = this.inventory.slots[i]; if (it) this.showMessage(this.itemLabel(it.id), 900); }
  // name + stats shown when you pick an item
  itemLabel(id) {
    const w = WEAPONS[id], def = ITEMS[id]; if (!w || def.type !== "weapon") return def.name;
    const am = w.ranged ? `  ·  ${this.inventory.countOf(w.ranged.ammo)} ${ITEMS[w.ranged.ammo].name.toLowerCase()}` : "";
    return `${def.name}  ·  ${w.damage}${w.ranged && w.ranged.pellets ? "x" + w.ranged.pellets : ""} dmg${am}`;
  }
  selectedItem() { const s = this.inventory.slots[this.sel]; return s ? { ...s, def: ITEMS[s.id] } : null; }
  renderHotbar() {
    if (!this.hbCells) return;
    this.hbCells.forEach((c, i) => {
      const s = this.inventory.slots[i], def = s && ITEMS[s.id];
      c.className = "hb-slot" + (i === this.sel ? " sel" : "") + (def ? ` item-${def.css}` : "");
      c.title = def ? this.itemLabel(s.id) : "";
      c.querySelector(".inv-qty").textContent = s && s.qty > 1 ? s.qty : "";
    });
  }

  /* ---------- per-frame update ---------- */
  update(dt) {
    const p = this.player;
    if (p.dead) { // frozen until restart
      if (this.input.wasPressed("r") || this.input.wasPressed("enter")) this.restart();
      return;
    }
    p.tickEat(dt);
    this.edgeCool = Math.max(0, this.edgeCool - dt);
    if (this.seasonBanner) { this.seasonBanner.t -= dt; if (this.seasonBanner.t <= 0) this.seasonBanner = null; }
    if (this.fade) { // walking between pages / going to bed: fade out, swap in the dark, fade back in
      const f = this.fade; f.t += dt;
      if (f.phase === "out") {
        if (f.t < (f.sleep ? 0.7 : CONFIG.PAGE_FADE_OUT)) return; // world is frozen while the screen darkens
        if (f.sleep) this.doSleep(f.pass); else if (f.door) this.passDoor(f.door); else this.switchPage(f.dir);
        f.phase = "in"; f.t = 0;
      } else if (f.t >= (f.sleep ? 0.8 : CONFIG.PAGE_FADE_IN)) this.fade = null;
    }
    for (let i = 1; i <= 9; i++) if (this.input.wasPressed(String(i))) this.selectSlot(i - 1);
    if (this.input.wasPressed("0")) this.selectSlot(9);
    if (this.input.wasPressed("i")) this.toggleInventory();
    if (this.input.wasPressed("c")) this.toggleCooking();
    if (this.input.wasPressed("t")) this.toggleTravel();
    if (this.input.wasPressed("q")) this.dropSelected();
    if (this.uiMode) { // any open panel freezes the world, like the game-over screen
      if (this.input.wasPressed("escape")) this.closeAllPanels();
      else if (this.uiMode === "dialog" && (this.input.wasPressed("e") || this.input.wasPressed("enter"))) this.advanceDialog();
      else if (this.uiMode === "confirm") { if (this.input.wasPressed("y") || this.input.wasPressed("enter") || this.input.wasPressed("e")) this.answerConfirm(true); else if (this.input.wasPressed("n")) this.answerConfirm(false); }
      return;
    }
    // the clock runs while you play (menus pause it): 5 real minutes of day, then 4 of night
    if (!this.fade) {
      const hs = this.time < CONFIG.NIGHT_START ? CONFIG.DAY_SECONDS / (CONFIG.NIGHT_START - CONFIG.DAY_START) : CONFIG.NIGHT_SECONDS / (CONFIG.DAY_END - CONFIG.NIGHT_START);
      this.time += dt / hs;
      if (this.time >= CONFIG.DAY_END) this.dawn();
    }
    this.syncNight();
    this.farmClock = (this.farmClock || 0) + dt;
    if (this.farmClock >= 1) { this.farmClock = 0; this.farm.expire(FP.absTime()); }
    if (this.inside) { this.updateInside(dt); return; }
    const solids = this.getSolids();
    p.hurtTimer = Math.max(0, p.hurtTimer - dt);
    p.attackTimer = Math.max(0, p.attackTimer - dt);
    p.update(dt, this.input, this.world, solids);
    const exitDir = this.edgeExit();
    if (exitDir) this.fade = { phase: "out", t: 0, dir: exitDir };
    for (const o of this.objects) if (o.update) o.update(dt, this, solids); // villagers wander, hens peck
    this.village.updateTrees(dt);
    this.camera.follow(p, this.world, dt);

    // Space (hold) uses the selected item on the tile in front of you
    if (this.input.down.has(" ")) this.useSelected();
    if (this.input.wasPressed("f")) this.useSelected("hoe");
    this.monsters.update(dt, p, solids);
    this.updateProjectiles(dt, solids);
    if (p.hurtTimer <= 0) {
      const hitter = this.monsters.list.find((m) => m.overlaps(p));
      if (hitter) this.damagePlayer(hitter);
    }
    this.nearest = this.findNearest();
    this.tile = this.targetTile();
    if (this.input.wasPressed("e")) {
      if (this.nearest) this.nearest.onInteract(this); // objects take priority
      else this.useTile();
    }
    for (const pt of this.particles) { pt.t += dt; pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.vy += 260 * dt; }
    this.particles = this.particles.filter((pt) => pt.t < pt.life);
    for (const d of this.deaths) d.t += dt;
    this.deaths = this.deaths.filter((d) => d.t < 0.85);

    FP.season = this.date.seasonKey;
    this.ui.setHealth(p.hp, p.maxHp);
    this.ui.setEnergy(this.energy, CONFIG.MAX_ENERGY);
    this.ui.setClock(this.time, this.date, this.weather);
    this.ui.setStats(this.coins);
    this.ui.setCoords(p);
    const it = this.selectedItem();
    this.ui.setCan(!!it && it.def.tool === "can", this.water, CONFIG.CAN_MAX);
    this.ui.setHint(this.nearest ? `Press E — ${this.nearest.prompt}` : this.tileHint());
  }

  /* ---------- tools: Space / click uses the selected hotbar item ---------- */
  DIRV() { return { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[this.player.dirKey]; }
  // the tile in front of the player (where hoe, can and seeds work)
  targetTile() {
    const p = this.player, [dx, dy] = this.DIRV(), T = CONFIG.TILE;
    return { tx: Math.floor((p.cx + dx * 34) / T), ty: Math.floor((p.cy + dy * 34) / T) };
  }
  tileHint() {
    const { tx, ty } = this.tile, f = this.farm;
    if (!f.inside(tx, ty)) return "";
    if (f.isRipe(tx, ty)) return "Press E — harvest";
    if (f.isDead(tx, ty)) return "Press E — clear withered plant";
    const left = f.hoursLeft(tx, ty);
    if (left != null) return `Empty soil - plant before it reverts (${Math.ceil(left)} h left)`;
    return "";
  }
  spend(n) {
    if (this.energy < n) { this.showMessage("You're too tired — eat something or go to bed"); return false; }
    this.energy -= n; return true;
  }
  useSelected(force) {
    const p = this.player;
    if (p.dead || p.attackTimer > 0 || this.uiMode || this.fade) return;
    const it = this.selectedItem();
    const tool = force || (it ? (it.def.tool || it.def.type) : null);
    const { tx, ty } = this.targetTile(), T = CONFIG.TILE, farm = this.farm;
    const swing = (icon, mode) => { p.attackTimer = 0.4; p.attackDur = 0.4; p.noSwing = false; p.swingMode = mode; this.swing = { icon, mode, ang: Math.atan2(p.face.y, p.face.x), w: {} }; };
    if (!it && !force) return;
    p.wClip = null; // a tool / seed / food use never plays a weapon clip (attack() / fire() set it for weapons)
    if (tool === "hoe") {
      swing("hoe", "dig");
      if (!this.spend(2)) return;
      if (farm.isDead(tx, ty)) { farm.clearDead(tx, ty); this.tilePopup("Cleared"); return; }
      if (!farm.inside(tx, ty) || this.tileBlocked({ tx, ty }) || farm.hasSoil(tx, ty)) { this.energy += 2; if (!farm.hasSoil(tx, ty)) this.showMessage("Can't dig here", 700); return; }
      farm.till(tx, ty); this.burst((tx + 0.5) * T, (ty + 0.7) * T, "#c48458", 7); this.tilePopup("Tilled");
    } else if (tool === "can") {
      swing("can", "pour");
      if (farm.hasSoil(tx, ty)) {
        if (this.water <= 0) { this.showMessage("The can is empty — fill it at the well or water"); return; }
        if (!this.spend(1)) return;
        if (farm.water(tx, ty)) { this.water--; this.burst((tx + 0.5) * T, (ty + 0.5) * T, "#63b6e5", 8); }
      } else if (this.village.nearWater(tx, ty)) this.refillCan();
      else if (this.village.nearWater(Math.floor(p.cx / T), Math.floor(p.cy / T))) this.refillCan();
      else this.showMessage("Water crops on tilled soil. Refill at the well or a pond.", 1400);
    } else if (tool === "axe") {
      swing("axe", "chop");
      if (!this.spend(3)) return;
      const reach = new Entity(p.cx + this.DIRV()[0] * 34 - 26, p.cy + this.DIRV()[1] * 34 - 26, 52, 52);
      const tree = this.village.treeAt(reach);
      if (tree) this.chopTree(tree, 1);
      else if (!this.hitMonsters(WEAPONS.axe)) this.breakScenery(reach, 1);   // no monster in the way: whatever scenery is in front breaks instead
    } else if (tool === "weapon") {
      this.weapon = WEAPONS[it.id] || WEAPONS.stick; this.weaponId = it.id; this.attack(null);
    } else if (tool === "seed") {
      const def = CROPS[it.def.crop], id = CROP_IDS.indexOf(it.def.crop);
      p.attackTimer = 0.4; p.attackDur = 0.4; p.noSwing = false; p.swingMode = "dig"; // same gentle plunge-and-lift as the hoe
      if (!farm.inside(tx, ty) || !farm.hasSoil(tx, ty)) { this.showMessage("Plant seeds on tilled soil", 900); return; }
      if (farm.cropAt(tx, ty)) return;
      if (!def.seasons.includes(this.date.seasonKey)) { this.showMessage(`${def.name} won't grow in ${this.date.seasonName.toLowerCase()}`, 1400); return; }
      farm.plant(tx, ty, id); this.inventory.removeAt(this.sel, 1); this.refreshPanels();
      this.burst((tx + 0.5) * T, (ty + 0.6) * T, "#f7de7b", 6); this.tilePopup("Planted");
    } else if (tool === "food") {
      if (this.eatItem(this.sel)) { p.attackTimer = 0.4; p.attackDur = 0.4; p.noSwing = true; }
    }
  }
  // E: harvest the ripe crop in front of you (or under your feet)
  useTile() {
    const farm = this.farm, T = CONFIG.TILE, p = this.player;
    for (const t of [this.tile, { tx: Math.floor(p.cx / T), ty: Math.floor(p.cy / T) }]) {
      if (farm.isDead(t.tx, t.ty)) { farm.clearDead(t.tx, t.ty); this.tilePopup("Cleared", t); return; }
      if (!farm.isRipe(t.tx, t.ty)) continue;
      if (this.harvestAt(farm, t.tx, t.ty)) return;
    }
  }
  // Seeds handed back with a harvest: a whole number in the crop's seedYield range (default CONFIG.SEED_YIELD).
  rollSeeds(def, rand = Math.random) {
    const [lo, hi] = def.seedYield || CONFIG.SEED_YIELD;
    return lo + Math.floor(rand() * (hi - lo + 1));
  }
  // The one place a crop is harvested. All-or-nothing: if the bag can't hold the produce AND the seeds, nothing
  // changes; the tile is only emptied when the rewards are given, and a tile that is no longer ripe gives nothing,
  // so a harvest can never pay out twice.
  harvestAt(farm, tx, ty, inv = this.inventory, rand = Math.random) {
    if (!farm.isRipe(tx, ty)) return null;
    const def = CROPS[CROP_IDS[farm.cropAt(tx, ty)]], seeds = this.rollSeeds(def, rand);
    if (!inv.canAddAll([[def.item, 1], [def.seed, seeds]])) { this.showMessage("Inventory Full"); return null; }
    if (!farm.harvest(tx, ty)) return null;
    inv.add(def.item, 1); inv.add(def.seed, seeds);
    this.crops++;
    const T = CONFIG.TILE;
    this.ui.floatText((tx + 0.5) * T, ty * T, `+1 ${ITEMS[def.item].name}  +${seeds} ${ITEMS[def.seed].name}`, "#fde6b2");
    this.burst((tx + 0.5) * T, (ty + 0.4) * T, "#f4bf57", 8);
    this.refreshPanels();
    return { item: def.item, seed: def.seed, seeds };
  }
  tilePopup(text, tile = this.tile) {
    const T = CONFIG.TILE;
    this.ui.popup({ cx: (tile.tx + 0.5) * T, y: tile.ty * T }, text);
  }
  // True if this tile can't be dug: not plain grass, or something solid stands on it.
  tileBlocked({ tx, ty }) {
    const T = CONFIG.TILE;
    const rect = { x: tx * T, y: ty * T, w: T, h: T };
    if (this.village && !this.village.farmable(tx, ty)) return true;
    return this.objects.some((o) => o.solid && o.overlaps(rect));
  }

  // Swing a weapon (or the axe) at a rectangle in front of the player.
  meleeRect(w) {
    const p = this.player, cx = p.cx + p.face.x * w.reach, cy = p.cy + p.face.y * w.reach;
    return new Entity(cx - w.size / 2, cy - w.size / 2, w.size, w.size);
  }
  // returns how many monsters the swing hit
  hitMonsters(w) {
    const p = this.player, rect = this.meleeRect(w);
    this.slash = { rect, until: performance.now() + 150 };
    let n = 0;
    for (const m of this.monsters.list) {
      if (m.dead || !m.overlaps(rect)) continue;
      this.damageMonster(m, w.damage, w.knockback || 200, p.cx, p.cy);
      n++;
    }
    return n;
  }

  /* ---------- breaking scenery ---------- */
  // A swing that found no monster lands on whatever is in front of the player: a tree, a rock, a crate, a bush,
  // a fence, a flower... Returns true if it hit something. What each thing drops is set in matFor() (fpworld.js).
  breakScenery(rect, dmg) {
    const area = this.village, cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
    const tree = area.treeAt(rect), prop = area.propAt(rect);
    const dist = (x, y) => Math.hypot(x - cx, y - cy);
    if (tree && (!prop || dist(tree.cx0, tree.baseY) <= dist(prop.cx0, prop.baseY - prop.h / 2))) { this.chopTree(tree, dmg); return true; }
    if (prop) { this.smashProp(prop, dmg); return true; }
    const fl = area.flowerAt(rect);
    if (fl) {
      area.pickFlower(fl);
      this.burst(fl.x, fl.y - 8, "#f08fb4", 6);
      this.giveOrDrop("flower", 1, fl.x, fl.y - 30, fl.x, fl.y);
      return true;
    }
    return false;
  }
  chopTree(tree, dmg) {
    const res = tree.hit(dmg, this.player.cx);
    this.burst(tree.cx0, tree.baseY - 40, "#bf6a4d", 5);
    if (res && res.wood) { this.giveOrDrop("wood", res.wood, tree.cx0, tree.baseY - 90, tree.cx0, tree.baseY); if (res.felled) this.showMessage(`Timber! +${res.wood} wood`, 900); }
  }
  smashProp(prop, dmg) {
    const res = this.village.hitProp(prop, dmg, this.player.cx), fx = prop.brk.fx || "#cfc6a8";
    this.burst(prop.cx0, prop.baseY - Math.max(10, prop.h), fx, res.broken ? 10 : 4);
    res.drops.forEach(([id, qty], i) => this.giveOrDrop(id, qty, prop.cx0, prop.baseY - 50 - i * 18, prop.cx0, prop.baseY));
  }
  // Like giveItem, but a full bag never loses the material: it drops on the ground by (gx, gy) to be picked up with E.
  giveOrDrop(id, qty, x, y, gx = x, gy = y + 40) {
    if (this.inventory.add(id, qty)) { this.ui.floatText(x, y, `+${qty} ${ITEMS[id].name}`, "#fde6b2"); this.refreshPanels(); return true; }
    this.objects.push(new DroppedItem({ x: gx - 10 + (Math.random() - 0.5) * 36, y: gy - 4 + Math.random() * 14, id, qty }));
    this.showMessage("Bag full - it dropped on the ground", 1400);
    return false;
  }
  // One place where a monster takes damage (melee swings and projectiles both use it)
  damageMonster(m, dmg, knockback, fromX, fromY) {
    m.hp -= dmg; m.flash = 0.12;
    const d = Math.hypot(m.cx - fromX, m.cy - fromY) || 1;
    m.kx = ((m.cx - fromX) / d) * knockback; m.ky = ((m.cy - fromY) / d) * knockback;
    this.ui.floatText(m.cx, m.y, `-${dmg}`, "#ffffff");
    if (m.hp <= 0 && !m.dead) {
      m.dead = true;
      this.deaths.push({ x: m.cx, y: m.y + m.h, t: 0, big: m.type === "big", dir: m.dirBucket === "side" ? (m.mirror ? "right" : "left") : m.dirBucket });
      this.coins += m.def.reward;
      this.ui.floatText(m.cx, m.y - 20, `+${m.def.reward} coins`, "#f2c94c");
    }
  }
  attack(dir) {
    const p = this.player, w = this.weapon;
    if (p.dead || p.attackTimer > 0) return;
    if (dir) p.face = dir;
    if (w.ranged) { this.fire(w); return; }
    p.attackTimer = w.cooldown; p.attackDur = w.cooldown; p.noSwing = false;
    p.swingMode = w.swing || "slash"; // "thrust" (dagger/spear), "chop" (war axe), else a plain slash
    if (!this.spend(w.energy != null ? w.energy : 1)) { p.attackTimer = 0; return; }
    if (!this.hitMonsters(w)) this.breakScenery(this.meleeRect(w), PROP_DMG[this.weaponId] || 1);
    this.swing = { w, ang: Math.atan2(p.face.y, p.face.x) };
    if (p.startWeaponAnim(this.weaponId)) this.swing = null; // the weapon is already in the character art
  }
  // Ranged weapons: spend one ammo item per shot and launch projectile(s) along the aim direction (mouse / last move)
  fire(w) {
    const p = this.player, r = w.ranged, ammo = r.ammo;
    if (this.inventory.countOf(ammo) < 1) { p.attackTimer = 0.3; p.attackDur = 0.3; p.noSwing = true; this.showMessage(`Out of ${ITEMS[ammo].name.toLowerCase()} - buy more at the Armory`, 1400); return; }
    this.inventory.removeById(ammo, 1); this.refreshPanels();
    p.attackTimer = w.cooldown; p.attackDur = w.cooldown; p.noSwing = true;
    const baked = p.startWeaponAnim(this.weaponId); // clip with the weapon (and its flash) drawn in
    const base = Math.atan2(p.face.y, p.face.x), n = r.pellets || 1;
    for (let k = 0; k < n; k++) {
      const a = base + (n > 1 ? (k / (n - 1) - 0.5) * r.spread + (Math.random() - 0.5) * 0.08 : (Math.random() - 0.5) * (r.jitter || 0));
      this.projectiles.push({ x: p.cx + Math.cos(a) * 22, y: p.cy - 6 + Math.sin(a) * 22, vx: Math.cos(a) * r.speed, vy: Math.sin(a) * r.speed, a, dmg: w.damage, kind: r.kind,
        left: r.range, pierce: r.pierce || 0, hit: new Set(), kb: r.kind === "pellet" ? 140 : 260, grace: 26, fromX: p.cx, fromY: p.cy });
    }
    const gun = r.kind === "bullet" || r.kind === "pellet";
    if (gun && !baked) { this.burst(p.cx + Math.cos(base) * 30, p.cy - 6 + Math.sin(base) * 30, "#ffd966", 5); this.muzzle = { x: p.cx + Math.cos(base) * 30, y: p.cy - 6 + Math.sin(base) * 30, until: performance.now() + 70 }; }
    this.swing = baked ? null : { w, ang: base, ranged: true };
  }
  updateProjectiles(dt, solids) {
    for (const pr of this.projectiles) {
      let step = Math.hypot(pr.vx, pr.vy) * dt;
      while (step > 0 && !pr.dead) { // move in small steps so fast bullets can't skip through things
        const s = Math.min(step, 14); step -= s;
        pr.x += (pr.vx / Math.hypot(pr.vx, pr.vy)) * s; pr.y += (pr.vy / Math.hypot(pr.vx, pr.vy)) * s; pr.left -= s; pr.grace -= s;
        if (pr.left <= 0) { pr.dead = true; break; }
        if (pr.grace <= 0 && solids.some((o) => pr.x > o.x && pr.x < o.x + o.w && pr.y > o.y && pr.y < o.y + o.h)) { pr.dead = true; this.burst(pr.x, pr.y, "#cfc6a8", 3); break; }
        for (const m of this.monsters.list) {
          if (m.dead || pr.hit.has(m) || Math.abs(pr.x - m.cx) > m.w / 2 + 4 || Math.abs(pr.y - m.cy) > m.h / 2 + 4) continue;
          pr.hit.add(m); this.damageMonster(m, pr.dmg, pr.kb, pr.fromX, pr.fromY);
          this.burst(pr.x, pr.y, "#ff9d8a", 4);
          if (pr.pierce-- <= 0) { pr.dead = true; break; }
        }
      }
    }
    this.projectiles = this.projectiles.filter((pr) => !pr.dead);
  }
  drawProjectiles(ctx, cam) {
    for (const pr of this.projectiles) {
      const x = pr.x - cam.x, y = pr.y - cam.y;
      ctx.save(); ctx.translate(x, y); ctx.rotate(pr.a); ctx.lineCap = "round";
      if (pr.kind === "arrow" || pr.kind === "bolt") {
        const L = pr.kind === "arrow" ? 30 : 24, th = pr.kind === "arrow" ? 3 : 4;
        ctx.strokeStyle = "#2b1d14"; ctx.lineWidth = th + 2; ctx.beginPath(); ctx.moveTo(-L, 0); ctx.lineTo(0, 0); ctx.stroke();
        ctx.strokeStyle = pr.kind === "arrow" ? "#b9824b" : "#5a3a22"; ctx.lineWidth = th; ctx.beginPath(); ctx.moveTo(-L, 0); ctx.lineTo(0, 0); ctx.stroke();
        ctx.fillStyle = "#e9eef5"; ctx.strokeStyle = "#2b1d14"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-2, -5); ctx.lineTo(-2, 5); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = pr.kind === "arrow" ? "#f6f1e6" : "#8a8f9c"; ctx.beginPath(); ctx.moveTo(-L, 0); ctx.lineTo(-L - 7, -5); ctx.lineTo(-L + 3, 0); ctx.lineTo(-L - 7, 5); ctx.closePath(); ctx.fill();
      } else if (pr.kind === "bullet") {
        const g = ctx.createLinearGradient(-26, 0, 0, 0); g.addColorStop(0, "rgba(255,210,100,0)"); g.addColorStop(1, "rgba(255,230,140,.9)");
        ctx.strokeStyle = g; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-26, 0); ctx.lineTo(0, 0); ctx.stroke();
        ctx.fillStyle = "#fff6c2"; ctx.beginPath(); ctx.ellipse(0, 0, 6, 3.5, 0, 0, 6.3); ctx.fill();
      } else {
        ctx.fillStyle = "rgba(255,200,90,.35)"; ctx.fillRect(-12, -2, 12, 4);
        ctx.fillStyle = "#ffdf8a"; ctx.beginPath(); ctx.arc(0, 0, 4, 0, 6.3); ctx.fill();
      }
      ctx.restore();
    }
    if (this.muzzle && this.muzzle.until > performance.now()) { // muzzle flash
      const m = this.muzzle; ctx.save(); ctx.globalCompositeOperation = "lighter"; const g = ctx.createRadialGradient(m.x - cam.x, m.y - cam.y, 2, m.x - cam.x, m.y - cam.y, 34);
      g.addColorStop(0, "rgba(255,230,150,.95)"); g.addColorStop(1, "rgba(255,150,40,0)"); ctx.fillStyle = g; ctx.fillRect(m.x - cam.x - 34, m.y - cam.y - 34, 68, 68); ctx.restore();
    }
  }
  // the weapon icon sweeping through a melee swing (or kicking back after a shot), drawn over the player
  // A faint stroked arc "swoosh" behind a chop or slash while it's actually cutting through the
  // air (the strike phase only — not during the windup or the follow-through), to sell the weight
  // of the swing. Cheap: one arc stroke, skipped entirely outside that window.
  drawSwoosh(ctx, cam, p, mode, t, pose, ang, radius) {
    if (mode !== "chop" && mode !== "slash") return;
    if (t < pose.windupEnd || t > pose.strikeEnd) return;
    const e = (t - pose.windupEnd) / Math.max(0.001, pose.strikeEnd - pose.windupEnd);
    ctx.save();
    ctx.globalAlpha = 0.3 * (1 - e * 0.6);
    ctx.strokeStyle = "#f3ecc8";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(p.cx - cam.x, p.cy - 4 - cam.y, radius, ang - 1.0 + e * 0.3, ang + 0.5 + e * 0.3);
    ctx.stroke();
    ctx.restore();
  }
  // Where the tool/weapon hand sits on screen for the player's current pose — the pivot every
  // mid-swing held-item draw is anchored to. 0.4 * sprite-height put this down around hip/crotch
  // height (legs take up roughly half the 96px sprite); a gripping hand sits more like 58% of the
  // way up from the feet, so this uses that instead, nudged to whichever side the body is facing
  // (a little extra for left/right, a touch for a natural one-handed grip even facing the camera).
  handAnchor(p, cam) {
    const footX = p.cx - cam.x, footY = p.y + p.h - cam.y;
    const sideways = p.dirKey === "left" || p.dirKey === "right";
    const side = p.dirKey === "left" ? -1 : 1;
    return { hx: footX + (sideways ? side * 9 : 6), hy: footY - CONFIG.SPRITE_H.player * 0.58 };
  }
  // Draws `im` rotated by `rot` around its own grip point (gx,gy — normalized 0..1 within the icon,
  // see ITEM_POSE/RANGED_GRIP), offset (ox,oy) from the hand anchor (hx,hy). Pivoting on the actual
  // grip, instead of the icon's center, is what makes a swing read as the hand carrying the tool
  // through an arc instead of the icon spinning in place like a flipped coin near the body.
  drawGripped(ctx, im, size, grip, hx, hy, ox, oy, rot, alpha) {
    ctx.save(); ctx.translate(hx + ox, hy + oy); ctx.rotate(rot); ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = alpha; ctx.drawImage(im, -grip.gx * size, -grip.gy * size, size, size); ctx.restore();
  }
  drawSwing(ctx, cam) {
    const s = this.swing; if (!s) return;
    const p = this.player;
    // Both branches below ride the player's own (dt-clamped, pause-aware) attack clock — the same
    // one that drives the body/hand pose in pickAnimFrame() — so the held icon can never drift out
    // of step with the swing it's layered over, finish early, or "drop" out mid-animation. Each
    // tool/weapon's actual motion comes from swingPose(), shared with the body lean (toolLunge), so
    // the two always read as one connected movement instead of two animations glued together.
    if (p.attackTimer <= 0) { this.swing = null; return; }
    const t = Math.min(0.999, Math.max(0, 1 - p.attackTimer / (p.attackDur || 0.4)));
    const { hx, hy } = this.handAnchor(p, cam);
    if (s.icon) { // farming tools: axe chop / hoe dig / can pour, drawn in all four directions
      const im = weaponIcon(s.icon);
      if (!im || !im.complete || !im.naturalWidth) return;
      const pose = swingPose(s.mode, t, s.ang, 1), grip = ITEM_POSE[s.mode] || ITEM_POSE.slash;
      this.drawSwoosh(ctx, cam, p, s.mode, t, pose, s.ang, 26);
      this.drawGripped(ctx, im, 44, grip, hx, hy, pose.ox, pose.oy, pose.rot, pose.alpha);
      if (s.mode === "pour" && t > (TOOL_FEEL.pour.windup || 0.28)) {
        const dx = Math.cos(s.ang), dy = Math.sin(s.ang);
        ctx.fillStyle = "rgba(120,190,240,.8)";
        for (let k = 0; k < 4; k++) ctx.fillRect(hx + dx * 32 + (k - 1.5) * 4, hy + dy * 32 + ((t * 60 + k * 9) % 18) - 6, 3, 6);
      }
      return;
    }
    const id = Object.keys(ITEMS).find((k) => WEAPONS[k] === s.w && ITEMS[k].type === "weapon"), im = id && weaponIcon(ITEMS[id].css);
    if (!im || !im.complete || !im.naturalWidth) return;
    if (s.ranged) { // bow / crossbow / pistol / shotgun recoil kick (only drawn when there's no baked video clip)
      const grip = RANGED_GRIP[id] || { gx: 0.4, gy: 0.5, rest: 0 };
      const off = 14 - Math.sin(t * Math.PI) * 5;
      this.drawGripped(ctx, im, 34, grip, hx, hy, Math.cos(s.ang) * off, Math.sin(s.ang) * off, s.ang - grip.rest, 1 - Math.max(0, t - 0.7) / 0.3);
      return;
    }
    // Melee weapon: chop (war axe), thrust (dagger / spear) or slash (stick / sword / steel sword),
    // each with its own kinematics from swingPose — only the reach differs weapon to weapon.
    const reach = Math.min(1.8, Math.max(0.7, (s.w.reach || 40) / 44));
    const pose = swingPose(p.swingMode, t, s.ang, reach), grip = ITEM_POSE[p.swingMode] || ITEM_POSE.slash;
    this.drawSwoosh(ctx, cam, p, p.swingMode, t, pose, s.ang, 30 * reach);
    const size = 36 + 12 * reach;
    this.drawGripped(ctx, im, size, grip, hx, hy, pose.ox, pose.oy, pose.rot, pose.alpha);
  }
  damagePlayer(monster) {
    const p = this.player, dmg = monster.def.damage;
    p.hp = Math.max(0, p.hp - dmg);
    p.hurtTimer = CONFIG.HURT_INVULN;
    this.ui.floatText(p.cx, p.y, `-${dmg} HP`, "#ff6b6b");
    if (p.hp <= 0) { p.dead = true; this.gameOverEl.hidden = false; }
  }

  // Keeps farm and coins; resets health, position and monsters (you wake up at home).
  restart() {
    const p = this.player;
    if (this.pageId !== "0,0") this.enterPage("0,0");
    this.fade = null;
    p.x = this.spawn.x; p.y = this.spawn.y;
    p.hp = p.maxHp; p.dead = false; p.hurtTimer = 1.5; p.attackTimer = 0;
    this.energy = Math.max(this.energy, 40);
    if (this.isNight) this.newDay();   // you collapsed: you come round at dawn
    this.gameOverEl.hidden = true;
    this.camera.follow(p, this.world, 0, true);
  }
  refreshPanels() {
    this.renderHotbar();
    this.invGrid.render();
    this.coinsLabelEl.textContent = `Coins: ${this.coins}`;
    if (this.openChest) {
      this.chestGrid.render();
      this.chestCoinsLabelEl.textContent = this.openChest.name;
    }
  }
  showMessage(text, ms = 1900) {
    clearTimeout(this._toastTimer);
    this.toastEl.textContent = text;
    this.toastEl.classList.add("show");
    this._toastTimer = setTimeout(() => this.toastEl.classList.remove("show"), ms);
  }

  // ---- Panel switching: only one of inventory-alone / chest+inventory /
  // cooking is ever shown at a time. ----
  closeAllPanels() {
    this.overlayEl.hidden = true;
    this.invBoxEl.hidden = this.chestBoxEl.hidden = this.cookBoxEl.hidden = true;
    this.shopBoxEl.hidden = this.travelBoxEl.hidden = true;
    if (this.dialogEl) this.dialogEl.hidden = true;
    if (this.confirmEl) this.confirmEl.hidden = true;
    this.confirm = null;
    this.dlg = null;
    this.uiMode = null;
    this.openChest = null;
  }
  toggleInventory() {
    if (this.uiMode === "inventory") { this.closeAllPanels(); return; }
    this.closeAllPanels();
    this.uiMode = "inventory";
    this.overlayEl.hidden = false;
    this.invBoxEl.hidden = false;
    this.refreshPanels();
  }
  openChestUI(chest) {
    this.closeAllPanels();
    this.uiMode = "chest";
    this.openChest = chest;
    this.overlayEl.hidden = false;
    this.invBoxEl.hidden = false;
    this.chestBoxEl.hidden = false;
    this.refreshPanels();
  }
  toggleCooking() {
    if (this.uiMode === "cook") { this.closeAllPanels(); return; }
    this.closeAllPanels();
    this.uiMode = "cook";
    this.overlayEl.hidden = false;
    this.cookBoxEl.hidden = false;
    this.renderCooking();
  }
  openShopUI(cat = "general") {
    this.closeAllPanels(); this.shopCat = cat;
    this.uiMode = "shop";
    this.overlayEl.hidden = false;
    this.shopBoxEl.hidden = false;
    this.renderShop();
  }
  toggleTravel() {
    if (this.uiMode === "travel") { this.closeAllPanels(); return; }
    this.closeAllPanels();
    this.uiMode = "travel";
    this.overlayEl.hidden = false;
    this.travelBoxEl.hidden = false;
    this.renderTravel();
  }

  // ---- Drag-and-drop + click-to-transfer + right-click-to-eat, delegated
  // from the two grid containers so player and chest slots share one path. ----
  invOf(owner) { return owner === "player" ? this.inventory : (this.openChest && this.openChest.inv); }

  setupInventoryDnD() {
    const onMove = (e) => {
      const d = this.drag;
      if (!d) return;
      if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 6) {
        d.moved = true;
        d.ghost = document.createElement("div");
        d.ghost.className = `drag-ghost item-${ITEMS[d.item.id].css}`;
        d.ghost.innerHTML = `<span class="inv-icon"></span>`;
        document.body.appendChild(d.ghost);
        d.cell.classList.add("dragging");
      }
      if (d.ghost) { d.ghost.style.left = `${e.clientX}px`; d.ghost.style.top = `${e.clientY}px`; }
      document.querySelectorAll(".inv-slot.drag-over").forEach((el) => el.classList.remove("drag-over"));
      const hover = document.elementFromPoint(e.clientX, e.clientY)?.closest(".inv-slot");
      if (hover && hover !== d.cell) hover.classList.add("drag-over");
    };
    const onUp = (e) => {
      document.removeEventListener("pointermove", onMove);
      document.querySelectorAll(".inv-slot.drag-over").forEach((el) => el.classList.remove("drag-over"));
      const d = this.drag; this.drag = null;
      if (!d) return;
      d.cell.classList.remove("dragging");
      if (d.ghost) d.ghost.remove();
      if (!d.moved) {
        this.quickTransfer(d.owner, d.index); // a click (no real drag) = quick transfer
      } else {
        const drop = document.elementFromPoint(e.clientX, e.clientY)?.closest(".inv-slot");
        if (drop) this.dropItem(d.owner, d.index, drop.dataset.owner, +drop.dataset.index);
        else this.dropToGround(d.owner, d.index); // dragged out past every slot = drop it on the ground
      }
      this.refreshPanels();
    };
    const onDown = (e) => {
      const cell = e.target.closest(".inv-slot.filled");
      if (!cell) return;
      const owner = cell.dataset.owner, index = +cell.dataset.index;
      const item = this.invOf(owner)?.slots[index];
      if (!item) return;
      e.preventDefault();
      this.drag = { owner, index, item, cell, startX: e.clientX, startY: e.clientY, moved: false, ghost: null };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp, { once: true });
    };
    const onContextMenu = (e) => {
      const cell = e.target.closest(".inv-slot.filled");
      if (!cell) return;
      e.preventDefault();
      if (cell.dataset.owner === "player") this.eatItem(+cell.dataset.index);
    };
    for (const grid of [this.invGrid.el, this.chestGrid.el]) {
      grid.addEventListener("pointerdown", onDown);
      grid.addEventListener("contextmenu", onContextMenu);
    }
  }

  // Drag-release onto a slot: merge if it's the same item, otherwise swap
  // (swapping works across player <-> chest too, since both are Inventory).
  dropItem(fromOwner, fromIdx, toOwner, toIdx) {
    const fromInv = this.invOf(fromOwner), toInv = this.invOf(toOwner);
    if (!fromInv || !toInv || (fromOwner === toOwner && fromIdx === toIdx)) return;
    const fromItem = fromInv.slots[fromIdx], toItem = toInv.slots[toIdx];
    if (!fromItem) return;
    if (toItem && toItem.id === fromItem.id) {
      toItem.qty += fromItem.qty;
      fromInv.slots[fromIdx] = null;
    } else {
      toInv.slots[toIdx] = fromItem;
      fromInv.slots[fromIdx] = toItem || null;
    }
  }
  // Drops a whole stack out of either inventory and onto the ground in front of the player, as a
  // DroppedItem anyone (including the player, later) can walk up and press E on to pick back up.
  dropToGround(owner, index) {
    const inv = this.invOf(owner);
    const item = inv && inv.slots[index];
    if (!item) return;
    const p = this.player, [dx, dy] = this.DIRV();
    this.objects.push(new DroppedItem({ x: p.cx + dx * 30 - 10, y: p.cy + dy * 30 - 6, id: item.id, qty: item.qty }));
    inv.slots[index] = null;
    this.showMessage(`Dropped ${ITEMS[item.id].name}`, 700);
    this.refreshPanels();
  }
  // Q: drop whatever's on the selected hotbar slot without opening the backpack at all.
  dropSelected() {
    if (this.uiMode || this.fade || this.inside || !this.inventory.slots[this.sel]) return;
    this.dropToGround("player", this.sel);
  }
  // Plain click (no drag): only meaningful with the chest panel open — sends
  // the whole stack to the other inventory, stacking or taking an empty slot.
  quickTransfer(owner, index) {
    if (!this.openChest) return;
    const fromInv = this.invOf(owner);
    const toInv = owner === "player" ? this.openChest.inv : this.inventory;
    const item = fromInv.slots[index];
    if (!item) return;
    for (const s of toInv.slots) if (s && s.id === item.id) { s.qty += item.qty; fromInv.slots[index] = null; return; }
    const empty = toInv.firstEmptyIndex();
    if (empty === -1) { this.showMessage("Inventory Full"); return; }
    toInv.slots[empty] = item;
    fromInv.slots[index] = null;
  }
  eatItem(index) {
    const item = this.inventory.slots[index];
    if (!item) return false;
    const def = ITEMS[item.id];
    if (def.type !== "food") { this.showMessage(`${def.name} isn't edible`); return false; }
    this.inventory.removeAt(index, 1);
    const p = this.player;
    p.hp = Math.min(p.maxHp, p.hp + def.heal);
    this.energy = Math.min(CONFIG.MAX_ENERGY, this.energy + (def.energy || 0));
    this.ui.setHealth(p.hp, p.maxHp);
    this.ui.floatText(p.cx, p.y, `+${def.energy || 0} energy`, "#8fe36a");
    p.startEating();
    this.refreshPanels();
    return true;
  }

  // ---- Cooking ----
  renderCooking() {
    const list = document.getElementById("cook-list");
    list.innerHTML = "";
    for (const r of RECIPES) {
      const [needId, needQty] = Object.entries(r.need)[0];
      const have = this.inventory.countOf(needId);
      const ok = have >= needQty;
      const row = document.createElement("div");
      row.className = "cook-row" + (ok ? "" : " disabled");
      row.innerHTML = `<span class="inv-icon item-${ITEMS[r.result].css}"></span>
        <span class="cook-name">${ITEMS[r.result].name}</span>
        <span class="cook-cost">${ITEMS[needId].name} x${needQty} (have ${have})</span>
        <button class="cook-btn" ${ok ? "" : "disabled"}>Cook</button>`;
      row.querySelector(".cook-btn").addEventListener("click", () => this.cook(r));
      list.appendChild(row);
    }
  }
  cook(recipe) {
    const [needId, needQty] = Object.entries(recipe.need)[0];
    if (this.inventory.countOf(needId) < needQty) { this.showMessage(`Not enough ${ITEMS[needId].name}`); return; }
    this.inventory.removeById(needId, needQty);
    if (!this.inventory.add(recipe.result, recipe.qty)) {
      this.inventory.add(needId, needQty); // refund — nowhere to put the result
      this.showMessage("Inventory Full");
      return;
    }
    this.showMessage(`Cooked ${ITEMS[recipe.result].name}!`);
    this.refreshPanels();
    this.renderCooking();
  }

  // ---- Shop ----
  renderShop() {
    document.getElementById("shop-coins").textContent = `Coins: ${this.coins}`;
    const buyList = document.getElementById("shop-buy-list");
    buyList.innerHTML = "";
    const cat = this.shopCat || "general", W = (id) => WEAPONS[id] && ITEMS[id].type === "weapon";
    document.getElementById("shop-title").textContent = cat === "weapons" ? "Ironleaf Armory" : "General Store";
    for (const [id, price] of Object.entries(SHOP_ITEMS)) {
      if (price.buy == null || (price.cat || "general") !== cat) continue;
      const def = ITEMS[id];
      const ok = this.coins >= price.buy;
      const row = document.createElement("div");
      row.className = "cook-row" + (ok ? "" : " disabled");
      row.innerHTML = `<span class="inv-icon item-${def.css}"></span>
        <span class="cook-name">${W(id) ? `${def.name} <small>${WEAPONS[id].damage}${WEAPONS[id].ranged && WEAPONS[id].ranged.pellets ? "x" + WEAPONS[id].ranged.pellets : ""} dmg${WEAPONS[id].ranged ? " · " + ITEMS[WEAPONS[id].ranged.ammo].name : ""}</small>` : price.pack ? `${def.name} x${price.pack}` : def.name}</span>
        <span class="cook-cost">${price.buy} coins</span>
        <button class="cook-btn" ${ok ? "" : "disabled"}>Buy</button>`;
      row.querySelector(".cook-btn").addEventListener("click", () => this.buyItem(id));
      buyList.appendChild(row);
    }
    const sellList = document.getElementById("shop-sell-list");
    sellList.innerHTML = "";
    this.inventory.slots.forEach((item, index) => {
      const price = item && SHOP_ITEMS[item.id];
      if (!item || !price || price.sell == null || (price.cat || "general") !== cat) return;
      const def = ITEMS[item.id];
      const row = document.createElement("div");
      row.className = "cook-row";
      row.innerHTML = `<span class="inv-icon item-${def.css}"></span>
        <span class="cook-name">${def.name} x${item.qty}</span>
        <span class="cook-cost">${price.sell} coins each</span>
        <button class="cook-btn">Sell</button>`;
      row.querySelector(".cook-btn").addEventListener("click", () => this.sellAt(index));
      sellList.appendChild(row);
    });
    if (!sellList.children.length) sellList.innerHTML = `<div class="cook-empty">Nothing sellable in your bag</div>`;
  }
  buyItem(id) {
    const price = SHOP_ITEMS[id].buy, qty = SHOP_ITEMS[id].pack || 1;
    if (this.coins < price) { this.showMessage("Not enough coins"); return; }
    if (!this.inventory.canAddAll([[id, qty]])) { this.showMessage("Inventory Full"); return; }
    this.inventory.add(id, qty);
    this.coins -= price;
    this.refreshPanels();
    this.renderShop();
  }
  sellAt(index) {
    const item = this.inventory.slots[index];
    const price = item && SHOP_ITEMS[item.id];
    if (!item || !price || price.sell == null) return;
    this.inventory.removeAt(index, 1);
    this.coins += price.sell;
    this.refreshPanels();
    this.renderShop();
  }

  // ---- Fast travel ----
  renderTravel() {
    const list = document.getElementById("travel-list");
    list.innerHTML = "";
    const T = CONFIG.TILE, home = this.getPage("0,0").area.spawn;
    const points = [{ travelName: "Home", unlocked: true, page: "0,0", cx: home.x + CONFIG.PLAYER_SIZE / 2, cy: home.y + CONFIG.PLAYER_SIZE / 2 },
      ...WORLD.travelDefs.map((d) => ({ travelName: d.name, page: d.page, cx: d.tx * T, cy: d.ty * T, unlocked: !!this.travelUnlocked[d.name] }))];
    for (const p of points) {
      const row = document.createElement("div");
      row.className = "cook-row" + (p.unlocked ? "" : " disabled");
      const where = p.unlocked ? ` <small>${WORLD.pages[p.page].name}</small>` : "";
      row.innerHTML = `<span class="cook-name">${p.unlocked ? p.travelName : "??? (visit to unlock)"}${p.unlocked && p.travelName !== WORLD.pages[p.page].name ? where : ""}</span>
        <button class="cook-btn" ${p.unlocked ? "" : "disabled"}>Travel</button>`;
      row.querySelector(".cook-btn").addEventListener("click", () => this.travelTo(p));
      list.appendChild(row);
    }
  }
  travelTo(point) {
    if (!point.unlocked) return;
    if (point.page !== this.pageId) this.enterPage(point.page);
    this.player.x = point.cx - this.player.w / 2;
    this.player.y = point.cy - this.player.h / 2;
    this.unstick();
    this.beginPage();
    this.closeAllPanels();
    this.showMessage(`Traveled to ${point.travelName}`);
  }

  // ---- Save / load (localStorage) ----
  // Global state (coins, bag, way-points) plus per-page state (farm plots, chest contents) for every page
  // the player has built. Chests are matched back up by their order on the page, which is stable because
  // each page creates them in a fixed order.
  saveGame(silent) {
    const pages = { ...this.savedPages }; // keep data of pages not built this session
    for (const [id, pg] of Object.entries(this.pages)) {
      const entry = { day: pg.day, chests: pg.objects.filter((o) => o instanceof Chest).map((c) => ({ opened: c.opened, slots: c.inv.slots })),
        trees: pg.area.exportTrees(), ...pg.area.exportBroken(), hens: pg.objects.filter((o) => o instanceof WORLD.Hen).map((h) => (h.fed ? 1 : 0)),
        eggs: pg.objects.filter((o) => o instanceof WORLD.Egg).map((e) => [Math.round(e.cx), Math.round(e.y + e.h)]) };
      if (pg.farm.soil.some((v) => v)) { entry.farm = {}; for (const k of ["soil", "wet", "crop", "grown", "flag", "since"]) entry.farm[k] = Array.from(pg.farm[k]); }
      pages[id] = entry;
    }
    const data = {
      mapVersion: CONFIG.MAP_VERSION,
      page: this.pageId,
      visited: Object.keys(this.visited),
      coins: this.coins,
      crops: this.crops,
      day: this.dayIndex, time: this.time, energy: this.energy, water: this.water,
      playerX: (this.inside ? this.outPos : this.player).x, playerY: (this.inside ? this.outPos : this.player).y, playerHp: this.player.hp,
      inventory: this.inventory.slots,
      travel: this.travelUnlocked,
      waypoint: this.waypoint || null,
      pages,
    };
    try {
      data.profile = CONFIG.PROFILE || null;
      const json = JSON.stringify(data);
      localStorage.setItem(CONFIG.SAVE_KEY, json);
      if (typeof Profiles !== "undefined") Profiles.afterSave(data, json);
      if (!silent) this.showMessage("Game saved");
    } catch (e) { /* storage unavailable/full — autosave just silently skips */ }
  }
  // Reads the save and restores everything that does not depend on a map page. Returns the raw save (or null).
  // Saves from before the farm update (mapVersion < 4) keep coins, items and way-points; the old map data can't be reused.
  readSave() {
    let data;
    try {
      const raw = localStorage.getItem(CONFIG.SAVE_KEY);
      if (!raw) return null;
      data = JSON.parse(raw);
    } catch (e) { return null; }

    if (typeof data.coins === "number") this.coins = Math.max(data.coins, 0);
    if (typeof data.crops === "number") this.crops = data.crops;
    if (Array.isArray(data.inventory)) {
      const old = data.inventory.map((s) => (s ? { ...s } : null)).filter((s) => s && ITEMS[s.id]);
      this.inventory.slots = new Array(CONFIG.INV_SIZE).fill(null);
      for (const s of old) this.inventory.add(s.id, s.qty);
      for (const id of ["axe", "hoe", "can"]) if (!this.inventory.countOf(id)) this.inventory.add(id, 1);
      // keep the tools on the hotbar in a sensible order
      for (const id of ["axe", "hoe", "can"]) { const i = this.inventory.slots.findIndex((s) => s && s.id === id), j = ["axe", "hoe", "can"].indexOf(id); if (i > j) { const t = this.inventory.slots[j]; this.inventory.slots[j] = this.inventory.slots[i]; this.inventory.slots[i] = t; } }
    }
    this.travelUnlocked = data.travel && !Array.isArray(data.travel) ? data.travel : {};
    this.waypoint = data.waypoint && WORLD.pages[data.waypoint.page] ? data.waypoint : null;
    for (const id of data.visited || []) if (WORLD.pages[id]) this.visited[id] = true;
    if (data.mapVersion === 4) {
      this.savedPages = data.pages || {};
      this.setDay(Math.max(0, data.day | 0));
      if (typeof data.time === "number") this.time = Math.min(Math.max(data.time, CONFIG.DAY_START), CONFIG.DAY_END - 0.2);
      if (typeof data.energy === "number") this.energy = data.energy;
      if (typeof data.water === "number") this.water = data.water;
    }
    return data;
  }
  afterLoad() {
    this.ui.setHealth(this.player.hp, this.player.maxHp);
    this.ui.setStats(this.coins);
    this.ui.setEnergy(this.energy, CONFIG.MAX_ENERGY);
    this.refreshPanels();
  }

  // everything that glows at night: lanterns, lit windows, cooking fires, the farmer's own lantern
  collectLights() {
    const lights = this.village.lights.slice();
    for (const o of this.objects) if (o.lights) lights.push(...o.lights());
    const p = this.player; if (FP.ambient(this.time, this.weather)[3] > 0.36) lights.push({ x: p.cx, y: p.cy - 14, r: 110, c: [255, 214, 150], flick: true });
    return lights;
  }
  render() {
    const ctx = this.ctx, cam = this.camera, dt = Math.min(0.05, (performance.now() - (this._rt || performance.now())) / 1000); this._rt = performance.now();
    ctx.clearRect(0, 0, cam.w, cam.h);
    if (this.inside) { this.renderInside(); this.renderOverlays(); return; }
    this.world.draw(ctx, cam);
    this.farm.draw(ctx, cam);

    // Outline the tile in front of the player (the one tools and seeds will act on)
    const T = CONFIG.TILE, it = this.selectedItem(), tl = it && it.def.tool, tt = this.tile;
    if (!this.uiMode && (tl === "hoe" || tl === "can" || (it && it.def.type === "seed"))) {
      const f = this.farm, ok = tl === "hoe" ? f.inside(tt.tx, tt.ty) && !f.hasSoil(tt.tx, tt.ty) && !this.tileBlocked(tt)
        : tl === "can" ? f.hasSoil(tt.tx, tt.ty) : f.hasSoil(tt.tx, tt.ty) && !f.cropAt(tt.tx, tt.ty);
      ctx.strokeStyle = ok ? "rgba(255,246,194,0.95)" : "rgba(255,255,255,0.25)"; ctx.lineWidth = 3;
      ctx.strokeRect(tt.tx * T - cam.x + 2, tt.ty * T - cam.y + 2, T - 4, T - 4);
    }

    // Draw back-to-front by bottom edge so overlap looks right.
    const props = this.village ? this.village.visibleProps(cam) : [];
    for (const d of this.deaths) props.push({ x: d.x, y: d.y - 1, w: 0, h: 1, draw: (c, cm) => FP.drawChar(c, "skeleton", d.big ? "ember" : "bone", "death", d.dir, Math.min(5, d.t * 8), d.x - cm.x, d.y - cm.y, d.big ? 5.2 : 3.2) });
    const drawables = [...this.objects, ...props, ...this.monsters.list, this.player].sort((a, b) => (a.y + a.h) - (b.y + b.h));
    for (const d of drawables) {
      // The held tool/weapon draws relative to the player specifically, so it has to slot into this
      // same back-to-front pass right next to the body rather than all at once afterwards — otherwise
      // it always ended up on top, which looked right from the front but wrong from behind: facing
      // away (up), a carried tool should mostly disappear behind the body, not float in front of it.
      if (d === this.player && this.player.dirKey === "up") this.drawSwing(ctx, cam);
      d.draw(ctx, cam);
      if (d === this.player && this.player.dirKey !== "up") this.drawSwing(ctx, cam);
    }
    this.drawProjectiles(ctx, cam);

    for (const pt of this.particles) { // dust, sparkles, water drops
      ctx.globalAlpha = Math.max(0, 1 - pt.t / pt.life); ctx.fillStyle = pt.color;
      ctx.fillRect(Math.round(pt.x - cam.x), Math.round(pt.y - cam.y), 4, 4);
    }
    ctx.globalAlpha = 1;
    if (this.nearest) { // highlight ring on the target
      ctx.strokeStyle = "#fff6c2";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      const r = this.nearest.hl || this.nearest; // houses highlight just their door
      ctx.strokeRect(r.x - cam.x - 4, r.y - cam.y - 4, r.w + 8, r.h + 8);
      ctx.setLineDash([]);
    }
    if (this.slash) { // swing flash fades over 150ms
      const left = this.slash.until - performance.now();
      if (left > 0) {
        const r = this.slash.rect;
        ctx.globalAlpha = left / 150 * 0.55;
        ctx.fillStyle = "#fff6c2";
        ctx.beginPath();
        ctx.ellipse(r.cx - cam.x, r.cy - cam.y, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      } else this.slash = null;
    }
    FP.drawLighting(ctx, cam, this.time, this.weather, this.collectLights());
    FP.drawWeather(ctx, cam, this.weather, dt);
    this.ui.drawPopups(ctx, cam);
    this.ui.drawFloaters(ctx, cam);
    this.renderOverlays();
  }
  renderOverlays() {
    const ctx = this.ctx, cam = this.camera;
    if (this.seasonBanner) {
      const b = this.seasonBanner, a = Math.min(1, b.t, (3.2 - b.t) * 2);
      ctx.save(); ctx.globalAlpha = Math.max(0, a); ctx.font = "bold 40px 'Trebuchet MS', sans-serif"; ctx.textAlign = "center";
      ctx.lineWidth = 7; ctx.strokeStyle = "rgba(60,38,22,0.95)"; ctx.strokeText(b.text, cam.w / 2, cam.h * 0.28);
      ctx.fillStyle = "#fde6b2"; ctx.fillText(b.text, cam.w / 2, cam.h * 0.28); ctx.restore();
    }
    if (this.fade) { // page transition / going to bed
      const f = this.fade, dur = f.sleep ? [0.7, 0.8] : [CONFIG.PAGE_FADE_OUT, CONFIG.PAGE_FADE_IN];
      const a = f.phase === "out" ? Math.min(1, f.t / dur[0]) : 1 - Math.min(1, f.t / dur[1]);
      ctx.fillStyle = f.sleep ? `rgba(6,8,22,${a})` : `rgba(8,12,28,${a})`; ctx.fillRect(0, 0, cam.w, cam.h);
    }
  }

  loop(now) {
    const dt = Math.min((now - this.last) / 1000, 0.05); // clamp after tab switches
    this.last = now;
    this.update(dt);
    this.render();
    this.input.endFrame();
    requestAnimationFrame((t) => this.loop(t));
  }
}

// The game is started by profile.js (title screen: Continue / New Game), which sets the save slot, name and character first.
