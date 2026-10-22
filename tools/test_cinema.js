"use strict";
/* Unit tests for the pure cinema logic (cinema/core.js). Run: node tools/test_cinema.js */
const assert = require("assert");
const C = require("../cinema/core.js");
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log("PASS " + name); } catch (e) { fail++; console.log("FAIL " + name + "\n     " + e.message); } };

const ID = "dQw4w9WgXcQ", DRIVE = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345";

t("YouTube: watch / youtu.be / embed / shorts / no-scheme / mobile links give the id", () => {
  for (const u of [`https://www.youtube.com/watch?v=${ID}`, `https://youtu.be/${ID}`, `https://www.youtube.com/embed/${ID}`, `https://youtube.com/shorts/${ID}`,
    `youtube.com/watch?v=${ID}`, `https://m.youtube.com/watch?v=${ID}&list=PL1`, `https://www.youtube-nocookie.com/embed/${ID}`, `  https://youtu.be/${ID}?si=abc  `, `https://music.youtube.com/watch?v=${ID}`]) {
    const r = C.parseYouTube(u); assert.ok(r.ok, u); assert.strictEqual(r.videoId, ID, u); assert.strictEqual(r.provider, "youtube");
    assert.strictEqual(r.url, `https://www.youtube.com/watch?v=${ID}`);
  }
});
t("YouTube: start time parsed from t= / start=", () => {
  assert.strictEqual(C.parseYouTube(`https://youtu.be/${ID}?t=90`).start, 90);
  assert.strictEqual(C.parseYouTube(`https://youtu.be/${ID}?t=1m30s`).start, 90);
  assert.strictEqual(C.parseYouTube(`https://www.youtube.com/watch?v=${ID}&t=1h2m3s`).start, 3723);
  assert.strictEqual(C.parseYouTube(`https://www.youtube.com/watch?v=${ID}&start=15`).start, 15);
  assert.strictEqual(C.parseYouTube(`https://youtu.be/${ID}?t=abc`).start, 0);
});
t("YouTube: rejects junk, other hosts, look-alike hosts, bad ids, credentials, scripts", () => {
  const bad = ["", "   ", "hello", "javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "file:///etc/passwd", "ftp://youtube.com/watch?v=" + ID,
    "https://evil.com/watch?v=" + ID, "https://youtube.com.evil.com/watch?v=" + ID, "https://notyoutube.com/watch?v=" + ID, "https://evil.com/?u=https://youtu.be/" + ID,
    "https://www.youtube.com/watch?v=short", "https://www.youtube.com/watch?v=" + ID + "AAAA", "https://www.youtube.com/watch?v=<script>al", "https://www.youtube.com/playlist?list=PL123",
    "https://www.youtube.com/@channel", "https://user:pw@youtube.com/watch?v=" + ID, "https://youtu.be/", "https://www.youtube.com/watch?v=" + ID + "\" onload=\"x", "a".repeat(400)];
  for (const u of bad) { const r = C.parseYouTube(u); assert.strictEqual(r.ok, false, JSON.stringify(u)); assert.ok(typeof r.error === "string" && r.error.length, "needs an error text: " + u); }
  assert.strictEqual(C.parseYouTube(null).ok, false); assert.strictEqual(C.parseYouTube(undefined).ok, false); assert.strictEqual(C.parseYouTube({}).ok, false);
});
t("NetMirror host recognition", () => {
  for (const u of ["https://netmirror.app/title/1", "netmirror.cc", "https://www.netmirror.top/x", "https://netmirror-tv.com"]) assert.ok(C.NETMIRROR_RE.test(C.hostOf(u)), u);
  for (const u of ["https://notnetmirror.com", "https://example.com/netmirror"]) assert.strictEqual(C.NETMIRROR_RE.test(C.hostOf(u)), false, u);
  assert.strictEqual(C.NETMIRROR_RE.test(C.hostOf("https://example.com")), false);
});

const good = () => ({ sessionId: "s1abc", by: "peerA", cmd: "play", provider: "youtube", videoId: ID, start: 0, playback: "playing", position: 12.5, ts: 1000, rate: 1, rev: 3, status: "active" });
t("validateState accepts a good state and normalises numbers", () => {
  const s = C.validateState({ ...good(), position: 1e12, rate: 1.9 }); assert.ok(s); assert.strictEqual(s.position, C.SYNC.MAX_POSITION_S); assert.strictEqual(s.rate, 2);
});
t("validateState rejects malformed / hostile states", () => {
  const cases = [null, 5, "x", [], {}, { ...good(), sessionId: "bad id!" }, { ...good(), by: "" }, { ...good(), by: "a b" }, { ...good(), provider: "netmirror" }, { ...good(), provider: "evil" }, { ...good(), videoId: "<img src=x>" },
    { ...good(), videoId: "short" }, { ...good(), playback: "exploding" }, { ...good(), status: "zombie" }, { ...good(), rev: -1 }, { ...good(), rev: 1.5 }, { ...good(), rev: "3" }, { ...good(), ts: NaN }, { ...good(), ts: "1" }];
  for (const c of cases) assert.strictEqual(C.validateState(c), null, JSON.stringify(c));
  assert.strictEqual(C.validateState({ ...good(), provider: "other", videoId: "anything" }, ["other"]).provider, "other");
  assert.strictEqual(C.validateState({ ...good(), cmd: "hack" }).cmd, "seek", "unknown command names are normalised, never passed through");
});
t("validateState: Drive ids are checked with the Drive rule, YouTube ids with the YouTube rule", () => {
  const d = { ...good(), provider: "gdrive", videoId: DRIVE };
  assert.ok(C.validateState(d, ["youtube", "gdrive"]));
  assert.strictEqual(C.validateState(d, ["youtube"]), null, "provider not enabled");
  for (const v of ["short", "has space 1234567890123", "<img src=x onerror=1>12345", "a".repeat(101), ID]) assert.strictEqual(C.validateState({ ...d, videoId: v }, ["gdrive"]), null, v);
  assert.strictEqual(C.validateState({ ...good(), videoId: DRIVE }, ["youtube", "gdrive"]), null, "a Drive-shaped id is not a YouTube id");
});
t("validateState strips unknown fields", () => { const s = C.validateState({ ...good(), evil: "<script>", __proto__: { x: 1 } }); assert.ok(!("evil" in s)); });
t("validateBeat", () => {
  assert.ok(C.validateBeat({ sessionId: "s1", by: "peerA", rev: 1, playback: "playing", position: 3, ts: 5, rate: 1, buf: true }).buf);
  for (const b of [null, {}, { sessionId: "s1", by: "p", rev: 1, playback: "nope", ts: 1 }, { sessionId: "s 1", by: "p", rev: 1, playback: "playing", ts: 1 }, { sessionId: "s1", by: "p", rev: -3, playback: "playing", ts: 1 }, { sessionId: "s1", by: "p", rev: 1, playback: "playing", ts: "x" }, { sessionId: "s1", rev: 1, playback: "playing", ts: 1 }]) assert.strictEqual(C.validateBeat(b), null);
});

t("targetPosition extrapolates only while playing (and with the rate)", () => {
  const st = { playback: "playing", position: 10, ts: 1000, rate: 1 };
  assert.strictEqual(C.targetPosition(st, 3000), 12);
  assert.strictEqual(C.targetPosition({ ...st, rate: 2 }, 3000), 14);
  assert.strictEqual(C.targetPosition({ ...st, playback: "paused" }, 99999), 10);
  assert.strictEqual(C.targetPosition({ ...st, playback: "buffering" }, 99999), 10);
  assert.strictEqual(C.targetPosition(st, 500), 10, "a clock estimate slightly behind never rewinds");
});
t("decideSeek: tolerance, cooldown, big drift, force — no constant seeking", () => {
  const S = C.SYNC, base = { current: 100, target: 100, nowMs: 100000, lastSeekMs: 0 };
  assert.strictEqual(C.decideSeek(base), false);
  assert.strictEqual(C.decideSeek({ ...base, target: 100 + S.TOLERANCE_S - 0.1 }), false, "inside tolerance");
  assert.strictEqual(C.decideSeek({ ...base, target: 100 + S.TOLERANCE_S + 0.5 }), true, "outside tolerance");
  assert.strictEqual(C.decideSeek({ ...base, target: 103, lastSeekMs: base.nowMs - 1000 }), false, "cooldown");
  assert.strictEqual(C.decideSeek({ ...base, target: 103, lastSeekMs: base.nowMs - S.COOLDOWN_MS }), true, "cooldown over");
  assert.strictEqual(C.decideSeek({ ...base, target: 150, lastSeekMs: base.nowMs - 2000 }), true, "big drift uses the short cooldown");
  assert.strictEqual(C.decideSeek({ ...base, target: 150, lastSeekMs: base.nowMs - 500 }), false);
  assert.strictEqual(C.decideSeek({ ...base, target: 100.8, force: true }), true);
  assert.strictEqual(C.decideSeek({ ...base, target: 100.2, force: true }), false);
  assert.strictEqual(C.decideSeek({ ...base, current: NaN }), false);
});
t("desiredAction: buffering is never mirrored (no pause/play toggling when one player buffers)", () => {
  const a = C.desiredAction, st = (playback, status = "active") => ({ playback, status });
  assert.strictEqual(a(st("playing"), "paused"), "play"); assert.strictEqual(a(st("playing"), "playing"), "keep"); assert.strictEqual(a(st("playing"), "buffering"), "keep");
  assert.strictEqual(a(st("paused"), "playing"), "pause"); assert.strictEqual(a(st("paused"), "paused"), "keep"); assert.strictEqual(a(st("paused"), "buffering"), "keep");
  assert.strictEqual(a(st("ended"), "playing"), "pause"); assert.strictEqual(a(st("loading"), "playing"), "pause");
  assert.strictEqual(a(st("playing", "ended"), "playing"), "stop");
});

/* ---------- Google Drive links ---------- */
t("Drive: every supported share format gives the file id", () => {
  for (const u of [`https://drive.google.com/file/d/${DRIVE}/view?usp=sharing`, `https://drive.google.com/file/d/${DRIVE}/view`, `https://drive.google.com/file/d/${DRIVE}/preview`, `https://drive.google.com/file/d/${DRIVE}/edit`,
    `https://drive.google.com/file/d/${DRIVE}`, `https://drive.google.com/file/u/0/d/${DRIVE}/view`, `https://drive.google.com/u/1/file/d/${DRIVE}/view`, `https://drive.google.com/open?id=${DRIVE}`,
    `https://drive.google.com/uc?id=${DRIVE}`, `https://drive.google.com/uc?export=download&id=${DRIVE}`, `https://drive.usercontent.google.com/download?id=${DRIVE}&export=download`,
    `https://docs.google.com/file/d/${DRIVE}/edit`, `drive.google.com/file/d/${DRIVE}/view`, `  http://drive.google.com/file/d/${DRIVE}/view  `, `https://drive.google.com/file/d/${DRIVE}/view?resourcekey=0-abc`]) {
    const r = C.parseDrive(u); assert.ok(r.ok, u); assert.strictEqual(r.videoId, DRIVE, u); assert.strictEqual(r.provider, "gdrive"); assert.strictEqual(r.start, 0);
    assert.strictEqual(r.url, `https://drive.google.com/file/d/${DRIVE}/view`);
  }
});
t("Drive: folders, Docs files, junk, look-alike hosts and bad ids are refused with a useful reason", () => {
  const msg = (u) => { const r = C.parseDrive(u); assert.strictEqual(r.ok, false, u); return r; };
  assert.ok(/folder/i.test(msg(`https://drive.google.com/drive/folders/${DRIVE}`).error)); assert.ok(/folder/i.test(msg(`https://drive.google.com/drive/u/0/folders/${DRIVE}?usp=sharing`).error));
  assert.ok(/Docs/.test(msg(`https://docs.google.com/document/d/${DRIVE}/edit`).error)); assert.ok(/Docs/.test(msg(`https://docs.google.com/spreadsheets/d/${DRIVE}/edit`).error));
  assert.strictEqual(msg("https://drive.google.com/file/d/short/view").kind, "drive"); assert.strictEqual(msg("https://drive.google.com/").kind, "drive");
  assert.strictEqual(msg(`https://drive.google.com/file/d/${DRIVE}"><script>/view`).ok, false);
  for (const u of ["", "   ", "hello", "javascript:alert(1)", "file:///x", `https://drive.google.com.evil.com/file/d/${DRIVE}/view`, `https://evil.com/?u=https://drive.google.com/file/d/${DRIVE}/view`,
    `https://notdrive.google.com/file/d/${DRIVE}/view`, `https://youtu.be/${ID}`, `https://user:pw@drive.google.com/file/d/${DRIVE}/view`, "a".repeat(500), null, undefined, {}]) assert.strictEqual(C.parseDrive(u).ok, false, String(u));
  assert.strictEqual(C.parseDrive(`https://evil.com/file/d/${DRIVE}`).kind, "host", "other hosts are not Drive's business (the provider list moves on)");
});
t("Drive and YouTube parsers never claim each other's links", () => {
  assert.strictEqual(C.parseYouTube(`https://drive.google.com/file/d/${DRIVE}/view`).ok, false); assert.strictEqual(C.parseDrive(`https://youtu.be/${ID}`).ok, false);
});

/* ---------- ordering: either player may issue commands, everyone converges ---------- */
const st = (rev, by, extra = {}) => ({ ...good(), rev, by, ...extra });
t("order / newerState: higher sequence wins, ties go to the larger sender id, identical commands are equal", () => {
  const a = st(4, "alice"), b = st(7, "bob");
  assert.ok(C.order(b, a) > 0 && C.order(a, b) < 0); assert.strictEqual(C.newerState(a, b), b); assert.strictEqual(C.newerState(b, a), b, "order-independent");
  const x = st(5, "alice"), y = st(5, "bob");
  assert.strictEqual(C.newerState(x, y), y); assert.strictEqual(C.newerState(y, x), y, "same sequence: deterministic tie-break, same answer on both sides");
  assert.strictEqual(C.order(x, { ...x }), 0, "the same command twice is a duplicate");
  assert.strictEqual(C.newerState(null, a), a); assert.strictEqual(C.newerState(a, null), a); assert.strictEqual(C.newerState(null, null), null);
});
t("ordering: a later end beats an earlier play; a later load beats an end; across different sessions too", () => {
  const play = st(3, "alice", { sessionId: "s1" }), end = st(4, "bob", { sessionId: "s1", status: "ended", cmd: "end" }), load = st(5, "alice", { sessionId: "s2" });
  assert.strictEqual(C.newerState(play, end), end); assert.strictEqual(C.newerState(end, load), load); assert.strictEqual(C.newerState(play, load), load);
});

// A faithful model of the session's command/receive rules, used to hammer the convergence property with random schedules.
function replica(id) {
  return {
    id, clock: 0, state: null,
    command(extra) { const s = { ...good(), sessionId: "sess", by: id, rev: ++this.clock, ...extra }; this.state = C.newerState(this.state, s) === s ? s : this.state; this.state = s; return s; },
    receive(m) { this.clock = Math.max(this.clock, m.rev); const w = C.newerState(this.state, m); const changed = w !== this.state; this.state = w; return changed; },
  };
}
t("convergence: random simultaneous commands, delays, reordering and duplicates always end on ONE state", () => {
  let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let round = 0; round < 3000; round++) {
    const A = replica("aaaa"), B = replica("bbbb"), inflight = [];
    const steps = 1 + Math.floor(rnd() * 14);
    for (let i = 0; i < steps; i++) {
      const who = rnd() < 0.5 ? A : B, other = who === A ? B : A;
      if (rnd() < 0.55) { const m = who.command({ playback: rnd() < 0.5 ? "playing" : "paused", position: Math.floor(rnd() * 600), cmd: ["play", "pause", "seek"][Math.floor(rnd() * 3)] }); inflight.push({ to: other, m }); if (rnd() < 0.2) inflight.push({ to: other, m }); }
      else if (inflight.length) { const k = Math.floor(rnd() * inflight.length), d = inflight.splice(k, 1)[0]; d.to.receive(d.m); }
    }
    for (let i = inflight.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [inflight[i], inflight[j]] = [inflight[j], inflight[i]]; }   // the rest arrives in any order
    for (const d of inflight) d.to.receive(d.m);
    assert.deepStrictEqual(A.state, B.state, `round ${round}: replicas disagree`);
  }
});
t("convergence: a command issued after seeing the partner's always supersedes it (no 'lost update' of the newer intent)", () => {
  const A = replica("aaaa"), B = replica("bbbb");
  const m1 = A.command({ playback: "playing", position: 10 }); B.receive(m1);
  const m2 = B.command({ playback: "paused", position: 42, cmd: "pause" }); A.receive(m2);
  assert.ok(m2.rev > m1.rev); assert.strictEqual(A.state.playback, "paused"); assert.strictEqual(B.state.playback, "paused"); assert.strictEqual(A.state.position, 42);
});
t("convergence: an offline player's commands made during an outage reconcile after reconnect (the newer one wins, the same on both sides)", () => {
  const A = replica("aaaa"), B = replica("bbbb");
  const base = A.command({ position: 5 }); B.receive(base);
  for (let i = 0; i < 4; i++) A.command({ position: 100 + i });                        // A keeps seeking while the link is down
  B.command({ position: 9, playback: "paused" });                                      // B pauses once
  const sa = A.state, sb = B.state;                                                    // reconnect: both send their snapshot
  A.receive(sb); B.receive(sa);
  assert.deepStrictEqual(A.state, B.state); assert.strictEqual(A.state.by, "aaaa", "A made more commands so its latest is newest");
});

t("validatePos: presence packets are sanitised", () => {
  assert.strictEqual(C.validatePos(null), null); assert.strictEqual(C.validatePos({ w: "mars" }), null); assert.strictEqual(C.validatePos({ w: "home", x: "1", y: 2 }), null);
  assert.strictEqual(C.validatePos({ w: "home", x: 1e9, y: 2 }), null); assert.strictEqual(C.validatePos({ w: "cinema", x: NaN, y: 2 }), null);
  const p = C.validatePos({ w: "cinema", x: 10, y: 20, d: "sideways", st: 7, nm: "<b>Eve</b>\u0000" + "x".repeat(50), g: "female" });
  assert.strictEqual(p.d, "down"); assert.strictEqual(p.st, -1); assert.ok(!/[<>\u0000]/.test(p.nm) && p.nm.length <= 24); assert.strictEqual(p.g, "female");
  assert.deepStrictEqual(C.validatePos({ w: "out", nm: "Z" }), { w: "out", g: "male", nm: "Z" });
});
t("validateChat: sanitises text, rejects empty/garbage, keeps a numeric timestamp", () => {
  assert.strictEqual(C.validateChat(null), null); assert.strictEqual(C.validateChat(undefined), null); assert.strictEqual(C.validateChat("hi"), null);
  assert.strictEqual(C.validateChat({ text: 42 }), null);
  assert.strictEqual(C.validateChat({ text: "   " }), null, "whitespace-only text is rejected");
  assert.strictEqual(C.validateChat({ text: "\u0000\u0001  " }), null, "control-char-only text is rejected");
  const m = C.validateChat({ text: "  hey <script>alert(1)</script> there \u0000  ", ts: 12345 });
  assert.ok(m); assert.strictEqual(m.text, "hey <script>alert(1)</script> there", "trims whitespace/control chars but does not alter markup — that's the renderer's job, via textContent"); assert.strictEqual(m.ts, 12345);
  const long = C.validateChat({ text: "x".repeat(900), ts: 1 }); assert.strictEqual(long.text.length, 500, "caps message length");
  const noTs = C.validateChat({ text: "hello" }); assert.ok(noTs && typeof noTs.ts === "number" && isFinite(noTs.ts), "falls back to a numeric timestamp when the sender omitted one");
});
t("fmtTime / randomId / nearestRate", () => {
  assert.strictEqual(C.fmtTime(0), "0:00"); assert.strictEqual(C.fmtTime(65), "1:05"); assert.strictEqual(C.fmtTime(3725), "1:02:05"); assert.strictEqual(C.fmtTime(NaN), "--:--"); assert.strictEqual(C.fmtTime(-3), "--:--");
  assert.ok(C.ID_RE.test(C.randomId())); assert.notStrictEqual(C.randomId(), C.randomId());
  assert.strictEqual(C.nearestRate(1.1), 1); assert.strictEqual(C.nearestRate(1.9), 2); assert.strictEqual(C.nearestRate(0.3), 0.25);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
