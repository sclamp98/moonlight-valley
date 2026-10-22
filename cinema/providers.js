"use strict";
/* ==========================================================
   Moonlight Valley — co-op cinema: video providers.
   A provider turns a pasted link into a playable video and gives the cinema a small, uniform player adapter.
   Adding a service later = write a class with the same shape and CinemaProviders.register() it.

   VideoProvider {
     id, label
     canSync              true only if the service has a documented embed + playback-control API
     parse(input)         -> { ok:true, provider, videoId, start, url } | { ok:false, error, kind }
     createPlayer(container, hooks) -> Adapter       (only when canSync)
   }
   Adapter {
     ready: Promise, load(videoId, {start, autoplay}), play(), pause(), seek(sec), time(), duration(),
     state()  -> "unstarted"|"playing"|"paused"|"buffering"|"ended"|"cued",
     setVolume(0-100), volume(), mute(bool), isMuted(), setRate(r), rate(), title(), destroy()
   }
   hooks { onReady(), onState(s), onError({code, message, fatal}), onRate(r) }
   ========================================================== */
const CinemaProviders = (() => {
  const C = CinemaCore;

  /* ---------- YouTube (official IFrame Player API; nothing is bypassed) ---------- */
  let apiPromise = null;
  function loadYouTubeApi() {
    if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
    if (apiPromise) return apiPromise;
    apiPromise = new Promise((resolve, reject) => {
      const prev = window.onYouTubeIframeAPIReady;
      const timer = setTimeout(() => { apiPromise = null; reject(new Error("Couldn't reach YouTube. Check your connection, or whether an ad-blocker or firewall is blocking youtube.com.")); }, 15000);
      window.onYouTubeIframeAPIReady = () => { clearTimeout(timer); try { prev && prev(); } catch (e) { /* ignore */ } resolve(window.YT); };
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api"; s.async = true;
      s.onerror = () => { clearTimeout(timer); apiPromise = null; s.remove(); reject(new Error("Couldn't load the YouTube player (blocked by the network or an extension).")); };
      document.head.appendChild(s);
    });
    return apiPromise;
  }

  const YT_ERRORS = {
    2: "That video link is invalid.",
    5: "YouTube's player hit an error with this video. Try another one.",
    100: "This video isn't available. It may be private or deleted.",
    101: "The owner of this video doesn't allow it to be played in other sites. Try another video.",
    150: "The owner of this video doesn't allow it to be played in other sites (it may also be age-restricted). Try another video.",
    153: "YouTube refused to embed the video because the game has no web origin. Open the game from a web address (http://localhost…), not from a file.",
  };
  const YT_STATES = { "-1": "unstarted", 0: "ended", 1: "playing", 2: "paused", 3: "buffering", 5: "cued" };

  class YouTubeAdapter {
    constructor(container, hooks) {
      this.hooks = hooks; this.container = container; this.dead = false; this.p = null; this.cur = null;
      this.mount = document.createElement("div"); container.appendChild(this.mount);
      this.ready = loadYouTubeApi().then((YT) => new Promise((resolve) => {
        if (this.dead) return resolve();
        const vars = { controls: 0, disablekb: 1, fs: 0, rel: 0, modestbranding: 1, playsinline: 1, iv_load_policy: 3, enablejsapi: 1, autoplay: 0 };
        if (/^https?:$/.test(location.protocol)) vars.origin = location.origin;
        this.p = new YT.Player(this.mount, {
          width: "100%", height: "100%", playerVars: vars,
          events: {
            onReady: () => { this.isReady = true; resolve(); hooks.onReady && hooks.onReady(); },
            onStateChange: (e) => hooks.onState && hooks.onState(YT_STATES[e.data] || "unstarted"),
            onPlaybackRateChange: (e) => hooks.onRate && hooks.onRate(e.data),
            onError: (e) => hooks.onError && hooks.onError({ code: e.data, message: YT_ERRORS[e.data] || "YouTube couldn't play this video.", fatal: true }),
          },
        });
      }));
    }
    // all calls are no-ops until the player exists (and swallow errors from a half-torn-down iframe)
    _do(fn, dflt) { if (this.dead || !this.p || !this.isReady) return dflt; try { return fn(this.p); } catch (e) { return dflt; } }
    async load(videoId, { start = 0, autoplay = false } = {}) {
      if (!C.YT_ID.test(videoId || "")) throw new Error("Invalid video id");
      await this.ready;
      if (this.dead) return;
      this.cur = videoId;
      this._do((p) => (autoplay ? p.loadVideoById({ videoId, startSeconds: start }) : p.cueVideoById({ videoId, startSeconds: start })));
    }
    play() { this._do((p) => p.playVideo()); }
    pause() { this._do((p) => p.pauseVideo()); }
    seek(t) { this._do((p) => p.seekTo(Math.max(0, t), true)); }
    time() { return this._do((p) => p.getCurrentTime(), 0) || 0; }
    duration() { return this._do((p) => p.getDuration(), 0) || 0; }
    state() { return this._do((p) => YT_STATES[p.getPlayerState()] || "unstarted", "unstarted"); }
    setVolume(v) { this._do((p) => p.setVolume(Math.max(0, Math.min(100, v)))); }
    volume() { return this._do((p) => p.getVolume(), 100); }
    mute(m) { this._do((p) => (m ? p.mute() : p.unMute())); }
    isMuted() { return this._do((p) => p.isMuted(), false); }
    setRate(r) { this._do((p) => p.setPlaybackRate(r)); }
    rate() { return this._do((p) => p.getPlaybackRate(), 1); }
    title() { return this._do((p) => (p.getVideoData() || {}).title || "", ""); }
    destroy() {
      this.dead = true;
      try { this.p && this.p.destroy(); } catch (e) { /* ignore */ }
      this.p = null; this.hooks = {};
      while (this.container.firstChild) this.container.removeChild(this.container.firstChild);
    }
  }

  const YouTubeProvider = {
    id: "youtube", label: "YouTube", canSync: true,
    parse: (input) => C.parseYouTube(input),
    createPlayer: (container, hooks) => new YouTubeAdapter(container, hooks),
  };

  /* ---------- Google Drive (official Drive API + OAuth; see cinema/gdrive.js) ----------
     The share link is only the file's address: playback needs the signed-in Google account's own permission, so the
     provider checks the configuration first and the adapter signs in and streams through the API. */
  const GDriveProvider = {
    id: "gdrive", label: "Google Drive", canSync: true,
    parse: (input) => C.parseDrive(input),
    available: () => CinemaDrive.available(),
    signIn: () => CinemaDrive.signIn(),
    createPlayer: (container, hooks) => CinemaDrive.createPlayer(container, hooks),
  };

  /* ---------- NetMirror: recognised, but honestly unsupported ----------
     I looked for an official embed / playback-control API for it and found none (only unofficial mirror domains),
     so there is nothing permitted to integrate with. We don't frame, scrape or work around its player or login. */
  const NetMirrorProvider = {
    id: "netmirror", label: "NetMirror", canSync: false,
    parse(input) {
      const host = C.hostOf(input);
      if (!host || !C.NETMIRROR_RE.test(host)) return { ok: false, kind: "host" };
      return {
        ok: false, kind: "netmirror", provider: "netmirror",
        error: "Synchronized playback isn't available for NetMirror. It has no official embed or playback-control API that the cinema could use, and the cinema won't try to get around a site's restrictions or login. Paste a YouTube or Google Drive link to watch together here.",
      };
    },
    createPlayer() { throw new Error("NetMirror cannot be embedded or controlled."); },
  };

  /* ---------- everything else ---------- */
  const UnsupportedProvider = {
    id: "unsupported", label: "Unsupported", canSync: false,
    parse(input) {
      const s = String(input || "").trim();
      if (!s) return { ok: false, kind: "empty", error: "Paste a YouTube or Google Drive link first." };
      return { ok: false, kind: "unsupported", provider: "unsupported", error: "Unsupported link. The cinema plays YouTube videos (youtube.com/watch, youtu.be, youtube.com/embed) and Google Drive videos (a drive.google.com/file/d/… share link)." };
    },
  };

  const list = [YouTubeProvider, GDriveProvider, NetMirrorProvider];
  const byId = () => Object.fromEntries(list.concat(UnsupportedProvider).map((p) => [p.id, p]));
  // test harnesses may add providers before the game loads; production ships only the ones above
  for (const p of window.__CINEMA_TEST_PROVIDERS || []) list.unshift(p);

  return {
    register(p) { if (p && p.id && typeof p.parse === "function" && !list.find((x) => x.id === p.id)) list.push(p); },
    get: (id) => byId()[id] || null,
    syncable: () => list.filter((p) => p.canSync).map((p) => p.id),
    // first provider that understands the link wins; otherwise the most specific explanation, else a plain "unsupported"
    resolve(input) {
      if (!String(input == null ? "" : input).trim()) return UnsupportedProvider.parse(input);
      let specific = null;
      for (const p of list) {
        const r = p.parse(input);
        if (r.ok) return r;
        if (r.kind && r.kind !== "host" && !specific) specific = r;
      }
      return specific || UnsupportedProvider.parse(input);
    },
  };
})();
