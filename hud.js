"use strict";
/* Moonlight Valley — HUD behaviour that goes with hud.css (no game rules are changed here).
   - The hotbar is hidden during normal play; it peeks in for ~2 s whenever you change tool (1-0, mouse wheel).  The bag (I / Esc) is unchanged.
   - A small bag button for touch screens, because there is no I key there. */
(() => {
  const PEEK_MS = 2200;
  const bar = () => document.getElementById("hotbar");
  let t = 0;
  function peek() { const b = bar(); if (!b) return; b.classList.add("peek"); clearTimeout(t); t = setTimeout(() => b.classList.remove("peek"), PEEK_MS); }
  const sel = Game.prototype.selectSlot;
  Game.prototype.selectSlot = function (i) { const r = sel.call(this, i); peek(); return r; };
  const hud = document.getElementById("hud");
  if (hud && !document.getElementById("bag-btn")) {
    const b = document.createElement("button"); b.id = "bag-btn"; b.type = "button"; b.title = "Backpack (I)"; b.setAttribute("aria-label", "Open backpack"); b.textContent = "🎒";
    b.addEventListener("click", () => { const g = window.game; if (g && !g.fade && !(window.Arcade && Arcade.isOpen) && !(window.NeoGeo && NeoGeo.isOpen)) g.toggleInventory(); });
    hud.appendChild(b);
  }
})();
