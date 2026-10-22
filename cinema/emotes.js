"use strict";
/* ==========================================================
   Moonlight Valley — co-op EMOTES: kiss (K, either farmer) and hip slap (H, the man only).
   Indoors (house / cinema) when you and your partner are both in the room and close together:
     - press the key: a request goes to your partner; BOTH farmers are locked, walk to their spots, and the
       pair animation (assets/emote/*, built from kiss_1.mp4 / slap_1.mp4) plays on both screens.
     - the partner cannot cancel it. It lasts ~5 s (kiss) / ~4.5 s (slap), then both get control back.
   Like cinema/room.js this only wraps Game methods and hooks the draw lists; pure rules live in emote_core.js.
   ========================================================== */
const Emotes = (() => {
  const C = EmoteCore, cin = Cinema, art = EMOTE_ART;
  const now = () => performance.now();
  const frames = {};
  for (const kind of C.KIND_NAMES) frames[kind] = Array.from({ length: art[kind].n }, (_, i) => Object.assign(new Image(), { src: `assets/emote/${kind}_${i}.png` }));
  const kScale = (kind) => CONFIG.SPRITE_H.player / art[kind].refH;

  let cur = null;       // { id, kind, byMe, t0, anchor, flip, L, pStart, rStart, face, glideFace, impact }

  /* ---------- state helpers ---------- */
  const typing = () => { const e = document.activeElement; return !!e && (/^(INPUT|TEXTAREA|SELECT)$/.test(e.tagName) || e.isContentEditable); };
  const hardBusy = (g) => !!(g.fade || g.lying || g.sitting || !g.inside || g.player.dead || (cin.ui && cin.ui.modal));
  const g = () => window.game;
  const me = (game) => ({ gender: cin.self.gender, cx: game.player.cx, cy: game.player.cy });
  const partner = () => { const r = cin.remote; return r ? { gender: r.gender, cx: r.cx, cy: r.cy } : null; };
  const stateOf = (game) => {
    const r = cin.remote, w = cin.where(game);
    return { connected: !!(cin.link && cin.link.open && r), sameRoom: !!r && w !== "out" && r.where === w, active: !!cur,
      busy: hardBusy(game) || !!game.uiMode || !!(r && r.sitSlot >= 0) };
  };
  const isFree = (game) => { const room = game.inside, wd = room.world; return (x, y, w, h) => x >= 0 && y >= 0 && x + w <= wd.width && y + h <= wd.height && !room.solids.some((s) => x < s.x + s.w && x + w > s.x && y < s.y + s.h && y + h > s.y); };
  const roles = (game) => { const f = cin.self.gender === "female"; return { mine: f ? "f" : "m", theirs: f ? "m" : "f" }; };

  /* ---------- start / receive ---------- */
  function tryStart(game, kind) {
    const r = cin.remote, p = game.player;
    const res = C.check(kind, me(game), partner(), stateOf(game));
    if (!res.ok) { if (!res.silent) game.showMessage(res.msg, 2200); return; }
    const k = kScale(kind), femaleCx = cin.self.gender === "female" ? p.cx : r.cx, maleCx = cin.self.gender === "female" ? r.cx : p.cx;
    const flip = C.chooseFlip(femaleCx, maleCx);
    const mid = { x: (p.cx + r.cx) / 2, y: (p.y + p.h + r.y + r.h) / 2 };
    const anchor = C.pickAnchor(art[kind], k, flip, mid, isFree(game));
    if (!anchor) { game.showMessage(C.MSG.space, 2200); return; }
    const id = C.randomId();
    begin(game, { id, kind, byMe: true, anchor, flip, lead: C.LEAD_MS });
    cin.link.send("emo", { a: "go", k: kind, id, lead: C.LEAD_MS, ax: Math.round(anchor.x), ay: Math.round(anchor.y), fl: flip });
  }

  function begin(game, o) {
    const p = game.player, r = cin.remote, k = kScale(o.kind), rtt = (cin.link && cin.link.rtt) || 0;
    const L = C.layout(art[o.kind], k, o.anchor, o.flip);
    const fin = C.FINAL[o.kind](o.flip), gl = C.GLIDE_FACE[o.kind](o.flip);
    cur = { id: o.id, kind: o.kind, byMe: o.byMe, t0: now() + o.lead - (o.byMe ? 0 : Math.min(rtt, 600) / 2), anchor: o.anchor, flip: o.flip, L,
      pStart: { x: p.x, y: p.y }, rStart: { x: r.x, y: r.y }, face: fin, glideFace: gl, impact: false };
    game.input.down.clear(); game.input.pressed.clear();
  }

  function onMsg(m) {
    const game = g(), v = C.validateMsg(m); if (!game || !v) return;
    if (v.a === "stop") { if (cur && cur.id === v.id) finish(game, true); return; }
    if (v.a === "no") { if (cur && cur.id === v.id && cur.byMe) { finish(game, true); game.showMessage(v.why === "far" ? C.MSG.far : C.MSG.theirbusy, 2200); } return; }
    const r = cin.remote, p = game.player, no = (why) => cin.link.send("emo", { a: "no", id: v.id, why });
    if (!r) return;
    if (cur) {                                                // both pressed at once: ids alone decide, same winner on both screens
      if (cur.byMe && cur.id !== v.id && !C.winsTie(cur.id, v.id)) finish(game, true);
      else return no("busy");
    }
    const K = C.KINDS[v.k];
    if (r.gender === p_gender() || (K.actor && r.gender !== K.actor)) return no("pair");
    if (hardBusy(game) || r.where !== cin.where(game) || r.sitSlot >= 0) return no("busy");
    const near = (e) => Math.hypot(e.cx - v.ax, e.y + e.h - v.ay) <= C.ACCEPT_RANGE;
    if (!near(p) || !near(r)) return no("far");
    if (game.uiMode) game.closeAllPanels();                    // forced: whatever the partner had open is closed
    begin(game, { id: v.id, kind: v.k, byMe: false, anchor: { x: v.ax, y: v.ay }, flip: v.fl, lead: v.lead });
  }
  const p_gender = () => cin.self.gender;

  /* ---------- the running emote (called every frame after the game's own update) ---------- */
  function step(game) {
    const c = cur; if (!c) return;
    const r = cin.remote, p = game.player;
    if (!r || r.where !== cin.where(game) || game.fade || game.lying || !game.inside) return finish(game, true, true);
    game.input.down.clear(); game.input.pressed.clear();      // locked: no walking, no interacting
    const A = art[c.kind], tl = C.timeline(A, (now() - c.t0) / 1000), rl = roles(game);
    const mineStart = c.L[rl.mine + "0"], theirStart = c.L[rl.theirs + "0"], mineEnd = c.L[rl.mine + "1"], theirEnd = c.L[rl.theirs + "1"];
    const put = (e, s) => { e.x = s.x - e.w / 2; e.y = s.y - e.h; if (e === r) { e.tx = e.x; e.ty = e.y; } };
    const myFace = (set) => set[cin.self.gender], theirFace = (set) => set[r.gender];
    if (tl.phase === "done") return finish(game, false);
    if (tl.phase === "glide") {
      const u = C.ease(tl.u);
      for (const [e, from, to, set] of [[p, c.pStart, mineStart, myFace(c.glideFace)], [r, c.rStart, theirStart, theirFace(c.glideFace)]]) {
        const px = e.x, py = e.y;
        put(e, { x: from.x + e.w / 2 + (to.x - from.x - e.w / 2) * u, y: from.y + e.h + (to.y - from.y - e.h) * u });
        const moved = Math.hypot(e.x - px, e.y - py); e.moving = moved > 0.05; e.walkDist += moved; e.dirKey = set;
        e.emoAlpha = undefined;
      }
    } else if (tl.phase === "play") {
      const atEnd = tl.atEnd;
      put(p, atEnd ? mineEnd : mineStart); put(r, atEnd ? theirEnd : theirStart);
      p.dirKey = myFace(c.face); r.dirKey = theirFace(c.face); p.moving = r.moving = false;
      p.emoAlpha = r.emoAlpha = tl.realA;
      const mk = A.marks;
      if (!c.impact && mk.impact !== undefined && tl.pt >= mk.impact) { c.impact = true; game.ui.floatText(c.anchor.x, c.anchor.y - 100, "Smack!", "#ffe26a"); }
    }
  }

  function finish(game, abort, notify) {
    const c = cur; if (!c) return; cur = null;
    const p = game.player, r = cin.remote, rl = roles(game);
    for (const e of [p, r]) if (e) { e.emoAlpha = undefined; e.moving = false; }
    if (!abort && r) {
      const put = (e, s) => { e.x = s.x - e.w / 2; e.y = s.y - e.h; if (e === r) { e.tx = e.x; e.ty = e.y; } };
      put(p, c.L[rl.mine + "1"]); put(r, c.L[rl.theirs + "1"]);
      p.dirKey = c.face[cin.self.gender]; r.dirKey = c.face[r.gender];
    }
    if (abort && notify && cin.link && cin.link.open) cin.link.send("emo", { a: "stop", id: c.id });   // tell the partner we cut it short
  }

  /* ---------- drawing ---------- */
  function heart(ctx, x, y, s, a) {
    const B = ["0110110", "1111111", "1111111", "0111110", "0011100", "0001000"];
    ctx.save(); ctx.globalAlpha *= a;
    B.forEach((row, j) => [...row].forEach((v, i) => { if (v === "1") { ctx.fillStyle = (i === 1 && j === 1) ? "#ffd0d8" : (j >= 3 ? "#c4203a" : "#ef3d5a"); ctx.fillRect(Math.round(x + (i - 3.5) * s), Math.round(y + j * s), s, s); } }));
    ctx.restore();
  }
  function drawDuo(ctx, cam, game) {
    const c = cur; if (!c) return;
    const A = art[c.kind], tl = C.timeline(A, (now() - c.t0) / 1000); if (tl.phase !== "play" || tl.duoA <= 0) return;
    const im = frames[c.kind][tl.frame], k = kScale(c.kind), s = c.flip ? -1 : 1;
    const fx = c.anchor.x - cam.x, fy = c.anchor.y - cam.y;
    const f = A.feet[tl.frame], xa = fx + s * (f[0] - A.ax) * k, xb = fx + s * (f[1] - A.ax) * k;
    ctx.save(); ctx.globalAlpha = tl.duoA;
    ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.beginPath(); ctx.ellipse((xa + xb) / 2, fy + 2, Math.abs(xb - xa) / 2 + 2, 6, 0, 0, Math.PI * 2); ctx.fill();
    if (im.complete && im.naturalWidth) {
      ctx.translate(fx, 0); if (c.flip) ctx.scale(-1, 1);
      ctx.drawImage(im, -A.ax * k, fy + A.pad * k - im.naturalHeight * k, im.naturalWidth * k, im.naturalHeight * k);
    }
    ctx.restore();
    // one shared name tag over the pair
    const myName = CONFIG.PLAYER_NAME || "Farmer", theirName = (cin.remote && cin.remote.label) || "Partner";
    const leftIsFemale = !c.flip, mineIsFemale = cin.self.gender === "female";
    const leftName = leftIsFemale === mineIsFemale ? myName : theirName, rightName = leftIsFemale === mineIsFemale ? theirName : myName;
    ctx.save(); ctx.globalAlpha = tl.duoA; ctx.font = "bold 12px 'Trebuchet MS', sans-serif"; ctx.textAlign = "center"; ctx.lineWidth = 3; ctx.strokeStyle = "rgba(30,18,10,.85)"; ctx.fillStyle = "#fde6b2";
    const tag = `${leftName} & ${rightName}`, ty = fy - CONFIG.SPRITE_H.player - 6; ctx.strokeText(tag, fx, ty); ctx.fillText(tag, fx, ty); ctx.restore();
    // hearts float up while they kiss
    const mk = A.marks;
    if (c.kind === "kiss" && tl.pt >= mk.kissFrom) for (let i = 0; i < 9; i++) {
      const ts = mk.kissFrom + i * 0.32, age = tl.pt - ts, life = 1.5; if (age < 0 || age > life || ts > mk.kissTo) continue;
      const u = age / life; heart(ctx, fx + (i % 2 ? 1 : -1) * (44 + (i % 3) * 9) + Math.sin(age * 4 + i) * 4, fy - CONFIG.SPRITE_H.player + 8 - u * 46, 3, Math.min(1, (1 - u) * 2.2));   // drift up beside the name tag
    }
  }
  function drawPrompt(ctx, cam, game) {                       // little key hints over your partner while an emote is possible
    const r = cin.remote; if (!r || cur) return;
    const st = stateOf(game); if (!st.sameRoom || st.busy || (cin.ui && cin.ui.modal)) return;
    const kinds = C.KIND_NAMES.filter((n) => C.check(n, me(game), partner(), st).ok); if (!kinds.length) return;
    const fx = r.cx - cam.x, fy = r.y + r.h - cam.y - CONFIG.SPRITE_H.player - 34;
    ctx.save(); ctx.font = "bold 12px 'Trebuchet MS', sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.globalAlpha = 0.8 + 0.2 * Math.sin(now() / 260);
    const txt = kinds.map((n) => `${C.KINDS[n].key.toUpperCase()} ${C.KINDS[n].label}`).join("   "), w = ctx.measureText(txt).width + 16;
    ctx.fillStyle = "rgba(40,24,14,.82)"; ctx.strokeStyle = "rgba(253,230,178,.9)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.rect(Math.round(fx - w / 2), Math.round(fy - 11), Math.round(w), 22); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#fde6b2"; ctx.fillText(txt, fx, fy + 1); ctx.restore();
  }
  cin.things = (game) => [{ y: cur ? cur.anchor.y + 1 : 0, draw: (ctx, cam) => drawDuo(ctx, cam, game) }, { y: 1e9, draw: (ctx, cam) => drawPrompt(ctx, cam, game) }];

  /* ---------- hooks (wraps only) ---------- */
  const pd = Player.prototype.draw;                           // hide / fade the two normal sprites while the pair animation plays
  Player.prototype.draw = function (ctx, cam) {
    const a = this.emoAlpha; if (a === undefined) return pd.call(this, ctx, cam);
    if (a <= 0.01) return;
    ctx.save(); ctx.globalAlpha *= a; try { pd.call(this, ctx, cam); } finally { ctx.restore(); }
  };
  const op = cin.onPos;                                       // while an emote runs we place the partner ourselves
  cin.onPos = function (m) {
    if (!cur) return op.call(this, m);
    if (m && m.w && m.w !== cin.where(g())) { op.call(this, m); finish(g(), true, true); }
  };
  const Gm = Game.prototype, upd = Gm.update;
  Gm.update = function (dt) {
    if (cin.link && !cin.link._emoHooked) { cin.link._emoHooked = true; cin.link.on("emo", onMsg); }
    if (cur) { this.input.down.clear(); this.input.pressed.clear(); }
    else if (cin.ui && !cin.ui.modal && !this.uiMode && !typing()) for (const n of C.KIND_NAMES) if (this.input.wasPressed(C.KINDS[n].key)) { this.input.pressed.delete(C.KINDS[n].key); tryStart(this, n); break; }
    const r = upd.call(this, dt);
    step(this);
    if (cur && this.ui.setHint) this.ui.setHint("");            // no "Press E" prompts while the emote has you
    return r;
  };

  return { get active() { return cur; }, tryStart, _state: () => cur };
})();
