"use strict";
/* ==========================================================
   Moonlight Valley — co-op EMOTES.  Indoors (house / cinema), you and your partner in the same room:

     K  kiss          either farmer, up close                    }  pair animation on both screens: both farmers are locked,
     H  hip slap      the man only, up close                     }  walk to their spots, the clip plays, control comes back.
     U  hug           either farmer, up close                    }  The partner cannot cancel it.
     G  grab          the man, on a woman who is KNEELING        }

     J  kneel         the woman, alone (partner sees it).  She kneels, ties her hair and stays down, locked in place.
                      5 s after the hair is tied, "J - stand up" appears. Until she stands, the man can walk up to her and
                      press G (grab) - or just walk away.

   Like cinema/room.js this only wraps Game methods and hooks the draw lists; pure rules live in emote_core.js.
   ========================================================== */
const Emotes = (() => {
  const C = EmoteCore, cin = Cinema, art = EMOTE_ART;
  const now = () => performance.now();
  const frames = {};
  for (const kind of [...C.KIND_NAMES, "knee"]) frames[kind] = Array.from({ length: art[kind].n }, (_, i) => Object.assign(new Image(), { src: `assets/emote/${kind}_${i}.png` }));
  const kScale = (kind) => CONFIG.SPRITE_H.player / art[kind].refH;

  let cur = null;       // the running pair clip: { id, kind, byMe, t0, anchor, flip, L, pStart, rStart, face, glideFace, impact, fixedFemale }
  let kneel = null;     // MY kneeling state (woman only): { id, t0, upAt, fl }.  The partner's lives on cin.remote.emoPose (same shape).

  /* ---------- state helpers ---------- */
  const g = () => window.game;
  const typing = () => { const e = document.activeElement; return !!e && (/^(INPUT|TEXTAREA|SELECT)$/.test(e.tagName) || e.isContentEditable); };
  const hardBusy = (game) => !!(game.fade || game.lying || game.sitting || !game.inside || game.player.dead || (cin.ui && cin.ui.modal));
  const me = (game) => ({ gender: cin.self.gender, cx: game.player.cx, cy: game.player.cy });
  const partner = () => { const r = cin.remote; return r ? { gender: r.gender, cx: r.cx, cy: r.cy } : null; };
  const poseT = (pose) => ({ t: (now() - pose.t0) / 1000, up: pose.upAt === null || pose.upAt === undefined ? null : (pose.upAt - pose.t0) / 1000 });
  const poseTl = (pose) => { const x = poseT(pose); return C.kneelTimeline(art.knee, x.t, x.up); };
  const kneelHold = (pose) => !!pose && poseTl(pose).phase === "hold";
  const stateOf = (game) => {
    const r = cin.remote, w = cin.where(game);
    return { connected: !!(cin.link && cin.link.open && r), sameRoom: !!r && w !== "out" && r.where === w, active: !!cur,
      busy: hardBusy(game) || !!game.uiMode || !!(r && r.sitSlot >= 0), partnerKneeling: !!(r && r.emoPose), partnerKneelHold: !!(r && kneelHold(r.emoPose)), meKneeling: !!kneel };
  };
  const isFree = (game) => { const room = game.inside, wd = room.world; return (x, y, w, h) => x >= 0 && y >= 0 && x + w <= wd.width && y + h <= wd.height && !room.solids.some((s) => x < s.x + s.w && x + w > s.x && y < s.y + s.h && y + h > s.y); };
  const roles = () => { const f = cin.self.gender === "female"; return { mine: f ? "f" : "m", theirs: f ? "m" : "f" }; };
  const myGender = () => cin.self.gender;

  /* ---------- pair clips: start / receive ---------- */
  function tryStart(game, kind) {
    const r = cin.remote, p = game.player, K = C.KINDS[kind];
    const res = C.check(kind, me(game), partner(), stateOf(game));
    if (!res.ok) { if (!res.silent) game.showMessage(res.msg, 2200); return; }
    const k = kScale(kind), A = art[kind], female = myGender() === "female" ? p : r, male = myGender() === "female" ? r : p;
    let flip = C.chooseFlip(female.cx, male.cx), anchor;
    if (K.needs === "kneeling") {                              // she stays exactly where she kneels; he walks up to her from whichever side has room
      const free = isFree(game);
      for (const fl of [flip, !flip]) {
        const a = { x: female.cx - (fl ? -1 : 1) * A.slots.f0 * k, y: female.y + female.h }, L = C.layout(A, k, a, fl);
        if (free(L.m0.x - male.w / 2, L.m0.y - male.h, male.w, male.h)) { flip = fl; anchor = a; break; }
      }
    } else {
      const mid = { x: (p.cx + r.cx) / 2, y: (p.y + p.h + r.y + r.h) / 2 };
      anchor = C.pickAnchor(A, k, flip, mid, isFree(game));
    }
    if (!anchor) { game.showMessage(C.MSG.space, 2200); return; }
    const id = C.randomId();
    begin(game, { id, kind, byMe: true, anchor, flip, lead: C.LEAD_MS });
    cin.link.send("emo", { a: "go", k: kind, id, lead: C.LEAD_MS, ax: Math.round(anchor.x), ay: Math.round(anchor.y), fl: flip });
  }

  function begin(game, o) {
    const p = game.player, r = cin.remote, k = kScale(o.kind), rtt = (cin.link && cin.link.rtt) || 0;
    const L = C.layout(art[o.kind], k, o.anchor, o.flip);
    cur = { id: o.id, kind: o.kind, byMe: o.byMe, t0: now() + o.lead - (o.byMe ? 0 : Math.min(rtt, 600) / 2), anchor: o.anchor, flip: o.flip, L,
      pStart: { x: p.x, y: p.y }, rStart: { x: r.x, y: r.y }, face: C.FINAL[o.kind](o.flip), glideFace: C.GLIDE_FACE[o.kind](o.flip), impact: false,
      fixedFemale: !!art[o.kind].fixedFemale };
    game.input.down.clear(); game.input.pressed.clear();
  }

  function onGo(game, v) {
    const r = cin.remote, p = game.player, no = (why) => cin.link.send("emo", { a: "no", id: v.id, why });
    if (!r) return;
    if (cur) {                                                // both pressed at once: ids alone decide, same winner on both screens
      if (cur.byMe && cur.id !== v.id && !C.winsTie(cur.id, v.id)) finish(game, true);
      else return no("busy");
    }
    const K = C.KINDS[v.k];
    if (r.gender === myGender() || (K.actor && r.gender !== K.actor)) return no("pair");
    if (K.needs === "kneeling" ? !(kneel && kneelHold({ t0: kneel.t0, upAt: kneel.upAt })) : !!kneel) return no("busy");
    if (hardBusy(game) || r.where !== cin.where(game) || r.sitSlot >= 0) return no("busy");
    const near = (e) => Math.hypot(e.cx - v.ax, e.y + e.h - v.ay) <= C.ACCEPT_RANGE;
    if (!near(p) || !near(r)) return no("far");
    if (game.uiMode) game.closeAllPanels();                    // forced: whatever the partner had open is closed
    begin(game, { id: v.id, kind: v.k, byMe: false, anchor: { x: v.ax, y: v.ay }, flip: v.fl, lead: v.lead });
  }

  /* ---------- kneel (solo, persistent) ---------- */
  function tryKneel(game) {
    const p = game.player, st = stateOf(game), res = C.checkKneel(me(game), st);
    if (!res.ok) { if (!res.silent) game.showMessage(res.msg, 2200); return; }
    const r = cin.remote, near = r && st.sameRoom && Math.hypot(r.cx - p.cx, r.cy - p.cy) < 260;
    const fl = near ? r.cx < p.cx : p.dirKey === "left";       // she kneels facing her partner when he's close, otherwise the way she was looking
    kneel = { id: C.randomId(), t0: now(), upAt: null, fl }; p.emoPose = kneel; game.input.down.clear(); game.input.pressed.clear();
    sendKnee();
  }
  function sendKnee() {
    if (!kneel || !cin.link || !cin.link.open) return;
    cin.link.send("emo", { a: "knee", id: kneel.id, fl: kneel.fl, el: Math.max(0, (now() - kneel.t0) / 1000) });
    if (kneel.upAt !== null) cin.link.send("emo", { a: "up", id: kneel.id });
  }
  function standUp(game, notify = true) {
    if (!kneel || kneel.upAt !== null) return;
    kneel.upAt = now();
    if (notify && cin.link && cin.link.open) cin.link.send("emo", { a: "up", id: kneel.id });
  }
  function onKnee(v) {                                         // the partner (the woman) knelt: show her pose on our screen
    const r = cin.remote; if (!r || r.gender !== "female") return;
    const rtt = (cin.link && cin.link.rtt) || 0;
    r.emoPose = { id: v.id, t0: now() - v.el * 1000 - Math.min(rtt, 600) / 2, upAt: null, fl: v.fl };
  }
  function onUp(v) { const r = cin.remote; if (r && r.emoPose && r.emoPose.id === v.id && r.emoPose.upAt === null) r.emoPose.upAt = now() - Math.min((cin.link && cin.link.rtt) || 0, 600) / 2; }
  function tickPoses(game) {
    const p = game.player, r = cin.remote;
    if (kneel && (game.fade || !game.inside || game.lying || game.sitting)) { standUp(game); kneel.upAt = now() - 10000; }          // taken somewhere else: stand up at once
    for (const e of [p, r]) if (e && e.emoPose && poseTl(e.emoPose).phase === "gone") { e.emoPose = null; if (e === p) kneel = null; }
  }

  function onMsg(m) {
    const game = g(), v = C.validateMsg(m); if (!game || !v) return;
    if (v.a === "knee") return onKnee(v);
    if (v.a === "up") return onUp(v);
    if (v.a === "stop") { if (cur && cur.id === v.id) finish(game, true); return; }
    if (v.a === "no") { if (cur && cur.id === v.id && cur.byMe) { finish(game, true); game.showMessage(v.why === "far" ? C.MSG.far : C.MSG.theirbusy, 2200); } return; }
    onGo(game, v);
  }

  /* ---------- the running pair clip (called every frame after the game's own update) ---------- */
  function step(game) {
    tickPoses(game);
    const c = cur; if (!c) return;
    const r = cin.remote, p = game.player;
    if (!r || r.where !== cin.where(game) || game.fade || game.lying || !game.inside) return finish(game, true, true);
    game.input.down.clear(); game.input.pressed.clear();      // locked: no walking, no interacting
    const A = art[c.kind], tl = C.timeline(A, (now() - c.t0) / 1000), rl = roles();
    const mineStart = c.L[rl.mine + "0"], theirStart = c.L[rl.theirs + "0"], mineEnd = c.L[rl.mine + "1"], theirEnd = c.L[rl.theirs + "1"];
    const fixed = (e) => c.fixedFemale && (e === p ? myGender() : r.gender) === "female";     // grab: the kneeling woman does not move
    const put = (e, s) => { if (fixed(e)) return; e.x = s.x - e.w / 2; e.y = s.y - e.h; if (e === r) { e.tx = e.x; e.ty = e.y; } };
    const myFace = (set) => set[myGender()], theirFace = (set) => set[r.gender];
    if (tl.phase === "done") return finish(game, false);
    if (tl.phase === "glide") {
      const u = C.ease(tl.u);
      for (const [e, from, to, set] of [[p, c.pStart, mineStart, myFace(c.glideFace)], [r, c.rStart, theirStart, theirFace(c.glideFace)]]) {
        e.emoAlpha = undefined; if (fixed(e)) continue;
        const px = e.x, py = e.y;
        put(e, { x: from.x + e.w / 2 + (to.x - from.x - e.w / 2) * u, y: from.y + e.h + (to.y - from.y - e.h) * u });
        const moved = Math.hypot(e.x - px, e.y - py); e.moving = moved > 0.05; e.walkDist += moved; e.dirKey = set;
      }
    } else if (tl.phase === "play") {
      put(p, tl.atEnd ? mineEnd : mineStart); put(r, tl.atEnd ? theirEnd : theirStart);
      if (!fixed(p)) p.dirKey = myFace(c.face); if (!fixed(r)) r.dirKey = theirFace(c.face);
      p.moving = r.moving = false;
      p.emoAlpha = r.emoAlpha = tl.realA;
      if (!c.impact && A.marks.impact !== undefined && tl.pt >= A.marks.impact) { c.impact = true; game.ui.floatText(c.anchor.x, c.anchor.y - 100, "Smack!", "#ffe26a"); }
    }
  }

  function finish(game, abort, notify) {
    const c = cur; if (!c) return; cur = null;
    const p = game.player, r = cin.remote, rl = roles();
    for (const e of [p, r]) if (e) { e.emoAlpha = undefined; e.moving = false; }
    if (!abort && r) {
      const fixed = (e) => c.fixedFemale && (e === p ? myGender() : r.gender) === "female";
      const put = (e, s) => { if (fixed(e)) return; e.x = s.x - e.w / 2; e.y = s.y - e.h; if (e === r) { e.tx = e.x; e.ty = e.y; } };
      put(p, c.L[rl.mine + "1"]); put(r, c.L[rl.theirs + "1"]);
      if (!fixed(p)) p.dirKey = c.face[myGender()]; if (!fixed(r)) r.dirKey = c.face[r.gender];
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
  function nameTag(ctx, text, x, y) {
    ctx.save(); ctx.font = "bold 12px 'Trebuchet MS', sans-serif"; ctx.textAlign = "center"; ctx.lineWidth = 3; ctx.strokeStyle = "rgba(30,18,10,.85)"; ctx.fillStyle = "#fde6b2";
    ctx.strokeText(text, x, y); ctx.fillText(text, x, y); ctx.restore();
  }
  function drawDuo(ctx, cam) {
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
    const leftIsFemale = !c.flip, mineIsFemale = myGender() === "female";
    const leftName = leftIsFemale === mineIsFemale ? myName : theirName, rightName = leftIsFemale === mineIsFemale ? theirName : myName;
    ctx.save(); ctx.globalAlpha = tl.duoA; nameTag(ctx, `${leftName} & ${rightName}`, fx, fy - CONFIG.SPRITE_H.player - 6); ctx.restore();
    // hearts float up while they kiss (the hug video draws its own)
    const mk = A.marks;
    if (c.kind === "kiss" && tl.pt >= mk.kissFrom) for (let i = 0; i < 9; i++) {
      const ts = mk.kissFrom + i * 0.32, age = tl.pt - ts, life = 1.5; if (age < 0 || age > life || ts > mk.kissTo) continue;
      const u = age / life; heart(ctx, fx + (i % 2 ? 1 : -1) * (44 + (i % 3) * 9) + Math.sin(age * 4 + i) * 4, fy - CONFIG.SPRITE_H.player + 8 - u * 46, 3, Math.min(1, (1 - u) * 2.2));
    }
  }
  function drawPrompt(ctx, cam, game) {                       // little key hints over your partner while an emote is possible
    const r = cin.remote; if (!r || cur) return;
    const st = stateOf(game); if (!st.sameRoom || st.busy || (cin.ui && cin.ui.modal)) return;
    const kinds = C.KIND_NAMES.filter((n) => C.check(n, me(game), partner(), st).ok); if (!kinds.length) return;
    const fx = r.cx - cam.x, fy = r.y + r.h - cam.y - (r.emoPose ? 80 : CONFIG.SPRITE_H.player) - 34;
    ctx.save(); ctx.font = "bold 12px 'Trebuchet MS', sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.globalAlpha = 0.8 + 0.2 * Math.sin(now() / 260);
    const txt = kinds.map((n) => `${C.KINDS[n].key.toUpperCase()} ${C.KINDS[n].label}`).join("   "), w = ctx.measureText(txt).width + 16;
    ctx.fillStyle = "rgba(40,24,14,.82)"; ctx.strokeStyle = "rgba(253,230,178,.9)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.rect(Math.round(fx - w / 2), Math.round(fy - 11), Math.round(w), 22); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#fde6b2"; ctx.fillText(txt, fx, fy + 1); ctx.restore();
  }
  cin.things = (game) => [{ y: cur ? cur.anchor.y + 1 : 0, draw: (ctx, cam) => drawDuo(ctx, cam) }, { y: 1e9, draw: (ctx, cam) => drawPrompt(ctx, cam, game) }];

  /* a farmer in the kneeling pose: the pose clip fades in over the normal sprite, and out again when she stands */
  function drawPosed(ctx, cam, pose, pd) {
    const A = art.knee, tl = poseTl(pose), k = kScale("knee");
    const footX = this.cx - cam.x, footY = this.y + this.h - cam.y, normal = 1 - tl.a;
    if (normal > 0.01) { ctx.save(); ctx.globalAlpha *= normal; pd.call(this, ctx, cam); ctx.restore(); }
    else if (CONFIG.PLAYER_NAME) nameTag(ctx, CONFIG.PLAYER_NAME, footX, footY - 80);
    if (tl.a <= 0.01) return;
    const im = frames.knee[tl.frame]; ctx.save(); ctx.globalAlpha *= tl.a;
    ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.beginPath(); ctx.ellipse(footX, footY + 2, 22, 6, 0, 0, Math.PI * 2); ctx.fill();
    if (im.complete && im.naturalWidth) {
      ctx.translate(footX, 0); if (pose.fl) ctx.scale(-1, 1);
      ctx.drawImage(im, -A.ax * k, footY + A.pad * k - im.naturalHeight * k, im.naturalWidth * k, im.naturalHeight * k);
    }
    ctx.restore();
  }

  /* ---------- hooks (wraps only) ---------- */
  const pd = Player.prototype.draw;                           // hide / fade the normal sprite while a clip plays, or draw the kneeling pose
  Player.prototype.draw = function (ctx, cam) {
    const a = this.emoAlpha, pose = this.emoPose;
    if (a === undefined && !pose) return pd.call(this, ctx, cam);
    if (a !== undefined && a <= 0.01) return;
    ctx.save(); if (a !== undefined) ctx.globalAlpha *= a;
    try { if (pose) drawPosed.call(this, ctx, cam, pose, pd); else pd.call(this, ctx, cam); } finally { ctx.restore(); }
  };
  const op = cin.onPos;                                       // while a pair clip runs we place the partner ourselves
  cin.onPos = function (m) {
    if (!cur) return op.call(this, m);
    if (m && m.w && m.w !== cin.where(g())) { op.call(this, m); finish(g(), true, true); }
  };
  const Gm = Game.prototype, upd = Gm.update;
  Gm.update = function (dt) {
    if (cin.link && !cin.link._emoHooked) {
      cin.link._emoHooked = true; cin.link.on("emo", onMsg);
      cin.link.on("hello", sendKnee); cin.link.on("restored", sendKnee);          // a partner who joins / reconnects sees her kneeling
    }
    const locked = !!(cur || kneel);
    if (locked) {
      if (kneel && !cur && kneel.upAt === null && this.input.wasPressed("j") && poseTl(kneel).canStand) standUp(this);
      this.input.down.clear(); this.input.pressed.clear();
    } else if (cin.ui && !cin.ui.modal && !this.uiMode && !typing()) {
      for (const n of C.KIND_NAMES) if (this.input.wasPressed(C.KINDS[n].key)) { this.input.pressed.delete(C.KINDS[n].key); tryStart(this, n); break; }
      if (this.input.wasPressed("j")) { this.input.pressed.delete("j"); tryKneel(this); }
    }
    const r = upd.call(this, dt);
    step(this);
    if (cur || kneel) {                                       // no "Press E" prompts while the emote has you
      let hint = "";
      if (kneel && !cur && kneel.upAt === null) { const tl = poseTl(kneel); if (tl.phase === "hold") hint = tl.canStand ? "Press J — Stand up (or stay like this)" : `Kneeling… you can stand up in ${Math.ceil(tl.left)}s`; }
      if (this.ui.setHint) this.ui.setHint(hint);
    }
    return r;
  };

  return { get active() { return cur; }, get kneeling() { return kneel; }, tryStart, tryKneel, _state: () => cur };
})();
