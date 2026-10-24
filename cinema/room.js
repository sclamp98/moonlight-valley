"use strict";
/* ==========================================================
   Moonlight Valley — the cinema cellar + co-op presence + game integration.
   The cellar stairs in your home (they used to be "stuck") now lead down to a cosy cinema room:
   a big TV, a plum-velvet loveseat for two, lamps, fairy lights and a snack table.
   This file only *adds* to the game: it wraps a few Game methods the same way home.js does and never replaces them.
     E at the TV            "[E] Watch Together" -> the cinema panel (cinema/ui.js)
     E behind the sofa      sit down (two seats); move to get up
     stairs                 back up to the house
   Co-op presence: your partner is drawn in the house / cinema when you are both in the same room.
   ========================================================== */
const Cinema = (() => {
  const S = 3, T = CONFIG.TILE, C = CinemaCore;
  const { blit, shadow } = WORLD;
  const ok = FP.ok;
  const RW = 288, RH = 208, FLOOR = { x: 16, y: 32, w: 256, h: 144 };
  const STAIRS = { x: 18, y: 29 };
  const TV = { x: 96, y: 4 }, SOFA = { x: 109, y: 104 };
  const ART = (n) => CINEMA_ART[n];
  const HA = (n) => HOME_ART.int[n];
  const SEAT_DX = CINEMA_ART.sofa.seats;                           // seat centres inside the sofa sprite (art px)
  const seatCx = (i) => (SOFA.x + SEAT_DX[i]) * S;
  const seatFootY = () => (SOFA.y + CINEMA_ART.sofa.seatFootY) * S;
  const SIT_FOCUS_Y = ((TV.y + SOFA.y + 30) / 2) * S;               // while seated the camera frames the TV and the sofa together (otherwise the TV is cut off at the top)
  const SCREEN = { x: TV.x + ART("tv_stand").screen.x, y: TV.y + ART("tv_stand").screen.y, w: ART("tv_stand").screen.w, h: ART("tv_stand").screen.h };

  const img = {};
  for (const n of Object.keys(CINEMA_ART)) if (n !== "sofa") img[n] = Object.assign(new Image(), { src: `assets/cinema/${n}.png` });
  for (const n of ["floor", "wall", "stairs", "bookshelf", "cabinet", "pot_plant", "sprout", "barrel", "barrel2", "crate_s", "stool", "jug_glass"]) img["h_" + n] = Object.assign(new Image(), { src: `assets/home/int_${n}.png` });

  /* ---------- partner avatar: a real Player (same sprites + walk cycle), driven by network packets ---------- */
  class RemotePlayer extends Player {
    static make(gender, name) {
      const old = CONFIG.PLAYER_CHARACTER; CONFIG.PLAYER_CHARACTER = gender;
      try { const r = new RemotePlayer(0, 0); r.gender = gender; r.label = name; return r; } finally { CONFIG.PLAYER_CHARACTER = old; }
    }
    constructor(x, y) { super(x, y); this.tx = x; this.ty = y; this.sitSlot = -1; this.movingUntil = 0; this.seen = false; }
    setTarget(p) {
      this.tx = p.x; this.ty = p.y; this.dirKey = p.d; this.sitSlot = p.st; this.label = p.nm; this.moveHint = p.mv;
      if (!this.seen) { this.x = p.x; this.y = p.y; this.seen = true; }
    }
    step(dt) {
      const px = this.x, py = this.y, k = 1 - Math.exp(-18 * dt);
      this.x += (this.tx - this.x) * k; this.y += (this.ty - this.y) * k;
      if (Math.hypot(this.tx - this.x, this.ty - this.y) < 0.4) { this.x = this.tx; this.y = this.ty; }
      const moved = Math.hypot(this.x - px, this.y - py);
      this.walkDist += moved;
      if (moved > 0.6) this.movingUntil = performance.now() + 120;
      this.moving = this.sitSlot < 0 && (performance.now() < this.movingUntil);
      this.hurtTimer = 0; this.attackTimer = 0;
    }
    draw(ctx, cam) { const old = CONFIG.PLAYER_NAME; CONFIG.PLAYER_NAME = this.label || "Partner"; try { super.draw(ctx, cam); } finally { CONFIG.PLAYER_NAME = old; } }
  }

  /* ---------- the room ---------- */
  class CSpot extends Interactable {
    constructor(o) { super({ x: o.x * S, y: o.y * S, w: o.w * S, h: o.h * S, name: o.label, prompt: o.prompt, solid: false }); this.act = o.act; this.slot = o.slot; this.hl = null; }
    onInteract(game) { Cinema.act(game, this); }
  }
  class CinemaRoom {
    constructor() {
      this.isCinema = true;
      this.world = { width: RW * S, height: RH * S };
      this.solids = [{ x: 0, y: 0, w: FLOOR.x * S, h: RH * S }, { x: (FLOOR.x + FLOOR.w) * S, y: 0, w: (RW - FLOOR.x - FLOOR.w) * S, h: RH * S },
        { x: 0, y: 0, w: RW * S, h: FLOOR.y * S - 20 }, { x: 0, y: (FLOOR.y + FLOOR.h) * S - 6, w: RW * S, h: (RH - FLOOR.y - FLOOR.h) * S + 6 }];
      this.things = []; this.spots = []; this.lights = []; this.bed = { sleepers: [null, null] };
      const col = (x, y, c) => this.solids.push({ x: (x + c[0]) * S, y: (y + c[1]) * S, w: c[2] * S, h: c[3] * S });
      const spr = (key, x, y, o = {}) => {
        const w = o.w, h = o.h;
        this.things.push({ y: (y + h) * S + (o.dy || 0), wall: o.wall, draw: (ctx, cam) => this.sprite(ctx, cam, key, x, y, w, h) });
      };
      const home = (n, x, y, c, o = {}) => { const a = HA(n); spr("h_" + n, x, y, { w: a.w, h: a.h, ...o }); if (c) col(x, y, c); };
      // wall dressing (behind everything)
      const c = (n, x, y, o) => spr(n, x, y, { w: ART(n).w, h: ART(n).h, wall: true, ...o });
      c("curtain_l", TV.x - 15, 2); c("curtain_r", TV.x + 94, 2);
      c("poster_moon", 62, 6); c("poster_heart", 218, 6);
      // stairs back up (same art as the house's cellar stairs)
      home("stairs", STAIRS.x, STAIRS.y, [1, 22, 41, 36]);
      this.door = new CSpot({ x: STAIRS.x + 9, y: STAIRS.y + 57, w: 24, h: 14, act: "up", label: "Stairs", prompt: "Go back upstairs" });
      this.spots.push(this.door);
      // the TV (with the live screen) and its interaction spot
      const tv = ART("tv_stand");
      this.things.push({ y: (TV.y + tv.h) * S, draw: (ctx, cam, g) => { this.sprite(ctx, cam, "tv_stand", TV.x, TV.y, tv.w, tv.h); this.drawScreen(ctx, cam, g); } });
      col(TV.x, TV.y, [1, 46, tv.w - 2, 11]);
      this.tvSpot = new CSpot({ x: TV.x + 14, y: TV.y + tv.h + 4, w: 68, h: 14, act: "tv", label: "Cinema screen", prompt: "Watch Together" });
      this.spots.push(this.tvSpot);
      // sofa: seat part is drawn before the people on it, back-rest after them
      const sf = ART("sofa"), seat = ART("sofa_seat"), back = ART("sofa_back");
      this.things.push({ y: (SOFA.y + 6) * S, draw: (ctx, cam) => this.sprite(ctx, cam, "sofa_seat", SOFA.x, SOFA.y, seat.w, seat.h) });
      this.things.push({ y: (SOFA.y + sf.h) * S, draw: (ctx, cam) => this.sprite(ctx, cam, "sofa_back", SOFA.x, SOFA.y + back.dy, back.w, back.h) });
      col(SOFA.x, SOFA.y, [1, 14, sf.w - 2, 26]);
      SEAT_DX.forEach((dx, i) => this.spots.push(new CSpot({ x: SOFA.x + dx - 10, y: SOFA.y + sf.h + 1, w: 20, h: 12, act: "sit", slot: i, label: "Loveseat", prompt: "Sit down" })));
      // lamps, snacks, shelves, plants
      const lt = ART("lamp_table"), st = ART("snack_table");
      spr("lamp_table", 84, 104, { w: lt.w, h: lt.h }); col(84, 104, [1, 16, lt.w - 2, 17]);
      spr("snack_table", 184, 118, { w: st.w, h: st.h }); col(184, 118, [1, 14, st.w - 2, 10]);
      this.spots.push(new CSpot({ x: 184 + 2, y: 118 + st.h - 1, w: 20, h: 12, act: "snack", label: "Snack table", prompt: "Grab some popcorn" }));
      home("bookshelf", 214, 30, [1, 24, 24, 19]); home("cabinet", 246, 33, [1, 15, 17, 12]);
      home("pot_plant", 22, 156, [1, 8, 14, 9]); home("sprout", 40, 158, [1, 8, 12, 7]);
      home("barrel", 254, 126, [0, 12, 16, 12]); home("barrel2", 236, 152, [0, 10, 30, 14]); home("crate_s", 257, 152, [0, 6, 13, 11]);
      home("stool", 66, 150, [0, 10, 24, 14]);
      // light: warm lamp + fairy lights + the glow of the TV (set per frame)
      this.lights.push({ x: 94 * S, y: 112 * S, r: 190, c: [255, 190, 100], flick: true }, { x: 196 * S, y: 124 * S, r: 120, c: [255, 170, 90], flick: true });
      this.fairy = []; for (let i = 0; i < 12; i++) { const x = 28 + i * 21, y = 31 + Math.round(Math.sin((i / 11) * Math.PI) * 3); this.fairy.push({ x, y, ph: i * 0.9 }); }
      this.fairy.forEach((f, i) => { if (i % 3 === 1) this.lights.push({ x: f.x * S, y: (f.y + 2) * S, r: 80, c: [255, 200, 120] }); });
    }
    sprite(ctx, cam, key, x, y, w, h) { const im = img[key]; if (ok(im)) blit(ctx, im, 0, 0, im.naturalWidth, im.naturalHeight, x * S - cam.x, y * S - cam.y, im.naturalWidth * S, im.naturalHeight * S); }
    seatTaken(slot, game) { const r = Cinema.remote; return (game.sitting && game.sitting.slot === slot) || (r && r.where === "cinema" && r.sitSlot === slot); }
    standPos(i) { return { x: seatCx(i) - CONFIG.PLAYER_SIZE / 2, y: (SOFA.y + CINEMA_ART.sofa.h + 6) * S }; }
    enterPos() { return { x: (STAIRS.x + 21) * S - CONFIG.PLAYER_SIZE / 2, y: (STAIRS.y + 63) * S }; }

    // the TV glass: standby art, "join" invitation, or black behind the real video player
    drawScreen(ctx, cam, game) {
      const x = SCREEN.x * S - cam.x, y = SCREEN.y * S - cam.y, w = SCREEN.w * S, h = SCREEN.h * S, t = performance.now() / 1000;
      const i = Cinema.session ? Cinema.session.info() : null;
      ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      const g = ctx.createLinearGradient(x, y, x + w, y + h); g.addColorStop(0, "#141a45"); g.addColorStop(1, "#2a1646"); ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
      if (i && i.joined && !i.error) { ctx.fillStyle = "#000"; ctx.fillRect(x, y, w, h); }
      else {
        for (let k = 0; k < 26; k++) { const sx = x + ((k * 97 + t * (4 + (k % 5))) % w), sy = y + ((k * 53) % h), a = 0.35 + 0.4 * Math.sin(t * 2 + k); ctx.fillStyle = `rgba(255,244,200,${a})`; ctx.fillRect(Math.round(sx), Math.round(sy), 3, 3); }
        ctx.fillStyle = "#f6e9a8"; ctx.beginPath(); ctx.arc(x + w * 0.82, y + h * 0.26, h * 0.12, 0, 7); ctx.fill(); ctx.fillStyle = "#1c1b4a"; ctx.beginPath(); ctx.arc(x + w * 0.82 + h * 0.05, y + h * 0.24, h * 0.11, 0, 7); ctx.fill();
        ctx.textAlign = "center"; ctx.lineWidth = 4; ctx.strokeStyle = "rgba(20,12,30,.9)"; ctx.fillStyle = "#fde6b2";
        ctx.font = `bold ${Math.round(h * 0.17)}px 'Trebuchet MS', sans-serif`;
        const line1 = i && i.error ? "Can't play this video" : i && i.active ? "Movie night in progress" : "Moonlight Cinema";
        ctx.strokeText(line1, x + w / 2, y + h * 0.5); ctx.fillText(line1, x + w / 2, y + h * 0.5);
        ctx.font = `bold ${Math.round(h * 0.1)}px 'Trebuchet MS', sans-serif`; ctx.fillStyle = "#f2c94c";
        const line2 = i && i.active && !i.joined ? "[E] Watch Together to join" : "[E] Watch Together";
        ctx.strokeText(line2, x + w / 2, y + h * 0.72); ctx.fillText(line2, x + w / 2, y + h * 0.72);
      }
      ctx.restore();
      // where the real player should sit on screen (CSS px) — the DOM video is laid over this rectangle
      const z = game.hZoom, cv = game.canvas.getBoundingClientRect();
      Cinema.screenRect = { x: cv.left + x * z, y: cv.top + y * z, w: w * z, h: h * z };
    }
    draw(ctx, cam, game) {
      ctx.fillStyle = "#0c0912"; ctx.fillRect(0, 0, cam.w, cam.h);
      const ox = -cam.x, oy = -cam.y;
      const fl = img.h_floor;
      ctx.save(); ctx.beginPath(); ctx.rect(FLOOR.x * S + ox, FLOOR.y * S + oy, FLOOR.w * S, FLOOR.h * S); ctx.clip();
      if (ok(fl)) for (let y = FLOOR.y; y < FLOOR.y + FLOOR.h; y += 32) for (let x = FLOOR.x; x < FLOOR.x + FLOOR.w; x += 64) blit(ctx, fl, 0, 0, 64, 32, x * S + ox, y * S + oy, 192, 96);
      ctx.fillStyle = "rgba(48,28,84,.34)"; ctx.fillRect(FLOOR.x * S + ox, FLOOR.y * S + oy, FLOOR.w * S, FLOOR.h * S);
      ctx.restore();
      const wl = img.h_wall;
      if (ok(wl)) for (let x = FLOOR.x; x < FLOOR.x + FLOOR.w; x += 32) { blit(ctx, wl, 0, 0, 32, 32, x * S + ox, oy, 96, 96); blit(ctx, wl, 0, 0, 32, 32, x * S + ox, 176 * S + oy, 96, 96); }
      ctx.fillStyle = "rgba(40,22,70,.42)"; ctx.fillRect(FLOOR.x * S + ox, oy, FLOOR.w * S, FLOOR.y * S); ctx.fillRect(FLOOR.x * S + ox, 176 * S + oy, FLOOR.w * S, 96);
      this.sprite(ctx, cam, "rug_night", 96, 70, 0, 0);
      this.drawFairy(ctx, cam);
      // everyone, back to front (local farmer, partner when they're in this room)
      const list = this.things.slice(), p = game.player, r = Cinema.remote;
      list.push({ y: p.y + p.h, draw: (c, cm) => p.draw(c, cm) });
      if (r && r.where === "cinema") list.push({ y: r.y + r.h, draw: (c, cm) => r.draw(c, cm) });
      for (const d of cin.things(game)) list.push(d);                       // co-op emotes (cinema/emotes.js)
      list.sort((a, b) => (a.wall ? -1 : 0) - (b.wall ? -1 : 0) || a.y - b.y);
      for (const d of list) d.draw(ctx, cam, game);
      if (game.nearestIn && game.nearestIn !== this.door) { const s = game.nearestIn; ctx.strokeStyle = "rgba(255,246,194,.8)"; ctx.setLineDash([5, 4]); ctx.lineWidth = 2; ctx.strokeRect(s.x + ox, s.y + oy, s.w, s.h); ctx.setLineDash([]); }
    }
    drawFairy(ctx, cam) {
      const t = performance.now() / 1000;
      ctx.save(); ctx.strokeStyle = "rgba(60,40,30,.9)"; ctx.lineWidth = 2; ctx.beginPath();
      this.fairy.forEach((f, i) => { const X = f.x * S - cam.x, Y = f.y * S - cam.y; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }); ctx.stroke();
      const cols = ["#ffd27a", "#ff9fb0", "#ffe9a8", "#b5d8ff"];
      this.fairy.forEach((f, i) => { const X = f.x * S - cam.x, Y = f.y * S - cam.y + 4, a = 0.65 + 0.35 * Math.sin(t * 2.2 + f.ph); ctx.globalAlpha = a; ctx.fillStyle = cols[i % 4]; ctx.fillRect(Math.round(X) - 3, Math.round(Y), 6, 8); ctx.globalAlpha = a * 0.25; ctx.fillRect(Math.round(X) - 7, Math.round(Y) - 3, 14, 14); });
      ctx.restore();
    }
  }

  /* ---------- controller: link + session + ui, presence ---------- */
  const self = { id: C.randomId(), name: "Farmer", gender: "male" };
  const cin = {
    things() { return []; },                                   // extra draw-list items for the room (emotes hook in here)
    self, link: null, session: null, ui: null, remote: null, screenRect: null, room: null, _inCin: false, _posAt: 0,
    ensure(game) {
      if (this.ui) return this;
      self.name = CONFIG.PLAYER_NAME || "Farmer"; self.gender = CONFIG.PLAYER_CHARACTER === "female" ? "female" : "male";
      this.link = typeof CoopRelay !== "undefined" ? CoopRelay.make(self) : new CoopLink.Link(self);   // relay (Ably) on a real website, direct WebRTC on localhost
      this.ui = new CinemaUI.UI({ getSession: () => this.session, getLink: () => this.link, where: () => this.whereText(), onClosed: () => {} });
      this.session = new CinemaSession.Session({ self, container: this.ui.video, notify: (t) => game.showMessage(t, 3400) });
      this.session.setLink(this.link);
      this.session.onChange(() => { if (this.ui.cinOpen) this.ui.refresh(); });
      this.link.on("status", () => { this.ui.refreshBadge(); if (this.ui.coopOpen) this.ui.refreshCoop(); });
      this.link.on("open", () => game.showMessage("Co-op link open. Say hi!", 2200));
      this.link.on("hello", (peer, first) => { if (first) game.showMessage(`${peer.name} joined your game`, 2600); this.sendPos(true); this.ui.refreshBadge(); });
      this.link.on("pos", (m) => this.onPos(m));
      this.link.on("chat", (m) => this.onChat(m));
      this.link.on("down", (why) => { this.remote = null; game.showMessage(why || "Co-op link closed", 3000); this.ui.refreshBadge(); });
      this.link.on("restored", () => { game.showMessage("Reconnected", 2000); this.sendPos(true); this.session._send("cin:sync", { state: this.session.active ? this.session.state : null, joined: this.session.joined }); });
      return this;
    },
    /* chat: incoming messages from the partner, forwarded straight to the UI's chat panel */
    onChat(m) {
      const c = C.validateChat(m); if (!c) return;
      this.ui.addChatMessage({ mine: false, name: (this.link.peer && this.link.peer.name) || "Partner", text: c.text, ts: c.ts });
    },
    whereText() { const r = this.remote; return r ? { home: "in the house", cinema: "in the cinema", out: "outside" }[r.where] : ""; },
    where(game) { return game.inside ? (game.inside.isCinema ? "cinema" : "home") : "out"; },

    /* presence */
    onPos(m) {
      const p = C.validatePos(m); if (!p) return;
      let r = this.remote;
      if (!r || r.gender !== p.g) { r = this.remote = RemotePlayer.make(p.g, p.nm); }
      r.label = p.nm;
      if (r.where !== p.w) { r.where = p.w; r.seen = false; this.ui.refreshBadge(); }
      if (p.w !== "out") r.setTarget(p);
    },
    sendPos(force) {
      const g = window.game; if (!g || !this.link || !this.link.open) return;
      const now = performance.now(), w = this.where(g), gap = w === "out" ? 1000 : 90;
      if (!force && now - this._posAt < gap) return; this._posAt = now;
      const p = g.player;
      this.link.send("pos", w === "out" ? { w, g: self.gender, nm: self.name } : { w, x: Math.round(p.x), y: Math.round(p.y), d: p.dirKey, mv: !!p.moving, st: g.sitting ? g.sitting.slot : -1, g: self.gender, nm: self.name });
    },
    afterUpdate(game, dt) {
      const inCin = !!(game.inside && game.inside.isCinema);
      if (inCin !== this._inCin) { this._inCin = inCin; inCin ? this.onEnter(game) : this.onLeave(game); }
      if (this.remote) this.remote.step(dt);
      this.sendPos();
      if (!inCin) this.ui.placeScreen(null, false);
    },
    onEnter(game) {
      const i = this.session.info();
      if (i.active && !i.joined) game.showMessage("A movie is playing. Press E at the TV to join.", 3200);
    },
    onLeave(game) {                                         // anything that takes you out of the cellar (stairs, sleep, travel…)
      if (game.sitting) game.sitting = null;
      this.ui.close(); this.session.leave(); this.ui.placeScreen(null, false); this.screenRect = null;
    },
    act(game, spot) {
      switch (spot.act) {
        case "up": game.leaveCinema(); break;
        case "tv": this.ui.open(); break;
        case "sit": game.sitCinema(spot.slot); break;
        case "snack": game.ui.popup({ cx: spot.cx, y: spot.y - 20 }, "Warm, buttery popcorn. Perfect for movie night."); break;
      }
    },
  };

  /* ---------- Game integration (wraps only) ---------- */
  const wrap = (name, fn) => { const o = Game.prototype[name]; Game.prototype[name] = function (...a) { return fn.call(this, o, ...a); }; };
  Object.assign(Game.prototype, {
    enterCinema() { if (this.fade) return; this.closeAllPanels(); this.fade = { phase: "out", t: 0, door: "cinema" }; },
    leaveCinema() { if (this.fade) return; if (this.sitting) this.standCinema(); this.fade = { phase: "out", t: 0, door: "cinemaUp" }; },
    sitCinema(slot) {
      const room = this.inside; if (!room || !room.isCinema || this.sitting) return;
      if (room.seatTaken(slot, this)) slot = 1 - slot;
      if (room.seatTaken(slot, this)) { this.showMessage("The loveseat is full", 1600); return; }
      const p = this.player; this.sitting = { slot };
      p.x = seatCx(slot) - p.w / 2; p.y = seatFootY() - p.h; p.dirKey = "up"; p.moving = false;
      this.showMessage("Settle in.  E: Watch Together  ·  move to get up", 2600);
    },
    standCinema() {
      const s = this.sitting; if (!s) return; this.sitting = null;
      const sp = this.inside.standPos(s.slot), p = this.player; p.x = sp.x; p.y = sp.y; p.dirKey = "down";
    },
    updateCinema(dt) {
      const p = this.player, room = this.inside, inp = this.input;
      p.hurtTimer = 0; p.attackTimer = Math.max(0, p.attackTimer - dt);
      if (this.sitting) {
        const a = inp.axis();
        if (a.x || a.y) this.standCinema();
        else if (inp.wasPressed("e")) cin.ui.open();
        this.nearestIn = null; this.ui.setHint(this.sitting ? "[E] Watch Together" : "");
      } else {
        p.update(dt, inp, room.world, room.solids);
        let best = null, bd = CONFIG.INTERACT_RANGE;
        for (const o of room.spots) { const d = Math.hypot(o.cx - p.cx, o.cy - p.cy); if (d < bd) { best = o; bd = d; } }
        this.nearestIn = best;
        if (best && inp.wasPressed("e")) best.onInteract(this);
        this.ui.setHint(best ? (best.act === "tv" ? "[E] Watch Together" : `Press E — ${best.prompt}`) : "");
      }
      this.homeCam().follow(this.sitting ? { cx: p.cx, cy: SIT_FOCUS_Y } : p, room.world, dt);
      FP.season = this.date.seasonKey;
      this.ui.setHealth(p.hp, p.maxHp); this.ui.setEnergy(this.energy, CONFIG.MAX_ENERGY); this.ui.setClock(this.time, this.date, this.weather); this.ui.setStats(this.coins); this.ui.setCoords(p);
      this.ui.setCan(false, this.water, CONFIG.CAN_MAX);
    },
    renderCinema() {
      const ctx = this.ctx, cam = this.homeCam(), room = this.inside;
      ctx.save(); ctx.scale(this.hZoom, this.hZoom);
      cin.screenRect = null;
      room.draw(ctx, cam, this);
      const lights = room.lights.slice(), p = this.player, i = cin.session.info();
      const glow = i.joined ? (i.kind === "play" ? 1 : 0.7) : 0.55, f = i.kind === "play" ? 0.9 + 0.1 * Math.sin(performance.now() / 90) : 1;
      lights.push({ x: (SCREEN.x + SCREEN.w / 2) * S, y: (SCREEN.y + SCREEN.h + 14) * S, r: 330 * glow * f, c: i.joined ? [120, 160, 255] : [150, 120, 255] });
      lights.push({ x: p.cx, y: p.cy - 14, r: 80, c: [255, 214, 150], flick: true });
      FP.drawLighting(ctx, cam, 22.5, "sun", lights);                        // always night down here: warm lamps, cool TV glow
      this.ui.drawPopups(ctx, cam); this.ui.drawFloaters(ctx, cam);
      ctx.restore();
      cin.ui.placeScreen(cin.screenRect, i.joined);
    },
  });
  wrap("update", function (o, dt) {
    const c = cin.ensure(this);
    if (c.ui.modal) { this.input.down.clear(); this.input.pressed.clear(); }       // a cinema / co-op panel is open: the game gets no keys
    const r = o.call(this, dt);
    c.afterUpdate(this, dt);
    return r;
  });
  wrap("updateInside", function (o, dt) { return this.inside && this.inside.isCinema ? this.updateCinema(dt) : o.call(this, dt); });
  wrap("renderInside", function (o) { return this.inside && this.inside.isCinema ? this.renderCinema() : o.call(this); });
  wrap("passDoor", function (o, dir) {
    const p = this.player;
    if (dir === "cinema") {
      cin.room = cin.room || new CinemaRoom();
      this.inside = cin.room; this.lying = null; this.nearest = null; this.nearestIn = null; this.sitting = null;
      const e = cin.room.enterPos(); p.x = e.x; p.y = e.y; p.dirKey = "down";
      this.ui.place = "Moonlight Cinema"; this.homeCam().follow(p, this.inside.world, 0, true);
      return;
    }
    if (dir === "cinemaUp") {
      this.inside = this.homeRoom; this.nearestIn = null; this.sitting = null;
      p.x = 39 * S - p.w / 2; p.y = 94 * S; p.dirKey = "down";           // at the foot of the cellar stairs
      this.ui.place = "Your Home"; this.homeCam().follow(p, this.inside.world, 0, true);
      return;
    }
    const r = o.call(this, dir);
    if (dir === "in") for (const s of this.homeRoom.spots) if (s.act === "stairs") { s.prompt = "Go down to the cinema"; s.name = "Cinema stairs"; }
    return r;
  });
  wrap("doSleep", function (o, passedOut) {                             // passing out can't happen "inside" the cellar: bring the farmer upstairs first
    if (this.inside && this.inside.isCinema) { cin.onLeave(this); this.inside = this.homeRoom; this.sitting = null; const p = this.player; p.x = 39 * S - p.w / 2; p.y = 94 * S; }
    return o.call(this, passedOut);
  });
  // stairs in the house now lead somewhere
  const homeAct = HomeKit.act;
  HomeKit.act = (game, spot) => (spot.act === "stairs" ? game.enterCinema() : homeAct(game, spot));
  // the partner is drawn in the house too (Room.draw builds its sort list from this.things)
  const homeDraw = HomeKit.Room.prototype.draw;
  HomeKit.Room.prototype.draw = function (ctx, cam, game) {
    const r = cin.remote, extras = [];
    if (r && r.where === "home") extras.push({ y: r.y + r.h, draw: (c, cm) => r.draw(c, cm) });
    for (const d of cin.things(game)) extras.push(d);              // co-op emotes (cinema/emotes.js)
    if (!extras.length) return homeDraw.call(this, ctx, cam, game);
    for (const e of extras) this.things.push(e);
    try { return homeDraw.call(this, ctx, cam, game); } finally { for (const e of extras) { const k = this.things.indexOf(e); if (k >= 0) this.things.splice(k, 1); } }
  };

  return cin;
})();
