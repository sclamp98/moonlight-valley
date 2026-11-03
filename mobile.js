"use strict";
/* Moonlight Valley — touch controls for phones / tablets.
   It adds NO new game rules: every button just produces the same keyboard events the game already listens to
   (WASD, E, Space, I, M, T, C, Q, Esc, K/U/H/J/G), so movement, collisions, emotes, panels and co-op behave exactly as on desktop.
   Only runs when index.html decided this is a touch device (window.MV_MOBILE); on desktop this file does nothing. */
(() => {
  if (!window.MV_MOBILE) return;
  const root = document.documentElement;
  root.classList.add("mv-touch");

  /* ---- sharper but cheaper canvas on high-DPI phones: cap the pixel ratio at 2 (a 3x phone would draw 2.25x the pixels for no visible gain) ---- */
  if (typeof Game !== "undefined" && Game.prototype.resize) {
    Game.prototype.resize = function () {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.floor(window.innerWidth * dpr);
      this.canvas.height = Math.floor(window.innerHeight * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.camera.resize(window.innerWidth, window.innerHeight);
    };
  }

  /* ---- hold the page still: no pinch zoom, no double-tap zoom, no long-press menu on the game ---- */
  for (const ev of ["gesturestart", "gesturechange", "gestureend"]) document.addEventListener(ev, (e) => e.preventDefault());
  document.addEventListener("contextmenu", (e) => { if (e.target.closest && e.target.closest("#game, #mv-touch, #hud")) e.preventDefault(); });
  document.addEventListener("dblclick", (e) => { if (!(e.target.closest && e.target.closest("input, textarea"))) e.preventDefault(); });

  /* ---- key plumbing: real keyboard events on window, which is what game.js / emotes.js / map.js already read ---- */
  const fire = (type, key) => window.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true }));
  const tapKey = (key) => { fire("keydown", key); setTimeout(() => fire("keyup", key), 70); };

  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const wrap = el("div"); wrap.id = "mv-touch";
  wrap.innerHTML = `
    <div id="mv-joy" aria-label="Move"><div id="mv-knob"></div></div>
    <button id="mv-use" class="mv-btn" type="button" aria-label="Use tool">Use</button>
    <button id="mv-act" class="mv-btn" type="button" aria-label="Interact">✋</button>
    <div id="mv-side">
      <button id="mv-emote" class="mv-btn sm" type="button" aria-label="Emotes">☺</button>
      <button id="mv-more" class="mv-btn sm" type="button" aria-label="More">⋯</button>
    </div>
    <div id="mv-pop-emote" class="mv-wheel" hidden>
      <i class="mv-ring"></i>
      <button data-k="k" style="--x:0;--y:-1"><b>💋</b>Kiss</button><button data-k="u" style="--x:.951;--y:-.309"><b>🤗</b>Hug</button>
      <button data-k="h" style="--x:.588;--y:.809"><b>✋</b>Slap</button><button data-k="j" style="--x:-.588;--y:.809"><b>🧎</b>Kneel</button>
      <button data-k="g" style="--x:-.951;--y:-.309"><b>🤝</b>Grab</button>
      <button class="mv-wx" aria-label="Close emotes">✕</button>
    </div>
    <div id="mv-pop-more" class="mv-pop" hidden>
      <button data-k="m">🗺 Map</button><button data-k="t">🧭 Travel</button><button data-k="c">🍳 Cook</button><button data-k="q">⬇ Drop item</button><button id="mv-snd">🔊 Sound</button><button id="mv-fs">⛶ Full screen</button>
    </div>
    <button id="mv-close" class="mv-btn" type="button" aria-label="Close">✕</button>
    <div id="mv-rotate" hidden>Turn your phone sideways for a wider view</div>`;
  document.body.appendChild(wrap);
  const $ = (s) => wrap.querySelector(s);

  /* pointerdown instead of click: instant response, and preventDefault stops the browser's synthetic mouse event (no double actions) */
  const press = (node, onDown, onUp) => {
    let id = null, last = 0;
    node.addEventListener("pointerdown", (e) => {
      e.preventDefault(); e.stopPropagation();
      if (id !== null) return;                                  // a finger is already on this button
      const now = performance.now(); if (!onUp && now - last < 110) return; last = now;   // debounce taps
      id = e.pointerId; try { node.setPointerCapture(id); } catch (_) {}
      node.classList.add("on"); onDown(e);
    });
    const up = (e) => { if (e.pointerId !== id) return; id = null; node.classList.remove("on"); if (onUp) onUp(e); };
    node.addEventListener("pointerup", up); node.addEventListener("pointercancel", up); node.addEventListener("lostpointercapture", up);
  };

  /* ---- joystick: 8-way, same as WASD (the game's movement is digital) ---- */
  const joy = $("#mv-joy"), knob = $("#mv-knob");
  const held = { w: false, a: false, s: false, d: false };
  const setKey = (k, on) => { if (held[k] === on) return; held[k] = on; fire(on ? "keydown" : "keyup", k); };
  const releaseAll = () => { for (const k in held) setKey(k, false); knob.style.transform = ""; };
  let joyId = null;
  const joyMove = (e) => {
    const r = joy.getBoundingClientRect(), R = r.width / 2;
    let dx = e.clientX - (r.left + R), dy = e.clientY - (r.top + R);
    const len = Math.hypot(dx, dy), lim = R * 0.62;
    if (len > lim) { dx *= lim / len; dy *= lim / len; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const t = R * 0.2;                                          // dead zone
    setKey("d", dx > t); setKey("a", dx < -t); setKey("s", dy > t); setKey("w", dy < -t);
  };
  joy.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); if (joyId !== null) return; joyId = e.pointerId; try { joy.setPointerCapture(joyId); } catch (_) {} joy.classList.add("on"); joyMove(e); });
  joy.addEventListener("pointermove", (e) => { if (e.pointerId === joyId) { e.preventDefault(); joyMove(e); } });
  const joyUp = (e) => { if (e.pointerId !== joyId) return; joyId = null; joy.classList.remove("on"); releaseAll(); };
  joy.addEventListener("pointerup", joyUp); joy.addEventListener("pointercancel", joyUp); joy.addEventListener("lostpointercapture", joyUp);
  // like a held key: if the game cleared its key set (emote lock, panel), re-assert the held direction on the next frame
  const keepAlive = () => {
    const g = window.game;
    if (g && g.input && joyId !== null) for (const k in held) if (held[k] && !g.input.down.has(k)) fire("keydown", k);
    requestAnimationFrame(keepAlive);
  };
  requestAnimationFrame(keepAlive);
  for (const ev of ["blur", "pagehide"]) window.addEventListener(ev, () => { joyId = null; releaseAll(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) { joyId = null; releaseAll(); } });

  /* ---- buttons ---- */
  press($("#mv-act"), () => tapKey("e"));
  press($("#mv-use"), () => fire("keydown", " "), () => fire("keyup", " "));        // hold = keep using, like holding Space
  press($("#mv-close"), () => tapKey("Escape"));
  const hintEl = document.getElementById("hint");
  if (hintEl) hintEl.addEventListener("pointerdown", (e) => { e.preventDefault(); tapKey("e"); });   // tap the prompt itself
  const dlg = document.getElementById("dialog");
  if (dlg) dlg.addEventListener("pointerdown", (e) => { e.preventDefault(); tapKey("e"); });          // tap dialogue to continue
  const ov = document.getElementById("overlay");
  if (ov) ov.addEventListener("pointerdown", (e) => { if (e.target === ov) { e.preventDefault(); tapKey("Escape"); } });   // tap outside a panel to close

  const pops = { emote: $("#mv-pop-emote"), more: $("#mv-pop-more") };
  const closePops = () => { pops.emote.hidden = pops.more.hidden = true; };
  press($("#mv-emote"), () => { const h = pops.emote.hidden; closePops(); pops.emote.hidden = !h; });
  press($("#mv-more"), () => { const h = pops.more.hidden; closePops(); pops.more.hidden = !h; });
  for (const p of Object.values(pops)) p.addEventListener("pointerdown", (e) => {
    e.preventDefault(); e.stopPropagation();
    const b = e.target.closest("button"); if (!b) return;
    if (b.id === "mv-fs") { toggleFullscreen(); } else if (b.id === "mv-snd") { try { MVAudio.togglePanel(); } catch (_) {} } else if (b.dataset.k) tapKey(b.dataset.k);
    closePops();
  });
  document.addEventListener("pointerdown", (e) => { if (!e.target.closest("#mv-pop-emote, #mv-pop-more, #mv-emote, #mv-more")) closePops(); }, true);

  /* full screen where the browser allows it (Android Chrome yes; iPhone Safari does not support it for pages, so the button is hidden there) */
  const fsEl = root, canFs = !!(fsEl.requestFullscreen || fsEl.webkitRequestFullscreen);
  if (!canFs) $("#mv-fs").remove();
  function toggleFullscreen() {
    try {
      if (document.fullscreenElement || document.webkitFullscreenElement) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
      const p = (fsEl.requestFullscreen || fsEl.webkitRequestFullscreen).call(fsEl);
      Promise.resolve(p).then(() => { try { screen.orientation && screen.orientation.lock && screen.orientation.lock("landscape").catch(() => {}); } catch (_) {} }).catch(() => {});
    } catch (_) {}
  }

  /* ---- wording: the game says "Press E — …"; on a phone it is a tap ---- */
  if (hintEl) {
    const fix = () => { const t = hintEl.textContent; if (/^Press E\b/.test(t)) hintEl.textContent = t.replace(/^Press E\s*[—-]?\s*/, "✋ "); };
    new MutationObserver(fix).observe(hintEl, { childList: true, characterData: true, subtree: true }); fix();
  }

  /* ---- what to show: ~8 checks a second, no per-frame cost ---- */
  const vis = (id) => { const n = document.getElementById(id); return !!n && !n.hidden && getComputedStyle(n).display !== "none"; };
  let nudged = false;
  const portrait = () => window.innerHeight > window.innerWidth;
  function sync() {
    const g = window.game, b = document.body.classList;
    const away = !g || vis("title") || b.contains("arc-open") || b.contains("ngx-open") || vis("coop-panel") || vis("cin-panel") || vis("gameover");
    const panel = !!(g && g.uiMode);
    root.classList.toggle("mv-away", away);
    root.classList.toggle("mv-panel", panel && !away);
    root.classList.toggle("mv-portrait", portrait());
    if (away || panel) { closePops(); if (!away && panel && joyId !== null) { joyId = null; releaseAll(); } }
    const rot = $("#mv-rotate");
    if (!nudged && g && !away && portrait() && Math.min(innerWidth, innerHeight) < 520) {
      nudged = true; let seen = false; try { seen = sessionStorage.getItem("mv_rot") === "1"; sessionStorage.setItem("mv_rot", "1"); } catch (_) {}
      if (!seen) { rot.hidden = false; setTimeout(() => (rot.hidden = true), 6000); }
    }
    if (!portrait()) rot.hidden = true;
  }
  setInterval(sync, 120); sync();
  $("#mv-rotate").addEventListener("pointerdown", (e) => { e.preventDefault(); $("#mv-rotate").hidden = true; });
})();
