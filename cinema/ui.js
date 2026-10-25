"use strict";
/* ==========================================================
   Moonlight Valley — co-op cinema: DOM interface.
     #cin-screen   the video: sits on the TV in the room, or enlarges above the panel while it's open
     #cin-panel    "Watch Together" controls (URL, Load, Play / Pause, seek, volume, status, close)
     #coop-btn / #coop-panel   connect to your partner (invite / reply codes)
   All user-visible text from links / partners is set with textContent — never innerHTML.
   While a panel is open every key goes to the panel only, so typing never moves the farmer or fires a shortcut.
   ========================================================== */
const CinemaUI = (() => {
  const C = CinemaCore;
  const $ = (r, s) => r.querySelector(s);
  const css = document.createElement("style");
  css.textContent = `
  #cin-screen { position: fixed; z-index: 3; background: #000; overflow: hidden; pointer-events: none; border-radius: 2px; box-shadow: 0 0 40px rgba(120,160,255,.35); }
  #cin-screen[hidden] { display: none; }
  #cin-screen .cin-video, #cin-screen iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; pointer-events: none; }
  #cin-screen video.cin-html5::cue { background: rgba(0,0,0,.72); color: #fff; font: 600 clamp(13px, 2.4vw, 24px) "Trebuchet MS", sans-serif; }
  #cin-screen video.cin-html5 { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; background: #000; pointer-events: none; }
  #cin-last { min-height: 16px; margin-top: 4px; font-size: 12px; color: #d9bd8c; }
  #cin-screen.theater { z-index: 37; left: 50%; top: 10px; transform: translateX(-50%); aspect-ratio: 16 / 9; height: auto;
    width: clamp(min(94vw, 320px), calc((100vh - 360px) * 1.7778), min(94vw, 920px)); box-shadow: 0 8px 40px rgba(0,0,0,.65), 0 0 0 3px #3b2616, 0 0 0 5px #a8693a; border-radius: 6px; }
  #cin-screen .cin-wait { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; text-align: center; padding: 8px; color: #fde6b2;
    font: bold 13px 'Trebuchet MS', sans-serif; background: rgba(8,10,24,.78); }
  #cin-screen .cin-wait[hidden] { display: none; }
  #cin-panel, #coop-panel { position: fixed; z-index: 38; left: 50%; transform: translateX(-50%); bottom: 10px; width: min(96vw, 760px); max-height: calc(100vh - 20px); overflow: auto;
    padding: 12px 14px 12px; box-sizing: border-box; color: #fde6b2; font: 14px 'Trebuchet MS', sans-serif; }
  #cin-panel[hidden], #coop-panel[hidden] { display: none; }
  #cin-panel { max-height: min(46vh, 380px); }
  #coop-panel { bottom: auto; top: 50%; transform: translate(-50%, -50%); width: min(94vw, 560px); z-index: 39; }
  .cin-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
  .cin-head h2 { margin: 0; font-size: 18px; flex: 1 1 auto; }
  .cin-chip { font-weight: bold; font-size: 12px; padding: 3px 10px; border-radius: 99px; background: #3b2616; color: #fde6b2; border: 2px solid #a8693a; }
  .cin-chip.play { background: #2f6b3a; border-color: #7fd18f; } .cin-chip.pause { background: #7a5a1e; border-color: #f2c94c; }
  .cin-chip.wait { background: #2d4a73; border-color: #8fb6ee; } .cin-chip.error { background: #7b2d2d; border-color: #ee8f8f; }
  .cin-role { font-size: 12px; color: #d9bd8c; }
  .cin-row, .cin-ctl, .cin-ctl2, .cin-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
  .cin-row input[type=text], #coop-panel textarea { flex: 1 1 200px; min-width: 0; font: 15px 'Trebuchet MS', sans-serif; padding: 8px 10px; border-radius: 6px; border: 2px solid #3b2616; background: #fff3d6; color: #3b2616; box-sizing: border-box; }
  #coop-panel textarea { width: 100%; height: 64px; resize: vertical; font: 11px ui-monospace, Menlo, Consolas, monospace; word-break: break-all; }
  .cin-row input:disabled { background: #cdbb97; }
  #cin-panel button, #coop-panel button { font: bold 13px 'Trebuchet MS', sans-serif; padding: 7px 12px; border-radius: 6px; border: 2px solid #3b2616; background: #f2c94c; color: #3b2616; cursor: pointer; box-shadow: 0 2px 0 #3b2616; }
  #cin-panel button.alt, #coop-panel button.alt { background: #e8d3a4; }
  #cin-panel button:disabled, #coop-panel button:disabled { background: #6b5a4a; color: #a89580; cursor: not-allowed; box-shadow: none; }
  #cin-panel button:not(:disabled):hover, #coop-panel button:not(:disabled):hover { filter: brightness(1.08); }
  #cin-panel button[hidden], #coop-panel [hidden] { display: none !important; }
  .cin-ctl input[type=range] { flex: 1 1 140px; min-width: 90px; accent-color: #f2c94c; }
  .cin-ctl2 input[type=range] { width: 110px; accent-color: #f2c94c; }
  .cin-ctl2 select { font: 13px 'Trebuchet MS', sans-serif; border-radius: 5px; border: 2px solid #3b2616; background: #fff3d6; color: #3b2616; }
  #cin-cur, #cin-dur { font-variant-numeric: tabular-nums; font-size: 13px; min-width: 42px; text-align: center; }
  .cin-msg { min-height: 18px; margin-top: 8px; font-size: 13px; line-height: 1.35; color: #fde6b2; }
  .cin-msg.err { color: #ffb4a8; } .cin-msg.note { color: #d9bd8c; }
  .cin-foot, .cin-note { margin-top: 8px; font-size: 11.5px; color: #d9bd8c; line-height: 1.35; }
  .cin-actions { justify-content: flex-end; } #cin-who { margin-left: auto; font-size: 12px; color: #d9bd8c; }
  #coop-panel label { display: block; margin-top: 10px; font-size: 13px; color: #fde6b2; }
  #coop-btn { position: fixed; top: 72px; left: 12px; z-index: 6; cursor: pointer; font: bold 12px 'Trebuchet MS', sans-serif; padding: 4px 9px; border-radius: 6px; border: 2px solid #3b2616; background: rgba(78,48,25,.92); color: #fde6b2; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #coop-btn:hover { background: #6b4326; } #coop-btn .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #9a8a78; margin-right: 6px; }
  #coop-btn.on .dot { background: #5cc94a; } #coop-btn.warn .dot { background: #e8b93c; } #coop-btn.off .dot { background: #d9534f; }
  #cin-panel button#cin-x { display: none; padding: 2px 9px; }
  @media (max-height: 560px) {
    #cin-panel { max-height: 52vh; padding: 8px 12px; } .cin-foot { display: none; } .cin-head { margin-bottom: 4px; } .cin-row, .cin-ctl, .cin-ctl2, .cin-actions { margin-top: 5px; }
    #cin-panel button#cin-x { display: inline-block; }
    #cin-screen.theater { width: clamp(200px, calc((100vh - 52vh - 34px) * 1.7778), 94vw); }
  }

  /* ---- fullscreen stage: a plain, unstyled wrapper around the screen + panel + chat + co-op so the
     Fullscreen API, when applied to it, keeps the video AND the controls on screen together (its
     fixed-position children resolve against it while it's the fullscreen element, same as against the
     viewport otherwise). Anything NOT inside this element is invisible while it's fullscreen — the browser
     paints the fullscreen element in a top layer covering the whole screen — which is why the co-op "link"
     panel and badge live in here too now, not as siblings: a sibling would be impossible to see or click
     while fullscreen at all. ---- */
  #cin-stage { display: block; }
  #cin-stage:fullscreen, #cin-stage:-webkit-full-screen { background: #000; }
  /* Real, edge-to-edge fullscreen: the video is sized to fill as much of the actual screen as the aspect
     ratio allows (letterboxed left/right or top/bottom, never stretched/distorted, same as a native video
     player's own fullscreen) — identical whether the control panel is showing over it or not, so opening
     controls never shrinks the video into a smaller boxed-in area. */
  #cin-stage.cin-fs #cin-screen.theater, #cin-stage.cin-fs-bare #cin-screen.theater {
    position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
    width: min(100vw, 177.78vh); height: min(100vh, 56.25vw); max-width: none; box-shadow: none; border-radius: 0;
  }
  /* the panel becomes a translucent strip docked over the bottom of the video, not space reserved beside it */
  #cin-stage.cin-fs #cin-panel { position: absolute; left: 0; right: 0; bottom: 0; width: 100%; max-width: none; transform: none;
    border-radius: 0; background: rgba(10,8,20,.92); max-height: 46vh; }
  #cin-fs-exit { position: fixed; z-index: 41; top: 14px; right: 14px; font: bold 12px 'Trebuchet MS', sans-serif; padding: 7px 13px; border-radius: 6px;
    border: 2px solid #3b2616; background: rgba(20,14,10,.82); color: #fde6b2; cursor: pointer; box-shadow: 0 2px 10px rgba(0,0,0,.5); }
  #cin-fs-exit[hidden] { display: none; } #cin-fs-exit:hover { background: rgba(40,28,20,.9); }
  #cin-fs, #cin-chat-btn { padding: 6px 10px; font-size: 15px; line-height: 1; }

  /* ---- chat shortcut button, message pop-ups and on-screen feedback: all live inside #cin-stage, so they also show in fullscreen ---- */
  #chat-fab { position: fixed; top: 104px; left: 12px; z-index: 6; display: none; cursor: pointer; font: bold 12px 'Trebuchet MS', sans-serif; padding: 4px 9px; border-radius: 6px; border: 2px solid #3b2616; background: rgba(78,48,25,.88); color: #fde6b2; }
  #chat-fab.show { display: block; } #chat-fab:hover { background: #6b4326; }
  #chat-fab .badge { display: inline-block; margin-left: 6px; min-width: 16px; padding: 0 5px; border-radius: 9px; background: #d9534f; color: #fff; font-size: 11px; text-align: center; }
  #chat-fab .badge[hidden] { display: none; }
  #cin-stage.cin-fs #chat-fab { opacity: .6; } #cin-stage.cin-fs #chat-fab:hover { opacity: 1; }
  #cin-toasts { position: fixed; z-index: 45; top: 12px; left: 50%; transform: translateX(-50%); width: min(88vw, 560px); display: flex; flex-direction: column; align-items: center; gap: 6px; pointer-events: none; }
  .cin-toast { pointer-events: auto; cursor: pointer; max-width: 100%; box-sizing: border-box; padding: 8px 14px; border-radius: 10px; background: rgba(15,10,6,.55); border: 1px solid rgba(255,255,255,.3); color: #fff;
    font: 600 14px/1.35 'Trebuchet MS', sans-serif; text-shadow: 0 1px 3px #000; box-shadow: 0 2px 14px rgba(0,0,0,.45); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; transition: opacity .4s; }
  .cin-toast b { color: #ffd77a; } .cin-toast.out { opacity: 0; }
  #cin-osd { position: fixed; z-index: 44; top: 16%; left: 50%; transform: translateX(-50%); padding: 8px 18px; border-radius: 10px; background: rgba(0,0,0,.55); color: #fff; font: 700 18px 'Trebuchet MS', sans-serif; text-shadow: 0 1px 3px #000; pointer-events: none; opacity: 0; transition: opacity .2s; }
  #cin-osd.on { opacity: 1; }

  /* ---- chat panel ---- */
  #cin-chat { position: fixed; z-index: 40; top: 10px; right: 10px; bottom: 10px; width: 300px; max-width: 92vw;
    background: rgba(20,14,10,.95); border: 2px solid #3b2616; border-radius: 8px; box-shadow: 0 8px 30px rgba(0,0,0,.6);
    display: flex; flex-direction: column; color: #fde6b2; font: 13px 'Trebuchet MS', sans-serif; box-sizing: border-box; }
  #cin-chat[hidden] { display: none; }
  .cin-chat-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; border-bottom: 2px solid #3b2616; flex: 0 0 auto; }
  .cin-chat-head h3 { margin: 0; font-size: 14px; }
  #cin-chat-list { flex: 1 1 auto; overflow-y: auto; padding: 8px 10px; display: flex; flex-direction: column; gap: 7px; min-height: 0; }
  .cin-chat-empty { color: #d9bd8c; font-size: 12px; text-align: center; margin-top: 10px; }
  .cin-msg-row { max-width: 90%; display: flex; flex-direction: column; }
  .cin-msg-row.me { align-self: flex-end; align-items: flex-end; }
  .cin-msg-row.them { align-self: flex-start; align-items: flex-start; }
  .cin-msg-bubble { display: inline-block; padding: 6px 10px; border-radius: 10px; background: #3b2616; word-break: break-word; white-space: pre-wrap; }
  .cin-msg-row.me .cin-msg-bubble { background: #7a5a1e; }
  .cin-msg-row.failed .cin-msg-bubble { background: #5a2424; }
  .cin-msg-meta { font-size: 10.5px; color: #d9bd8c; margin-top: 2px; padding: 0 2px; }
  #cin-chat-form { display: flex; gap: 6px; padding: 8px 10px; border-top: 2px solid #3b2616; flex: 0 0 auto; }
  #cin-chat-input { flex: 1 1 auto; min-width: 0; font: 13px 'Trebuchet MS', sans-serif; padding: 7px 9px; border-radius: 6px; border: 2px solid #3b2616; background: #fff3d6; color: #3b2616; box-sizing: border-box; }
  #cin-chat-input:disabled { background: #cdbb97; }
  #cin-chat-send { font: bold 13px 'Trebuchet MS', sans-serif; padding: 7px 12px; border-radius: 6px; border: 2px solid #3b2616; background: #f2c94c; color: #3b2616; cursor: pointer; }
  #cin-chat-send:disabled { background: #6b5a4a; color: #a89580; cursor: not-allowed; }
  #cin-chat-status { padding: 0 10px 8px; font-size: 11.5px; color: #ffb4a8; flex: 0 0 auto; }
  #cin-chat-status:empty { display: none; }
  @media (max-width: 640px) {
    #cin-chat { left: 6px; right: 6px; width: auto; top: auto; bottom: 6px; height: 46vh; }
  }
  `;
  document.head.appendChild(css);

  const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; };

  class UI {
    constructor({ getSession, getLink, onClosed, where }) {
      this.getSession = getSession; this.getLink = getLink; this.onClosed = onClosed || (() => {}); this.where = where || (() => "");
      this.uiMsg = null;                                   // { text, kind } set by Load failures (unsupported link …)
      this.cinOpen = false; this.coopOpen = false; this.dragging = false; this._timer = null;
      this._fsOn = false;                                  // our own last-known fullscreen state — see _kd / _onFsChange

      this.screen = el(`<div id="cin-screen" hidden><div class="cin-video"></div><div class="cin-wait" hidden></div></div>`);
      this.video = $(this.screen, ".cin-video"); this.wait = $(this.screen, ".cin-wait");
      this.panel = el(`<div id="cin-panel" class="panel-box" role="dialog" aria-labelledby="cin-title" hidden>
        <div class="cin-head"><h2 id="cin-title">Moonlight Cinema</h2><span id="cin-role" class="cin-role"></span><span id="cin-status" class="cin-chip" role="status">Idle</span>
          <button id="cin-chat-btn" class="alt" title="Chat" aria-label="Open chat">💬 Chat</button>
          <button id="cin-fs" class="alt" title="Fullscreen" aria-label="Enter fullscreen">⛶</button>
          <button id="cin-x" class="alt" title="Close (Esc)" aria-label="Close">✕</button></div>
        <div class="cin-row"><input id="cin-url" type="text" placeholder="Paste a YouTube or Google Drive link…" autocomplete="off" spellcheck="false" maxlength="300" aria-label="Video link"><button id="cin-load">Load Video</button></div>
        <div id="cin-msg" class="cin-msg" aria-live="polite"></div>
        <div id="cin-last" aria-live="polite"></div>
        <div class="cin-ctl"><button id="cin-play">▶ Play</button><button id="cin-pause" class="alt">❚❚ Pause</button><span id="cin-cur">0:00</span><input id="cin-seek" type="range" min="0" max="1000" value="0" step="1" aria-label="Seek"><span id="cin-dur">--:--</span></div>
        <div class="cin-ctl2"><label>Volume <input id="cin-vol" type="range" min="0" max="100" value="80" aria-label="Volume"></label><button id="cin-mute" class="alt" title="Mute / unmute" aria-label="Mute">🔊</button>
          <label>Speed <select id="cin-rate" aria-label="Playback speed"></select></label><button id="cin-sub" class="alt" title="Add subtitles from a .srt or .vtt file" hidden>CC Subtitles</button><button id="cin-sub-off" class="alt" title="Remove subtitles" aria-label="Remove subtitles" hidden>✕</button><input id="cin-sub-file" type="file" accept=".srt,.vtt,text/vtt,application/x-subrip" hidden><span id="cin-who"></span></div>
        <div class="cin-actions"><button id="cin-gesture" hidden>▶ Click to join playback</button><button id="cin-signin" hidden>Sign in with Google</button><button id="cin-join" hidden>Join session</button><button id="cin-end" class="alt" hidden>End session</button><button id="cin-leave" class="alt" hidden>Leave session</button><button id="cin-close" class="alt">Close (Esc)</button></div>
        <div class="cin-foot">Either of you can play, pause, seek or change the video at any time; the newest action wins on both screens. Syncing is best-effort, not frame-perfect: connection speed, buffering and ads can leave you a second or two apart. Volume and fullscreen are yours alone.</div>
      </div>`);
      this.coop = el(`<div id="coop-panel" class="panel-box" role="dialog" aria-labelledby="coop-title" hidden>
        <div class="cin-head"><h2 id="coop-title">Co-op</h2><span id="coop-state" class="cin-chip">Not connected</span></div>
        <div id="coop-intro"><div class="cin-note">Connect two browsers directly (no server). You swap two short codes by chat or text: an invite, then a reply. Both of you then see each other in the house and can watch together.</div>
          <div class="cin-actions" style="justify-content:flex-start"><button id="coop-host">Invite my partner</button><button id="coop-join" class="alt">I have an invite</button></div></div>
        <div id="coop-host-step" hidden><label>1. Send this invite code to your partner<textarea id="coop-offer" readonly aria-label="Invite code"></textarea></label>
          <div class="cin-actions" style="justify-content:flex-start"><button id="coop-copy-offer" class="alt">Copy invite</button></div>
          <label>2. Paste the reply code they send back<textarea id="coop-reply-in" aria-label="Reply code" placeholder="MV1z…"></textarea></label>
          <div class="cin-actions" style="justify-content:flex-start"><button id="coop-connect">Connect</button></div></div>
        <div id="coop-join-step" hidden><label>1. Paste the invite code from your partner<textarea id="coop-invite-in" aria-label="Invite code" placeholder="MV1z…"></textarea></label>
          <div class="cin-actions" style="justify-content:flex-start"><button id="coop-make-reply">Create reply</button></div>
          <label>2. Send this reply code back to them<textarea id="coop-answer" readonly aria-label="Reply code"></textarea></label>
          <div class="cin-actions" style="justify-content:flex-start"><button id="coop-copy-answer" class="alt">Copy reply</button></div></div>
        <div id="coop-live" hidden><div class="cin-note" id="coop-live-text"></div><div class="cin-actions" style="justify-content:flex-start"><button id="coop-disconnect" class="alt">Disconnect</button></div></div>
        <div id="coop-msg" class="cin-msg" aria-live="polite"></div>
        <div class="cin-actions" style="justify-content:flex-start"><button id="coop-diag" class="alt" title="Copies a sanitized connection report (no addresses or passwords) to send to whoever is helping you debug">Copy connection report</button></div>
        <div class="cin-actions"><button id="coop-close" class="alt">Close (Esc)</button></div>
      </div>`);
      this.btn = el(`<button id="coop-btn" title="Connect to your partner"><span class="dot"></span><span class="lbl">Co-op</span></button>`);
      this.chat = el(`<div id="cin-chat" role="dialog" aria-labelledby="cin-chat-title" hidden>
        <div class="cin-chat-head"><h3 id="cin-chat-title">Chat</h3><button id="cin-chat-x" class="alt" title="Close chat" aria-label="Close chat">✕</button></div>
        <div id="cin-chat-list" aria-live="polite"></div>
        <div id="cin-chat-status"></div>
        <form id="cin-chat-form"><input id="cin-chat-input" type="text" placeholder="Message your partner…" autocomplete="off" maxlength="500" aria-label="Chat message"><button id="cin-chat-send" type="submit">Send</button></form>
      </div>`);
      // shown only while fullscreen AND the panel/chat are closed — the one way back once close() has hidden
      // the panel (and with it the regular ⛶ button) but deliberately left fullscreen running.
      this.fsExit = el(`<button id="cin-fs-exit" title="Exit fullscreen" aria-label="Exit fullscreen" hidden>⛶ Exit fullscreen</button>`);
      // a plain, unstyled wrapper: it establishes no containing block of its own, so the screen/panel/chat's
      // existing position:fixed layout is unaffected unless this wrapper itself becomes the fullscreen element.
      // The co-op "link" panel + badge live inside it too, not as siblings: while #cin-stage is fullscreen,
      // the browser paints it in a top layer covering the entire screen, so anything NOT inside it (a sibling,
      // like these used to be) is completely invisible and unclickable for as long as fullscreen lasts — there
      // would be no way to see your partner's connection status or reconnect them without leaving fullscreen
      // first. Putting them in the same wrapper is all that's needed; it doesn't change how or where they
      // appear outside of fullscreen (the wrapper has no layout effect of its own).
      this.stage = el(`<div id="cin-stage"></div>`);
      this.fab = el(`<button id="chat-fab" title="Chat with your partner" aria-label="Open chat">💬 Chat<span class="badge" hidden>0</span></button>`);
      this.toasts = el(`<div id="cin-toasts" aria-live="polite"></div>`);
      this.osd = el(`<div id="cin-osd" aria-live="polite"></div>`);
      this.stage.append(this.screen, this.panel, this.chat, this.fsExit, this.coop, this.btn, this.fab, this.toasts, this.osd);
      document.body.append(this.stage);
      this.fsExit.addEventListener("click", () => this._exitFullscreen());
      for (const r of [1, 0.5, 0.75, 1.25, 1.5, 2].sort((a, b) => a - b)) { const o = document.createElement("option"); o.value = r; o.textContent = r + "x"; if (r === 1) o.selected = true; $(this.panel, "#cin-rate").appendChild(o); }

      this._unread = 0; this.chatOpen = false; this.chatMsgs = []; this._fsHandler = () => this._onFsChange();
      for (const ev of ["fullscreenchange", "webkitfullscreenchange"]) document.addEventListener(ev, this._fsHandler);

      this._wire();
    }

    _wire() {
      const p = this.panel, q = (s) => $(p, s), S = () => this.getSession();
      // keys: while a panel is open nothing reaches the game (movement, hotbar, I / C / T / M …). Esc closes.
      // Escape is special-cased and fully swallowed right here, in the capture phase at window — it never
      // needs to reach anything inside a panel. Every OTHER key is deliberately left alone at this point: this
      // listener runs in the capture phase, before the event has even reached whatever's focused, so stopping
      // it here would also swallow that element's own keydown handling — which is exactly why a real Enter
      // keypress used to never reach the #cin-url "Enter loads" wiring, or the new #cin-chat-input "Enter
      // sends" wiring below: this window-capture handler was eating the event before either ever saw it. The
      // fix is to let it continue down to the focused element (so its own listener gets a turn), and instead
      // stop it from bubbling back up to the game's own window-level listeners (movement, the map's "m", …)
      // with bubble-phase listeners on each panel itself (below) — those run *after* the focused element's own
      // handler, once the event bubbles back out past the panel, so typing still works but never leaks out.
      this._kd = (e) => {
        if (!this.cinOpen && !this.coopOpen && !this.chatOpen) return;
        if (e.key === "Escape") {
          e.preventDefault(); e.stopPropagation();
          // Fullscreen gets this Escape to itself, and nothing else happens in the same press. Relying on the
          // browser to exit fullscreen on its own turned out not to be enough — some browsers/automation only
          // honour that for a *trusted, OS-level* keypress, so a press that reaches here without the browser
          // having exited would otherwise fall straight through to also closing chat/the panel, or (worse,
          // when the browser never exits at all here) do nothing and leave the user stuck in fullscreen. So
          // this always calls our own exitFullscreen() explicitly, using OUR last-known fullscreen state
          // (this._fsOn, set only by the fullscreenchange listener below) rather than a fresh DOM query: the
          // query races the browser's own native exit — by spec that fires fullscreenchange as a separately
          // queued task, so it hasn't reached us yet during this same keydown even if the browser already
          // left fullscreen — and _fsOn is still reliably "on" for this one press, so we stop at exiting and
          // never also close anything underneath. A later, separate Escape — once fullscreenchange has caught
          // up and flipped _fsOn to false — is what then closes chat, then co-op, then the panel.
          if (this._fsOn) { this._exitFullscreen(); return; }
          if (this.chatOpen) this.closeChat();
          else this.coopOpen ? this.closeCoop() : this.close();
        }
      };
      window.addEventListener("keydown", this._kd, true);
      // Watching shortcuts: ← → seek 5 s (Shift: 15 s), ↑ ↓ volume, Space play / pause. Only while a video is joined AND you are
      // clearly watching it (panel open, fullscreen, or sitting on the sofa), never while typing, so walking around is unaffected.
      this._ks = (e) => {
        const k = e.key; if (!(k === "ArrowLeft" || k === "ArrowRight" || k === "ArrowUp" || k === "ArrowDown" || k === " ")) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const t = e.target, tag = t && t.tagName; if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t && t.isContentEditable)) return;
        const s = this.getSession(), i = s.info(), g = window.game;
        if (!(i.active && i.joined && (this.cinOpen || this._fsOn || (g && g.sitting)))) return;
        e.preventDefault(); e.stopImmediatePropagation(); if (tag === "BUTTON") t.blur();
        if (k === " ") { if (e.repeat) return; const playing = i.state && i.state.playback === "playing"; const r = playing ? s.pause() : s.play(); if (!r || r.ok !== false) this._showOsd(playing ? "⏸ Paused" : "▶ Playing"); }
        else if (k === "ArrowUp" || k === "ArrowDown") { const v = Math.max(0, Math.min(100, Math.round(i.volume) + (k === "ArrowUp" ? 5 : -5))); s.setVolume(v); this._showOsd((v === 0 ? "🔇 " : "🔊 ") + v + "%"); }
        else {
          const now = performance.now(), d = (k === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 15 : 5), base = this._kbT != null && now - this._kbAt < 800 ? this._kbT : i.time;   // quick repeats build on the last target
          const to = Math.max(0, Math.min(i.duration || 1e9, base + d)); this._kbT = to; this._kbAt = now;
          const r = s.seek(to); if (!r || r.ok !== false) this._showOsd((d > 0 ? "⏩ " : "⏪ ") + C.fmtTime(to) + (i.duration ? " / " + C.fmtTime(i.duration) : ""));
        }
        this.refresh();
      };
      window.addEventListener("keydown", this._ks, true);
      for (const n of [this.panel, this.coop, this.chat]) {
        n.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
        n.addEventListener("mousedown", (e) => e.stopPropagation());
        n.addEventListener("keydown", (e) => e.stopPropagation());
      }

      const sayErr = (r) => { if (r && !r.ok) this.setMsg(r.error, "err"); };
      q("#cin-load").addEventListener("click", async () => {
        const s = S(); this.uiMsg = null;
        const r = await s.loadVideo(q("#cin-url").value);
        if (!r.ok) { this.uiMsg = { text: r.error, kind: r.kind === "config" ? "config" : "unsupported" }; }
        else q("#cin-url").blur();
        this.refresh();
      });
      q("#cin-url").addEventListener("keydown", (e) => { if (e.key === "Enter") q("#cin-load").click(); });
      q("#cin-url").addEventListener("input", () => { if (this.uiMsg) { this.uiMsg = null; this.refresh(); } });
      q("#cin-play").addEventListener("click", () => { sayErr(S().play()); this.refresh(); });
      q("#cin-pause").addEventListener("click", () => { sayErr(S().pause()); this.refresh(); });
      const seek = q("#cin-seek");
      seek.addEventListener("pointerdown", () => { this.dragging = true; });
      seek.addEventListener("input", () => { const d = S().info().duration; if (d) $(p, "#cin-cur").textContent = C.fmtTime((seek.value / 1000) * d); });
      // Native `change` fires synchronously on mouseup/keyup and must be the thing that actually seeks — it's
      // the only event that also handles keyboard arrow-key seeking (which never fires pointerdown, so it must
      // never be gated on `dragging`). The bug was a race: a separate window-level pointerup handler used to run
      // its own refresh() synchronously too, and on some browsers that fires before `change`, overwriting
      // seek.value back to the stale pre-drag position so `change` then seeks to the wrong spot. Fix: the
      // pointerup/pointercancel fallback is now deferred a tick, so `change` always wins the race; the fallback
      // becomes a no-op in the normal case (dragging is already false by then) and only exists to recover a
      // stuck drag state if `change` never fires (e.g. a cancelled touch).
      seek.addEventListener("change", () => {
        this.dragging = false;
        const d = S().info().duration;
        if (d) { sayErr(S().seek((seek.value / 1000) * d)); this._seekSettleUntil = performance.now() + 500; }
        this.refresh();
      });
      this._pu = () => { if (this.dragging) setTimeout(() => { if (this.dragging) { this.dragging = false; this.refresh(); } }, 0); };
      window.addEventListener("pointerup", this._pu);
      window.addEventListener("pointercancel", this._pu);
      q("#cin-vol").addEventListener("input", (e) => S().setVolume(+e.target.value));
      q("#cin-mute").addEventListener("click", () => S().toggleMute());
      q("#cin-rate").addEventListener("change", (e) => { sayErr(S().setRate(+e.target.value)); this.refresh(); });
      q("#cin-join").addEventListener("click", () => { S().join(); this.refresh(); });
      q("#cin-gesture").addEventListener("click", () => { S().resumeFromGesture(); this.refresh(); });
      // subtitles (Drive videos): pick a .srt / .vtt; it plays with the video on THIS player only
      q("#cin-sub").addEventListener("click", () => q("#cin-sub-file").click());
      q("#cin-sub-off").addEventListener("click", () => { const a = S().adapter; if (a && a.clearSubtitles) a.clearSubtitles(); this.uiMsg = null; this.refresh(); });
      q("#cin-sub-file").addEventListener("change", async (e) => {
        const f = e.target.files && e.target.files[0]; e.target.value = ""; if (!f) return;
        const a = S().adapter; if (!a || !a.addSubtitles) return this.setMsg("Subtitles only work for Google Drive videos.", "err");
        if (!/\.(srt|vtt)$/i.test(f.name)) return this.setMsg("Use a .srt or .vtt subtitle file (other formats like .ass or .sub aren't supported).", "err");
        if (f.size > 2 * 1024 * 1024) return this.setMsg("That subtitle file is too big (over 2 MB). Is it really a subtitle file?", "err");
        let buf; try { buf = await f.arrayBuffer(); } catch (x) { return this.setMsg("Couldn't read that file.", "err"); }
        let text; try { text = new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch (x) { text = new TextDecoder("windows-1252").decode(buf); }   // older files are often not UTF-8
        const vtt = C.srtToVtt(text); if (!vtt) return this.setMsg("Couldn't find any subtitles in that file. It should be a normal .srt or .vtt file.", "err");
        const ad = S().adapter; if (!ad || !ad.addSubtitles) return this.setMsg("The video changed while the file was loading. Try again.", "err");
        ad.addSubtitles(vtt, f.name.replace(/\.(srt|vtt)$/i, "")); this.uiMsg = null; this.refresh();
      });
      q("#cin-signin").addEventListener("click", async () => { const r = await S().signIn(); sayErr(r); this.refresh(); });
      q("#cin-end").addEventListener("click", () => { sayErr(S().endSession()); this.refresh(); });
      q("#cin-leave").addEventListener("click", () => { S().leave(); this.refresh(); });
      q("#cin-close").addEventListener("click", () => this.close());
      q("#cin-x").addEventListener("click", () => this.close());
      q("#cin-fs").addEventListener("click", () => this.toggleFullscreen());
      q("#cin-chat-btn").addEventListener("click", () => this.toggleChat());
      this.fab.addEventListener("click", () => { this.toggleChat(); });
      for (const n of [this.fab, this.toasts]) { n.addEventListener("mousedown", (e) => e.stopPropagation()); n.addEventListener("keydown", (e) => e.stopPropagation()); }

      // chat panel
      const ch = this.chat, chq = (s) => $(ch, s);
      chq("#cin-chat-x").addEventListener("click", () => this.closeChat());
      chq("#cin-chat-form").addEventListener("submit", (e) => { e.preventDefault(); this.sendChat(); });
      // Explicit Enter handling, not reliance on native implicit form-submission-on-Enter: the window-level
      // capture listener above (which every key must go through while the panel is open, so the game never
      // sees it) calls stopPropagation() for every key, which — like #cin-url's own Load-on-Enter wiring below
      // it — also suppresses the browser's native "Enter submits the form" default action for a descendant
      // input. So Enter is wired here directly, the same way #cin-url already drives #cin-load on Enter.
      chq("#cin-chat-input").addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); this.sendChat(); } });

      // co-op connect panel
      const c = this.coop, cq = (s) => $(c, s), L = () => this.getLink();
      const cmsg = (t, kind) => { const m = cq("#coop-msg"); m.textContent = t || ""; m.className = "cin-msg" + (kind ? " " + kind : ""); };
      const busy = async (btn, fn) => { btn.disabled = true; try { await fn(); } catch (e) { cmsg((e && e.message) || "Something went wrong.", "err"); } finally { btn.disabled = false; } };
      this.btn.addEventListener("click", () => (this.coopOpen ? this.closeCoop() : this.openCoop()));
      cq("#coop-close").addEventListener("click", () => this.closeCoop());
      cq("#coop-host").addEventListener("click", (e) => busy(e.target, async () => {
        cq("#coop-intro").hidden = true; cq("#coop-host-step").hidden = false; cmsg("Creating your invite…", "note");
        if (L().relay) this._relayLayout(true);
        cq("#coop-offer").value = await L().createInvite(); cmsg(L().relay ? "Room ready. Copy the invite and send it to your partner. You connect as soon as they join." : "Invite ready. Copy it and send it to your partner.", "note");
      }));
      cq("#coop-join").addEventListener("click", () => { cq("#coop-intro").hidden = true; cq("#coop-join-step").hidden = false; cmsg(""); if (L().relay) this._relayLayout(false); cq("#coop-invite-in").focus(); });
      cq("#coop-copy-offer").addEventListener("click", () => this._copy(cq("#coop-offer")));
      cq("#coop-copy-answer").addEventListener("click", () => this._copy(cq("#coop-answer")));
      cq("#coop-connect").addEventListener("click", (e) => busy(e.target, async () => { await L().acceptAnswer(cq("#coop-reply-in").value); cmsg("Connecting…", "note"); }));
      cq("#coop-make-reply").addEventListener("click", (e) => busy(e.target, async () => { if (L().relay) { cmsg("Joining…", "note"); await L().acceptInvite(cq("#coop-invite-in").value); cmsg("Joined. Waiting for your partner if they aren't here yet.", "note"); return; } cmsg("Creating your reply…", "note"); cq("#coop-answer").value = await L().acceptInvite(cq("#coop-invite-in").value); cmsg("Reply ready. Copy it and send it back. You'll connect as soon as they paste it.", "note"); }));
      cq("#coop-diag").addEventListener("click", () => busy(cq("#coop-diag"), async () => {
        const txt = await L().reportText(), ta = document.createElement("textarea"); ta.value = txt; ta.style.cssText = "position:fixed;left:-9999px"; document.body.appendChild(ta);
        try { if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(txt); else { ta.select(); document.execCommand("copy"); } cmsg("Connection report copied. Paste it into a message.", "note"); } catch (e) { ta.select(); try { document.execCommand("copy"); cmsg("Connection report copied.", "note"); } catch (x) { cmsg("Couldn't copy automatically; see the browser console (Cinema.link.reportText()).", "err"); } }
        ta.remove();
      }));
      cq("#coop-disconnect").addEventListener("click", () => { L().close(); this._resetCoop(); this.refreshCoop(); });
    }
    _copy(ta) {
      const done = () => { const m = $(this.coop, "#coop-msg"); m.textContent = "Copied."; m.className = "cin-msg note"; };
      if (!ta.value) return;
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(done, () => { ta.select(); document.execCommand && document.execCommand("copy"); done(); });
      else { ta.select(); try { document.execCommand("copy"); } catch (e) { /* user can copy by hand */ } done(); }
    }
    // Relay mode has no reply code: hide that half of the panel (and put it back on reset).
    _relayLayout(host) {
      const c = this.coop, q = (s) => $(c, s);
      if (host) { q("#coop-reply-in").closest("label").hidden = true; q("#coop-connect").closest(".cin-actions").hidden = true; q("#coop-offer").closest("label").firstChild.textContent = "Send this invite code to your partner. They paste it to join: "; }
      else { q("#coop-answer").closest("label").hidden = true; q("#coop-copy-answer").closest(".cin-actions").hidden = true; q("#coop-make-reply").textContent = "Join"; q("#coop-invite-in").closest("label").firstChild.textContent = "Paste the invite code from your partner: "; }
    }
    _resetCoop() { const c = this.coop; for (const s of ["#coop-reply-in", "#coop-answer"]) $(c, s).closest("label").hidden = false; for (const s of ["#coop-connect", "#coop-copy-answer"]) $(c, s).closest(".cin-actions").hidden = false; $(c, "#coop-make-reply").textContent = "Create reply"; $(c, "#coop-offer").closest("label").firstChild.textContent = "1. Send this invite code to your partner"; $(c, "#coop-invite-in").closest("label").firstChild.textContent = "1. Paste the invite code from your partner"; $(c, "#coop-intro").hidden = false; $(c, "#coop-host-step").hidden = $(c, "#coop-join-step").hidden = true; for (const id of ["#coop-offer", "#coop-reply-in", "#coop-invite-in", "#coop-answer"]) $(c, id).value = ""; $(c, "#coop-msg").textContent = ""; }

    /* ---------- open / close ---------- */
    open() {
      if (this.cinOpen) return;
      this.cinOpen = true; this.coopOpen = false; this.coop.hidden = true; this.panel.hidden = false; this.uiMsg = null;
      this.screen.classList.add("theater"); this.screen.removeAttribute("style");
      const g = window.game; if (g && g.input) { g.input.down.clear(); g.input.pressed.clear(); }
      this.refresh(true); this._refreshChatStatus(); this._syncFsExitChip();
      clearInterval(this._timer); this._timer = setInterval(() => { this.refresh(); this._refreshChatStatus(); }, 250);
      const info = this.getSession().info();
      setTimeout(() => { const t = $(this.panel, "#cin-url"); t.focus(); }, 0);
    }
    close() {
      if (!this.cinOpen) return;
      // Closing the panel no longer force-exits fullscreen: if you're watching fullscreen, closing the
      // controls/chat just tucks them away and keeps the big video playing — it doesn't kick you out.
      const stayFs = this._isFullscreen();
      this.closeChat();
      this.cinOpen = false; this.panel.hidden = true; clearInterval(this._timer); this._timer = null; this.dragging = false;
      if (!stayFs) this.screen.classList.remove("theater");
      if (document.activeElement && this.panel.contains(document.activeElement)) document.activeElement.blur();
      const g = window.game; if (g && g.input) { g.input.down.clear(); g.input.pressed.clear(); }
      this._syncFsExitChip();
      this.onClosed();
    }
    openCoop() { if (this.coopOpen) return; if (this.cinOpen) this.close(); this.coopOpen = true; this.coop.hidden = false; this.refreshCoop(); const g = window.game; if (g && g.input) { g.input.down.clear(); g.input.pressed.clear(); } this._ct = setInterval(() => this.refreshCoop(), 500); }
    closeCoop() { this.coopOpen = false; this.coop.hidden = true; clearInterval(this._ct); if (document.activeElement && this.coop.contains(document.activeElement)) document.activeElement.blur(); const g = window.game; if (g && g.input) { g.input.down.clear(); g.input.pressed.clear(); } }
    get modal() { return this.cinOpen || this.coopOpen; }

    /* ---------- fullscreen ---------- */
    _isFullscreen() { return (document.fullscreenElement || document.webkitFullscreenElement) === this.stage; }
    async toggleFullscreen() {
      try {
        if (this._isFullscreen()) { await this._exitFullscreen(); return; }
        const enabled = document.fullscreenEnabled || document.webkitFullscreenEnabled;
        if (!enabled) { this.setMsg("Fullscreen isn't supported here — your browser (or an embedding frame) has it disabled.", "err"); return; }
        if (this.stage.requestFullscreen) await this.stage.requestFullscreen({ navigationUI: "hide" }).catch(() => this.stage.requestFullscreen());
        else if (this.stage.webkitRequestFullscreen) this.stage.webkitRequestFullscreen();
        else { this.setMsg("Fullscreen isn't supported in this browser.", "err"); return; }
      } catch (e) { this.setMsg((e && e.message) || "Couldn't enter fullscreen.", "err"); }
    }
    async _exitFullscreen() {
      try { if (document.exitFullscreen) await document.exitFullscreen(); else if (document.webkitExitFullscreen) document.webkitExitFullscreen(); } catch (e) { /* already out */ }
    }
    _onFsChange() {
      const on = (this._fsOn = this._isFullscreen());
      this.stage.classList.toggle("cin-fs", on);
      const b = $(this.panel, "#cin-fs");
      if (b) { b.textContent = "⛶"; b.title = on ? "Exit fullscreen" : "Fullscreen"; b.setAttribute("aria-label", on ? "Exit fullscreen" : "Enter fullscreen"); }
      // Leaving fullscreen (however it happened — our button, Esc, the browser's own UI) while the panel had
      // been closed: the screen was only staying theater-sized to fill the fullscreen view, so drop that now
      // and let it go back to sitting on the in-room TV.
      if (!on && !this.cinOpen) this.screen.classList.remove("theater");
      this._syncFsExitChip();
      if (this.cinOpen) this.refresh();
    }
    // A fullscreen "⛶ Exit fullscreen" chip, shown only when fullscreen is on AND the panel/chat are closed —
    // i.e. exactly the state where there would otherwise be no visible way back (close() keeps fullscreen on
    // but hides the panel that the main fullscreen button lives in). Same condition also switches the screen
    // to the "bare" fullscreen layout — no 170px reserved at the bottom for a panel that isn't showing — so
    // the video actually fills the screen edge-to-edge (16:9 permitting) instead of sitting in a smaller box.
    _syncFsExitChip() {
      const bare = this._isFullscreen() && !this.cinOpen;
      this.fsExit.hidden = !bare;
      this.stage.classList.toggle("cin-fs-bare", bare);
    }

    /* ---------- chat ---------- */
    toggleChat() { this.chatOpen ? this.closeChat() : this.openChat(); }
    openChat() {
      if (this.chatOpen) return;
      this.chatOpen = true; this.chat.hidden = false; this._unread = 0; this._updateFab(); this.toasts.textContent = "";
      const g = window.game; if (g && g.input) { g.input.down.clear(); g.input.pressed.clear(); }
      const q = (s) => $(this.chat, s); q("#cin-chat-list").scrollTop = q("#cin-chat-list").scrollHeight;
      setTimeout(() => q("#cin-chat-input").focus(), 0);
      this._refreshChatStatus();
    }
    closeChat() {
      if (!this.chatOpen) return;
      this.chatOpen = false; this.chat.hidden = true; this._updateFab();
      if (document.activeElement && this.chat.contains(document.activeElement)) document.activeElement.blur();
    }
    _refreshChatStatus() {
      if (!this.chat || this.chat.hidden) return;
      const L = this.getLink(), q = (s) => $(this.chat, s), open = !!(L && L.open);
      q("#cin-chat-input").disabled = !open; q("#cin-chat-send").disabled = !open;
      q("#cin-chat-status").textContent = open ? "" : "Not connected to your partner — reconnect co-op to send messages.";
    }
    _fmtClock(ts) { try { return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); } catch (e) { return ""; } }
    sendChat() {
      const q = (s) => $(this.chat, s), input = q("#cin-chat-input");
      const text = input.value.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 500);
      if (!text) return;
      const L = this.getLink(), ts = Date.now();
      const ok = L && L.send && L.send("chat", { text, ts });
      this.addChatMessage({ mine: true, name: "You", text, ts, failed: !ok });
      input.value = "";
      this._refreshChatStatus();
      if (!ok) q("#cin-chat-status").textContent = "Not connected to your partner — that message wasn't sent.";
    }
    // never innerHTML: every piece of text here (name, message) is set with textContent only.
    addChatMessage({ mine, name, text, ts, failed }) {
      const list = $(this.chat, "#cin-chat-list");
      const empty = list.querySelector(".cin-chat-empty"); if (empty) empty.remove();
      const row = document.createElement("div"); row.className = "cin-msg-row " + (mine ? "me" : "them") + (failed ? " failed" : "");
      const bubble = document.createElement("div"); bubble.className = "cin-msg-bubble"; bubble.textContent = text;
      const meta = document.createElement("div"); meta.className = "cin-msg-meta"; meta.textContent = `${mine ? "You" : (name || "Partner")} · ${this._fmtClock(ts)}${failed ? " · not delivered" : ""}`;
      row.append(bubble, meta); list.appendChild(row);
      this.chatMsgs.push({ mine, name, text, ts, failed }); if (this.chatMsgs.length > 300) { this.chatMsgs.shift(); if (list.firstChild) list.firstChild.remove(); }
      list.scrollTop = list.scrollHeight;
      if (!mine && !this.chatOpen) { this._unread++; this._updateFab(); this._toast(name || "Partner", text); }
    }
    // A see-through pop-up at the top of the screen (also in fullscreen). Click it to open the chat on the side.
    _toast(name, text) {
      const d = document.createElement("div"); d.className = "cin-toast"; d.setAttribute("role", "status");
      const b = document.createElement("b"); b.textContent = name + ": "; d.append(b, document.createTextNode(String(text).slice(0, 140)));
      d.addEventListener("click", () => { d.remove(); this.openChat(); });
      this.toasts.appendChild(d); while (this.toasts.children.length > 3) this.toasts.firstChild.remove();
      setTimeout(() => { d.classList.add("out"); setTimeout(() => d.remove(), 450); }, 6000);
    }
    _showOsd(text) { this.osd.textContent = text; this.osd.classList.add("on"); clearTimeout(this._osdT); this._osdT = setTimeout(() => this.osd.classList.remove("on"), 1000); }
    _updateFab() {
      const L = this.getLink(), linked = !!L && (L.state === "open" || L.state === "reconnecting"), badge = $(this.fab, ".badge");
      this.fab.classList.toggle("show", linked || this.chatOpen);
      badge.hidden = !this._unread; badge.textContent = this._unread > 9 ? "9+" : String(this._unread);
    }

    /* ---------- the video on the TV ---------- */
    // rect = the TV screen in CSS px, or null to hide the video (player not in the cinema room)
    placeScreen(rect, joined) {
      const s = this.screen;
      if (!joined) { if (!s.hidden) s.hidden = true; return; }
      if (s.hidden) s.hidden = false;
      if (this.cinOpen || this._isFullscreen()) return;          // theater mode (incl. a closed panel that stayed fullscreen) is laid out by CSS
      if (!rect) { s.hidden = true; return; }
      const w = Math.min(rect.w, rect.h * (16 / 9)), h = w * (9 / 16);                 // fit 16:9 inside the TV glass
      const x = Math.round(rect.x + (rect.w - w) / 2), y = Math.round(rect.y + (rect.h - h) / 2);
      Object.assign(s.style, { left: x + "px", top: y + "px", width: Math.round(w) + "px", height: Math.round(h) + "px", transform: "none" });
    }

    /* ---------- refresh ---------- */
    setMsg(text, kind) { this.uiMsg = { text, kind: kind === "err" ? "unsupported" : "note" }; this.refresh(); }
    refresh(force) {
      const s = this.getSession(), i = s.info(), p = this.panel, q = (x) => $(p, x);
      // the on-screen overlay while the video is still preparing
      const waiting = i.joined && i.active && !i.error && (i.kind === "wait" || i.needsGesture);
      this.wait.hidden = !waiting; if (waiting) this.wait.textContent = i.needsGesture ? "Click “Join playback” below" : i.label === "Waiting for host" ? "Waiting for the host…" : "Loading…";
      if (!this.cinOpen) return;
      const unsupported = this.uiMsg && this.uiMsg.kind === "unsupported", notSetUp = this.uiMsg && this.uiMsg.kind === "config";
      const chip = q("#cin-status"), label = unsupported ? "Unsupported Link" : notSetUp ? "Setup needed" : i.label, kind = unsupported || notSetUp ? "error" : i.kind;
      chip.textContent = label; chip.className = "cin-chip " + kind;
      q("#cin-role").textContent = !i.active ? "" : i.linked ? (i.peerJoined ? "Shared controls: either of you" : "Partner isn't in the session yet") : "Solo";
      q("#cin-url").disabled = false; q("#cin-load").disabled = false; q("#cin-load").title = ""; q("#cin-url").placeholder = "Paste a YouTube or Google Drive link…";
      const ctl = i.canControl;                                                       // both players, as soon as their own player is ready
      q("#cin-play").disabled = !ctl || i.playing; q("#cin-pause").disabled = !ctl || !i.playing && i.state && i.state.playback !== "playing";
      const seek = q("#cin-seek"); seek.disabled = !ctl || !i.duration;
      // skip the slider/time refresh for a brief settle window right after a seek: the YouTube player's seekTo()
      // is async, so i.time can still report the pre-seek position for a tick — redrawing from it here would
      // otherwise flash the slider back to where it was before snapping to the real (seeked-to) position.
      const settling = this._seekSettleUntil && performance.now() < this._seekSettleUntil;
      if (!this.dragging && !settling) { seek.value = i.duration ? Math.min(1000, Math.round((i.time / i.duration) * 1000)) : 0; q("#cin-cur").textContent = i.joined ? C.fmtTime(i.time) : "0:00"; }
      q("#cin-dur").textContent = i.duration ? C.fmtTime(i.duration) : "--:--";
      const vol = q("#cin-vol"); if (document.activeElement !== vol) vol.value = i.volume;
      q("#cin-mute").textContent = i.muted || i.volume === 0 ? "🔇" : "🔊";
      const rate = q("#cin-rate"); rate.disabled = !ctl; if (document.activeElement !== rate) { const v = String(i.rate); if (rate.value !== v && [...rate.options].some((o) => o.value === v)) rate.value = v; }
      q("#cin-gesture").hidden = !i.needsGesture;
      q("#cin-join").hidden = !(i.active && !i.joined);
      q("#cin-signin").hidden = !i.needsAuth;
      { const ad = s.adapter, can = !!(ad && ad.addSubtitles && i.joined), has = can && ad.hasSubtitles(); q("#cin-sub").hidden = !can; q("#cin-sub-off").hidden = !has; q("#cin-sub").textContent = has ? "CC " + String(ad.subLabel).slice(0, 18) : "CC Subtitles"; }
      q("#cin-end").hidden = !(i.active && i.joined);
      q("#cin-leave").hidden = !i.joined;
      q("#cin-who").textContent = i.title ? i.title.slice(0, 60) : "";
      // one message line, most important first
      const who = i.peerName || "Your partner";
      let text = "", mk = "note";
      if (this.uiMsg) { text = this.uiMsg.text; mk = "err"; }
      else if (i.error) { text = i.error; mk = "err"; }
      else if (i.needsAuth) { text = "This is a Google Drive video. Sign in with the Google account that can open it (press “Sign in with Google”)."; mk = "err"; }
      else if (i.peerError) { text = `${who}'s player: ${i.peerError}`; mk = "err"; }
      else if (i.peerStale) { text = `${who} isn't responding. Playback may drift until they're back.`; mk = "err"; }
      else if (i.peerBuffering) text = `${who} is buffering. You can keep watching; they'll catch up to the shared position.`;
      else if (i.active && !i.joined) text = `${i.state && i.state.by === s.self.id ? "You" : who} started a video. Press “Join session” to watch together.`;
      else if (i.joined && !i.linked && i.peerName) text = "Connection to your partner is down. You can keep watching and controlling; you'll resync when it's back.";
      else if (!i.active) text = i.linked ? `Connected to ${i.peerName}. Paste a YouTube or Google Drive link and press Load Video, then Play. Either of you can control it.` : "Playing solo. Use Co-op to connect your partner so you can watch together.";
      else if (i.joined && i.state.playback === "paused" && !i.time && i.state.cmd === "load") text = "Loaded. Press Play to start for both of you.";
      else if (location.protocol === "file:") { text = "Heads up: videos can't be embedded or streamed from a page opened as a file. Serve the game from http://localhost."; mk = "err"; }
      const m = q("#cin-msg"); if (m.textContent !== text) m.textContent = text; m.className = "cin-msg " + (mk === "err" ? "err" : "note");
      const la = i.lastAction, last = q("#cin-last");
      const verb = !la ? "" : { load: "loaded this video", play: `pressed play at ${C.fmtTime(la.position)}`, pause: `paused at ${C.fmtTime(la.position)}`, seek: `jumped to ${C.fmtTime(la.position)}`, rate: "changed the speed", ended: "reached the end", end: "ended the session" }[la.cmd] || "";
      const lt = verb ? `${la.who} ${verb}` : ""; if (last.textContent !== lt) last.textContent = lt;
    }
    refreshCoop() {
      const L = this.getLink(), c = this.coop, cq = (s) => $(c, s), st = L.state, chip = cq("#coop-state");
      const names = { idle: ["Not connected", ""], offering: ["Waiting for reply", "wait"], answering: ["Waiting for partner", "wait"], connecting: ["Connecting", "wait"], open: ["Connected", "play"], reconnecting: ["Reconnecting", "pause"], failed: ["Disconnected", "error"], closed: ["Not connected", ""] };
      if (L.relay) { names.offering = ["Waiting for partner", "wait"]; names.answering = ["Waiting for partner", "wait"]; cq("#coop-intro .cin-note").textContent = "Play together over the internet: no matter which Wi-Fi each of you is on. One of you makes an invite and sends it; the other pastes it to join."; }
      const n = names[st] || names.idle; chip.textContent = n[0]; chip.className = "cin-chip " + n[1];
      const live = st === "open" || st === "reconnecting";
      cq("#coop-live").hidden = !live; if (live) { cq("#coop-intro").hidden = true; cq("#coop-host-step").hidden = cq("#coop-join-step").hidden = true; }
      cq("#coop-live-text").textContent = L.peer ? `You're linked with ${L.peer.name}${L.rtt != null ? ` · ${Math.round(L.rtt)} ms` : ""}. ${L.detail || ""}` : (L.relay && L.detail ? L.detail : "Linked.");
      if (!live && (st === "failed") && L.detail) { const m = cq("#coop-msg"); m.textContent = L.detail + " Create a new invite to reconnect."; m.className = "cin-msg err"; if (cq("#coop-intro").hidden === true && cq("#coop-host-step").hidden && cq("#coop-join-step").hidden) { cq("#coop-intro").hidden = false; } }
      if (!live && (st === "connecting" || st === "answering") && /Still trying/.test(L.detail || "")) { const m = cq("#coop-msg"); m.textContent = L.detail; m.className = "cin-msg err"; }
      this.refreshBadge();
    }
    refreshBadge() {
      const L = this.getLink(), st = L.state, b = this.btn, lbl = $(b, ".lbl");
      if (this.fab) { this._updateFab(); this._refreshChatStatus(); }
      b.className = st === "open" ? "on" : st === "reconnecting" ? "warn" : st === "failed" ? "off" : "";
      const w = this.where();
      lbl.textContent = st === "open" || st === "reconnecting" ? `${L.peer ? L.peer.name : "Partner"}${w ? " · " + w : ""}${st === "reconnecting" ? " (reconnecting)" : ""}` : st === "failed" ? "Co-op: disconnected" : "Co-op";
    }
    destroy() {
      window.removeEventListener("keydown", this._kd, true); window.removeEventListener("keydown", this._ks, true); clearTimeout(this._osdT); window.removeEventListener("pointerup", this._pu); window.removeEventListener("pointercancel", this._pu);
      for (const ev of ["fullscreenchange", "webkitfullscreenchange"]) document.removeEventListener(ev, this._fsHandler);
      clearInterval(this._timer); clearInterval(this._ct);
      for (const n of [this.stage, this.coop, this.btn, this.fab, this.toasts, this.osd]) n.remove();
    }
  }
  return { UI };
})();
