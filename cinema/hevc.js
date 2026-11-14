"use strict";
/* ==========================================================
   Moonlight Valley — co-op cinema: HEVC (H.265 / x265) support for Drive videos.

   THE PROBLEM
   A <video> element only decodes what the browser (and the computer's GPU / OS) can decode. Many browsers cannot decode HEVC. They still
   open the MP4 / MKV, decode the AUDIO and report "playing", but the picture is never drawn: videoWidth = 0, no frames, a black screen.
   An HEVC MKV with AC-3 / DTS audio often fails outright.

   WHAT THIS FILE DOES (only when it is needed; H.264 / WebM videos never touch it)
     1. sniff()    reads the file's own headers (a few small range requests: MP4 `moov`, MKV `Tracks`) and reports the video and audio codec.
     2. plan()     asks the browser what it can decode:
                     - not HEVC                                   -> "native"    (nothing to do, play as before)
                     - HEVC the browser can decode, audio it can  -> "native"
                     - HEVC the browser can decode, audio it can't-> "remux"      (copy the video untouched into an MP4, re-encode only the audio to AAC: seconds, lossless)
                     - HEVC the browser cannot decode             -> "transcode" (H.264 + AAC)
     3. convert()  downloads the file (Drive API, the signed-in user's own access), converts it in the browser with ffmpeg.wasm (a worker, loaded
                   only now from cinema/vendor/ffmpeg/), and returns an MP4 Blob that the same <video> element plays.
   The player (gdrive.js) always tries the file as it is first and only steps in when no picture or sound appears; it then goes up this ladder one
   step at a time: "remux" (cheap) before "transcode" (slow), never more than two conversions of one file, the download is reused between them.
   Nothing is uploaded anywhere: the conversion happens on the player's own computer, in memory, and the result is discarded with the player.

   Honest limits (see also the messages the player shows): conversion runs in WebAssembly on ONE thread, so it is roughly real-time speed on a fast
   computer for 1080p (faster for 720p / 480p), and the whole file has to fit in the browser's memory (default limit 1 GB, config hevcMaxBytes).

   Pure parsing code (no DOM) is exported for node: tools/test_hevc.js.
   ========================================================== */
(function () {
  const cfg = () => (typeof window !== "undefined" && window.CINEMA_CONFIG) || {};

  /* ---------- tiny byte helpers ---------- */
  const u16 = (b, o) => (b[o] << 8) | b[o + 1];
  const u32 = (b, o) => b[o] * 16777216 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
  const cc = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  const hex2 = (n) => n.toString(16).toUpperCase();

  /* ======================================================================
     MP4 / MOV:  ftyp, moov, mdat ...   moov > trak > mdia > (hdlr, minf > stbl > stsd)
     ====================================================================== */
  function* boxes(b, start, end) {
    let o = start;
    while (o + 8 <= end) {
      let size = u32(b, o), hdr = 8; const type = cc(b, o + 4);
      if (size === 1) { if (o + 16 > end) return; size = u32(b, o + 8) * 4294967296 + u32(b, o + 12); hdr = 16; }
      else if (size === 0) size = end - o;
      if (size < hdr) return;
      yield { type, start: o, body: o + hdr, end: Math.min(end, o + size), size };
      o += size;
    }
  }
  const child = (b, box, type) => { if (!box) return null; for (const c of boxes(b, box.body, box.end)) if (c.type === type) return c; return null; };

  // hvcC (HEVCDecoderConfigurationRecord) -> the codec string a browser understands, e.g. hvc1.1.6.L93.B0
  function hevcCodecString(fmt, b, o, e) {
    if (e - o < 13) return fmt;
    const space = b[o + 1] >> 6, tier = (b[o + 1] >> 5) & 1, profile = b[o + 1] & 31, compat = u32(b, o + 2), level = b[o + 12];
    let rev = 0; for (let i = 0; i < 32; i++) rev = rev * 2 + (Math.floor(compat / Math.pow(2, i)) % 2);        // the 32 compatibility flags, bit order reversed
    const cons = Array.from(b.subarray(o + 6, o + 12)); while (cons.length && cons[cons.length - 1] === 0) cons.pop();
    return `${fmt}.${space ? "ABC"[space - 1] : ""}${profile}.${hex2(rev)}.${tier ? "H" : "L"}${level}${cons.map((x) => "." + hex2(x)).join("")}`;
  }

  // esds -> { objectType, aot }
  function esdsInfo(b, o, e) {
    let p = o + 4; const out = {};
    const len = () => { let n = 0, k = 0, c; do { c = b[p++]; n = (n << 7) | (c & 127); k++; } while ((c & 128) && k < 4 && p < e); return n; };
    while (p < e) {
      const tag = b[p++], l = len();
      if (tag === 3) { const fl = b[p + 2]; p += 3; if (fl & 0x80) p += 2; if (fl & 0x40) p += 1 + b[p]; if (fl & 0x20) p += 2; }
      else if (tag === 4) { out.objectType = b[p]; p += 13; }
      else if (tag === 5) { out.aot = b[p] >> 3; return out; }
      else p += l;
    }
    return out;
  }

  const MP4_AUDIO = { "mp4a": "aac", "ac-3": "ac3", "ec-3": "eac3", "Opus": "opus", "fLaC": "flac", "alac": "alac", ".mp3": "mp3", "dtsc": "dts", "dtsh": "dts", "dtsl": "dts", "dtse": "dts", "mlpa": "truehd", "sowt": "pcm", "twos": "pcm" };
  const AUDIO_CODEC = { aac: "mp4a.40.2", ac3: "ac-3", eac3: "ec-3", opus: "opus", flac: "flac", mp3: "mp4a.6B", alac: "alac", vorbis: "vorbis" };

  function mp4Tracks(b, start, end) {
    const out = [];
    for (const trak of boxes(b, start, end)) {
      if (trak.type !== "trak") continue;
      const mdia = child(b, trak, "mdia"), hdlr = child(b, mdia, "hdlr"), stsd = child(b, child(b, child(b, mdia, "minf"), "stbl"), "stsd");
      if (!stsd || stsd.end - stsd.body < 16) continue;
      const handler = hdlr ? cc(b, hdlr.body + 8) : "", e0 = stsd.body + 8, size = u32(b, e0), fmt = cc(b, e0 + 4), e1 = Math.min(stsd.end, e0 + size);
      if (handler === "vide") {
        const t = { kind: "video", fmt, codec: fmt, w: u16(b, e0 + 32), h: u16(b, e0 + 34), hevc: /^(hvc1|hev1|dvh1|dvhe)$/.test(fmt) };
        for (const c of boxes(b, e0 + 86, e1)) { if (c.type === "hvcC") t.codec = hevcCodecString(fmt === "dvh1" || fmt === "dvhe" ? "hvc1" : fmt, b, c.body, c.end); else if (c.type === "avcC" && c.end - c.body >= 4) t.codec = "avc1." + [1, 2, 3].map((i) => ("0" + b[c.body + i].toString(16)).slice(-2)).join(""); }
        out.push(t);
      } else if (handler === "soun") {
        const t = { kind: "audio", fmt, audio: MP4_AUDIO[fmt] || "other", codec: fmt };
        const ver = u16(b, e0 + 16), skip = ver === 1 ? 52 : ver === 2 ? 72 : 36;
        for (const c of boxes(b, e0 + skip, e1)) if (c.type === "esds") {
          const es = esdsInfo(b, c.body, c.end);
          if (es.objectType === 0x40) t.codec = "mp4a.40." + (es.aot || 2);
          else if (es.objectType === 0x6b || es.objectType === 0x69) { t.audio = "mp3"; t.codec = "mp4a.6B"; }
          else if (es.objectType != null) { t.audio = "other"; t.codec = "mp4a." + hex2(es.objectType); }
        }
        if (t.audio !== "aac" && AUDIO_CODEC[t.audio] && t.codec === fmt) t.codec = AUDIO_CODEC[t.audio];
        out.push(t);
      }
    }
    return out;
  }

  /* ======================================================================
     Matroska / WebM:  EBML header, Segment > Tracks > TrackEntry
     ====================================================================== */
  function ebmlId(b, o) {
    const f = b[o]; if (!f) return null; let n = 1; while (n <= 4 && !(f & (0x80 >> (n - 1)))) n++; if (n > 4 || o + n > b.length) return null;
    let id = 0; for (let i = 0; i < n; i++) id = id * 256 + b[o + i]; return { id, len: n };
  }
  function ebmlSize(b, o) {
    const f = b[o]; if (!f) return null; let n = 1; while (n <= 8 && !(f & (0x80 >> (n - 1)))) n++; if (n > 8 || o + n > b.length) return null;
    let v = f & (0xff >> n), ones = v === (0xff >> n); for (let i = 1; i < n; i++) { v = v * 256 + b[o + i]; if (b[o + i] !== 255) ones = false; }
    return { size: ones ? -1 : v, len: n };
  }
  function* ebml(b, start, end) {
    let o = start;
    while (o < end) {
      const a = ebmlId(b, o); if (!a) return; const s = ebmlSize(b, o + a.len); if (!s) return;
      const body = o + a.len + s.len, stop = s.size < 0 ? end : body + s.size;
      yield { id: a.id, body, end: Math.min(stop, end), complete: stop <= end };
      if (s.size < 0 || stop > end) return; o = stop;
    }
  }
  const ebNum = (b, e) => { let v = 0; for (let i = e.body; i < e.end; i++) v = v * 256 + b[i]; return v; };
  const MKV_AUDIO = [[/^A_AAC/, "aac"], [/^A_EAC3/, "eac3"], [/^A_AC3/, "ac3"], [/^A_DTS/, "dts"], [/^A_OPUS/, "opus"], [/^A_VORBIS/, "vorbis"], [/^A_FLAC/, "flac"], [/^A_TRUEHD/, "truehd"], [/^A_MPEG\/L3/, "mp3"], [/^A_PCM/, "pcm"]];

  function mkvTracks(b) {
    const out = [];
    for (const top of ebml(b, 0, b.length)) {
      if (top.id !== 0x18538067) continue;                                                // Segment
      for (const seg of ebml(b, top.body, top.end)) {
        if (seg.id === 0x1f43b675) return out;                                            // first Cluster: the Tracks (if any) have come by now
        if (seg.id !== 0x1654ae6b) continue;                                              // Tracks
        for (const te of ebml(b, seg.body, seg.end)) {
          if (te.id !== 0xae) continue;
          const t = { type: 0, codecId: "", priv: null, w: 0, h: 0 };
          for (const f of ebml(b, te.body, te.end)) {
            if (f.id === 0x83) t.type = ebNum(b, f); else if (f.id === 0x86) t.codecId = String.fromCharCode.apply(null, Array.from(b.subarray(f.body, f.end))).replace(/\0+$/, "");
            else if (f.id === 0x63a2) t.priv = [f.body, f.end];
            else if (f.id === 0xe0) for (const v of ebml(b, f.body, f.end)) { if (v.id === 0xb0) t.w = ebNum(b, v); else if (v.id === 0xba) t.h = ebNum(b, v); }
          }
          if (t.type === 1) {
            const hevc = t.codecId === "V_MPEGH/ISO/HEVC", r = { kind: "video", fmt: t.codecId, codec: t.codecId, w: t.w, h: t.h, hevc };
            if (hevc && t.priv) r.codec = hevcCodecString("hvc1", b, t.priv[0], t.priv[1]); else if (hevc) r.codec = "hvc1";
            out.push(r);
          } else if (t.type === 2) {
            const m = MKV_AUDIO.find(([re]) => re.test(t.codecId)), kind = m ? m[1] : "other";
            out.push({ kind: "audio", fmt: t.codecId, audio: kind, codec: AUDIO_CODEC[kind] || t.codecId });
          }
        }
        return out;
      }
    }
    return out;
  }

  /* ---------- sniff: read(start, endInclusive) -> Promise<Uint8Array> ---------- */
  const summarize = (container, tracks) => {
    const video = tracks.find((t) => t.kind === "video") || null, audio = tracks.find((t) => t.kind === "audio") || null;
    return { container, video, audio, hevc: !!(video && video.hevc) };
  };
  async function sniff(read, size) {
    if (!(size > 16)) return null;
    const first = await read(0, Math.min(size, 262144) - 1);
    if (first.length >= 12 && cc(first, 4) === "ftyp") {
      const at = async (off, len) => (off + len <= first.length ? first.subarray(off, off + len) : read(off, Math.min(size, off + len) - 1));
      let off = 0;
      for (let guard = 0; guard < 64 && off < size; guard++) {
        const h = await at(off, 16); if (h.length < 8) return null;
        let sz = u32(h, 0), hdr = 8; const type = cc(h, 4);
        if (sz === 1 && h.length >= 16) { sz = u32(h, 8) * 4294967296 + u32(h, 12); hdr = 16; } else if (sz === 0) sz = size - off;
        if (sz < hdr) return null;
        if (type === "moov") { if (sz > 48 * 1024 * 1024) return null; const m = await at(off, sz); return summarize("mp4", mp4Tracks(m, hdr, m.length)); }
        off += sz;
      }
      return null;
    }
    if (first.length >= 4 && first[0] === 0x1a && first[1] === 0x45 && first[2] === 0xdf && first[3] === 0xa3) {
      const buf = size <= first.length ? first : await read(0, Math.min(size, 1048576) - 1);
      return summarize("mkv", mkvTracks(buf));
    }
    return null;
  }

  /* ---------- which files are worth looking at ---------- */
  const isCandidate = (mime, name) => /^video\/(mp4|quicktime|x-m4v|x-matroska|matroska|mkv)$/i.test(mime || "") || /\.(mp4|m4v|mov|mkv)$/i.test(name || "");
  const isAvi = (mime, name) => /x-msvideo|avi/i.test(mime || "") || /\.avi$/i.test(name || "");

  /* ======================================================================
     What can this browser decode?
     ====================================================================== */
  async function canDecodeVideo(v) {
    if (typeof document === "undefined") return false;
    const ct = `video/mp4; codecs="${v.codec}"`;
    let cp = ""; try { cp = document.createElement("video").canPlayType(ct); } catch (e) { /* ignore */ }
    let mc = null; try { if (navigator.mediaCapabilities && navigator.mediaCapabilities.decodingInfo) mc = await navigator.mediaCapabilities.decodingInfo({ type: "file", video: { contentType: ct, width: v.w || 1920, height: v.h || 1080, bitrate: 8e6, framerate: 30 } }); } catch (e) { /* unsupported query: ignore */ }
    return !!cp || !!(mc && mc.supported);
  }
  function canPlayAudio(a) {
    if (!a) return true;
    if (a.audio === "dts" || a.audio === "truehd" || a.audio === "other") return false;
    const c = AUDIO_CODEC[a.audio]; if (!c) return false;
    try { return !!document.createElement("audio").canPlayType(`audio/mp4; codecs="${c}"`); } catch (e) { return false; }
  }
  async function plan(info) {
    if (!info || !info.hevc) return { action: "native", why: "not HEVC" };
    if (!(await canDecodeVideo(info.video))) return { action: "transcode", why: "this browser can't decode HEVC video" };
    if (!canPlayAudio(info.audio)) return { action: "remux", why: "this browser can't play the " + info.audio.audio.toUpperCase() + " audio" };
    return { action: "native", why: "HEVC is supported here" };
  }

  /* ======================================================================
     Conversion (ffmpeg.wasm in a worker)
     ====================================================================== */
  const here = (p) => new URL(p, document.baseURI).href;
  let libP = null;
  function loadLib() {
    if (typeof FFmpegWASM !== "undefined" && FFmpegWASM.FFmpeg) return Promise.resolve(FFmpegWASM.FFmpeg);
    if (libP) return libP;
    const base = String(cfg().ffmpegBase || "cinema/vendor/ffmpeg/").replace(/\/?$/, "/");
    libP = new Promise((resolve, reject) => {
      const s = document.createElement("script"); s.src = here(base + "ffmpeg.js"); s.async = true;
      s.onload = () => (typeof FFmpegWASM !== "undefined" && FFmpegWASM.FFmpeg ? resolve(FFmpegWASM.FFmpeg) : (libP = null, reject(new Error("The video converter loaded but is unusable."))));
      s.onerror = () => { libP = null; s.remove(); reject(new Error("Couldn't load the video converter (cinema/vendor/ffmpeg/ is missing, or blocked by the network or an extension).")); };
      document.head.appendChild(s);
    });
    return libP;
  }

  const fmtEta = (s) => (s < 90 ? Math.max(1, Math.round(s)) + " s" : Math.round(s / 60) + " min");
  const MB = 1024 * 1024;

  // The ffmpeg arguments. "remux" copies the HEVC video untouched; "transcode" makes H.264 (8-bit 4:2:0, max height cfg.hevcMaxHeight, default 1080) + AAC.
  function ffArgs(mode, info, input, output) {
    const a = ["-i", input, "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn", "-map_metadata", "-1"];
    const aud = info.audio && info.audio.audio === "aac" ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "160k", "-ac", "2"];
    if (mode === "remux") a.push("-c:v", "copy", "-tag:v", "hvc1", ...aud);
    else {
      const maxH = cfg().hevcMaxHeight === undefined ? 1080 : +cfg().hevcMaxHeight;
      if (maxH > 0 && info.video && info.video.h > maxH) a.push("-vf", `scale=-2:${maxH}`);
      a.push("-c:v", "libx264", "-preset", "ultrafast", "-crf", String(cfg().hevcCrf || 23), "-pix_fmt", "yuv420p", ...aud);
    }
    a.push("-movflags", "+faststart", "-y", output);
    return a;
  }

  /* convert({ mode, info, size, read, onStatus, signal }) -> Promise<Blob>   (mp4, H.264/AAC or HEVC/AAC)
       read(start, endInclusive) -> Promise<Uint8Array>   (the Drive download, authorised by the caller)
       onStatus(text)            -> progress sentence for the player
       signal                    -> AbortSignal */
  async function convert({ mode, info, size, read, onStatus, signal, cache }) {
    const say = onStatus || (() => {}), limit = +cfg().hevcMaxBytes || 1024 * MB;
    const gone = () => { if (signal && signal.aborted) { const e = new Error("aborted"); e.aborted = true; throw e; } };
    const fmtSize = (b) => (b >= 1073741824 ? (b / 1073741824).toFixed(1) + " GB" : Math.max(1, Math.round(b / MB)) + " MB");
    if (size > limit) throw new Error(`This HEVC video is ${fmtSize(size)}. Converting it inside the browser works up to about ${fmtSize(limit)}. Convert it once to H.264 / AAC MP4 (for example with HandBrake), or open the game in a browser that supports HEVC (Chrome or Edge on a computer with a recent graphics card, or Safari).`);
    const what = mode === "remux" ? "Preparing this video for your browser" : "Converting this HEVC video for your browser";
    // 1. download (8 MB range requests: each one asks the caller for a fresh, valid token, so a 1 hour token expiring mid-download is not a problem)
    const parts = []; let got = 0; const STEP = 8 * MB, t0 = performance.now();
    if (cache && cache.blob) got = size;                                             // already downloaded for an earlier attempt on this same file
    else for (let a = 0; a < size; a += STEP) {
      gone(); const chunk = await read(a, Math.min(size, a + STEP) - 1); parts.push(chunk); got += chunk.length;
      const sec = (performance.now() - t0) / 1000, left = got > 0 ? (sec * (size - got)) / got : 0;
      say(`${what}: downloading ${Math.round((got / size) * 100)}%${sec > 4 ? " · about " + fmtEta(left) + " left" : ""}`);
    }
    gone();
    const blob = cache && cache.blob ? cache.blob : new Blob(parts); parts.length = 0; if (cache) cache.blob = blob;
    // 2. convert
    say(`${what}: starting the converter…`);
    const FFmpeg = await loadLib(); gone();
    const base = String(cfg().ffmpegBase || "cinema/vendor/ffmpeg/").replace(/\/?$/, "/"), ff = new FFmpeg(), logs = [];
    const onAbort = () => { try { ff.terminate(); } catch (e) { /* ignore */ } };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    try {
      ff.on("log", (e) => { logs.push(String(e.message || "")); if (logs.length > 30) logs.shift(); });
      let t1 = 0; ff.on("progress", (e) => {
        const p = e && isFinite(e.progress) ? Math.min(1, Math.max(0, e.progress)) : 0; if (!t1) t1 = performance.now();
        const sec = (performance.now() - t1) / 1000, left = p > 0.03 ? (sec * (1 - p)) / p : 0;
        say(`${what}: ${Math.round(p * 100)}%${p > 0.03 && sec > 4 ? " · about " + fmtEta(left) + " left" : ""}`);
      });
      await ff.load({ coreURL: here(base + "ffmpeg-core.js"), wasmURL: here(base + "ffmpeg-core.wasm"), classWorkerURL: here(base + "814.ffmpeg.js") }); gone();
      await ff.createDir("/in"); await ff.mount("WORKERFS", { blobs: [{ name: "in.bin", data: blob }] }, "/in");
      say(`${what}: 0%`);
      const rc = await ff.exec(ffArgs(mode, info, "/in/in.bin", "/out.mp4")); gone();
      let out = null; try { out = await ff.readFile("/out.mp4"); } catch (e) { /* handled below */ }
      if (rc !== 0 || !out || out.length < 1024) {
        const why = logs.filter((l) => /error|invalid|unsupported|could not|no such|failed/i.test(l)).slice(-1)[0] || logs.slice(-1)[0] || "unknown error";
        throw new Error("Couldn't convert this video (" + why.slice(0, 120) + ").");
      }
      return new Blob([out], { type: "video/mp4" });
    } finally {
      if (signal) signal.removeEventListener("abort", onAbort);
      try { ff.terminate(); } catch (e) { /* ignore */ }
    }
  }

  const api = { sniff, plan, convert, canDecodeVideo, canPlayAudio, isCandidate, isAvi, ffArgs, _pure: { mp4Tracks, mkvTracks, hevcCodecString, esdsInfo, boxes, summarize } };
  if (typeof window !== "undefined") window.CinemaHevc = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
