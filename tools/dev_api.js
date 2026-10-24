"use strict";
/* Local stand-in for "Vercel + Ably", for tests only:  node tools/dev_api.js <port>
   - serves the game's static files
   - mounts api/room.js and api/auth.js exactly like Vercel does (POST /api/room, /api/auth)
   - /__hub/*  is a tiny fake of Ably's realtime service (channels, presence, token check), used by tools/fake_ably.js.
     It verifies the same token MAC that the real Ably would, so a wrong key / wrong channel is refused here too.
   Real Ably is NOT involved. */
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto"), url = require("url");
const root = path.resolve(__dirname, ".."), port = +process.argv[2] || 8140;
process.env.ABLY_API_KEY = process.env.ABLY_API_KEY || "testkey.abc:testsecretvalue1234567890";
process.env.MV_ROOM_SECRET = process.env.MV_ROOM_SECRET || "test-room-secret-0123456789abcdef";
const handlers = { "/api/room": require("../api/room.js"), "/api/auth": require("../api/auth.js") };
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json", ".webm": "video/webm", ".txt": "text/plain" };
const [keyName, keySecret] = [process.env.ABLY_API_KEY.split(":")[0], process.env.ABLY_API_KEY.split(":").slice(1).join(":")];

/* ---- fake Ably hub ---- */
const chans = new Map();                                   // channel -> { subs: Map(cid -> res), members: Map(cid -> data) }
const ch = (n) => { if (!chans.has(n)) chans.set(n, { subs: new Map(), members: new Map() }); return chans.get(n); };
function verify(tokB64, channel) {                         // -> clientId or null
  try {
    const t = JSON.parse(Buffer.from(tokB64, "base64url").toString("utf8"));
    const text = [t.keyName, t.ttl, t.capability, t.clientId, t.timestamp, t.nonce].join("\n") + "\n";
    const mac = crypto.createHmac("sha256", keySecret).update(text).digest("base64");
    if (t.keyName !== keyName || mac !== t.mac) return null;
    if (Date.now() > t.timestamp + t.ttl) return null;
    const cap = JSON.parse(t.capability); if (!cap[channel] || !["publish", "subscribe", "presence"].every((o) => cap[channel].includes(o))) return null;
    return t.clientId;
  } catch (e) { return null; }
}
const sse = (res, ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
const hubStats = { published: 0, refused: 0 };
function hub(req, res, u, body) {
  const q = u.query, name = q.ch || (body && body.ch) || "", c = ch(name), cid = verify(q.tok || (body && body.tok) || "", name);
  if (u.pathname === "/__hub/stats") { res.end(JSON.stringify(hubStats)); return; }
  if (!cid) { hubStats.refused++; res.statusCode = 401; res.end(JSON.stringify({ error: "token refused for this channel" })); return; }
  if (u.pathname === "/__hub/sub") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
    c.subs.get(cid) && c.subs.get(cid).end(); c.subs.set(cid, res); sse(res, "ready", {});
    req.on("close", () => { if (c.subs.get(cid) === res) { c.subs.delete(cid); if (c.members.has(cid)) { const d = c.members.get(cid); c.members.delete(cid); for (const [, r] of c.subs) sse(r, "presence", { action: "leave", clientId: cid, data: d }); } } });
    return;
  }
  if (u.pathname === "/__hub/pub") { hubStats.published++; for (const [id, r] of c.subs) if (id !== cid) sse(r, "msg", { clientId: cid, data: body.data }); res.end("{}"); return; }
  if (u.pathname === "/__hub/presence") {
    if (body.action === "enter") c.members.set(cid, body.data); else c.members.delete(cid);
    for (const [, r] of c.subs) sse(r, "presence", { action: body.action, clientId: cid, data: body.data }); res.end("{}"); return;
  }
  if (u.pathname === "/__hub/members") { res.end(JSON.stringify([...c.members].map(([clientId, data]) => ({ clientId, data })))); return; }
  res.statusCode = 404; res.end("{}");
}

http.createServer((req, res) => {
  const u = url.parse(req.url, true);
  if (u.pathname.startsWith("/__hub/")) {
    if (req.method === "POST") { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => { let j = {}; try { j = JSON.parse(b || "{}"); } catch (e) { /* ignore */ } hub(req, res, u, j); }); } else hub(req, res, u, null);
    return;
  }
  if (handlers[u.pathname]) return Promise.resolve(handlers[u.pathname](req, res)).catch((e) => { res.statusCode = 500; res.end(String(e)); });
  let p = path.join(root, decodeURIComponent(u.pathname)); if (p.endsWith(path.sep)) p += "index.html";
  if (!p.startsWith(root)) { res.statusCode = 403; return res.end(); }
  fs.readFile(p, (err, data) => { if (err) { res.statusCode = 404; return res.end("not found"); } res.setHeader("Content-Type", MIME[path.extname(p)] || "application/octet-stream"); res.end(data); });
}).listen(port, () => console.log("dev api on " + port));
