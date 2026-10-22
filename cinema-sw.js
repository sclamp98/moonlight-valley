"use strict";
/* ==========================================================
   Moonlight Valley — Google Drive streaming helper (service worker).

   A <video> element cannot send an Authorization header, and Drive's official download endpoint
   (drive/v3/files/ID?alt=media) needs one. This worker is the small bridge: the page registers a file
   (id + the Drive API base + the player's own short-lived access token + size / mime type taken from Drive's own
   metadata) and points the <video> at  <scope>__cinema_drive/<id>.  When the video asks for bytes (including Range
   requests, so seeking works) this worker forwards exactly that request to the Drive API with the token and hands the
   bytes back.

   It does nothing else: it only serves ids the page registered, only talks to the base the page registered (https, or
   http on localhost for tests), keeps the token in memory only (never stored), and never contacts any other site.
   It does not bypass anything: if the signed-in Google account may not read the file, Drive refuses and so do we.
   ========================================================== */
const files = new Map();                       // fileId -> { base, token, size, mime }
const waiters = new Map();                     // fileId -> [resolve]   (page asked to re-register after this worker was restarted)
const PREFIX = "__cinema_drive/";
const ID_RE = /^[A-Za-z0-9_-]{15,100}$/;
const baseOk = (b) => { try { const u = new URL(b); return u.protocol === "https:" || (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")); } catch (e) { return false; } };

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("message", (e) => {
  const m = e.data || {}, port = e.ports && e.ports[0], reply = (ok, error) => { try { port && port.postMessage({ ok, error }); } catch (x) { /* page went away */ } };
  if (m.type === "register") {
    if (!ID_RE.test(m.id || "") || !baseOk(m.base) || typeof m.token !== "string" || !(m.size > 0) || typeof m.mime !== "string") return reply(false, "bad registration");
    files.set(m.id, { base: m.base.replace(/\/+$/, ""), token: m.token, size: Math.floor(m.size), mime: m.mime.slice(0, 100) });
    const w = waiters.get(m.id); if (w) { waiters.delete(m.id); w.forEach((r) => r(files.get(m.id))); }
    reply(true);
  } else if (m.type === "token") {                                   // the page refreshed its access token
    if (typeof m.token === "string") for (const f of files.values()) f.token = m.token;
    reply(true);
  } else if (m.type === "forget") { files.delete(m.id); reply(true); }
});

self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== self.location.origin) return;
  const i = u.pathname.indexOf("/" + PREFIX); if (i < 0) return;
  const id = u.pathname.slice(i + 1 + PREFIX.length);
  if (!ID_RE.test(id)) return;
  e.respondWith(serve(e, id));
});

async function registration(e, id) {
  const have = files.get(id); if (have) return have;
  // this worker was stopped and restarted since the page registered the file: ask the page for it again
  const c = e.clientId ? await self.clients.get(e.clientId) : null;
  const list = c ? [c] : await self.clients.matchAll({ type: "window" });
  if (!list.length) return null;
  const p = new Promise((res) => { (waiters.get(id) || waiters.set(id, []).get(id)).push(res); setTimeout(() => res(null), 4000); });
  list.forEach((cl) => cl.postMessage({ type: "need", id }));
  return p;
}

async function serve(e, id) {
  const f = await registration(e, id);
  if (!f) return new Response("This video is not registered (reload the video).", { status: 410 });
  const size = f.size, hdr = e.request.headers.get("Range");
  let start = 0, end = size - 1, partial = false;
  if (hdr) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(hdr.trim());
    if (!m || (m[1] === "" && m[2] === "")) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    if (m[1] === "") { start = Math.max(0, size - parseInt(m[2], 10)); }                                    // suffix range: the last N bytes
    else { start = parseInt(m[1], 10); if (m[2] !== "") end = Math.min(size - 1, parseInt(m[2], 10)); }
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    partial = true;
  }
  let up;
  try {
    up = await fetch(`${f.base}/drive/v3/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, {
      headers: { Authorization: "Bearer " + f.token, Range: `bytes=${start}-${end}` }, cache: "no-store", signal: e.request.signal,
    });
  } catch (err) { return new Response("Couldn't reach Google Drive.", { status: 502 }); }
  if (up.status !== 206 && !(up.status === 200 && start === 0)) {
    // Drive refused (expired token, no permission, quota, …): pass the status on; the page reports a clear message
    return new Response(null, { status: up.status === 401 || up.status === 403 || up.status === 404 || up.status === 416 ? up.status : 502 });
  }
  // Headers are rebuilt from the size/type Drive's metadata gave us, so we never depend on which response headers the browser lets us read cross-origin.
  const len = end - start + 1;
  const headers = { "Content-Type": f.mime, "Accept-Ranges": "bytes", "Content-Length": String(len), "Cache-Control": "no-store" };
  if (partial) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  return new Response(up.body, { status: partial ? 206 : 200, headers });
}
