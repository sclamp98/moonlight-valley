"use strict";
/* ==========================================================
   Moonlight Valley — co-op cinema: Google Drive playback.

   What it does (all through Google's OFFICIAL interfaces):
     1. Sign-in: Google Identity Services "token" flow, scope drive.readonly. The player picks their own Google account.
        Only the public OAuth Client ID (cinema/config.js) is needed — there is no client secret anywhere in this game.
        The access token lives in memory only (never localStorage / cookies / logs) and expires after ~1 hour.
     2. Check: Drive API  files.get  for name / type / size / permissions, BEFORE trying to play, so problems come back as
        a clear sentence ("not shared with this account", "the owner disabled downloading", "not a video"…).
     3. Stream: Drive API  files.get?alt=media  (Range requests supported) feeds a normal <video> element through the small
        service worker /cinema-sw.js, which adds the Authorization header a <video> can't send. Our own player controls
        (play / pause / seek / volume / speed / fullscreen) drive that <video>; Google's preview player is never used.

   What it never does: change a file's sharing, make anything public, read anyone else's files, store the token, or
   work around a permission. If Drive says no, the player says why.
   Both players need access: the file must be shared with BOTH Google accounts (or "Anyone with the link").
   ========================================================== */
const CinemaDrive = (() => {
  const C = CinemaCore;
  const cfg = () => window.CINEMA_CONFIG || {};
  const SCOPE = "https://www.googleapis.com/auth/drive.readonly";
  const apiBase = () => String(cfg().driveApiBase || "https://www.googleapis.com").replace(/\/+$/, "");
  const SETUP = "Whoever runs the game needs to add a Google OAuth Client ID in cinema/config.js (steps: cinema/DRIVE_SETUP.md).";

  class DriveError extends Error { constructor(kind, message) { super(message); this.kind = kind; } }

  const configured = () => typeof cfg().googleClientId === "string" && /^[\w.-]{10,}\.apps\.googleusercontent\.com$|^[\w.-]{6,}$/.test(cfg().googleClientId.trim()) && cfg().googleClientId.trim() !== "";
  function available() { return configured() ? { ok: true } : { ok: false, error: "Google Drive playback isn't set up in this copy of the game yet. " + SETUP }; }

  /* ---------- Google Identity Services (loaded only when a Drive link is actually used) ---------- */
  let gisP = null;
  function loadGis() {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) return Promise.resolve();
    if (gisP) return gisP;
    gisP = new Promise((resolve, reject) => {
      const t = setTimeout(() => { gisP = null; reject(new DriveError("network", "Couldn't reach Google sign-in. Check your connection, or whether an ad-blocker or firewall is blocking accounts.google.com.")); }, 15000);
      const s = document.createElement("script"); s.src = "https://accounts.google.com/gsi/client"; s.async = true;
      s.onload = () => { clearTimeout(t); resolve(); };
      s.onerror = () => { clearTimeout(t); gisP = null; s.remove(); reject(new DriveError("network", "Couldn't load Google sign-in (blocked by the network or an extension).")); };
      document.head.appendChild(s);
    });
    return gisP;
  }

  /* ---------- access token (memory only) ---------- */
  const tok = { value: null, exp: 0, signedIn: false };
  let tokenClient = null, pending = null, refreshTimer = null;
  const tokenListeners = new Set();
  const valid = () => !!tok.value && tok.exp - Date.now() > 60000;

  function requestToken(prompt) {
    if (pending) return pending.promise;
    const p = (pending = {}); p.promise = new Promise((res, rej) => { p.res = res; p.rej = rej; });
    p.promise.then(() => { pending = null; }, () => { pending = null; });
    loadGis().then(() => {
      if (!tokenClient) {
        tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: cfg().googleClientId.trim(), scope: SCOPE,
          callback: (r) => {
            if (!pending) return;
            if (!r || r.error || !r.access_token) pending.rej(new DriveError(r && r.error === "access_denied" ? "denied" : "auth", r && r.error === "access_denied" ? "Google sign-in was cancelled, or access to Drive wasn't allowed. The cinema only asks to read video files you can already open." : "Google sign-in didn't complete (" + ((r && (r.error_description || r.error)) || "no token") + ")."));
            else {
              tok.value = r.access_token; tok.exp = Date.now() + (Math.max(60, +r.expires_in || 3600)) * 1000; tok.signedIn = true;
              scheduleRefresh(); for (const f of tokenListeners) { try { f(tok.value); } catch (e) { /* ignore */ } }
              pending.res(tok.value);
            }
          },
          error_callback: (e) => { if (pending) pending.rej(new DriveError("auth", e && e.type === "popup_failed_to_open" ? "The sign-in window was blocked. Allow pop-ups for this page, then press Sign in again." : e && e.type === "popup_closed" ? "The Google sign-in window was closed before finishing." : "Google sign-in failed.")); },
        });
      }
      tokenClient.requestAccessToken({ prompt });
    }).catch((e) => pending && pending.rej(e));
    return p.promise;
  }
  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { requestToken("none").catch(() => { tok.value = null; }); }, Math.max(30000, tok.exp - Date.now() - 120000));   // renew quietly shortly before it expires
  }
  // interactive: true only from a button press (the sign-in popup needs one). Otherwise a quiet renewal if they've already signed in this visit.
  async function getToken({ interactive = false } = {}) {
    if (!configured()) throw new DriveError("config", available().error);
    if (valid()) return tok.value;
    if (!interactive && !tok.signedIn) throw new DriveError("auth", "Sign in with Google to watch this Drive video.");
    try { return await requestToken(interactive ? "" : "none"); }
    catch (e) { if (!interactive && e.kind !== "network") throw new DriveError("auth", "Sign in with Google to continue watching."); throw e; }
  }
  const signIn = () => getToken({ interactive: true });
  const forgetToken = () => { tok.value = null; tok.exp = 0; };
  const onToken = (fn) => { tokenListeners.add(fn); return () => tokenListeners.delete(fn); };

  /* ---------- Drive API: file check ---------- */
  const reasonOf = (j) => { try { const e = j && j.error; return ((e && e.errors && e.errors[0] && e.errors[0].reason) || (e && e.status) || "").toString(); } catch (x) { return ""; } };
  async function httpError(r) {
    let j = null; try { j = await r.json(); } catch (e) { /* not JSON */ }
    const reason = reasonOf(j), code = r.status;
    if (code === 401) return new DriveError("auth", "Your Google sign-in expired. Sign in again to keep watching.");
    if (code === 404) return new DriveError("notfound", "Drive can't find this file for your account. Either the link is wrong, or the video isn't shared with the Google account you signed in with. Share it with both players' accounts (or set “Anyone with the link”), then try again.");
    if (code === 403) {
      if (/downloadQuotaExceeded|dailyLimitExceeded|userRateLimitExceeded|rateLimitExceeded|quotaExceeded/i.test(reason)) return new DriveError("quota", "Google is limiting this file or this app for now (Drive quota). Wait a while and try again.");
      if (/cannotDownloadFile|downloadRestricted/i.test(reason)) return new DriveError("nodownload", "The owner turned off downloading for this file, so Drive won't let apps stream it. Ask them to allow viewers to download, or share a different copy.");
      if (/accessNotConfigured|SERVICE_DISABLED|apiNotActivated/i.test(reason) || (j && j.error && /has not been used|is disabled/i.test(j.error.message || ""))) return new DriveError("config", "The Google Drive API isn't switched on for this game's Google Cloud project. " + SETUP);
      if (/insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(reason)) return new DriveError("scope", "Google didn't give the game permission to read Drive videos. Press Sign in again and allow “See and download your Google Drive files”.");
      return new DriveError("forbidden", "Your Google account doesn't have permission to open this file. Ask the owner to share it with you (and your partner), or to set “Anyone with the link”.");
    }
    if (code === 429) return new DriveError("quota", "Google Drive is rate-limiting requests right now. Wait a moment and try again.");
    return new DriveError("network", "Google Drive had a problem (HTTP " + code + "). Try again in a moment.");
  }
  async function fetchMeta(id, token) {
    const fields = "id,name,mimeType,size,trashed,capabilities(canDownload),videoMediaMetadata(durationMillis)";
    let r;
    try { r = await fetch(`${apiBase()}/drive/v3/files/${encodeURIComponent(id)}?fields=${encodeURIComponent(fields)}&supportsAllDrives=true`, { headers: { Authorization: "Bearer " + token }, cache: "no-store" }); }
    catch (e) { throw new DriveError("network", "Couldn't reach Google Drive. Check your connection (or a firewall / ad-blocker)."); }
    if (!r.ok) throw await httpError(r);
    const m = await r.json();
    if (m.trashed) throw new DriveError("trashed", "That video is in the Drive trash.");
    if (!/^video\//i.test(m.mimeType || "")) throw new DriveError("notvideo", /^application\/vnd\.google-apps\./.test(m.mimeType || "") ? "That's a Google Docs-type file, not a video." : "That Drive file isn't a video (" + String(m.mimeType || "unknown type").slice(0, 60) + ").");
    if (m.capabilities && m.capabilities.canDownload === false) throw new DriveError("nodownload", "The owner turned off downloading for this file, so Drive won't let apps stream it. Ask them to allow viewers to download, or share a different copy.");
    const size = parseInt(m.size, 10);
    if (!(size > 0)) throw new DriveError("notvideo", "Drive didn't report a file size for this item, so it can't be streamed.");
    return { name: String(m.name || "Drive video").slice(0, 120), mime: m.mimeType, size, durationMs: m.videoMediaMetadata && +m.videoMediaMetadata.durationMillis > 0 ? +m.videoMediaMetadata.durationMillis : 0 };
  }

  /* ---------- the streaming service worker ---------- */
  const registered = new Map();                                        // fileId -> { base, token, size, mime }
  let swP = null;
  function ensureSw() {
    if (swP) return swP;
    swP = (async () => {
      if (!("serviceWorker" in navigator)) throw new DriveError("sw", "This browser can't stream Drive videos (no service worker support). Use a current Chrome, Edge or Firefox.");
      if (!window.isSecureContext) throw new DriveError("sw", "Drive videos can only be streamed from https:// or http://localhost. Serve the game from http://localhost (not a file, not a plain LAN address).");
      await navigator.serviceWorker.register("cinema-sw.js");
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise((res) => { navigator.serviceWorker.addEventListener("controllerchange", res, { once: true }); setTimeout(res, 4000); });
      if (!navigator.serviceWorker.controller) throw new DriveError("sw", "The streaming helper is installed but not active yet. Reload the page once and try again.");
      navigator.serviceWorker.addEventListener("message", (e) => {       // the worker was restarted by the browser: give it the registration again
        const m = e.data || {};
        if (m.type === "need" && registered.has(m.id)) post({ type: "register", id: m.id, ...registered.get(m.id) }).catch(() => {});
      });
    })().catch((e) => { swP = null; throw e; });
    return swP;
  }
  function post(msg) {
    return new Promise((resolve, reject) => {
      const ctl = navigator.serviceWorker.controller; if (!ctl) return reject(new DriveError("sw", "The streaming helper isn't active. Reload the page."));
      const ch = new MessageChannel(), t = setTimeout(() => reject(new DriveError("sw", "The streaming helper didn't answer.")), 5000);
      ch.port1.onmessage = (e) => { clearTimeout(t); e.data && e.data.ok ? resolve() : reject(new DriveError("sw", "The streaming helper refused the file (" + ((e.data && e.data.error) || "unknown") + ").")); };
      ctl.postMessage(msg, [ch.port2]);
    });
  }
  async function register(id, meta, token) {
    await ensureSw();
    const rec = { base: apiBase(), token, size: meta.size, mime: meta.mime };
    registered.set(id, rec); await post({ type: "register", id, ...rec });
  }
  function release(id) { registered.delete(id); try { navigator.serviceWorker && navigator.serviceWorker.controller && post({ type: "forget", id }).catch(() => {}); } catch (e) { /* ignore */ } }
  onToken((t) => { for (const r of registered.values()) r.token = t; try { if (registered.size) post({ type: "token", token: t }).catch(() => {}); } catch (e) { /* ignore */ } });
  const streamUrl = (id) => new URL("__cinema_drive/" + id, document.baseURI).href;

  /* ---------- the player adapter (same shape as the YouTube one; see providers.js) ---------- */
  const MEDIA_ERR = {
    3: "Your browser couldn't decode this video (the file is damaged, or uses a codec it doesn't support).",
    4: "Your browser can't play this file's format. Drive serves the original file, so MP4 (H.264 / AAC) and WebM play; MKV, AVI and some HEVC files usually don't.",
  };
  class DriveAdapter {
    constructor(container, hooks) {
      this.hooks = hooks || {}; this.container = container; this.dead = false; this.fileId = null; this.meta = null; this.seq = 0; this.started = false; this.pendingSeek = null; this.fatal = false;
      this.v = document.createElement("video"); this.v.className = "cin-html5"; this.v.setAttribute("playsinline", ""); this.v.preload = "auto"; this.v.controls = false; this.v.disablePictureInPicture = true; this.v.setAttribute("controlsList", "nodownload noremoteplayback");
      container.appendChild(this.v);
      const v = this.v, emit = () => { if (!this.dead && this.hooks.onState) this.hooks.onState(this.state()); };
      for (const ev of ["playing", "pause", "waiting", "canplay", "ended", "seeked", "loadeddata"]) v.addEventListener(ev, () => { if (ev === "playing") this.started = true; emit(); });
      v.addEventListener("loadedmetadata", () => { if (this.pendingSeek != null) { try { v.currentTime = this.pendingSeek; } catch (e) { /* ignore */ } this.pendingSeek = null; } emit(); });
      v.addEventListener("ratechange", () => { if (!this.dead && this.hooks.onRate) this.hooks.onRate(v.playbackRate); });
      v.addEventListener("error", () => this._mediaError());
      this.ready = Promise.resolve().then(() => { if (!this.dead && this.hooks.onReady) this.hooks.onReady(); });
    }
    _fail(e) { this.fatal = true; if (!this.dead && this.hooks.onError) this.hooks.onError({ code: e.kind, kind: e.kind === "auth" ? "auth" : undefined, message: e.message, fatal: e.kind !== "auth" }); }
    async _mediaError() {
      if (this.dead || !this.v.error || !this.fileId) return;
      const code = this.v.error.code, seq = this.seq;
      if (code === 2 || code === 4 || code === 1) {                      // a refused / dropped stream: find out WHY from Drive itself (expired token? permission? quota?)
        try {
          const t = await getToken({ interactive: false }).catch(() => null);
          if (!t) return this._fail(new DriveError("auth", "Your Google sign-in expired. Sign in again to keep watching."));
          await fetchMeta(this.fileId, t);
        } catch (e) { if (!this.dead && seq === this.seq) return this._fail(e); }
      }
      if (this.dead || seq !== this.seq) return;
      this._fail(new DriveError("media", MEDIA_ERR[code] || "The connection to Google Drive dropped while streaming. Try again."));
    }
    async load(videoId, { start = 0, autoplay = false, interactive = false } = {}) {
      if (!C.DRIVE_ID.test(videoId || "")) throw new DriveError("invalid", "Invalid Drive file id.");
      const seq = ++this.seq; this.fileId = videoId; this.started = false; this.fatal = false; this.meta = null; this.clearSubtitles();   // subtitles belong to one video
      const v = this.v; v.pause(); v.removeAttribute("src"); v.load();
      let token, meta;
      try { token = await getToken({ interactive }); meta = await fetchMeta(videoId, token); }
      catch (e) { if (e && e.kind === "auth") forgetToken(); throw e; }
      if (this.dead || seq !== this.seq) return;
      this.meta = meta; await register(videoId, meta, token);
      if (this.dead || seq !== this.seq) return;
      this.pendingSeek = start > 0 ? start : null;
      v.src = streamUrl(videoId);
      if (autoplay) this.play();
    }
    // Subtitles from a file the player picked (already converted to WebVTT). They live in this browser only and are drawn by the <video> itself, so they follow play / pause / seek and fullscreen.
    addSubtitles(vtt, label) {
      this.clearSubtitles();
      const url = URL.createObjectURL(new Blob([vtt], { type: "text/vtt" })), tr = document.createElement("track");
      tr.kind = "subtitles"; tr.label = String(label || "Subtitles").slice(0, 60); tr.srclang = "und"; tr.src = url; tr.default = true;
      this.v.appendChild(tr); this._subUrl = url; this._subTrack = tr; this.subLabel = tr.label;
      const show = () => { for (const t of this.v.textTracks) t.mode = "showing"; };
      tr.addEventListener("load", show); show(); setTimeout(show, 0);
    }
    clearSubtitles() { if (this._subTrack) { this._subTrack.remove(); this._subTrack = null; } if (this._subUrl) { URL.revokeObjectURL(this._subUrl); this._subUrl = null; } this.subLabel = ""; }
    hasSubtitles() { return !!this._subTrack; }
    play() { const p = this.v.play(); if (p && p.catch) p.catch((e) => { if (e && e.name === "NotAllowedError") return; /* autoplay blocked: the session asks for a click */ if (e && e.name === "AbortError") return; if (e && e.name === "NotSupportedError") return; }); }
    pause() { this.v.pause(); }
    seek(t) { const d = this.duration(); const x = Math.max(0, d > 0 ? Math.min(t, d) : t); if (this.v.readyState >= 1) { try { this.v.currentTime = x; } catch (e) { /* ignore */ } } else this.pendingSeek = x; }
    time() { const t = this.v.currentTime; return isFinite(t) ? t : 0; }
    duration() { const d = this.v.duration; return isFinite(d) && d > 0 ? d : this.meta && this.meta.durationMs ? this.meta.durationMs / 1000 : 0; }
    state() {
      const v = this.v;
      if (this.dead || this.fatal || !this.fileId || !v.currentSrc && !v.getAttribute("src")) return "unstarted";
      if (v.ended) return "ended";
      if (!v.paused) return v.readyState < 3 ? "buffering" : "playing";
      if (v.seeking && !this.started) return "unstarted";
      return this.started ? "paused" : v.readyState >= 2 ? "cued" : "unstarted";
    }
    setVolume(x) { this.v.volume = Math.max(0, Math.min(1, x / 100)); }
    volume() { return Math.round(this.v.volume * 100); }
    mute(m) { this.v.muted = !!m; }
    isMuted() { return this.v.muted; }
    setRate(r) { try { this.v.playbackRate = Math.max(0.25, Math.min(2, r)); } catch (e) { /* ignore */ } }
    rate() { return this.v.playbackRate || 1; }
    title() { return this.meta ? this.meta.name : ""; }
    destroy() {
      this.dead = true; this.seq++; this.clearSubtitles();
      try { this.v.pause(); this.v.removeAttribute("src"); this.v.load(); } catch (e) { /* ignore */ }
      if (this.fileId) release(this.fileId);
      this.hooks = {}; this.v.remove();
    }
  }

  return { available, configured, signIn, getToken, createPlayer: (container, hooks) => new DriveAdapter(container, hooks), DriveError, fetchMeta, _tok: tok };
})();
