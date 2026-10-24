"use strict";
/* ==========================================================
   Moonlight Valley — co-op link through a realtime relay (Ably), coordinated by this site's own /api functions.

   Why: a direct browser-to-browser (WebRTC) link can't be made between some networks (VPNs, mobile hotspots, strict NATs)
   without a relay server. Here both players connect OUTWARD to Ably over HTTPS/WebSocket, so it works anywhere the web works.

   RelayLink is a drop-in replacement for CoopLink.Link: same events ("status", "open", "hello", "down", "restored", one event
   per message type), same send(type, payload), same fields (open, peer, state, detail, rtt, peerNow()). The cinema session, chat,
   emotes and movement code above it are unchanged. Only small control messages go through it (movement, play/pause/seek, chat).
   Video bytes never do: each browser plays the video itself.

   Flow:  host: POST /api/room -> invite code "MV2.<room>.<key>"     joiner: pastes the code, no reply code needed
          both: POST /api/auth {room, key, clientId} -> Ably token request limited to channel "mv:<room>" -> Ably.Realtime
   ========================================================== */
const CoopRelay = (() => {
  const conf = () => window.CINEMA_CONFIG || {};
  const CODE_RE = /^MV2\.([a-z0-9]{6,10}_[A-Za-z0-9_-]{10,12})\.([A-Za-z0-9_-]{32,64})$/;
  const PING_MS = 2500, WARN_MS = 9000, DEAD_MS = 40000, JOIN_TIMEOUT_MS = 20000;
  const apiBase = () => String(conf().apiBase || "/api").replace(/\/+$/, "");

  // "relay" when asked, or (default "auto") when the game is served from a real website rather than localhost / a file.
  function wanted() {
    const t = conf().coopTransport || "auto";
    if (t === "relay") return true; if (t === "p2p") return false;
    const h = location.hostname; return /^https?:$/.test(location.protocol) && !/^(localhost|127\.|\[?::1\]?$)/.test(h) && h !== "";
  }

  let sdkP = null;
  function loadSdk() {
    if (window.Ably && window.Ably.Realtime) return Promise.resolve();
    if (sdkP) return sdkP;
    sdkP = new Promise((resolve, reject) => {
      const s = document.createElement("script"), t = setTimeout(() => { sdkP = null; s.remove(); reject(new Error("The co-op connection library didn't load (slow network?). Reload the page and try again.")); }, 20000);
      s.src = conf().ablySdkUrl || "cinema/vendor/ably.min.js"; s.async = true;
      s.onload = () => { clearTimeout(t); window.Ably && window.Ably.Realtime ? resolve() : (sdkP = null, reject(new Error("The co-op connection library loaded but is unusable."))); };
      s.onerror = () => { clearTimeout(t); sdkP = null; s.remove(); reject(new Error("Couldn't load the co-op connection library (blocked by the network or an extension).")); };
      document.head.appendChild(s);
    });
    return sdkP;
  }

  async function api(path, body) {
    let r;
    try { r = await fetch(apiBase() + "/" + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}), cache: "no-store", credentials: "omit" }); }
    catch (e) { throw new Error("Couldn't reach the game's co-op server. Check your internet connection."); }
    let j = null; try { j = await r.json(); } catch (e) { /* not JSON */ }
    if (!r.ok) throw new Error((j && j.message) || (r.status === 404 ? "This copy of the game has no co-op server (the /api folder isn't deployed). See README-MIGRATION.md." : `The co-op server had a problem (HTTP ${r.status}).`));
    return j;
  }

  class RelayLink extends CoopLink.Link {
    constructor(self) {
      super(self);
      this.relay = true; this.rt = null; this.ch = null; this._room = null; this._attached = false; this._tok0 = null; this._lastPos = ""; this._lastPosAt = 0;
      this.on("hello", (peer, first) => this._onHello(peer, first));            // registered first: runs before the game's own hello handler
    }
    _log(msg) {
      const line = `[coop-relay ${String(this.self.id).slice(0, 6)} ${this.role || "-"}${this.peer ? " peer " + String(this.peer.id).slice(0, 6) : ""}] ${msg}` + (this.rt ? ` (conn=${this.rt.connection.state}${this.ch ? ", channel=" + this.ch.state : ""})` : "");
      this.logs.push(line); if (this.logs.length > 60) this.logs.shift();
      try { console.debug(line); } catch (e) { /* ignore */ }
    }
    get open() { return !!(this.peer && this._attached && this.rt && this.rt.connection.state === "connected"); }

    /* ---- setup ---- */
    createInvite() {
      return this._run("createRoom", async () => {
        this.close(true); this.role = "initiator"; this.peer = null; this._wasOpen = false;
        this.set("offering", "Creating your room…");
        const r = await api("room"), m = CODE_RE.exec(r.code || ""); if (!m) throw new Error("The co-op server sent back an invalid invite.");
        await this._connect(m[1], m[2]);
        this.set("offering", "Room ready. Send the invite to your partner. You're connected as soon as they join.");
        return r.code;
      });
    }
    acceptInvite(code) {
      return this._run("joinRoom", async () => {
        const m = CODE_RE.exec(String(code || "").replace(/\s+/g, ""));
        if (!m) throw new Error(/^MV1/.test(String(code || "").trim()) ? "That is an old-style invite (MV1…). Ask your partner to create a new invite." : "That isn't a Moonlight Valley invite code.");
        this.close(true); this.role = "joiner"; this.peer = null; this._wasOpen = false;
        this.set("connecting", "Joining the room…");
        await this._connect(m[1], m[2]);
        this.set(this.peer ? "open" : "answering", this.peer ? "" : "In the room. Waiting for your partner to be online…");
        return "Joined. No reply code is needed.";
      });
    }
    async acceptAnswer() { throw new Error("A reply code isn't needed any more: your partner joins straight from your invite."); }

    async _token(roomId, key) {
      if (this._tok0) { const t = this._tok0; this._tok0 = null; return t; }                  // the one fetched while checking the invite
      return api("auth", { roomId, key, clientId: this.self.id });
    }
    async _connect(roomId, key) {
      this._room = { roomId, key };
      this._tok0 = await api("auth", { roomId, key, clientId: this.self.id });                // fails fast with a clear message: bad / expired invite, server not configured
      await loadSdk();
      const Ably = window.Ably, rt = (this.rt = new Ably.Realtime({ authCallback: (tp, cb) => this._token(roomId, key).then((t) => cb(null, t), (e) => cb({ message: e.message, code: 40101 })), echoMessages: false }));
      rt.connection.on((sc) => this._onConn(sc.current, sc.reason));
      const ch = (this.ch = rt.channels.get("mv:" + roomId));
      ch.subscribe("m", (msg) => { if (typeof msg.data === "string") this._rx(msg.data); });
      ch.presence.subscribe((pm) => this._onPresence(pm));
      await new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error("Couldn't reach the realtime service. Check your internet connection, VPN or firewall, then try again.")), JOIN_TIMEOUT_MS);
        ch.attach((err) => { clearTimeout(t); err ? rej(new Error("Couldn't join the room: " + String(err.message || err).slice(0, 120))) : res(); });
      }).catch((e) => { this._teardown(); throw e; });
      await new Promise((res) => ch.presence.enter({ n: this.self.name }, () => res()));
      const others = await new Promise((res) => ch.presence.get((err, list) => res(err ? [] : (list || []).filter((m) => m.clientId !== this.self.id))));
      if (others.length >= 2) { this._teardown(); throw new Error("This room already has two players."); }
      this._attached = true; this._log("joined room channel"); this._sendHello();
    }
    _teardown() {
      clearInterval(this._beat); this._attached = false;
      const rt = this.rt, ch = this.ch; this.rt = this.ch = null;
      try { if (ch) ch.presence.leave(); } catch (e) { /* ignore */ }
      try { if (rt) setTimeout(() => { try { rt.close(); } catch (e) { /* ignore */ } }, 50); } catch (e) { /* ignore */ }
    }

    /* ---- connection / presence events ---- */
    _onConn(state, reason) {
      this._log(`realtime connection -> ${state}${reason && reason.message ? ": " + String(reason.message).slice(0, 80) : ""}`);
      if (state === "connected") { if (this._attached) this._sendHello(); }
      else if (state === "disconnected" || state === "suspended") { if (this._wasOpen || this.peer) this.set("reconnecting", "Lost the connection to the co-op server. Reconnecting…"); }
      else if (state === "failed") this._down("The co-op connection failed: " + String((reason && reason.message) || "unknown error").slice(0, 100));
    }
    _onPresence(pm) {
      if (!pm || pm.clientId === this.self.id) return;
      if (pm.action === "leave" || pm.action === "absent") { if (this.peer && this.peer.id === pm.clientId) this._peerGone("Your partner left."); }
      else if ((pm.action === "enter" || pm.action === "present") && !this.peer) this._sendHello();       // someone arrived: make sure they hear from us
    }
    _peerGone(why) {
      if (!this.peer) return;
      this._log("partner gone: " + why); clearInterval(this._beat); this.peer = null; this._lastPos = "";
      if (this._wasOpen) { this.set("reconnecting", "Your partner disconnected. Waiting for them to come back…"); this.emit("down", why || "Your partner disconnected."); }
    }
    _down(reason) {                                               // overrides Link._down: a silent partner can still come back, a failed service can't
      if (reason === "No answer from your partner.") return this._peerGone(reason);
      if (this.state === "closed" || this.state === "failed") return;
      clearInterval(this._beat); const had = this._wasOpen; this._wasOpen = false; this.set("failed", reason); if (had) this.emit("down", reason);
    }
    _sendHello() { this._pub({ t: "hello", f: this.self.id, id: this.self.id, name: this.self.name, g: this.self.gender, init: this.role === "initiator" }); }
    _onHello(peer, first) {
      this.lastRx = performance.now();
      if (first) this._sendHello();                               // answer a new arrival once (no ping-pong: the answer isn't "first" for them)
      this._startBeat();
      if (!this._wasOpen) { this._wasOpen = true; this.set("open", ""); this.emit("open"); }
      else if (this.state !== "open") { this.set("open", ""); this.emit("restored"); }
    }
    _startBeat() {
      clearInterval(this._beat);
      this._beat = setInterval(() => {
        if (!this.open) return;
        this.send("ping", { t0: Date.now() });
        const idle = performance.now() - this.lastRx;
        if (idle > DEAD_MS) this._peerGone("No answer from your partner.");
        else if (idle > WARN_MS && this.state === "open") this.set("reconnecting", "No news from your partner… waiting");
        else if (idle <= WARN_MS && this.state === "reconnecting") { this.set("open", ""); this.emit("restored"); }
      }, PING_MS);
    }

    /* ---- messages ---- */
    _pub(obj) {
      if (!this.ch || !this.rt || this.rt.connection.state !== "connected") return false;
      try { this.ch.publish("m", JSON.stringify(obj), (err) => { if (err) this._log("publish failed: " + String(err.message || err).slice(0, 80)); }); return true; } catch (e) { return false; }
    }
    send(type, payload = {}) {
      if (!this.open) return false;
      if (type === "pos") {                                        // an unchanged position is repeated at most once a second (saves messages)
        const k = JSON.stringify(payload), now = performance.now();
        if (k === this._lastPos && now - this._lastPosAt < 1000) return true;
        this._lastPos = k; this._lastPosAt = now;
      }
      return this._pub({ ...payload, t: type, f: this.self.id });
    }
    close(quiet) {
      clearInterval(this._beat); this._teardown(); this._lastPos = ""; this._tok0 = null;
      if (!quiet) { const had = this._wasOpen; this._wasOpen = false; this.peer = null; this.set("closed", ""); if (had) this.emit("down", "You closed the link."); }
      else this.peer = null;
    }
    async report() {
      const rt = this.rt;
      return { when: new Date().toISOString(), transport: "relay", self: String(this.self.id).slice(0, 6), role: this.role, peer: this.peer ? String(this.peer.id).slice(0, 6) : null, link: this.state, detail: this.detail,
        room: this._room ? this._room.roomId.slice(0, 4) + "…" : null, connection: rt ? rt.connection.state : null, channel: this.ch ? this.ch.state : null, attached: this._attached, rttMs: this.rtt, logTail: this.logs.slice(-14) };
    }
  }

  // Used by room.js: the right link for this deployment.
  function make(self) { return wanted() ? new RelayLink(self) : new CoopLink.Link(self); }
  return { RelayLink, make, wanted, CODE_RE };
})();
