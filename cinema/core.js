"use strict";
/* ==========================================================
   Moonlight Valley — co-op cinema: pure logic (no DOM, no network, no game objects).
   URL parsing/validation, shared-state validation, drift maths, and the ordering rule that makes two players who
   can BOTH control playback converge on one state (Lamport-style sequence numbers + a deterministic tie-break).
   Loaded in the browser as a global (CinemaCore) and by node (tools/test_cinema.js) via module.exports.
   ========================================================== */
const CinemaCore = (() => {
  const SYNC = {
    TOLERANCE_S: 1.5,            // a player may drift this far from the shared timeline before we seek (avoids constant seeking / stutter)
    BIG_DRIFT_S: 8,              // beyond this we seek again sooner
    COOLDOWN_MS: 4000,           // minimum gap between two drift corrections
    BIG_COOLDOWN_MS: 1500,
    LEAD_S: 0.25,                // seek slightly ahead to cover the seek latency
    BEAT_MS: 2000,               // heartbeat (both players send one)
    STALE_BEAT_MS: 9000,         // "partner not responding" after this long without a beat
    SETTLE_MS: 1500,             // after any command (ours or applied from the partner) auto-correction stays quiet this long, so it never fights a seek
    MAX_POSITION_S: 60 * 60 * 24,
    MAX_EXTRAPOLATE_S: 60 * 60 * 6,
  };
  const PLAYBACK = ["loading", "playing", "paused", "buffering", "ended"];
  const CMDS = ["load", "play", "pause", "seek", "rate", "ended", "end"];            // what a state change was ("cmd" field; informational)
  const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
  const YT_ID = /^[A-Za-z0-9_-]{11}$/;
  const DRIVE_ID = /^[A-Za-z0-9_-]{15,100}$/;                                          // Google Drive file ids (typically 28-44 chars)
  const VIDEO_ID = { youtube: YT_ID, gdrive: DRIVE_ID };                                // id shape per provider
  const YT_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com", "youtu.be", "www.youtu.be"]);

  const num = (v, lo, hi, dflt) => (typeof v === "number" && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt);
  const fmtTime = (s) => {
    if (typeof s !== "number" || !isFinite(s) || s < 0) return "--:--";
    s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : String(m)) + ":" + String(x).padStart(2, "0");
  };
  const randomId = () => {
    const a = new Uint8Array(9);
    (typeof crypto !== "undefined" && crypto.getRandomValues) ? crypto.getRandomValues(a) : a.forEach((_, i) => (a[i] = Math.floor(Math.random() * 256)));
    return Array.from(a, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 12);
  };

  // "90", "90s", "1m30s", "1h2m3s" -> seconds (or 0)
  function parseStart(v) {
    if (!v) return 0;
    if (/^\d{1,6}$/.test(v)) return Math.min(+v, SYNC.MAX_POSITION_S);
    const m = /^(?:(\d{1,3})h)?(?:(\d{1,3})m)?(?:(\d{1,6})s)?$/.exec(v);
    if (!m || (!m[1] && !m[2] && !m[3])) return 0;
    return Math.min((+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0), SYNC.MAX_POSITION_S);
  }

  /* ---------- YouTube URL -> { ok, provider, videoId, start, url } ---------- */
  function parseYouTube(input) {
    let s = String(input == null ? "" : input).trim();
    if (!s) return { ok: false, kind: "empty", error: "Paste a YouTube link first." };
    if (s.length > 300) return { ok: false, kind: "invalid", error: "That link is too long to be a video link." };
    if (/^(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\//i.test(s)) s = "https://" + s;       // allow links pasted without the scheme
    let u;
    try { u = new URL(s); } catch (e) { return { ok: false, kind: "invalid", error: "That doesn't look like a link." }; }
    if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, kind: "invalid", error: "Only http(s) links are supported." };
    if (u.username || u.password) return { ok: false, kind: "invalid", error: "Links with a username or password are not supported." };
    const host = u.hostname.toLowerCase().replace(/\.$/, "");
    if (!YT_HOSTS.has(host)) return { ok: false, kind: "host", host, error: "Unsupported link." };
    let id = null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (host === "youtu.be" || host === "www.youtu.be") id = parts[0];
    else if (parts[0] === "watch") id = u.searchParams.get("v");
    else if (["embed", "shorts", "live", "v"].includes(parts[0])) id = parts[1];
    if (!id || !YT_ID.test(id)) return { ok: false, kind: "invalid", error: "I couldn't find a valid YouTube video ID in that link (playlists and channel pages aren't supported)." };
    const start = parseStart(u.searchParams.get("t") || u.searchParams.get("start") || "");
    return { ok: true, provider: "youtube", videoId: id, start, url: "https://www.youtube.com/watch?v=" + id };
  }

  /* ---------- Google Drive share link -> { ok, provider: "gdrive", videoId: fileId, start: 0, url } ----------
     Accepts the usual share formats and nothing else:  /file/d/ID/view|preview|edit, /file/u/0/d/ID, /open?id=ID, /uc?id=ID,
     drive.usercontent.google.com/download?id=ID.  Folders, Docs/Sheets/Slides and anything on another host are refused. */
  const DRIVE_HOSTS = new Set(["drive.google.com", "www.drive.google.com", "docs.google.com", "drive.usercontent.google.com"]);
  function parseDrive(input) {
    let s = String(input == null ? "" : input).trim();
    if (!s) return { ok: false, kind: "empty", error: "Paste a link first." };
    if (s.length > 400) return { ok: false, kind: "invalid", error: "That link is too long to be a Drive link." };
    if (/^(?:www\.)?(?:drive|docs)\.google\.com\//i.test(s) || /^drive\.usercontent\.google\.com\//i.test(s)) s = "https://" + s;
    let u;
    try { u = new URL(s); } catch (e) { return { ok: false, kind: "host" }; }
    if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, kind: "host" };
    const host = u.hostname.toLowerCase().replace(/\.$/, "");
    if (!DRIVE_HOSTS.has(host)) return { ok: false, kind: "host" };
    if (u.username || u.password) return { ok: false, kind: "invalid", error: "Links with a username or password are not supported." };
    const parts = u.pathname.split("/").filter(Boolean);
    const isFolder = parts.includes("folders") || parts[0] === "drive" || parts[0] === "folderview";
    if (isFolder) return { ok: false, kind: "drive", error: "That's a Drive folder, not a video. Open the video file, choose Share → Copy link, and paste that." };
    if (host === "docs.google.com" && ["document", "spreadsheets", "presentation", "forms", "drawings"].includes(parts[0])) return { ok: false, kind: "drive", error: "That's a Google Docs-type file, not a video. Paste the link to a video file in Drive." };
    let id = null;
    const d = parts.indexOf("d");
    if (parts.includes("file") && d >= 0) id = parts[d + 1];
    else if (["open", "uc", "download"].includes(parts[0])) id = u.searchParams.get("id");
    if (!id || !DRIVE_ID.test(id)) return { ok: false, kind: "drive", error: "I couldn't find a Drive file ID in that link. Use a link like drive.google.com/file/d/…/view (Share → Copy link)." };
    return { ok: true, provider: "gdrive", videoId: id, start: 0, url: "https://drive.google.com/file/d/" + id + "/view" };
  }

  const NETMIRROR_RE = /(^|\.)netmirror[a-z0-9-]*\.[a-z.]+$/i;
  function hostOf(input) {
    try { let s = String(input).trim(); if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = "https://" + s; return new URL(s).hostname.toLowerCase().replace(/\.$/, ""); } catch (e) { return ""; }
  }

  /* ---------- the shared session state ----------
     { sessionId, by, provider, videoId, start, playback, position, ts, rate, rev, status, cmd }
     Nobody is "the host": either player may issue a command. Every command produces a new state with
       rev = (highest rev this player has ever seen) + 1   (a Lamport counter: a monotonically increasing sequence number)
       by  = who issued it,   ts = the issuer's clock when it was issued,   cmd = what it was.
     The newest (rev, by) wins everywhere (see order / newerState), so simultaneous commands converge on one final state. */
  function validateState(o, providers = ["youtube"]) {
    if (!o || typeof o !== "object") return null;
    if (!ID_RE.test(o.sessionId || "") || !ID_RE.test(o.by || "")) return null;
    if (!providers.includes(o.provider)) return null;
    const idRe = VIDEO_ID[o.provider];
    if (idRe && !idRe.test(o.videoId || "")) return null;
    if (!idRe && !ID_RE.test(o.videoId || "")) return null;
    if (!PLAYBACK.includes(o.playback)) return null;
    if (o.status !== "active" && o.status !== "ended") return null;
    if (!Number.isInteger(o.rev) || o.rev < 0 || o.rev > 1e9) return null;
    if (typeof o.ts !== "number" || !isFinite(o.ts)) return null;
    return {
      sessionId: o.sessionId, by: o.by, provider: o.provider, videoId: o.videoId,
      start: num(o.start, 0, SYNC.MAX_POSITION_S, 0), playback: o.playback,
      position: num(o.position, 0, SYNC.MAX_POSITION_S, 0), ts: o.ts, rate: nearestRate(num(o.rate, 0.25, 2, 1)),
      rev: o.rev, status: o.status, cmd: CMDS.includes(o.cmd) ? o.cmd : "seek",
    };
  }
  const nearestRate = (r) => RATES.reduce((b, x) => (Math.abs(x - r) < Math.abs(b - r) ? x : b), 1);

  // > 0 when state a is newer than b, < 0 when older, 0 when it is the very same command. Total order: sequence number, then sender id.
  function order(a, b) {
    if (a.rev !== b.rev) return a.rev - b.rev;
    return a.by === b.by ? 0 : a.by > b.by ? 1 : -1;
  }
  // The state both players settle on. null / missing never beats a real one (a late joiner adopts what is already playing);
  // an "ended" state is an ordinary state, so a later end beats an earlier play and a later load beats an end.
  function newerState(a, b) {
    if (!a) return b || null;
    if (!b) return a;
    return order(a, b) >= 0 ? a : b;
  }

  // A heartbeat only carries the volatile fields; returns null when it can't be trusted.
  function validateBeat(o) {
    if (!o || typeof o !== "object" || !ID_RE.test(o.sessionId || "") || !ID_RE.test(o.by || "") || !PLAYBACK.includes(o.playback)) return null;
    if (!Number.isInteger(o.rev) || o.rev < 0 || typeof o.ts !== "number" || !isFinite(o.ts)) return null;
    return { sessionId: o.sessionId, by: o.by, rev: o.rev, playback: o.playback, position: num(o.position, 0, SYNC.MAX_POSITION_S, 0), ts: o.ts, rate: nearestRate(num(o.rate, 0.25, 2, 1)), buf: o.buf === true };
  }

  // Where the shared playhead is right now (nowMs = the clock of whoever issued the state, as estimated on this machine).
  function targetPosition(st, hostNowMs) {
    if (st.playback !== "playing") return st.position;
    const dt = Math.min(SYNC.MAX_EXTRAPOLATE_S, Math.max(0, (hostNowMs - st.ts) / 1000));
    return Math.min(SYNC.MAX_POSITION_S, st.position + dt * st.rate);
  }

  // Seek only when we're really off, and not more often than the cooldown (a seek restarts buffering = stutter).
  function decideSeek({ current, target, nowMs, lastSeekMs, force = false }) {
    const drift = Math.abs(current - target);
    if (!isFinite(drift)) return false;
    if (force) return drift > 0.5;
    const since = nowMs - lastSeekMs;
    if (drift > SYNC.BIG_DRIFT_S) return since >= SYNC.BIG_COOLDOWN_MS;
    return drift > SYNC.TOLERANCE_S && since >= SYNC.COOLDOWN_MS;
  }

  // What this player's own player should be doing for the shared state.
  // Buffering is deliberately NOT a state we mirror: if one player buffers the other keeps playing (no pause/play toggling on
  // both sides); the one that buffered is brought back to the shared position when it recovers (see Session._align).
  function desiredAction(st, local) {
    // local: "playing" | "paused" | "buffering" | "unstarted" | "ended" | "cued"
    if (st.status !== "active") return "stop";
    if (st.playback === "playing") return local === "playing" || local === "buffering" ? "keep" : "play";
    return local === "playing" ? "pause" : "keep";                         // paused / loading / ended
  }

  /* ---------- presence packets from the partner ---------- */
  const WHERE = ["home", "cinema", "out"], DIRS = ["up", "down", "left", "right"];
  function validatePos(o) {
    if (!o || typeof o !== "object" || !WHERE.includes(o.w)) return null;
    const out = { w: o.w };
    if (o.w !== "out") {
      if (typeof o.x !== "number" || typeof o.y !== "number" || !isFinite(o.x) || !isFinite(o.y) || Math.abs(o.x) > 20000 || Math.abs(o.y) > 20000) return null;
      out.x = o.x; out.y = o.y; out.d = DIRS.includes(o.d) ? o.d : "down"; out.mv = !!o.mv; out.st = o.st === 0 || o.st === 1 ? o.st : -1;
    }
    out.g = o.g === "female" ? "female" : "male";
    out.nm = typeof o.nm === "string" ? o.nm.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 24) || "Partner" : "Partner";
    return out;
  }

  /* ---------- chat messages ---------- */
  function validateChat(o) {
    if (!o || typeof o !== "object") return null;
    if (typeof o.text !== "string") return null;
    const text = o.text.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 500);
    if (!text) return null;
    const ts = typeof o.ts === "number" && isFinite(o.ts) ? o.ts : Date.now();
    return { text, ts };
  }

  const api = { SYNC, PLAYBACK, CMDS, RATES, YT_ID, DRIVE_ID, ID_RE, parseYouTube, parseDrive, parseStart, hostOf, NETMIRROR_RE, validateState, validateBeat, order, newerState, targetPosition, decideSeek, desiredAction, validatePos, validateChat, fmtTime, randomId, nearestRate };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  return api;
})();
