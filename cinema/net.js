"use strict";
/* ==========================================================
   Moonlight Valley — co-op link: a serverless WebRTC data channel between two browsers.
   The game had no multiplayer, so this is the (one) connection everything co-op rides on:
   partner presence in the home + the cinema session. No backend: the two players swap a short
   invite code and reply code (copy/paste, chat, anything) to set the connection up.

   Events (link.on):  "status" {state, detail}   "open"   "down"   "restored"
                      and one event per message type, e.g. "pos", "cin:state"  -> (msg)
   ========================================================== */
const CoopLink = (() => {
  const ICE = [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun.cloudflare.com:3478" }];
  const conf = () => window.CINEMA_CONFIG || {};
  const iceServers = () => (Array.isArray(conf().iceServers) && conf().iceServers.length ? conf().iceServers : ICE);   // optional: your own TURN in cinema/config.js
  const WATCHDOG_MS = () => Math.max(2000, +conf().connectWatchdogMs || 20000);
  // what a candidate line is: type (host/srflx/relay/prflx), and whether the address is a hidden "<uuid>.local" name (browser privacy feature)
  const candInfo = (line) => { const m = /candidate:\S+ \d+ (\w+) \d+ (\S+) \d+ typ (\w+)/.exec(line || ""); return m ? { proto: m[1].toLowerCase(), type: m[3], mdns: /\.local$/i.test(m[2]) } : null; };
  const countCands = (sdp) => { const c = { host: 0, srflx: 0, relay: 0, prflx: 0, mdns: 0 }; for (const l of String(sdp || "").split(/\r?\n/)) { if (!l.startsWith("a=candidate")) continue; const i = candInfo(l); if (i) { c[i.type] = (c[i.type] || 0) + 1; if (i.mdns) c.mdns++; } } return c; };
  // Structure of an SDP without any secret in it (no ufrag/pwd/fingerprint values, no addresses): is it complete enough to connect?
  const sdpShape = (sdp) => {
    const t = String(sdp || ""), L = t.split(/\r?\n/), m = L.filter((l) => l.startsWith("m="));
    const has = (re) => L.some((l) => re.test(l));
    return { mLines: m.map((l) => l.split(" ").slice(0, 2).join(" ")), application: m.some((l) => /^m=application \d+ /.test(l) && !/^m=application 0 /.test(l)),
      iceUfrag: has(/^a=ice-ufrag:\S+/), icePwd: has(/^a=ice-pwd:\S+/), fingerprint: has(/^a=fingerprint:\S+ \S+/), setup: (L.find((l) => l.startsWith("a=setup:")) || "").slice(8) || null,
      sctp: has(/^a=sctp-port:|^a=sctpmap:/), endOfCandidates: has(/^a=end-of-candidates/), iceOptions: (L.find((l) => l.startsWith("a=ice-options:")) || "").slice(14) || null, candidates: countCands(t) };
  };
  const MAX_MSG = 16 * 1024, MAX_PER_SEC = 240;
  const PING_MS = 2500, WARN_MS = 9000, DEAD_MS = 40000;

  /* ---- invite codes: JSON -> (deflate) -> base64url, prefixed so we know how to read them ---- */
  const b64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
  const unb64 = (t) => { const s = atob(t.replace(/-/g, "+").replace(/_/g, "/")); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
  async function pipe(u8, Stream) { const s = new Blob([u8]).stream().pipeThrough(new Stream("deflate-raw")); return new Uint8Array(await new Response(s).arrayBuffer()); }
  async function encodeCode(obj) {
    const raw = new TextEncoder().encode(JSON.stringify(obj));
    if (typeof CompressionStream !== "undefined") { try { return "MV1z." + b64(await pipe(raw, CompressionStream)); } catch (e) { /* fall through */ } }
    return "MV1." + b64(raw);
  }
  async function decodeCode(code) {
    const t = String(code || "").replace(/\s+/g, "");
    let u8;
    if (t.startsWith("MV1z.")) {
      if (typeof DecompressionStream === "undefined") throw new Error("This browser can't read compressed codes. Use a current Chrome, Edge, Firefox or Safari.");
      u8 = await pipe(unb64(t.slice(5)), DecompressionStream);
    } else if (t.startsWith("MV1.")) u8 = unb64(t.slice(4));
    else throw new Error("That isn't a Moonlight Valley co-op code.");
    if (u8.length > 40000) throw new Error("That code is too large.");
    let o; try { o = JSON.parse(new TextDecoder().decode(u8)); } catch (e) { throw new Error("That code is damaged. Copy it again, completely."); }
    if (!o || typeof o !== "object" || typeof o.sdp !== "string" || !/^v=0/.test(o.sdp) || (o.type !== "offer" && o.type !== "answer")) throw new Error("That code is damaged.");
    return o;
  }

  class Link {
    constructor(self) {
      this.self = self;                      // { id, name, gender } of the local player
      this.handlers = {}; this.state = "idle"; this.detail = "";
      this.role = null;                      // "initiator" (made the invite) | "joiner"
      this.peer = null;                      // { id, name } after hello
      this.pc = null; this.dc = null;
      this.offset = 0; this.rtt = null; this._samples = [];
      this.lastRx = 0; this._rate = []; this._wasOpen = false;
      this.oid = null;                       // id of the current invite; the reply echoes it so a reply can only match its own invite
      this._q = Promise.resolve();           // SDP operations run one at a time (see _run)
      this._appliedSdp = null; this._joined = null;
      this.logs = [];                        // last signalling log lines (no SDP text, no secrets); also printed with console.debug
    }
    _log(msg) {
      const pc = this.pc, line = `[coop ${String(this.self.id).slice(0, 6)} ${this.role || "-"}${this.peer ? " peer " + String(this.peer.id).slice(0, 6) : ""}] ${msg}` + (pc ? ` (signaling=${pc.signalingState}, ice=${pc.iceConnectionState})` : "");
      this.logs.push(line); if (this.logs.length > 60) this.logs.shift();
      try { console.debug(line); } catch (e) { /* ignore */ }
    }
    // Every SDP operation (create invite / create reply / apply reply) goes through this queue: two clicks, a double paste or a
    // reply arriving while the invite is still being built can no longer interleave and hit setRemoteDescription in the wrong state.
    _run(name, fn) {
      const run = this._q.then(() => { this._log(`${name}: start`); return fn(); });
      this._q = run.then(() => {}, () => {});
      return run;
    }
    on(type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn); return () => { this.handlers[type] = (this.handlers[type] || []).filter((f) => f !== fn); }; }
    emit(type, ...a) { for (const f of (this.handlers[type] || []).slice()) { try { f(...a); } catch (e) { console.error("[coop]", type, e); } } }
    set(state, detail = "") { if (state === this.state && detail === this.detail) return; this.state = state; this.detail = detail; this.emit("status", { state, detail }); }
    get open() { return !!this.dc && this.dc.readyState === "open"; }
    peerNow() { return Date.now() + this.offset; }                  // the partner's clock, estimated

    _newPc() {
      this.close(true);
      const pc = (this.pc = new RTCPeerConnection({ iceServers: iceServers(), iceTransportPolicy: conf().iceTransportPolicy === "relay" ? "relay" : "all" }));
      this.gather = { host: 0, srflx: 0, relay: 0, prflx: 0, mdns: 0, errors: [] };
      pc.onicecandidate = (e) => {
        if (!e.candidate) { this._log(`ice gathering finished: host=${this.gather.host} (hidden .local names: ${this.gather.mdns}) srflx=${this.gather.srflx} relay=${this.gather.relay}`); return; }
        const i = candInfo(e.candidate.candidate); if (!i) return;
        this.gather[i.type] = (this.gather[i.type] || 0) + 1; if (i.mdns) this.gather.mdns++;
        this._log(`local ice candidate: ${i.type}/${i.proto}${i.mdns ? " (hidden .local name)" : ""}`);   // never the address itself
      };
      pc.onicecandidateerror = (e) => { const t = `${e.errorCode || "?"} ${String(e.errorText || "").slice(0, 60)} via ${String(e.url || "").replace(/^(stuns?|turns?):/, "$1:").slice(0, 60)}`; this.gather.errors.push(t); this._log("ice candidate error: " + t); };
      pc.onicegatheringstatechange = () => this._log(`ice gathering: ${pc.iceGatheringState}`);
      pc.onsignalingstatechange = () => this._log(`signaling state -> ${pc.signalingState}`);
      pc.onconnectionstatechange = () => this._log(`connection state -> ${pc.connectionState}`);
      pc.oniceconnectionstatechange = () => {
        const s = pc.iceConnectionState; this._log(`ice connection state -> ${s}`);
        if (s === "disconnected") { if (this._wasOpen) this.set("reconnecting", "Connection unstable… trying to recover"); }
        else if (s === "failed" || s === "closed") { this._failWith(s === "failed"); }
        else if ((s === "connected" || s === "completed") && this.dc && this.dc.readyState === "open" && this.state === "reconnecting") { this.set("open", ""); this.emit("restored"); }
      };
      return pc;
    }
    async _failWith(isIceFailure) {
      if (this.state === "closed" || this.state === "failed") return;
      if (this._wasOpen || !isIceFailure) return this._down("The connection was lost.");
      const d = await this.diagnose(); this._log("ICE FAILED: " + d.text); this._down(d.text);
    }
    // A complete, sanitized picture of the connection right now (copy it from the Co-op panel and send it): negotiation states, the shape of both
    // SDPs, the transports, and every ICE candidate pair with its state. Contains no addresses, ICE passwords, fingerprints or tokens.
    async report() {
      const pc = this.pc, r = { when: new Date().toISOString(), self: String(this.self.id).slice(0, 6), role: this.role, peer: this.peer ? String(this.peer.id).slice(0, 6) : null, link: this.state, detail: this.detail, oid: this.oid ? String(this.oid).slice(0, 6) : null, pc: !!pc };
      if (!pc) return r;
      r.states = { signaling: pc.signalingState, iceGathering: pc.iceGatheringState, ice: pc.iceConnectionState, connection: pc.connectionState, dataChannel: this.dc ? this.dc.readyState : null };
      r.gathered = Object.assign({}, this.gather);
      r.localSdp = sdpShape(pc.localDescription && pc.localDescription.sdp); r.remoteSdp = sdpShape(pc.remoteDescription && pc.remoteDescription.sdp);
      r.localDescType = pc.localDescription && pc.localDescription.type; r.remoteDescType = pc.remoteDescription && pc.remoteDescription.type;
      try { const tr = pc.sctp && pc.sctp.transport; r.sctp = pc.sctp ? { state: pc.sctp.state, dtls: tr && tr.state, iceTransport: tr && tr.iceTransport ? { state: tr.iceTransport.state, gathering: tr.iceTransport.gatheringState, role: tr.iceTransport.role } : null } : null; } catch (e) { r.sctp = "unavailable"; }
      r.signalling = "candidates travel INSIDE the invite/reply codes (no trickle, no addCandidate calls): local " + JSON.stringify(countCands(pc.localDescription && pc.localDescription.sdp)) + ", remote " + JSON.stringify(countCands(pc.remoteDescription && pc.remoteDescription.sdp));
      r.pairs = []; r.selected = null;
      try {
        const st = await pc.getStats(), byId = {}; st.forEach((x) => { byId[x.id] = x; });
        const cd = (c) => c ? { type: c.candidateType, proto: c.protocol, hidden: /\.local$/i.test(c.address || c.ip || "") } : null;
        st.forEach((x) => {
          if (x.type === "candidate-pair") r.pairs.push({ state: x.state, nominated: !!x.nominated, selected: !!x.selected, local: cd(byId[x.localCandidateId]), remote: cd(byId[x.remoteCandidateId]), sent: x.requestsSent, recv: x.responsesReceived, rtt: x.currentRoundTripTime });
          if (x.type === "transport" && x.selectedCandidatePairId && byId[x.selectedCandidatePairId]) { const p = byId[x.selectedCandidatePairId]; r.selected = { local: cd(byId[p.localCandidateId]), remote: cd(byId[p.remoteCandidateId]), state: p.state, nominated: !!p.nominated }; }
        });
      } catch (e) { r.statsError = String(e && e.message || e).slice(0, 80); }
      r.pairSummary = r.pairs.reduce((a, p) => { a[p.state] = (a[p.state] || 0) + 1; return a; }, {});
      r.nominatedSucceeded = r.pairs.some((p) => p.nominated && p.state === "succeeded");
      r.logTail = this.logs.slice(-14);
      return r;
    }
    async reportText() { return JSON.stringify(await this.report(), null, 1); }
    _snapshotLoop() {
      clearInterval(this._snap); const pc = this.pc; let n = 0;
      this._snap = setInterval(async () => {
        if (this.pc !== pc || this.open || ++n > 12) { clearInterval(this._snap); return; }
        const r = await this.report();
        this._log(`snapshot: ice=${r.states && r.states.ice} conn=${r.states && r.states.connection} sctp=${JSON.stringify(r.sctp && r.sctp.iceTransport ? r.sctp.iceTransport : r.sctp)} pairs=${JSON.stringify(r.pairSummary)} remoteSdp(application=${r.remoteSdp && r.remoteSdp.application}, ufrag=${r.remoteSdp && r.remoteSdp.iceUfrag}, cands=${r.remoteSdp && JSON.stringify(r.remoteSdp.candidates)})`);
      }, 3000);
    }
    // Why isn't it connecting? Looks at what each side gathered and what the browser's connectivity checks did. No addresses are logged.
    async diagnose() {
      const pc = this.pc, out = { local: Object.assign({}, this.gather || {}), remote: countCands(pc && pc.remoteDescription && pc.remoteDescription.sdp), pairs: {}, ice: pc && pc.iceConnectionState, text: "" };
      try { if (pc) (await pc.getStats()).forEach((r) => { if (r.type === "candidate-pair") out.pairs[r.state] = (out.pairs[r.state] || 0) + 1; }); } catch (e) { /* ignore */ }
      const L = out.local, R = out.remote, succeeded = out.pairs.succeeded || 0;
      let why;
      const rs = sdpShape(pc && pc.remoteDescription && pc.remoteDescription.sdp);
      if (pc && !pc.remoteDescription) why = "This side never received the other side's code (no remote description). Paste the codes again in order: invite → reply.";
      else if (pc && pc.remoteDescription && (!rs.application || !rs.iceUfrag || !rs.fingerprint)) why = "The other side's code is incomplete (missing data-channel section, ICE credentials or fingerprint). Copy the whole code again.";
      else if (!Object.keys(out.pairs).length && out.ice !== "new") why = "The browser started ICE but formed no candidate pairs (no usable address on one side). Use “Copy connection report” and send it.";
      else if (succeeded) why = "A route was found but the data channel did not open. Try creating a new invite.";
      else if (!R.host && !R.srflx && !R.relay) why = "The other side's code contained no network addresses at all. Create a new invite and copy both codes again, completely.";
      else if (L.srflx === 0 && L.relay === 0 && R.srflx === 0 && R.relay === 0 && (L.mdns || R.mdns)) why = "Neither browser found its public address (the Google/Cloudflare STUN servers are unreachable from this network, e.g. blocked, offline or a VPN), and both hide their local address behind a private “.local” name that a different browser/app usually cannot look up. So the two have no way to reach each other.";
      else if (L.mdns && R.mdns && !(out.pairs["in-progress"] === 0 && succeeded)) why = "Both browsers hide their local addresses behind private “.local” names. Two different browsers (or a firewall/VPN that blocks local-network lookups) cannot resolve each other's names, and no public route worked either.";
      else why = "The two browsers could not find a working network route to each other (firewall, VPN or router that blocks direct connections). A relay (TURN) server would be needed on this network.";
      out.text = `Couldn't connect. ${why} [local host/srflx/relay=${L.host}/${L.srflx}/${L.relay}, remote=${R.host}/${R.srflx}/${R.relay}, checks=${JSON.stringify(out.pairs)}]`;
      return out;
    }
    // Every remote candidate that arrives inside a code (type / protocol / hidden-name only; no address, no SDP) and how many the
    // browser's ICE agent took. There is no addIceCandidate() in this design: candidates travel INSIDE the offer/answer codes
    // (no trickle), so "passed to ICE" == the setRemoteDescription() that applies that code succeeded.
    _logRemoteCands(sdp, from) {
      const lines = String(sdp || "").split(/\r?\n/).filter((l) => l.startsWith("a=candidate")); this.recv = { from, n: lines.length, types: {} };
      for (const l of lines) { const i = candInfo(l); if (!i) { this._log(`remote candidate from ${from}: unparsed`); continue; } this.recv.types[i.type] = (this.recv.types[i.type] || 0) + 1; this._log(`remote ice candidate from ${from}: ${i.type}/${i.proto}${i.mdns ? " (hidden .local name)" : ""}${/ typ \w+ .* tcptype /.test(l) ? " tcp" : ""}${/ [0-9a-f]*:[0-9a-f:]+ \d+ typ/i.test(l) ? " ipv6" : ""}`); }
      this._log(`remote candidates received=${lines.length}; handed to the ICE agent with the remote description (addIceCandidate is not used in this design); queue needed=no`);
    }
    // While connecting: every 2.5 s, what the browser's connectivity checks are doing (counts and states only).
    async _probeOnce() {
      const pc = this.pc; if (!pc) return;
      const pairs = [], lc = {}, rc = {}; let tr = null;
      try {
        const st = await pc.getStats(), byId = {}; st.forEach((r) => { byId[r.id] = r; });
        st.forEach((r) => {
          if (r.type === "local-candidate") lc[r.candidateType] = (lc[r.candidateType] || 0) + 1;
          else if (r.type === "remote-candidate") rc[r.candidateType] = (rc[r.candidateType] || 0) + 1;
          else if (r.type === "transport") tr = { dtls: r.dtlsState, ice: r.iceState };
          else if (r.type === "candidate-pair") pairs.push({ st: r.state, nom: !!r.nominated, l: (byId[r.localCandidateId] || {}).candidateType, r: (byId[r.remoteCandidateId] || {}).candidateType, req: r.requestsSent || 0, resp: r.responsesReceived || 0, reqRx: r.requestsReceived || 0 });
        });
      } catch (e) { this._log("stats unavailable: " + String(e.message || e).slice(0, 60)); return; }
      const sum = (k) => pairs.reduce((a, p) => a + p[k], 0);
      const line = `checks: pairs=${pairs.length} states=${JSON.stringify(pairs.reduce((a, p) => (a[p.st] = (a[p.st] || 0) + 1, a), {}))} stunRequestsSent=${sum("req")} responsesReceived=${sum("resp")} requestsReceivedFromPeer=${sum("reqRx")} transport=${JSON.stringify(tr)} localStats=${JSON.stringify(lc)} remoteStats=${JSON.stringify(rc)} remoteDescription=${pc.remoteDescription ? "set" : "MISSING"}`;
      this._log(line); (this.probes = this.probes || []).push({ at: Date.now(), pairs, lc, rc, tr }); if (this.probes.length > 8) this.probes.shift();
    }
    _armWatchdog() {
      clearTimeout(this._wd); clearInterval(this._probe); if (conf().iceDebug !== false) { this._probe = setInterval(() => { if (this.open || !this.pc) clearInterval(this._probe); else this._probeOnce(); }, 2500); } const pc = this.pc, ms = WATCHDOG_MS(); this._snapshotLoop();
      this._wd = setTimeout(async () => {
        if (this.pc !== pc || this.open) return;
        const d = await this.diagnose(); if (this.pc !== pc || this.open) return;
        this._log(`still not connected after ${ms / 1000}s: ${d.text}`);
        this.set(this.state === "answering" ? "answering" : "connecting", "Still trying… " + d.text);
        this._wd = setTimeout(() => { if (this.pc === pc && !this.open) { this._log("giving up: " + d.text); this._down(d.text); } }, ms);
      }, ms);
    }
    _wire(dc) {
      this.dc = dc;
      this._log(`data channel "${dc.label}" ${dc.readyState}`);
      dc.onopen = () => {
        clearTimeout(this._wd); clearInterval(this._snap); this._log(`data channel "${dc.label}" OPEN`);
        this._wasOpen = true; this.lastRx = performance.now(); this.set("open", "");
        this.send("hello", { id: this.self.id, name: this.self.name, g: this.self.gender, init: this.role === "initiator" });
        this.emit("open");
        this._startBeat();
      };
      dc.onclose = () => { this._log(`data channel "${dc.label}" closed`); this._down("Your partner disconnected."); };
      dc.onerror = (e) => { this._log("data channel error: " + String((e && e.error && e.error.message) || "unknown").slice(0, 80)); };
      dc.onmessage = (e) => this._rx(e.data);
    }
    _waitIce(pc) {
      return new Promise((resolve) => {
        if (pc.iceGatheringState === "complete") return resolve();
        const done = () => { clearTimeout(t); pc.removeEventListener("icegatheringstatechange", chk); resolve(); };
        const chk = () => { if (pc.iceGatheringState === "complete") done(); };
        const t = setTimeout(done, 6000);                             // use whatever candidates we have by then
        pc.addEventListener("icegatheringstatechange", chk);
      });
    }

    /* ---- setup: initiator -> invite code; joiner pastes it -> reply code; initiator pastes the reply ---- */
    // Roles are fixed (the invite maker always offers, the joiner always answers), so the two sides can never send competing
    // offers; "perfect negotiation" collision handling is not needed. What was missing was guarding the answer step itself.
    createInvite() {
      return this._run("createInvite", async () => {
        this.role = "initiator"; this.peer = null; this._wasOpen = false; this._appliedSdp = null; this._joined = null;
        this.oid = (crypto.getRandomValues(new Uint32Array(2)).join("") + Date.now().toString(36)).slice(0, 24);
        const pc = this._newPc(); this.set("offering", "Creating your invite…");
        this._wire(pc.createDataChannel("mv-coop", { ordered: true }));
        await pc.setLocalDescription(await pc.createOffer());
        await this._waitIce(pc);
        if (this.pc !== pc) throw new Error("A newer invite replaced this one. Use the newest invite code.");
        this._log("invite ready");
        this.set("offering", "Send the invite code to your partner, then paste their reply code below.");
        return encodeCode({ v: 1, type: "offer", oid: this.oid, sdp: pc.localDescription.sdp });
      });
    }
    acceptInvite(code) {
      return this._run("acceptInvite", async () => {
        const o = await decodeCode(code);
        if (o.type !== "offer") throw new Error("That is a reply code. Paste the invite code your partner sent you.");
        // the same invite pasted again (double click): hand back the reply we already made instead of building a second, competing answer
        const j = this._joined;
        if (j && j.sdp === o.sdp && this.pc === j.pc && !/closed|failed/.test(this.pc.connectionState) && this.pc.signalingState === "stable") {
          this._log("duplicate invite: returning the reply already created"); return j.code;
        }
        this.role = "joiner"; this.peer = null; this._wasOpen = false; this.oid = typeof o.oid === "string" ? o.oid.slice(0, 40) : null;
        const pc = this._newPc(); this.set("answering", "Creating your reply…");
        pc.ondatachannel = (e) => this._wire(e.channel);
        const before = pc.signalingState;
        await pc.setRemoteDescription({ type: "offer", sdp: o.sdp });
        this._log(`remote offer applied: signaling ${before} -> ${pc.signalingState}; remote candidates ${JSON.stringify(countCands(o.sdp))}`);
        this._logRemoteCands(o.sdp, "host invite");
        await pc.setLocalDescription(await pc.createAnswer());
        await this._waitIce(pc);
        if (this.pc !== pc) throw new Error("A newer invite replaced this one. Paste the invite again.");
        const out = await encodeCode({ v: 1, type: "answer", oid: this.oid, sdp: pc.localDescription.sdp });
        this._joined = { sdp: o.sdp, pc, code: out }; this._armWatchdog();
        this._log("reply ready");
        this.set("answering", "Send this reply code back to your partner. The link opens when they paste it.");
        return out;
      });
    }
    acceptAnswer(code) {
      return this._run("acceptAnswer", async () => {
        const pc = this.pc;
        if (!pc || this.role !== "initiator") throw new Error("Create an invite first.");
        const o = await decodeCode(code);
        if (o.type !== "answer") throw new Error("That is an invite code. Paste the reply code your partner sent back.");
        if (o.oid && this.oid && o.oid !== this.oid) { this._log(`stale reply refused (reply ${String(o.oid).slice(0, 6)} != invite ${this.oid.slice(0, 6)})`); throw new Error("That reply belongs to an older invite. Paste the reply to your newest invite, or create a new invite and send it again."); }
        if (this.pc !== pc) throw new Error("Your invite was replaced while this reply was being read. Paste the reply again.");
        const st = pc.signalingState;
        if (st === "have-local-offer") {
          this.set("connecting", "Connecting…");
          await pc.setRemoteDescription({ type: "answer", sdp: o.sdp });
          this._appliedSdp = o.sdp; this._log(`answer applied: signaling ${st} -> ${pc.signalingState}; remote candidates ${JSON.stringify(countCands(o.sdp))}`); this._logRemoteCands(o.sdp, "joiner reply"); this._armWatchdog();
          return;
        }
        // not waiting for an answer: say precisely why, never hand the browser an answer it must reject
        if (st === "stable" && this._appliedSdp === o.sdp) { this._log("duplicate answer ignored (this exact reply was already applied)"); return; }
        if (st === "stable" && this._appliedSdp) { this._log("different answer refused: this invite already has a partner"); throw new Error("This invite was already used by a reply. To connect to someone else, create a new invite."); }
        this._log(`answer refused in state ${st}`);
        throw new Error("The invite isn't ready for a reply yet. Wait for “Invite ready”, then paste again.");
      });
    }

    /* ---- messages ---- */
    send(type, payload = {}) {
      if (!this.open) return false;
      try { this.dc.send(JSON.stringify({ ...payload, t: type, f: this.self.id })); return true; } catch (e) { return false; }
    }
    _rx(data) {
      if (typeof data !== "string" || data.length > MAX_MSG) return;
      const now = performance.now();
      this._rate = this._rate.filter((t) => now - t < 1000); if (this._rate.length >= MAX_PER_SEC) return; this._rate.push(now);
      let m; try { m = JSON.parse(data); } catch (e) { return; }
      if (!m || typeof m !== "object" || typeof m.t !== "string" || m.t.length > 24 || typeof m.f !== "string") return;
      this.lastRx = now;
      if (m.t === "hello") {
        if (typeof m.id !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(m.id) || m.id !== m.f || m.id === this.self.id) return;
        const nm = typeof m.name === "string" ? m.name.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 24) : "";
        const first = !this.peer || this.peer.id !== m.id;
        this.peer = { id: m.id, name: nm || "Partner", gender: m.g === "female" ? "female" : "male", initiator: !!m.init };
        this.initiatorId = this.role === "initiator" ? this.self.id : m.id;
        this.emit("hello", this.peer, first);
        return;
      }
      if (!this.peer || m.f !== this.peer.id) return;                // ignore anything not from the partner we said hello to
      if (m.t === "ping") { this.send("pong", { t0: m.t0, t1: Date.now() }); return; }
      if (m.t === "pong") { this._pong(m); return; }
      this.emit(m.t, m);
    }
    _pong(m) {
      if (typeof m.t0 !== "number" || typeof m.t1 !== "number") return;
      const t2 = Date.now(), rtt = t2 - m.t0; if (rtt < 0 || rtt > 10000) return;
      this._samples.push({ rtt, off: m.t1 - (m.t0 + rtt / 2) }); if (this._samples.length > 10) this._samples.shift();
      const best = this._samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));       // the lowest-latency sample is the most trustworthy
      this.rtt = best.rtt; this.offset = best.off;
    }
    _startBeat() {
      clearInterval(this._beat);
      this._beat = setInterval(() => {
        if (!this.open) return;
        this.send("ping", { t0: Date.now() });
        const idle = performance.now() - this.lastRx;
        if (idle > DEAD_MS) this._down("No answer from your partner.");
        else if (idle > WARN_MS && this.state === "open") this.set("reconnecting", "No news from your partner… waiting");
        else if (idle <= WARN_MS && this.state === "reconnecting" && this.pc && /connected|completed/.test(this.pc.iceConnectionState)) { this.set("open", ""); this.emit("restored"); }
      }, PING_MS);
    }
    _down(reason) {
      if (this.state === "closed" || this.state === "failed") return;
      clearInterval(this._beat);
      const had = this._wasOpen; this._wasOpen = false;
      this.set(had ? "failed" : "failed", reason);
      if (had) this.emit("down", reason);
    }
    close(quiet) {
      clearInterval(this._beat); clearTimeout(this._wd); clearInterval(this._snap);
      try { if (this.dc) { this.dc.onclose = this.dc.onmessage = this.dc.onopen = null; this.dc.close(); } } catch (e) { /* ignore */ }
      try { if (this.pc) { const q = this.pc; q.oniceconnectionstatechange = q.onconnectionstatechange = q.onicecandidate = q.onicecandidateerror = q.onicegatheringstatechange = q.onsignalingstatechange = null; q.close(); } } catch (e) { /* ignore */ }
      this.dc = null; this.pc = null; this._samples = []; this.rtt = null; this.offset = 0;
      if (!quiet) { const had = this._wasOpen; this._wasOpen = false; this.peer = null; this.set("closed", ""); if (had) this.emit("down", "You closed the link."); }
    }
  }
  return { Link, encodeCode, decodeCode };
})();
