"use strict";
/* Moonlight Valley — audio system (music, sound effects, ambience, settings).

   Everything you hear is ORIGINAL and generated live by the Web Audio API from code in this file: there are no audio files to download,
   no third-party samples, no licences to track (all of it is released with the game).  The only loaded "assets" are numbers.

   Layout
     1  settings (saved in localStorage)         2  graph: music / sfx / ambient buses -> master -> limiter
     3  synth voices (piano, pluck, pad, bass, chip, bell, drums, noise)
     4  music: 7 generative tracks + crossfading scene manager
     5  sound effects (~50)                       6  ambience (wind, birds, crickets, rain, room tone)
     7  game hooks (read-only observers of the existing game; no game logic is changed)
     8  settings panel                            9  public API: MVAudio

   Nothing here is sent over the network: sounds are triggered by LOCAL events only (what this player's game sees), so there is no audio traffic
   through Ably / WebRTC, and an event that arrives twice is de-duplicated by key + time window.
   Every entry point is wrapped so an audio error can never break the game. */
const MVAudio = (() => {
  const LS = "mv_audio_v1";
  const DEFAULTS = { master: 0.8, music: 0.6, sfx: 0.8, ambient: 0.6, muted: false };
  const BASE = { music: 0.3, sfx: 0.55, ambient: 0.32 };        // headroom per bus; sliders are squared (perceptual) on top of this
  const safe = (fn) => function () { try { return fn.apply(this, arguments); } catch (e) { if (window.console) console.warn("[audio]", e && e.message); } };

  /* ============ 1. settings ============ */
  let S = Object.assign({}, DEFAULTS);
  try { const j = JSON.parse(localStorage.getItem(LS) || "null"); if (j && typeof j === "object") for (const k of Object.keys(DEFAULTS)) if (typeof j[k] === typeof DEFAULTS[k]) S[k] = k === "muted" ? !!j[k] : Math.min(1, Math.max(0, +j[k])); } catch (_) {}
  const save = () => { try { localStorage.setItem(LS, JSON.stringify(S)); } catch (_) {} };

  /* ============ 2. graph ============ */
  let ac = null, G = null, unlocked = false, hidden = document.hidden, ready = false;
  const log = []; let logOn = false;                              // test hook only
  function buildGraph(ctx, dest) {
    const g = {};
    g.master = ctx.createGain(); g.limiter = ctx.createDynamicsCompressor();
    g.limiter.threshold.value = -10; g.limiter.knee.value = 12; g.limiter.ratio.value = 10; g.limiter.attack.value = 0.004; g.limiter.release.value = 0.2;
    g.master.connect(g.limiter); g.limiter.connect(dest);
    for (const b of ["music", "sfx", "amb"]) { g[b] = ctx.createGain(); g[b + "Duck"] = ctx.createGain(); g[b].connect(g[b + "Duck"]); g[b + "Duck"].connect(g.master); }
    g.verb = ctx.createConvolver(); g.verb.buffer = impulse(ctx, 2.6); g.verbIn = ctx.createGain(); g.verbIn.gain.value = 0.5; g.verbIn.connect(g.verb); g.verb.connect(g.music);
    g.noise = noiseBuf(ctx);
    return g;
  }
  function impulse(ctx, secs) {
    const n = Math.floor(ctx.sampleRate * secs), b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); let lp = 0; for (let i = 0; i < n; i++) { const t = i / n; lp += (Math.random() * 2 - 1 - lp) * 0.35; d[i] = lp * Math.pow(1 - t, 2.4) * 0.9; } }
    return b;
  }
  function noiseBuf(ctx) { const n = ctx.sampleRate * 2, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; return b; }
  const curve = (v) => v * v;
  function applySettings(smooth = 0.06) {
    if (!ac || !G) return;
    const t = ac.currentTime, f = (p, v) => p.setTargetAtTime(v, t, smooth);
    f(G.master.gain, S.muted ? 0 : curve(S.master));
    f(G.music.gain, curve(S.music) * BASE.music); f(G.sfx.gain, curve(S.sfx) * BASE.sfx); f(G.amb.gain, curve(S.ambient) * BASE.ambient);
  }

  /* ---- browser autoplay rules: nothing starts until a real gesture; iOS needs resume() inside the gesture and a silent buffer played ---- */
  const GESTURES = ["pointerdown", "pointerup", "touchend", "click", "keydown"];
  function ensureCtx() {
    if (ac) return ac;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    ac = new AC({ latencyHint: "interactive" }); G = buildGraph(ac, ac.destination); applySettings(0.001);
    ac.addEventListener("statechange", () => { if (ac.state !== "running" && !hidden && !S.muted) armGesture(); });
    return ac;
  }
  const onGesture = safe(function () {
    const c = ensureCtx(); if (!c) return;
    if (c.state !== "running") c.resume().catch(() => {});
    try { const b = c.createBuffer(1, 1, 22050), s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0); } catch (_) {}   // iOS unlock
    if (c.state === "running") { unlocked = true; disarmGesture(); }
    else c.addEventListener("statechange", () => { if (c.state === "running") { unlocked = true; disarmGesture(); } }, { once: true });
  });
  let armed = false;
  function armGesture() { if (armed) return; armed = true; for (const e of GESTURES) window.addEventListener(e, onGesture, true); }
  function disarmGesture() { if (!armed) return; armed = false; for (const e of GESTURES) window.removeEventListener(e, onGesture, true); }
  const running = () => !!ac && ac.state === "running" && !S.muted;

  /* ============ 3. synth voices (all take the context + destination so they also run in an OfflineAudioContext for tests) ============ */
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  function Synth(c, g, out, wet) {
    const env = (gn, t, a, peak, d, hold = 0) => { gn.gain.setValueAtTime(0.0001, t); gn.gain.linearRampToValueAtTime(peak, t + a); if (hold) gn.gain.setValueAtTime(peak, t + a + hold); gn.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + d); };
    const send = (node, amt) => { if (wet && amt) { const s = c.createGain(); s.gain.value = amt; node.connect(s); s.connect(wet); } };
    const osc = (type, f, t, dur) => { const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.start(t); o.stop(t + dur); return o; };
    const lp = (f, q = 0.7) => { const n = c.createBiquadFilter(); n.type = "lowpass"; n.frequency.value = f; n.Q.value = q; return n; };
    const V = {};
    V.piano = (t, m, d, v, rev = 0.35) => {                         // soft felt-piano: triangle + two partials, quick bright-to-dark decay
      const f = mtof(m), len = Math.max(1.2, d * 1.5) + 0.2, out_ = c.createGain(), flt = lp(Math.min(f * 7, 5200), 0.4);
      for (const [mul, a, type] of [[1, 1, "triangle"], [2, 0.22, "sine"], [3.01, 0.08, "sine"], [0.5, 0.1, "sine"]]) { const o = osc(type, f * mul, t, len), gg = c.createGain(); gg.gain.value = a; o.connect(gg); gg.connect(flt); }
      flt.frequency.setValueAtTime(Math.min(f * 8, 6000), t); flt.frequency.exponentialRampToValueAtTime(Math.max(f * 2, 400), t + 0.6);
      env(out_, t, 0.006, v * 0.5, len - 0.01); flt.connect(out_); out_.connect(out); send(out_, rev);
    };
    V.pluck = (t, m, d, v, rev = 0.25) => {                         // nylon-ish guitar pluck
      const f = mtof(m), len = Math.max(0.9, d) + 0.15, out_ = c.createGain(), flt = lp(3600, 1.2);
      for (const dt of [-4, 4]) { const o = osc("sawtooth", f, t, len); o.detune.value = dt; const gg = c.createGain(); gg.gain.value = 0.35; o.connect(gg); gg.connect(flt); }
      const o2 = osc("triangle", f * 2, t, len), g2 = c.createGain(); g2.gain.value = 0.15; o2.connect(g2); g2.connect(flt);
      flt.frequency.setValueAtTime(3600, t); flt.frequency.exponentialRampToValueAtTime(380, t + 0.28);
      env(out_, t, 0.003, v * 0.55, len - 0.01); flt.connect(out_); out_.connect(out); send(out_, rev);
    };
    V.pad = (t, ms, d, v, rev = 0.6) => {                           // slow warm pad: detuned triangles, slow attack/release
      const out_ = c.createGain(), flt = lp(1100, 0.3); const a = Math.min(d * 0.45, 2.4), r = Math.min(d * 0.5, 2.8);
      out_.gain.setValueAtTime(0.0001, t); out_.gain.linearRampToValueAtTime(v * 0.28, t + a); out_.gain.setValueAtTime(v * 0.28, t + Math.max(a, d - r)); out_.gain.linearRampToValueAtTime(0.0001, t + d + r * 0.6);
      for (const m of ms) for (const dt of [-7, 7]) { const o = osc("triangle", mtof(m), t, d + r); o.detune.value = dt; const gg = c.createGain(); gg.gain.value = 1 / (ms.length * 1.5); o.connect(gg); gg.connect(flt); }
      flt.connect(out_); out_.connect(out); send(out_, rev);
    };
    V.bass = (t, m, d, v) => { const f = mtof(m), out_ = c.createGain(), flt = lp(420); const o = osc("sine", f, t, d + 0.3), o2 = osc("triangle", f, t, d + 0.3), g2 = c.createGain(); g2.gain.value = 0.35; o.connect(flt); o2.connect(g2); g2.connect(flt); env(out_, t, 0.012, v * 0.6, d); flt.connect(out_); out_.connect(out); };
    V.chip = (t, m, d, v) => { const out_ = c.createGain(), flt = lp(5200, 0.5), o = osc("square", mtof(m), t, d + 0.1); o.connect(flt); env(out_, t, 0.004, v * 0.22, d); flt.connect(out_); out_.connect(out); };
    V.bell = (t, m, d, v, rev = 0.7) => {                           // music-box / glass bell: inharmonic partials, long soft tail
      const f = mtof(m), out_ = c.createGain(), len = Math.max(2.2, d);
      for (const [mul, a] of [[1, 1], [2.756, 0.35], [5.404, 0.12]]) { const o = osc("sine", f * mul, t, len), gg = c.createGain(); gg.gain.value = a; o.connect(gg); gg.connect(out_); }
      env(out_, t, 0.004, v * 0.32, len - 0.01); out_.connect(out); send(out_, rev);
    };
    V.noise = (t, d, v, { type = "bandpass", f = 1500, q = 1, to = null, attack = 0.003 } = {}) => {
      const s = c.createBufferSource(); s.buffer = g.noise; s.loop = true; const flt = c.createBiquadFilter(); flt.type = type; flt.frequency.setValueAtTime(f, t); flt.Q.value = q; if (to) flt.frequency.exponentialRampToValueAtTime(to, t + d);
      const out_ = c.createGain(); env(out_, t, attack, v, d); s.connect(flt); flt.connect(out_); out_.connect(out); s.start(t, Math.random()); s.stop(t + d + attack + 0.05);
    };
    V.hat = (t, v) => V.noise(t, 0.05, v * 0.18, { type: "highpass", f: 7500, q: 0.5 });
    V.kick = (t, v) => { const out_ = c.createGain(), o = osc("sine", 120, t, 0.3); o.frequency.exponentialRampToValueAtTime(42, t + 0.14); env(out_, t, 0.003, v * 0.5, 0.2); o.connect(out_); out_.connect(out); };
    V.tone = (t, f, d, v, { type = "sine", to = null, attack = 0.004, cutoff = 0, dest = null } = {}) => {
      const out_ = c.createGain(), o = osc(type, f, t, d + attack + 0.05); if (to) o.frequency.exponentialRampToValueAtTime(to, t + d); let node = o; if (cutoff) { const fl = lp(cutoff); o.connect(fl); node = fl; }
      env(out_, t, attack, v, d); node.connect(out_); out_.connect(dest || out); send(out_, 0);
    };
    return V;
  }

  /* ============ 4. music ============ */
  const Q = { maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], "6": [0, 4, 7, 9], sus: [0, 5, 7, 10], m9: [0, 3, 7, 10, 14], maj: [0, 4, 7], min: [0, 3, 7], "7": [0, 4, 7, 10], add9: [0, 4, 7, 14], maj9: [0, 4, 7, 11, 14] };
  const PENT = { maj: [0, 2, 4, 7, 9], min: [0, 3, 5, 7, 10] };
  const rngOf = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const pick = (r, a) => a[Math.floor(r() * a.length)];
  const chordNotes = (root, q) => Q[q].map((i) => root + i);

  /* Each track: bpm, a chord progression (root MIDI, quality, bars), and layers. bar() schedules exactly one bar (4 beats) starting at t0. */
  const TRACKS = {
    hall: { title: "Hearth", bpm: 72, scale: ["maj", 60], prog: [[48, "maj7"], [45, "m7"], [41, "maj7"], [43, "6"], [48, "maj7"], [52, "m7"], [41, "maj7"], [43, "sus"]],
      layers: { pad: 0.55, bass: 0.5, arp: { inst: "piano", pat: [0, 2, 1, 3, 2, 1, 3, 2], step: 0.5, vel: 0.42, p: 0.85, oct: 1 }, pick: { inst: "pluck", beats: [1.5, 3.5], vel: 0.26, p: 0.7 }, melody: { inst: "piano", p: 0.5, oct: 2, vel: 0.4, beats: [0, 2] } } },
    gaming: { title: "Pixel Lounge", bpm: 116, kind: "arcade", scale: ["min", 69], prog: [[57, "min"], [53, "maj"], [48, "maj"], [55, "maj"]], layers: {} },
    cinema: { title: "Low Light", bpm: 48, scale: ["min", 62], per: 2, prog: [[50, "m9"], [46, "maj7"], [43, "m9"], [45, "sus"]], layers: { pad: 0.7, bell: { p: 0.4 }, sub: 0.35 } },
    morning: { title: "First Light", bpm: 84, scale: ["maj", 67], prog: [[55, "6"], [50, "maj"], [52, "m7"], [48, "maj9"]],
      layers: { pad: 0.35, bass: 0.35, arp: { inst: "pluck", pat: [0, 1, 2, 1, 3, 2, 1, 2], step: 0.5, vel: 0.36, p: 0.95, oct: 1 }, melody: { inst: "piano", p: 0.6, oct: 2, vel: 0.42, beats: [0, 1, 2, 3] } } },
    day: { title: "Meadow Walk", bpm: 96, scale: ["maj", 60], prog: [[48, "maj"], [43, "maj"], [45, "min"], [41, "maj9"]],
      layers: { pad: 0.3, bass: 0.45, walk: 0.34, arp: { inst: "pluck", pat: [1, 2, 3, 2], step: 1, vel: 0.28, p: 0.9, oct: 1, off: 0.5 }, melody: { inst: "piano", p: 0.55, oct: 2, vel: 0.4, beats: [0, 1.5, 3] } } },
    evening: { title: "Golden Hour", bpm: 64, scale: ["maj", 65], prog: [[41, "maj7"], [38, "m7"], [46, "maj7"], [48, "sus"]],
      layers: { pad: 0.6, bass: 0.35, arp: { inst: "piano", pat: [0, 2, 3, 1], step: 1, vel: 0.36, p: 0.8, oct: 1 }, pick: { inst: "pluck", beats: [2.5], vel: 0.22, p: 0.6 }, melody: { inst: "piano", p: 0.4, oct: 2, vel: 0.34, beats: [0, 2] } } },
    night: { title: "Moonlit", bpm: 56, scale: ["min", 69], per: 2, prog: [[45, "m9"], [41, "maj7"], [48, "maj7"], [43, "6"]], layers: { pad: 0.55, bell: { p: 0.6 }, sub: 0.3 } },
  };
  const TRACK_VOL = { gaming: 0.8 };                              // arcade music a bit lower so the cabinet effects stay clear

  function scheduleBar(V, def, name, barIdx, t0, rnd) {
    const spb = 60 / def.bpm, per = def.per || 1, pi = Math.floor(barIdx / per) % def.prog.length, [root, q] = def.prog[pi], tones = chordNotes(root, q);
    const L = def.layers, r = rnd, hum = () => (r() - 0.5) * 0.016, nat = TRACKS_PENT(def);
    const first = barIdx % per === 0;
    if (def.kind === "arcade") {                                   // retro lounge: square arps, triangle bass, soft kick + hats
      const chord = chordNotes(root + 12, q), pat = [0, 1, 2, 1, 0, 1, 2, 3], s16 = spb / 4;
      for (let i = 0; i < 16; i++) { const tt = t0 + i * s16; if (r() < 0.9) V.chip(tt, chord[pat[i % 8] % chord.length] + (i % 8 > 4 && r() < 0.3 ? 12 : 0), s16 * 0.8, 0.5 + (i % 4 === 0 ? 0.2 : 0)); }
      for (let i = 0; i < 8; i++) V.bass(t0 + i * spb / 2, root - 12 + (i % 4 === 3 ? 7 : 0), spb * 0.4, 0.55);
      V.kick(t0, 0.7); V.kick(t0 + 2 * spb, 0.6); if (r() < 0.5) V.kick(t0 + 3.5 * spb, 0.4);
      for (let i = 0; i < 8; i++) V.hat(t0 + (i + 0.5) * spb / 2 - spb / 4 + spb / 4, i % 2 ? 0.9 : 0.5);
      if (r() < 0.55) { const m = nat[Math.floor(r() * nat.length)] + 12; V.chip(t0 + pick(r, [0, 1, 2, 3]) * spb, m, spb * 1.2, 0.8); }
      return;
    }
    if (L.pad && first) V.pad(t0, tones.slice(0, 4).map((m) => m + 12), spb * 4 * per, L.pad);
    if (L.sub && first) V.bass(t0, root - 24, spb * 4 * per, L.sub);
    if (L.bass) { V.bass(t0, root - 12, spb * 2, L.bass); if (r() < 0.6) V.bass(t0 + spb * 2.5, root - 12 + 7, spb * 1.2, L.bass * 0.7); }
    if (L.walk) for (let b = 0; b < 4; b++) V.bass(t0 + b * spb, root - 12 + [0, 4, 7, 4][b] % 12 + (b === 3 && r() < 0.5 ? 2 : 0), spb * 0.8, L.walk);
    if (L.arp) {
      const A = L.arp, n = tones.length, steps = Math.floor(4 / A.step);
      for (let i = 0; i < steps; i++) { if (r() > A.p) continue; const k = A.pat[i % A.pat.length]; const m = tones[k % n] + 12 * (A.oct + Math.floor(k / n)); const tt = t0 + (i * A.step + (A.off || 0)) * spb + hum(); V[A.inst](tt, m, spb * 1.4, A.vel * (0.85 + r() * 0.3)); }
    }
    if (L.pick) for (const b of L.pick.beats) if (r() < L.pick.p) V.pluck(t0 + b * spb + hum(), tones[Math.floor(r() * tones.length)] + 12, spb * 1.2, L.pick.vel);
    if (L.melody) { const M = L.melody; for (const b of M.beats) if (r() < M.p) V.piano(t0 + b * spb + hum(), nat[Math.floor(r() * nat.length)] + 12 * (M.oct - 1), spb * 1.8, M.vel * (0.85 + r() * 0.3)); }
    if (L.bell) for (let i = 0; i < 2; i++) if (r() < L.bell.p) V.bell(t0 + (r() * 3.2) * spb, nat[Math.floor(r() * nat.length)] + 12, 3, 0.7 + r() * 0.3);
  }
  function TRACKS_PENT(def) { const [kind, root] = def.scale; return PENT[kind].map((i) => root + i).concat(PENT[kind].map((i) => root + 12 + i)); }

  /* live track: schedules one bar at a time, a little ahead of the clock */
  let current = null; const fading = new Set();
  function startTrack(name, fadeIn = 2.8) {
    const def = TRACKS[name]; if (!def || !ac) return null;
    const vol = TRACK_VOL[name] || 1, t0 = ac.currentTime, out = ac.createGain(), wet = ac.createGain();       // wet = this track's reverb send: it fades together with the track
    for (const n of [out, wet]) { n.gain.setValueAtTime(0.0001, t0); n.gain.linearRampToValueAtTime(vol, t0 + fadeIn); }
    out.connect(G.music); wet.connect(G.verbIn);
    const V = Synth(ac, G, out, wet), seed = (Math.random() * 1e9) | 0;
    const tr = { name, out, wet, V, def, next: t0 + 0.25, bar: 0, seed, timer: 0, dead: false };
    const pump = () => { if (tr.dead || !ac || ac.state !== "running") return; const spb = 60 / def.bpm; while (tr.next < ac.currentTime + 1.4) { try { scheduleBar(V, def, name, tr.bar, tr.next, rngOf(seed + tr.bar * 977)); } catch (e) { console.warn("[audio] bar", e.message); } tr.bar++; tr.next += spb * 4; } };
    tr.timer = setInterval(pump, 150); pump(); return tr;
  }
  function ramp(tr, secs) { try { const t = ac.currentTime; for (const n of [tr.out, tr.wet]) { n.gain.cancelScheduledValues(t); n.gain.setValueAtTime(Math.max(n.gain.value, 0.0001), t); n.gain.linearRampToValueAtTime(0.0001, t + secs); } } catch (_) {} }
  function release(tr) { try { tr.out.disconnect(); tr.wet.disconnect(); } catch (_) {} fading.delete(tr); }
  function stopTrack(tr, fadeOut = 2.2) {
    if (!tr || tr.dead) return; tr.dead = true; clearInterval(tr.timer); ramp(tr, fadeOut); fading.add(tr);
    tr.rel = setTimeout(() => release(tr), (fadeOut + 0.4) * 1000);
  }
  function hurry(tr) { clearTimeout(tr.rel); ramp(tr, 0.25); tr.rel = setTimeout(() => release(tr), 400); }   // an older track that is still fading when a newer change arrives: finish it quickly
  let wantScene = null, sceneSince = 0;
  function setScene(name) {                                        // idempotent: asking for the track that is already playing does nothing
    if (!running()) return;
    if (current && current.name === name) return;
    if (!name) { if (current) { stopTrack(current, 1.8); current = null; } return; }
    for (const f of Array.from(fading)) hurry(f);                    // never let more than one old track linger
    if (current) stopTrack(current, 2.4);
    current = startTrack(name, 3.0);
  }

  /* ============ 5. sound effects ============ */
  const jit = (x, a = 0.06) => x * (1 + (Math.random() * 2 - 1) * a);
  const SFX = {
    step_grass: (V, t) => { V.noise(t, 0.07, 0.16, { f: jit(900, .2), q: 0.7 }); V.noise(t, 0.05, 0.08, { type: "lowpass", f: 400 }); },
    step_wood: (V, t) => { V.tone(t, jit(120, .1), 0.07, 0.22, { to: 70 }); V.noise(t, 0.03, 0.1, { f: jit(1800, .2), q: 1.4 }); },
    step_tile: (V, t) => { V.noise(t, 0.035, 0.16, { f: jit(2600, .15), q: 2 }); V.tone(t, jit(160, .1), 0.05, 0.1, { to: 90 }); },
    step_carpet: (V, t) => { V.noise(t, 0.08, 0.1, { type: "lowpass", f: jit(500, .2) }); },
    step_sand: (V, t) => { V.noise(t, 0.11, 0.13, { type: "bandpass", f: jit(1400, .2), q: 0.5 }); },
    door_open: (V, t) => { V.tone(t, 150, 0.32, 0.12, { type: "sawtooth", to: 230, cutoff: 700 }); V.noise(t, 0.3, 0.06, { f: 500, q: 2, to: 900 }); V.tone(t + 0.34, 90, 0.08, 0.16, { to: 60 }); },
    door_close: (V, t) => { V.tone(t, 110, 0.12, 0.28, { to: 55 }); V.noise(t, 0.05, 0.14, { f: 900, q: 1 }); V.tone(t + 0.1, 1900, 0.03, 0.05, { type: "square" }); },
    transition: (V, t) => { V.noise(t, 0.5, 0.1, { type: "bandpass", f: 300, q: 0.8, to: 1800, attack: 0.15 }); },
    enter: (V, t) => { V.tone(t, 523, 0.5, 0.1, { cutoff: 2500 }); V.tone(t + 0.09, 659, 0.5, 0.08, { cutoff: 2500 }); },
    ui_click: (V, t) => { V.tone(t, 880, 0.045, 0.14, { type: "triangle" }); V.tone(t, 1760, 0.03, 0.04); },
    ui_select: (V, t) => { V.tone(t, jit(620, .02), 0.06, 0.15, { type: "triangle" }); },
    ui_back: (V, t) => { V.tone(t, 640, 0.07, 0.12, { type: "triangle", to: 420 }); },
    bag_open: (V, t) => { V.noise(t, 0.16, 0.12, { f: 2200, q: 0.6, to: 3200 }); V.tone(t + 0.05, 740, 0.2, 0.1, { cutoff: 3000 }); V.tone(t + 0.12, 988, 0.22, 0.08, { cutoff: 3000 }); },
    bag_close: (V, t) => { V.noise(t, 0.14, 0.1, { f: 3000, q: 0.6, to: 1800 }); V.tone(t + 0.03, 740, 0.16, 0.08, { to: 560, cutoff: 3000 }); },
    panel_open: (V, t) => { V.tone(t, 523, 0.14, 0.12, { type: "triangle" }); V.tone(t + 0.07, 784, 0.2, 0.12, { type: "triangle" }); },
    panel_close: (V, t) => { V.tone(t, 784, 0.12, 0.1, { type: "triangle" }); V.tone(t + 0.07, 523, 0.18, 0.1, { type: "triangle" }); },
    dialog: (V, t) => { V.tone(t, jit(520, .05), 0.07, 0.1, { type: "triangle" }); },
    interact: (V, t) => { V.tone(t, 440, 0.1, 0.12, { type: "triangle" }); V.tone(t + 0.04, 660, 0.12, 0.1, { type: "triangle" }); },
    swing: (V, t) => { V.noise(t, 0.16, 0.14, { f: 600, q: 0.8, to: 2400, attack: 0.04 }); },
    notify: (V, t) => { V.tone(t, 880, 0.35, 0.13, { cutoff: 4000 }); V.tone(t + 0.11, 1318, 0.5, 0.1, { cutoff: 4000 }); },
    message: (V, t) => { V.tone(t, 740, 0.12, 0.14, { to: 990 }); V.tone(t + 0.1, 1480, 0.3, 0.08); V.tone(t + 0.14, 1975, 0.35, 0.05); },
    friend_join: (V, t) => { [523, 659, 784, 1046].forEach((f, i) => V.tone(t + i * 0.09, f, 0.45, 0.11, { cutoff: 4200 })); },
    friend_leave: (V, t) => { [784, 659, 523].forEach((f, i) => V.tone(t + i * 0.12, f, 0.5, 0.09, { cutoff: 2600 })); },
    reconnect: (V, t) => { V.tone(t, 659, 0.3, 0.1); V.tone(t + 0.1, 880, 0.4, 0.1); },
    invite: (V, t) => { [659, 880, 1175].forEach((f, i) => V.tone(t + i * 0.13, f, 0.6, 0.11, { cutoff: 3800 })); },
    success: (V, t) => { V.tone(t, 784, 0.18, 0.12, { type: "triangle" }); V.tone(t + 0.08, 1046, 0.35, 0.12, { type: "triangle" }); },
    error: (V, t) => { V.tone(t, 220, 0.14, 0.14, { type: "square", cutoff: 900 }); V.tone(t + 0.11, 165, 0.22, 0.14, { type: "square", cutoff: 800 }); },
    morning: (V, t) => { [523, 659, 784, 988, 1318].forEach((f, i) => V.tone(t + i * 0.14, f, 0.9, 0.08, { cutoff: 3500 })); },
    cinema_enter: (V, t) => { V.tone(t, 392, 0.8, 0.09, { cutoff: 2200 }); V.tone(t + 0.12, 523, 0.9, 0.08, { cutoff: 2200 }); },
    cinema_exit: (V, t) => { V.tone(t, 523, 0.6, 0.08, { cutoff: 2200 }); V.tone(t + 0.12, 392, 0.8, 0.08, { cutoff: 2200 }); },
    arcade_on: (V, t) => { V.tone(t, 180, 0.28, 0.1, { type: "square", to: 720, cutoff: 3000 }); V.tone(t + 0.28, 1080, 0.1, 0.07, { type: "square", cutoff: 3000 }); },
    arcade_off: (V, t) => { V.tone(t, 720, 0.22, 0.09, { type: "square", to: 180, cutoff: 3000 }); },
    menu_select: (V, t) => { V.tone(t, 660, 0.06, 0.1, { type: "square", cutoff: 3500 }); V.tone(t + 0.06, 990, 0.08, 0.1, { type: "square", cutoff: 3500 }); },
    mole_pop: (V, t) => { V.tone(t, 300, 0.06, 0.06, { type: "triangle", to: 520 }); },
    whack_hit: (V, t) => { V.tone(t, 260, 0.12, 0.26, { to: 80 }); V.noise(t, 0.06, 0.18, { f: 1500, q: 1 }); V.tone(t + 0.03, 1320, 0.1, 0.08, { type: "square", cutoff: 3000 }); },
    mem_0: (V, t) => V.tone(t, 262, 0.45, 0.18, { type: "triangle" }), mem_1: (V, t) => V.tone(t, 330, 0.45, 0.18, { type: "triangle" }),
    mem_2: (V, t) => V.tone(t, 392, 0.45, 0.18, { type: "triangle" }), mem_3: (V, t) => V.tone(t, 523, 0.45, 0.18, { type: "triangle" }),
    tick: (V, t) => { V.tone(t, 440, 0.08, 0.12, { type: "square", cutoff: 2500 }); },
    go: (V, t) => { V.tone(t, 880, 0.3, 0.16, { type: "square", cutoff: 4000 }); V.tone(t, 1320, 0.3, 0.07, { type: "square", cutoff: 4000 }); },
    false_start: (V, t) => { V.tone(t, 180, 0.28, 0.16, { type: "sawtooth", cutoff: 700 }); },
    result_ding: (V, t) => { V.tone(t, 988, 0.3, 0.1, { type: "triangle" }); V.tone(t + 0.06, 1318, 0.4, 0.08, { type: "triangle" }); },
    win: (V, t) => { [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => V.tone(t + i * 0.11, f, 0.35, 0.12, { type: "square", cutoff: 4000 })); },
    lose: (V, t) => { [392, 349, 311, 262].forEach((f, i) => V.tone(t + i * 0.16, f, 0.4, 0.11, { type: "triangle", cutoff: 1800 })); },
    draw: (V, t) => { V.tone(t, 523, 0.3, 0.11, { type: "triangle" }); V.tone(t + 0.22, 523, 0.4, 0.11, { type: "triangle" }); },
  };
  const COOLDOWN = { step_grass: 0, step_wood: 0, step_tile: 0, step_carpet: 0, step_sand: 0, ui_click: 55, tick: 150, mole_pop: 40, whack_hit: 30, notify: 250, message: 250, success: 150, error: 200 };
  const lastAt = {}, KEYED = {};
  let sfxV = null;
  function play(name, opt) {
    try {
      const fn = SFX[name]; if (!fn) return false;
      const now = performance.now(), cd = COOLDOWN[name] != null ? COOLDOWN[name] : 70;
      if (opt && opt.key) { const k = name + ":" + opt.key; if (KEYED[k] && now - KEYED[k] < (opt.within || 1500)) return false; KEYED[k] = now; }      // same event arriving twice
      if (now - (lastAt[name] || -1e9) < cd) return false; lastAt[name] = now;
      if (logOn) log.push({ name, t: Math.round(now) });
      if (!running()) return false;
      if (!sfxV) sfxV = Synth(ac, G, G.sfx, null);
      fn(sfxV, ac.currentTime + 0.005); return true;
    } catch (e) { console.warn("[audio] sfx", name, e && e.message); return false; }
  }

  /* ============ 6. ambience ============ */
  const amb = { on: false, wind: null, rain: null, hum: null, timer: 0, level: { outdoor: 0, rain: 0, hum: 0 }, nextBird: 0, nextCricket: 0 };
  function loopNoise(flt, gainv) { const s = ac.createBufferSource(); s.buffer = G.noise; s.loop = true; const f = ac.createBiquadFilter(); f.type = flt.type; f.frequency.value = flt.f; f.Q.value = flt.q || 0.5; const gn = ac.createGain(); gn.gain.value = 0.0001; s.connect(f); f.connect(gn); gn.connect(G.amb); s.start(0, Math.random()); return { s, f, gn }; }
  function ambInit() {
    if (amb.on || !ac) return; amb.on = true;
    amb.wind = loopNoise({ type: "bandpass", f: 420, q: 0.4 }); amb.rain = loopNoise({ type: "highpass", f: 1400, q: 0.5 }); amb.hum = loopNoise({ type: "lowpass", f: 140, q: 0.7 });
    const lfo = ac.createOscillator(), lg = ac.createGain(); lfo.frequency.value = 0.12; lg.gain.value = 160; lfo.connect(lg); lg.connect(amb.wind.f.frequency); lfo.start();   // wind breathes slowly
    amb.timer = setInterval(ambTick, 400);
  }
  function chirp(t, base) { const V = (sfxV = sfxV || Synth(ac, G, G.sfx, null)); const dest = G.amb; const o = ac.createOscillator(), gn = ac.createGain(); o.type = "sine"; o.frequency.setValueAtTime(base, t); o.frequency.exponentialRampToValueAtTime(base * 1.5, t + 0.05); o.frequency.exponentialRampToValueAtTime(base * 1.1, t + 0.11); gn.gain.setValueAtTime(0.0001, t); gn.gain.linearRampToValueAtTime(0.05, t + 0.012); gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.12); o.connect(gn); gn.connect(dest); o.start(t); o.stop(t + 0.15); }
  function ambTick() {
    if (!ac || ac.state !== "running") return; const t = ac.currentTime, L = amb.level, now = t;
    const f = (p, v) => p.setTargetAtTime(v, t, 1.2);
    f(amb.wind.gn.gain, 0.05 * L.outdoor); f(amb.rain.gn.gain, 0.09 * L.rain); f(amb.hum.gn.gain, 0.11 * L.hum);
    if (L.birds && now > amb.nextBird) { const n = 2 + Math.floor(Math.random() * 3), b = 2400 + Math.random() * 1400; for (let i = 0; i < n; i++) chirp(t + 0.02 + i * 0.13, b * (1 + (i % 2) * 0.12)); amb.nextBird = now + 2.5 + Math.random() * 6; }
    if (L.crickets && now > amb.nextCricket) { const b = 4300 + Math.random() * 300; for (let i = 0; i < 6; i++) { const tt = t + 0.02 + i * 0.085, o = ac.createOscillator(), gn = ac.createGain(); o.type = "sine"; o.frequency.value = b; gn.gain.setValueAtTime(0.0001, tt); gn.gain.linearRampToValueAtTime(0.025, tt + 0.015); gn.gain.exponentialRampToValueAtTime(0.0001, tt + 0.06); o.connect(gn); gn.connect(G.amb); o.start(tt); o.stop(tt + 0.08); } amb.nextCricket = now + 1.2 + Math.random() * 3.5; }
  }
  function setAmbience(o) { amb.level.outdoor = o.outdoor || 0; amb.level.rain = o.rain || 0; amb.level.hum = o.hum || 0; amb.level.birds = !!o.birds; amb.level.crickets = !!o.crickets; }

  /* ============ 7. game hooks ============ */
  const hasCinema = () => typeof Cinema !== "undefined";
  function hourOf(g) { return ((g.time || 0) % 24 + 24) % 24; }
  function timeBand(g) { const h = hourOf(g); return h >= 6 && h < 11 ? "morning" : h >= 11 && h < 17 ? "day" : h >= 17 && h < 20 ? "evening" : "night"; }
  function sceneOf(g) {
    const r = g.inside;
    if (r) return r.isCinema ? "cinema" : r.isGaming ? "gaming" : "hall";
    return timeBand(g);
  }
  function surfaceOf(g) {
    const r = g.inside; if (r) return r.isCinema ? "carpet" : r.isGaming ? "tile" : "wood";
    try { const th = g.page && g.page.area && g.page.area.spec && g.page.area.spec.theme; if (th === "beach") return "sand"; } catch (_) {}
    return "grass";
  }
  function cinemaPlaying() { try { return hasCinema() && !!(Cinema.session && Cinema.session.active && Cinema.session.joined && Cinema.session.localState === "playing"); } catch (_) { return false; } }

  let prev = { ui: null, fade: null, phase: null, day: null, scene: null, link: null, cinePlay: false, arc: false, ngx: false, inside: undefined };
  const linkSeen = new WeakSet();
  function attachLink(L) {
    if (!L || typeof L.on !== "function" || linkSeen.has(L)) return; linkSeen.add(L);
    L.on("hello", safe((peer, first) => { play("friend_join", { key: (peer && (peer.id || peer.name)) || "p", within: 4000 }); }));
    L.on("down", safe(() => play("friend_leave", { key: "down", within: 2500 })));
    L.on("restored", safe(() => play("reconnect", { key: "restored", within: 2500 })));
  }
  function hookCinema() {
    if (!hasCinema() || Cinema.__audioHooked) return; Cinema.__audioHooked = true;
    const oc = Cinema.onChat;
    if (typeof oc === "function") Cinema.onChat = function (m) { try { const ok = typeof CinemaCore !== "undefined" ? CinemaCore.validateChat(m) : m; if (ok) play("message", { key: ok.ts != null ? String(ok.ts) + (ok.text || "").slice(0, 12) : (ok.text || "").slice(0, 24), within: 2500 }); } catch (_) {} return oc.apply(this, arguments); };
  }
  const ERR = /can't|can’t|cannot|not enough|full|nothing|no room|too far|not tired|you need|won't|failed|locked|closed|already|isn't|doesn't|didn't|couldn't|invalid|error/i;
  const OK = /sold|bought|harvest|cooked|planted|picked|you got|\+\d|saved|unlocked|ready|opened|equipped|watered|delicious|restored/i;
  function hookGame() {
    if (typeof Game === "undefined" || Game.prototype.__audioHooked) return; Game.prototype.__audioHooked = true;
    const sm = Game.prototype.showMessage;
    Game.prototype.showMessage = function (text) {
      try {
        const t = String(text || "");
        let name = "notify";
        if (/joined your game/i.test(t)) name = "friend_join"; else if (/link closed|co-op.*(closed|lost)|disconnect/i.test(t)) name = "friend_leave"; else if (/reconnected/i.test(t)) name = "reconnect";
        else if (/started a video|is watching a video|invite|challenge/i.test(t)) name = "invite"; else if (ERR.test(t)) name = "error"; else if (OK.test(t)) name = "success";
        let area = false; try { area = this.page && this.page.spec && t === this.page.spec.name; } catch (_) {}
        if (!area) { if (name === "friend_join") play(name, { key: "msg:" + t.slice(0, 20), within: 4000 }); else if (name === "friend_leave" || name === "reconnect") play(name, { key: "msg", within: 2500 }); else play(name); }
      } catch (_) {}
      return sm.apply(this, arguments);
    };
    const us = Game.prototype.useSelected; if (typeof us === "function") Game.prototype.useSelected = function () { try { const it = this.selectedItem && this.selectedItem(); if (it && it.def && it.def.tool) play("swing", { key: "sw", within: 260 }); } catch (_) {} return us.apply(this, arguments); };
  }
  /* footsteps: wrap the local player's update; stride-based so speed changes the rhythm; ignores teleports (door / page changes) */
  function hookPlayer() {
    if (typeof Player === "undefined" || Player.prototype.__audioHooked) return; Player.prototype.__audioHooked = true;
    const up = Player.prototype.update; let acc = 0, lx = null, ly = null, alt = 0;
    Player.prototype.update = function () {
      const r = up.apply(this, arguments);
      try {
        const g = window.game; if (g && this === g.player) {
          if (lx !== null) { const d = Math.hypot(this.x - lx, this.y - ly); if (d > 0 && d < 40) { acc += d; if (acc >= 78) { acc = 0; alt ^= 1; play("step_" + surfaceOf(g)); } } else if (d >= 40) acc = 0; }
          lx = this.x; ly = this.y;
        }
      } catch (_) {}
      return r;
    };
  }
  /* buttons everywhere share one click sound (arcade pads / cabinet buttons and the touch pad have their own sounds) */
  function hookClicks() {
    document.addEventListener("pointerdown", (e) => {
      try {
        const t = e.target && e.target.closest && e.target.closest("button, .cook-btn, .tbtn, .gcard, .inv-slot.filled, .hb-slot, .cin-chip, input[type=range], label.btn, #hint");
        if (!t) return;
        if (t.closest("#arc .pad, #arc .hole, #arc .rx, #mv-act, #mv-use, #mv-joy, #aud-panel input")) return;
        if (t.id === "hint") { play("interact", { key: "hint", within: 200 }); return; }
        if (t.classList.contains("hb-slot")) { play("ui_select"); return; }
        if (t.closest("#arc, #ngx")) { play("menu_select"); return; }
        play("ui_click");
      } catch (_) {}
    }, true);
    window.addEventListener("keydown", (e) => { try { if (e.repeat) return; const g = window.game; if (!g || g.uiMode || document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return; if (e.key && e.key.toLowerCase() === "e" && g.nearest) play("interact", { key: "e", within: 180 }); else if (/^[0-9]$/.test(e.key || "") ) play("ui_select"); } catch (_) {} }, true);
  }
  /* arcade + Neo Geo: read-only observers on the existing DOM (class changes), no changes to cinema/arcade.js */
  let arcObs = null, arcEl = null;
  function attachArcade() {
    const el = document.getElementById("arc"); if (!el || el === arcEl) return; arcEl = el; if (arcObs) arcObs.disconnect();
    arcObs = new MutationObserver((list) => {
      try {
        for (const m of list) {
          if (m.type === "attributes" && m.attributeName === "class") {
            const t = m.target, had = new Set((m.oldValue || "").split(/\s+/)), has = (c) => t.classList.contains(c) && !had.has(c);
            if (t.classList.contains("hole")) { if (has("hit")) play("whack_hit"); else if (has("up")) play("mole_pop"); }
            else if (t.classList.contains("pad")) { if (has("lit")) play("mem_" + (t.dataset.p || 0), { key: "p" + t.dataset.p + ":" + Math.floor(performance.now() / 60), within: 50 }); }
            else if (t.classList.contains("rx")) { if (has("go")) play("go"); else if (has("late")) play("false_start"); }
            else if (t.matches && t.matches(".dots i") && has("on")) play("result_ding");
          } else if (m.type === "childList") {
            for (const n of m.addedNodes) {
              if (n.nodeType !== 1) continue;
              const b = n.classList && n.classList.contains("banner") ? n : n.querySelector && n.querySelector(".banner");
              if (b) { const win = b.classList.contains("win"), lose = b.classList.contains("lose"); play(win && /WIN/i.test(b.textContent) ? "win" : lose ? "lose" : /DRAW/i.test(b.textContent) ? "draw" : win ? "win" : "result_ding", { key: "banner", within: 1200 }); }
            }
            if (m.target.classList && m.target.classList.contains("count")) { const tx = (m.target.textContent || "").trim(); if (/^[1-9]/.test(tx)) play("tick", { key: tx, within: 700 }); }
          } else if (m.type === "characterData") { const p = m.target.parentElement; if (p && p.classList && p.classList.contains("count") && /^[1-9]/.test((p.textContent || "").trim())) play("tick", { key: p.textContent.trim(), within: 700 }); }
        }
      } catch (_) {}
    });
    arcObs.observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"], attributeOldValue: true, characterData: true });
  }
  let toastObs = null;
  function hookToasts() {                                         // co-op / chat toasts made by the cinema UI (their exact class names are unknown here, so match loosely)
    if (toastObs) return;
    toastObs = new MutationObserver((list) => { try { for (const m of list) for (const n of m.addedNodes) { if (n.nodeType !== 1) continue; const c = n.className && String(n.className); if (c && /(^|\s)(cin-toast|chat-toast)(\s|$)/.test(c)) play("message", { key: "toast:" + (n.textContent || "").slice(0, 24), within: 2500 }); } } catch (_) {} });
    toastObs.observe(document.body, { childList: true, subtree: true });
  }

  let tickCount = 0;
  const tick = safe(function () {
    const g = window.game; if (!g || !g.player || !ac) return;
    tickCount++;
    hookCinema(); if (hasCinema()) attachLink(Cinema.link); attachArcade();
    const body = document.body.classList, arc = body.contains("arc-open"), ngx = body.contains("ngx-open");
    if (arc !== prev.arc) { play(arc ? "arcade_on" : "arcade_off"); prev.arc = arc; }
    if (ngx !== prev.ngx) { play(ngx ? "arcade_on" : "arcade_off"); prev.ngx = ngx; }
    // panels / inventory
    const ui = g.uiMode || null;
    if (ui !== prev.ui) { if (ui === "inventory") play("bag_open"); else if (!ui && prev.ui === "inventory") play("bag_close"); else if (ui && ui !== "dialog" && ui !== "confirm") play("panel_open"); else if (!ui && prev.ui && prev.ui !== "dialog") play("panel_close"); else if (ui === "dialog") play("dialog"); prev.ui = ui; }
    // doors / area changes (the game fades the screen for each)
    const f = g.fade || null, ph = f ? f.phase : null;
    if (f && !prev.fade) play(f.door ? "door_open" : f.sleep ? "transition" : "transition", { key: "fade", within: 500 });
    if (f && prev.phase === "out" && ph === "in" && f.door) play("door_close", { key: "fadeb", within: 500 });
    prev.fade = f; prev.phase = ph;
    if (g.dayIndex !== prev.day) { if (prev.day !== null && g.dayIndex > prev.day) play("morning", { key: "day" + g.dayIndex, within: 5000 }); prev.day = g.dayIndex; }
    // music scene (needs to be stable for 2 ticks so fades don't flutter)
    const sc = sceneOf(g);
    if (sc !== wantScene) { wantScene = sc; sceneSince = tickCount; }
    if (tickCount - sceneSince >= 2 && running()) {
      if (prev.scene !== wantScene) {
        if (prev.scene === "cinema") play("cinema_exit", { key: "cx", within: 1500 }); if (wantScene === "cinema") play("cinema_enter", { key: "ce", within: 1500 });
        prev.scene = wantScene;
      }
      setScene(wantScene);
    }
    // ducking: no music/ambience while a cinema video plays; music dips while an arcade game is open (effects stay clear)
    const cp = cinemaPlaying(); prev.cinePlay = cp;
    const t = ac.currentTime, d = (p, v, tc) => p.setTargetAtTime(v, t, tc);
    d(G.musicDuck.gain, cp ? 0 : arc || ngx ? 0.45 : 1, cp ? 0.6 : 0.8); d(G.ambDuck.gain, cp ? 0 : 1, 0.6); d(G.sfxDuck.gain, cp ? 0.55 : 1, 0.3);
    // ambience
    if (running()) { ambInit(); const out = !g.inside, band = timeBand(g), rain = typeof g.raining === "boolean" ? g.raining : false;
      setAmbience({ outdoor: out ? 1 : 0.15, rain: rain ? (out ? 1 : 0.3) : 0, hum: g.inside && g.inside.isGaming ? 1 : g.inside && !g.inside.isCinema ? 0.25 : 0, birds: out && (band === "morning" || band === "day") && !rain, crickets: out && (band === "evening" || band === "night") && !rain }); }
  });
  let tickTimer = 0;

  /* ---- leaving the page: nothing may keep playing in a background tab ---- */
  function onVis() {
    hidden = document.hidden; if (!ac) return;
    if (hidden) { ac.suspend().catch(() => {}); } else if (!S.muted) { ac.resume().catch(() => {}); if (ac.state !== "running") armGesture(); }
  }

  /* ============ 8. settings panel ============ */
  let panel = null, btn = null;
  const CH = [["master", "Master volume"], ["music", "Music"], ["sfx", "Sound effects"], ["ambient", "Ambient sounds"]];
  function buildPanel() {
    if (panel) return;
    btn = document.createElement("button"); btn.id = "aud-btn"; btn.type = "button"; btn.title = "Sound settings"; btn.setAttribute("aria-label", "Sound settings"); btn.setAttribute("aria-haspopup", "dialog"); btn.innerHTML = '<span class="ic">🔊</span>';
    panel = document.createElement("div"); panel.id = "aud-panel"; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Sound settings"); panel.hidden = true;
    panel.innerHTML = `<div class="aud-head"><h2>Sound</h2><button type="button" class="aud-x" aria-label="Close sound settings">✕</button></div>
      <button type="button" class="aud-mute" id="aud-mute" aria-pressed="false"><span class="ic">🔊</span><span class="lb">Sound on</span></button>
      ${CH.map(([k, n]) => `<label class="aud-row"><span class="aud-n">${n}</span><input type="range" min="0" max="100" step="1" data-ch="${k}" aria-label="${n}"><output data-o="${k}"></output></label>`).join("")}
      <div class="aud-note" id="aud-note">Music and effects are separate. Settings are saved on this device.</div>
      <div class="aud-state" id="aud-state"></div>`;
    document.body.append(btn, panel);
    const upd = () => {
      for (const [k] of CH) { const i = panel.querySelector(`input[data-ch=${k}]`), o = panel.querySelector(`output[data-o=${k}]`); i.value = Math.round(S[k] * 100); o.textContent = Math.round(S[k] * 100) + "%"; i.style.setProperty("--v", S[k] * 100 + "%"); i.disabled = false; i.parentElement.classList.toggle("off", S.muted); }
      const m = panel.querySelector("#aud-mute"); m.setAttribute("aria-pressed", String(S.muted)); m.classList.toggle("on", S.muted); m.querySelector(".ic").textContent = S.muted ? "🔇" : "🔊"; m.querySelector(".lb").textContent = S.muted ? "Sound off — tap to unmute" : "Sound on";
      btn.querySelector(".ic").textContent = S.muted ? "🔇" : "🔊";
      const st = panel.querySelector("#aud-state"); st.textContent = S.muted ? "Muted" : ac && ac.state === "running" ? "" : "Tap or press any key to start sound"; st.hidden = !st.textContent;
    };
    panel.addEventListener("input", (e) => { const i = e.target.closest && e.target.closest("input[data-ch]"); if (!i) return; const k = i.dataset.ch; S[k] = +i.value / 100; upd(); applySettings(); save(); if (k === "sfx" || k === "master") play("ui_select", { key: "sl", within: 120 }); });
    panel.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Escape") closePanel(); });   // arrows on a slider must not walk the character
    panel.addEventListener("keyup", (e) => e.stopPropagation());
    panel.addEventListener("pointerdown", (e) => e.stopPropagation());
    panel.querySelector(".aud-x").addEventListener("click", closePanel);
    panel.querySelector("#aud-mute").addEventListener("click", () => setMuted(!S.muted));
    btn.addEventListener("click", (e) => { e.stopPropagation(); togglePanel(); });
    panel._upd = upd; upd();
    document.addEventListener("pointerdown", (e) => { if (!panel.hidden && !panel.contains(e.target) && !btn.contains(e.target) && !(e.target.closest && e.target.closest("#mv-pop-more, #mv-more"))) closePanel(); }, true);
  }
  function openPanel() { buildPanel(); panel._upd(); panel.hidden = false; btn.classList.add("open"); play("panel_open"); const i = panel.querySelector("input"); if (i && !(window.MV_MOBILE)) try { i.focus({ preventScroll: true }); } catch (_) {} }
  function closePanel() { if (!panel || panel.hidden) return; panel.hidden = true; btn.classList.remove("open"); play("panel_close"); if (document.activeElement && panel.contains(document.activeElement)) document.activeElement.blur(); }
  function togglePanel() { buildPanel(); panel.hidden ? openPanel() : closePanel(); }
  function setMuted(m) {
    S.muted = !!m; save(); if (panel) panel._upd();
    if (!ac) { if (!S.muted) armGesture(); return; }
    applySettings(0.05);
    if (S.muted) setTimeout(() => { if (S.muted && ac && !hidden) ac.suspend().catch(() => {}); }, 400);          // muted = no CPU
    else { ac.resume().catch(() => {}); if (ac.state !== "running") armGesture(); play("ui_select"); }
  }
  function setVolume(ch, v) { if (!(ch in S) || ch === "muted") return; S[ch] = Math.min(1, Math.max(0, +v || 0)); save(); applySettings(); if (panel) panel._upd(); }

  /* ============ 9. boot + public API ============ */
  const boot = safe(function () {
    if (ready) return; ready = true;
    hookGame(); hookPlayer(); hookClicks(); hookToasts();
    document.addEventListener("visibilitychange", onVis); window.addEventListener("pagehide", () => { try { ac && ac.suspend(); } catch (_) {} }); window.addEventListener("pageshow", onVis);
    armGesture(); buildPanel(); tickTimer = setInterval(tick, 100);
    window.addEventListener("keydown", (e) => { if (e.key === "Escape" && panel && !panel.hidden) closePanel(); }, true);
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();

  /* test support: render one track offline (same code as live), return stats */
  async function renderTrack(name, seconds = 24, sr = 22050) {
    const def = TRACKS[name], oc = new OfflineAudioContext(2, Math.floor(seconds * sr), sr), g = buildGraph(oc, oc.destination);
    g.master.gain.value = 1; g.music.gain.value = 1; g.sfx.gain.value = 1; g.musicDuck.gain.value = 1; const V = Synth(oc, g, g.music, g.verbIn), spb = 60 / def.bpm;
    const seed = 12345; for (let b = 0, t = 0.1; t < seconds; b++, t += spb * 4) scheduleBar(V, def, name, b, t, rngOf(seed + b * 977));
    const buf = await oc.startRendering(), d = buf.getChannelData(0); let peak = 0, sum = 0, nan = 0, zc = 0, last = 0;
    for (let i = 0; i < d.length; i++) { const x = d[i]; if (!isFinite(x)) { nan++; continue; } const a = Math.abs(x); if (a > peak) peak = a; sum += x * x; if ((x > 0) !== (last > 0)) zc++; last = x; }
    const rms = Math.sqrt(sum / d.length), q = Math.floor(d.length / 4), seg = [0, 1, 2, 3].map((k) => { let s = 0; for (let i = k * q; i < (k + 1) * q; i++) s += d[i] * d[i]; return Math.sqrt(s / q); });
    return { name, seconds, peak, rms, nan, zeroCrossRate: zc / seconds, segmentsRms: seg };
  }
  async function renderSfx(name, seconds = 1.2, sr = 22050) {
    const oc = new OfflineAudioContext(1, Math.floor(seconds * sr), sr), g = buildGraph(oc, oc.destination); g.master.gain.value = 1; g.sfx.gain.value = 1;
    const V = Synth(oc, g, g.sfx, null); SFX[name](V, 0.01); const buf = await oc.startRendering(), d = buf.getChannelData(0); let peak = 0, sum = 0, nan = 0; for (const x of d) { if (!isFinite(x)) nan++; else { const a = Math.abs(x); if (a > peak) peak = a; sum += x * x; } }
    return { name, peak, rms: Math.sqrt(sum / d.length), nan };
  }

  return {
    play: safe(play), setVolume: safe(setVolume), setMuted: safe(setMuted), toggleMute() { setMuted(!S.muted); }, openPanel: safe(openPanel), closePanel: safe(closePanel), togglePanel: safe(togglePanel), unlock: onGesture,
    get settings() { return Object.assign({}, S); }, tracks: Object.keys(TRACKS), sfxNames: Object.keys(SFX),
    _state() { return { ctx: ac && ac.state, unlocked, scene: current && current.name, want: wantScene, active: current ? 1 : 0, fading: fading.size, musicGain: G && +G.music.gain.value.toFixed(4), sfxGain: G && +G.sfx.gain.value.toFixed(4), ambGain: G && +G.amb.gain.value.toFixed(4), masterGain: G && +G.master.gain.value.toFixed(4), duck: G && +G.musicDuck.gain.value.toFixed(3), trackGain: current ? +current.out.gain.value.toFixed(3) : null, wetGain: current ? +current.wet.gain.value.toFixed(3) : null, cinemaPlaying: prev.cinePlay }; },
    _log: { on(v) { logOn = !!v; }, get() { return log.slice(); }, clear() { log.length = 0; } }, _renderTrack: renderTrack, _renderSfx: renderSfx, _tick: tick,
  };
})();
