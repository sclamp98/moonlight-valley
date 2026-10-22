"use strict";
/* ==========================================================
   Moonlight Valley — your home (Main Characters Home kit)
   Exterior: the kit's house on the farm page (chimney smoke, crows, swaying trees, yard decor).
   Interior: an enterable room with a big double bed, a dining table, kitchen counter and the kit's furniture.
   Art comes from assets/home/* (tools/build_home_assets.py) and homeart.js.
   ========================================================== */
const HomeKit = (() => {
  const S = 3, T = CONFIG.TILE;
  const { Prop, blit, shadow, nameTag } = WORLD;
  const ok = FP.ok;
  const img = {};
  for (const g of Object.keys(HOME_ART)) if (g !== "house") for (const n of Object.keys(HOME_ART[g])) { const k = `${g}_${n}`; img[k] = Object.assign(new Image(), { src: `assets/home/${k}.png` }); }
  const seasonOf = () => FP.season || "summer";
  const near = (g, o, d) => g && g.player && Math.hypot(g.player.cx - o.cx, g.player.cy - o.cy) < d;
  
  /* ---------- exterior decor ---------- */
  class Decor extends Prop {
    constructor(name, cx, baseY, o = {}) {
      const A = HOME_ART.ext[name + "_summer"] || HOME_ART.ext[name], sw = A.w * S, sh = A.h * S;
      super(cx, baseY, o.cw != null ? o.cw : Math.min(sw * 0.6, 60), o.ch != null ? o.ch : Math.min(sh * 0.25, 30), sw, sh);
      Object.assign(this, { name, sw, sph: sh, solid: o.solid !== false, seasonal: !!HOME_ART.ext[name + "_summer"] });
    }
    draw(ctx, cam) {
      const im = img[this.seasonal ? `ext_${this.name}_${seasonOf()}` : `ext_${this.name}`];
      if (!ok(im)) return;
      blit(ctx, im, 0, 0, im.naturalWidth, im.naturalHeight, this.cx0 - cam.x - this.sw / 2, this.baseY - cam.y - this.sph + 6, this.sw, this.sph);
    }
  }
  class AnimTree extends Prop { // swaying tree from the kit's Trees_animation sheet
    constructor(n, cx, baseY) {
      const A = HOME_ART.anim[`tree${n}_summer`], sw = A.fw * S, sh = A.h * S;
      super(cx, baseY, 34, 20, sw, sh);
      Object.assign(this, { n, A, sw, sph: sh, phase: Math.random() * 13 });
    }
    draw(ctx, cam) {
      const im = img[`anim_tree${this.n}_${seasonOf()}`]; if (!ok(im)) return;
      const f = Math.floor(performance.now() / 150 + this.phase) % this.A.frames;
      shadow(ctx, this.cx0 - cam.x, this.baseY - cam.y - 2, this.sw * 0.28, 8, 0.18);
      blit(ctx, im, f * this.A.fw, 0, this.A.fw, this.A.h, this.cx0 - cam.x - this.sw / 2, this.baseY - cam.y - this.sph + 8, this.sw, this.sph);
    }
  }
  class Crow extends Prop { // hops about in the yard
    constructor(cx, baseY) { super(cx, baseY, 10, 6, 48, 48); this.solid = false; this.phase = Math.random() * 40; }
    draw(ctx, cam) {
      const im = img.anim_crow; if (!ok(im)) return;
      const f = Math.floor(performance.now() / 120 + this.phase) % 40;
      blit(ctx, im, f * 16, 0, 16, 16, this.cx0 - cam.x - 24, this.baseY - cam.y - 40, 48, 48);
    }
  }

  /* ---------- the house on the farm ---------- */
  class House extends Interactable {
    constructor({ tx, base }) {
      const A = HOME_ART.house, w = A.w * S, h = A.h * S, x = tx * T, baseY = base * T;
      super({ x: x + 6, y: baseY - (A.h - 66) * S, w: w - 12, h: (A.h - 66) * S - 4, name: "Your Home", prompt: "Go inside", solid: true });
      Object.assign(this, { A, sx: x, baseY, sw: w, sph: h });
      this.doorX = x + A.doorCx * S;
      this.hl = { x: this.doorX - 36, y: baseY - 75, w: 72, h: 84 };
    }
    get cx() { return this.doorX; }
    get cy() { return this.baseY + 14; }
    lights() {
      const o = (x, y) => ({ x: this.sx + x * S, y: this.baseY - (this.A.h - y) * S, r: 120, c: [255, 196, 110] });
      return [o(19, 108), o(46, 108), o(72, 108), o(41, 78), o(62, 78)];
    }
    onInteract(game) { game.enterHome(); }
    draw(ctx, cam) {
      const x = this.sx - cam.x, top = this.baseY - cam.y - this.sph, im = img[`ext_house_${seasonOf()}`];
      shadow(ctx, x + this.sw / 2, this.baseY - cam.y + 2, this.sw / 2 - 6, 12, 0.2);
      if (ok(im)) blit(ctx, im, 0, 0, im.naturalWidth, im.naturalHeight, x, top, this.sw, this.sph);
      const sm = img.anim_smoke; // smoke puffs: only the top 32 rows (above the chimney) so the roof art underneath is never repainted
      if (ok(sm)) { const f = Math.floor(performance.now() / 160) % 6; blit(ctx, sm, f * 48, 0, 48, 32, x + this.A.smoke[0] * S, top + this.A.smoke[1] * S, 144, 96); }
      if (window.game && near(window.game, this, 330)) nameTag(ctx, "Your Home", x + this.sw / 2, top + 10, Math.min(1, (330 - Math.hypot(window.game.player.cx - this.cx, window.game.player.cy - this.cy)) / 110));
    }
  }

  /* ---------- interior ---------- */
  const A = (n) => HOME_ART.int[n];
  const RW = 288, RH = 208;                                     // room size in art pixels (18 x 13 tiles)
  const FLOOR = { x: 16, y: 32, w: 256, h: 144 };
  const DOOR = { x: 128, y: 176, w: 32, h: 32 };
  const BED = { x: 216, y: 30, pillows: [[225, 44], [243, 44]] };

  // furniture: n = sprite, [x, y] art px; col = [dx, dy, w, h] collider (art px, relative); act = what E does
  const F = (n, x, y, o = {}) => Object.assign({ n, x, y }, o);
  const FURN = [
    F("stairs", 18, 29, { col: [1, 22, 41, 36], act: "stairs", label: "Cellar stairs" }),
    F("pantry", 63, 31, { col: [1, 26, 49, 28], act: "kitchen", label: "Kitchen counter" }),
    F("shelf_a", 126, 32, { col: [1, 26, 44, 24], act: "shelf", label: "Shelf" }),
    F("bookshelf", 174, 30, { col: [1, 24, 24, 19], act: "books", label: "Bookshelf" }),
    F("drawer", 203, 42, { col: [0, 8, 13, 11] }),
    F("cabinet", 253, 33, { col: [1, 15, 17, 12], act: "wardrobe", label: "Wardrobe" }),
    F("rack", 18, 104, { col: [1, 14, 22, 18] }),
    F("jug_glass", 18, 140, { col: [1, 22, 16, 14] }),
    F("dining", 46, 98, { col: [14, 24, 37, 26], act: "eat", label: "Dining table" }),
    F("potion_table", 134, 94, { col: [1, 18, 24, 18], act: "potions", label: "Potion table" }),
    F("table", 170, 98, { col: [1, 12, 24, 18], act: "desk", label: "Writing desk" }),
    F("oval_table", 182, 134, { col: [1, 12, 37, 20] }),
    F("chair_l", 171, 140, { col: [0, 12, 10, 8] }), F("chair_r", 222, 140, { col: [0, 12, 10, 8] }),
    F("weapon_rack", 232, 92, { col: [1, 14, 32, 17], act: "weapons", label: "Weapon rack" }),
    F("barrel", 254, 126, { col: [0, 12, 16, 12] }), F("barrel2", 236, 152, { col: [0, 10, 30, 14] }), F("crate_s", 257, 152, { col: [0, 6, 13, 11] }),
    F("stool", 98, 152, { col: [0, 10, 24, 14] }),
    F("pot_plant", 20, 160, { col: [1, 8, 14, 9] }), F("sprout", 38, 160, { col: [1, 8, 12, 7] }),
    F("deco8", 66, 90, { col: [1, 12, 27, 10] }), F("deco6", 132, 150), F("garlic", 118, 3, { wall: true }), F("hang_plant", 176, 2, { wall: true }),
  ];
  const TOPS = [ // little things standing on furniture: [sprite, x, y, dependsOn]
    ["bowl_herbs", 173, 90], ["pitcher", 192, 126], ["pot_flower", 207, 123], ["deco3", 130, 22 + 14], ["deco2", 150, 37], ["deco12", 156, 14 + 34],
  ];
  const WINDOWS = [36, 82, 144, 232];

  class Spot extends Interactable {
    constructor(o) { super({ x: o.x * S, y: o.y * S, w: o.w * S, h: o.h * S, name: o.label, prompt: o.prompt, solid: false }); this.act = o.act; this.slot = o.slot; this.hl = null; }
    onInteract(game) { HomeKit.act(game, this); }
  }

  class Room {
    constructor() {
      this.world = { width: RW * S, height: RH * S };
      this.solids = [{ x: 0, y: 0, w: FLOOR.x * S, h: RH * S }, { x: (FLOOR.x + FLOOR.w) * S, y: 0, w: (RW - FLOOR.x - FLOOR.w) * S, h: RH * S },
        { x: 0, y: 0, w: RW * S, h: FLOOR.y * S - 20 }];
      this.things = []; this.spots = []; this.lights = [];
      for (const f of FURN) {
        const a = A(f.n); if (!a) continue;
        if (f.col) this.solids.push({ x: (f.x + f.col[0]) * S, y: (f.y + f.col[1]) * S, w: f.col[2] * S, h: f.col[3] * S });
        this.things.push({ y: (f.y + a.h) * S, wall: f.wall, draw: (ctx, cam) => this.sprite(ctx, cam, f.n, f.x, f.y) });
        if (f.act) this.spots.push(new Spot({ x: f.x + f.col[0] + f.col[2] / 2 - 12, y: f.y + a.h - 2, w: 24, h: 12, act: f.act, label: f.label, prompt: f.act === "eat" ? "Eat a meal" : f.act === "kitchen" ? "Cook" : "Look" }));
      }
      for (const [n, x, y] of TOPS) this.things.push({ y: (y + A(n).h) * S + 2, draw: (ctx, cam) => this.sprite(ctx, cam, n, x, y) });
      // the big double bed: collider = the frame, two sleeping spots below the pillows
      this.solids.push({ x: (BED.x + 1) * S, y: (BED.y + 12) * S, w: 34 * S, h: 27 * S });
      this.bed = { sleepers: [null, null] };
      this.things.push({ y: (BED.y + 39) * S, draw: (ctx, cam) => this.drawBed(ctx, cam) });
      BED.pillows.forEach((p, i) => this.spots.push(new Spot({ x: p[0] - 9, y: BED.y + 39 + 1, w: 18, h: 14, act: "bed", slot: i, label: "Double bed", prompt: "Lie down" })));
      this.door = new Spot({ x: DOOR.x + 2, y: DOOR.y - 14, w: 28, h: 16, act: "door", label: "Front door", prompt: "Go outside" });
      this.spots.push(this.door);
      this.solids.push({ x: 0, y: DOOR.y * S + 12, w: DOOR.x * S, h: (RH - DOOR.y) * S }, { x: (DOOR.x + DOOR.w) * S, y: DOOR.y * S + 12, w: (RW - DOOR.x - DOOR.w) * S, h: (RH - DOOR.y) * S });
      for (const wx of WINDOWS) this.lights.push({ x: (wx + 8) * S, y: 30 * S, r: 230, c: [255, 200, 120] });
      this.lights.push({ x: 79 * S, y: 130 * S, r: 190, c: [255, 170, 90], flick: true });   // lamp-light over the dining table
    }
    sprite(ctx, cam, n, x, y) { const im = img[`int_${n}`]; if (ok(im)) blit(ctx, im, 0, 0, im.naturalWidth, im.naturalHeight, x * S - cam.x, y * S - cam.y, im.naturalWidth * S, im.naturalHeight * S); }
    // spot of the player's bed for a slot
    pillowXY(i) { const p = BED.pillows[i]; return [p[0] * S, p[1] * S]; }
    standPos(i = 0) { return { x: BED.pillows[i][0] * S - CONFIG.PLAYER_SIZE / 2, y: (BED.y + 39 + 8) * S }; }
    drawBed(ctx, cam) {
      this.sprite(ctx, cam, "bed_double", BED.x, BED.y);
      const g = window.game;
      this.bed.sleepers.forEach((who, i) => {
        if (!who) return;
        const [px, py] = this.pillowXY(i), h = CONFIG.SPRITE_H.player, top = py - cam.y - h * 0.2;
        const im = who.sprite && who.sprite.frame("down", 0);
        if (ok(im)) { ctx.save(); ctx.beginPath(); ctx.rect(px - cam.x - 50, top - 6, 100, h * 0.44); ctx.clip(); drawSprite(ctx, im, px - cam.x, top + h, h); ctx.restore(); }
        const t = performance.now() / 1000;
        ctx.save(); ctx.font = "bold 20px 'Trebuchet MS', sans-serif"; ctx.fillStyle = "#fde6b2"; ctx.strokeStyle = "rgba(60,38,22,.9)"; ctx.lineWidth = 4;
        for (let k = 0; k < 3; k++) { const u = (t * 0.6 + k / 3) % 1, zx = px - cam.x + 20 + u * 26, zy = py - cam.y - 40 - u * 46; ctx.globalAlpha = Math.sin(u * Math.PI); ctx.strokeText("z", zx, zy); ctx.fillText("z", zx, zy); }
        ctx.restore();
      });
      const cover = img.int_bed_cover; if (ok(cover)) blit(ctx, cover, 0, 0, cover.naturalWidth, cover.naturalHeight, BED.x * S - cam.x, (BED.y + 19) * S - cam.y, cover.naturalWidth * S, cover.naturalHeight * S);
    }
    draw(ctx, cam, game) {
      ctx.fillStyle = "#120f16"; ctx.fillRect(0, 0, cam.w, cam.h);
      const ox = -cam.x, oy = -cam.y;
      // floor
      const fl = img.int_floor;
      ctx.save(); ctx.beginPath(); ctx.rect(FLOOR.x * S + ox, FLOOR.y * S + oy, FLOOR.w * S, FLOOR.h * S); ctx.clip();
      if (ok(fl)) for (let y = FLOOR.y; y < FLOOR.y + FLOOR.h; y += 32) for (let x = FLOOR.x; x < FLOOR.x + FLOOR.w; x += 64) blit(ctx, fl, 0, 0, 64, 32, x * S + ox, y * S + oy, 192, 96);
      ctx.restore();
      // walls (top + bottom), void on the sides
      const wl = img.int_wall;
      if (ok(wl)) for (let x = FLOOR.x; x < FLOOR.x + FLOOR.w; x += 32) { blit(ctx, wl, 0, 0, 32, 32, x * S + ox, 0 + oy, 96, 96); blit(ctx, wl, 0, 0, 32, 32, x * S + ox, 176 * S + oy, 96, 96); }
      for (const wx of WINDOWS) { const w = img.int_window_wall; if (ok(w)) blit(ctx, w, 0, 0, 17, 20, wx * S + ox, 6 * S + oy, 51, 60); }
      const dr = img.anim_door0; // the front door opens as you come close
      if (ok(dr)) { const open = game.player.cy > 150 * S && Math.abs(game.player.cx - (DOOR.x + 16) * S) < 80; blit(ctx, dr, (open ? 3 : 0) * 32, 0, 32, 32, DOOR.x * S + ox, DOOR.y * S + oy, 96, 96); }
      // rugs (flat on the floor)
      this.sprite(ctx, cam, "rug_round", 34, 92); this.sprite(ctx, cam, "rug_red", 206, 70); this.sprite(ctx, cam, "rug_s", 126, 144);
      // everything else, back to front
      const list = this.things.slice();
      const p = game.player;
      if (!game.lying) list.push({ y: p.y + p.h, draw: (c, cm) => p.draw(c, cm) });
      list.sort((a, b) => (a.wall ? -1 : 0) - (b.wall ? -1 : 0) || a.y - b.y);
      for (const d of list) d.draw(ctx, cam);
      if (game.nearestIn && game.nearestIn !== this.door) { const r = game.nearestIn; ctx.strokeStyle = "rgba(255,246,194,.8)"; ctx.setLineDash([5, 4]); ctx.lineWidth = 2; ctx.strokeRect(r.x + ox, r.y + oy, r.w, r.h); ctx.setLineDash([]); }
    }
  }

  /* ---------- what E does on each piece of furniture ---------- */
  const SAY = {
    stairs: "Stairs down to the cellar. The door is stuck... maybe next season.",
    shelf: "Jars, bowls and a few dusty pots. Nothing you need today.",
    books: "Farming almanacs and a half-read adventure novel.",
    wardrobe: "Your spare overalls. Same as the ones you're wearing.",
    potions: "Red for health, green for luck, yellow for... you forgot.",
    desk: "Seed catalogues and a list of chores. Most are crossed out.",
    weapons: "Your old training swords hang here. The village is safe for now.",
  };
  function act(game, spot) {
    const room = game.homeRoom, say = (t) => game.ui.popup({ cx: spot.cx, y: spot.y - 30 }, t);
    switch (spot.act) {
      case "door": game.leaveHome(); break;
      case "kitchen": game.toggleCooking(); break;
      case "eat": game.eatMeal(); break;
      case "bed": game.bedPress(spot.slot); break;
      default: say(SAY[spot.act] || "Cosy.");
    }
  }

  /* ---------- Game integration ---------- */
  Object.assign(Game.prototype, {
    enterHome() { if (this.fade) return; this.closeAllPanels(); this.fade = { phase: "out", t: 0, door: "in" }; },
    leaveHome() { if (this.fade || this.lying) return; this.fade = { phase: "out", t: 0, door: "out" }; },
    passDoor(dir) {
      const p = this.player;
      if (dir === "in") {
        const house = this.objects.find((o) => o instanceof House);
        this.outPos = house ? { x: house.doorX - p.w / 2, y: house.baseY + 30 } : { x: p.x, y: p.y };
        this.homeRoom = this.homeRoom || new Room();
        this.inside = this.homeRoom; this.lying = null; this.nearest = null;
        p.x = (DOOR.x + 16) * S - p.w / 2; p.y = (DOOR.y - 20) * S; p.dirKey = "up";
        this.ui.place = "Your Home";
        this.homeCam().follow(p, this.inside.world, 0, true);
      } else {
        this.inside = null; this.nearestIn = null;
        p.x = this.outPos.x; p.y = this.outPos.y; p.dirKey = "down"; this.unstick();
        this.ui.place = this.page.spec.name; this.beginPage();
      }
    },
    eatMeal() {
      if (this.mealDay === this.dayIndex) { this.showMessage("You're still full from today's meal. Come back tomorrow!"); return; }
      this.mealDay = this.dayIndex;
      this.energy = Math.min(CONFIG.MAX_ENERGY, this.energy + 45);
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + 25); this.player.startEating();
      this.showMessage("A warm home-cooked meal  +45 energy");
    },
    // E on the bed: first press lies down, second press sleeps. Moving gets you back up.
    bedPress(slot) {
      const room = this.inside, b = room.bed;
      if (this.lying) { this.sleep(); return; }
      if (!this.canSleep) { this.notTiredMessage(); return; }
      if (b.sleepers[slot]) slot = 1 - slot;
      if (b.sleepers[slot]) { this.showMessage("The bed is full"); return; }
      b.sleepers[slot] = this.player; this.lying = { slot };
      const [px, py] = room.pillowXY(slot); this.player.x = px - this.player.w / 2; this.player.y = py + 30;
      this.showMessage("Press E again to sleep  (move to get up)", 2200);
    },
    getUp() {
      const room = this.inside, l = this.lying; if (!l) return;
      room.bed.sleepers[l.slot] = null; this.lying = null;
      const sp = room.standPos(l.slot); this.player.x = sp.x; this.player.y = sp.y; this.player.dirKey = "down";
    },
    // the room fills the whole screen: zoom so it covers the window (a camera in room-space follows you)
    homeCam() {
      const c = this.camera, W = this.inside.world.width, H = this.inside.world.height, z = Math.max(c.w / W, c.h / H);
      const hc = this.hCam || (this.hCam = new Camera()); hc.resize(c.w / z, c.h / z); this.hZoom = z; return hc;
    },
    updateInside(dt) {
      const p = this.player, room = this.inside, inp = this.input;
      if (this.lying) {
        const a = inp.axis();
        if (a.x || a.y) this.getUp();
        else if (inp.wasPressed("e")) this.sleep();
        this.nearestIn = null; this.ui.setHint(this.lying ? "Press E — sleep until morning" : "");
      } else {
        p.hurtTimer = 0; p.attackTimer = Math.max(0, p.attackTimer - dt);
        p.update(dt, inp, room.world, room.solids);
        if (p.cy > (DOOR.y + 8) * S && inp.axis().y > 0) { this.leaveHome(); return; }
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
    renderInside() {
      const ctx = this.ctx, cam = this.homeCam(), room = this.inside;
      ctx.save(); ctx.scale(this.hZoom, this.hZoom);
      room.draw(ctx, cam, this);
      const lights = room.lights.slice(), p = this.player;
      lights.push({ x: p.cx, y: p.cy - 14, r: 120, c: [255, 214, 150], flick: true });
      FP.drawLighting(ctx, cam, Math.max(this.time, 6), this.weather === "storm" ? "cloud" : this.weather, lights);
      this.ui.drawPopups(ctx, cam); this.ui.drawFloaters(ctx, cam);
      ctx.restore();
    },
  });
  const wrap = (name, fn) => { const o = Game.prototype[name]; Game.prototype[name] = function (...a) { return fn.call(this, o, ...a); }; };
  // morning after sleeping in the bed: stay in the house, standing next to the bed
  wrap("doSleep", function (o, passedOut) {
    if (!this.inside) return o.call(this, passedOut);
    const room = this.inside, l = this.lying;
    this.closeAllPanels(); this.newDay();
    const p = this.player; p.hp = p.maxHp; p.dead = false; p.hurtTimer = 0;
    this.energy = passedOut ? Math.round(CONFIG.MAX_ENERGY * 0.6) : CONFIG.MAX_ENERGY;
    room.bed.sleepers = [null, null]; this.lying = null;
    const sp = room.standPos(l ? l.slot : 0); p.x = sp.x; p.y = sp.y; p.dirKey = "down";
    this.homeCam().follow(p, room.world, 0, true);
    this.saveGame(true);
    this.showMessage(`${this.date.weekday}. ${this.dateText()} - ${this.weather === "sun" ? "sunny" : this.weather}. Good morning!`);
  });
  wrap("useSelected", function (o, ...a) { if (this.inside) return; return o.apply(this, a); });

  return { Decor, AnimTree, Crow, House, Room, act };
})();
