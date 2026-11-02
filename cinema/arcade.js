"use strict";
/* ==========================================================
   Moonlight Valley — arcade cabinet #1: Whack-a-Mole, Memory Lights and How Fast?, solo or head-to-head with your partner.
   Pure rules + the shared seed live in cinema/arcade_core.js.  This file is the screens, the match protocol and the game hooks.

   How the head-to-head works (no new multiplayer system: it rides the existing co-op link, direct WebRTC or the Ably relay):
     - one message type, "arc", with an action field.   ch (challenge) -> ac / dc (accept / decline) -> go (the challenger picks a seed and a start time)
       sc = live score   rs = final result   rm = rematch vote   bye = I left the machine
     - both clients derive the SAME mole schedule / light sequence / GO delays from the seed, then play on their own screen at the same time
       (Memory Lights is turn-based: the challenger plays first, the partner starts the moment that result arrives)
     - each client sends only ITS OWN result; both then run the same pure judge() on the same two results, so both screens show the same winner
     - results are checked (bounds, schedule length, score = f(level), one submission per round) before they are believed
   While the machine is open the farmer is frozen and the keyboard is the machine's, not the game's.
   ========================================================== */
const Arcade = (() => {
  const A = ArcadeCore, cin = Cinema;
  const cfg = { awayMs: 20000, inviteMs: 20000, acceptMs: 25000 };           // partner-gone grace, invite lifetime, wait for the other side's go
  const HS_KEY = "mv_arcade_hs_v1";
  const $ = (r, s) => r.querySelector(s);
  const mk = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; };
  const okImg = (im) => !!im && im.complete !== false && (im.naturalWidth || im.width) > 0;
  const gm = () => window.game;
  const typing = (t) => !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);

  let el = null, open = false, run = null, match = null, invite = null, keyHooked = false, tick = null;

  /* ---------- tiny persistence: local high scores ---------- */
  const loadHS = () => { try { return JSON.parse(localStorage.getItem(HS_KEY)) || {}; } catch (e) { return {}; } };
  const saveHS = (h) => { try { localStorage.setItem(HS_KEY, JSON.stringify(h)); } catch (e) { /* private mode */ } };
  function recordHS(game, norm) {                                                  // returns true when it is a new personal best
    const h = loadHS(); let rec = false;
    if (game === "whack") { if (!(h.whack >= norm.h)) { h.whack = norm.h; rec = norm.h > 0; } }
    else if (game === "memory") { if (!(h.memory >= norm.lv)) { h.memory = norm.lv; h.memoryScore = norm.score; rec = norm.lv > 0; } }
    else if (game === "reaction") { if (!(h.reaction <= norm.best) && norm.best < A.REACT.PENALTY_MS) { h.reaction = norm.best; rec = true; } if (!(h.reactionAvg <= norm.avg) && norm.f.every((x) => !x)) h.reactionAvg = Math.round(norm.avg); }
    saveHS(h); return rec;
  }
  const hsLine = (game) => {
    const h = loadHS();
    if (game === "whack") return h.whack != null ? `Best: ${h.whack} hits` : "No score yet";
    if (game === "memory") return h.memory != null ? `Best: level ${h.memory} · ${h.memoryScore} pts` : "No score yet";
    return h.reaction != null ? `Best: ${h.reaction} ms` : "No score yet";
  };

  /* ---------- identities ---------- */
  const me = () => ({ id: cin.self.id, name: cin.self.name || "You", g: cin.self.gender });
  const peerOf = () => { const L = cin.link; return L && L.peer ? { id: L.peer.id, name: L.peer.name || "Partner", g: L.peer.gender } : null; };
  const online = () => { const L = cin.link; return !!(L && L.open && L.peer); };
  const partnerHere = () => online() && !!cin.remote && cin.remote.where === "gaming";
  const live = () => !!match && match.phase !== "done" && match.phase !== "void" && match.phase !== "closed";
  const send = (a, extra) => { const L = cin.link; if (!L || !L.open || !match) return false; return L.send("arc", Object.assign({ a, m: match.m }, extra || {})); };
  const mid = () => (match ? match.m : "");
  const newBase = () => A.newSeed().toString(36) + Date.now().toString(36).slice(-4);
  const levelOf = (score) => { let l = 0; while (A.memoryScore(l + 1) <= score) l++; return l; };
  const ord = (n) => (n === 1 ? "1st" : "2nd");

  /* ======================================================================
     UI
     ====================================================================== */
  const CSS = `
  body.arc-open #hint { display: none !important; }
  #arc { position: fixed; inset: 0; z-index: 30; display: flex; align-items: center; justify-content: center; padding: 10px; background: rgba(20,12,6,.72); font-family: 'Trebuchet MS','Segoe UI',system-ui,sans-serif; color: #fde6b2; -webkit-user-select: none; user-select: none; }
  #arc[hidden] { display: none; }
  #arc .card { width: min(720px, 100%); max-height: 100%; overflow: auto; background: rgba(59,38,22,.97); border: 3px solid #a8693a; border-radius: 12px; box-shadow: 0 10px 34px rgba(0,0,0,.55), inset 0 0 0 2px #3b2616; padding: 12px 14px 14px; }
  #arc header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  #arc header b { font-size: 19px; letter-spacing: .3px; } #arc header .sub { color: #d9b98a; font-size: 13px; flex: 1; }
  #arc button { font: inherit; cursor: pointer; color: #fde6b2; background: #6b4326; border: 2px solid #3b2616; border-radius: 7px; padding: 6px 12px; box-shadow: 0 2px 0 #2a1a0e; transition: transform .08s, background .12s; }
  #arc button:hover:not(:disabled) { background: #7d5230; } #arc button:active:not(:disabled) { transform: translateY(2px); box-shadow: none; }
  #arc button:disabled { opacity: .5; cursor: default; } #arc button.pri { background: #a8693a; color: #2a1a0e; font-weight: bold; } #arc button.pri:hover:not(:disabled) { background: #bd7a46; }
  #arc button:focus-visible { outline: 2px solid #f4bf57; outline-offset: 2px; }
  #arc .games { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  #arc .gcard { background: rgba(0,0,0,.22); border: 2px solid #5a3a22; border-radius: 10px; padding: 10px; display: flex; flex-direction: column; gap: 6px; }
  #arc .gcard h3 { margin: 0; font-size: 16px; } #arc .gcard p { margin: 0; font-size: 12.5px; color: #d9b98a; flex: 1; } #arc .gcard .hs { font-size: 12px; color: #f4bf57; }
  #arc .gcard .row { display: flex; gap: 6px; flex-wrap: wrap; } #arc .gcard .row button { flex: 1; min-width: 70px; padding: 6px 4px; font-size: 13px; }
  #arc .note { margin: 10px 2px 0; font-size: 12.5px; color: #d9b98a; min-height: 16px; }
  #arc .board { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px; }
  #arc .board[hidden], #arc [hidden] { display: none !important; }
  #arc .chip { background: rgba(0,0,0,.25); border: 2px solid #5a3a22; border-radius: 9px; padding: 5px 9px; min-width: 0; transition: border-color .2s, background .2s; }
  #arc .chip.lead { border-color: #f4bf57; background: rgba(244,191,87,.12); } #arc .chip.away { opacity: .55; }
  #arc .chip .nm { font-size: 13px; color: #d9b98a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } #arc .chip .nm i { font-style: normal; color: #f4bf57; margin-right: 4px; }
  #arc .chip .val { font-size: 20px; font-weight: bold; } #arc .chip .rk { font-size: 12px; color: #d9b98a; } #arc .chip.lead .rk { color: #f4bf57; font-weight: bold; }
  #arc .hud { display: flex; justify-content: space-between; font-size: 18px; font-weight: bold; margin: 2px 4px 8px; } #arc .hud span span { color: #f4bf57; }
  #arc .stage { position: relative; min-height: 270px; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  #arc .count { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 72px; font-weight: bold; background: rgba(59,38,22,.88); border-radius: 10px; z-index: 5; text-shadow: 0 3px 0 #2a1a0e; }
  #arc .count small { display: block; font-size: 15px; font-weight: normal; color: #d9b98a; text-align: center; text-shadow: none; }
  #arc .holes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; width: min(330px, 92%); }
  #arc .hole { position: relative; aspect-ratio: 1; padding: 0 !important; border-radius: 50% 50% 14px 14px !important; background: radial-gradient(ellipse at 50% 75%, #1c120a 0 52%, #5a3a22 54%) !important; overflow: hidden; touch-action: manipulation; }
  #arc .hole .mole { position: absolute; left: 12%; right: 12%; bottom: -80%; height: 80%; transition: bottom .09s ease-out; pointer-events: none; }
  #arc .hole.up .mole { bottom: 4%; } #arc .hole.hit .mole { bottom: -80%; }
  #arc .hole kbd { position: absolute; top: 3px; left: 6px; font: 11px monospace; color: #a8693a; }
  #arc .pads { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; width: min(300px, 92%); }
  #arc .pad { aspect-ratio: 1.3; font-size: 22px; font-weight: bold; opacity: .55; border-radius: 12px !important; color: rgba(0,0,0,.45) !important; border-color: #2a1a0e !important; }
  #arc .pad[data-p="0"] { background: #7f9a5c !important; } #arc .pad[data-p="1"] { background: #b8553f !important; } #arc .pad[data-p="2"] { background: #d0a63c !important; } #arc .pad[data-p="3"] { background: #5a7894 !important; }
  #arc .pad.lit { opacity: 1; filter: brightness(1.35); transform: scale(1.04); box-shadow: 0 0 18px rgba(253,230,178,.6) !important; }
  #arc .pads.locked .pad { pointer-events: none; }
  #arc .rx { width: min(420px, 94%); height: 190px; border-radius: 14px; border: 3px solid #3b2616; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; background: #6e3a2c; cursor: pointer; touch-action: manipulation; font-size: 28px; font-weight: bold; transition: background .06s; }
  #arc .rx small { font-size: 14px; font-weight: normal; margin-top: 6px; opacity: .85; } #arc .rx.go { background: #4f7c3f; } #arc .rx.show { background: #4b3a2a; } #arc .rx.late { background: #7d4a1f; }
  #arc .dots { display: flex; gap: 6px; margin-top: 10px; } #arc .dots i { width: 14px; height: 14px; border-radius: 50%; background: #5a3a22; border: 2px solid #3b2616; } #arc .dots i.on { background: #a8693a; } #arc .dots i.bad { background: #b8553f; }
  #arc .status { margin-top: 10px; min-height: 18px; text-align: center; font-size: 14px; color: #d9b98a; }
  #arc .banner { text-align: center; font-size: 40px; font-weight: bold; letter-spacing: 1px; margin: 4px 0 6px; text-shadow: 0 3px 0 #2a1a0e; } #arc .banner.win { color: #f4bf57; } #arc .banner.lose { color: #d98a7a; } #arc .banner.draw { color: #fde6b2; }
  #arc .vs { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 6px 0 4px; } #arc .vs.one { grid-template-columns: 1fr; max-width: 320px; margin-left: auto; margin-right: auto; }
  #arc .pc { position: relative; text-align: center; background: rgba(0,0,0,.22); border: 2px solid #5a3a22; border-radius: 10px; padding: 18px 8px 10px; } #arc .pc.winner { border-color: #f4bf57; background: rgba(244,191,87,.14); box-shadow: 0 0 14px rgba(244,191,87,.25); }
  #arc .pc .tag { position: absolute; top: -10px; left: 50%; transform: translateX(-50%); background: #f4bf57; color: #2a1a0e; font-size: 12px; font-weight: bold; padding: 1px 10px; border-radius: 9px; white-space: nowrap; }
  #arc .pc canvas { width: 48px; height: 64px; image-rendering: pixelated; } #arc .pc .nm { font-size: 17px; font-weight: bold; word-break: break-word; } #arc .pc .who { font-size: 12px; color: #d9b98a; }
  #arc .pc .big { font-size: 26px; font-weight: bold; margin-top: 4px; } #arc .pc .det { font-size: 12.5px; color: #d9b98a; min-height: 16px; }
  #arc .actions { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; margin-top: 12px; } #arc .actions .info { flex-basis: 100%; text-align: center; font-size: 13px; color: #d9b98a; min-height: 17px; }
  #arc .wait { position: absolute; inset: 0; z-index: 8; background: rgba(42,26,14,.9); border-radius: 10px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; font-size: 17px; text-align: center; padding: 16px; }
  #arc-invite { position: fixed; z-index: 46; top: 60px; left: 50%; transform: translateX(-50%); width: min(92vw, 420px); display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: 11px; background: rgba(59,38,22,.95); border: 2px solid #e8c66a; color: #fde6b2; font: 14px 'Trebuchet MS', sans-serif; box-shadow: 0 6px 22px rgba(0,0,0,.5); animation: arcIn .25s ease-out; }
  #arc-invite[hidden] { display: none; } #arc-invite span { flex: 1; } #arc-invite button { font: inherit; cursor: pointer; color: #fde6b2; background: #6b4326; border: 2px solid #3b2616; border-radius: 7px; padding: 5px 11px; } #arc-invite button.pri { background: #a8693a; color: #2a1a0e; font-weight: bold; }
  @keyframes arcIn { from { opacity: 0; transform: translate(-50%, -8px); } to { opacity: 1; transform: translate(-50%, 0); } }
  @media (max-width: 640px) { #arc .games { grid-template-columns: 1fr; } #arc .banner { font-size: 30px; } #arc .stage { min-height: 240px; } #arc .card { padding: 9px; } #arc .vs { gap: 6px; } #arc .pc .big { font-size: 21px; } }
  @media (prefers-reduced-motion: reduce) { #arc *, #arc-invite { transition: none !important; animation: none !important; } }`;

  const MOLE = `<svg class="mole" viewBox="0 0 40 32" aria-hidden="true"><ellipse cx="20" cy="18" rx="15" ry="14" fill="#8a5a36"/><ellipse cx="20" cy="22" rx="9" ry="7" fill="#d9b98a"/><circle cx="14" cy="14" r="2.4" fill="#2a1a0e"/><circle cx="26" cy="14" r="2.4" fill="#2a1a0e"/><ellipse cx="20" cy="19" rx="3.2" ry="2.3" fill="#c9788a"/><rect x="18.4" y="22.5" width="3.2" height="3.6" rx="1" fill="#fff6e0"/></svg>`;

  function build() {
    if (el) return el;
    const st = document.createElement("style"); st.id = "arc-css"; st.textContent = CSS; document.head.appendChild(st);
    const root = mk(`<div id="arc" role="dialog" aria-modal="true" aria-label="Arcade" hidden>
      <div class="card" style="position:relative">
        <header><b id="arc-title">Arcade</b><span class="sub" id="arc-sub"></span><button id="arc-x" title="Leave the machine (Esc)">✕ Exit</button></header>
        <div class="board" id="arc-board" hidden></div>
        <div id="arc-menu"></div>
        <div id="arc-play" hidden></div>
        <div id="arc-res" hidden></div>
        <div class="wait" id="arc-wait" hidden></div>
      </div></div>`);
    const inv = mk(`<div id="arc-invite" role="alert" hidden><span></span><button class="pri" data-y>Accept</button><button data-n>Decline</button></div>`);
    const host = (cin.ui && cin.ui.stage) || document.body;      // inside #cin-stage so it also shows in fullscreen; the chat panel (z 40) stays on top
    host.append(root, inv);
    el = { root, card: $(root, ".card"), title: $(root, "#arc-title"), sub: $(root, "#arc-sub"), board: $(root, "#arc-board"), menu: $(root, "#arc-menu"), play: $(root, "#arc-play"), res: $(root, "#arc-res"), wait: $(root, "#arc-wait"), inv };
    $(root, "#arc-x").addEventListener("click", () => exitPress());
    inv.querySelector("[data-y]").addEventListener("click", () => answerInvite(true));
    inv.querySelector("[data-n]").addEventListener("click", () => answerInvite(false));
    for (const ev of ["mousedown", "wheel", "keyup"]) root.addEventListener(ev, (e) => e.stopPropagation());
    return el;
  }
  const show = (which) => { for (const k of ["menu", "play", "res"]) el[k].hidden = k !== which; };

  /* ---------- the scoreboard: both names, live values, rank, who leads ---------- */
  function valueOf(side) {                                    // side: "me" | "peer" -> { v: comparable number | null, text }
    const L = match.live[side], who = match[side];
    if (match.game === "whack") return L == null ? { v: 0, text: "0 hits" } : { v: L.s, text: `${L.s} hit${L.s === 1 ? "" : "s"}` };
    if (match.game === "memory") {
      if (L == null) return { v: null, text: match.first === who.id ? "Ready" : "Waiting for turn" };
      return { v: L.s, text: `Lv ${levelOf(L.s)} · ${L.s} pts` };
    }
    return L == null || L.avg == null ? { v: null, text: "—" } : { v: L.avg, text: `${Math.round(L.avg)} ms avg` };
  }
  function renderBoard() {
    if (!el) return;
    if (!match || match.solo) { el.board.hidden = true; return; }
    el.board.hidden = false; el.board.textContent = "";
    const a = valueOf("me"), b = valueOf("peer"), s = A.standings(match.game, a.v, b.v);
    for (const [side, val, rk] of [["me", a, s.me], ["peer", b, s.them]]) {
      const who = match[side], c = document.createElement("div"); c.className = "chip" + (rk.leading ? " lead" : "") + (side === "peer" && match.away ? " away" : "");
      const nm = document.createElement("div"); nm.className = "nm";
      const tag = document.createElement("i"); tag.textContent = who.id === match.p1 ? "P1" : "P2"; nm.append(tag, document.createTextNode(who.name + (side === "me" ? " (you)" : "")));
      const v = document.createElement("div"); v.className = "val"; v.textContent = val.text;
      const r = document.createElement("div"); r.className = "rk";
      r.textContent = side === "peer" && match.away ? "disconnected…" : a.v == null && b.v == null ? "—" : rk.tied ? "Tied" : `${ord(rk.rank)}${rk.leading ? " · Leading" : ""}`;
      c.append(nm, v, r); el.board.appendChild(c);
    }
  }

  /* ---------- avatar: the player's own sprite frame (clothes and all) ---------- */
  function avatar(isMe) {
    const cv = document.createElement("canvas"); cv.width = 48; cv.height = 64;
    try {
      const pl = isMe ? gm().player : cin.remote, im = pl && pl.sprite && pl.sprite.frame("down", 0);
      if (okImg(im)) { const w = im.naturalWidth || im.width, h = im.naturalHeight || im.height, k = Math.min(48 / w, 64 / h); const c = cv.getContext("2d"); c.imageSmoothingEnabled = false; c.drawImage(im, (48 - w * k) / 2, 64 - h * k, w * k, h * k); }
    } catch (e) { /* keep the empty canvas */ }
    return cv;
  }

  /* ======================================================================
     MENU
     ====================================================================== */
  function showMenu(note) {
    build(); closeRun(); el.title.textContent = "Arcade"; el.sub.textContent = "Pick a game"; el.board.hidden = true; el.wait.hidden = true; show("menu");
    const peer = peerOf(), here = partnerHere() && !live();
    el.menu.textContent = ""; const grid = document.createElement("div"); grid.className = "games";
    const info = { whack: "Whack the moles as they pop up. 30 seconds.", memory: "Watch the lights, then repeat the pattern. It grows each level.", reaction: "Wait for GO, then press as fast as you can. 5 rounds." };
    for (const g of A.GAMES) {
      const c = document.createElement("div"); c.className = "gcard";
      const h = document.createElement("h3"); h.textContent = A.NAMES[g]; const p = document.createElement("p"); p.textContent = info[g];
      const hs = document.createElement("div"); hs.className = "hs"; hs.textContent = hsLine(g);
      const row = document.createElement("div"); row.className = "row";
      const solo = document.createElement("button"); solo.className = "pri"; solo.textContent = "Play solo"; solo.dataset.solo = g; solo.addEventListener("click", () => startSolo(g));
      row.appendChild(solo);
      if (peer) {
        const vs = document.createElement("button"); vs.dataset.vs = g; vs.textContent = `vs ${peer.name}`; vs.disabled = !here; vs.title = here ? "" : `${peer.name} needs to be in the Gaming Room`;
        vs.addEventListener("click", () => challenge(g)); row.appendChild(vs);
      }
      c.append(h, p, hs, row); grid.appendChild(c);
    }
    el.menu.appendChild(grid);
    const n = document.createElement("div"); n.className = "note"; n.id = "arc-note";
    n.textContent = note || (peer ? (here ? `${peer.name} is here. Challenge them to a head-to-head!` : (online() ? `${peer.name} isn't in the Gaming Room right now.` : "Your partner is offline — solo only.")) : "Link up with a partner (Co-op button) to play head-to-head.");
    el.menu.appendChild(n);
    const first = $(grid, "button"); if (first) first.focus({ preventScroll: true });
  }

  /* ======================================================================
     GAME RUNNERS   (each: { stop(), keys(e) })
     ====================================================================== */
  function closeRun() { if (run) { run.dead = true; try { run.stop && run.stop(); } catch (e) { /* ignore */ } } run = null; }

  function begin(game, seed, startPerf, opts) {                 // opts.watch (memory second player): don't start until told
    build(); closeRun();
    const m = match; el.title.textContent = A.NAMES[game]; el.sub.textContent = m && !m.solo ? `${m.me.name} vs ${m.peer.name}` : "Solo"; show("play"); el.wait.hidden = true;
    renderBoard();
    const ctx = { game, seed, startPerf, solo: !m || m.solo, onScore: (sc) => scored(sc), onDone: (res) => finished(res), dead: false };
    run = ctx;
    ({ whack: runWhack, memory: runMemory, reaction: runReaction })[game](ctx, opts || {});
    return ctx;
  }
  const countdownEl = (stage) => { const c = mk(`<div class="count"></div>`); stage.appendChild(c); return c; };

  /* ---------- Whack-a-Mole ---------- */
  const WKEY = { 7: 0, 8: 1, 9: 2, 4: 3, 5: 4, 6: 5, 1: 6, 2: 7, 3: 8 };
  function runWhack(ctx) {
    const sched = A.whackSchedule(ctx.seed); let hits = 0, idx = -1, hit = false;
    el.play.innerHTML = `<div class="hud"><span>Score <span id="w-s">0</span></span><span>Time <span id="w-t">30</span></span></div><div class="stage"><div class="holes"></div></div><div class="status" id="w-st">Click, tap or press 7-8-9 / 4-5-6 / 1-2-3 to whack.</div>`;
    const holes = $(el.play, ".holes"), stage = $(el.play, ".stage"), cnt = countdownEl(stage), cells = [];
    for (let i = 0; i < 9; i++) { const b = document.createElement("button"); b.className = "hole"; b.dataset.i = i; b.setAttribute("aria-label", "hole " + (i + 1)); b.innerHTML = MOLE + `<kbd>${Object.keys(WKEY).find((k) => WKEY[k] === i)}</kbd>`; holes.appendChild(b); cells.push(b); }
    const whack = (i) => {
      if (ctx.dead || idx < 0 || hit) return; const mo = sched[idx]; if (!mo || mo.hole !== i) return;
      const el_ = performance.now() - ctx.startPerf; if (el_ < mo.t || el_ >= mo.t + mo.dur) return;
      hit = true; hits++; cells[i].classList.remove("up"); cells[i].classList.add("hit"); $(el.play, "#w-s").textContent = hits; ctx.onScore({ s: hits });
    };
    for (const b of cells) b.addEventListener("pointerdown", (e) => { e.preventDefault(); whack(+b.dataset.i); });
    ctx.keys = (e) => { if (e.key in WKEY) { whack(WKEY[e.key]); return true; } return false; };
    const frame = () => {
      if (ctx.dead) return; const t = performance.now() - ctx.startPerf;
      if (t < 0) { cnt.hidden = false; cnt.innerHTML = `${Math.max(1, Math.ceil(-t / 1000))}<small>${ctx.solo ? "" : "get ready — same moles for both of you"}</small>`; }
      else {
        cnt.hidden = true;
        let cur = -1; for (let k = Math.max(0, idx); k < sched.length; k++) { if (t >= sched[k].t + sched[k].dur) continue; if (t >= sched[k].t) cur = k; break; }
        if (cur !== idx) { if (idx >= 0) { cells[sched[idx].hole].classList.remove("up", "hit"); } idx = cur; hit = false; if (idx >= 0) cells[sched[idx].hole].classList.add("up"); }
        $(el.play, "#w-t").textContent = Math.max(0, Math.ceil((A.WHACK.MS - t) / 1000));
        if (t >= A.WHACK.MS) { ctx.dead = true; ctx.onDone({ h: hits }); return; }
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  /* ---------- Memory Lights ---------- */
  const PKEY = { 1: 0, 2: 1, 3: 2, 4: 3, ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3 };
  function runMemory(ctx, opts) {
    let level = 0, score = 0, seq = [], pos = 0, phase = "idle", timers = [];
    el.play.innerHTML = `<div class="hud"><span>Level <span id="m-l">1</span></span><span>Score <span id="m-s">0</span></span></div><div class="stage"><div class="pads locked"></div></div><div class="status" id="m-st"></div>`;
    const pads = $(el.play, ".pads"), stage = $(el.play, ".stage"), st = $(el.play, "#m-st"), cells = [];
    for (let i = 0; i < 4; i++) { const b = document.createElement("button"); b.className = "pad"; b.dataset.p = i; b.setAttribute("aria-label", "light " + (i + 1)); b.textContent = i + 1; pads.appendChild(b); cells.push(b); }
    const T = (fn, ms) => { const id = setTimeout(() => { if (!ctx.dead) fn(); }, ms); timers.push(id); };
    ctx.stop = () => timers.forEach(clearTimeout);
    const flash = (p, ms) => { cells[p].classList.add("lit"); setTimeout(() => cells[p].classList.remove("lit"), ms); };
    const press = (p) => {
      if (ctx.dead || phase !== "input") return; flash(p, 160);
      if (p !== seq[pos]) { phase = "over"; pads.classList.add("locked"); st.textContent = "Wrong light!"; T(() => { ctx.dead = true; ctx.onDone({ lv: level - 1, s: score }); }, 650); return; }
      if (++pos === seq.length) {
        score += 10 * level; $(el.play, "#m-s").textContent = score; ctx.onScore({ s: score, lv: level }); phase = "pause"; pads.classList.add("locked");
        if (level >= A.MEMORY.MAX_LEVEL) { st.textContent = "Perfect run!"; T(() => { ctx.dead = true; ctx.onDone({ lv: level, s: score }); }, 700); return; }
        st.textContent = "Nice!"; T(nextLevel, 800);
      }
    };
    for (const b of cells) b.addEventListener("pointerdown", (e) => { e.preventDefault(); press(+b.dataset.p); });
    ctx.keys = (e) => { if (e.key in PKEY) { press(PKEY[e.key]); return true; } return false; };
    function nextLevel() {
      level++; pos = 0; seq = A.memorySequence(ctx.seed, A.memoryLen(level)); phase = "show"; pads.classList.add("locked"); $(el.play, "#m-l").textContent = level; st.textContent = "Watch…";
      const tm = A.memoryTiming(level); let at = 500;
      for (const p of seq) { T(() => flash(p, tm.on), at); at += tm.on + tm.off; }
      T(() => { phase = "input"; pads.classList.remove("locked"); st.textContent = "Your turn — click the lights, or press 1 2 3 4"; }, at);
    }
    ctx.start = () => { ctx.waiting = false; delete stage.dataset.waiting; const cnt = countdownEl(stage); const iv = setInterval(() => { if (ctx.dead) { clearInterval(iv); return; } const t = performance.now() - ctx.startPerf; if (t >= 0) { clearInterval(iv); cnt.remove(); nextLevel(); } else cnt.innerHTML = `${Math.max(1, Math.ceil(-t / 1000))}<small>${ctx.solo ? "" : "your turn!"}</small>`; }, 50); const prev = ctx.stop; ctx.stop = () => { prev(); clearInterval(iv); }; if (!ctx.solo) sendLive({ p: 1 }); };
    if (opts.watch) { st.textContent = ''; ctx.waiting = true; return; }
    ctx.start();
  }

  /* ---------- How Fast? ---------- */
  function runReaction(ctx) {
    const tl = A.reactionTimeline(ctx.seed), R = A.REACT, times = [], flags = [], note = [], goShown = []; let curShown = -1;
    el.play.innerHTML = `<div class="hud"><span>Round <span id="r-r">1</span> / ${R.ROUNDS}</span><span id="r-a">avg —</span></div><div class="stage"><div class="rx" tabindex="0" role="button" aria-label="reaction pad"><span id="r-t">Get ready</span><small id="r-s"></small></div><div class="dots"></div></div><div class="status" id="r-st">Press Space, Enter, click or tap the pad the moment it says GO.</div>`;
    const stage = $(el.play, ".stage"), pad = $(el.play, ".rx"), tt = $(el.play, "#r-t"), ss = $(el.play, "#r-s"), dots = $(el.play, ".dots"), cnt = countdownEl(stage);
    for (let i = 0; i < R.ROUNDS; i++) dots.appendChild(document.createElement("i"));
    const roundAt = (t) => { for (let i = 0; i < tl.length; i++) if (t >= tl[i].start && t < tl[i].end) return i; return -1; };
    const record = (r, ms, flag, why) => {
      if (times[r] !== undefined) return; times[r] = Math.round(ms); flags[r] = flag ? 1 : 0; note[r] = why; dots.children[r].className = flag ? "bad" : "on";
      const done = times.filter((x) => x !== undefined).length, sum = times.reduce((a, b) => a + (b || 0), 0);
      $(el.play, "#r-a").textContent = `avg ${Math.round(sum / done)} ms`; ctx.onScore({ s: Math.round(sum / done), r: done, avg: sum / done });
    };
    const press = (e) => {
      if (ctx.dead) return; const now = e && e.timeStamp > 0 ? e.timeStamp : performance.now(), t = now - ctx.startPerf; if (t < 0) return;
      const r = roundAt(t); if (r < 0 || times[r] !== undefined) return;
      if (t < tl[r].go || goShown[r] === undefined) { record(r, R.PENALTY_MS, true, "false"); return; }                      // pressed before GO (or before GO was even on screen)
      const ms = now - goShown[r]; if (ms < R.TOO_FAST_MS) { record(r, R.PENALTY_MS, true, "false"); return; }                // faster than a human can react = a guess
      record(r, Math.min(ms, R.PENALTY_MS), false, "ok");
    };
    pad.addEventListener("pointerdown", (e) => { e.preventDefault(); press(e); });
    ctx.keys = (e) => { if ((e.key === " " || e.key === "Enter" || e.key === "e" || e.key === "E") && !e.repeat) { press(e); return true; } return false; };
    const frame = () => {
      if (ctx.dead) return; const t = performance.now() - ctx.startPerf;
      if (t < 0) { cnt.hidden = false; cnt.innerHTML = `${Math.max(1, Math.ceil(-t / 1000))}<small>${ctx.solo ? "" : "same GO signal for both of you"}</small>`; requestAnimationFrame(frame); return; }
      cnt.hidden = true;
      let r = 0; for (let i = 0; i < tl.length; i++) if (t >= tl[i].start) r = i;                       // the round we are in (wait, GO window or result flash)
      for (let k = 0; k < r; k++) if (times[k] === undefined) record(k, R.PENALTY_MS, true, "miss");   // a round that ended with no press
      if (times[r] === undefined && t >= tl[r].end) record(r, R.PENALTY_MS, true, "miss");
      if (times[r] === undefined) {
        if (t < tl[r].go) { pad.className = "rx"; tt.textContent = "Wait…"; ss.textContent = ""; }
        else if (curShown !== r) { curShown = r; pad.className = "rx go"; tt.textContent = "GO!"; ss.textContent = "press now"; requestAnimationFrame(() => { if (goShown[r] === undefined) goShown[r] = performance.now(); }); }
      } else {
        const why = note[r]; pad.className = "rx " + (flags[r] ? "late" : "show");
        tt.textContent = why === "false" ? "Too early!" : why === "miss" ? "Missed" : `${times[r]} ms`; ss.textContent = flags[r] ? `+${R.PENALTY_MS} ms penalty` : "";
      }
      $(el.play, "#r-r").textContent = r + 1;
      if (t >= tl[R.ROUNDS - 1].end + R.SHOW_MS) { for (let k = 0; k < R.ROUNDS; k++) if (times[k] === undefined) record(k, R.PENALTY_MS, true, "miss"); ctx.dead = true; ctx.onDone({ t: times.slice(), f: flags.slice() }); return; }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  /* ======================================================================
     SOLO
     ====================================================================== */
  function startSolo(game) {
    build(); match = null; invite = null; hideInvite();
    const seed = A.newSeed(); lastGame = game; begin(game, seed, performance.now() + 1800, {});
  }
  let lastGame = null;

  /* ======================================================================
     EVENTS FROM THE RUNNERS
     ====================================================================== */
  function scored(sc) {
    if (!match || match.solo) return;
    match.live.me = Object.assign({}, match.live.me, sc); renderBoard(); sendLive(sc);
  }
  function sendLive(sc) { if (match && !match.solo) send("sc", sc.p ? { s: (match.live.me && match.live.me.s) || 0, p: 1 } : sc.avg != null ? { s: sc.s, r: sc.r, avg: sc.avg } : { s: sc.s }); }

  function finished(res) {
    const game = run ? run.game : lastGame, seed = run ? run.seed : (match ? match.seed : 0); closeRun();
    const norm = A.validateResult(game, res, seed);
    if (!match || match.solo) { showSoloResult(game, res, norm); return; }
    match.myRes = norm; match.sentRes = true; if (norm) recordHS(game, norm);
    if (match.phase === "void") { renderVoid(); return; }
    send("rs", game === "whack" ? { h: res.h } : game === "memory" ? { lv: res.lv, s: res.s } : { tm: res.t, fl: res.f });
    if (norm) match.live.me = Object.assign({}, match.live.me, { s: norm.score }, game === "reaction" ? { avg: norm.avg, r: A.REACT.ROUNDS } : {});
    maybeConclude();
  }

  /* ======================================================================
     RESULTS
     ====================================================================== */
  function resLines(game, n) {
    if (!n) return ["—", ""];
    if (game === "whack") return [`${n.h} hit${n.h === 1 ? "" : "s"}`, ""];
    if (game === "memory") return [`Level ${n.lv}`, `${n.score} points`];
    return [`${Math.round(n.avg)} ms avg`, `best ${n.best < A.REACT.PENALTY_MS ? n.best + " ms" : "—"} · ${n.f.filter(Boolean).length} penalt${n.f.filter(Boolean).length === 1 ? "y" : "ies"}`];
  }
  function showSoloResult(game, res, norm) {
    build(); show("res"); el.board.hidden = true; el.wait.hidden = true; el.title.textContent = A.NAMES[game]; el.sub.textContent = "Results";
    const rec = norm ? recordHS(game, norm) : false, [big, det] = resLines(game, norm);
    el.res.textContent = "";
    const b = document.createElement("div"); b.className = "banner draw"; b.textContent = rec ? "NEW BEST!" : "ROUND OVER"; if (rec) b.classList.add("win");
    const vs = document.createElement("div"); vs.className = "vs one"; vs.appendChild(playerCard(true, null, big, det));
    const hs = document.createElement("div"); hs.className = "note"; hs.style.textAlign = "center"; hs.textContent = hsLine(game);
    const act = actions([["Play Again", () => startSolo(game), "pri", "again"], ["Games menu", () => showMenu(), "", "menu"], ["Return to Gaming Room", () => close(), "", "leave"]]);
    el.res.append(b, vs, hs, act); const f = $(act, "button"); f.focus({ preventScroll: true });
  }
  function playerCard(isMe, tag, big, det) {
    const who = isMe ? me() : peerOf() || { name: "Partner", g: "male" };
    const c = document.createElement("div"); c.className = "pc" + (tag ? " winner" : "");
    if (tag) { const t = document.createElement("div"); t.className = "tag"; t.textContent = tag; c.appendChild(t); }
    const nm = document.createElement("div"); nm.className = "nm"; nm.textContent = who.name + (isMe ? " (you)" : "");
    const wh = document.createElement("div"); wh.className = "who"; wh.textContent = who.g === "female" ? "Farmer · she/her" : "Farmer · he/him";
    const bg = document.createElement("div"); bg.className = "big"; bg.textContent = big; const dt = document.createElement("div"); dt.className = "det"; dt.textContent = det;
    c.append(avatar(isMe), nm, wh, bg, dt); return c;
  }
  function actions(list) {
    const d = document.createElement("div"); d.className = "actions";
    for (const [label, fn, cls, id] of list) { const b = document.createElement("button"); b.textContent = label; if (cls) b.className = cls; b.dataset.act = id; b.addEventListener("click", fn); d.appendChild(b); }
    const i = document.createElement("div"); i.className = "info"; d.appendChild(i); return d;
  }

  // both results in (or the partner is gone) -> the winner screen
  function maybeConclude() {
    if (!match || match.solo || match.phase === "closed" || match.phase === "void") return;                  // a voided match never turns into a verdict (e.g. a later, genuine result from a peer whose first one was rejected)
    if (match.myRes && match.peerRes) {
      match.phase = "done"; match.verdict = A.judge(match.game, match.myRes, match.peerRes);               // "a" me, "b" peer, "draw"
      renderVerdict(); return;
    }
    if (match.myRes && !match.peerRes) renderWaitingResult();
  }
  function renderWaitingResult() {
    show("res"); el.res.textContent = ""; const [big, det] = resLines(match.game, match.myRes);
    const b = document.createElement("div"); b.className = "banner draw"; b.textContent = "FINISHED!";
    const vs = document.createElement("div"); vs.className = "vs one"; vs.appendChild(playerCard(true, null, big, det));
    const wt = document.createElement("div"); wt.className = "note"; wt.id = "arc-waiting"; wt.style.textAlign = "center"; wt.textContent = `Waiting for ${match.peer.name} to finish…`;
    el.res.append(b, vs, wt); renderBoard();
  }
  function renderVerdict() {
    show("res"); el.board.hidden = true; el.wait.hidden = true; el.title.textContent = A.NAMES[match.game]; el.sub.textContent = "Final result"; el.res.textContent = "";
    const v = match.verdict, mine = v === "a", theirs = v === "b";
    const b = document.createElement("div"); b.className = "banner " + (v === "draw" ? "draw" : mine ? "win" : "lose"); b.id = "arc-banner"; b.textContent = v === "draw" ? "DRAW!" : mine ? "YOU WIN!" : "YOU LOSE!";
    const sub = document.createElement("div"); sub.className = "note"; sub.style.textAlign = "center"; sub.id = "arc-winner";
    sub.textContent = v === "draw" ? "Evenly matched — nobody wins this one." : `Winner: ${mine ? match.me.name : match.peer.name}`;
    const vs = document.createElement("div"); vs.className = "vs";
    const [mb, md] = resLines(match.game, match.myRes), [pb, pd] = resLines(match.game, match.peerRes);
    const cards = [[true, mb, md, mine], [false, pb, pd, theirs]];
    if (match.p1 !== match.me.id) cards.reverse();                                                       // Player 1 on the left
    for (const [isMe, big, det, won] of cards) vs.appendChild(playerCard(isMe, won ? "WINNER!" : null, big, det));
    const act = actions([["Play Again", () => rematchPress(), "pri", "again"], ["Return to Gaming Room", () => close(), "", "leave"]]);
    el.res.append(b, sub, vs, act); updateRematchUI(); const f = $(act, "button"); f.focus({ preventScroll: true });
  }
  function updateRematchUI() {
    if (!match || !el) return; const act = $(el.res, ".actions"); if (!act) return; const again = $(act, "[data-act=again]"), info = $(act, ".info");
    if (!again) return;                                           // e.g. the NO CONTEST screen has no rematch button
    if (match.phase === "void" || match.peerLeft || match.away) { again.disabled = true; info.textContent = match.peerLeft ? `${match.peer.name} left the machine.` : `${match.peer.name} is disconnected.`; return; }
    again.disabled = !!match.rm.me;
    info.textContent = match.rm.me && match.rm.peer ? "Starting…" : match.rm.me ? `Waiting for ${match.peer.name} to agree to a rematch…` : match.rm.peer ? `${match.peer.name} wants a rematch!` : "";
  }

  /* ======================================================================
     MATCH PROTOCOL
     ====================================================================== */
  function freshMatch(base, n, game, p1, host) {
    const m = me(), p = peerOf();
    return { base, n, m: `${base}_${n}`, game, solo: false, host, p1, me: m, peer: p, phase: "wait", seed: 0, first: p1, startPerf: 0, live: { me: null, peer: null }, myRes: null, peerRes: null, peerGot: false, sentRes: false, verdict: null, rm: { me: false, peer: false }, away: false, awayAt: 0, peerLeft: false, voidWhy: "", made: Date.now() };
  }
  const baseOf = (s) => { const i = s.lastIndexOf("_"); return i < 0 ? [s, 0] : [s.slice(0, i), +s.slice(i + 1) || 0]; };

  function challenge(game) {
    if (!partnerHere() || live()) { showMenu("Your partner isn't available right now."); return; }
    lastGame = game; match = freshMatch(newBase(), 0, game, me().id, true); invite = null;
    send("ch", { g: game }); waitDialog(`Waiting for ${match.peer.name} to accept ${A.NAMES[game]}…`, "Cancel", () => { send("bye"); match.phase = "closed"; match = null; showMenu(); });
    match.waitUntil = Date.now() + cfg.acceptMs;
  }
  function waitDialog(text, btn, fn) {
    build(); el.wait.hidden = false; el.wait.textContent = ""; const p = document.createElement("div"); p.textContent = text; p.id = "arc-waittext"; const b = document.createElement("button"); b.textContent = btn; b.addEventListener("click", fn); el.wait.append(p, b);
  }
  function showInvite(g, from) {
    build(); const sp = $(el.inv, "span"); sp.textContent = `${from} challenges you to ${A.NAMES[g]}! (Y / N)`; el.inv.hidden = false; invite.until = Date.now() + cfg.inviteMs;
  }
  const hideInvite = () => { if (el) el.inv.hidden = true; };
  function answerInvite(yes) {
    const iv = invite; if (!iv) { hideInvite(); return; }
    invite = null; hideInvite();
    if (!yes) { if (cin.link && cin.link.open) cin.link.send("arc", { a: "dc", m: iv.m, why: "declined" }); return; }
    if (!partnerHere() || run || (match && live())) { if (cin.link && cin.link.open) cin.link.send("arc", { a: "dc", m: iv.m, why: "busy" }); return; }
    const [base, n] = baseOf(iv.m); match = freshMatch(base, n, iv.g, iv.from, false); match.phase = "accepted"; lastGame = iv.g;
    openOverlay(); el.title.textContent = A.NAMES[iv.g]; el.sub.textContent = ""; show("menu"); el.menu.textContent = "";
    send("ac"); waitDialog(`Getting ${A.NAMES[iv.g]} ready…`, "Cancel", () => { send("bye"); match.phase = "closed"; match = null; showMenu(); });
    match.waitUntil = Date.now() + cfg.acceptMs;
  }

  function onArc(m0) {
    const v = A.validateMsg(m0); if (!v) return; const L = cin.link, pe = peerOf(); if (!pe || (m0.f && m0.f !== pe.id)) return;
    if (match && match.away && v.m.startsWith(match.base)) { match.away = false; renderBoard(); updateRematchUI(); }
    switch (v.a) {
      case "ch": {
        if (cin.where(gm()) !== "gaming" || run || (match && live()) || invite) { L.send("arc", { a: "dc", m: v.m, why: "busy" }); return; }
        invite = { m: v.m, g: v.g, from: pe.id }; showInvite(v.g, pe.name); return;
      }
      case "ac": {
        if (!match || !match.host || match.m !== v.m || match.phase !== "wait") return;
        startVs(match.game, A.newSeed(), match.p1); return;
      }
      case "dc": {
        if (!match || match.m !== v.m || match.phase !== "wait") return;
        const why = v.why === "busy" ? `${pe.name} is busy right now.` : `${pe.name} declined.`; match.phase = "closed"; match = null; showMenu(why); return;
      }
      case "go": {
        if (!match || match.host || match.phase === "closed") return;
        const [base, n] = baseOf(v.m); if (base !== match.base) return;
        if (match.phase === "accepted") { if (v.m !== match.m) return; }
        else if (match.phase === "done" || match.phase === "void") { if (n !== match.n + 1 || !match.rm.me || !match.rm.peer || match.phase === "void") return; match = rematchReset(match, n); }
        else return;
        if (v.first !== match.me.id && v.first !== match.peer.id) return;
        beginVs(v.g, v.seed, v.first, startPerfFrom(v.at)); return;
      }
      case "sc": {
        if (!match || match.m !== v.m || match.solo || match.phase === "closed" || !match.seed) return;
        const prev = match.live.peer;
        if (match.game === "whack" && prev && v.s < prev.s) return;                                                    // scores never go down
        if (match.game === "whack" && v.s > A.whackSchedule(match.seed).length) return;
        if (match.game === "memory" && (v.s > A.memoryScore(A.MEMORY.MAX_LEVEL) || (prev && v.s < prev.s))) return;
        if (match.game === "reaction" && (prev && v.r !== undefined && prev.r !== undefined && v.r < prev.r)) return;
        match.live.peer = Object.assign({}, prev, { s: v.s }, v.r !== undefined ? { r: v.r } : {}, v.avg !== undefined ? { avg: v.avg } : {}); renderBoard(); return;
      }
      case "rs": {
        if (!match || match.m !== v.m || match.solo || match.peerGot || match.phase === "closed") return;               // one submission per round, ever
        const norm = A.validateResult(match.game, v.r, match.seed);
        if (!norm) { voidMatch(`${pe.name}'s result didn't look valid, so this match doesn't count.`); return; }
        match.peerGot = true; match.peerRes = norm; match.live.peer = Object.assign({}, match.live.peer, { s: norm.score, avg: norm.avg }); renderBoard();
        if (match.game === "memory" && match.first === match.peer.id && !match.sentRes) startMyMemoryTurn();
        maybeConclude(); return;
      }
      case "rm": {
        if (!match || match.m !== v.m || match.solo) return; match.rm.peer = true; updateRematchUI(); tryRematch(); return;
      }
      case "bye": {
        if (invite && invite.m === v.m) { invite = null; hideInvite(); }
        if (!match || match.m !== v.m) return;
        if (match.phase === "wait" || match.phase === "accepted") { match.phase = "closed"; match = null; if (open) showMenu(`${pe.name} cancelled.`); return; }
        match.peerLeft = true; if (match.phase !== "done") voidMatch(`${pe.name} left the machine, so this match doesn't count.`); else updateRematchUI(); return;
      }
      case "st": return;
    }
  }

  // the challenger decides seed + start; both run the same countdown
  function startVs(game, seed, first) {
    const at = Date.now() + A.COUNTDOWN_MS;
    send("go", { g: game, seed, at, first, n: match.n });
    beginVs(game, seed, first, performance.now() + A.COUNTDOWN_MS);
  }
  function startPerfFrom(atPeerWall) {                       // challenger's wall-clock start -> my performance.now(), via the link's clock offset
    const L = cin.link; let ms = A.COUNTDOWN_MS - 60;
    if (L && L.rtt != null && typeof L.offset === "number") ms = atPeerWall - L.offset - Date.now(); else if (L && L.rtt != null) ms = A.COUNTDOWN_MS - L.rtt / 2;
    ms = Math.min(A.COUNTDOWN_MS + 1500, Math.max(900, ms)); return performance.now() + ms;
  }
  function beginVs(game, seed, first, startPerf) {
    match.game = game; match.seed = seed; match.first = first; match.phase = "play"; match.live = { me: null, peer: null }; match.myRes = match.peerRes = null; match.peerGot = match.sentRes = false; match.verdict = null; match.rm = { me: false, peer: false };
    openOverlay(); el.wait.hidden = true; lastGame = game;
    if (game === "memory" && first !== match.me.id) { begin(game, seed, 0, { watch: true }); setWatchText(); return; }
    begin(game, seed, startPerf, {});
  }
  function setWatchText() { const st = el && $(el.play, "#m-st"); if (st && run && run.waiting) st.textContent = `${match.peer.name} is playing — your turn is next.`; }
  function startMyMemoryTurn() { if (!run || !run.waiting || run.dead) return; run.startPerf = performance.now() + A.COUNTDOWN_MS; run.start(); }
  function rematchReset(m, n) { return Object.assign(m, { n, m: `${m.base}_${n}`, phase: "accepted" }); }

  function rematchPress() {
    if (!match || match.solo) return; match.rm.me = true; send("rm"); updateRematchUI(); tryRematch();
  }
  function tryRematch() {
    if (!match || !match.rm.me || !match.rm.peer || match.phase !== "done") return;
    if (!match.host) return;                                         // the challenger starts it; the other side follows the "go"
    const n = match.n + 1, first = match.first === match.me.id ? match.peer.id : match.me.id;           // alternate who goes first (matters for Memory Lights)
    match.n = n; match.m = `${match.base}_${n}`;
    startVs(match.game, A.newSeed(), first);
  }

  function voidMatch(why) {
    if (!match || match.solo) return; if (match.phase === "done") { updateRematchUI(); return; }
    match.phase = "void"; match.voidWhy = why;
    if (run && !run.dead) { const s = el && $(el.play, ".status"); if (s) s.textContent = why + " You can finish this round for fun."; renderBoard(); return; }
    renderVoid();
  }
  function renderVoid() {
    show("res"); el.board.hidden = true; el.wait.hidden = true; el.res.textContent = "";
    const b = document.createElement("div"); b.className = "banner draw"; b.textContent = "NO CONTEST"; const [big, det] = resLines(match.game, match.myRes);
    const vs = document.createElement("div"); vs.className = "vs one"; vs.appendChild(playerCard(true, null, match.myRes ? big : "—", det));
    const n = document.createElement("div"); n.className = "note"; n.style.textAlign = "center"; n.id = "arc-void"; n.textContent = match.voidWhy;
    el.res.append(b, vs, n, actions([["Games menu", () => { match = null; showMenu(); }, "pri", "menu"], ["Return to Gaming Room", () => close(), "", "leave"]]));
  }

  /* ======================================================================
     OPEN / CLOSE / INPUT
     ====================================================================== */
  function openOverlay() {
    build(); if (open) return; open = true; el.root.hidden = false; document.body.classList.add("arc-open");
    const g = gm(); if (g && g.input) { g.input.down.clear(); g.input.pressed.clear(); }
  }
  function openMachine() {
    if (!cin.ui) cin.ensure(gm()); build(); openOverlay(); if (!match) showMenu(); else if (match.phase === "wait") { /* keep dialog */ }
  }
  function close() {
    if (match && !match.solo && match.phase !== "closed") { send("bye"); match.phase = "closed"; }
    closeRun(); match = null; invite = null; open = false; if (el) { el.root.hidden = true; hideInvite(); } document.body.classList.remove("arc-open");
  }
  let exitArm = 0;
  function exitPress() {
    const playing = run && !run.dead, vs = match && !match.solo && live();
    if ((playing && vs) && Date.now() - exitArm > 3000) { exitArm = Date.now(); const x = $(el.root, "#arc-x"); x.textContent = "Really leave?"; setTimeout(() => { if (x) x.textContent = "✕ Exit"; }, 3000); return; }
    const x = $(el.root, "#arc-x"); x.textContent = "✕ Exit"; close();
  }
  function onKey(e) {
    if (!open && !(invite && el && !el.inv.hidden)) return;
    const t = e.target; if (typing(t)) return;
    if (!open) {                                                // an invitation is showing and the machine is closed
      if (e.key === "y" || e.key === "Y") { e.preventDefault(); e.stopImmediatePropagation(); answerInvite(true); }
      else if (e.key === "n" || e.key === "N") { e.preventDefault(); e.stopImmediatePropagation(); answerInvite(false); }
      return;
    }
    e.stopImmediatePropagation();                               // the machine owns the keyboard: no walking, no hotbar, no emotes
    if (e.key === "Escape") { e.preventDefault(); exitPress(); return; }
    if (invite && (e.key === "y" || e.key === "Y")) { e.preventDefault(); answerInvite(true); return; }
    if (invite && (e.key === "n" || e.key === "N")) { e.preventDefault(); answerInvite(false); return; }
    if (run && !run.dead && run.keys && run.keys(e)) { e.preventDefault(); return; }
    if ((e.key === "Enter" || e.key === " ") && t && t.tagName === "BUTTON") return;      // let a focused button be pressed
    if (e.key.startsWith("Arrow") || e.key === " ") e.preventDefault();
  }

  /* ======================================================================
     HOUSEKEEPING TICK: invite / accept time-outs, partner gone, room changes
     ====================================================================== */
  function houseTick() {
    const now = Date.now();
    if (invite && now > invite.until) { invite = null; hideInvite(); }
    if (!match || match.solo || match.phase === "closed") return;
    if ((match.phase === "wait" || match.phase === "accepted") && match.waitUntil && now > match.waitUntil) {
      const nm = match.peer.name; match.phase = "closed"; match = null; if (open) showMenu(`${nm} didn't answer.`); return;
    }
    if (!live()) return;
    const L = cin.link, here = online() && cin.remote && cin.remote.where === "gaming";
    if (match.phase === "play" || (match.phase === "done")) {
      if (L && L.open && cin.remote && cin.remote.where !== "gaming" && cin.remote.where !== undefined && match.phase === "play") { voidMatch(`${match.peer.name} left the Gaming Room, so this match doesn't count.`); return; }
      if (!L || !L.open) { if (!match.away) { match.away = true; match.awayAt = now; renderBoard(); updateRematchUI(); } }
      else if (match.away && L.open) { match.away = false; renderBoard(); updateRematchUI(); }
      if (match.away && now - match.awayAt > cfg.awayMs) voidMatch(`${match.peer.name} disconnected, so this match doesn't count.`);
    }
    void here;
  }

  /* ======================================================================
     HOOKS (wraps only)
     ====================================================================== */
  function hookLink() {
    const L = cin.link; if (!L || L._arcHooked) return; L._arcHooked = true;
    L.on("arc", onArc);
    L.on("down", () => { if (match && !match.solo && match.phase !== "closed" && match.phase !== "done") { match.away = true; match.awayAt = Date.now(); if (open) { renderBoard(); updateRematchUI(); } } if (invite) { invite = null; hideInvite(); } });
    L.on("restored", () => {                                    // the partner is back: tell them where I am so their scoreboard catches up
      if (!match || match.solo) return; match.away = false; renderBoard();
      const me_ = match.live.me; if (me_) send("sc", match.game === "reaction" ? { s: me_.s || 0, r: me_.r || 0, avg: me_.avg || 0 } : { s: me_.s || 0 });
      if (match.sentRes && match.myRes) send("rs", match.game === "whack" ? { h: match.myRes.h } : match.game === "memory" ? { lv: match.myRes.lv, s: match.myRes.score } : { tm: match.myRes.t, fl: match.myRes.f });
    });
  }
  const Gm = Game.prototype, upd = Gm.update;
  Gm.update = function (dt) {
    hookLink();
    if (!keyHooked) { keyHooked = true; window.addEventListener("keydown", onKey, true); tick = setInterval(houseTick, 500); }
    if (open) { this.input.down.clear(); this.input.pressed.clear(); }
    return upd.call(this, dt);
  };
  const pd = Gm.passDoor; Gm.passDoor = function (dir) { if (open || match || invite) close(); return pd.call(this, dir); };           // any room change: leave the machine cleanly
  const um = Object.getOwnPropertyDescriptor(CinemaUI.UI.prototype, "modal");                                                            // emotes / interaction treat the machine like a panel
  Object.defineProperty(CinemaUI.UI.prototype, "modal", { get() { return (um.get.call(this)) || open; }, configurable: true });

  return {
    open: openMachine, close, get isOpen() { return open; },
    cfg, _state: () => ({ open, match, invite, run: run ? { game: run.game, seed: run.seed, startPerf: run.startPerf, dead: run.dead, waiting: !!run.waiting } : null }),
    _hs: { load: loadHS, save: saveHS },
  };
})();
