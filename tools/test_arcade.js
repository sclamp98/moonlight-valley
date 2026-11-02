// Unit tests for cinema/arcade_core.js (pure rules: schedules, scoring, judging, validation).  Run: node tools/test_arcade.js
const A = require("../cinema/arcade_core.js"); let pass = 0, fail = 0;
const t = (n, ok, x) => { ok ? pass++ : (fail++, console.log("FAIL", n, x || "")); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// determinism: same seed -> same everything; different seed -> different
t("whack schedule deterministic", eq(A.whackSchedule(123), A.whackSchedule(123)) && !eq(A.whackSchedule(123), A.whackSchedule(124)));
const ws = A.whackSchedule(777);
t("whack: 25-45 moles in 30 s", ws.length >= 25 && ws.length <= 45, ws.length);
t("whack: moles never overlap and stay inside the round", ws.every((m, i) => (i === 0 || m.t >= ws[i - 1].t + ws[i - 1].dur) && m.t + m.dur <= A.WHACK.MS + 100 && m.hole >= 0 && m.hole < 9));
t("whack: never the same hole twice in a row", ws.every((m, i) => i === 0 || m.hole !== ws[i - 1].hole));
t("memory sequence deterministic, prefix-stable, only 0-3", eq(A.memorySequence(5, 8), A.memorySequence(5, 8)) && eq(A.memorySequence(5, 8).slice(0, 4), A.memorySequence(5, 4)) && A.memorySequence(9, 40).every((x) => x >= 0 && x <= 3));
t("memory: level 1 = 3 lights, grows by one", A.memoryLen(1) === 3 && A.memoryLen(5) === 7);
t("memory score = 10*level summed", A.memoryScore(0) === 0 && A.memoryScore(3) === 60 && A.memoryScore(4) === 100);
const tl = A.reactionTimeline(42);
t("reaction: 5 rounds, GO after 1.5-4.5 s, rounds don't overlap", tl.length === 5 && tl.every((r, i) => r.go - r.start >= 1500 && r.go - r.start <= 4500 && (i === 0 || r.start >= tl[i - 1].end)));
t("reaction timeline deterministic", eq(A.reactionTimeline(42), A.reactionTimeline(42)) && !eq(A.reactionTimeline(42), A.reactionTimeline(43)));
// validation
const seed = 31337, n = A.whackSchedule(seed).length;
t("whack: valid", !!A.validateResult("whack", { h: 5 }, seed) && !!A.validateResult("whack", { h: 0 }, seed) && !!A.validateResult("whack", { h: n }, seed));
t("whack: rejects more hits than moles, negatives, floats, junk", [n + 1, -1, 2.5, "9", null, NaN].every((h) => !A.validateResult("whack", { h }, seed)));
t("memory: score must match level", !!A.validateResult("memory", { lv: 3, s: 60 }, 1) && !A.validateResult("memory", { lv: 3, s: 999 }, 1) && !A.validateResult("memory", { lv: 41, s: A.memoryScore(41) }, 1) && !A.validateResult("memory", { lv: -1, s: 0 }, 1));
const good = { t: [250, 300, 1000, 280, 260], f: [0, 0, 1, 0, 0] };
const gn = A.validateResult("reaction", good, 1);
t("reaction: valid, avg and best computed from times", gn && gn.avg === (250 + 300 + 1000 + 280 + 260) / 5 && gn.best === 250);
t("reaction: rejects impossible times (<100 ms), wrong round count, unflagged penalty, flagged non-penalty", !A.validateResult("reaction", { t: [50, 300, 300, 300, 300], f: [0, 0, 0, 0, 0] }, 1) && !A.validateResult("reaction", { t: [250], f: [0] }, 1) && !A.validateResult("reaction", { t: [250, 300, 300, 300, 1200], f: [0, 0, 0, 0, 0] }, 1) && !A.validateResult("reaction", { t: [250, 300, 300, 300, 500], f: [0, 0, 0, 0, 1] }, 1));
// judging
const W = (h) => A.validateResult("whack", { h }, seed), M = (lv) => A.validateResult("memory", { lv, s: A.memoryScore(lv) }, 1), R = (ms, f) => A.validateResult("reaction", { t: ms, f: f || [0, 0, 0, 0, 0] }, 1);
t("whack: more hits wins, symmetric", A.judge("whack", W(9), W(4)) === "a" && A.judge("whack", W(4), W(9)) === "b" && A.judge("whack", W(7), W(7)) === "draw");
t("memory: higher level wins, same level = draw", A.judge("memory", M(5), M(2)) === "a" && A.judge("memory", M(2), M(5)) === "b" && A.judge("memory", M(0), M(0)) === "draw" && A.judge("memory", M(4), M(4)) === "draw");
t("reaction: LOWER average wins", A.judge("reaction", R([200, 200, 200, 200, 200]), R([300, 300, 300, 300, 300])) === "a" && A.judge("reaction", R([300, 300, 300, 300, 300]), R([200, 200, 200, 200, 200])) === "b");
t("reaction: equal totals = draw (even with different spreads)", A.judge("reaction", R([200, 400, 300, 300, 300]), R([300, 300, 300, 300, 300])) === "draw");
t("reaction: a false start (1000 ms) costs you the round", A.judge("reaction", R([1000, 200, 200, 200, 200], [1, 0, 0, 0, 0]), R([300, 300, 300, 300, 300])) === "b");
t("reaction: both penalised every round = draw", A.judge("reaction", R([1000, 1000, 1000, 1000, 1000], [1, 1, 1, 1, 1]), R([1000, 1000, 1000, 1000, 1000], [1, 1, 1, 1, 1])) === "draw");
t("judge is symmetric (both clients get the same winner)", ["whack", "memory", "reaction"].every((g) => { const a = g === "whack" ? W(6) : g === "memory" ? M(3) : R([220, 230, 240, 250, 260]), b = g === "whack" ? W(8) : g === "memory" ? M(6) : R([300, 310, 320, 330, 340]); const x = A.judge(g, a, b), y = A.judge(g, b, a); return (x === "a" && y === "b") || (x === "b" && y === "a") || (x === "draw" && y === "draw"); }));
// standings
const s1 = A.standings("whack", 5, 3), s2 = A.standings("reaction", 250, 300), s3 = A.standings("whack", 4, 4), s4 = A.standings("memory", 30, null);
t("standings: higher score leads (whack)", s1.me.leading && s1.me.rank === 1 && s1.them.rank === 2);
t("standings: lower avg leads (reaction)", s2.me.leading && s2.them.rank === 2);
t("standings: tie shown as tied, nobody leads", s3.me.tied && s3.them.tied && !s3.me.leading && !s3.them.leading);
t("standings: only one player has a value yet", s4.me.leading && s4.them.rank === 2);
// messages
const ok = (m) => !!A.validateMsg(m);
t("msg: valid challenge/go/sc/rs/rm/bye", ok({ a: "ch", m: "abc_0", g: "whack" }) && ok({ a: "go", m: "abc_0", g: "memory", seed: 5, at: Date.now(), first: "p1", n: 0 }) && ok({ a: "sc", m: "abc_0", s: 3 }) && ok({ a: "rs", m: "abc_0", h: 3 }) && ok({ a: "rm", m: "abc_0" }) && ok({ a: "bye", m: "abc_0" }));
t("msg: rejects junk (bad action, bad game, bad id, bad seed, negative/huge scores, object ids)", [null, 5, {}, { a: "zz", m: "x" }, { a: "ch", m: "x", g: "chess" }, { a: "ch", m: "bad id!", g: "whack" }, { a: "go", m: "x_0", g: "whack", seed: 0, at: 1, first: "p", n: 0 }, { a: "sc", m: "x_0", s: -1 }, { a: "sc", m: "x_0", s: 1e9 }, { a: "ch", m: { x: 1 }, g: "whack" }, { a: "sc", m: "x_0", s: 1.5 }].every((m) => !ok(m)));
console.log(pass + " passed, " + fail + " failed"); process.exit(fail ? 1 : 0);
