"use strict";
/* ==========================================================
   Moonlight Valley — maps and way-points
   - Mini-map (bottom right): the page you are in, with landmarks, villagers, monsters and your way-point.
     Click it (or press M) to open the full map.
   - Full map: all 9 pages side by side, every shop / home / well / kitchen / travel point labelled.
     Click anywhere (or a place in the list) to drop a way-point, click it again or right-click to clear it.
   - Way-point: a flag in the world, an arrow on the screen edge with the distance, and on other pages an arrow
     toward the exit that leads there. Saved with the game.
   ========================================================== */
(() => {
  const T = CONFIG.TILE, W = CONFIG.MAP_W, H = CONFIG.MAP_H;
  const { GRASS, PATH, WATER } = FP;

  const TERRAIN = {
    farm:   { g: "#79b45a", p: "#c9b48a", w: "#4f95cf" }, meadow: { g: "#7cb85e", p: "#cdb98e", w: "#4f95cf" },
    birch:  { g: "#86bb62", p: "#cdb98e", w: "#4f95cf" }, forest: { g: "#4e8a50", p: "#b9a67e", w: "#3f80b8" },
    grove:  { g: "#6aa04f", p: "#c4ae82", w: "#4f95cf" }, hollow: { g: "#587a58", p: "#a89a78", w: "#3f78b0" },
    beach:  { g: "#79b45a", p: "#ecd9a0", w: "#3f9ad6" },
  };
  // kind -> [letter, colour, label]
  const KIND = {
    home:    ["H", "#4aa3ff", "Your home"],
    shop:    ["$", "#f2c94c", "Shop"],
    weapons: ["A", "#e0605a", "Armory"],
    house:   ["", "#d8c9a8", "House"],
    barn:    ["B", "#c47f4a", "Barn"],
    coop:    ["C", "#f0e08a", "Chicken coop"],
    well:    ["W", "#6fd3e8", "Well / water"],
    kitchen: ["K", "#f09a4a", "Cooking fire"],
    travel:  ["T", "#a98cff", "Fast-travel point"],
  };
  const PRIORITY = ["home", "shop", "weapons", "travel", "barn", "coop", "kitchen", "well", "house"];

  const css = document.createElement("style");
  css.textContent = `
  #worldmap { pointer-events: auto; cursor: pointer; padding: 5px 6px 4px; transition: transform .12s; }
  #worldmap:hover { transform: scale(1.04); }
  #worldmap canvas { display: block; border: 2px solid #3b2616; border-radius: 4px; image-rendering: pixelated; background: #234; }
  #worldmap .wm-name { font-size: 11px; margin-top: 3px; color: #fde6b2; }
  #map-box { position: relative; padding: 12px 14px 12px; max-width: 96vw; color: #fde6b2; }
  #map-box h2 { margin: 0 0 8px; font-size: 18px; display: flex; justify-content: space-between; align-items: center; gap: 12px; }
  #map-box h2 small { font-size: 12px; font-weight: normal; color: #d9bd8c; }
  #map-body { display: flex; gap: 12px; align-items: stretch; }
  #map-canvas { display: block; border: 3px solid #3b2616; border-radius: 6px; cursor: crosshair; image-rendering: pixelated; background: #1b2a3a; max-width: calc(96vw - 300px); max-height: calc(100vh - 150px); width: 760px; }
  #map-side { width: 220px; display: flex; flex-direction: column; gap: 8px; min-height: 0; }
  #map-places { overflow-y: auto; max-height: calc(100vh - 330px); background: rgba(0,0,0,.18); border-radius: 6px; padding: 4px; flex: 1; }
  #map-places .pg { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #d9bd8c; padding: 5px 4px 2px; }
  #map-places .pl { display: flex; align-items: center; gap: 6px; padding: 3px 5px; border-radius: 4px; cursor: pointer; font-size: 13px; }
  #map-places .pl:hover { background: rgba(255,255,255,.14); }
  #map-places .pl i { width: 16px; height: 16px; border-radius: 50%; flex: none; font: bold 10px/16px sans-serif; text-align: center; font-style: normal; color: #2b1d14; border: 1px solid #2b1d14; }
  #map-places .pl.sq i { border-radius: 3px; }
  #map-places .pl span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #map-places .pl button { font-size: 10px; padding: 1px 5px; }
  #map-tip { position: absolute; pointer-events: none; background: rgba(30,18,10,.95); color: #fde6b2; border: 1px solid #a8693a; border-radius: 5px; padding: 3px 7px; font-size: 12px; white-space: nowrap; z-index: 3; }
  #map-wp { font-size: 12px; background: rgba(0,0,0,.2); border-radius: 6px; padding: 6px 8px; min-height: 34px; }
  #map-foot { margin-top: 8px; font-size: 12px; color: #d9bd8c; display: flex; justify-content: space-between; gap: 10px; align-items: center; }
  #map-box .cook-btn { cursor: pointer; }
  @media (max-width: 900px) { #map-body { flex-direction: column; } #map-side { width: auto; } #map-canvas { width: 100%; max-width: 100%; } #map-places { max-height: 120px; } }
  `;
  document.head.appendChild(css);

  const stateOf = (g) => g._map || (g._map = { cache: {}, cacheKey: "", season: "" });

  Object.assign(Game.prototype, {
    // ---------- data ----------
    mapPageInfo(id) {
      const g = this, st = stateOf(g), pg = g.getPage(id), key = id + "|" + FP.season;
      if (st.cache[id] && st.cache[id].key === key) return st.cache[id];
      const area = pg.area, theme = area.spec.theme || "meadow", col = TERRAIN[theme] || TERRAIN.meadow;
      const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
      const c = cv.getContext("2d"), im = c.createImageData(W, H), hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
      const snow = FP.season === "winter";
      const cols = [hex(snow ? "#e9f0f4" : col.g), hex(snow && theme !== "beach" ? "#c9c3b5" : col.p), hex(snow ? "#7fb2d6" : col.w)];
      for (let i = 0; i < W * H; i++) { const t = area.ter[i], cc = cols[t] || cols[0], j = i * 4; im.data[j] = cc[0]; im.data[j + 1] = cc[1]; im.data[j + 2] = cc[2]; im.data[j + 3] = 255; }
      c.putImageData(im, 0, 0);
      for (const t of area.trees) { if (t.stump) continue; const x = Math.floor(t.cx0 / T), y = Math.floor((t.baseY - 4) / T); c.fillStyle = snow ? "#9fb7a8" : theme === "forest" || theme === "hollow" ? "#2c5c36" : "#3d7a3e"; c.fillRect(x, y - 1, 2, 2); }
      const marks = [];
      for (const o of pg.objects) {
        let kind = null, name = o.name || o.label || "", x, y;
        if (o instanceof HomeKit.House) { kind = "home"; name = "Your home"; x = o.sx + o.sw / 2; y = o.baseY; }
        else if (o.role && o.sw !== undefined) { kind = o.role === "home" ? "home" : o.role; if (!KIND[kind]) continue; name = o.label || KIND[kind][2]; x = o.sx + o.sw / 2; y = o.baseY; }
        else if (o.constructor.name === "Well") { kind = "well"; name = "Well"; x = o.cx; y = o.cy; }
        else if (o.constructor.name === "Kitchen") { kind = "kitchen"; name = "Cooking fire"; x = o.cx; y = o.cy; }
        else if (o instanceof TravelPoint) { kind = "travel"; name = o.travelName; x = o.cx; y = o.cy; }
        if (kind) marks.push({ kind, name, page: id, tx: x / T, ty: y / T });
      }
      return (st.cache[id] = { key, canvas: cv, marks, name: area.spec.name, spec: area.spec, area });
    },
    allMapMarks() { const out = []; for (const id of WORLD.order) out.push(...this.mapPageInfo(id).marks); return out; },

    // ---------- way-point ----------
    setWaypoint(wp) {
      this.waypoint = wp; this.refreshMapUI();
      if (wp) this.showMessage(`Way-point set: ${wp.name}`, 1400); else this.showMessage("Way-point cleared", 900);
      this.saveGame(true);
    },
    // grid route: first direction to leave this page for the way-point's page
    waypointStep() {
      const wp = this.waypoint; if (!wp || wp.page === this.pageId) return null;
      const [tx, ty] = wp.page.split(",").map(Number), cur = this.page.spec, start = `${cur.gx},${cur.gy}`;
      const D = { N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0] }, opp = { N: "S", S: "N", W: "E", E: "W" };
      const prev = { [start]: null }, q = [start];
      while (q.length) {
        const id = q.shift(); if (id === wp.page) break;
        const [gx, gy] = id.split(",").map(Number);
        for (const d of Object.keys(D)) {
          const nid = `${gx + D[d][0]},${gy + D[d][1]}`;
          if (prev[nid] !== undefined || !WORLD.pages[nid] || !WORLD.exitSpan(gx, gy, d) || !WORLD.exitSpan(gx + D[d][0], gy + D[d][1], opp[d])) continue;
          prev[nid] = { from: id, dir: d }; q.push(nid);
        }
      }
      if (prev[wp.page] === undefined) return null;
      let id = wp.page, step = null; while (prev[id]) { step = prev[id]; id = step.from; }
      return step ? step.dir : null;
    },
    waypointTarget() { // world pixel position the arrow/flag should point at, or null
      const wp = this.waypoint; if (!wp) return null;
      if (wp.page === this.pageId) return { x: wp.tx * T, y: wp.ty * T, exact: true };
      const d = this.waypointStep(), ex = this.village.exits[d]; if (!d || !ex) return null;
      const mid = ((ex[0] + ex[1]) / 2 + 0.5) * T;
      return { N: { x: mid, y: 0 }, S: { x: mid, y: H * T }, W: { x: 0, y: mid }, E: { x: W * T, y: mid } }[d];
    },
    drawWaypoint(ctx) {
      const wp = this.waypoint; if (!wp || this.inside) return;
      const tg = this.waypointTarget(); if (!tg) return;
      const cam = this.camera, p = this.player, now = performance.now() / 1000;
      const sx = tg.x - cam.x, sy = tg.y - cam.y, pad = 34;
      const dist = Math.hypot(tg.x - p.cx, tg.y - p.cy) / T;
      if (tg.exact && dist < 1.6) { this.waypoint = null; this.showMessage(`You've arrived: ${wp.name}`, 1600); this.saveGame(true); this.refreshMapUI(); return; }
      const label = tg.exact ? `${wp.name} · ${Math.round(dist)} m` : `${wp.name} (${WORLD.pages[wp.page].name}) · ${Math.round(dist)} m`;
      ctx.save(); ctx.textAlign = "center"; ctx.font = "bold 12px 'Trebuchet MS', sans-serif";
      const on = sx > pad && sx < cam.w - pad && sy > pad && sy < cam.h - pad;
      if (on && tg.exact) { // pulsing flag planted at the spot
        const pulse = 1 + Math.sin(now * 4) * 0.12;
        ctx.fillStyle = "rgba(255,80,90,.25)"; ctx.beginPath(); ctx.ellipse(sx, sy, 22 * pulse, 10 * pulse, 0, 0, 6.3); ctx.fill();
        ctx.strokeStyle = "#3b2616"; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx, sy - 44); ctx.stroke();
        ctx.strokeStyle = "#f4efe0"; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = "#ff4d5e"; ctx.strokeStyle = "#3b2616"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(sx, sy - 44); ctx.lineTo(sx + 24 + Math.sin(now * 6) * 2, sy - 36); ctx.lineTo(sx, sy - 27); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.lineWidth = 4; ctx.strokeStyle = "rgba(30,18,10,.9)"; ctx.strokeText(label, sx, sy - 52); ctx.fillStyle = "#fde6b2"; ctx.fillText(label, sx, sy - 52);
      } else { // arrow on the screen edge pointing toward it
        const cx = cam.w / 2, cy = (70 + cam.h - 110) / 2, dx = sx - cx, dy = sy - cy, ang = Math.atan2(dy, dx);
        const padT = 70, padB = 110, hy = (cam.h - padB - padT) / 2; const k = Math.min((cx - pad) / Math.abs(Math.cos(ang) || 1e-6), hy / Math.abs(Math.sin(ang) || 1e-6));
        const ax = cx + Math.cos(ang) * k, ay = cy + Math.sin(ang) * k, bob = Math.sin(now * 5) * 3;
        ctx.translate(ax + Math.cos(ang) * bob, ay + Math.sin(ang) * bob); ctx.rotate(ang);
        ctx.fillStyle = "#ff4d5e"; ctx.strokeStyle = "#3b2616"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-10, -12); ctx.lineTo(-4, 0); ctx.lineTo(-10, 12); ctx.closePath(); ctx.stroke(); ctx.fill();
        ctx.rotate(-ang);
        const lx = Math.cos(ang) > 0.4 ? -64 : Math.cos(ang) < -0.4 ? 64 : 0, ly = Math.abs(Math.sin(ang)) > 0.6 ? (Math.sin(ang) > 0 ? -22 : 28) : 22;
        ctx.lineWidth = 4; ctx.strokeStyle = "rgba(30,18,10,.9)"; ctx.strokeText(label, lx, ly); ctx.fillStyle = "#fde6b2"; ctx.fillText(label, lx, ly);
      }
      ctx.restore();
    },

    // ---------- mini-map ----------
    setupMaps() {
      const wm = document.getElementById("worldmap");
      wm.innerHTML = `<canvas id="mini-cv" width="${W * 2}" height="${H * 2}" title="Click or press M for the full map"></canvas><div class="wm-name" id="wm-name"></div>`;
      this.miniCv = document.getElementById("mini-cv");
      this.miniCv.style.width = `${W * 2}px`; this.miniCv.style.height = `${H * 2}px`;
      wm.addEventListener("click", () => this.toggleMap());
      // full map panel
      const box = document.createElement("div"); box.id = "map-box"; box.className = "panel-box"; box.hidden = true;
      box.innerHTML = `<h2><span>World Map</span><small>Click the map to set a way-point · right-click to clear · M / Esc to close</small></h2>
        <div id="map-body"><canvas id="map-canvas"></canvas>
          <div id="map-side"><div id="map-wp"></div><div id="map-places"></div></div></div>
        <div id="map-foot"><span id="map-legend"></span><span><button class="cook-btn" id="map-clear">Clear way-point</button> <button class="cook-btn" id="map-close">Close</button></span></div>`;
      this.overlayEl.appendChild(box); this.mapBoxEl = box;
      this.mapCv = box.querySelector("#map-canvas");
      this.mapTip = document.createElement("div"); this.mapTip.id = "map-tip"; this.mapTip.hidden = true; box.appendChild(this.mapTip);
      box.querySelector("#map-legend").innerHTML = ["home", "shop", "weapons", "barn", "well", "kitchen", "travel"].map((k) => `<span style="margin-right:8px"><b style="color:${KIND[k][1]}">●</b> ${KIND[k][2]}</span>`).join("");
      box.querySelector("#map-close").addEventListener("click", () => this.closeAllPanels());
      box.querySelector("#map-clear").addEventListener("click", () => this.setWaypoint(null));
      const cv = this.mapCv;
      const toTile = (e) => { const r = cv.getBoundingClientRect(), fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height; const gx = Math.floor(fx * 3), gy = Math.floor(fy * 3); if (gx < 0 || gy < 0 || gx > 2 || gy > 2) return null; return { page: `${gx - 1},${gy - 1}`, tx: fx * 3 * W - gx * W, ty: fy * 3 * H - gy * H, fx, fy }; };
      const marksNear = (pt) => { if (!pt) return null; let best = null, bd = 4.5; for (const m of this.mapPageInfo(pt.page).marks) { const d = Math.hypot(m.tx - pt.tx, m.ty - pt.ty); if (d < bd) { bd = d; best = m; } } return best; };
      cv.addEventListener("mousemove", (e) => {
        const pt = toTile(e), m = marksNear(pt), tip = this.mapTip;
        if (!pt) { tip.hidden = true; return; }
        const r = cv.getBoundingClientRect(), br = box.getBoundingClientRect();
        tip.hidden = false; tip.style.left = `${e.clientX - br.left + 14}px`; tip.style.top = `${e.clientY - br.top + 14}px`;
        tip.textContent = m ? `${m.name}  ·  ${WORLD.pages[pt.page].name}` : WORLD.pages[pt.page].name;
      });
      cv.addEventListener("mouseleave", () => { this.mapTip.hidden = true; });
      cv.addEventListener("click", (e) => {
        const pt = toTile(e); if (!pt) return;
        const m = marksNear(pt), w = this.waypoint;
        if (w && w.page === pt.page && Math.hypot(w.tx - pt.tx, w.ty - pt.ty) < 3.5) { this.setWaypoint(null); return; }
        const walkable = this.mapPageInfo(pt.page).area.typeAt(Math.floor(pt.tx), Math.floor(pt.ty)) !== WATER;
        if (!m && !walkable) { this.showMessage("Can't walk on water - pick another spot", 1200); return; }
        // markers sit on a building's base line: stand in front of it (a tile lower)
        this.setWaypoint(m ? { page: m.page, tx: m.tx, ty: m.ty + (["house", "shop", "weapons", "home", "barn", "coop"].includes(m.kind) ? 0.9 : 0.4), name: m.name } : { page: pt.page, tx: pt.tx, ty: pt.ty, name: "Way-point" });
      });
      cv.addEventListener("contextmenu", (e) => { e.preventDefault(); this.setWaypoint(null); });
    },
    toggleMap() {
      if (this.uiMode === "map") { this.closeAllPanels(); return; }
      if (this.uiMode || this.fade || this.player.dead || this.inside) return;
      this.closeAllPanels(); this.uiMode = "map";
      this.overlayEl.hidden = false; this.mapBoxEl.hidden = false;
      this.refreshMapUI();
    },
    refreshMapUI() {
      if (!this.mapBoxEl || this.uiMode !== "map") return;
      const cv = this.mapCv, k = 4; cv.width = 3 * W * k; cv.height = 3 * H * k;
      const c = cv.getContext("2d"); c.imageSmoothingEnabled = false; c.fillStyle = "#1b2a3a"; c.fillRect(0, 0, cv.width, cv.height);
      const wp = this.waypoint;
      for (const id of WORLD.order) {
        const [gx, gy] = id.split(",").map(Number), ox = (gx + 1) * W * k, oy = (gy + 1) * H * k, info = this.mapPageInfo(id);
        c.drawImage(info.canvas, ox, oy, W * k, H * k);
        if (!this.visited[id]) { c.fillStyle = "rgba(10,16,30,.42)"; c.fillRect(ox, oy, W * k, H * k); }
        c.strokeStyle = id === this.pageId ? "#f2c94c" : "rgba(20,12,6,.8)"; c.lineWidth = id === this.pageId ? 4 : 2; c.strokeRect(ox + 1, oy + 1, W * k - 2, H * k - 2);
        c.font = "bold 15px 'Trebuchet MS', sans-serif"; c.textAlign = "left"; c.lineWidth = 4; c.strokeStyle = "rgba(20,12,6,.85)"; c.fillStyle = "#fff3cf";
        const title = info.name + (this.visited[id] ? "" : "  (unexplored)"); c.strokeText(title, ox + 8, oy + 18); c.fillText(title, ox + 8, oy + 18);
        // roads leaving the page
        c.fillStyle = "rgba(255,255,255,.55)";
        for (const m of info.marks.slice().sort((a, b) => PRIORITY.indexOf(b.kind) - PRIORITY.indexOf(a.kind))) this.drawMark(c, m, ox + m.tx * k, oy + m.ty * k, 1);
      }
      if (wp) { const [gx, gy] = wp.page.split(",").map(Number), x = (gx + 1) * W * k + wp.tx * k, y = (gy + 1) * H * k + wp.ty * k; this.drawFlag(c, x, y); }
      const [pgx, pgy] = this.pageId.split(",").map(Number), p = this.player;
      this.drawYou(c, (pgx + 1) * W * k + (p.cx / T) * k, (pgy + 1) * H * k + (p.cy / T) * k);
      // side: way-point status + places list
      const side = this.mapBoxEl.querySelector("#map-wp");
      side.innerHTML = wp ? `<b>Way-point</b><br>${wp.name}<br><small>${WORLD.pages[wp.page].name}${wp.page === this.pageId ? ` · ${Math.round(Math.hypot(wp.tx * T - p.cx, wp.ty * T - p.cy) / T)} m away` : ""}</small>` : `<b>No way-point</b><br><small>Click the map or a place below.</small>`;
      const list = this.mapBoxEl.querySelector("#map-places"); list.innerHTML = "";
      const marks = this.allMapMarks().filter((m) => m.kind !== "well" && m.kind !== "kitchen" || m.page === this.pageId);
      for (const id of WORLD.order.slice().sort((a, b) => (a === this.pageId ? -1 : b === this.pageId ? 1 : 0))) {
        const ms = marks.filter((m) => m.page === id).sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind)); if (!ms.length) continue;
        const h = document.createElement("div"); h.className = "pg"; h.textContent = WORLD.pages[id].name + (id === this.pageId ? "  (you are here)" : ""); list.appendChild(h);
        for (const m of ms) {
          const row = document.createElement("div"), K = KIND[m.kind]; row.className = "pl" + (m.kind === "house" ? " sq" : "");
          row.innerHTML = `<i style="background:${K[1]}">${K[0]}</i><span>${m.name}</span>`;
          row.addEventListener("click", () => this.setWaypoint({ page: m.page, tx: m.tx, ty: m.ty + (["house", "shop", "weapons", "home", "barn", "coop"].includes(m.kind) ? 0.9 : 0.4), name: m.name }));
          if (m.kind === "travel" && this.travelUnlocked[m.name]) {
            const b = document.createElement("button"); b.className = "cook-btn"; b.textContent = "Travel";
            b.addEventListener("click", (e) => { e.stopPropagation(); const def = WORLD.travelDefs.find((d) => d.name === m.name); if (def) this.travelTo({ travelName: def.name, page: def.page, cx: def.tx * T, cy: def.ty * T, unlocked: true }); });
            row.appendChild(b);
          }
          list.appendChild(row);
        }
      }
    },
    drawMark(c, m, x, y, s) {
      const K = KIND[m.kind], r = m.kind === "house" ? 4.2 * s : m.kind === "well" || m.kind === "kitchen" ? 4.6 * s : 7 * s;
      c.save(); c.lineWidth = 1.6; c.strokeStyle = "#2b1d14"; c.fillStyle = K[1];
      if (m.kind === "house") c.fillRect(x - r, y - r, r * 2, r * 2), c.strokeRect(x - r, y - r, r * 2, r * 2);
      else if (m.kind === "travel") { c.beginPath(); c.moveTo(x, y - r - 1); c.lineTo(x + r + 1, y); c.lineTo(x, y + r + 1); c.lineTo(x - r - 1, y); c.closePath(); c.fill(); c.stroke(); }
      else { c.beginPath(); c.arc(x, y, r, 0, 6.3); c.fill(); c.stroke(); }
      if (K[0] && r > 5) { c.fillStyle = "#2b1d14"; c.font = `bold ${Math.round(r * 1.4)}px sans-serif`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(K[0], x, y + 0.5); }
      c.restore();
    },
    drawFlag(c, x, y) {
      c.save(); c.strokeStyle = "#2b1d14"; c.lineWidth = 3; c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - 20); c.stroke();
      c.fillStyle = "#ff4d5e"; c.beginPath(); c.moveTo(x, y - 20); c.lineTo(x + 14, y - 15); c.lineTo(x, y - 9); c.closePath(); c.fill(); c.stroke();
      c.fillStyle = "#fff"; c.beginPath(); c.arc(x, y, 2.5, 0, 6.3); c.fill(); c.restore();
    },
    drawYou(c, x, y) {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 280);
      c.save(); c.fillStyle = `rgba(255,255,255,${0.25 + pulse * 0.3})`; c.beginPath(); c.arc(x, y, 9 + pulse * 3, 0, 6.3); c.fill();
      c.fillStyle = "#ff5a3c"; c.strokeStyle = "#fff"; c.lineWidth = 2.5; c.beginPath(); c.arc(x, y, 5.5, 0, 6.3); c.fill(); c.stroke(); c.restore();
    },
    drawMiniMap() {
      const cv = this.miniCv; if (!cv || this.inside) return;
      const c = cv.getContext("2d"), k = 2, info = this.mapPageInfo(this.pageId), p = this.player, cam = this.camera;
      c.imageSmoothingEnabled = false; c.drawImage(info.canvas, 0, 0, W * k, H * k);
      for (const m of info.marks.slice().sort((a, b) => PRIORITY.indexOf(b.kind) - PRIORITY.indexOf(a.kind))) this.drawMark(c, m, m.tx * k, m.ty * k, 0.55);
      for (const o of this.objects) if (o instanceof WORLD.Npc && !o.asleep) { c.fillStyle = "#fff6c2"; c.fillRect(Math.round(o.cx / T * k) - 1, Math.round(o.cy / T * k) - 1, 3, 3); }
      for (const m of this.monsters.list) if (!m.dead) { c.fillStyle = "#ff3b3b"; c.fillRect(Math.round(m.cx / T * k) - 1, Math.round(m.cy / T * k) - 1, 3, 3); }
      c.strokeStyle = "rgba(255,255,255,.6)"; c.lineWidth = 1; c.strokeRect(cam.x / T * k + 0.5, cam.y / T * k + 0.5, cam.w / T * k, cam.h / T * k);
      const wp = this.waypoint;
      if (wp && wp.page === this.pageId) this.drawFlag(c, wp.tx * k, wp.ty * k); else if (wp) { // off page: arrow at the edge that leads there
        const d = this.waypointStep(), tg = this.waypointTarget();
        if (d && tg) { c.fillStyle = "#ff4d5e"; c.strokeStyle = "#2b1d14"; c.lineWidth = 1.5; const x = Math.min(Math.max(tg.x / T * k, 6), W * k - 6), y = Math.min(Math.max(tg.y / T * k, 6), H * k - 6); c.beginPath(); c.arc(x, y, 5, 0, 6.3); c.fill(); c.stroke(); }
      }
      const blink = Math.floor(performance.now() / 350) % 2;
      c.fillStyle = blink ? "#fff" : "#ff5a3c"; c.strokeStyle = "#2b1d14"; c.lineWidth = 1.5; c.beginPath(); c.arc(p.cx / T * k, p.cy / T * k, 4, 0, 6.3); c.fill(); c.stroke();
      if (this._mmName !== this.page.spec.name) { this._mmName = this.page.spec.name; document.getElementById("wm-name").textContent = this._mmName; }
    },
  });

  const wrap = (name, fn) => { const o = Game.prototype[name]; Game.prototype[name] = function (...a) { return fn.call(this, o, ...a); }; };
  wrap("updateWorldMap", function () { if (this.miniCv) this._mmName = null; });
  wrap("closeAllPanels", function (o, ...a) { if (this.mapBoxEl) { this.mapBoxEl.hidden = true; if (this.mapTip) this.mapTip.hidden = true; } return o.apply(this, a); });
  wrap("renderOverlays", function (o, ...a) {
    if (!this.mapBoxEl) { this.setupMaps(); }
    if (!this.inside) { this.drawWaypoint(this.ctx); this.drawMiniMap(); }
    document.getElementById("worldmap").style.visibility = this.inside ? "hidden" : "visible";
    if (this.uiMode === "map" && (this._mapT = (this._mapT || 0) + 1) % 10 === 0) this.refreshMapUI();
    return o.apply(this, a);
  });
  window.addEventListener("keydown", (e) => {
    const g = window.game; if (!g || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.toLowerCase() === "m" && g.mapBoxEl) g.toggleMap();
  });
})();
