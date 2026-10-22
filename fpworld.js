"use strict";
/* ==========================================================
   Moonlight Valley — the farm world (pages, trees, buildings, villagers, animals)
   Loaded after fp.js. The world is a 3x3 grid of map pages (72 x 56 tiles each).
   Walk off the end of a road and you arrive on the next page.

        Pine Forest    | Birch Meadow    | Oak Grove
        Willow Village | Moonlight Farm  | Sunny Beach
        Hale Farm      | South Crossing  | Skeleton Hollow

   Each page is a small spec (theme, terrain, what to place). Add content in a page's `layout(a)`.
   ========================================================== */

const WORLD = (() => {
  const { S, GRASS, PATH, WATER, img, ok, hash2, rng } = FP;
  const T = CONFIG.TILE;

  /* ---------- breakable scenery: what each thing is made of ----------
     hp    = hits to break it (an axe swing does 1 damage, a war axe 3, see PROP_DMG in game.js)
     drops = [item, min, max] — what falls out when it breaks (items are defined in ITEMS in game.js)
     fx    = colour of the chips that fly off when it is hit
     fall  = tilts over like a felled tree instead of popping
     matFor() maps a scenery sprite name to its recipe; it returns null for things that stay put
     (wells, houses, doormats...). Add a line here to make something new breakable. */
  const ROCK = "#a6b0c4", WOOD = "#bf6a4d", LEAF = "#5fae52";
  const mat = (hp, fx, ...drops) => ({ hp, fx, drops });
  function matFor(name) {
    const n = String(name);
    if (/^pebble/.test(n)) return mat(1, ROCK, ["stone", 1, 1]);
    if (/^rock_s/.test(n)) return mat(2, ROCK, ["stone", 1, 2]);
    if (/^rubble/.test(n)) return mat(2, ROCK, ["stone", 1, 3]);
    if (/^stone/.test(n)) return mat(3, ROCK, ["stone", 2, 3]);
    if (/^rock/.test(n)) return mat(4, ROCK, ["stone", 3, 4]);
    if (/^boulder/.test(n)) return mat(6, ROCK, ["stone", 4, 6]);
    if (/^flower/.test(n)) return mat(1, "#f08fb4", ["flower", 1, 1]);
    if (/^mush_big/.test(n)) return mat(1, "#d6483f", ["mushroom", 2, 3]);
    if (/^mush/.test(n)) return mat(1, "#d6483f", ["mushroom", 1, 1]);
    if (/^crates/.test(n)) return mat(3, WOOD, ["plank", 3, 4]);
    if (/^crate/.test(n)) return mat(2, WOOD, ["plank", 2, 2]);
    if (/^log/.test(n)) return mat(3, WOOD, ["wood", 2, 3]);
    if (/^stump/.test(n)) return mat(2, WOOD, ["wood", 1, 2]);
    if (/^bush/.test(n)) return mat(2, LEAF, ["stick", 1, 2], ["fiber", 1, 2]);
    if (/^(weed|grass)/.test(n)) return mat(1, LEAF, ["fiber", 1, 1]);
    if (/^scarecrow/.test(n)) return mat(3, "#d9a93f", ["fiber", 2, 3], ["stick", 1, 2]);
    if (/^(tree|oak|apple)/.test(n)) return { ...(/_s$/.test(n) ? mat(3, WOOD, ["wood", 2, 3], ["stick", 1, 1]) : mat(6, WOOD, ["wood", 5, 7], ["stick", 1, 2])), fall: true };
    if (n === "planter") return mat(3, WOOD, ["plank", 2, 2]);
    if (n === "fence_post") return mat(2, WOOD, ["stick", 1, 2]);
    if (n === "fence") return mat(2, WOOD, ["plank", 1, 1]);
    return null;
  }

  /* ---------- static scenery ---------- */
  class Prop { // y-sorted sprite whose collision box sits at its foot (y + h == baseY)
    constructor(cx, baseY, colW, colH, sprW = 48, sprH = 48) {
      this.cx0 = cx; this.baseY = baseY; this.w = colW; this.h = colH; this.x = cx - colW / 2; this.y = baseY - colH;
      this.hw = sprW / 2 + 14; this.sh = sprH + 14; this.solid = true;
    }
    resize(w, h) { this.w = w; this.h = h; this.x = this.cx0 - w / 2; this.y = this.baseY - h; }
    onScreen(cam) { return this.cx0 + this.hw > cam.x && this.cx0 - this.hw < cam.x + cam.w && this.baseY > cam.y && this.baseY - this.sh < cam.y + cam.h; }
  }
  const blit = (ctx, im, sx, sy, sw, sh, dx, dy, dw, dh) => {
    if (!ok(im)) return;
    const p = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = false;
    ctx.drawImage(im, sx, sy, sw, sh, Math.round(dx), Math.round(dy), dw, dh); ctx.imageSmoothingEnabled = p;
  };
  const shadow = (ctx, x, y, rx, ry, a = 0.2) => { ctx.fillStyle = `rgba(20,30,20,${a})`; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); };

  const TREE = { cols: [[14, 8], [20, 11], [26, 14]], hp: [1, 3, 6], wood: [1, 3, 7], age: [0, 3, 8], foot: 44, cx: 23 };
  class Tree extends Prop {
    constructor(area, kind, cx, baseY, stage = 2, age = null) {
      super(cx, baseY, TREE.cols[stage][0], TREE.cols[stage][1], 144, 144);
      Object.assign(this, { area, kind, stage, age: age == null ? TREE.age[stage] : age, hp: TREE.hp[stage], shake: 0, stump: false, fall: null, isTree: true });
    }
    setStage(s) { this.stage = s; this.hp = TREE.hp[s]; this.resize(...TREE.cols[s]); }
    update(dt) {
      if (this.shake > 0) this.shake = Math.max(0, this.shake - dt);
      if (this.fall) { this.fall.t += dt; if (this.fall.t >= 0.75) this.finishFall(); }
    }
    finishFall() {
      this.fall = null;
      if (this.stage === 2) { this.stump = true; this.hp = 2; this.age = 0; this.resize(18, 10); this.area.solids.push(this); }
      else this.area.removeTree(this);
    }
    // an axe swing lands: returns { wood } when something dropped
    hit(dmg, fromX) {
      if (this.fall) return null;
      this.shake = 0.28; this.hp -= dmg;
      if (this.hp > 0) return { hit: true };
      if (this.stump) { this.area.removeTree(this); return { wood: 1, hit: true, gone: true }; }
      const k = this.area.solids.indexOf(this); if (k >= 0) this.area.solids.splice(k, 1);   // it falls: no longer blocks anything
      this.fall = { t: 0, dir: this.cx0 >= fromX ? 1 : -1 };
      return { wood: TREE.wood[this.stage], hit: true, felled: true };
    }
    dayTick(game, r) {
      this.age++;
      if (this.stump) { if (this.age >= 6) this.area.removeTree(this); return; }
      const want = this.age >= TREE.age[2] ? 2 : this.age >= TREE.age[1] ? 1 : 0;
      if (want > this.stage) this.setStage(want);
      if (this.stage === 2 && r() < 0.1) this.area.trySeed(this, game.farm, r);
    }
    draw(ctx, cam) {
      const x = this.cx0 - cam.x, y = this.baseY - cam.y;
      if (this.stump) { blit(ctx, img[`stump_${this.kind}`], 0, 0, 16, 16, x - 24 + (this.shake ? Math.sin(this.shake * 60) * 2 : 0), y - 14 * S, 48, 48); return; }
      const im = img[`tree_${this.kind}_${FP.season}`];
      ctx.save(); ctx.translate(x, y);
      if (this.fall) {
        const t = this.fall.t / 0.75; ctx.rotate(this.fall.dir * Math.min(1.5, t * t * 1.9 + 0.04));
        ctx.globalAlpha = t > 0.75 ? Math.max(0, 1 - (t - 0.75) * 4) : 1;
      } else if (this.shake) ctx.translate(Math.sin(this.shake * 70) * 3 * (this.shake / 0.28), 0);
      blit(ctx, im, this.stage * 48, 0, 48, 48, -TREE.cx * S, -TREE.foot * S, 144, 144);
      ctx.restore();
    }
  }

  class Bush extends Prop {
    constructor(cx, baseY) { super(cx, baseY, 40, 16, 96, 96); }
    draw(ctx, cam) { blit(ctx, img[`bush_${FP.season}`], 0, 0, 32, 32, this.cx0 - cam.x - 16 * S, this.baseY - cam.y - 28 * S, 96, 96); }
  }
  class Planter extends Prop {
    constructor(cx, baseY, v) { super(cx, baseY, 56, 20, 96, 96); this.v = v; }
    draw(ctx, cam) { blit(ctx, img.planters, this.v * 32, 0, 32, 32, this.cx0 - cam.x - 16 * S, this.baseY - cam.y - 26 * S, 96, 96); }
  }
  class Fence extends Prop {
    constructor(kind, cx, baseY) {
      super(cx, baseY, kind === "v" ? 12 : kind === "post" ? 14 : 48, kind === "v" ? 48 : 8, 48, 60);
      this.kind = kind;
    }
    draw(ctx, cam) {
      const sfx = FP.season === "winter" ? "snow" : "warm", im = img[`fence_${this.kind}_${sfx}`];
      blit(ctx, im, 0, 0, 16, 20, this.cx0 - cam.x - 24, this.baseY - cam.y - 17 * S, 48, 60);
    }
  }
  class Lantern extends Prop {
    constructor(cx, baseY) { super(cx, baseY, 18, 10, 48, 48); this.light = { x: cx, y: baseY - 26, r: 190, c: [255, 190, 100], flick: true }; }
    draw(ctx, cam) { blit(ctx, img.lantern, 0, 0, 16, 16, this.cx0 - cam.x - 24, this.baseY - cam.y - 13 * S, 48, 48); }
  }

  /* ---------- buildings ---------- */
  const BLD = {
    house: { w: 64, door: 32, base: 55, wall: 27, wins: [[17, 38], [44, 38]] },
    barn: { w: 80, door: 40, base: 63, wall: 28, wins: [[15, 43], [63, 43]] },
    coop: { w: 44, door: 21, base: 41, wall: 18, wins: [[9, 25]] },
    shop: { w: 76, door: 53, base: 56, wall: 22, wins: [[24, 46]] },
    armory: { w: 76, door: 53, base: 56, wall: 22, wins: [[24, 46]] },
    well: { w: 24, door: 12, base: 31, wall: 17, wins: [] },
  };
  function nameTag(ctx, text, x, y, alpha = 1) {
    ctx.save(); ctx.globalAlpha = alpha; ctx.font = "bold 12px 'Trebuchet MS', sans-serif"; ctx.textAlign = "center";
    const w = ctx.measureText(text).width + 14;
    ctx.fillStyle = "rgba(40,28,20,0.82)"; ctx.fillRect(Math.round(x - w / 2), Math.round(y - 13), w, 18);
    ctx.fillStyle = "#fde6b2"; ctx.fillText(text, Math.round(x), Math.round(y)); ctx.restore();
  }
  let theGame = null;
  const nearP = (o, d) => theGame && Math.hypot(theGame.player.cx - o.cx, theGame.player.cy - o.cy) < d;

  class Building extends Interactable {
    constructor({ kind, color, tx, base, label, lines = [], role = "house", prompt }) {
      const M = BLD[kind], x = tx * T, baseY = base * T, w = M.w * S;
      const wallH = (M.base - M.wall) * S;
      super({ x: x + 6, y: baseY - wallH, w: w - 12, h: wallH, name: label, prompt: prompt || (role === "home" ? "Go to bed" : role === "shop" ? "Open shop" : role === "weapons" ? "Browse weapons" : "Knock"), solid: true });
      Object.assign(this, { kind, color, M, sx: x, baseY, label, lines, role, k: 0, sw: w });
      this.doorX = x + M.door * S;
      this.hl = { x: this.doorX - 30, y: baseY - 8, w: 60, h: 40 };
    }
    get cx() { return this.doorX; }
    get cy() { return this.baseY + 20; }
    get sprite() { return `bld_${this.kind === "house" ? "house_" + this.color : this.kind}_${FP.season === "winter" ? "snow" : "warm"}`; }
    lights() { return this.M.wins.map(([wx, wy]) => ({ x: this.sx + wx * S, y: this.baseY - (this.M.base - wy) * S, r: 105, c: [255, 196, 110] })); }
    onInteract(game) {
      if (this.role === "home") { if (!game.canSleep) { game.notTiredMessage(); return; } game.askConfirm("Go to bed and end the day?", () => game.sleep()); return; }
      if (this.role === "weapons") { if (game.isNight) { game.ui.popup({ cx: this.doorX, y: this.baseY - 90 }, "The forge is cold. Back at dawn!"); return; } game.openShopUI("weapons"); return; }
      if (this.role === "shop") { if (game.isNight) { game.ui.popup({ cx: this.doorX, y: this.baseY - 90 }, "Closed for the night. Come back at dawn!"); return; } game.openShopUI(); return; }
      if (this.role === "coop") { game.ui.popup({ cx: this.doorX, y: this.baseY - 90 }, "Cluck cluck... the hens are inside."); return; }
      const msg = this.lines.length ? this.lines[this.k++ % this.lines.length] : "Nobody answers.";
      game.ui.popup({ cx: this.doorX, y: this.baseY - 90 }, msg);
    }
    draw(ctx, cam) {
      const x = this.sx - cam.x, by = this.baseY - cam.y;
      shadow(ctx, x + this.sw / 2, by + 2, this.sw / 2 - 2, 10, 0.18);
      blit(ctx, img[this.sprite], 0, 0, this.M.w, img[this.sprite] ? img[this.sprite].naturalHeight : 0, x, by - this.M.base * S, this.sw, img[this.sprite] ? img[this.sprite].naturalHeight * S : 0);
      if (nearP(this, 330)) nameTag(ctx, this.label, x + this.sw / 2, by - this.M.base * S - 4, Math.min(1, (330 - Math.hypot(theGame.player.cx - this.cx, theGame.player.cy - this.cy)) / 110));
    }
  }

  class Well extends Interactable {
    constructor({ fx, fy }) { super({ x: fx - 30, y: fy - 22, w: 60, h: 22, name: "Well", prompt: "Refill watering can", solid: true }); this.fx = fx; this.fy = fy; }
    onInteract(game) { game.refillCan(); }
    draw(ctx, cam) {
      const x = this.fx - cam.x, y = this.fy - cam.y, im = img[`bld_well_${FP.season === "winter" ? "snow" : "warm"}`];
      shadow(ctx, x, y - 2, 34, 9, 0.2);
      if (ok(im)) blit(ctx, im, 0, 0, 24, 32, x - 36, y - 31 * S, 72, 96);
      if (nearP(this, 150)) nameTag(ctx, "Well", x, y - 100);
    }
  }
  class Kitchen extends Interactable {
    constructor({ fx, fy }) { super({ x: fx - 26, y: fy - 18, w: 52, h: 18, name: "Cooking Fire", prompt: "Cook", solid: true }); this.fx = fx; this.fy = fy; }
    onInteract(game) { game.toggleCooking(); }
    lights() { return [{ x: this.fx, y: this.fy - 26, r: 230, c: [255, 160, 70], flick: true }]; }
    draw(ctx, cam) {
      const x = this.fx - cam.x, y = this.fy - cam.y, f = Math.floor(performance.now() / 150) % 3;
      shadow(ctx, x, y - 3, 30, 8, 0.2);
      blit(ctx, img.kitchen, f * 28, 0, 28, 30, x - 14 * S, y - 28 * S, 84, 90);
      if (nearP(this, 150)) nameTag(ctx, "Cooking Fire", x, y - 100);
    }
  }
  class Sign extends Interactable {
    constructor({ fx, fy, text, frame = 0, label = "Sign" }) { super({ x: fx - 16, y: fy - 12, w: 32, h: 12, name: label, prompt: "Read sign", solid: true }); Object.assign(this, { fx, fy, text, frame }); }
    onInteract(game) { game.ui.popup({ cx: this.fx, y: this.fy - 80 }, this.text); }
    draw(ctx, cam) {
      const x = this.fx - cam.x, y = this.fy - cam.y;
      blit(ctx, img.signs, this.frame * 32, 0, 32, 32, x - 48, y - 29 * S, 96, 96);
    }
  }

  // Chests use the pack's chest animation: closed -> lid opens -> stays open
  Chest.prototype.draw = function (ctx, cam) {
    const im = img.chest, bx = this.x + this.w / 2 - cam.x, by = this.y + this.h - cam.y;
    let row = 0, f = 0;
    if (this.anim != null) { this.anim += 1 / 60; row = 2; f = Math.min(5, Math.floor(this.anim * 14)); if (this.anim > 0.5) this.anim = null; }
    else if (this.opened) row = 1;
    shadow(ctx, bx, by - 2, 24, 7, 0.18);
    blit(ctx, im, f * 32, row * 32, 32, 32, bx - 16 * S, by - 26 * S + 4, 96, 96);
    if (nearP(this, 140)) nameTag(ctx, this.name, bx, by - 70);
  };
  const chestInteract = Chest.prototype.onInteract;
  Chest.prototype.onInteract = function (game) { if (!this.opened) this.anim = 0; chestInteract.call(this, game); };

  TravelPoint.prototype.draw = function (ctx, cam) {
    const x = this.cx - cam.x, y = this.y + this.h - cam.y, t = performance.now() / 1000;
    shadow(ctx, x, y - 2, 20, 6, 0.2);
    if (this.unlocked) { ctx.fillStyle = `rgba(143,211,196,${0.12 + Math.sin(t * 3) * 0.05})`; ctx.beginPath(); ctx.ellipse(x, y - 4, 38, 14, 0, 0, 6.3); ctx.fill(); }
    blit(ctx, img.signs, 3 * 32, 0, 32, 32, x - 48, y - 29 * S, 96, 96);
    if (nearP(this, 140)) nameTag(ctx, this.unlocked ? this.travelName : "Way-point", x, y - 100);
  };

  /* ---------- villagers ---------- */
  function npcMove(e, dx, dy, world, solids, self, player) {
    let hit = false;
    e.x = Math.min(Math.max(0, e.x + dx), world.width - e.w);
    for (const s of solids) if (s !== self && e.overlaps(s)) { e.x = dx >= 0 ? s.x - e.w : s.x + s.w; hit = true; }
    if (e.overlaps(player)) { e.x = dx > 0 ? player.x - e.w : player.x + player.w; hit = true; }
    e.y = Math.min(Math.max(0, e.y + dy), world.height - e.h);
    for (const s of solids) if (s !== self && e.overlaps(s)) { e.y = dy > 0 ? s.y - e.h : s.y + s.h; hit = true; }
    if (e.overlaps(player)) { e.y = dy > 0 ? player.y - e.h : player.y + player.h; hit = true; }
    return hit;
  }
  class Npc extends Interactable {
    constructor({ variant, name, fx, fy, behavior = "wander", lines = ["..."], radius = 90, speed = 38, path = null }) {
      super({ x: fx - 11, y: fy - 14, w: 22, h: 14, name, prompt: `Talk to ${name}`, solid: true });
      Object.assign(this, { variant, lines, behavior, radius, speed, path, home: { x: fx, y: fy }, tx: fx, ty: fy, timer: Math.random() * 2, pi: 0, dir: "down", t: Math.random() * 5, moving: false, stuck: 0, working: false });
    }
    getLines(game) { return typeof this.lines === "function" ? this.lines(game) : this.lines; }
    onInteract(game) { game.openDialog(this); }
    setDir(dx, dy) { if (Math.abs(dx) > Math.abs(dy)) this.dir = dx < 0 ? "left" : "right"; else if (dy) this.dir = dy < 0 ? "up" : "down"; }
    // bedtime: walk to the nearest house door and go inside; back out at dawn
    goToBed(dt, game, solids) {
      if (!this.bed) {
        let best = null, bd = 1e9;
        for (const o of game.objects) if (o.doorX && ["house", "shop", "barn", "weapons"].includes(o.role)) { const d = Math.hypot(o.doorX - this.cx, o.baseY - this.y); if (d < bd) { bd = d; best = o; } }
        this.bed = best ? { x: best.doorX, y: best.baseY + 14 } : { x: this.home.x, y: this.home.y };
      }
      const fy = this.y + this.h, dx = this.bed.x - this.cx, dy = this.bed.y - fy, d = Math.hypot(dx, dy);
      if (d < 14 || (this.stuck += dt) > 14) { this.asleep = true; this.solid = false; this.moving = false; this.stuck = 0; return; }
      if (npcMove(this, (dx / d) * this.speed * 1.9 * dt, (dy / d) * this.speed * 1.9 * dt, game.world, solids, this, game.player)) this.stuck += dt * 3;
      this.setDir(dx, dy); this.moving = true; this.t += dt;
    }
    update(dt, game, solids) {
      if (game.time >= 19.5) { if (!this.asleep) this.goToBed(dt, game, solids); return; }
      if (this.asleep) { this.asleep = false; this.solid = true; this.bed = null; this.stuck = 0; }
      const p = game.player, dp = Math.hypot(p.cx - this.cx, p.cy - this.cy), fy = this.y + this.h;
      let moving = false; const spd = this.speed;
      this.working = false;
      if (dp < 80) this.setDir(p.cx - this.cx, p.cy - fy);
      else if (this.behavior === "patrol" && this.path) {
        const w = this.path[this.pi], dx = w[0] - this.cx, dy = w[1] - fy, d = Math.hypot(dx, dy);
        if (d < 6) this.pi = (this.pi + 1) % this.path.length;
        else { if (npcMove(this, (dx / d) * spd * dt, (dy / d) * spd * dt, game.world, solids, this, p)) { this.stuck += dt; if (this.stuck > 0.6) { this.pi = (this.pi + 1) % this.path.length; this.stuck = 0; } } moving = true; this.setDir(dx, dy); }
      } else if (this.behavior === "work") { // tends the field: bends over to plant every few seconds
        this.working = Math.floor(this.t / 3.2) % 2 === 1; this.dir = "down";
      } else if (this.behavior === "wander") {
        this.timer -= dt;
        if (this.timer <= 0) {
          this.timer = 1.5 + Math.random() * 3.5;
          if (Math.random() < 0.55) { const a = Math.random() * 6.283, r = Math.random() * this.radius; this.tx = this.home.x + Math.cos(a) * r; this.ty = this.home.y + Math.sin(a) * r; }
          else { this.tx = this.cx; this.ty = fy; }
        }
        const dx = this.tx - this.cx, dy = this.ty - fy, d = Math.hypot(dx, dy);
        if (d > 4) { if (npcMove(this, (dx / d) * spd * dt, (dy / d) * spd * dt, game.world, solids, this, p)) this.timer = 0; moving = true; this.setDir(dx, dy); }
      }
      this.moving = moving; this.t += dt;
    }
    draw(ctx, cam) {
      if (this.asleep) return;
      const fx = this.cx - cam.x, fy = this.y + this.h - cam.y;
      shadow(ctx, fx, fy + 1, 17, 6, 0.25);
      let anim = this.moving ? "walk" : this.working ? "plant" : "idle";
      const fps = anim === "walk" ? 9 : anim === "plant" ? 5 : 3;
      FP.drawChar(ctx, "farmer", this.variant, anim, this.dir, (this.t * fps) % FP.animLen("farmer", anim), fx, fy, 4);
      if (nearP(this, 210)) nameTag(ctx, this.name, fx, fy - 92, Math.min(1, (210 - Math.hypot(theGame.player.cx - this.cx, theGame.player.cy - this.cy)) / 80));
    }
  }

  /* ---------- hens and eggs ---------- */
  class Hen extends Interactable {
    constructor({ fx, fy, pen, variant = "white" }) {
      super({ x: fx - 9, y: fy - 10, w: 18, h: 10, name: "Hen", prompt: "Feed hen", solid: false });
      Object.assign(this, { variant, pen, fed: false, flip: false, t: Math.random() * 9, mode: "idle", modeT: Math.random() * 2, vx: 0, vy: 0, heart: 0 });
    }
    onInteract(game) {
      const dp = { cx: this.cx, y: this.y - 40 };
      if (this.fed) { this.heart = 1.6; game.ui.popup(dp, "Cluck! She's happy."); return; }
      if (game.inventory.countOf("wheat") > 0 || game.inventory.countOf("seeds") > 0) {
        game.inventory.removeById(game.inventory.countOf("wheat") > 0 ? "wheat" : "seeds", 1);
        this.fed = true; this.heart = 2; game.refreshPanels(); game.ui.popup(dp, "Fed! She'll lay an egg tonight."); game.burst(this.cx, this.y, "#f7de7b", 6);
      } else game.ui.popup(dp, "She's hungry. Bring wheat or seeds.");
    }
    update(dt, game, solids) {
      this.asleep = game.time >= 19.5; if (this.asleep) return;   // hens roost in the coop at night
      this.t += dt; this.modeT -= dt; if (this.heart > 0) this.heart -= dt;
      if (this.modeT <= 0) {
        const r = Math.random();
        if (r < 0.45) { this.mode = "walk"; const a = Math.random() * 6.283; this.vx = Math.cos(a) * 26; this.vy = Math.sin(a) * 18; this.modeT = 0.8 + Math.random() * 1.6; }
        else if (r < 0.75) { this.mode = "peck"; this.vx = this.vy = 0; this.modeT = 1 + Math.random(); }
        else { this.mode = "idle"; this.vx = this.vy = 0; this.modeT = 1 + Math.random() * 2; }
      }
      if (this.mode === "walk") {
        const ox = this.x, oy = this.y; moveWithCollision(this, this.vx * dt, this.vy * dt, game.world, solids);
        const [x0, y0, x1, y1] = this.pen;
        if (this.cx < x0 || this.cx > x1) { this.x = ox; this.vx = -this.vx; }
        if (this.y + this.h < y0 || this.y + this.h > y1) { this.y = oy; this.vy = -this.vy; }
        if (Math.abs(this.vx) > 1) this.flip = this.vx < 0;
      }
    }
    draw(ctx, cam) {
      if (this.asleep) return;
      const x = this.cx - cam.x, y = this.y + this.h - cam.y, im = img[`chicken_${this.variant}`];
      shadow(ctx, x, y - 1, 14, 5, 0.22);
      const f = this.mode === "walk" ? [0, 1, 3, 4][Math.floor(this.t * 8) % 4] : this.mode === "peck" ? [0, 2, 2, 0][Math.floor(this.t * 4) % 4] : 0;
      if (ok(im)) {
        ctx.save(); ctx.translate(Math.round(x), Math.round(y)); if (this.flip) ctx.scale(-1, 1);
        ctx.imageSmoothingEnabled = false; ctx.drawImage(im, f * 32, 0, 32, 24, -16 * S, -19 * S, 96, 72); ctx.restore();
      }
      if (this.heart > 0) { ctx.fillStyle = "#ff6b8a"; ctx.font = "bold 16px sans-serif"; ctx.textAlign = "center"; ctx.globalAlpha = Math.min(1, this.heart); ctx.fillText("♥", x, y - 52 - (2 - Math.min(2, this.heart)) * 8); ctx.globalAlpha = 1; }
    }
  }
  class Egg extends Interactable {
    constructor({ fx, fy }) { super({ x: fx - 8, y: fy - 8, w: 16, h: 8, name: "Egg", prompt: "Collect egg", solid: false }); this.t = Math.random() * 6; }
    onInteract(game) { if (game.giveItem("egg", 1, this.cx, this.y - 6)) game.removeObject(this); }
    draw(ctx, cam) {
      const x = this.cx - cam.x, y = this.y + this.h - cam.y;
      shadow(ctx, x, y, 11, 4, 0.2);
      blit(ctx, img.ic_egg, 0, 0, 16, 16, x - 16, y - 28 + Math.sin(this.t + performance.now() / 500) * 1.2, 32, 32);
    }
  }

  /* ---------- Area: one 72 x 56 map page ---------- */
  const ROAD_H = [26, 28], ROAD_V = [34, 36];
  const inGrid = (gx, gy) => gx >= -1 && gx <= 1 && gy >= -1 && gy <= 1;
  function exitSpan(gx, gy, dir) {
    const d = { N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0] }[dir];
    if (!inGrid(gx + d[0], gy + d[1])) return null;
    return dir === "W" || dir === "E" ? ROAD_H : ROAD_V;
  }
  const DIRS4 = ["N", "S", "W", "E"];
  const pickFrom = (r, a) => a[Math.floor(r() * a.length)];
  const THEMES = {
    meadow: { base: GRASS, kinds: ["oak", "oak", "birch", "birch", "pine"], ring: ["pine", "pine", "oak", "birch"], flowers: 150, bushes: 12 },
    farm:   { base: GRASS, kinds: ["oak", "birch", "birch", "oak", "pine"], ring: ["pine", "oak", "pine", "birch"], flowers: 190, bushes: 10 },
    birch:  { base: GRASS, kinds: ["birch", "birch", "birch", "oak", "birch"], ring: ["birch", "birch", "oak", "pine"], flowers: 300, bushes: 16 },
    forest: { base: GRASS, kinds: ["pine", "pine", "pine", "pine", "oak"], ring: ["pine"], flowers: 60, bushes: 14 },
    grove:  { base: GRASS, kinds: ["oak", "oak", "oak", "birch", "oak"], ring: ["oak", "oak", "pine"], flowers: 160, bushes: 14 },
    beach:  { base: PATH, kinds: ["oak", "pine"], ring: ["oak", "pine"], flowers: 0, bushes: 22, noRing: true },
    hollow: { base: GRASS, kinds: ["pine", "pine", "oak", "pine"], ring: ["pine", "pine", "oak"], flowers: 25, bushes: 8 },
  };

  class Area {
    constructor(world, spec) {
      this.world = world; this.W = CONFIG.MAP_W; this.H = CONFIG.MAP_H; this.T = T; this.spec = spec;
      this.exits = {}; for (const d of DIRS4) { const s = exitSpan(spec.gx, spec.gy, d); if (s) this.exits[d] = s; }
      this.ter = new Uint8Array(this.W * this.H); this.res = new Uint8Array(this.W * this.H); this.shade = new Uint8Array(this.W * this.H);
      this.solids = []; this.props = []; this.trees = []; this.flowers = []; this.lights = [];
      this.anims = []; this.brokenIds = new Set();   // breakable scenery: props mid-shake/pop, ids already broken
      this.rand = rng(spec.seed); this.theme = THEMES[spec.theme || "meadow"]; this.baseT = this.theme.base;
      this.spawn = { x: (spec.spawn ? spec.spawn[0] : 35) * T, y: (spec.spawn ? spec.spawn[1] : 24) * T };
      this.paint(); this.layout(); this.nature(); this.armBreakables(); this.waterSolids();
      this.props.sort((a, b) => a.baseY - b.baseY);
      this.ground = new FP.Ground(this);
    }
    idx(x, y) { return y * this.W + x; }
    typeAt(tx, ty) { return tx < 0 || ty < 0 || tx >= this.W || ty >= this.H ? -1 : this.ter[this.idx(tx, ty)]; }
    nearExit(px, py) {
      const tx = px / T, ty = py / T, W = this.W, H = this.H, e = this.exits;
      return (e.N && ty < 7 && tx > e.N[0] - 3 && tx < e.N[1] + 4) || (e.S && ty > H - 7 && tx > e.S[0] - 3 && tx < e.S[1] + 4) ||
             (e.W && tx < 7 && ty > e.W[0] - 3 && ty < e.W[1] + 4) || (e.E && tx > W - 7 && ty > e.E[0] - 3 && ty < e.E[1] + 4);
    }
    safe(px, py) {
      if (WORLD.nightNow) return false;   // at night monsters roam everywhere, villages included
      if (this.nearExit(px, py)) return true;
      const tx = px / T, ty = py / T;
      return this.safeRects.some((r) => tx > r[0] && tx < r[2] && ty > r[1] && ty < r[3]);
    }
    farmable(tx, ty) {
      if (this.typeAt(tx, ty) !== GRASS) return false;
      const r = { x: tx * T + 4, y: ty * T + 4, w: T - 8, h: T - 8 };
      return !this.solids.some((s) => r.x < s.x + s.w && r.x + r.w > s.x && r.y < s.y + s.h && r.y + r.h > s.y);
    }
    reserve(x0, y0, x1, y1) { for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(this.H - 1, Math.floor(y1)); y++) for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(this.W - 1, Math.floor(x1)); x++) this.res[this.idx(x, y)] = 1; }
    reserveExits() {
      const e = this.exits, W = this.W, H = this.H;
      if (e.N) this.reserve(e.N[0] - 1, 0, e.N[1] + 1, 7); if (e.S) this.reserve(e.S[0] - 1, H - 8, e.S[1] + 1, H - 1);
      if (e.W) this.reserve(0, e.W[0] - 1, 7, e.W[1] + 1); if (e.E) this.reserve(W - 8, e.E[0] - 1, W - 1, e.E[1] + 1);
    }

    /* ---------- terrain: base + roads to every exit + the page's own features ---------- */
    paint() {
      const sp = this.spec, W = this.W, H = this.H, e = this.exits, base = this.baseT;
      this.ter.fill(base);
      const set = (x, y, t) => { if (x >= 0 && y >= 0 && x < W && y < H) this.ter[y * W + x] = t; };
      const rect = (x0, y0, x1, y1, t = PATH) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, t); };
      const blob = (cx, cy, rx, ry, t = PATH) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry; if (dx * dx + dy * dy + Math.sin(x * 1.7 + y * 1.1) * 0.05 < 1) set(x, y, t); } };
      const road = base === PATH ? GRASS : PATH; // sand pages get grassy lanes instead
      rect(e.W ? 0 : ROAD_V[0], ROAD_H[0], e.E ? W - 1 : ROAD_V[1], ROAD_H[1], road);
      rect(ROAD_V[0], e.N ? 0 : ROAD_H[0], ROAD_V[1], e.S ? H - 1 : ROAD_H[1], road);
      const lake = (cx, cy, rx, ry, beach = base === GRASS) => {
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry, q = dx * dx + dy * dy + Math.sin(x * 1.3 + y * 0.9) * 0.06;
          if (q < 1) set(x, y, WATER); else if (beach && q < 1.75 && this.ter[y * W + x] === base) set(x, y, PATH);
        }
      };
      if (sp.terrain) sp.terrain({ set, rect, blob, lake });
      for (let i = 0; i < this.ter.length; i++) if (this.ter[i] !== base) this.res[i] = 1;
    }

    /* ---------- layout: houses, NPCs, chests ... placed through this small API ---------- */
    layout() {
      const sp = this.spec;
      Object.assign(this, { buildingSpecs: [], npcSpecs: [], signSpecs: [], chestSpecs: [], objSpecs: [], safeRects: [], henSpecs: [], hurdles: [], homeSpecs: [] });
      const bw = (kind) => BLD[kind].w / 16;
      const api = {
        house: (color, tx, base, label, lines = [], role = "house") => { this.buildingSpecs.push({ kind: "house", color, tx, base, label, lines, role }); this.reserve(tx - 1, base - 5, tx + bw("house") + 1, base + 2); },
        shop: (tx, base, label) => { this.buildingSpecs.push({ kind: "shop", tx, base, label, role: "shop" }); this.reserve(tx - 1, base - 5, tx + bw("shop") + 1, base + 2); },
        armory: (tx, base, label) => { this.buildingSpecs.push({ kind: "armory", tx, base, label, role: "weapons" }); this.reserve(tx - 1, base - 5, tx + bw("armory") + 1, base + 2); },
        barn: (tx, base, label, lines = []) => { this.buildingSpecs.push({ kind: "barn", tx, base, label, lines, role: "barn", prompt: "Look inside" }); this.reserve(tx - 1, base - 6, tx + bw("barn") + 1, base + 2); },
        coop: (tx, base, pen, hens = 3, variants = ["white", "white", "brown"]) => {
          this.buildingSpecs.push({ kind: "coop", tx, base, label: "Chicken Coop", role: "coop", prompt: "Peek inside" });
          this.henSpecs.push({ pen: pen.map((v) => v * T), hens, variants, coop: [tx, base] }); this.reserve(pen[0] - 1, pen[1] - 4, pen[2] + 1, pen[3] + 1);
        },
        well: (tx, ty) => { this.objSpecs.push({ k: "well", fx: tx * T, fy: ty * T }); this.reserve(tx - 2, ty - 3, tx + 2, ty + 1); },
        kitchen: (tx, ty) => { this.objSpecs.push({ k: "kitchen", fx: tx * T, fy: ty * T }); this.reserve(tx - 2, ty - 3, tx + 2, ty + 1); },
        npc: (variant, name, tx, ty, o = {}) => this.npcSpecs.push({ variant, name, tx, ty, ...o }),
        sign: (tx, ty, text, frame = 0) => { this.signSpecs.push({ tx, ty, text, frame }); this.reserve(tx - 1, ty - 2, tx + 1, ty + 0.5); },
        chest: (tx, ty, name, loot, coins = 0) => { this.chestSpecs.push({ tx, ty, name, loot, coins }); this.reserve(tx - 1.5, ty - 2, tx + 1.5, ty + 1); },
        lantern: (tx, ty) => { const p = new Lantern(tx * T, ty * T); this.props.push(p); this.solids.push(p); this.lights.push(p.light); },
        bush: (tx, ty) => { const p = new Bush(tx * T, ty * T); this.props.push(p); this.solids.push(p); },
        planter: (tx, ty, v = 0) => { const p = new Planter(tx * T, ty * T, v); this.props.push(p); this.solids.push(p); },
        fenceRect: (x0, y0, x1, y1, gaps = []) => this.fenceRect(x0, y0, x1, y1, gaps),
        safe: (x0, y0, x1, y1) => this.safeRects.push([x0, y0, x1, y1]),
        reserve: (...a) => this.reserve(...a),
        homeHouse: (tx, base) => { this.homeSpecs.push({ tx, base }); this.reserve(tx - 1, base - 9, tx + 9.5, base + 2); },
        decor: (name, tx, ty, o = {}) => { const p = new HomeKit.Decor(name, tx * T, ty * T, o); this.props.push(p); if (p.solid) this.solids.push(p); },
        animTree: (n, tx, ty) => { const p = new HomeKit.AnimTree(n, tx * T, ty * T); this.props.push(p); this.solids.push(p); },
        crow: (tx, ty) => { this.props.push(new HomeKit.Crow(tx * T, ty * T)); },
      };
      if (sp.layout) sp.layout(api);
      this.reserveExits();
      for (let y = 0; y < this.H; y++) for (let x = 0; x < this.W; x++) if (this.res[this.idx(x, y)])  // tiles south of open ground: no tall canopies there
        for (let dy = 0; dy <= 4; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < this.W && yy < this.H) this.shade[this.idx(xx, yy)] = 1; }
    }
    fenceRect(x0, y0, x1, y1, gaps) {
      const inGap = (side, t) => gaps.some(([s, a, b]) => s === side && t >= a && t <= b);
      const add = (kind, cx, by) => { const p = new Fence(kind, cx, by); this.props.push(p); this.solids.push(p); };
      for (let tx = x0; tx < x1; tx++) {
        if (!inGap("N", tx)) add("h", (tx + 0.5) * T, y0 * T + 34);
        if (!inGap("S", tx)) add("h", (tx + 0.5) * T, y1 * T + 34);
      }
      for (let ty = y0; ty < y1; ty++) {
        if (!inGap("W", ty)) add("v", x0 * T + 24, (ty + 1) * T + 4);
        if (!inGap("E", ty)) add("v", x1 * T + 24, (ty + 1) * T + 4);
      }
      for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) add("post", x * T + 24, y * T + 38);
      this.reserve(x0, y0 - 1, x1, y1 + 1);
    }

    /* ---------- trees ---------- */
    free(tx, ty) { return this.typeAt(tx, ty) === this.baseT && this.baseT === GRASS && !this.res[this.idx(tx, ty)]; }
    addTree(kind, px, py, stage, spacing, scatter, age = null) {
      const tx = Math.floor(px / T), ty = Math.floor(py / T);
      if (this.typeAt(tx, ty) !== GRASS || this.res[this.idx(tx, ty)]) return null;
      if (scatter && this.shade[this.idx(tx, ty)]) return null;
      for (const t of this.trees) if (Math.hypot(t.cx0 - px, (t.baseY - py) * 1.3) < spacing) return null;
      const t = new Tree(this, kind, px, py, stage, age); this.trees.push(t); this.props.push(t); this.solids.push(t);
      return t;
    }
    removeTree(t) {
      for (const list of [this.trees, this.props, this.solids]) { const i = list.indexOf(t); if (i >= 0) list.splice(i, 1); }
    }

    /* ---------- breakable scenery (everything except the trees, which chop themselves) ---------- */
    // Called once the page is laid out: give every prop that is made of something a recipe, a stable id
    // (kind + position — pages are generated from a fixed seed, so the same id comes back next time, which is how
    // "already broken" survives saving) and a draw() that shakes / pops when it is hit.
    armBreakables() {
      const Decor = typeof HomeKit !== "undefined" && HomeKit.Decor, Anim = typeof HomeKit !== "undefined" && HomeKit.AnimTree;
      for (const p of this.props) {
        if (p.isTree || p.brk !== undefined) continue;
        let kind = null;
        if (p instanceof Bush) kind = "bush";
        else if (p instanceof Planter) kind = "planter";
        else if (p instanceof Fence) kind = p.kind === "post" ? "fence_post" : "fence";
        else if (Anim && p instanceof Anim) kind = "tree";
        else if (Decor && p instanceof Decor) kind = p.name;
        const m = kind && matFor(kind);
        if (!m) continue;
        Object.assign(p, { brk: m, bhp: m.hp, shake: 0, pop: null, bid: `${kind}@${Math.round(p.cx0)},${Math.round(p.baseY)}` });
        const base = p.draw;
        p.draw = function (ctx, cam) {
          if (!this.shake && !this.pop) return base.call(this, ctx, cam);
          const x = this.cx0 - cam.x, y = this.baseY - cam.y;
          ctx.save();
          if (this.pop) {
            const u = Math.min(1, this.pop.t / this.pop.dur);
            ctx.translate(x, y);
            if (this.pop.fall) { ctx.rotate(this.pop.dir * Math.min(1.5, u * u * 1.9 + 0.04)); ctx.globalAlpha = u > 0.75 ? Math.max(0, 1 - (u - 0.75) * 4) : 1; }
            else { ctx.scale(1 + 0.25 * u, 1 - 0.7 * u); ctx.globalAlpha = 1 - u; }
            ctx.translate(-x, -y);
          } else ctx.translate(Math.sin(this.shake * 70) * 3 * (this.shake / 0.28), 0);
          base.call(this, ctx, cam);
          ctx.restore();
        };
      }
    }
    // the breakable prop whose foot box overlaps the swing rectangle (the nearest one to its centre)
    propAt(rect) {
      const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2, pad = 8;
      let best = null, bd = Infinity;
      for (const p of this.props) {
        if (!p.brk || p.pop) continue;
        if (p.x - pad >= rect.x + rect.w || p.x + p.w + pad <= rect.x || p.y - pad >= rect.y + rect.h || p.y + p.h + pad <= rect.y) continue;
        const d = Math.hypot(p.cx0 - cx, p.baseY - p.h / 2 - cy);
        if (d < bd) { bd = d; best = p; }
      }
      return best;
    }
    // A hit lands on a prop. Returns { broken, drops: [[item, qty], ...] }; the prop stops blocking the moment it breaks.
    hitProp(p, dmg, fromX) {
      p.shake = 0.28; p.bhp -= dmg;
      if (!this.anims.includes(p)) this.anims.push(p);
      if (p.bhp > 0) return { broken: false, drops: [] };
      const k = this.solids.indexOf(p); if (k >= 0) this.solids.splice(k, 1);
      if (p.light) { const l = this.lights.indexOf(p.light); if (l >= 0) this.lights.splice(l, 1); }
      p.pop = { t: 0, dur: p.brk.fall ? 0.75 : 0.22, fall: !!p.brk.fall, dir: p.cx0 >= fromX ? 1 : -1 };
      this.brokenIds.add(p.bid);
      return { broken: true, drops: p.brk.drops.map(([id, lo, hi]) => [id, lo + Math.floor(Math.random() * (hi - lo + 1))]) };
    }
    // take a broken prop out of the world with no animation (used when loading a save)
    vanish(p) { for (const list of [this.props, this.solids, this.anims]) { const i = list.indexOf(p); if (i >= 0) list.splice(i, 1); } }
    tickProps(dt) {
      for (const p of this.anims.slice()) {
        if (p.shake > 0) p.shake = Math.max(0, p.shake - dt);
        if (p.pop && (p.pop.t += dt) >= p.pop.dur) { p.pop = null; this.vanish(p); continue; }
        if (!p.shake && !p.pop) this.anims.splice(this.anims.indexOf(p), 1);
      }
    }
    // A scattered wildflower (area.flowers) inside the swing rectangle. They are painted into the ground layer, not props.
    flowerAt(rect, season = FP.season) {
      const keep = season === "winter" ? 0 : season === "autumn" ? 0.3 : 1;   // same visibility rule the ground painter uses
      if (!keep) return null;
      for (const f of this.flowers) {
        if (f.gone || hash2(f.tx * 13, f.ty * 7) > keep || this.ter[f.ty * this.W + f.tx] !== GRASS) continue;
        const x = (f.tx * 16 + f.ox) * 3 + 6, y = (f.ty * 16 + f.oy) * 3 + 6;   // the sprite is 16 art px, drawn x3; use its middle 36px
        if (x < rect.x + rect.w && x + 36 > rect.x && y < rect.y + rect.h && y + 36 > rect.y) return { f, x: x + 18, y: y + 30 };
      }
      return null;
    }
    pickFlower(h) { h.f.gone = true; this.ground.refreshGrass(FP.season); }
    exportBroken() { return { broken: [...this.brokenIds], fgone: this.flowers.reduce((l, f, k) => (f.gone ? l.concat(k) : l), []) }; }
    importBroken(sv) {
      const ids = new Set(sv.broken || []);
      for (const p of this.props.slice()) if (p.bid && ids.has(p.bid)) { this.vanish(p); this.brokenIds.add(p.bid); if (p.light) { const l = this.lights.indexOf(p.light); if (l >= 0) this.lights.splice(l, 1); } }
      for (const k of sv.fgone || []) if (this.flowers[k]) this.flowers[k].gone = true;
      this.ground.invalidate();
    }
    trySeed(parent, farm, r) {
      if (this.trees.length > 700) return;
      for (let k = 0; k < 6; k++) {
        const a = r() * 6.283, d = 70 + r() * 90, px = parent.cx0 + Math.cos(a) * d, py = parent.baseY + Math.sin(a) * d * 0.7;
        const tx = Math.floor(px / T), ty = Math.floor(py / T);
        if (px < 40 || py < 40 || px > this.W * T - 40 || py > this.H * T - 40) continue;
        if (!this.farmable(tx, ty) || (farm && (farm.hasSoil(tx, ty) || farm.cropAt(tx, ty)))) continue;
        if (this.shade[this.idx(tx, ty)] && this.res[this.idx(tx, ty)]) continue;
        const t = this.addTree(parent.kind, px, py, 0, 70, false); if (t) { this.props.sort((p, q) => p.baseY - q.baseY); return; }
      }
    }
    exportTrees() { return this.trees.map((t) => [t.kind[0], Math.round(t.cx0), Math.round(t.baseY), t.stage, t.age, t.stump ? 1 : 0]); }
    importTrees(list) {
      for (const t of this.trees.slice()) this.removeTree(t);
      const K = { o: "oak", b: "birch", p: "pine" };
      for (const [k, x, y, stage, age, stump] of list) {
        const t = new Tree(this, K[k], x, y, stage, age); this.trees.push(t); this.props.push(t); this.solids.push(t);
        if (stump) { t.stump = true; t.hp = 2; t.resize(18, 10); }
      }
      this.props.sort((a, b) => a.baseY - b.baseY);
    }

    nature() {
      const W = this.W, H = this.H, r = this.rand, th = this.theme, sp = this.spec;
      if (th.base === GRASS) {
        if (!th.noRing) for (let y = 0.4; y < H; y += 1.1) for (let x = 0.4; x < W; x += 1.25) { // border forest, open only where the roads leave
          const d = Math.min(x, y, W - x, H - y); if (d > (sp.ringDepth || 3.4) || r() < 0.12) continue;
          this.addTree(pickFrom(r, th.ring), (x + r() * 0.8) * T, (y + r() * 0.6) * T, 2, 40, false);
        }
        const want = sp.trees == null ? 60 : sp.trees, have = this.trees.length;
        for (let n = 0; n < 5000 && this.trees.length < have + want; n++) {
          const x = (4 + r() * (W - 8)) * T, y = (4 + r() * (H - 8)) * T, st = r() < 0.72 ? 2 : r() < 0.6 ? 1 : 0;
          this.addTree(pickFrom(r, th.kinds), x, y, st, sp.spacing || 140, true);
        }
      }
      for (let n = 0, placed = 0; n < 1500 && placed < (sp.bushes == null ? th.bushes : sp.bushes); n++) {
        const tx = 3 + Math.floor(r() * (W - 6)), ty = 3 + Math.floor(r() * (H - 6)), t = this.typeAt(tx, ty);
        if (t === WATER || this.res[this.idx(tx, ty)] || (t !== this.baseT)) continue;
        const px = (tx + 0.5) * T, py = (ty + 0.9) * T;
        if (this.trees.some((q) => Math.hypot(q.cx0 - px, q.baseY - py) < 70) || this.props.some((q) => q instanceof Bush && Math.hypot(q.cx0 - px, q.baseY - py) < 90)) continue;
        const b = new Bush(px, py); this.props.push(b); this.solids.push(b); placed++;
      }
      const nf = sp.flowers == null ? th.flowers : sp.flowers;
      for (let n = 0; n < 4000 && this.flowers.length < nf; n++) {
        const tx = Math.floor(r() * W), ty = Math.floor(r() * H);
        if (this.typeAt(tx, ty) !== GRASS || (this.res[this.idx(tx, ty)] && r() < 0.9)) continue;
        this.flowers.push({ tx, ty, col: Math.floor(r() * 6), kind: Math.floor(r() * 3), ox: Math.floor(r() * 5) - 2, oy: Math.floor(r() * 5) - 2 });
      }
    }
    waterSolids() {
      for (let y = 0; y < this.H; y++) for (let x = 0; x < this.W; x++) {
        if (this.ter[this.idx(x, y)] !== WATER) continue;
        let x1 = x; while (x1 + 1 < this.W && this.ter[this.idx(x1 + 1, y)] === WATER) x1++;
        this.solids.push({ x: x * T, y: y * T, w: (x1 - x + 1) * T, h: T }); x = x1;
      }
    }
    // is the tile (or the one next to it) open water? (used to refill the watering can)
    nearWater(tx, ty) { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (this.typeAt(tx + dx, ty + dy) === WATER) return true; return false; }
    visibleProps(cam) { return this.props.filter((p) => p.onScreen(cam)); }
    treeAt(rect) { return this.trees.find((t) => !t.fall && t.x < rect.x + rect.w && t.x + t.w > rect.x && t.y < rect.y + rect.h && t.y + t.h > rect.y); }
    updateTrees(dt) { for (const t of this.trees.slice()) if (t.shake > 0 || t.fall) t.update(dt); this.tickProps(dt); }

    /* ---------- everything the player can walk up to ---------- */
    makeObjects(game) {
      theGame = game; const out = [];
      for (const b of this.buildingSpecs) out.push(new Building(b));
      for (const h of this.homeSpecs) out.push(new HomeKit.House(h));
      for (const o of this.objSpecs) out.push(o.k === "well" ? new Well(o) : new Kitchen(o));
      for (const s of this.signSpecs) out.push(new Sign({ fx: s.tx * T, fy: s.ty * T, text: s.text, frame: s.frame }));
      for (const c of this.chestSpecs) out.push(new Chest({ x: c.tx * T - 22, y: c.ty * T - 17, w: 44, h: 34, name: c.name, loot: c.loot, coins: c.coins }));
      for (const n of this.npcSpecs) out.push(new Npc({ ...n, fx: n.tx * T, fy: n.ty * T, path: n.path && n.path.map(([x, y]) => [x * T, y * T]) }));
      for (const h of this.henSpecs) for (let i = 0; i < h.hens; i++) {
        const [x0, y0, x1, y1] = h.pen;
        out.push(new Hen({ fx: x0 + 30 + Math.random() * (x1 - x0 - 60), fy: y0 + 70 + Math.random() * (y1 - y0 - 100), pen: [x0 + 20, y0 + 40, x1 - 20, y1 - 14], variant: h.variants[i % h.variants.length] }));
      }
      return out;
    }
  }

  /* ======================================================
     The pages. Coordinates are tiles (48 px). Roads cross at (34-36, 26-28).
     ====================================================== */
  const pages = {
    "0,0": { name: "Moonlight Farm", theme: "farm", seed: 20240607, spawn: [42.3, 24.8], trees: 30, mobs: { small: 0, big: 0, max: 0 }, home: true,
      travels: [{ name: "Moonlight Farm", tx: 38.2, ty: 29.7 }],
      terrain: (t) => { t.lake(58, 43, 7, 5); t.rect(41, 23, 43, 26); t.rect(40, 23, 44, 23); t.rect(47, 23, 48, 26); },
      layout: (a) => {
        a.homeHouse(36.2, 22);
        a.barn(46, 22, "Barn", ["The barn smells of hay. Nothing to store yet.", "Tools hang neatly on the wall."]);
        a.coop(56, 20.5, [53, 17, 62, 24.6], 3, ["white", "brown", "white"]);
        a.fenceRect(52.5, 15.8, 62.5, 25, [["W", 23, 24]]);
        a.well(31, 24.5); a.kitchen(38, 24.8);
        a.lantern(40.3, 22.8); a.lantern(44.3, 22.8); a.lantern(33, 25.3); a.lantern(52, 22.6);
        a.planter(38.4, 23.0, 0); a.planter(45.2, 23.0, 2);
        a.sign(33.2, 25.4, "Moonlight Farm - hoe the grass, plant seeds, chop trees, feed the hens. Walk to your front door and press E to go inside: eat, then sleep in the big bed to end the day.", 0);
        a.animTree(3, 33.4, 20.6); a.animTree(7, 34.6, 15.8); a.animTree(4, 47.4, 14.4);
        a.decor("bush_c", 35.6, 22.2, { cw: 40, ch: 16 }); a.decor("bush_d", 45.7, 22.0, { cw: 34, ch: 14 });
        a.decor("flower_a", 39.6, 22.9, { solid: false }); a.decor("flower_b", 41, 23.1, { solid: false }); a.decor("flower_c", 43.6, 23.0, { solid: false }); a.decor("flower_d", 44.9, 23.2, { solid: false });
        a.decor("crates", 35.2, 24.7, { cw: 44, ch: 20 }); a.decor("log_fall", 47.6, 25.6, { cw: 60, ch: 14 }); a.decor("stump_b", 49.2, 26.6, { cw: 40, ch: 16 });
        a.decor("rock_b", 51.4, 28.8, { cw: 50, ch: 20 }); a.decor("mush_b", 50.4, 27.8, { solid: false }); a.decor("mush_a", 36.2, 26.6, { solid: false });
        a.decor("scarecrow", 8.2, 30.8, { cw: 30, ch: 14 }); a.decor("stone_a", 30.2, 28.4, { cw: 34, ch: 14 }); a.decor("well", 46.6, 29.4, { cw: 60, ch: 22 });
        a.crow(40.4, 23.9); a.crow(46.2, 24.4);
        a.reserve(30, 24, 52, 31);
        a.chest(31.6, 31, "Toolshed Chest", [{ id: "seeds", qty: 8 }, { id: "tomato_seeds", qty: 3 }, { id: "wood", qty: 6 }], 25);
        a.reserve(6, 30, 31, 52); a.reserve(38, 29, 50, 33);
        a.fenceRect(5, 29, 32, 52, [["E", 30, 33], ["N", 20, 23], ["N", 29, 31]]);
        a.npc("elder", "Grandpa Orrin", 34.6, 23.4, { behavior: "stand", lines: (g) => [
          "Welcome to the farm, kiddo! The soil is yours to work.",
          "Pick the hoe with 1-0 or the mouse wheel, face a patch of grass and press Space to till it.",
          "Plant seeds on tilled soil, water them with the can, and they'll grow a little each night while you sleep.",
          "The axe cuts trees - small ones fall fast, big ones take a few swings. Wood sells well at the General Store west of here.",
          g.weather === "rain" ? "Rain's a blessing - it waters every crop for you." : "Fill the can at the well or the pond. Chickens love wheat, too!" ] });
        a.npc("wren", "Farmer Wren", 20, 41, { behavior: "work", lines: (g) => ["I'm sowing the far field. Seasons turn every " + CONFIG.SEASON_DAYS + " days, so plan your crops!", "Wheat likes spring through autumn. Tomatoes love the warm months and keep giving fruit.", "Nothing grows in winter - chop wood and look after the hens instead."] });
        a.npc("blond", "Little Ivy", 47, 29.5, { radius: 120, speed: 34, lines: ["Have you met the hens? Feed them and they'll lay an egg every night!", "I want to see snow. Is it winter yet?"] });
        a.safe(0, 0, 72, 56);
      } },

    "-1,0": { name: "Willow Village", theme: "farm", seed: 4404, trees: 22, mobs: { small: 0, big: 0, max: 0 }, spawn: [35, 30],
      travels: [{ name: "Willow Village", tx: 32.4, ty: 29.9 }],
      terrain: (t) => { t.blob(35, 27, 6.2, 5.2); t.rect(28, 23, 30, 26); t.rect(42, 23, 43, 26); t.rect(20, 34, 22, 38); t.rect(7, 23, 9, 26); t.rect(7, 26, 30, 27); },
      layout: (a) => {
        a.armory(5, 22, "Ironleaf Armory"); a.lantern(9.2, 22.4);
        a.npc("dark", "Smith Brann", 12.4, 24.6, { behavior: "stand", lines: ["Welcome to the Ironleaf Armory! Blades, bows and a few loud things that go bang.", "Daggers are quick, spears reach far, the War Axe hits like a falling tree.", "Bows and crossbows need arrows and bolts; pistols and shotguns need bullets and shells. Buy ammo here too.", "Hold a weapon in your hotbar, then click toward a monster - ranged weapons fire where you aim."] });
        a.house("red", 14, 22, "Hale Cottage", ["Smells like fresh bread inside.", "Boots by the door, still muddy."]);
        a.shop(26, 22, "General Store");
        a.house("green", 40, 22, "Willow Cottage", ["A cat naps in the window.", "Someone is humming inside."]);
        a.house("plum", 48, 22, "Mayor's House", ["The mayor is out on his rounds.", "A notice: 'Harvest festival soon!'"]);
        a.house("blue", 19, 36, "Blue Cottage", ["Curtains twitch as you pass."]);
        a.house("red", 41, 36, "Baker's House", ["Warm butter and flour drift out."]);
        a.well(31, 30.2); a.kitchen(47, 30);
        a.lantern(30.4, 22.4); a.lantern(39, 22.4); a.lantern(35, 33); a.lantern(24.8, 22.4);
        a.planter(25, 21.7, 1); a.planter(33, 24.3, 2); a.planter(37.4, 24.3, 0);
        a.sign(33.2, 25.3, "Willow Village - General Store: crops, seeds, tools. Ironleaf Armory (far west): weapons and ammo.", 1);
        a.npc("blond", "Marnie", 29.5, 24.4, { behavior: "stand", lines: (g) => ["Welcome to the General Store! Seeds, bread and supplies.", "I'll buy anything you grow - wheat, tomatoes, eggs, even firewood.", g.season === 3 ? "Winter is slow. Wood and eggs are all anyone has to sell." : "Fresh crops sell best in season!"] });
        a.npc("elder", "Mayor Lewis", 39, 29.5, { radius: 140, speed: 28, lines: (g) => ["Today is " + g.dateText() + ". A fine day for a stroll!", "Our village has a farm, a forest and a beach. Explore them all."] });
        a.npc("violet", "Penny", 34, 31, { radius: 110, lines: ["I love the chickens at Hale Farm - they're the fluffiest!", "Mind the skeletons in the forest after dark."] });
        a.npc("dark", "Cookie Rosa", 46, 31.6, { behavior: "stand", lines: ["I cook over this fire all day. Press C to see what you can make!", "Bread, fried eggs, tomato stew - all hearty food. Eating restores energy."] });
        a.chest(22, 41, "Village Chest", [{ id: "potion", qty: 1 }, { id: "tomato_seeds", qty: 2 }], 20);
        a.safe(0, 0, 72, 56);
      } },

    "1,0": { name: "Sunny Beach", theme: "beach", seed: 5505, trees: 0, bushes: 26, mobs: { small: 3, big: 0, max: 4 }, spawn: [30, 30],
      travels: [{ name: "Sunny Beach", tx: 33, ty: 30.2 }],
      terrain: (t) => { t.rect(0, 0, 18, 55, GRASS); t.blob(8, 12, 12, 9, GRASS); t.blob(10, 44, 14, 9, GRASS); t.lake(70, 28, 21, 31, false); t.lake(48, 44, 5, 3.5, false); },
      layout: (a) => {
        a.house("plum", 40, 22, "Beach Hut", ["Sand everywhere. Surfboards by the door.", "A hammock swings inside."]);
        a.lantern(39.6, 22.6); a.lantern(44.4, 22.6);
        a.sign(33.2, 30.6, "Sunny Beach - mind the skeletons beyond the dunes.", 2);
        a.npc("dark", "Fisher Willy", 52, 31, { behavior: "stand", lines: (g) => ["I've fished this beach for forty years. The fish are shy today.", "The sea is too deep to wade. Don't try it.", g.season === 0 ? "Spring tide is the best." : "Beautiful weather for sitting by the water."] });
        a.chest(54, 18, "Washed-up Chest", [{ id: "gem", qty: 1 }, { id: "bread", qty: 2 }], 60);
        a.chest(44, 48, "Dune Chest", [{ id: "potion", qty: 1 }, { id: "tomato_seeds", qty: 3 }], 35);
        a.safe(33, 24, 56, 34);
      } },

    "0,-1": { name: "Birch Meadow", theme: "birch", seed: 1101, trees: 90, mobs: { small: 4, big: 1, max: 7 }, spawn: [35, 40],
      travels: [{ name: "Birch Meadow", tx: 33, ty: 30.2 }],
      terrain: (t) => t.lake(55, 40, 6.5, 4.5),
      layout: (a) => {
        a.house("green", 14, 22, "Lumberjack's Cabin", ["Wood chips cover the porch.", "An axe leans on the wall."]);
        a.lantern(13.6, 22.6);
        a.npc("dark", "Lumberjack Gus", 21.5, 25, { behavior: "wander", radius: 60, lines: (g) => ["Trees regrow if you give them time - seedlings sprout beside the big ones.", "Chop a young tree for wood quick, or work on a full-grown one for a big haul.", g.season === 3 ? "Snow's good for dragging logs." : "Nothing like the smell of fresh-cut birch."] });
        a.chest(46, 36, "Hollow Chest", [{ id: "sword", qty: 1 }, { id: "wood", qty: 8 }], 30);
        a.sign(33.2, 30.3, "Birch Meadow - chop trees for wood. Skeletons roam at night.", 1);
        a.safe(28, 22, 42, 32);
      } },

    "-1,-1": { name: "Pine Forest", theme: "forest", seed: 2202, trees: 170, spacing: 110, mobs: { small: 6, big: 3, max: 12 }, spawn: [35, 40],
      travels: [{ name: "Pine Forest", tx: 38, ty: 30 }],
      layout: (a) => {
        a.kitchen(46, 30);
        a.npc("teal", "Ranger Ivy", 43, 31, { behavior: "stand", lines: ["Careful in the pines. Skeletons crawl out when the sun goes down.", "Keep your sword handy, and warm up at the cooking fire."] });
        a.chest(26, 38, "Ranger's Chest", [{ id: "potion", qty: 2 }, { id: "wood", qty: 5 }], 30);
        a.sign(33.2, 30.3, "Pine Forest - evergreen all year, skeletons all night.", 1);
        a.safe(40, 24, 52, 34);
      } },

    "1,-1": { name: "Oak Grove", theme: "grove", seed: 3303, trees: 85, mobs: { small: 5, big: 1, max: 8 }, spawn: [35, 40],
      travels: [{ name: "Oak Grove", tx: 33, ty: 30.2 }],
      terrain: (t) => t.lake(18, 40, 7, 5),
      layout: (a) => {
        a.house("plum", 44, 22, "Hermit's Cottage", ["The hermit hums an old song inside.", "Acorns litter the roof."]);
        a.lantern(43.6, 22.6); a.lantern(48.4, 22.6);
        a.npc("elder", "Hermit Orin", 41, 26.5, { behavior: "stand", lines: ["The oaks here turn gold in autumn and bare in winter... well, white.", "Oak wood is as good as any. Swing hard!"] });
        a.chest(55, 42, "Acorn Chest", [{ id: "gem", qty: 1 }, { id: "seeds", qty: 4 }], 40);
        a.sign(33.2, 30.3, "Oak Grove - the leaves change with the seasons.", 2);
        a.safe(36, 20, 52, 30);
      } },

    "-1,1": { name: "Hale Farm", theme: "farm", seed: 6606, trees: 30, mobs: { small: 0, big: 0, max: 0 }, spawn: [35, 24],
      travels: [{ name: "Hale Farm", tx: 38, ty: 30 }],
      terrain: (t) => { t.rect(20, 23, 21, 26); t.rect(26, 23, 27, 26); },
      layout: (a) => {
        a.house("blue", 18, 22, "Hale Farmhouse", ["Fresh eggs on the table.", "Dinner smells wonderful."]);
        a.barn(25, 22, "Hale's Barn", ["Hay bales stacked to the ceiling.", "Moo? No - this barn only has hay."]);
        a.coop(43, 20.5, [40, 16, 49, 23.6], 4, ["brown", "gold", "white", "brown"]);
        a.fenceRect(39.5, 14.8, 49.5, 24, [["W", 22, 23]]);
        a.lantern(17.6, 22.6); a.lantern(22.4, 22.6); a.well(32, 24);
        a.reserve(6, 30, 30, 50); a.fenceRect(5, 29, 31, 51, [["E", 30, 33], ["N", 17, 21], ["N", 28, 30]]);
        a.sign(33.2, 25.4, "Hale Farm - eggs and good company.", 0);
        a.npc("blond", "Farmer Hale", 14, 40, { behavior: "work", lines: ["These hens are the pride of the farm. Feed them wheat every day.", "A fed hen lays one egg every night. Eggs sell for good money!"] });
        a.npc("violet", "Farmhand Ivy", 37, 30, { radius: 120, lines: ["I water the far field every morning.", "Golden hens lay just as many eggs as the white ones."] });
        a.chest(45, 36, "Barn Chest", [{ id: "seeds", qty: 6 }, { id: "tomato_seeds", qty: 3 }], 15);
        a.safe(0, 0, 72, 56);
      } },

    "0,1": { name: "South Crossing", theme: "meadow", seed: 7707, trees: 65, mobs: { small: 4, big: 1, max: 6 }, spawn: [35, 24],
      travels: [{ name: "South Crossing", tx: 38, ty: 30 }],
      terrain: (t) => { t.blob(35, 27, 6, 5); t.rect(20, 23, 22, 26); },
      layout: (a) => {
        a.shop(18, 22, "Crossroads Trader");
        a.house("blue", 46, 22, "Roadside Inn", ["Snoring. Loudly.", "A sign: 'Rooms full - try the barn.'"]);
        a.kitchen(31, 30.5); a.lantern(29.6, 25.3); a.lantern(40.4, 25.3); a.lantern(17.6, 22.6); a.planter(41, 24.4, 1);
        a.npc("teal", "Wanderer Mara", 39, 30, { radius: 80, lines: ["Four roads meet here. North is the farm, south the skeleton hollow.", "The trader pays well for tomatoes in summer."] });
        a.npc("dark", "Trader Pip", 20.5, 24.6, { behavior: "stand", lines: ["Seeds, supplies, the odd gem. Take a look!"] });
        a.chest(52, 38, "Cart Chest", [{ id: "bread", qty: 2 }, { id: "potion", qty: 1 }], 25);
        a.sign(33.2, 25.3, "South Crossing - the trader buys what you grow.", 1);
        a.safe(24, 21, 44, 33);
      } },

    "1,1": { name: "Skeleton Hollow", theme: "hollow", seed: 8808, trees: 110, spacing: 120, mobs: { small: 8, big: 6, max: 14 }, spawn: [35, 24],
      travels: [{ name: "Skeleton Hollow", tx: 38, ty: 25 }],
      layout: (a) => {
        a.sign(33.2, 25.3, "Skeleton Hollow - turn back unless you carry a sword.", 2);
        a.chest(52, 40, "Hollow Chest", [{ id: "sword", qty: 1 }, { id: "gem", qty: 2 }], 90);
        a.chest(20, 42, "Buried Chest", [{ id: "potion", qty: 2 }, { id: "gem", qty: 1 }], 60);
        a.safe(31, 22, 41, 30);
      } },
  };
  for (const [id, sp] of Object.entries(pages)) { const [gx, gy] = id.split(",").map(Number); Object.assign(sp, { id, gx, gy }); }
  const travelDefs = [];
  for (const sp of Object.values(pages)) for (const t of sp.travels || []) travelDefs.push({ ...t, page: sp.id });

  return { Prop, matFor, blit, shadow, nameTag, nearP, pages, Area, Tree, Hen, Egg, Npc, travelDefs, order: Object.keys(pages), exitSpan, TREE };
})();
