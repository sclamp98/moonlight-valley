"use strict";
/* ==========================================================
   Moonlight Valley — the redesigned Main Hall + the new, separate Gaming Room.
   Art: assets/hall/* (cut straight out of the supplied sprite sheets by tools/build_hall_assets.py, listed in hallart.js).

   Rooms are "scenes" exactly like the cinema cellar: Game.inside holds the current room object, Game.fade { door } drives the transition,
   and updateInside / renderInside / passDoor are wrapped (never replaced).  Three interiors now exist:
        Main Hall    (this.homeRoom)    front door (bottom)  ·  cellar stairs (top-left, -> cinema)  ·  Gaming Room doorway (right wall)
        Gaming Room  (this.gamingRoom)  its own map, its own colliders, entered from the hall's right-hand doorway, one exit back
        Cinema       (cinema/room.js)   unchanged
   Co-op presence: a player's `where` is "home" | "gaming" | "cinema" | "out" — you only ever see / emote with a partner in the SAME room.
   The house exterior (home.js House) is not touched.
   ========================================================== */
const HallKit = (() => {
  const S = 3;                                                   // one art pixel = 3 screen pixels (same as the old house interior)
  const { blit } = WORLD;
  const ok = FP.ok;
  const FRAME = "#32333c";                                        // the pack's dark outer wall-top colour
  const img = {};
  for (const n of Object.keys(HALL_ART.static)) img[n] = Object.assign(new Image(), { src: `assets/hall/${n}.png` });
  for (const n of Object.keys(HALL_ART.anim)) img["a_" + n] = Object.assign(new Image(), { src: `assets/hall/a_${n}.png` });
  const dim = (n) => HALL_ART.static[n] || HALL_ART.anim[n];

  /* ---------- scenery description helpers ---------- */
  // it(name, x, bottom, opts): x = left edge, bottom = where the piece touches the floor (art px).  Default collider = the lower part of the sprite.
  const it = (n, x, bottom, o = {}) => Object.assign({ n, x, bottom }, o);
  const wallOf = (n, x, y, o = {}) => Object.assign({ n, x, y, wall: true, nocol: true }, o);
  const flatOf = (n, x, y, o = {}) => Object.assign({ n, x, y, flat: true, nocol: true }, o);

  class Spot extends Interactable {
    constructor(o) { super({ x: o.x * S, y: o.y * S, w: o.w * S, h: o.h * S, name: o.label, prompt: o.prompt, solid: false }); this.act = o.act; this.slot = o.slot; this.say = o.say; this.hl = null; }
    onInteract(game) { HallKit.act(game, this); }
  }

  /* ---------- a room: floor + wall + frame + a list of pieces ---------- */
  class HallRoom {
    constructor(def) {
      this.def = def; this.isHall = true;
      const { RW, RH, floor } = def;
      this.world = { width: RW * S, height: RH * S };
      this.floor = floor;
      const fx = floor.x, fy = floor.y, fr = fx + floor.w, fb = fy + floor.h;
      const solids = [];
      const box = (x, y, w, h) => solids.push({ x: x * S, y: y * S, w: w * S, h: h * S });
      box(0, 0, fx, RH); box(fr, 0, RW - fr, RH);                // side walls (doorways are reached with a "press E" spot, not by walking out)
      solids.push({ x: 0, y: 0, w: RW * S, h: fy * S - 20 });    // back wall (the farmer's head may overlap it a little, like the old house)
      const lip = 12 / S;                                         // the farmer's feet may dip a little below the floor edge
      if (def.exitGap) { const [g0, g1] = def.exitGap; box(0, fb + lip, g0, RH - fb); box(g1, fb + lip, RW - g1, RH - fb); }
      else box(0, fb + lip, RW, RH - fb);
      for (const b of def.blocks || []) box(b[0], b[1], b[2], b[3]);
      this.solids = solids;
      this.things = []; this.spots = []; this.lights = (def.lights || []).map((l) => ({ x: l.x * S, y: l.y * S, r: l.r, c: l.c, flick: l.flick }));
      this.flats = []; this.walls = []; this.anims = [];
      for (const d of def.items) this.add(d);
      for (const s of def.spots || []) this.spots.push(new Spot(s));
      if (def.bed) this.setupBed(def.bed);
    }
    add(d) {
      const m = dim(d.n), w = m.w, h = m.h, x = d.x, y = d.y != null ? d.y : d.bottom - h, bottom = y + h;
      const draw = (ctx, cam) => this.sprite(ctx, cam, d, x, y);
      if (d.flat) { this.flats.push({ draw }); return; }
      if (d.wall) { this.walls.push({ draw }); return; }
      if (!d.nocol) {
        const c = d.col || (h >= 40 ? [3, Math.round(h * 0.56), w - 6, Math.round(h * 0.44) - 1] : [1, Math.round(h * 0.4), w - 2, Math.round(h * 0.6) - 1]);
        this.solids.push({ x: (x + c[0]) * S, y: (y + c[1]) * S, w: c[2] * S, h: c[3] * S });
        if (d.act) this.spots.push(new Spot({ x: x + c[0] + c[2] / 2 - 12, y: y + c[1] + c[3] - 2, w: 24, h: 13, act: d.act, label: d.label, prompt: d.prompt || "Look", say: d.say }));
      }
      this.things.push({ y: d.sortY != null ? d.sortY : bottom, draw });
    }
    sprite(ctx, cam, d, x, y) {
      const a = d.anim, im = img[(a ? "a_" : "") + d.n]; if (!ok(im)) return;
      const m = dim(d.n);
      if (a) { const f = Math.floor(performance.now() / 60) % m.n; blit(ctx, im, f * m.w, 0, m.w, m.h, x * S - cam.x, y * S - cam.y, m.w * S, m.h * S); }
      else blit(ctx, im, 0, 0, m.w, m.h, x * S - cam.x, y * S - cam.y, m.w * S, m.h * S);
    }
    tile(ctx, cam, n, x0, y0, w, h, ty0) {                        // repeat a 64x64 art tile over a rectangle (art px), clipped
      const im = img[n]; if (!ok(im)) return;
      ctx.save(); ctx.beginPath(); ctx.rect(x0 * S - cam.x, y0 * S - cam.y, w * S, h * S); ctx.clip();
      for (let y = y0 + (ty0 || 0); y < y0 + h; y += 64) for (let x = x0; x < x0 + w; x += 64) blit(ctx, im, 0, 0, 64, 64, x * S - cam.x, y * S - cam.y, 64 * S, 64 * S);
      ctx.restore();
    }
    drawShell(ctx, cam) {
      const d = this.def, f = this.floor;
      ctx.fillStyle = FRAME; ctx.fillRect(-cam.x, -cam.y, d.RW * S, d.RH * S);
      this.tile(ctx, cam, d.floorTile, f.x, f.y, f.w, f.h);
      this.tile(ctx, cam, d.wallTile, f.x, f.y - 64, f.w, 64);
      for (const o of d.openings || []) o.draw(this, ctx, cam);
    }
    draw(ctx, cam, game) {
      ctx.fillStyle = "#120f16"; ctx.fillRect(0, 0, cam.w, cam.h);
      this.drawShell(ctx, cam);
      for (const w of this.walls) w.draw(ctx, cam);
      for (const f of this.flats) f.draw(ctx, cam);
      const list = this.things.slice(), p = game.player;
      if (!game.lying) list.push({ y: p.y + p.h, draw: (c, cm) => p.draw(c, cm) });
      list.sort((a, b) => a.y - b.y);
      for (const d of list) d.draw(ctx, cam);
      if (game.nearestIn) { const r = game.nearestIn; ctx.strokeStyle = "rgba(255,246,194,.8)"; ctx.setLineDash([5, 4]); ctx.lineWidth = 2; ctx.strokeRect(r.x - cam.x, r.y - cam.y, r.w, r.h); ctx.setLineDash([]); }
    }
    /* the double bed (Main Hall only): same contract as the old house bed -> room.bed.sleepers / pillowXY / standPos / drawBed */
    setupBed(b) {
      this.bedDef = b; const m = dim("bed"), y = b.bottom - m.h;
      this.bed = { sleepers: [null, null] };
      this.solids.push({ x: (b.x + 1) * S, y: (y + 8) * S, w: (m.w - 2) * S, h: (m.h - 9) * S });
      this.pillows = [[b.x + 13, y + 17], [b.x + 36, y + 17]];
      this.things.push({ y: b.bottom, draw: (ctx, cam) => this.drawBed(ctx, cam) });
      this.pillows.forEach((p, i) => this.spots.push(new Spot({ x: p[0] - 9, y: b.bottom + 1, w: 18, h: 14, act: "bed", slot: i, label: "Double bed", prompt: "Lie down" })));
    }
    pillowXY(i) { const p = this.pillows[i]; return [p[0] * S, p[1] * S]; }
    standPos(i = 0) { return { x: this.pillows[i][0] * S - CONFIG.PLAYER_SIZE / 2, y: (this.bedDef.bottom + 7) * S }; }
    drawBed(ctx, cam) {
      const b = this.bedDef, m = dim("bed"), y = b.bottom - m.h, im = img.bed; if (!ok(im)) return;
      blit(ctx, im, 0, 0, m.w, m.h, b.x * S - cam.x, y * S - cam.y, m.w * S, m.h * S);
      this.bed.sleepers.forEach((who, i) => {
        if (!who) return;
        const [px, py] = this.pillowXY(i), h = CONFIG.SPRITE_H.player, top = py - cam.y - h * 0.2, sp = who.sprite && who.sprite.frame("down", 0);
        if (ok(sp)) { ctx.save(); ctx.beginPath(); ctx.rect(px - cam.x - 50, top - 6, 100, h * 0.44); ctx.clip(); drawSprite(ctx, sp, px - cam.x, top + h, h); ctx.restore(); }
        const t = performance.now() / 1000;
        ctx.save(); ctx.font = "bold 20px 'Trebuchet MS', sans-serif"; ctx.fillStyle = "#fde6b2"; ctx.strokeStyle = "rgba(60,38,22,.9)"; ctx.lineWidth = 4;
        for (let k = 0; k < 3; k++) { const u = (t * 0.6 + k / 3) % 1, zx = px - cam.x + 20 + u * 26, zy = py - cam.y - 40 - u * 46; ctx.globalAlpha = Math.sin(u * Math.PI); ctx.strokeText("z", zx, zy); ctx.fillText("z", zx, zy); }
        ctx.restore();
      });
      blit(ctx, im, 0, 22, m.w, m.h - 22, b.x * S - cam.x, (y + 22) * S - cam.y, m.w * S, (m.h - 22) * S);   // the blanket goes back over any sleepers
    }
  }

  /* ---------- doorway pictures (drawn inside the dark wall frame) ---------- */
  const sideDoorway = (side, y0, tileName) => ({
    draw(room, ctx, cam) {
      const f = room.floor, x = side === "right" ? f.x + f.w : 0;
      room.tile(ctx, cam, tileName, x, y0, 16, 48, 0);                      // the next room's own floor, seen through the opening
      ctx.fillStyle = FRAME; ctx.fillRect(x * S - cam.x, y0 * S - cam.y, 16 * S, 3); ctx.fillRect(x * S - cam.x, (y0 + 48) * S - cam.y - 3, 16 * S, 3);
      ctx.fillStyle = "rgba(0,0,0,.22)"; ctx.fillRect(x * S - cam.x, y0 * S - cam.y + 3, 16 * S, 8 * S);
    },
  });
  const frontDoorway = (x0) => ({
    draw(room, ctx, cam) {                                                    // the way out: a gap in the bottom wall with the garden showing through
      const f = room.floor, y = f.y + f.h;
      room.tile(ctx, cam, "floor_grass", x0, y, 32, 16, 0);
      ctx.fillStyle = FRAME; ctx.fillRect(x0 * S - cam.x - 3, y * S - cam.y, 3, 16 * S); ctx.fillRect((x0 + 32) * S - cam.x, y * S - cam.y, 3, 16 * S);
    },
  });

  /* ---------- MAIN HALL ---------- */
  const HALL = {
    RW: 352, RH: 272, floor: { x: 16, y: 80, w: 320, h: 176 }, floorTile: "floor_wood", wallTile: "wall_green",
    exitGap: [160, 192], blocks: [[16, 80, 46, 47]],                 // blocks = the stair shaft (the lip stays free so you can step up to it)
    openings: [sideDoorway("right", 136, "floor_grey"), frontDoorway(160)],
    lights: [
      { x: 101, y: 44, r: 230, c: [255, 215, 140] }, { x: 224, y: 74, r: 190, c: [255, 150, 70], flick: true },
      { x: 152, y: 70, r: 150, c: [150, 190, 255] }, { x: 70, y: 150, r: 110, c: [255, 200, 120], flick: true }, { x: 296, y: 218, r: 120, c: [255, 200, 120], flick: true },
      { x: 176, y: 250, r: 120, c: [255, 215, 140] },
    ],
    bed: { x: 282, bottom: 246 },
    items: [
      // --- along the back wall, left to right ---
      flatOf("stairs_down", 16, 80),
      it("piano", 70, 100, { col: [1, 22, 61, 22], act: "piano", label: "Piano", prompt: "Play a tune", say: "You plink out a few notes. Lovely." }),
      wallOf("window_yellow", 79, 14),
      it("stool_red", 89, 124, { col: [3, 8, 19, 10] }),
      it("tv_console", 140, 98, { anim: true, n: "tv_news", col: [1, 28, 63, 22], act: "tv", label: "Television", prompt: "Watch TV", say: "The evening news is on. Nothing about the farm, thankfully." }),
      wallOf("clock", 161, 20),
      it("fireplace", 212, 98, { anim: true, col: [0, 22, 55, 25], act: "fire", label: "Fireplace", prompt: "Warm your hands", say: "A cosy, crackling fire." }),
      wallOf("painting", 218, 22),
      it("bookshelf", 272, 104, { col: [2, 36, 33, 26], act: "books", label: "Bookshelf", prompt: "Browse", say: "Farming almanacs and a half-read adventure novel." }),
      it("cactus", 312, 100, { col: [4, 24, 16, 12] }),
      // --- living corner ---
      flatOf("rug_red", 136, 120),
      it("coffee_table", 151, 162, { col: [2, 12, 46, 16] }),
      it("armchair_a", 94, 172, { col: [3, 22, 29, 21] }),
      it("armchair_b", 227, 172, { col: [3, 22, 29, 21] }),
      it("sofa_teal", 145, 212, { col: [2, 14, 57, 22] }),
      it("floor_lamp", 58, 178, { col: [6, 40, 14, 12] }),
      it("side_table", 262, 176, { col: [3, 16, 21, 14] }),
      it("dog", 118, 206, { anim: true, nocol: true }),
      it("cat", 206, 214, { anim: true, nocol: true }),
      // --- left side: music corner + dining table ---
      it("guitar", 22, 164, { col: [3, 28, 15, 14] }),
      it("dining_table", 22, 246, { col: [2, 22, 95, 18], act: "eat", label: "Dining table", prompt: "Eat a meal" }),
      it("chair_dn", 38, 220, { col: [3, 14, 17, 14] }), it("chair_dn2", 82, 220, { col: [3, 14, 17, 14] }),
      // --- right side ---
      it("nightstand", 252, 250, { col: [2, 16, 21, 17] }),
      it("plant_big", 208, 254, { col: [10, 38, 14, 16] }),
      it("plant_fiddle", 128, 254, { col: [6, 38, 13, 14] }),
      flatOf("mat_home", 161, 241),
    ],
    spots: [
      { x: 14, y: 127, w: 42, h: 22, act: "stairs", label: "Cellar stairs", prompt: "Go down to the cellar" },
      { x: 160, y: 240, w: 32, h: 16, act: "door", label: "Front door", prompt: "Go outside" },
      { x: 304, y: 140, w: 32, h: 40, act: "gaming", label: "Gaming Room", prompt: "Enter Gaming Room" },
    ],
  };

  /* ---------- GAMING ROOM ---------- */
  const GAME = {
    RW: 408, RH: 320, floor: { x: 16, y: 80, w: 376, h: 224 }, floorTile: "floor_grey", wallTile: "wall_navy",
    openings: [sideDoorway("left", 184, "floor_wood")],
    lights: [
      { x: 70, y: 70, r: 170, c: [120, 255, 150] }, { x: 172, y: 78, r: 210, c: [120, 150, 255] }, { x: 256, y: 72, r: 200, c: [255, 120, 140] },
      { x: 255, y: 40, r: 180, c: [255, 230, 90] }, { x: 365, y: 82, r: 150, c: [110, 200, 255] }, { x: 205, y: 160, r: 150, c: [120, 255, 220] }, { x: 352, y: 230, r: 170, c: [255, 220, 150] },
    ],
    items: [
      // --- back wall: gaming desk, TV, arcade cabinets, server, aquarium ---
      it("desk_gaming", 24, 100, { col: [1, 26, 63, 20], act: "pc", label: "Gaming PC", prompt: "Look", say: "A very serious gaming rig. The fans are glowing." }),
      it("pc_tower_a", 92, 100, { anim: true, col: [1, 12, 16, 13] }),
      it("speaker", 113, 100, { col: [2, 24, 17, 16] }),
      it("tv_night", 140, 100, { anim: true, col: [1, 28, 63, 22], act: "tv", label: "Big TV", prompt: "Look", say: "The big screen is showing a game demo on loop." }),
      it("console_white", 211, 96, { col: [1, 4, 20, 7], nocol: true }),
      it("arcade_blue", 240, 100, { anim: true, col: [2, 30, 27, 27], act: "arcade1", label: "Arcade cabinet", prompt: "Play Arcade" }),
      ...(window.MV_MOBILE ? [] : [it("arcade_red", 274, 100, { anim: true, col: [2, 30, 27, 27], act: "arcade2", label: "Neo Geo cabinet", prompt: "Play Arcade" })]),   // phones: one arcade machine only (no Neo Geo / ROM loading)
      it("server", 310, 100, { anim: true, col: [2, 28, 25, 25] }),
      it("aquarium", 342, 100, { anim: true, col: [1, 20, 41, 24], act: "fish", label: "Aquarium", prompt: "Watch the fish", say: "Little fish drifting by. Very relaxing." }),
      wallOf("neon_pad", 36, 22, { anim: true }), wallOf("poster_invader", 70, 22),
      wallOf("trophies", 156, 24), wallOf("neon_bolt", 259, 16, { anim: true }), wallOf("ac_a", 346, 22, { anim: true }),
      // --- centre: rug + bean bags + controller ---
      flatOf("rug_teal", 168, 130), flatOf("gamepad", 198, 150),
      it("chair_gaming", 62, 132, { col: [3, 20, 19, 14] }),
      it("foosball", 40, 182, { col: [2, 22, 41, 21], act: "foosball", label: "Foosball table", prompt: "Play foosball", say: "You spin the rods for a while. Goal!" }),
      it("beanbag_red", 150, 180, { col: [2, 8, 28, 16] }), it("beanbag_green", 230, 180, { col: [2, 8, 28, 16] }),
      it("robot_vac", 288, 168, { anim: true, nocol: true }),
      it("purifier", 358, 190, { anim: true, col: [2, 24, 25, 20] }),
      // --- lower half ---
      flatOf("rug_blue", 312, 204),
      it("sofa_navy", 170, 232, { col: [2, 14, 57, 22] }),
      it("ping_pong", 244, 252, { col: [1, 20, 67, 27], act: "pong", label: "Ping-pong table", prompt: "Play ping-pong", say: "Ping... pong... ping... pong." }),
      it("pool_table", 318, 250, { col: [1, 18, 71, 29], act: "pool", label: "8-ball pool table", prompt: "Play pool", say: "You line up the 8-ball. Corner pocket... almost!" }),
      // --- bottom row ---
      it("punching_bag", 24, 300, { col: [2, 30, 20, 18], act: "bag", label: "Punching bag", prompt: "Throw a punch", say: "Thwack! Good form." }),
      it("shelf_bottles", 62, 300, { col: [1, 8, 36, 16] }), it("bike_blue", 106, 300, { col: [1, 10, 47, 18] }),
      it("keyboard_piano", 172, 300, { col: [2, 12, 47, 14], act: "keys", label: "Keyboard", prompt: "Play a tune", say: "A bright little melody fills the room." }),
      it("plant_snake", 232, 300, { col: [4, 24, 15, 13] }), it("plant_cactus_b", 330, 302, { col: [4, 24, 16, 12] }),
      it("water_cooler", 368, 302, { col: [2, 26, 17, 18], act: "water", label: "Water cooler", prompt: "Have a drink", say: "Cool, refreshing water." }),
    ],
    spots: [
      { x: 14, y: 187, w: 36, h: 42, act: "mainhall", label: "Main Hall", prompt: "Back to the Main Hall" },
    ],
  };

  class MainHall extends HallRoom { constructor() { super(HALL); this.isMainHall = true; } entryPos() { return { x: 176 * S - CONFIG.PLAYER_SIZE / 2, y: 232 * S }; } returnFromGaming() { return { x: 306 * S - CONFIG.PLAYER_SIZE / 2, y: 158 * S }; }
    stairsFoot() { return { x: 36 * S - CONFIG.PLAYER_SIZE / 2, y: 137 * S }; } }
  class GamingRoom extends HallRoom {
    constructor() { super(GAME); this.isGaming = true; }
    entryPos() { return { x: 30 * S - CONFIG.PLAYER_SIZE / 2, y: 208 * S - CONFIG.PLAYER_SIZE / 2 }; }
    draw(ctx, cam, game) { return MainHall.prototype.draw.call(this, ctx, cam, game); }   // goes through cinema/room.js's patched draw, so a partner in this room is drawn
  }

  function act(game, spot) {
    const say = (t) => game.ui.popup({ cx: spot.cx, y: spot.y - 30 }, t);
    switch (spot.act) {
      case "gaming": game.enterGaming(); return;
      case "mainhall": game.leaveGaming(); return;
      case "arcade2": if (typeof NeoGeo !== "undefined") NeoGeo.open(game); return;                  // cinema/neogeo.js: Neo Geo game picker + emulator hand-off
      case "arcade1": if (typeof Arcade !== "undefined") Arcade.open(game); return;      // cinema/arcade.js: Whack-a-Mole, Memory Lights, How Fast?
      case "door": case "stairs": case "eat": case "bed": return HomeKit.act(game, spot);
      default: say(spot.say || "Cosy.");
    }
  }

  /* ---------- Game integration (wraps only) ---------- */
  const wrap = (name, fn) => { const o = Game.prototype[name]; Game.prototype[name] = function (...a) { return fn.call(this, o, ...a); }; };
  HomeKit.Room = MainHall;                                       // cinema/room.js patches HomeKit.Room.prototype.draw (partner + emotes) — now the hall's
  Object.assign(Game.prototype, {
    enterGaming() { if (this.fade || this.lying) return; this.closeAllPanels(); this.fade = { phase: "out", t: 0, door: "gaming" }; },
    leaveGaming() { if (this.fade) return; this.fade = { phase: "out", t: 0, door: "gamingBack" }; },
    updateHallRoom(dt) {
      const p = this.player, room = this.inside, inp = this.input;
      if (this.lying) {
        const a = inp.axis();
        if (a.x || a.y) this.getUp(); else if (inp.wasPressed("e")) this.sleep();
        this.nearestIn = null; this.ui.setHint(this.lying ? "Press E — sleep until morning" : "");
      } else {
        p.hurtTimer = 0; p.attackTimer = Math.max(0, p.attackTimer - dt);
        p.update(dt, inp, room.world, room.solids);
        if (room.isMainHall && p.cy > (room.floor.y + room.floor.h + 8) * S && inp.axis().y > 0) { this.leaveHome(); return; }
        let best = null, bd = CONFIG.INTERACT_RANGE;
        for (const o of room.spots) { const d = Math.hypot(o.cx - p.cx, o.cy - p.cy); if (d < bd) { best = o; bd = d; } }
        this.nearestIn = best;
        if (best && inp.wasPressed("e")) best.onInteract(this);
        this.ui.setHint(best ? `Press E — ${best.prompt}` : "");
      }
      this.homeCam().follow(p, room.world, dt);
      FP.season = this.date.seasonKey;
      this.ui.setHealth(p.hp, p.maxHp); this.ui.setEnergy(this.energy, CONFIG.MAX_ENERGY); this.ui.setClock(this.time, this.date, this.weather); this.ui.setStats(this.coins); this.ui.setCoords(p);
      this.ui.setCan(false, this.water, CONFIG.CAN_MAX);
    },
    renderHallRoom() {
      const ctx = this.ctx, cam = this.homeCam(), room = this.inside;
      ctx.save(); ctx.scale(this.hZoom, this.hZoom);
      room.draw(ctx, cam, this);
      const lights = room.lights.slice(), p = this.player;
      lights.push({ x: p.cx, y: p.cy - 14, r: room.isGaming ? 90 : 120, c: [255, 214, 150], flick: true });
      FP.drawLighting(ctx, cam, room.isGaming ? 12 : Math.max(this.time, 6), room.isGaming ? "sun" : (this.weather === "storm" ? "cloud" : this.weather), lights);
      this.ui.drawPopups(ctx, cam); this.ui.drawFloaters(ctx, cam);
      ctx.restore();
    },
  });
  wrap("updateInside", function (o, dt) { return this.inside && this.inside.isHall ? this.updateHallRoom(dt) : o.call(this, dt); });
  wrap("renderInside", function (o) { return this.inside && this.inside.isHall ? this.renderHallRoom() : o.call(this); });
  wrap("passDoor", function (o, dir) {
    const p = this.player;
    if (dir === "in") {
      if (!(this.homeRoom && this.homeRoom.isMainHall)) this.homeRoom = new MainHall();
      const r = o.call(this, dir), e = this.homeRoom.entryPos();
      p.x = e.x; p.y = e.y; p.dirKey = "up"; this.homeCam().follow(p, this.inside.world, 0, true);
      return r;
    }
    if (dir === "gaming") {
      this.gamingRoom = this.gamingRoom || new GamingRoom();
      this.inside = this.gamingRoom; this.lying = null; this.nearest = null; this.nearestIn = null;
      const e = this.gamingRoom.entryPos(); p.x = e.x; p.y = e.y; p.dirKey = "right";
      this.ui.place = "Gaming Room"; this.homeCam().follow(p, this.inside.world, 0, true);
      return;
    }
    if (dir === "gamingBack") {
      this.inside = this.homeRoom; this.nearestIn = null;
      const e = this.homeRoom.returnFromGaming(); p.x = e.x; p.y = e.y; p.dirKey = "left";
      this.ui.place = "Your Home"; this.homeCam().follow(p, this.inside.world, 0, true);
      return;
    }
    return o.call(this, dir);
  });
  wrap("doSleep", function (o, passedOut) {                       // dozing off in the Gaming Room: wake up in the hall's bed like anywhere else in the house
    if (this.inside && this.inside.isGaming) {
      this.inside = this.homeRoom; const p = this.player, e = this.homeRoom.returnFromGaming(); p.x = e.x; p.y = e.y;
    }
    return o.call(this, passedOut);
  });

  return { HALL, GAME, MainHall, GamingRoom, HallRoom, act };
})();
