"use strict";
/* ==========================================================
   Moonlight Valley — arcade mini-games: pure logic (no DOM, no network, no game objects).
   Shared by cinema/arcade.js in the browser (global ArcadeCore) and by tools/test_arcade.js in node (module.exports).

   Everything that must be IDENTICAL on both players' screens is derived here from one 32-bit seed that the challenger picks:
     - Whack-a-Mole : the 30-second mole schedule (when / which hole / how long)
     - Memory Lights: the light sequence (the same for both turns)
     - How Fast?    : the random "wait" before each GO
   plus the rules that turn two results into a winner (judge) and the checks that reject results that cannot be real.
   ========================================================== */
const ArcadeCore = (() => {
  const GAMES = ["whack", "memory", "reaction"];
  const NAMES = { whack: "Whack-a-Mole", memory: "Memory Lights", reaction: "How Fast?" };
  const WHACK = { MS: 30000, HOLES: 9, FIRST_MS: 900 };
  const MEMORY = { START_LEN: 3, MAX_LEVEL: 40, PAD_COUNT: 4 };
  const REACT = { ROUNDS: 5, MIN_DELAY: 1500, MAX_DELAY: 4500, TIMEOUT_MS: 2000, SHOW_MS: 1300, PENALTY_MS: 1000, TOO_FAST_MS: 100 };
  const COUNTDOWN_MS = 3500;

  /* small deterministic PRNG (mulberry32) */
  function rng(seed) {
    let a = (seed >>> 0) || 1;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const newSeed = () => {
    if (typeof crypto !== "undefined" && crypto.getRandomValues) return crypto.getRandomValues(new Uint32Array(1))[0] || 1;
    return Math.floor(Math.random() * 4294967295) + 1;
  };
  const isSeed = (s) => Number.isInteger(s) && s >= 1 && s <= 4294967295;

  /* ---------- Whack-a-Mole: one mole at a time, quicker as the round goes on ---------- */
  function whackSchedule(seed) {
    const r = rng(seed), out = []; let t = WHACK.FIRST_MS, prev = -1;
    for (;;) {
      let hole = Math.floor(r() * WHACK.HOLES); if (hole === prev) hole = (hole + 1 + Math.floor(r() * (WHACK.HOLES - 1))) % WHACK.HOLES;
      const p = t / WHACK.MS, dur = Math.round(1050 - 450 * p + r() * 120), gap = Math.round(200 + r() * 200 - 60 * p);
      if (t + dur > WHACK.MS) break;                                   // a mole never straddles the final bell
      out.push({ t: Math.round(t), hole, dur }); prev = hole; t += dur + gap;
    }
    return out;
  }

  /* ---------- Memory Lights ---------- */
  function memorySequence(seed, n) { const r = rng(seed ^ 0x9E3779B9), out = []; for (let i = 0; i < n; i++) out.push(Math.floor(r() * MEMORY.PAD_COUNT)); return out; }
  const memoryLen = (level) => MEMORY.START_LEN + level - 1;                  // level 1 = 3 lights, level 2 = 4 …
  const memoryScore = (levelsDone) => { let s = 0; for (let l = 1; l <= levelsDone; l++) s += 10 * l; return s; };
  const memoryTiming = (level) => ({ on: Math.max(280, 560 - level * 14), off: Math.max(140, 240 - level * 6) });

  /* ---------- How Fast? ---------- */
  function reactionDelays(seed) { const r = rng(seed ^ 0x85EBCA6B), out = []; for (let i = 0; i < REACT.ROUNDS; i++) out.push(Math.round(REACT.MIN_DELAY + r() * (REACT.MAX_DELAY - REACT.MIN_DELAY))); return out; }
  // start offsets (ms after the shared start) of each round: wait + GO window + the result flash, back to back
  function reactionTimeline(seed) {
    const d = reactionDelays(seed), out = []; let t = 0;
    for (let i = 0; i < d.length; i++) { out.push({ start: t, go: t + d[i], end: t + d[i] + REACT.TIMEOUT_MS }); t += d[i] + REACT.TIMEOUT_MS + REACT.SHOW_MS; }
    return out;
  }
  const reactionAvg = (times) => (times.length ? times.reduce((a, b) => a + b, 0) / times.length : null);

  /* ---------- results: normalise + validate (what a partner sends us must be something a real game could produce) ---------- */
  // whack  { h: hits }                                  1 .. schedule length
  // memory { lv: levels completed, s: score }           score must equal memoryScore(lv)
  // reaction { t: [ms x ROUNDS], f: [0|1 x ROUNDS] }    each ms in [TOO_FAST, PENALTY]; flagged rounds must be exactly the penalty
  function validateResult(game, r, seed) {
    if (!r || typeof r !== "object") return null;
    if (game === "whack") {
      const n = whackSchedule(seed).length; if (!Number.isInteger(r.h) || r.h < 0 || r.h > n) return null; return { game, h: r.h, score: r.h };
    }
    if (game === "memory") {
      if (!Number.isInteger(r.lv) || r.lv < 0 || r.lv > MEMORY.MAX_LEVEL) return null; if (r.s !== memoryScore(r.lv)) return null; return { game, lv: r.lv, score: r.s };
    }
    if (game === "reaction") {
      // on the wire the flags travel as "fl" ("f" is the link's own sender field and would be overwritten); locally they are "f"
      // (also "t" is the link's message type), so on the wire the times travel as "tm"
      const flags = Array.isArray(r.fl) ? r.fl : r.f, times = Array.isArray(r.tm) ? r.tm : r.t;
      if (!Array.isArray(times) || times.length !== REACT.ROUNDS || !Array.isArray(flags) || flags.length !== REACT.ROUNDS) return null;
      for (let i = 0; i < REACT.ROUNDS; i++) {
        const ms = times[i], f = flags[i];
        if (!Number.isFinite(ms) || (f !== 0 && f !== 1)) return null;
        if (f === 1 ? ms !== REACT.PENALTY_MS : (ms < REACT.TOO_FAST_MS || ms > REACT.PENALTY_MS)) return null;
      }
      const t = times.map((x) => Math.round(x * 10) / 10), sum = t.reduce((a, b) => a + b, 0);
      return { game, t, f: flags.slice(), sum, avg: sum / REACT.ROUNDS, score: Math.round(sum / REACT.ROUNDS), best: Math.min(...t.filter((_, i) => !flags[i]), REACT.PENALTY_MS) };
    }
    return null;
  }

  /* ---------- who won?  a, b = normalised results.  Returns "a" | "b" | "draw" ---------- */
  function judge(game, a, b) {
    if (!a || !b) return null;
    const cmp = (x, y) => (x === y ? "draw" : x > y ? "a" : "b");
    if (game === "whack") return cmp(a.h, b.h);
    if (game === "memory") return a.lv !== b.lv ? cmp(a.lv, b.lv) : cmp(a.score, b.score);
    if (game === "reaction") return a.sum === b.sum ? "draw" : a.sum < b.sum ? "a" : "b";           // LOWER total (= lower average) wins
    return null;
  }

  /* ---------- live ranking for the scoreboard: [{ rank, leading, tied }] for me / them ---------- */
  function standings(game, me, them) {                     // me / them: { v } numbers (null = nothing yet); higherBetter per game
    const hi = game !== "reaction";
    if (me == null && them == null) return { me: { rank: 1, leading: false, tied: false }, them: { rank: 1, leading: false, tied: false } };
    if (me == null) return { me: { rank: 2, leading: false, tied: false }, them: { rank: 1, leading: true, tied: false } };
    if (them == null) return { me: { rank: 1, leading: true, tied: false }, them: { rank: 2, leading: false, tied: false } };
    if (me === them) return { me: { rank: 1, leading: false, tied: true }, them: { rank: 1, leading: false, tied: true } };
    const meLead = hi ? me > them : me < them;
    return { me: { rank: meLead ? 1 : 2, leading: meLead, tied: false }, them: { rank: meLead ? 2 : 1, leading: !meLead, tied: false } };
  }

  /* ---------- incoming "arc" messages: strict shape check ---------- */
  const ID = /^[A-Za-z0-9_-]{1,40}$/;
  const ACTIONS = new Set(["ch", "ac", "dc", "go", "sc", "rs", "rm", "bye", "st"]);
  function validateMsg(m) {
    if (!m || typeof m !== "object" || !ACTIONS.has(m.a) || typeof m.m !== "string" || !ID.test(m.m)) return null;
    const o = { a: m.a, m: m.m, f: typeof m.f === "string" ? m.f : "" };
    if (m.a === "ch" || m.a === "go") {
      if (!GAMES.includes(m.g)) return null; o.g = m.g;
      if (m.a === "go") { if (!isSeed(m.seed) || !Number.isFinite(m.at) || typeof m.first !== "string" || !ID.test(m.first) || !Number.isInteger(m.n) || m.n < 0 || m.n > 1000) return null; o.seed = m.seed; o.at = m.at; o.first = m.first; o.n = m.n; }
    }
    if (m.a === "dc") o.why = typeof m.why === "string" ? m.why.slice(0, 40) : "";
    if (m.a === "sc") {
      if (!Number.isInteger(m.s) || m.s < 0 || m.s > 100000) return null; o.s = m.s;
      if (m.r !== undefined) { if (!Number.isInteger(m.r) || m.r < 0 || m.r > REACT.ROUNDS) return null; o.r = m.r; }
      if (m.avg !== undefined) { if (!Number.isFinite(m.avg) || m.avg < 0 || m.avg > 5000) return null; o.avg = m.avg; }
      if (m.p !== undefined) o.p = m.p === 1 ? 1 : 0;                        // 1 = "I am playing right now" (memory turns)
    }
    if (m.a === "rs") o.r = m;                                              // validated per game with validateResult
    if (m.a === "st") o.st = typeof m.st === "string" ? m.st.slice(0, 12) : "";
    return o;
  }

  const api = { GAMES, NAMES, WHACK, MEMORY, REACT, COUNTDOWN_MS, rng, newSeed, isSeed, whackSchedule, memorySequence, memoryLen, memoryScore, memoryTiming,
    reactionDelays, reactionTimeline, reactionAvg, validateResult, judge, standings, validateMsg };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  return api;
})();
