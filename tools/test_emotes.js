// Unit tests for the pure emote logic (cinema/emote_core.js) and the generated art numbers (cinema/emote_art.js).  Run: node tools/test_emotes.js
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert");
const root = path.dirname(__dirname);
const C = require(path.join(root, "cinema", "emote_core.js"));
const ART = vm.runInNewContext(fs.readFileSync(path.join(root, "cinema", "emote_art.js"), "utf8") + "; EMOTE_ART");
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log("PASS", name); } catch (e) { fail++; console.log("FAIL", name, "-", e.message); } };
const F = (cx, cy = 300) => ({ gender: "female", cx, cy }), M = (cx, cy = 300) => ({ gender: "male", cx, cy });
const ok = { connected: true, sameRoom: true, busy: false, active: false };

t("kiss: man and woman close together may start", () => { assert(C.check("kiss", F(100), M(150), ok).ok); assert(C.check("kiss", M(150), F(100), ok).ok); });
t("kiss: too far is refused with a message", () => { const r = C.check("kiss", F(100), M(300), ok); assert(!r.ok && r.why === "far" && r.msg); });
t("range edge: 85px ok, 86px not", () => { assert(C.check("kiss", F(0), M(85), ok).ok); assert(!C.check("kiss", F(0), M(86), ok).ok); });
t("distance uses both axes", () => { assert(!C.check("kiss", F(0, 0), M(70, 60), ok).ok); assert(C.check("kiss", F(0, 0), M(50, 50), ok).ok); });
t("same gender pair can't use the couple emotes", () => { assert.strictEqual(C.check("kiss", F(0), F(40), ok).why, "pair"); assert.strictEqual(C.check("kiss", M(0), M(40), ok).why, "pair"); });
t("slap: only the man starts it", () => { assert(C.check("slap", M(150), F(100), ok).ok); assert.strictEqual(C.check("slap", F(100), M(150), ok).why, "actor"); });
t("not connected / other room / busy / mid-emote", () => {
  assert(C.check("kiss", F(0), null, { ...ok, connected: false }).silent);
  assert.strictEqual(C.check("kiss", F(0), M(40), { ...ok, sameRoom: false }).why, "room");
  assert.strictEqual(C.check("kiss", F(0), M(40), { ...ok, busy: true }).why, "busy");
  assert(C.check("kiss", F(0), M(40), { ...ok, active: true }).silent);
});
t("unknown emote kind is refused", () => assert(!C.check("punch", F(0), M(40), ok).ok));
t("flip: man left of woman mirrors the art", () => { assert.strictEqual(C.chooseFlip(200, 100), true); assert.strictEqual(C.chooseFlip(100, 200), false); });

for (const kind of ["kiss", "slap", "hug", "grab"]) {
  const A = ART[kind], k = 96 / A.refH;
  t(`${kind}: art numbers are sane`, () => {
    assert.strictEqual(A.t.length, A.n); assert.strictEqual(A.feet.length, A.n); assert.strictEqual(A.t[0], 0);
    assert(A.t.every((v, i) => i === 0 || v > A.t[i - 1]), "times strictly increase");
    assert(A.dur > A.t[A.n - 1] && A.dur < 8, "duration " + A.dur);
    assert(A.refH > 200 && A.W > 100 && A.H > 200);
    for (let i = 0; i < A.n; i++) assert(fs.existsSync(path.join(root, "assets", "emote", `${kind}_${i}.png`)), "missing frame " + i);
  });
  t(`${kind}: standing spots are ~50px apart, woman left of man`, () => {
    const L = C.layout(A, k, { x: 500, y: 400 }, false), gap = L.m0.x - L.f0.x;
    assert(gap > 40 && gap < 80, "gap " + gap); assert(L.f0.x < L.m0.x && L.f1.x < L.m1.x);
    const Lf = C.layout(A, k, { x: 500, y: 400 }, true); assert(Lf.f0.x > Lf.m0.x, "flipped puts the woman on the right");
    assert(Math.abs((Lf.f0.x + Lf.m0.x) / 2 - 500) < 0.01, "anchor stays the midpoint");
  });
  t(`${kind}: timeline phases, fades and end`, () => {
    assert.strictEqual(C.timeline(A, -0.1).phase, "wait");
    assert.strictEqual(C.timeline(A, C.GLIDE_S / 2).phase, "glide");
    const a = C.timeline(A, C.GLIDE_S + 0.001); assert(a.phase === "play" && a.duoA < 0.1 && a.realA > 0.9 && a.frame === 0);
    const m = C.timeline(A, C.GLIDE_S + A.dur / 2); assert(m.duoA === 1 && m.realA === 0);
    const e = C.timeline(A, C.GLIDE_S + A.dur - 0.01); assert(e.duoA < 0.2 && e.atEnd && e.frame === A.n - 1);
    assert.strictEqual(C.timeline(A, C.GLIDE_S + A.dur + 0.01).phase, "done");
  });
}
t("frameAt picks the latest frame not after t", () => { const ts = [0, 1, 2, 4]; assert.deepStrictEqual([-1, 0, 0.9, 1, 3.9, 4, 99].map((x) => C.frameAt(ts, x)), [0, 0, 0, 1, 2, 3, 3]); });
t("marks: kiss hearts window + slap impact inside the clip", () => { assert(ART.kiss.marks.kissFrom > 0 && ART.kiss.marks.kissTo < ART.kiss.dur); assert(ART.slap.marks.impact > 0 && ART.slap.marks.impact < ART.slap.dur); });

t("pickAnchor: free room keeps the midpoint", () => { const a = C.pickAnchor(ART.kiss, 96 / ART.kiss.refH, false, { x: 400, y: 300 }, () => true); assert.deepStrictEqual(a, { x: 400, y: 300 }); });
t("pickAnchor: shifts away from a wall", () => {
  const k = 96 / ART.kiss.refH, wall = { x: 0, y: 0, w: 395, h: 9999 };
  const free = (x, y, w, h) => !(x < wall.x + wall.w && x + w > wall.x && y < wall.y + wall.h && y + h > wall.y);
  const a = C.pickAnchor(ART.kiss, k, false, { x: 400, y: 300 }, free); assert(a && a.x > 400, JSON.stringify(a));
});
t("pickAnchor: no room at all -> null", () => assert.strictEqual(C.pickAnchor(ART.slap, 96 / ART.slap.refH, false, { x: 400, y: 300 }, () => false), null));

t("validateMsg accepts good go / no / stop", () => {
  assert.deepStrictEqual(C.validateMsg({ a: "go", k: "kiss", id: "abc12345", lead: 300, ax: 10.5, ay: 20, fl: 1 }), { a: "go", k: "kiss", id: "abc12345", lead: 300, ax: 10.5, ay: 20, fl: true });
  assert.strictEqual(C.validateMsg({ a: "no", id: "abc12345", why: "far" }).why, "far"); assert.strictEqual(C.validateMsg({ a: "stop", id: "abc12345" }).a, "stop");
});
t("validateMsg rejects junk", () => {
  const good = { a: "go", k: "slap", id: "abc12345", lead: 300, ax: 1, ay: 2, fl: false };
  for (const bad of [null, 5, {}, { ...good, k: "punch" }, { ...good, id: "x" }, { ...good, id: "../../etc" }, { ...good, ax: "1" }, { ...good, ax: NaN }, { ...good, ay: 1e9 }, { ...good, lead: -1 }, { ...good, lead: 99999 }, { ...good, a: "teleport" }]) assert.strictEqual(C.validateMsg(bad), null, JSON.stringify(bad));
});
t("tie-break is symmetric: exactly one side wins", () => { for (const [a, b] of [["aaa11111", "bbb22222"], ["zzz", "aaa"]]) assert.notStrictEqual(C.winsTie(a, b), C.winsTie(b, a)); });
t("final facing: slap ends back-to-camera woman / front man; kiss faces each other and mirrors", () => {
  assert.deepStrictEqual(C.FINAL.slap(false), { female: "up", male: "down" });
  assert.deepStrictEqual(C.FINAL.kiss(false), { female: "right", male: "left" }); assert.deepStrictEqual(C.FINAL.kiss(true), { female: "left", male: "right" });
});
// ---- hug / knee / grab
t("hug + grab are in the key table: U, G; grab is man-only and needs a kneeling woman", () => {
  assert.strictEqual(C.KINDS.hug.key, "u"); assert.strictEqual(C.KINDS.grab.key, "g"); assert.strictEqual(C.SOLO.kneel.key, "j");
  assert(C.check("hug", F(100), M(150), ok).ok && C.check("hug", M(150), F(100), ok).ok);
  const kn = { ...ok, partnerKneeling: true, partnerKneelHold: true };
  assert(C.check("grab", M(150), F(100), kn).ok);
  assert.strictEqual(C.check("grab", M(150), F(100), ok).why, "notkneel");
  assert.strictEqual(C.check("grab", M(150), F(100), { ...ok, partnerKneeling: true }).why, "notready");
  assert.strictEqual(C.check("grab", F(100), M(150), kn).why, "actor");
  assert.strictEqual(C.check("grab", M(300), F(100), kn).why, "far");
});
t("while a woman kneels, the other pair emotes are refused", () => {
  for (const k of ["kiss", "slap", "hug"]) assert.strictEqual(C.check(k, M(150), F(100), { ...ok, partnerKneeling: true }).why, "kneeling", k);
  assert.strictEqual(C.check("kiss", F(100), M(150), { ...ok, meKneeling: true }).why, "kneeling");
});
t("only the woman can kneel; not while busy / already kneeling", () => {
  assert(C.checkKneel({ gender: "female" }, { busy: false }).ok);
  assert.strictEqual(C.checkKneel({ gender: "male" }, { busy: false }).why, "actor");
  assert.strictEqual(C.checkKneel({ gender: "female" }, { busy: true }).why, "busy");
  assert(C.checkKneel({ gender: "female" }, { meKneeling: true }).silent);
});
const KN = ART.knee;
t("knee art: solo clip numbers are sane; first frames are the drop to the knees", () => {
  assert(KN.solo && KN.n > 20 && KN.drop >= 3 && KN.drop < KN.n && KN.upDur > 0.1 && KN.upDur < 0.6 && KN.dur > 2 && KN.dur < 6);
  assert(KN.t.every((v, i) => i === 0 || v > KN.t[i - 1])); assert.strictEqual(KN.refH, ART.grab.refH);
  for (let i = 0; i < KN.n; i++) assert(fs.existsSync(path.join(root, "assets", "emote", `knee_${i}.png`)));
});
t("kneel timeline: drops in, holds, 5 s wait before 'stand up', stands (frames backwards), then is gone", () => {
  assert.strictEqual(C.kneelTimeline(KN, 0.01, null).phase, "in"); assert(C.kneelTimeline(KN, 0.01, null).a < 0.2);
  const h = C.kneelTimeline(KN, KN.dur + 0.01, null); assert(h.phase === "hold" && h.frame === KN.n - 1 && h.a === 1 && !h.canStand && h.left > 4.9);
  assert(!C.kneelTimeline(KN, KN.dur + 4.9, null).canStand); assert(C.kneelTimeline(KN, KN.dur + 5.0, null).canStand);
  assert.strictEqual(C.KNEEL_WAIT_S, 5);
  const up0 = C.kneelTimeline(KN, 10, 10), up1 = C.kneelTimeline(KN, 10 + KN.upDur * 0.99, 10);
  assert(up0.phase === "up" && up0.frame === KN.drop - 1 && up1.frame <= 1 && up1.a === 1);
  const fade = C.kneelTimeline(KN, 10 + KN.upDur + C.FADE_S / 2, 10); assert(fade.phase === "up" && fade.a > 0.3 && fade.a < 0.7);
  assert.strictEqual(C.kneelTimeline(KN, 10 + KN.upDur + C.FADE_S + 0.01, 10).phase, "gone");
});
t("grab art: she never moves (fixedFemale) and the clip is un-flipped (man stays on her right)", () => {
  assert.strictEqual(ART.grab.fixedFemale, true); assert(ART.grab.slots.f0 < 0 && ART.grab.slots.m0 > 0);
  assert.deepStrictEqual(C.FINAL.grab(false), { female: "right", male: "left" });
});
t("grab layout: her spot is exactly where she kneels", () => {
  const k = 96 / ART.grab.refH, w = { x: 300 }, fl = false, a = { x: w.x - ART.grab.slots.f0 * k, y: 400 }, L = C.layout(ART.grab, k, a, fl);
  assert(Math.abs(L.f0.x - 300) < 1e-9 && L.m0.x > 300 && L.m0.x - 300 > 40 && L.m0.x - 300 < 70);
  const Lf = C.layout(ART.grab, k, { x: w.x + ART.grab.slots.f0 * k, y: 400 }, true); assert(Math.abs(Lf.f0.x - 300) < 1e-9 && Lf.m0.x < 300);
});
t("per-clip fade: hug/grab crossfade longer than the default", () => { assert(ART.hug.fade > C.FADE_S && ART.grab.fade > C.FADE_S); const e = C.timeline(ART.hug, C.GLIDE_S + ART.hug.dur - 0.2); assert(e.duoA > 0.3 && e.duoA < 0.7, "" + e.duoA); });
t("validateMsg: knee / up", () => {
  assert.deepStrictEqual(C.validateMsg({ a: "knee", id: "abc12345", fl: 1, el: 2.5 }), { a: "knee", id: "abc12345", fl: true, el: 2.5 });
  assert.strictEqual(C.validateMsg({ a: "up", id: "abc12345" }).a, "up");
  for (const bad of [{ a: "knee", id: "abc12345", el: -1 }, { a: "knee", id: "abc12345", el: "1" }, { a: "knee", id: "abc12345", el: 1e9 }, { a: "knee", id: "x", el: 1 }]) assert.strictEqual(C.validateMsg(bad), null, JSON.stringify(bad));
  assert(C.validateMsg({ a: "go", k: "hug", id: "abc12345", lead: 300, ax: 1, ay: 2 }) && C.validateMsg({ a: "go", k: "grab", id: "abc12345", lead: 300, ax: 1, ay: 2 }));
});
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
