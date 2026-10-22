"use strict";
/* ==========================================================
   Moonlight Valley — co-op emotes (kiss / hip slap): pure logic, no DOM, no network, no game objects.
   Who may start an emote, where the two farmers stand, the timeline of one emote, message validation.
   Loaded in the browser as a global (EmoteCore) and by node (tools/test_emotes.js) via module.exports.
   ========================================================== */
const EmoteCore = (() => {
  const RANGE = 85;          // max centre-to-centre distance (game px) to start an emote
  const ACCEPT_RANGE = 150;  // the partner is more tolerant: positions are a little stale by the time the message arrives
  const LEAD_MS = 300;       // the emote starts this long after the key press, so both screens begin together
  const GLIDE_S = 0.35;      // both farmers walk to their spots first
  const FADE_S = 0.15;       // crossfade between the normal sprites and the pair animation
  const KINDS = {
    kiss: { key: "k", label: "Kiss", actor: null },        // any couple (one man + one woman)
    slap: { key: "h", label: "Slap", actor: "male" },      // only the man starts it, on the woman
  };
  const KIND_NAMES = Object.keys(KINDS);
  const MSG = {
    nopartner: "Connect with your partner first (co-op button).",
    room: "Your partner has to be in the same room.",
    far: "Get closer to your partner first.",
    pair: "These emotes are for a man and a woman playing together.",
    actor: "Only the man can do this one.",
    busy: "Not right now - stand up / close what's open first.",
    theirbusy: "Your partner can't right now.",
    space: "Not enough room here - move away from the furniture.",
  };

  const dist = (a, b) => Math.hypot(a.cx - b.cx, a.cy - b.cy);

  /* May `me` start `kind` on `partner`? me/partner: { gender, cx, cy }.  st: { connected, sameRoom, busy, active }.
     silent = true means "don't nag" (not connected, or already mid-emote). */
  function check(kind, me, partner, st) {
    const K = KINDS[kind]; if (!K) return { ok: false, silent: true, why: "kind" };
    if (!st.connected || !partner) return { ok: false, silent: true, why: "nopartner", msg: MSG.nopartner };
    if (st.active) return { ok: false, silent: true, why: "active" };
    if (!st.sameRoom) return { ok: false, why: "room", msg: MSG.room };
    if (me.gender === partner.gender) return { ok: false, why: "pair", msg: MSG.pair };
    if (K.actor && me.gender !== K.actor) return { ok: false, why: "actor", msg: MSG.actor };
    if (st.busy) return { ok: false, why: "busy", msg: MSG.busy };
    if (dist(me, partner) > RANGE) return { ok: false, why: "far", msg: MSG.far };
    return { ok: true };
  }

  const chooseFlip = (femaleCx, maleCx) => maleCx < femaleCx;      // art has the woman on the left, the man on the right

  /* Where each farmer stands (centre x, foot y) at the start and the end of the clip.
     art = EMOTE_ART[kind] (canvas px), k = draw scale, anchor = { x, y } world foot line. */
  function layout(art, k, anchor, flip) {
    const s = flip ? -1 : 1, s0 = art.slots;
    return {
      f0: { x: anchor.x + s * s0.f0 * k, y: anchor.y }, m0: { x: anchor.x + s * s0.m0 * k, y: anchor.y },
      f1: { x: anchor.x + s * s0.f1 * k, y: anchor.y }, m1: { x: anchor.x + s * s0.m1 * k, y: anchor.y },
    };
  }

  /* First anchor near `mid` where all four standing spots are free. isFree(x, y, w, h) -> bool (world rect, top-left). */
  function pickAnchor(art, k, flip, mid, isFree, bw = 30, bh = 30) {
    const off = [0, 10, -10, 20, -20, 30, -30, 45, -45];
    const offY = [0, 8, -8, 16, -16, 28, -28];
    for (const dy of offY) for (const dx of off) {
      const a = { x: mid.x + dx, y: mid.y + dy }, L = layout(art, k, a, flip);
      if ([L.f0, L.m0, L.f1, L.m1].every((s) => isFree(s.x - bw / 2, s.y - bh, bw, bh))) return a;
    }
    return null;
  }

  const FINAL = {                       // facing when the pair animation hands control back
    kiss: (flip) => ({ female: flip ? "left" : "right", male: flip ? "right" : "left" }),
    slap: () => ({ female: "up", male: "down" }),
  };
  const GLIDE_FACE = {                  // facing while walking to the spots
    kiss: FINAL.kiss,
    slap: () => ({ female: "up", male: "up" }),
  };

  const frameAt = (times, t) => { let lo = 0, hi = times.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (times[m] <= t) lo = m; else hi = m - 1; } return lo; };
  const clamp01 = (x) => Math.max(0, Math.min(1, x));

  /* One emote on a shared timeline (seconds since it began; negative = still waiting for the start).
     phase: wait | glide | play | done.   duoA = opacity of the pair animation, realA = opacity of the two normal sprites. */
  function timeline(art, t) {
    const total = GLIDE_S + art.dur;
    if (t < 0) return { phase: "wait", u: 0, frame: 0, duoA: 0, realA: 1, total };
    if (t < GLIDE_S) return { phase: "glide", u: t / GLIDE_S, frame: 0, duoA: 0, realA: 1, total };
    if (t >= total) return { phase: "done", u: 1, frame: art.n - 1, duoA: 0, realA: 1, total };
    const pt = t - GLIDE_S;
    const duoA = Math.min(clamp01(pt / FADE_S), clamp01((art.dur - pt) / FADE_S));
    return { phase: "play", u: 1, frame: frameAt(art.t, pt), duoA, realA: 1 - duoA, pt, atEnd: pt > art.dur - FADE_S, total };
  }

  const ease = (u) => u * u * (3 - 2 * u);

  /* Network messages: { a: "go", k, id, lead, ax, ay, fl } | { a: "no", id, why } | { a: "stop", id } */
  const ID_RE = /^[a-z0-9]{4,16}$/i;
  function validateMsg(o) {
    if (!o || typeof o !== "object" || !ID_RE.test(o.id || "")) return null;
    if (o.a === "stop") return { a: "stop", id: o.id };
    if (o.a === "no") return { a: "no", id: o.id, why: typeof o.why === "string" ? o.why.slice(0, 16) : "busy" };
    if (o.a !== "go" || !KINDS[o.k]) return null;
    const num = (v, lim) => typeof v === "number" && isFinite(v) && Math.abs(v) <= lim;
    if (!num(o.ax, 20000) || !num(o.ay, 20000) || !num(o.lead, 5000) || o.lead < 0) return null;
    return { a: "go", k: o.k, id: o.id, lead: o.lead, ax: o.ax, ay: o.ay, fl: !!o.fl };
  }

  /* Both pressed at the same moment: the same winner on both screens, decided by the ids alone. */
  const winsTie = (mineId, theirId) => mineId < theirId;

  const randomId = () => Math.random().toString(36).slice(2, 10).padEnd(8, "0");

  const api = { RANGE, ACCEPT_RANGE, LEAD_MS, GLIDE_S, FADE_S, KINDS, KIND_NAMES, MSG, check, chooseFlip, layout, pickAnchor, FINAL, GLIDE_FACE, frameAt, timeline, ease, validateMsg, winsTie, randomId, dist };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  return api;
})();
