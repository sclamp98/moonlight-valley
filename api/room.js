"use strict";
/* POST /api/room  ->  { code: "MV2.<roomId>.<key>", roomId, expiresAt }
   Called by the host. The code is the invite: whoever holds it can join that one room. */
const mv = require("./_mv");

module.exports = async (req, res) => {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return mv.send(res, 405, { error: "method", message: "Use POST." }); }
  const cfg = mv.config(); if (!cfg) return mv.notConfigured(res);
  const roomId = mv.newRoomId(), key = mv.roomKey(cfg.roomSecret, roomId);
  return mv.send(res, 200, { code: `MV2.${roomId}.${key}`, roomId, expiresAt: Date.now() + mv.ROOM_TTL_MS });
};
