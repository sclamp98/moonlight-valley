"use strict";
/* ==========================================================
   Moonlight Valley — arcade cabinet #2: the Neo Geo cabinet (game picker + emulator hand-off).

   What this file is:   the cabinet's screen, a game list, a "load a ROM from your computer" button, readable errors, and a clean way back.
   What it is NOT:      an emulator.  The emulation itself is EmulatorJS (FBNeo core), a separate open-source browser emulator that is loaded
                        on demand INSIDE A SANDBOX IFRAME, so closing the cabinet throws the whole emulator away (EmulatorJS cannot be unloaded
                        any other way) and nothing it does can touch the game, the co-op link or the cinema.
   No ROMs and no BIOS are bundled — you add your own legally obtained files (see roms/neogeo/README.md).

   Configure (optional) before this script runs:  window.NEOGEO_CONFIG = { manifestUrl, dataPath, core, bootTimeoutMs, buildEmulatorHtml }
   ========================================================== */
const NeoGeo = (() => {
  const cfg = Object.assign({
    manifestUrl: "roms/neogeo/games.json",                       // { "bios": "neogeo.zip" (optional), "games": [ { "id", "name", "file", "art"?, "year"?, "maker"? } ] }  (or just the array)
    romDir: "roms/neogeo/",
    dataPath: "https://cdn.emulatorjs.org/stable/data/",         // EmulatorJS data folder; self-host it and point this at it for offline / no-CDN use
    core: "fbneo",
    bootTimeoutMs: 25000,
    maxRomBytes: 96 * 1024 * 1024,
    buildEmulatorHtml: null,                                       // test / advanced seam: (opts) => full html string for the iframe
  }, window.NEOGEO_CONFIG || {});
  const $ = (r, s) => r.querySelector(s);
  const mk = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; };
  const typing = (t) => !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const SAFE_FILE = /^[A-Za-z0-9._()\-]{1,80}\.(zip|7z)$/i;

  let el = null, open = false, keyHooked = false, games = [], bios = null, loaded = false, session = null, urls = [];

  const CSS = `
  body.ngx-open #hint { display: none !important; }
  #ngx { position: fixed; inset: 0; z-index: 30; display: flex; align-items: center; justify-content: center; padding: 10px; background: rgba(20,12,6,.78); font-family: 'Trebuchet MS','Segoe UI',system-ui,sans-serif; color: #fde6b2; -webkit-user-select: none; user-select: none; }
  #ngx[hidden] { display: none; }
  #ngx .card { width: min(860px, 100%); max-height: 100%; display: flex; flex-direction: column; background: rgba(59,38,22,.97); border: 3px solid #a8693a; border-radius: 12px; box-shadow: 0 10px 34px rgba(0,0,0,.55), inset 0 0 0 2px #3b2616; padding: 12px 14px 14px; }
  #ngx header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; } #ngx header b { font-size: 19px; } #ngx header .sub { color: #d9b98a; font-size: 13px; flex: 1; }
  #ngx button, #ngx label.btn { font: inherit; cursor: pointer; color: #fde6b2; background: #6b4326; border: 2px solid #3b2616; border-radius: 7px; padding: 6px 12px; box-shadow: 0 2px 0 #2a1a0e; display: inline-block; }
  #ngx button:hover:not(:disabled), #ngx label.btn:hover { background: #7d5230; } #ngx button.pri { background: #a8693a; color: #2a1a0e; font-weight: bold; } #ngx button:disabled { opacity: .5; cursor: default; }
  #ngx button:focus-visible, #ngx label.btn:focus-within { outline: 2px solid #f4bf57; outline-offset: 2px; }
  #ngx .body { overflow: auto; min-height: 0; }
  #ngx .list { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px; }
  #ngx .game { background: rgba(0,0,0,.22); border: 2px solid #5a3a22; border-radius: 10px; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
  #ngx .game .art { aspect-ratio: 4 / 3; border-radius: 6px; background: #2a1a0e center / cover no-repeat; display: flex; align-items: center; justify-content: center; font-size: 34px; font-weight: bold; color: #a8693a; overflow: hidden; }
  #ngx .game h3 { margin: 0; font-size: 15px; } #ngx .game .meta { font-size: 12px; color: #d9b98a; min-height: 15px; }
  #ngx .empty { padding: 18px 8px; text-align: center; color: #d9b98a; line-height: 1.5; } #ngx .empty b { color: #fde6b2; }
  #ngx .bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 10px; } #ngx .bar input[type=file] { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
  #ngx .msg { margin-top: 10px; min-height: 18px; font-size: 14px; color: #d9b98a; } #ngx .msg.err { color: #f0a090; font-weight: bold; }
  #ngx .biosline { font-size: 12.5px; color: #d9b98a; }
  #ngx .screen { position: relative; width: 100%; aspect-ratio: 4 / 3; max-height: 62vh; margin: 0 auto; background: #120c07; border: 2px solid #3b2616; border-radius: 8px; overflow: hidden; }
  #ngx .screen iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: #000; }
  #ngx .screen .boot { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; text-align: center; padding: 16px; background: #120c07; color: #d9b98a; z-index: 2; }
  #ngx .screen .boot[hidden] { display: none; }
  @media (max-width: 640px) { #ngx .list { grid-template-columns: 1fr 1fr; } #ngx .card { padding: 9px; } }`;

  function build() {
    if (el) return el;
    const st = document.createElement("style"); st.id = "ngx-css"; st.textContent = CSS; document.head.appendChild(st);
    const root = mk(`<div id="ngx" role="dialog" aria-modal="true" aria-label="Neo Geo cabinet" hidden>
      <div class="card"><header><b>Neo Geo Arcade</b><span class="sub" id="ngx-sub">Pick a game</span><button id="ngx-x" title="Back to the Gaming Room (Esc)">✕ Exit</button></header>
        <div class="body" id="ngx-body"></div>
        <div class="msg" id="ngx-msg" role="status"></div></div></div>`);
    const host = (window.Cinema && Cinema.ui && Cinema.ui.stage) || document.body;
    host.appendChild(root);
    el = { root, body: $(root, "#ngx-body"), msg: $(root, "#ngx-msg"), sub: $(root, "#ngx-sub"), x: $(root, "#ngx-x") };
    el.x.addEventListener("click", () => (session ? showList() : close()));
    for (const ev of ["mousedown", "wheel", "keyup"]) root.addEventListener(ev, (e) => e.stopPropagation());
    return el;
  }
  const say = (t, err) => { if (!el) return; el.msg.textContent = t || ""; el.msg.classList.toggle("err", !!err); };

  /* ---------- the game list ---------- */
  async function loadManifest() {
    games = []; bios = null;
    try {
      const r = await fetch(cfg.manifestUrl, { cache: "no-cache" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json(), list = Array.isArray(j) ? j : Array.isArray(j.games) ? j.games : null;
      if (!list) throw new Error("expected a list of games");
      if (!Array.isArray(j) && typeof j.bios === "string" && SAFE_FILE.test(j.bios)) bios = j.bios;
      for (const g of list) {
        if (!g || typeof g.name !== "string" || typeof g.file !== "string" || !SAFE_FILE.test(g.file)) continue;                  // a bad entry is skipped, not fatal
        games.push({ id: String(g.id || g.file), name: g.name.slice(0, 60), file: g.file, art: typeof g.art === "string" && /^[\w./-]{1,100}\.(png|jpe?g|webp|gif)$/i.test(g.art) ? g.art : "", meta: [g.maker, g.year].filter(Boolean).join(" · ").slice(0, 60) });
      }
      loaded = true; return null;
    } catch (e) { loaded = true; return `Couldn't read ${cfg.manifestUrl} (${e.message}). You can still load a ROM from your computer.`; }
  }
  async function showList(note) {
    build(); stopSession(); el.sub.textContent = "Pick a game"; el.x.textContent = "✕ Exit";
    let problem = null; if (!loaded) { say("Loading the game list…"); problem = await loadManifest(); }
    if (!open) return;
    el.body.textContent = "";
    if (!games.length) {
      const d = document.createElement("div"); d.className = "empty";
      d.innerHTML = `<b>No Neo Geo games installed yet.</b><br>Load a ROM you own with the button below, or add files to <code>roms/neogeo/</code> and list them in <code>games.json</code> (see <code>roms/neogeo/README.md</code>).`;
      el.body.appendChild(d);
    } else {
      const list = document.createElement("div"); list.className = "list";
      for (const g of games) {
        const c = document.createElement("div"); c.className = "game"; c.dataset.id = g.id;
        const a = document.createElement("div"); a.className = "art"; if (g.art) a.style.backgroundImage = `url("${cfg.romDir}${g.art}")`; else a.textContent = g.name.slice(0, 1).toUpperCase();
        const h = document.createElement("h3"); h.textContent = g.name; const m = document.createElement("div"); m.className = "meta"; m.textContent = g.meta;
        const b = document.createElement("button"); b.className = "pri"; b.textContent = "Play"; b.addEventListener("click", () => launchInstalled(g));
        c.append(a, h, m, b); list.appendChild(c);
      }
      el.body.appendChild(list);
    }
    const bar = document.createElement("div"); bar.className = "bar";
    const lab = document.createElement("label"); lab.className = "btn"; lab.textContent = "Load a ROM from your computer…";
    const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".zip,.7z"; inp.id = "ngx-file"; inp.addEventListener("change", () => { const f = inp.files && inp.files[0]; inp.value = ""; if (f) launchLocal(f); }); lab.appendChild(inp);
    const lab2 = document.createElement("label"); lab2.className = "btn"; lab2.textContent = "Load BIOS (neogeo.zip)…";
    const inp2 = document.createElement("input"); inp2.type = "file"; inp2.accept = ".zip"; inp2.id = "ngx-bios"; inp2.addEventListener("change", () => { const f = inp2.files && inp2.files[0]; inp2.value = ""; if (f) setLocalBios(f); }); lab2.appendChild(inp2);
    const bl = document.createElement("span"); bl.className = "biosline"; bl.id = "ngx-bios-line"; bl.textContent = biosText();
    bar.append(lab, lab2, bl); el.body.appendChild(bar);
    say(note || problem || "", !!(note || problem) && /couldn|unsupported|too|empty|didn't|failed/i.test(note || problem || ""));
    const first = $(el.body, "button") || $(el.body, "input"); if (first && first.focus) first.focus({ preventScroll: true });
  }
  let localBios = null;
  const biosText = () => (localBios ? `BIOS: ${localBios.name} (from your computer)` : bios ? `BIOS: ${bios}` : "BIOS: none set (most Neo Geo games need neogeo.zip)");
  function setLocalBios(f) {
    if (!/\.zip$/i.test(f.name)) { say("The BIOS must be a .zip file (neogeo.zip).", true); return; }
    if (!f.size) { say("That BIOS file is empty.", true); return; }
    if (f.size > cfg.maxRomBytes) { say("That file is too large.", true); return; }
    localBios = { name: f.name.slice(0, 60), url: URL.createObjectURL(f) }; urls.push(localBios.url); const l = $(el.body, "#ngx-bios-line"); if (l) l.textContent = biosText(); say("BIOS loaded for this visit.");
  }

  /* ---------- launching ---------- */
  function launchInstalled(g) { startSession({ name: g.name, url: cfg.romDir + g.file, bios: localBios ? localBios.url : bios ? cfg.romDir + bios : "" }); }
  function launchLocal(f) {
    if (!/\.(zip|7z)$/i.test(f.name)) { say("Unsupported file type — Neo Geo ROMs are .zip files.", true); return; }
    if (!f.size) { say("That file is empty.", true); return; }
    if (f.size > cfg.maxRomBytes) { say("That file is too large to load in the browser.", true); return; }
    const url = URL.createObjectURL(f); urls.push(url);
    startSession({ name: f.name.replace(/\.(zip|7z)$/i, "").slice(0, 60), url, bios: localBios ? localBios.url : bios ? cfg.romDir + bios : "" });
  }
  function emulatorHtml(o) {
    if (typeof cfg.buildEmulatorHtml === "function") return cfg.buildEmulatorHtml(o, cfg);
    const j = (v) => JSON.stringify(String(v)).replace(/</g, "\\u003c");
    return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#000;overflow:hidden}#game{width:100%;height:100%}</style></head><body><div id="game"></div>
<script>
  window.onerror = function (m) { parent.postMessage({ ngx: "error", text: String(m) }, "*"); };
  EJS_player = "#game"; EJS_core = ${j(cfg.core)}; EJS_gameUrl = ${j(o.url)}; EJS_pathtodata = ${j(cfg.dataPath)}; EJS_startOnLoaded = true; EJS_gameName = ${j(o.name)};
  ${o.bios ? `EJS_biosUrl = ${j(o.bios)};` : ""}
  EJS_onGameStart = function () { parent.postMessage({ ngx: "started" }, "*"); };
<\/script>
<script src=${j(cfg.dataPath.replace(/\/?$/, "/") + "loader.js")} onerror="parent.postMessage({ngx:'error',text:'The emulator files could not be loaded (offline, blocked, or the data path is wrong).'},'*')"><\/script></body></html>`;
  }
  async function startSession(o) {
    build(); stopSession(); say("");
    if (o.url && !/^blob:/.test(o.url)) {                                  // an installed ROM: check it is really there before booting an emulator on nothing
      try { const r = await fetch(o.url, { method: "HEAD" }); if (!r.ok) { say(`"${o.name}" isn't installed (the file ${o.url.split("/").pop()} was not found).`, true); return; } }
      catch (e) { say("Couldn't reach that ROM file.", true); return; }
    }
    if (!open) return;
    el.body.textContent = "";
    const scr = document.createElement("div"); scr.className = "screen";
    const boot = document.createElement("div"); boot.className = "boot"; boot.textContent = `Starting ${o.name}…`;
    const fr = document.createElement("iframe"); fr.setAttribute("allow", "gamepad; autoplay; fullscreen"); fr.title = o.name; fr.setAttribute("sandbox", "allow-scripts allow-same-origin allow-pointer-lock");
    scr.append(fr, boot); el.body.appendChild(scr);
    el.sub.textContent = o.name; el.x.textContent = "◀ Games";
    const s = session = { name: o.name, fr, boot, done: false, timer: 0 };
    s.onMsg = (e) => {
      if (e.source !== fr.contentWindow || !e.data || typeof e.data !== "object") return;
      if (e.data.ngx === "started") { s.done = true; boot.hidden = true; clearTimeout(s.timer); fr.focus(); say("Playing. Click the screen to give the game your keyboard."); }
      else if (e.data.ngx === "error" && !s.done) fail(String(e.data.text || "The emulator reported an error.").slice(0, 200));
    };
    window.addEventListener("message", s.onMsg);
    s.timer = setTimeout(() => { if (!s.done) fail(`"${o.name}" didn't start in time. The ROM may be missing its BIOS, an unsupported set, or the emulator files couldn't load.`); }, cfg.bootTimeoutMs);
    fr.srcdoc = emulatorHtml(o);
  }
  function fail(text) { const nm = session && session.name; stopSession(); showList().then(() => say(`Couldn't run ${nm || "that game"}: ${text}`, true)); }
  function stopSession() {
    if (!session) return; const s = session; session = null; clearTimeout(s.timer); window.removeEventListener("message", s.onMsg);
    try { s.fr.srcdoc = ""; s.fr.remove(); } catch (e) { /* gone already */ }
    if (el) { el.sub.textContent = "Pick a game"; el.x.textContent = "✕ Exit"; }
  }

  /* ---------- open / close / keyboard ---------- */
  function openMachine() {
    build(); if (open) return; open = true; el.root.hidden = false; document.body.classList.add("ngx-open");
    const g = window.game; if (g && g.input) { g.input.down.clear(); g.input.pressed.clear(); }
    showList();
  }
  function close() {
    stopSession(); open = false; if (el) { el.root.hidden = true; el.body.textContent = ""; say(""); }
    document.body.classList.remove("ngx-open");
    for (const u of urls) { try { URL.revokeObjectURL(u); } catch (e) { /* ignore */ } } urls = []; localBios = null;
  }
  function onKey(e) {
    if (!open || typing(e.target)) return;
    e.stopImmediatePropagation();                                        // the cabinet owns the keyboard: no walking, no hotbar, no inventory, no emotes
    if (e.key === "Escape") { e.preventDefault(); if (session) showList(); else close(); return; }
    if ((e.key === "Enter" || e.key === " ") && e.target && e.target.tagName === "BUTTON") return;
    if (e.key.startsWith("Arrow") || e.key === " ") e.preventDefault();
  }
  const Gm = Game.prototype, upd = Gm.update;
  Gm.update = function (dt) {
    if (!keyHooked) { keyHooked = true; window.addEventListener("keydown", onKey, true); }
    if (open) { this.input.down.clear(); this.input.pressed.clear(); }
    return upd.call(this, dt);
  };
  const pd = Gm.passDoor; Gm.passDoor = function (dir) { if (open) close(); return pd.call(this, dir); };
  if (window.CinemaUI && CinemaUI.UI) { const um = Object.getOwnPropertyDescriptor(CinemaUI.UI.prototype, "modal"); Object.defineProperty(CinemaUI.UI.prototype, "modal", { get() { return um.get.call(this) || open; }, configurable: true }); }

  return { open: openMachine, close, get isOpen() { return open; }, cfg, _state: () => ({ open, games: games.slice(), bios, session: session ? { name: session.name, done: session.done } : null }), _esc: esc };
})();
