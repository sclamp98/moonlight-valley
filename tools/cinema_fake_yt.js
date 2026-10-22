/* Test-only stand-in for the official YouTube IFrame Player API (the sandbox/CI can't reach youtube.com).
   It implements the parts of YT.Player the cinema uses, with a real running playhead, buffering after seeks,
   YouTube's error codes for special ids, and an "autoplay blocked" switch. Injected by tools/test_cinema.py
   before the game loads; the shipped game never loads this file. */
(() => {
  const ERR = { privateVid1: 100, noEmbedVid1: 101, ageGateVid1: 150, brokenVid01: 5 };   // 11-char ids (valid YouTube id shape)
  window.__yt = [];
  window.__ytBlockAutoplay = false;      // true: loadVideoById / playVideo don't start until __ytGesture is set
  window.__ytGesture = false;
  class FakePlayer {
    constructor(el, o) {
      this.ev = (o && o.events) || {}; this.vars = (o && o.playerVars) || {};
      this.node = document.createElement("div"); this.node.className = "fake-yt"; this.node.style.cssText = "width:100%;height:100%;background:#123";
      el.replaceWith(this.node);
      this.state = -1; this.base = 0; this.since = 0; this.vid = null; this.vol = 100; this.muted = false; this.rate = 1; this.dead = false; this.log = [];
      window.__yt.push(this);
      setTimeout(() => { this.ready = true; this.ev.onReady && this.ev.onReady({ target: this }); }, 15);
    }
    _set(s) { if (this.dead || this.state === s) return; if (this.state === 1) { this.base = this.getCurrentTime(); } this.state = s; if (s === 1) this.since = performance.now(); this.ev.onStateChange && this.ev.onStateChange({ data: s, target: this }); }
    _load(id, start, autoplay) {
      this.vid = id; this.base = start || 0; this.state = -1;
      if (ERR[id]) { setTimeout(() => !this.dead && this.ev.onError && this.ev.onError({ data: ERR[id] }), 20); return; }
      setTimeout(() => { if (this.dead) return; if (autoplay && !(window.__ytBlockAutoplay && !window.__ytGesture)) this._buffer(() => this._set(1)); else this._set(autoplay ? -1 : 5); }, 25);
    }
    _buffer(then, ms = 120) { this._set(3); setTimeout(() => { if (!this.dead && this.state === 3) then(); }, ms); }
    forceBuffer(ms) { const was = this.state === 1; if (was) this._set(3); setTimeout(() => { if (was && !this.dead) this._set(1); }, ms); }
    loadVideoById(a) { this.log.push("load"); this._load(a.videoId, a.startSeconds, true); }
    cueVideoById(a) { this.log.push("cue"); this._load(a.videoId, a.startSeconds, false); }
    playVideo() { this.log.push("play"); if (window.__ytBlockAutoplay && !window.__ytGesture) return; if (this.state !== 1 && this.state !== 3) this._buffer(() => this._set(1), 60); }
    pauseVideo() { this.log.push("pause"); if (this.state === 1 || this.state === 3) this._set(2); }
    seekTo(t) { this.log.push("seek:" + Math.round(t)); const was = this.state === 1; this.base = t; this.since = performance.now(); if (was) this._buffer(() => this._set(1), 90); }
    getCurrentTime() { return this.state === 1 ? this.base + ((performance.now() - this.since) / 1000) * this.rate : this.base; }
    getDuration() { return this.vid ? 212 : 0; }
    getPlayerState() { return this.state; }
    setVolume(v) { this.vol = v; } getVolume() { return this.vol; } mute() { this.muted = true; } unMute() { this.muted = false; } isMuted() { return this.muted; }
    setPlaybackRate(r) { this.base = this.getCurrentTime(); this.since = performance.now(); this.rate = r; this.ev.onPlaybackRateChange && this.ev.onPlaybackRateChange({ data: r }); }
    getPlaybackRate() { return this.rate; }
    getVideoData() { return { title: "Fake video " + (this.vid || "") }; }
    destroy() { this.dead = true; this.node.remove(); }
  }
  window.YT = { Player: FakePlayer, PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } };
})();
