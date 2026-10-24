"use strict";
/* Moonlight Valley — shared helpers for the co-op API (Vercel Node functions).
   Files in api/ that start with "_" are not exposed as endpoints.

   Design: no database. A room is just a name + a key that only the server can compute:
       roomId = <base36 time>_<random>          key = HMAC-SHA256(MV_ROOM_SECRET, "room:" + roomId)
   The invite code "MV2.<roomId>.<key>" is the only credential. /api/auth turns a valid (roomId, key) into a short-lived
   Ably token that may use ONE channel ("mv:<roomId>") and nothing else. No secret ever reaches the browser. */
const crypto = require("crypto");

const ROOM_TTL_MS = 12 * 3600 * 1000;           // a room code stops working after 12 h
const TOKEN_TTL_MS = 3600 * 1000;               // Ably tokens live 1 h (the client renews them)
const ROOM_RE = /^[a-z0-9]{6,10}_[A-Za-z0-9_-]{10,12}$/;
const KEY_RE = /^[A-Za-z0-9_-]{32,64}$/;
const CLIENT_RE = /^[A-Za-z0-9_-]{1,40}$/;

function config() {
  const ably = process.env.ABLY_API_KEY || "", secret = process.env.MV_ROOM_SECRET || "", i = ably.indexOf(":");
  if (i < 1 || i === ably.length - 1) return null;
  if (secret.length < 24) return null;
  return { keyName: ably.slice(0, i), keySecret: ably.slice(i + 1), roomSecret: secret };
}
const b64u = (buf) => Buffer.from(buf).toString("base64url");
const roomKey = (roomSecret, roomId) => b64u(crypto.createHmac("sha256", roomSecret).update("room:" + roomId).digest()).slice(0, 43);
function newRoomId(now = Date.now()) { return now.toString(36) + "_" + b64u(crypto.randomBytes(9)).slice(0, 12); }
function roomAge(roomId, now = Date.now()) { const t = parseInt(String(roomId).split("_")[0], 36); return isFinite(t) ? now - t : Infinity; }
function sameKey(a, b) { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); }
const channelOf = (roomId) => "mv:" + roomId;

// Ably TokenRequest (https://ably.com/docs/api/token-request-spec): mac = base64(HMAC-SHA256(keySecret, keyName\nttl\ncapability\nclientId\ntimestamp\nnonce\n))
function tokenRequest(cfg, { clientId, capability, ttl = TOKEN_TTL_MS, timestamp = Date.now(), nonce = crypto.randomBytes(16).toString("hex") }) {
  const cap = JSON.stringify(capability);
  const text = [cfg.keyName, ttl, cap, clientId, timestamp, nonce].join("\n") + "\n";
  const mac = crypto.createHmac("sha256", cfg.keySecret).update(text).digest("base64");
  return { keyName: cfg.keyName, ttl, capability: cap, clientId, timestamp, nonce, mac };
}

// JSON body from Vercel's pre-parsed req.body, or read from the stream (local dev server).
async function readJson(req, limit = 2048) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch (e) { return null; } }
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > limit) return null; chunks.push(c); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch (e) { return null; }
}
function send(res, code, obj) {
  res.statusCode = code; res.setHeader("Content-Type", "application/json; charset=utf-8"); res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}
const notConfigured = (res) => send(res, 503, { error: "not_configured", message: "Co-op server isn't set up yet: the site owner must set ABLY_API_KEY and MV_ROOM_SECRET in Vercel (see README-MIGRATION.md)." });

module.exports = { config, roomKey, newRoomId, roomAge, sameKey, channelOf, tokenRequest, readJson, send, notConfigured, ROOM_TTL_MS, TOKEN_TTL_MS, ROOM_RE, KEY_RE, CLIENT_RE };
