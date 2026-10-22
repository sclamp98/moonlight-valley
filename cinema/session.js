"use strict";
/* ==========================================================
   Moonlight Valley — co-op cinema: the shared session (two-way control).

   BOTH players have the same controls: either one can load a video, play, pause, seek, change speed or end the session,
   without the other approving anything. Nobody is "the host" of the video (the WebRTC link still has an inviter and a
   joiner, but that only matters for the connection, never for who may press Play).

   How two controllers stay consistent
     * The shared state is one small object (see CinemaCore.validateState). Every command creates a NEW state:
         rev = (highest rev this player has ever seen) + 1      a Lamport sequence number, so it only ever grows
         by  = who issued it     ts = the issuer's clock     cmd = load | play | pause | seek | rate | ended | end
       and is sent to the partner as "cin:state".
     * Both machines keep the newest state under one total order, (rev, then sender id): CinemaCore.newerState.
       => last valid command wins; two commands issued at the same moment are ordered the same way on both sides, so
          both end on the same final state; duplicates and stale / re-ordered messages are ignored.
     * Applying a received state NEVER sends a command back. Commands come only from this player's own button presses
       (plus one "the video ended" report), never from the player's play/pause/seek events — so there is no feedback loop.
     * Each player corrects only ITSELF against the shared timeline (position + elapsed time since the command), and only
       when it is really off, not more than once per cooldown, never while a command is still settling and never while
       its own player is buffering. Buffering is shared as a status ("Aisha is buffering") — it does NOT pause the
       partner, so there is no pause/play toggling; the one that buffered is brought back to the shared position
       when it recovers.

   Messages over the CoopLink data channel:
     cin:state  a new shared state (any command)                                       both
     cin:beat   2 s heartbeat {sessionId, by, rev, playback, position, ts, rate, buf}   both  (liveness, buffering, "are we on the same rev?")
     cin:req    "send me your full state"  (my partner's heartbeat shows a newer rev)   both
     cin:sync   {state, joined}   sent on (re)connect so both sides reconcile           both
     cin:pres   {joined}          I joined / left the session                           both
     cin:buf    {on}              my player started / stopped buffering                 both
     cin:err    {text}            my player could not play the video                    both

   Leaving policy
     - leave while the partner is still watching  -> the session simply continues for them
     - leave and nobody else is watching          -> the session ends
     - link drops while watching                  -> keep watching and keep control; when the link is back both snapshots are
                                                     compared and the newest command wins on both sides
   ========================================================== */
const CinemaSession = (() => {
  const C = CinemaCore, S = C.SYNC;
  const now = () => Date.now();
  const MAX_REV_JUMP = 10000;            // a partner can't push our sequence number into the stratosphere

  class Session {
    constructor({ self, container, notify }) {
      this.self = self;                 // { id, name }
      this.container = container;       // element the player is mounted into
      this.notify = notify || (() => {});
      this.state = null;                // newest shared state we know of (an ended session stays as a tombstone so ordering survives)
      this.clock = 0;                   // highest sequence number seen or issued
      this.joined = false;              // this player is in the session (has a player instance)
      this.peerJoined = false; this.peerBuffering = false; this.peerError = null;
      this.adapter = null; this.adapterProvider = null; this.adapterStatus = "none";   // none | connecting | ready | failed
      this.localState = "unstarted"; this.loadedVideo = null;
      this.error = null; this.needsGesture = false; this.needsAuth = false; this.peerStale = false;
      this.link = null; this._unsub = [];
      this.vol = 80; this.muted = false;
      this.listeners = new Set();
      this.lastSeekAt = 0; this.settleUntil = 0; this.peerSeenAt = 0; this.beatAt = 0; this.playExpectAt = 0; this.userGestureAt = 0; this.lastPushAt = 0;
      this._tick = null; this._alignTimer = null; this._wasBuffering = false;
    }

    /* ---------- wiring ---------- */
    onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    _changed() { for (const f of this.listeners) { try { f(); } catch (e) { console.error(e); } } }
    setLink(link) {
      this._unsub.forEach((u) => u()); this._unsub = [];
      this.link = link;
      if (!link) return;
      const on = (t, fn) => this._unsub.push(link.on(t, fn.bind(this)));
      on("hello", this._onHello); on("cin:sync", this._onSync); on("cin:state", this._onState); on("cin:beat", this._onBeat);
      on("cin:req", this._onReq); on("cin:pres", this._onPres); on("cin:buf", this._onBuf); on("cin:err", this._onErr);
      on("down", this._onDown);
    }
    get linked() { return !!this.link && this.link.open; }
    get peerId() { return this.link && this.link.peer ? this.link.peer.id : null; }
    get peerName() { return this.link && this.link.peer ? this.link.peer.name : null; }
    get active() { return !!this.state && this.state.status === "active"; }
    _send(type, payload) { return this.link ? this.link.send(type, payload) : false; }
    _gesture() { this.userGestureAt = now(); }                                   // a button press: browsers allow popups / autoplay for a few seconds after it
    _interactive() { return now() - this.userGestureAt < 4000; }
    // seconds that have passed on the shared timeline since the command was issued (clock-offset aware)
    _elapsed(st) {
      if (st.by === this.self.id) return Math.max(0, (now() - st.ts) / 1000);
      if (this.link && this.link.open && this.link.rtt != null) return Math.max(0, (this.link.peerNow() - st.ts) / 1000);
      return Math.max(0, (now() - (st.rxAt || now())) / 1000);                    // no clock estimate yet: count from when it arrived
    }
    _target(st) { return st.playback === "playing" ? Math.min(S.MAX_POSITION_S, st.position + this._elapsed(st) * st.rate) : st.position; }

    /* ---------- what the UI shows ---------- */
    info() {
      const a = this.adapter, ready = this.adapterStatus === "ready", st = this.state, live = this.active;
      let label, kind;
      if (this.error) { label = "Error"; kind = "error"; }
      else if (!live) { label = "Idle"; kind = "idle"; }
      else if (!this.joined) { label = "Session available"; kind = "idle"; }
      else if (this.needsAuth) { label = "Sign-in needed"; kind = "wait"; }
      else if (this.adapterStatus === "connecting" || this.adapterStatus === "none") { label = "Connecting"; kind = "wait"; }
      else if (this.localState === "buffering") { label = "Buffering"; kind = "wait"; }
      else if (this.localState === "unstarted") { label = "Loading"; kind = "wait"; }
      else if (this.localState === "playing") { label = "Playing"; kind = "play"; }
      else if (this.localState === "ended") { label = "Ended"; kind = "idle"; }
      else if (this.localState === "paused" || this.localState === "cued") { label = "Paused"; kind = "pause"; }
      else { label = "Loading"; kind = "wait"; }
      const mine = !!st && st.by === this.self.id;
      return {
        label, kind, active: live, joined: this.joined, state: live ? st : null, linked: this.linked, peerJoined: this.peerJoined,
        peerName: this.peerName, peerBuffering: this.peerBuffering, peerError: this.peerError, peerStale: this.peerStale,
        needsGesture: this.needsGesture, needsAuth: this.needsAuth, error: this.error, ready,
        // either player may control the video as soon as their own player is ready
        canControl: this.joined && live && ready && !this.needsAuth,
        lastAction: live && st ? { mine, who: mine ? "You" : this.peerName || "Your partner", cmd: st.cmd, position: st.position, provider: st.provider } : null,
        time: ready && this.joined ? a.time() : st ? st.position : 0, duration: ready && this.joined ? a.duration() : 0,
        rate: ready && this.joined ? a.rate() : st ? st.rate : 1, volume: this.vol, muted: this.muted, title: ready && this.joined ? a.title() : "",
        playing: this.localState === "playing", provider: live && st ? st.provider : null,
      };
    }

    /* ---------- player lifecycle ---------- */
    _ensureAdapter() {
      const want = this.state.provider;
      if (this.adapter && this.adapterProvider !== want) this._teardownPlayer();            // a different service needs a different kind of player
      if (this.adapter) return this.adapter;
      const provider = CinemaProviders.get(want);
      if (!provider || !provider.canSync) throw new Error("This provider can't be played in sync.");
      this.adapterStatus = "connecting"; this.localState = "unstarted"; this.adapterProvider = want;
      const ad = (this.adapter = provider.createPlayer(this.container, {
        onReady: () => { if (this.adapter !== ad) return; this.adapterStatus = "ready"; ad.setVolume(this.vol); ad.mute(this.muted); this._changed(); },
        onState: (s) => this._onLocalState(s),
        onError: (e) => this._onPlayerError(e),
        onRate: () => {},                                                                    // our own setRate echoes back here: never a command
      }));
      ad.ready.catch((err) => { if (this.adapter !== ad) return; this.adapterStatus = "failed"; this.error = (err && err.message) || "The video player couldn't start."; this._changed(); });
      clearInterval(this._tick); this._tick = setInterval(() => this._ticker(), 250);
      return ad;
    }
    _teardownPlayer() {
      clearInterval(this._tick); this._tick = null; clearTimeout(this._alignTimer); this._alignTimer = null;
      const ad = this.adapter; this.adapter = null; this.adapterProvider = null;
      if (ad) { try { ad.destroy(); } catch (e) { /* ignore */ } }
      this.adapterStatus = "none"; this.localState = "unstarted"; this.loadedVideo = null; this.needsGesture = false; this.needsAuth = false; this._wasBuffering = false; this.peerStale = false;
    }
    _loadCurrent(autoplay) {
      const st = this.state, ad = this._ensureAdapter();
      const pos = this._target(st);
      this.loadedVideo = st.videoId; this.localState = "unstarted"; this.needsAuth = false; this.error = null; this.settleUntil = now() + S.SETTLE_MS;
      if (autoplay) this.playExpectAt = now();
      ad.load(st.videoId, { start: Math.floor(pos), autoplay, interactive: this._interactive() }).catch((e) => this._onPlayerError(e && e.kind ? e : { message: (e && e.message) || "Couldn't load the video.", fatal: true }));
    }

    /* ---------- commands (either player) ---------- */
    // Make a new shared state from the current one + changes, broadcast it, and let our own player settle before auto-correction resumes.
    _issue(changes) {
      const base = this.state || {};
      this.clock = Math.max(this.clock, base.rev || 0) + 1;
      const st = Object.assign({}, base, changes, { by: this.self.id, rev: this.clock, ts: now() });
      delete st.rxAt;                                                              // local-only bookkeeping, never sent
      this.state = st; this.settleUntil = now() + S.SETTLE_MS; this.peerError = null;
      this._send("cin:state", { state: st });
      this._changed();
      return st;
    }
    _ctl() {
      if (!this.active) return { ok: false, error: "Load a video first." };
      if (!this.joined) return { ok: false, error: "Join the session first." };
      if (this.adapterStatus !== "ready") return { ok: false, error: "The player is still starting. One moment." };
      return null;
    }
    async loadVideo(input) {
      this._gesture();
      const parsed = CinemaProviders.resolve(input);
      if (!parsed.ok) return { ok: false, kind: parsed.kind, error: parsed.error };
      const provider = CinemaProviders.get(parsed.provider);
      if (!provider || !provider.canSync) return { ok: false, kind: "unsupported", error: "Unsupported link." };
      const av = provider.available ? provider.available() : { ok: true };
      if (!av.ok) return { ok: false, kind: "config", error: av.error };
      this.error = null; this.needsGesture = false;
      // a new link REPLACES the previous media session: fresh session id, paused at the start (or the link's own start time)
      this._issue({ sessionId: C.randomId(), provider: parsed.provider, videoId: parsed.videoId, start: parsed.start, playback: "paused", position: parsed.start, rate: 1, status: "active", cmd: "load" });
      const wasJoined = this.joined; this.joined = true;
      this._loadCurrent(false);
      if (!wasJoined) this._send("cin:pres", { sessionId: this.state.sessionId, joined: true });
      this._changed();
      return { ok: true, parsed };
    }
    play() {
      this._gesture(); const e = this._ctl(); if (e) return e;
      const ad = this.adapter, st = this.state;
      if (st.playback === "ended" || this.localState === "ended") { ad.seek(0); ad.play(); this._issue({ playback: "playing", position: 0, rate: ad.rate(), cmd: "play" }); }
      else { ad.play(); this._issue({ playback: "playing", position: ad.time(), rate: ad.rate(), cmd: "play" }); }
      this.playExpectAt = now(); this.needsGesture = false;
      return { ok: true };
    }
    pause() {
      this._gesture(); const e = this._ctl(); if (e) return e;
      const ad = this.adapter, pos = ad.time(); ad.pause(); this._issue({ playback: "paused", position: pos, rate: ad.rate(), cmd: "pause" });
      return { ok: true };
    }
    seek(t) {
      this._gesture(); const e = this._ctl(); if (e) return e;
      const ad = this.adapter, st = this.state, d = ad.duration(), pos = Math.max(0, d > 0 ? Math.min(t, d) : t);
      ad.seek(pos); this.lastSeekAt = now();
      this._issue({ playback: st.playback === "ended" ? "paused" : st.playback, position: pos, rate: ad.rate(), cmd: "seek" });
      return { ok: true };
    }
    setRate(r) {
      this._gesture(); const e = this._ctl(); if (e) return e;
      const ad = this.adapter, rate = C.nearestRate(r); ad.setRate(rate);
      this._issue({ position: ad.time(), rate, cmd: "rate" });                       // re-anchor the timeline at the moment the speed changed
      return { ok: true };
    }
    endSession() {
      this._gesture();
      if (!this.active) return { ok: false, error: "There is no session to end." };
      this._issue({ status: "ended", cmd: "end" });
      this._teardownPlayer(); this.joined = false; this.error = null; this.peerBuffering = false; this.peerError = null;
      this._send("cin:pres", { sessionId: this.state.sessionId, joined: false });
      this._changed(); return { ok: true };
    }

    /* ---------- everyone ---------- */
    setVolume(v) { this.vol = Math.max(0, Math.min(100, Math.round(v))); if (this.adapter && this.adapterStatus === "ready") { this.adapter.setVolume(this.vol); if (this.vol > 0 && this.muted) { this.muted = false; this.adapter.mute(false); } } this._changed(); }
    toggleMute() { this.muted = !this.muted; if (this.adapter && this.adapterStatus === "ready") this.adapter.mute(this.muted); this._changed(); }
    join() {
      this._gesture();
      if (!this.active || this.joined) return;
      this.error = null; this.joined = true; this._loadCurrent(this.state.playback === "playing");
      this._send("cin:pres", { sessionId: this.state.sessionId, joined: true }); this._changed();
    }
    leave() {
      if (!this.joined) return;
      const sid = this.state && this.state.sessionId;
      const partnerStays = this.peerJoined && this.linked;
      if (this.active && !partnerStays) this._issue({ status: "ended", cmd: "end" });     // nobody left watching: the session ends
      this._teardownPlayer(); this.joined = false; this.error = null;
      this._send("cin:pres", { sessionId: sid || "", joined: false }); this._changed();
    }
    // the player closed the game / left the room for good: tear everything down without side effects on the partner
    dispose() { this._unsub.forEach((u) => u()); this._unsub = []; this._teardownPlayer(); this.listeners.clear(); }
    resumeFromGesture() { this._gesture(); this.needsGesture = false; if (this.adapter && this.adapterStatus === "ready") { this.adapter.play(); this._align(true); } this._changed(); }
    // Google Drive: the browser only allows the sign-in popup right after a click, so this is the button's handler.
    async signIn() {
      this._gesture();
      const provider = this.state && CinemaProviders.get(this.state.provider);
      if (!provider || !provider.signIn) return { ok: false, error: "This video doesn't need a sign-in." };
      try { await provider.signIn(); } catch (e) { this.error = (e && e.message) || "Sign-in failed."; this._changed(); return { ok: false, error: this.error }; }
      this.needsAuth = false; this.error = null;
      if (this.joined && this.active) this._loadCurrent(this.state.playback === "playing");
      this._changed(); return { ok: true };
    }

    /* ---------- local player events (these only update status; they never create commands, except one "ended" report) ---------- */
    _onLocalState(s) {
      if (!this.adapter) return;
      this.localState = s;
      if (s === "playing" || s === "buffering") this.needsGesture = false;
      const buffering = s === "buffering";
      if (buffering !== this._wasBuffering) { this._wasBuffering = buffering; this._send("cin:buf", { on: buffering }); if (!buffering) this._align(true); }   // recovered: rejoin the shared position
      if (s === "ended" && this.active && this.state.playback === "playing" && now() >= this.settleUntil) this._issue({ playback: "ended", position: this.adapter.duration() || this.state.position, cmd: "ended" });
      else if (s === "cued" || s === "playing" || s === "paused") this._alignSoon();       // anything that changed the player on its own is brought back to the shared state
      this._changed();
    }
    _onPlayerError(e) {
      if (e && e.kind === "auth") { this.needsAuth = true; this.error = null; this._changed(); return; }              // not a failure: the player just needs the user to sign in (button)
      this.error = (e && e.message) || "The video couldn't be played."; this._send("cin:err", { text: this.error.slice(0, 200) }); this._changed();
    }

    /* ---------- follow the shared timeline (each player corrects only itself) ---------- */
    _alignSoon() { if (this._alignTimer) return; this._alignTimer = setTimeout(() => { this._alignTimer = null; this._align(); }, 350); }
    _align(force = false) {
      if (!this.joined || !this.adapter || this.adapterStatus !== "ready" || !this.active || this.needsAuth) return;
      const st = this.state, ad = this.adapter;
      if (this.loadedVideo !== st.videoId || this.adapterProvider !== st.provider) { this._loadCurrent(st.playback === "playing"); return; }
      const ls = ad.state(), t = now();
      if (!force && t < this.settleUntil) return;                                   // a command is still taking effect: don't fight it
      const act = C.desiredAction(st, ls);
      if (act === "play") { ad.play(); if (!this.playExpectAt || t - this.playExpectAt > 4000) this.playExpectAt = t; }
      else if (act === "pause") ad.pause();
      if (ls === "unstarted" || ls === "buffering") return;                         // nothing to seek yet / don't judge a player that is mid-buffer
      const wantRate = C.nearestRate(st.rate || 1);
      if (Math.abs(ad.rate() - wantRate) > 0.01) ad.setRate(wantRate);
      const target = this._target(st);
      if (st.playback === "playing") {
        if (C.decideSeek({ current: ad.time(), target: target + S.LEAD_S, nowMs: t, lastSeekMs: this.lastSeekAt, force })) { ad.seek(target + S.LEAD_S); this.lastSeekAt = t; }
      } else if (Math.abs(ad.time() - target) > 0.6 && (force || t - this.lastSeekAt > 800)) { ad.seek(target); this.lastSeekAt = t; }
    }
    _ticker() {
      const t = now();
      if (this.active && this.joined && this.adapterStatus === "ready" && t - this.beatAt >= S.BEAT_MS) {
        this.beatAt = t; const st = this.state;
        this._send("cin:beat", { sessionId: st.sessionId, by: st.by, rev: st.rev, playback: st.playback, position: this.adapter.time(), ts: t, rate: this.adapter.rate(), buf: this.localState === "buffering" });
      }
      if (this.active && this.joined) {
        const stale = this.linked && this.peerJoined && this.state.playback === "playing" && this.peerSeenAt && t - this.peerSeenAt > S.STALE_BEAT_MS;
        if (stale !== this.peerStale) { this.peerStale = !!stale; this._changed(); }
        if (!this.needsGesture && !this.needsAuth && this.state.playback === "playing" && this.playExpectAt && t - this.playExpectAt > 2500 && (this.localState === "unstarted" || this.localState === "paused" || this.localState === "cued")) { this.needsGesture = true; this._changed(); }
        if (t - (this._lastAlign || 0) > 1000) { this._lastAlign = t; this._align(); }
      }
    }

    /* ---------- messages from the partner ---------- */
    _seen() { this.peerSeenAt = now(); if (this.peerStale) { this.peerStale = false; this._changed(); } }
    _onHello() {
      this.peerJoined = false;                                                      // until they tell us otherwise
      this._send("cin:sync", { state: this.state, joined: this.joined });
    }
    _onSync(m) {
      this._seen(); this.peerJoined = !!m.joined;
      const remote = m.state ? this._accept(m.state, m.f) : null;
      const win = C.newerState(this.state, remote);
      if (remote && win === remote && win !== this.state) this._adopt(remote);
      else if (this.state && (!remote || C.order(this.state, remote) > 0)) this._send("cin:state", { state: this.state });     // we are ahead: bring them up to date
      this._changed();
    }
    // Validate a state from the partner. It may be their own command or an echo of ours (after a reconnect) — never anyone else's.
    _accept(raw, from) {
      const st = C.validateState(raw, CinemaProviders.syncable()); if (!st) return null;
      if (st.by !== from && st.by !== this.self.id) return null;
      if (st.rev > this.clock + MAX_REV_JUMP) return null;
      return st;
    }
    _adopt(st) {
      const cur = this.state;
      const sameMedia = cur && cur.sessionId === st.sessionId && cur.videoId === st.videoId && cur.provider === st.provider;
      st.rxAt = now();
      this.clock = Math.max(this.clock, st.rev);
      this.state = st; this.error = null; this.peerError = null; this.settleUntil = now() + S.SETTLE_MS; this._seen();
      if (st.status !== "active") { this._onEndLocal(cur && cur.status === "active"); return; }
      if (this.joined) {
        if (!sameMedia || this.loadedVideo !== st.videoId || this.adapterProvider !== st.provider) this._loadCurrent(st.playback === "playing");
        else this._align(true);                                                     // apply the command right now (and quietly: no command goes back)
      } else if (!sameMedia) this.notify(`${this.peerName || "Your partner"} is watching a video. Join them at the TV.`);
      this._changed();
    }
    _onState(m) {
      const st = this._accept(m.state, m.f); if (!st) return;
      this._seen();
      this.clock = Math.max(this.clock, st.rev);                                   // even a stale message moves our counter forward
      if (C.newerState(this.state, st) !== st || st === this.state) return;        // older, or the very same command again
      if (this.state && C.order(st, this.state) === 0) return;
      this._adopt(st);
    }
    _onBeat(m) {
      const b = C.validateBeat(m), st = this.state; if (!b || m.f !== b.by && b.by !== this.self.id) return;
      this._seen(); this.peerBuffering = b.buf && this.joined;
      if (!st) { if (b.rev > 0) this._send("cin:req", { sessionId: b.sessionId }); return; }
      const o = C.order({ rev: b.rev, by: b.by }, st);
      if (o > 0) this._send("cin:req", { sessionId: b.sessionId });                // they have a newer command than we do: ask for it
      else if (o < 0 && now() - this.lastPushAt > 1500) { this.lastPushAt = now(); this._send("cin:state", { state: st }); }   // they are behind (a message got lost): resend
      this._changed();
    }
    _onReq() { if (this.state) this._send("cin:state", { state: this.state }); }
    _onPres(m) { this._seen(); this.peerJoined = !!m.joined; if (!m.joined) { this.peerBuffering = false; this.peerError = null; } this._changed(); }
    _onBuf(m) { this._seen(); this.peerBuffering = !!m.on; this._changed(); }
    _onErr(m) { this._seen(); const t = typeof m.text === "string" ? m.text.replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 200) : ""; this.peerError = t || "Their player had a problem."; this._changed(); }
    _onEndLocal(wasActive) {
      const was = this.joined; this._teardownPlayer(); this.joined = false; this.error = null; this.peerBuffering = false; this.peerError = null; this._changed();
      if (wasActive) this.notify(was ? `${this.peerName || "Your partner"} ended the movie` : "The movie session ended");
    }
    _onDown() {
      this.peerJoined = false; this.peerBuffering = false; this.peerError = null;
      if (!this.active) { this.state = null; this._changed(); return; }
      if (this.joined) this.notify("Lost your partner. You can keep watching and controlling; you'll resync when they're back.");
      else this.state = null;                                                        // not watching: the session isn't ours to show without the link
      this._changed();
    }
  }
  return { Session };
})();
