/* Test double for the Ably browser SDK (callback API subset used by cinema/relay.js), talking to tools/dev_api.js's /__hub.
   Injected before the page loads, so relay.js uses it instead of the real SDK. Real Ably is not involved. */
(() => {
  const j = (path, body) => fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  class Emitter { constructor() { this._l = []; } on(a, b) { const f = typeof a === "function" ? a : b, ev = typeof a === "function" ? null : a; this._l.push({ f, ev }); } emit(ev, p) { for (const l of this._l.slice()) if (!l.ev || l.ev === ev) { try { l.f(p); } catch (e) { console.error("fake-ably listener", e); } } } }
  class Presence {
    constructor(ch) { this.ch = ch; this.subs = []; }
    subscribe(f) { this.subs.push(f); }
    enter(data, cb) { this.ch._data = data; this.ch.rt._tokP.then((t) => j("/__hub/presence", { tok: t.b64, ch: this.ch.name, action: "enter", data }).then(() => cb && cb(null))); }
    leave(cb) { this.ch.rt._tokP.then((t) => j("/__hub/presence", { tok: t.b64, ch: this.ch.name, action: "leave" }).then(() => cb && cb(null))); }
    get(cb) { this.ch.rt._tokP.then((t) => fetch(`/__hub/members?ch=${encodeURIComponent(this.ch.name)}&tok=${t.b64}`).then((r) => r.json()).then((l) => cb(null, l), (e) => cb(e))); }
  }
  class Channel {
    constructor(rt, name) { this.rt = rt; this.name = name; this.state = "initialized"; this.msgSubs = []; this.presence = new Presence(this); this.es = null; }
    subscribe(name, f) { this.msgSubs.push({ name, f }); }
    attach(cb) {
      this.rt._tokP.then((t) => {
        const open = (first) => {
          const es = (this.es = new EventSource(`/__hub/sub?ch=${encodeURIComponent(this.name)}&tok=${t.b64}`));
          es.addEventListener("ready", () => { const re = !!this._attachedOnce; this._attachedOnce = true; this.state = "attached"; this.rt._set("connected"); if (first) cb && cb(null); if (re && this._data) this.presence.enter(this._data); });
          es.addEventListener("msg", (e) => { const m = JSON.parse(e.data); for (const s of this.msgSubs) s.f({ name: "m", data: m.data, clientId: m.clientId }); });
          es.addEventListener("presence", (e) => { const m = JSON.parse(e.data); for (const f of this.presence.subs) f({ action: m.action, clientId: m.clientId, data: m.data }); });
          es.onerror = () => { if (this.rt._closed) return; es.close(); if (first && this.state !== "attached") { cb && cb({ message: "token refused or hub unreachable" }); first = false; return; } this.rt._set("disconnected"); setTimeout(() => !this.rt._closed && !this.rt._dropped && open(false), 800); };
        };
        open(true);
      }, (e) => cb && cb(e));
    }
    publish(name, data, cb) { this.rt._tokP.then((t) => j("/__hub/pub", { tok: t.b64, ch: this.name, data }).then(() => cb && cb(null), (e) => cb && cb(e))); }
  }
  class Realtime {
    constructor(opts) {
      this._opts = opts; this._closed = false; this._dropped = false; this.channels = { get: (n) => (this._ch[n] = this._ch[n] || new Channel(this, n)) }; this._ch = {};
      const em = new Emitter(); this.connection = { state: "initialized", on: (a, b) => em.on(a, b), _em: em };
      window.__fakeAbly = window.__fakeAbly || { instances: [] }; window.__fakeAbly.instances.push(this);
      this._tokP = new Promise((res, rej) => { this._set("connecting"); opts.authCallback({}, (err, tok) => { if (err) { this._set("failed", err); rej(err); } else { tok.b64 = btoa(JSON.stringify(tok)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); res(tok); } }); });
      this._tokP.catch(() => {});
    }
    _set(s, reason) { if (this.connection.state === s) return; const prev = this.connection.state; this.connection.state = s; this.connection._em.emit(s, { current: s, previous: prev, reason }); }
    close() { this._closed = true; for (const c of Object.values(this._ch)) c.es && c.es.close(); this._set("closed"); }
    // test helpers
    drop() { this._dropped = true; for (const c of Object.values(this._ch)) c.es && c.es.close(); this._set("disconnected"); }
    resume() { this._dropped = false; for (const c of Object.values(this._ch)) { c.attach && c.attach(); } }
  }
  window.Ably = { Realtime };
})();
