"use strict";
/* ==========================================================
   Moonlight Valley — Pixel Farm RPG layer (core)
   Loaded after game.js. Art comes from assets/fp/* (built by tools/build_farm_assets.py).

     FP.img / FP.ok     image cache
     FP.date / weather  calendar, seasons, deterministic weather per day
     FP.drawChar        animated characters (farmers, skeletons)
     Ground             pre-rendered terrain: dual-grid autotiling (water, sand/path, grass) per season
     Farm               tilled soil, watering, crops (per map page)
     FP.drawWeather / FP.drawLighting   rain, snow, day-night with light sources
   ========================================================== */

const FP = (() => {
  const S = 3;                 // 16px art drawn x3 = one 48px game tile
  const TILE16 = 16;
  const GRASS = 0, PATH = 1, WATER = 2;
  const SEASONS = ["spring", "summer", "autumn", "winter"];
  const SEASON_NAMES = ["Spring", "Summer", "Autumn", "Winter"];
  const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  /* ---------- images ---------- */
  const img = {};
  const load = (n) => img[n] || (img[n] = Object.assign(new Image(), { src: `assets/fp/${n}.png` }));
  const ok = (im) => !!im && im.complete && im.naturalWidth > 0;
  const NAMES = [];
  for (const s of SEASONS) NAMES.push(`grass_${s}`, `beach_${s}`, `bush_${s}`, `tree_oak_${s}`, `tree_birch_${s}`, `tree_pine_${s}`);
  NAMES.push("soil_dry", "soil_wet", "crop_wheat", "crop_tomato", "crop_wheat_dead", "crop_tomato_dead", "chest", "flowers", "planters", "signs", "lantern", "kitchen",
    "stump_oak", "stump_birch", "stump_pine", "ic_egg");
  for (const v of ["wren", "blond", "dark", "elder", "violet", "teal"]) NAMES.push(`npc_${v}`);
  for (const v of ["bone", "violet", "ember"]) NAMES.push(`skel_${v}`);
  for (const v of ["white", "brown", "gold"]) NAMES.push(`chicken_${v}`);
  for (const sfx of ["warm", "snow"]) {
    for (const k of ["house_red", "house_blue", "house_green", "house_plum", "barn", "coop", "shop", "armory", "well"]) NAMES.push(`bld_${k}_${sfx}`);
    NAMES.push(`fence_h_${sfx}`, `fence_post_${sfx}`, `fence_v_${sfx}`);
  }
  NAMES.forEach(load);

  /* ---------- tiny helpers ---------- */
  const hash2 = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >> 13)) * 1274126177; return ((h ^ (h >> 16)) >>> 0) / 4294967295; };
  const rng = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

  /* ---------- calendar + weather ---------- */
  function date(dayIndex) {
    const sd = CONFIG.SEASON_DAYS, s = Math.floor(dayIndex / sd) % 4;
    return { season: s, seasonKey: SEASONS[s], seasonName: SEASON_NAMES[s], day: (dayIndex % sd) + 1, year: Math.floor(dayIndex / (4 * sd)) + 1, weekday: DAY_NAMES[dayIndex % 7], index: dayIndex };
  }
  const WEATHER_ODDS = [ // cumulative: sun, cloud, rain, storm | snow
    [["sun", .50], ["cloud", .65], ["rain", .92], ["storm", 1]],
    [["sun", .62], ["cloud", .74], ["rain", .90], ["storm", 1]],
    [["sun", .42], ["cloud", .64], ["rain", .92], ["storm", 1]],
    [["sun", .42], ["cloud", .58], ["snow", 1]],
  ];
  function weatherFor(dayIndex) {
    if (dayIndex < 2) return "sun";
    const r = hash2(dayIndex * 7919, 17), odds = WEATHER_ODDS[date(dayIndex).season];
    return odds.find(([, p]) => r < p)[0];
  }

  /* ---------- sprite sheets: characters ---------- */
  const SHEETS = {
    farmer:   { pre: "npc_",  cw: 24, ch: 24, foot: 21, cx: 12, anims: { idle: [0, 4], walk: [3, 8], plant: [6, 7] } },
    skeleton: { pre: "skel_", cw: 48, ch: 38, foot: 23, cx: 24, anims: { idle: [0, 4], walk: [3, 8], attack: [6, 4], hurt: [9, 4], death: [12, 6] } },
  };
  const scratch = document.createElement("canvas"); scratch.width = scratch.height = 160;
  const sg = scratch.getContext("2d");
  // draws a character cell with its feet at (fx, fy); side art faces right (flip = face left)
  function drawChar(ctx, kind, variant, anim, dirKey, frame, fx, fy, scale, tint) {
    const sh = SHEETS[kind], im = img[sh.pre + variant];
    if (!sh || !ok(im)) return;
    const a = sh.anims[anim], n = a[1];
    const dirRow = anim === "death" ? 0 : dirKey === "up" ? 2 : dirKey === "down" ? 0 : 1;
    const f = Math.min(n - 1, Math.max(0, Math.floor(frame))) % n;
    const dw = sh.cw * scale, dh = sh.ch * scale, flip = dirKey === "left";
    const dx = -sh.cx * scale, dy = -sh.foot * scale;
    ctx.save(); ctx.imageSmoothingEnabled = false; ctx.translate(Math.round(fx), Math.round(fy)); if (flip) ctx.scale(-1, 1);
    if (tint) {
      sg.clearRect(0, 0, 160, 160); sg.imageSmoothingEnabled = false;
      sg.drawImage(im, f * sh.cw, (a[0] + dirRow) * sh.ch, sh.cw, sh.ch, 0, 0, dw, dh);
      sg.globalCompositeOperation = "source-atop"; sg.fillStyle = tint; sg.fillRect(0, 0, dw, dh); sg.globalCompositeOperation = "source-over";
      ctx.drawImage(scratch, 0, 0, dw, dh, dx, dy, dw, dh);
    } else ctx.drawImage(im, f * sh.cw, (a[0] + dirRow) * sh.ch, sh.cw, sh.ch, dx, dy, dw, dh);
    ctx.restore();
  }
  const animLen = (kind, anim) => SHEETS[kind].anims[anim][1];

  /* ---------- Ground: pre-rendered terrain, rebuilt when the season changes ---------- */
  const bit = (cond, b) => (cond ? b : 0);
  class Ground {
    constructor(area) { this.a = area; this.key = null; this.base = null; this.grass = null; }
    ready(season) { return ok(img[`grass_${season}`]) && ok(img[`beach_${season}`]); }
    invalidate() { this.key = null; this.base = null; this.grass = null; }
    // Which of the 4 tiles around grid corner (i, j) pass `fn` (bit mask; 15 = all four, i.e. open meadow).
    mask(i, j, fn) {
      const a = this.a, W = a.W, H = a.H, ter = a.ter;
      const at = (x, y) => ter[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];
      return bit(fn(at(i - 1, j - 1)), 1) | bit(fn(at(i, j - 1)), 2) | bit(fn(at(i - 1, j)), 4) | bit(fn(at(i, j)), 8);
    }
    build(season) { this.buildBase(season); this.buildGrass(season); this.key = season; }
    buildBase(season) {
      const a = this.a, W = a.W, H = a.H, ter = a.ter, B = img[`beach_${season}`];
      const mk = (i, j, fn) => this.mask(i, j, fn);
      const isLand = (t) => t !== WATER;
      const hasWater = ter.indexOf(WATER) >= 0, nf = hasWater ? 6 : 1;
      this.base = [];
      for (let f = 0; f < nf; f++) {
        const c = document.createElement("canvas"); c.width = W * 16; c.height = H * 16;
        const g = c.getContext("2d"); g.imageSmoothingEnabled = false;
        for (let j = 0; j <= H; j++) for (let i = 0; i <= W; i++) {
          let m = mk(i, j, isLand), col = m;
          if (m === 15) { const h = hash2(i + 91, j + 7); if (h < 0.07) col = 16 + Math.floor(h / 0.07 * 6) % 6; }
          g.drawImage(B, col * 16, f * 16, 16, 16, i * 16 - 8, j * 16 - 8, 16, 16);
        }
        this.base.push(c);
      }
    }
    // The grass layer (grass edges, tufts, baked-in flowers, the area's ground flowers). Rebuilt on its own when a flower is picked.
    buildGrass(season) {
      const a = this.a, W = a.W, H = a.H, G = img[`grass_${season}`];
      const mk = (i, j, fn) => this.mask(i, j, fn);
      const isGrass = (t) => t === GRASS;
      const gc = document.createElement("canvas"); gc.width = W * 16; gc.height = H * 16;
      const g = gc.getContext("2d"); g.imageSmoothingEnabled = false;
      const flowerP = [0.016, 0.011, 0.0035, 0][SEASONS.indexOf(season)], tuftP = season === "winter" ? 0.03 : 0.05;
      for (let j = 0; j <= H; j++) for (let i = 0; i <= W; i++) {
        const m = mk(i, j, isGrass); if (!m) continue;
        let col = m;
        if (m === 15) {
          const h = hash2(i * 3 + 5, j * 5 + 11);
          if (h < tuftP) col = 16 + (h < tuftP / 2 ? 0 : 1);
          else if (h > 1 - flowerP) col = 18 + (h > 1 - flowerP / 2 ? 0 : 1);
        }
        g.drawImage(G, col * 16, 0, 16, 16, i * 16 - 8, j * 16 - 8, 16, 16);
      }
      // ground flowers (spring/summer, a few in autumn): baked into the grass layer
      const FL = img.flowers, keep = season === "winter" ? 0 : season === "autumn" ? 0.3 : 1;
      if (ok(FL)) for (const f of a.flowers) {
        if (f.gone) continue;
        if (hash2(f.tx * 13, f.ty * 7) > keep) continue;
        if (a.ter[f.ty * W + f.tx] !== GRASS) continue;
        g.drawImage(FL, f.col * 16, f.kind * 16, 16, 16, f.tx * 16 + f.ox, f.ty * 16 + f.oy, 16, 16);
      }
      this.grass = gc;
    }
    // repaint just the grass layer (a flower was picked) without redoing the water/sand frames
    refreshGrass(season) { if (this.base && this.ready(season)) this.buildGrass(season); }
    draw(ctx, cam, time, season) {
      if (this.key !== season || !this.base) {
        if (!this.ready(season)) { ctx.fillStyle = "#57bd49"; ctx.fillRect(0, 0, cam.w, cam.h); return; }
        this.build(season);
      }
      const nf = this.base.length, c = this.base[nf > 1 ? Math.floor(time * 4.5) % nf : 0], gc = this.grass;
      const sx = Math.max(0, Math.floor(cam.x / S)), sy = Math.max(0, Math.floor(cam.y / S));
      const sw = Math.min(c.width - sx, Math.ceil(cam.w / S) + 2), sh = Math.min(c.height - sy, Math.ceil(cam.h / S) + 2);
      const prev = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = false;
      const dx = Math.round(sx * S - cam.x), dy = Math.round(sy * S - cam.y);
      ctx.drawImage(c, sx, sy, sw, sh, dx, dy, sw * S, sh * S);
      ctx.drawImage(gc, sx, sy, sw, sh, dx, dy, sw * S, sh * S);
      ctx.imageSmoothingEnabled = prev;
    }
  }

  /* ---------- Farm: soil, water and crops for one map page ---------- */
  // crop ids: 1 = wheat, 2 = tomato (see CROPS in game.js for rules)
  class Farm {
    constructor() {
      this.cols = CONFIG.MAP_W; this.rows = CONFIG.MAP_H;
      const n = this.cols * this.rows;
      this.soil = new Uint8Array(n);   // 1 = tilled
      this.wet = new Uint8Array(n);    // 1 = watered today
      this.crop = new Uint8Array(n);   // crop id (0 = none)
      this.grown = new Uint8Array(n);  // days of growth
      this.flag = new Uint8Array(n);   // 1 = withered, 2 = regrowing after a harvest
      this.since = new Float32Array(n).fill(-1); // in-game time (days*24 + hour) when a tilled tile became empty; -1 = no reset timer
    }
    // Tilled soil that stays empty for one full in-game day (24 hours of the game clock) reverts to plain ground.
    // Tiles with a plant (growing, ripe, regrowing or withered) and untouched ground never reset.
    expire(now) {
      let n = 0;
      for (let i = 0; i < this.soil.length; i++) {
        if (!this.soil[i] || this.crop[i] || this.since[i] < 0) continue;
        if (now - this.since[i] >= FP.RESET_HOURS - 1e-3) { this.soil[i] = 0; this.wet[i] = 0; this.since[i] = -1; n++; }
      }
      return n;
    }
    // (re)start the timer on tilled-empty tiles that have none (old saves)
    arm(now) { for (let i = 0; i < this.soil.length; i++) if (this.soil[i] && !this.crop[i] && this.since[i] < 0) this.since[i] = now; }
    hoursLeft(tx, ty) { const i = this.idx(tx, ty); if (!this.hasSoil(tx, ty) || this.crop[i] || this.since[i] < 0) return null; return Math.max(0, FP.RESET_HOURS - (FP.absTime() - this.since[i])); }
    idx(tx, ty) { return ty * this.cols + tx; }
    inside(tx, ty) { return tx >= 0 && ty >= 0 && tx < this.cols && ty < this.rows; }
    tileAt(px, py) { return { tx: Math.floor(px / CONFIG.TILE), ty: Math.floor(py / CONFIG.TILE) }; }
    hasSoil(tx, ty) { return this.inside(tx, ty) && this.soil[this.idx(tx, ty)] === 1; }
    till(tx, ty) { const i = this.idx(tx, ty); if (!this.inside(tx, ty) || this.soil[i]) return false; this.soil[i] = 1; this.since[i] = FP.absTime(); return true; }
    water(tx, ty) { const i = this.idx(tx, ty); if (!this.hasSoil(tx, ty) || this.wet[i]) return false; this.wet[i] = 1; return true; }
    cropAt(tx, ty) { return this.inside(tx, ty) ? this.crop[this.idx(tx, ty)] : 0; }
    plant(tx, ty, id) { const i = this.idx(tx, ty); if (!this.hasSoil(tx, ty) || this.crop[i]) return false; this.crop[i] = id; this.grown[i] = 0; this.flag[i] = 0; this.since[i] = -1; return true; }
    daysNeeded(id) { return CROPS[CROP_IDS[id]].days; }
    isRipe(tx, ty) { const i = this.idx(tx, ty); return this.inside(tx, ty) && this.crop[i] > 0 && !(this.flag[i] & 1) && this.grown[i] >= this.daysNeeded(this.crop[i]); }
    isDead(tx, ty) { return this.inside(tx, ty) && this.crop[this.idx(tx, ty)] > 0 && !!(this.flag[this.idx(tx, ty)] & 1); }
    harvest(tx, ty) {
      if (!this.isRipe(tx, ty)) return 0;
      const i = this.idx(tx, ty), id = this.crop[i], def = CROPS[CROP_IDS[id]];
      if (def.regrow) { this.grown[i] = def.days - def.regrow; this.flag[i] = 2; } else { this.crop[i] = 0; this.grown[i] = 0; this.flag[i] = 0; this.since[i] = FP.absTime(); }
      return id;
    }
    clearDead(tx, ty) { const i = this.idx(tx, ty); if (!this.isDead(tx, ty)) return false; this.crop[i] = 0; this.grown[i] = 0; this.flag[i] = 0; this.since[i] = FP.absTime(); return true; }
    // one night passes: crops grow if watered (by hand or rain), then the soil dries out
    dayTick(rained, season) {
      for (let i = 0; i < this.soil.length; i++) {
        if (!this.soil[i]) continue;
        const id = this.crop[i];
        if (id && !(this.flag[i] & 1)) {
          if (!CROPS[CROP_IDS[id]].seasons.includes(season)) this.flag[i] |= 1;       // wrong season: withers
          else if (this.wet[i] && this.grown[i] < 250) this.grown[i]++;
        }
        this.wet[i] = rained ? 1 : 0;
      }
    }
    // text for the tile in front of the player
    stageFrame(i) {
      const id = this.crop[i], need = this.daysNeeded(id), g = this.grown[i];
      if (g >= need) return 4;
      return Math.max(this.flag[i] & 2 ? 3 : 1, 1 + Math.floor((g / need) * 3));
    }
    draw(ctx, cam) {
      const T = CONFIG.TILE, dry = img.soil_dry, wet = img.soil_wet;
      const x0 = Math.max(0, Math.floor(cam.x / T) - 1), y0 = Math.max(0, Math.floor(cam.y / T) - 1);
      const x1 = Math.min(this.cols, Math.floor((cam.x + cam.w) / T) + 1), y1 = Math.min(this.rows, Math.floor((cam.y + cam.h) / T) + 1);
      const prev = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = false;
      const get = (arr, x, y) => (x < 0 || y < 0 || x >= this.cols || y >= this.rows ? 0 : arr[y * this.cols + x]);
      if (ok(dry) && ok(wet)) for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
        const mk = (arr) => bit(get(arr, i - 1, j - 1), 1) | bit(get(arr, i, j - 1), 2) | bit(get(arr, i - 1, j), 4) | bit(get(arr, i, j), 8);
        const dx = Math.round(i * T - T / 2 - cam.x), dy = Math.round(j * T - T / 2 - cam.y);
        const m = mk(this.soil); if (m) ctx.drawImage(dry, m * 16, 0, 16, 16, dx, dy, T, T);
        const w = mk(this.wet); if (w) ctx.drawImage(wet, w * 16, 0, 16, 16, dx, dy, T, T);
      }
      for (let ty = y0; ty < y1; ty++) for (let tx = x0; tx < x1; tx++) {
        const i = this.idx(tx, ty), id = this.crop[i]; if (!id) continue;
        const name = CROP_IDS[id], dead = this.flag[i] & 1, im = img[`crop_${name}${dead ? "_dead" : ""}`];
        if (!ok(im)) continue;
        const frame = dead ? Math.max(1, Math.min(4, this.grown[i] >= this.daysNeeded(id) ? 4 : 1 + Math.floor(this.grown[i] / this.daysNeeded(id) * 3))) : this.stageFrame(i);
        ctx.drawImage(im, frame * 16, 0, 16, 32, Math.round(tx * T - cam.x), Math.round(ty * T - cam.y - T), T, T * 2);
      }
      ctx.imageSmoothingEnabled = prev;
    }
  }

  /* ---------- weather particles ---------- */
  const fx = { drops: [], flakes: [], flash: 0, flashT: 4, w: 0, h: 0 };
  function drawWeather(ctx, cam, weather, dt) {
    if (weather === "rain" || weather === "storm") {
      const n = weather === "storm" ? 320 : 190;
      while (fx.drops.length < n) fx.drops.push({ x: Math.random() * cam.w, y: Math.random() * cam.h, v: 620 + Math.random() * 260 });
      if (fx.drops.length > n) fx.drops.length = n;
      ctx.strokeStyle = weather === "storm" ? "rgba(185,205,255,0.62)" : "rgba(190,215,255,0.5)"; ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (const d of fx.drops) {
        d.y += d.v * dt; d.x -= d.v * 0.16 * dt;
        if (d.y > cam.h + 20) { d.y = -20; d.x = Math.random() * (cam.w + 200); }
        if (d.x < -20) d.x = cam.w + 10;
        ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + 3, d.y + 13);
      }
      ctx.stroke();
      if (weather === "storm") {
        fx.flashT -= dt;
        if (fx.flashT <= 0) { fx.flash = 0.8; fx.flashT = 4 + Math.random() * 8; }
        if (fx.flash > 0) { ctx.fillStyle = `rgba(235,240,255,${fx.flash * 0.55})`; ctx.fillRect(0, 0, cam.w, cam.h); fx.flash = Math.max(0, fx.flash - dt * 2.2); }
      }
    } else fx.drops.length = 0;
    if (weather === "snow") {
      while (fx.flakes.length < 150) fx.flakes.push({ x: Math.random() * cam.w, y: Math.random() * cam.h, v: 40 + Math.random() * 50, s: 2 + Math.floor(Math.random() * 3), p: Math.random() * 6.28 });
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      const t = performance.now() / 1000;
      for (const f of fx.flakes) {
        f.y += f.v * dt; f.x += Math.sin(t * 0.9 + f.p) * 22 * dt - 8 * dt;
        if (f.y > cam.h + 6) { f.y = -6; f.x = Math.random() * cam.w; }
        if (f.x < -6) f.x = cam.w + 4;
        ctx.fillRect(Math.round(f.x), Math.round(f.y), f.s, f.s);
      }
    } else fx.flakes.length = 0;
  }

  /* ---------- day / night ---------- */
  const STOPS = [[6, [255, 186, 140, .30]], [7.5, [255, 214, 170, .12]], [9, [255, 255, 255, 0]], [16, [255, 255, 255, 0]], [17.5, [255, 168, 108, .20]],
    [19, [200, 110, 130, .32]], [20.5, [40, 50, 112, .52]], [22, [20, 30, 84, .62]], [28, [14, 20, 60, .68]], [30, [255, 186, 140, .30]]];
  function ambient(hour, weather) {
    let a = STOPS[STOPS.length - 1][1].slice();
    if (hour <= STOPS[0][0]) a = STOPS[0][1].slice();
    else for (let i = 0; i < STOPS.length - 1; i++) {
      const [h0, c0] = STOPS[i], [h1, c1] = STOPS[i + 1];
      if (hour >= h0 && hour <= h1) { const t = (hour - h0) / (h1 - h0); a = c0.map((v, k) => v + (c1[k] - v) * t); break; }
    }
    const mix = (c, a2, t) => { for (let k = 0; k < 3; k++) a[k] += (c[k] - a[k]) * t; a[3] = Math.min(0.85, a[3] + a2); };
    if (weather === "rain") mix([110, 128, 160], 0.14, 0.45);
    else if (weather === "storm") mix([80, 92, 125], 0.27, 0.6);
    else if (weather === "cloud") mix([150, 160, 180], 0.06, 0.3);
    else if (weather === "snow") mix([200, 215, 240], 0.08, 0.4);
    return a;
  }
  const lc = document.createElement("canvas"), lg = lc.getContext("2d");
  // lights: [{x, y, r, c:[r,g,b], flick}] in world pixels
  function drawLighting(ctx, cam, hour, weather, lights) {
    const a = ambient(hour, weather);
    if (a[3] < 0.015) return;
    if (lc.width !== cam.w || lc.height !== cam.h) { lc.width = cam.w; lc.height = cam.h; }
    lg.globalCompositeOperation = "source-over"; lg.clearRect(0, 0, lc.width, lc.height);
    lg.fillStyle = `rgba(${a[0] | 0},${a[1] | 0},${a[2] | 0},${a[3]})`; lg.fillRect(0, 0, lc.width, lc.height);
    const t = performance.now() / 1000, dark = Math.min(1, a[3] / 0.35);
    lg.globalCompositeOperation = "destination-out";
    for (const l of lights) {
      const x = l.x - cam.x, y = l.y - cam.y, r = l.r * (1 + (l.flick ? Math.sin(t * 7 + l.x) * 0.04 : 0));
      if (x < -r || y < -r || x > cam.w + r || y > cam.h + r) continue;
      const g = lg.createRadialGradient(x, y, r * 0.1, x, y, r);
      g.addColorStop(0, `rgba(0,0,0,${0.95 * dark})`); g.addColorStop(1, "rgba(0,0,0,0)");
      lg.fillStyle = g; lg.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.drawImage(lc, 0, 0);
    if (dark > 0.25) { // warm bloom on top of the lit holes
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      for (const l of lights) {
        const x = l.x - cam.x, y = l.y - cam.y, r = l.r * 0.8;
        if (x < -r || y < -r || x > cam.w + r || y > cam.h + r) continue;
        const g = ctx.createRadialGradient(x, y, 2, x, y, r), c = l.c || [255, 190, 100];
        g.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${0.22 * dark})`); g.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
        ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      ctx.restore();
    }
  }

  const api = { RESET_HOURS: 24, absTime: () => 0 };   // absTime is wired to the game clock by Game
  return Object.assign(api, { S, GRASS, PATH, WATER, SEASONS, SEASON_NAMES, DAY_NAMES, img, load, ok, hash2, rng, date, weatherFor, SHEETS, drawChar, animLen,
    Ground, Farm, drawWeather, drawLighting, ambient });
})();

const Farm = FP.Farm; // game.js builds one Farm per map page
