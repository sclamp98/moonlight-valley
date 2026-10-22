"use strict";
/* ==========================================================
   Moonlight Valley — title screen, player profiles and save folder
   - Title screen on launch: Continue / New Game / Load Game.
   - New Game asks for a name and Male / Female. Each player gets their own save slot.
   - Saves live in the browser (localStorage) automatically. In Chrome / Edge you can also pick a real
     folder on your computer: every save is written there as a .json file, and saves found in that folder
     show up in Load Game (so you can carry them to another computer). Other browsers can Export / Import.
   - Automated browsers (tests) skip the title screen unless the URL has ?menu.
   ========================================================== */
const Profiles = (() => {
  const INDEX = "mv_profiles", LAST = "mv_last_profile", LEGACY = "moonlightValleySave";
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } };
  const lsDel = (k) => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } };
  const saveKey = (id) => "mv_save_" + id;
  const safe = (s) => String(s).replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 24) || "player";
  const fileName = (p) => `moonlight-valley-${safe(p.name)}-${p.id}.json`;

  let list = [];
  try { list = JSON.parse(lsGet(INDEX) || "[]"); } catch (e) { list = []; }
  if (!Array.isArray(list)) list = [];
  const persist = () => lsSet(INDEX, JSON.stringify(list));
  const find = (id) => list.find((p) => p.id === id);

  /* ---------- optional save folder (File System Access API) ---------- */
  const fsOK = typeof window.showDirectoryPicker === "function";
  let dirHandle = null, folderState = "none"; // none | ready | needs-permission
  const idb = () => new Promise((res, rej) => { const r = indexedDB.open("mv_fs", 1); r.onupgradeneeded = () => r.result.createObjectStore("h"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const idbGet = async () => { try { const d = await idb(); return await new Promise((res) => { const q = d.transaction("h").objectStore("h").get("dir"); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); } catch (e) { return null; } };
  const idbSet = async (h) => { try { const d = await idb(); await new Promise((res) => { const t = d.transaction("h", "readwrite"); h ? t.objectStore("h").put(h, "dir") : t.objectStore("h").delete("dir"); t.oncomplete = res; t.onerror = res; }); } catch (e) { /* ignore */ } };
  const perm = async (h, ask) => { try { const o = { mode: "readwrite" }; if ((await h.queryPermission(o)) === "granted") return true; return ask ? (await h.requestPermission(o)) === "granted" : false; } catch (e) { return false; } };
  async function initFolder() {
    if (!fsOK) return;
    dirHandle = await idbGet();
    if (dirHandle) folderState = (await perm(dirHandle, false)) ? "ready" : "needs-permission";
    if (folderState === "ready") await scanFolder();
  }
  async function chooseFolder() {
    if (!fsOK) return false;
    try { dirHandle = await window.showDirectoryPicker({ id: "moonlight-valley", mode: "readwrite", startIn: "documents" }); } catch (e) { return false; }
    await idbSet(dirHandle); folderState = "ready";
    for (const p of list) { const raw = lsGet(saveKey(p.id)); if (raw) await writeFile(p, raw); } // copy existing saves in
    await scanFolder(); return true;
  }
  async function reconnect() { if (dirHandle && (await perm(dirHandle, true))) { folderState = "ready"; await scanFolder(); return true; } return false; }
  async function forgetFolder() { dirHandle = null; folderState = "none"; await idbSet(null); }
  async function writeFile(p, json) {
    if (folderState !== "ready" || !dirHandle) return;
    try { const fh = await dirHandle.getFileHandle(fileName(p), { create: true }); const w = await fh.createWritable(); await w.write(json); await w.close(); }
    catch (e) { folderState = "needs-permission"; }
  }
  // pull saves from the folder into the list (newer file wins)
  async function scanFolder() {
    if (folderState !== "ready") return;
    try {
      for await (const [name, h] of dirHandle.entries()) {
        if (h.kind !== "file" || !/^moonlight-valley-.*\.json$/.test(name)) continue;
        const text = await (await h.getFile()).text();
        importText(text);
      }
    } catch (e) { folderState = "needs-permission"; }
  }
  function importText(text) {
    let d; try { d = JSON.parse(text); } catch (e) { return null; }
    if (!d || !d.profile || !d.profile.id) return null;
    const pr = d.profile, have = find(pr.id), cur = have && lsGet(saveKey(pr.id));
    let curT = 0; try { curT = cur ? JSON.parse(cur).savedAt || 0 : 0; } catch (e) { /* ignore */ }
    if (have && (d.savedAt || 0) <= curT) return have;
    lsSet(saveKey(pr.id), text);
    const rec = { id: pr.id, name: pr.name, gender: pr.gender, created: pr.created || Date.now(), lastPlayed: d.savedAt || Date.now(), day: d.day | 0, coins: d.coins | 0 };
    if (have) Object.assign(have, rec); else list.push(rec);
    persist(); return rec;
  }

  function afterSave(data, json) {
    const p = data.profile && find(data.profile.id); if (!p) return;
    data.savedAt = Date.now();
    json = JSON.stringify(data); lsSet(saveKey(p.id), json);
    Object.assign(p, { lastPlayed: data.savedAt, day: data.day | 0, coins: data.coins | 0 }); persist(); lsSet(LAST, p.id);
    writeFile(p, json);
  }
  function remove(id) { const p = find(id); if (!p) return; lsDel(saveKey(id)); list = list.filter((x) => x.id !== id); persist(); if (lsGet(LAST) === id) lsDel(LAST); if (folderState === "ready" && dirHandle) dirHandle.removeEntry(fileName(p)).catch(() => {}); }
  function create(name, gender) {
    const p = { id: Math.random().toString(36).slice(2, 8), name: name.trim().slice(0, 14) || "Farmer", gender, created: Date.now(), lastPlayed: Date.now(), day: 0, coins: 0 };
    list.push(p); persist(); return p;
  }
  const sorted = () => list.slice().sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
  const last = () => find(lsGet(LAST)) || sorted()[0] || null;

  // old single-slot save from before profiles: adopt it as a profile so nobody loses progress
  function migrate() {
    const raw = lsGet(LEGACY);
    if (!raw || list.length) return;
    let d; try { d = JSON.parse(raw); } catch (e) { return; }
    const p = { id: "legacy", name: "Farmer", gender: CONFIG.PLAYER_CHARACTER || "male", created: Date.now(), lastPlayed: Date.now(), day: (d && d.day) | 0, coins: (d && d.coins) | 0 };
    list.push(p); persist(); lsSet(saveKey(p.id), raw);
  }

  return { get list() { return list; }, sorted, last, find, create, remove, afterSave, migrate, initFolder, chooseFolder, reconnect, forgetFolder, importText, scanFolder, fsOK, get folderState() { return folderState; }, saveKey, fileName, LAST, lsSet };
})();

/* ---------- boot + title screen ---------- */
const Boot = (() => {
  const css = document.createElement("style");
  css.textContent = `
  #title { position: fixed; inset: 0; z-index: 100; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 14px; overflow: auto; padding: 20px;
    background: radial-gradient(ellipse at 50% 30%, #2a3b6b 0%, #141a33 55%, #0b0f20 100%); color: #fde6b2; font-family: 'Trebuchet MS', sans-serif; }
  #title[hidden] { display: none; }
  #title .stars { position: absolute; inset: 0; pointer-events: none; background-image: radial-gradient(1.5px 1.5px at 20% 30%, #fff8, transparent), radial-gradient(1.5px 1.5px at 70% 20%, #fff8, transparent), radial-gradient(1px 1px at 40% 70%, #fff6, transparent), radial-gradient(1.5px 1.5px at 85% 60%, #fff8, transparent), radial-gradient(1px 1px at 10% 80%, #fff6, transparent), radial-gradient(1px 1px at 60% 45%, #fff6, transparent); }
  #title .moon { position: absolute; top: 7%; right: 12%; width: 90px; height: 90px; border-radius: 50%; background: radial-gradient(circle at 35% 35%, #fffbe6, #f2e3a0 60%, #d9c46f); box-shadow: 0 0 60px 18px rgba(255,240,170,.35); }
  #title h1 { position: relative; margin: 0; font-size: clamp(34px, 7vw, 64px); letter-spacing: .04em; color: #fff3cf; text-shadow: 0 4px 0 #3b2616, 0 0 30px rgba(255,230,150,.45); }
  #title .sub { position: relative; margin-top: -6px; color: #d9bd8c; font-size: 15px; }
  .tcard { position: relative; width: min(94vw, 460px); background: linear-gradient(180deg, #6b4326, #4e3019); border: 3px solid #3b2616; box-shadow: inset 0 0 0 2px #a8693a, 0 10px 30px rgba(0,0,0,.5); border-radius: 12px; padding: 18px 20px; display: flex; flex-direction: column; gap: 10px; }
  .tbtn { cursor: pointer; font: bold 16px 'Trebuchet MS', sans-serif; padding: 11px 14px; border-radius: 8px; border: 2px solid #3b2616; background: #f2c94c; color: #3b2616; box-shadow: 0 3px 0 #3b2616; text-align: center; }
  .tbtn:hover { filter: brightness(1.08); } .tbtn:active { transform: translateY(2px); box-shadow: 0 1px 0 #3b2616; }
  .tbtn.alt { background: #e8d3a4; } .tbtn.dim { background: #8a6a45; color: #fde6b2; font-size: 13px; padding: 7px 10px; box-shadow: 0 2px 0 #3b2616; }
  .tbtn small { display: block; font-weight: normal; font-size: 12px; opacity: .8; margin-top: 2px; }
  .tbtn:disabled { opacity: .5; cursor: default; }
  .tcard h2 { margin: 0; font-size: 20px; } .tcard label { font-size: 13px; color: #d9bd8c; }
  .tcard input[type=text] { font: 18px 'Trebuchet MS', sans-serif; padding: 9px 11px; border-radius: 7px; border: 2px solid #3b2616; background: #fff3d6; color: #3b2616; width: 100%; box-sizing: border-box; }
  .gender { display: flex; gap: 12px; }
  .gcard { flex: 1; cursor: pointer; border: 3px solid #3b2616; border-radius: 10px; background: rgba(0,0,0,.2); padding: 8px 6px 6px; text-align: center; color: #fde6b2; font: bold 15px 'Trebuchet MS', sans-serif; }
  .gcard img { height: 120px; width: auto; image-rendering: pixelated; display: block; margin: 0 auto 4px; }
  .gcard.sel { border-color: #f2c94c; background: rgba(242,201,76,.22); box-shadow: 0 0 0 2px #f2c94c88; }
  .prow { display: flex; align-items: center; gap: 10px; background: rgba(0,0,0,.2); border-radius: 8px; padding: 7px 9px; }
  .prow img { height: 44px; image-rendering: pixelated; } .prow .meta { flex: 1; min-width: 0; } .prow .meta b { display: block; font-size: 16px; }
  .prow .meta span { font-size: 12px; color: #d9bd8c; } .plist { display: flex; flex-direction: column; gap: 7px; max-height: 40vh; overflow-y: auto; }
  .prow .x { cursor: pointer; background: none; border: none; color: #e88; font-size: 18px; }
  .trow { display: flex; gap: 8px; } .trow .tbtn { flex: 1; } .tnote { font-size: 12px; color: #d9bd8c; line-height: 1.35; }
  #menu-btn { position: fixed; top: 44px; left: 12px; z-index: 6; cursor: pointer; font: bold 12px 'Trebuchet MS', sans-serif; padding: 4px 9px; border-radius: 6px; border: 2px solid #3b2616; background: rgba(78,48,25,.92); color: #fde6b2; }
  #menu-btn:hover { background: #6b4326; }
  `;
  document.head.appendChild(css);

  const imgFor = (g) => `assets/${g === "female" ? "female" : "male"}_down.png`;
  const ago = (t) => { const m = Math.max(0, (Date.now() - t) / 60000); return m < 2 ? "just now" : m < 60 ? `${Math.floor(m)} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ago` : `${Math.floor(m / 1440)} d ago`; };
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  let el;

  function start(profile) {
    CONFIG.PROFILE = { id: profile.id, name: profile.name, gender: profile.gender, created: profile.created };
    CONFIG.PLAYER_CHARACTER = profile.gender === "female" ? "female" : "male";
    CONFIG.PLAYER_NAME = profile.name;
    CONFIG.SAVE_KEY = Profiles.saveKey(profile.id);
    Profiles.lsSet(Profiles.LAST, profile.id);
    if (el) el.hidden = true;
    window.game = new Game();
    window.game.saveGame(true);
    addMenuButton();
  }
  function addMenuButton() {
    const b = document.createElement("button"); b.id = "menu-btn"; b.textContent = "☰ Menu"; b.title = "Save and return to the title screen";
    b.addEventListener("click", () => { window.game.saveGame(true); location.reload(); });
    document.body.appendChild(b);
  }

  /* ---- screens ---- */
  const folderLine = () => {
    if (!Profiles.fsOK) return `<div class="tnote">Saves are kept automatically in this browser. Use Export / Import to move them to a file.</div>`;
    const s = Profiles.folderState;
    return `<div class="tnote">${s === "ready" ? "📁 Saving to your folder as well." : s === "needs-permission" ? "📁 Your save folder needs permission again." : "Saves are kept in this browser. Pick a folder to also keep a copy of every save on your computer."}</div>
      <div class="trow">${s === "ready" ? `<button class="tbtn dim" data-a="folder">Change folder</button><button class="tbtn dim" data-a="nofolder">Stop using folder</button>` : s === "needs-permission" ? `<button class="tbtn dim" data-a="reconnect">Reconnect folder</button><button class="tbtn dim" data-a="folder">Pick another</button>` : `<button class="tbtn dim" data-a="folder">📁 Choose save folder</button>`}
      <button class="tbtn dim" data-a="import">Import file</button></div>`;
  };
  function shell(inner) {
    el.innerHTML = `<div class="stars"></div><div class="moon"></div><h1>Moonlight Valley</h1><div class="sub">A cozy farm by day, a spooky valley by night</div>${inner}<input type="file" id="imp" accept=".json,application/json" hidden>`;
    el.querySelector("#imp").addEventListener("change", async (e) => { const f = e.target.files[0]; if (!f) return; const r = Profiles.importText(await f.text()); r ? screenLoad(`Imported ${esc(r.name)}`) : alert("That file is not a Moonlight Valley save."); });
    el.addEventListener("click", onClick);
  }
  async function onClick(e) {
    const t = e.target.closest("[data-a]"); if (!t) return; const a = t.dataset.a;
    if (a === "folder") { if (await Profiles.chooseFolder()) screenHome(); }
    else if (a === "reconnect") { await Profiles.reconnect(); screenHome(); }
    else if (a === "nofolder") { await Profiles.forgetFolder(); screenHome(); }
    else if (a === "import") el.querySelector("#imp").click();
  }
  function screenHome() {
    el.removeEventListener("click", onClick);
    const last = Profiles.last(), has = Profiles.list.length;
    shell(`<div class="tcard">
      ${last ? `<button class="tbtn" id="b-cont">Continue<small>${esc(last.name)} · Day ${(last.day | 0) + 1} · ${last.coins | 0} coins · ${ago(last.lastPlayed)}</small></button>` : ""}
      <button class="tbtn ${last ? "alt" : ""}" id="b-new">New Game</button>
      ${has > 1 || (has && !last) ? `<button class="tbtn alt" id="b-load">Load Game<small>${has} saved players</small></button>` : has ? `<button class="tbtn alt" id="b-load">Saved players</button>` : ""}
      ${folderLine()}
    </div>`);
    const $ = (s) => el.querySelector(s);
    if ($("#b-cont")) $("#b-cont").onclick = () => start(last);
    $("#b-new").onclick = screenNew; if ($("#b-load")) $("#b-load").onclick = () => screenLoad();
  }
  function screenNew() {
    el.removeEventListener("click", onClick);
    let gender = "male";
    shell(`<div class="tcard"><h2>Create your farmer</h2>
      <label for="nm">Your name</label><input type="text" id="nm" maxlength="14" placeholder="Farmer" autocomplete="off">
      <label>Character</label>
      <div class="gender"><div class="gcard sel" data-g="male"><img src="${imgFor("male")}" alt="">Male</div><div class="gcard" data-g="female"><img src="${imgFor("female")}" alt="">Female</div></div>
      <button class="tbtn" id="go">Start Game</button>
      <button class="tbtn dim" id="back">Back</button></div>`);
    const $ = (s) => el.querySelector(s);
    el.querySelectorAll(".gcard").forEach((c) => c.addEventListener("click", () => { gender = c.dataset.g; el.querySelectorAll(".gcard").forEach((x) => x.classList.toggle("sel", x === c)); }));
    const go = () => { const name = $("#nm").value.trim(); if (!name) { $("#nm").focus(); $("#nm").style.borderColor = "#e55"; return; } start(Profiles.create(name, gender)); };
    $("#go").onclick = go; $("#nm").addEventListener("keydown", (e) => { if (e.key === "Enter") go(); }); $("#back").onclick = () => (Profiles.list.length ? screenHome() : null);
    if (!Profiles.list.length) $("#back").hidden = true;
    setTimeout(() => $("#nm").focus(), 50);
  }
  function screenLoad(note) {
    el.removeEventListener("click", onClick);
    const rows = Profiles.sorted().map((p) => `<div class="prow" data-id="${p.id}"><img src="${imgFor(p.gender)}" alt=""><div class="meta"><b>${esc(p.name)}</b><span>Day ${(p.day | 0) + 1} · ${p.coins | 0} coins · ${ago(p.lastPlayed)}</span></div>
      <button class="tbtn" data-play="${p.id}" style="padding:6px 12px">Play</button><button class="x" data-del="${p.id}" title="Delete">🗑</button></div>`).join("");
    shell(`<div class="tcard"><h2>Saved players</h2>${note ? `<div class="tnote">${note}</div>` : ""}<div class="plist">${rows || `<div class="tnote">No saves yet.</div>`}</div>
      <button class="tbtn dim" id="back">Back</button></div>`);
    el.querySelector("#back").onclick = screenHome;
    el.querySelectorAll("[data-play]").forEach((b) => (b.onclick = () => start(Profiles.find(b.dataset.play))));
    el.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => { const p = Profiles.find(b.dataset.del); if (p && confirm(`Delete ${p.name}'s save? This can't be undone.`)) { Profiles.remove(p.id); Profiles.list.length ? screenLoad() : screenNew(); } }));
  }

  async function run() {
    const auto = navigator.webdriver && !/[?&]menu/.test(location.search);
    if (auto) { window.game = new Game(); return; } // tests / automation: straight in (default farmer, old single-slot key)
    Profiles.migrate();
    el = document.createElement("div"); el.id = "title"; document.body.appendChild(el);
    await Profiles.initFolder();
    Profiles.list.length ? screenHome() : screenNew();
  }
  return { run, start };
})();

window.addEventListener("DOMContentLoaded", () => Boot.run());
