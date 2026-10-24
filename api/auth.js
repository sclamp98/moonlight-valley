"use strict";
/* POST /api/auth  { roomId, key, clientId }  ->  an Ably TokenRequest limited to channel "mv:<roomId>".
   The browser hands this to Ably to get its real token. Wrong key / expired room -> 403, and nothing is issued. */
const mv = require("./_mv");

module.exports = async (req, res) => {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return mv.send(res, 405, { error: "method", message: "Use POST." }); }
  const cfg = mv.config(); if (!cfg) return mv.notConfigured(res);
  const b = await mv.readJson(req);
  if (!b || !mv.ROOM_RE.test(String(b.roomId || "")) || !mv.KEY_RE.test(String(b.key || "")) || !mv.CLIENT_RE.test(String(b.clientId || ""))) return mv.send(res, 400, { error: "bad_request", message: "That invite code isn't valid." });
  if (!mv.sameKey(b.key, mv.roomKey(cfg.roomSecret, b.roomId))) return mv.send(res, 403, { error: "forbidden", message: "That invite code isn't valid." });
  if (mv.roomAge(b.roomId) > mv.ROOM_TTL_MS) return mv.send(res, 403, { error: "expired", message: "That invite has expired. Ask your partner for a new one." });
  const capability = { [mv.channelOf(b.roomId)]: ["presence", "publish", "subscribe"] };
  return mv.send(res, 200, mv.tokenRequest(cfg, { clientId: b.clientId, capability }));
};
