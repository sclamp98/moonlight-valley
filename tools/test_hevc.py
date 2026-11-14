"""HEVC (H.265 / x265) playback in the cinema — end-to-end test against the REAL cinema/*.js files.

  python3 tools/test_hevc.py            run everything
  python3 tools/test_hevc.py quick      HEVC MP4 + H.264 control + AVI control only

What it needs: ffmpeg (with libx265 + libx264) on PATH to make small test clips, Playwright for Python with Chromium.
What it stands in for: Google Drive (a tiny local server that answers the Drive API calls cinema/gdrive.js makes, with Range support),
Google sign-in (a stub) and the streaming service worker cinema-sw.js (a small stand-in that does what gdrive.js documents:
add the Authorization header, forward Range). Everything else — core, providers, gdrive, hevc, session, ui — is the shipped code.

The test adapts to the browser it runs in: where the browser cannot decode HEVC (most headless Chromium builds) it checks the
conversion path; where it CAN decode HEVC it checks that the file plays natively with no conversion.
"""
import http.server, json, os, re, shutil, socketserver, subprocess, sys, tempfile, threading, time

ROOT = os.path.abspath(os.environ.get("MV_ROOT") or os.path.join(os.path.dirname(__file__), ".."))   # MV_ROOT: test another copy of the game (e.g. the old code, to see the black screen)
TMP = tempfile.mkdtemp(prefix="mv_hevc_")
QUICK = len(sys.argv) > 1 and sys.argv[1] == "quick"
fails, notes = [], []


def ok(cond, msg, extra=""):
    print(("  PASS  " if cond else "  FAIL  ") + msg + (("  [" + str(extra) + "]") if extra != "" else ""))
    if not cond: fails.append(msg)


def ff(*a):
    r = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *a], capture_output=True, text=True)
    if r.returncode: raise SystemExit("ffmpeg failed: " + r.stderr[-400:])


# ---------------------------------------------------------------- test clips (12 s, 640x360, moving test pattern + 440 Hz tone)
SRC = ["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25:duration=12", "-f", "lavfi", "-i", "sine=frequency=440:duration=12"]
X265 = ["-c:v", "libx265", "-preset", "ultrafast", "-crf", "28", "-pix_fmt", "yuv420p", "-tag:v", "hvc1", "-x265-params", "log-level=none"]
X264 = ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", "-pix_fmt", "yuv420p"]
CLIPS = {
    "hevc_aac.mp4": ("HEVCmp4aaacFaststart001", "video/mp4", [*X265, "-c:a", "aac", "-movflags", "+faststart"]),
    "hevc_aac_moovend.mp4": ("HEVCmp4aaacMoovAtEnd0001", "video/mp4", [*X265, "-c:a", "aac"]),
    "hevc_aac.mkv": ("HEVCmkvAacAudio00000001", "video/x-matroska", [*X265, "-c:a", "aac"]),
    "hevc_ac3.mkv": ("HEVCmkvAc3Audio00000001", "video/x-matroska", [*X265, "-c:a", "ac3"]),
    "hevc10_aac.mkv": ("HEVC10bitMkvAac00000001", "video/x-matroska", [*X265[:6], "-pix_fmt", "yuv420p10le", *X265[8:], "-c:a", "aac"]),
    "h264_aac.mp4": ("H264mp4aacControl0000001", "video/mp4", [*X264, "-c:a", "aac", "-movflags", "+faststart"]),
    "mpeg4_mp3.avi": ("Mpeg4Mp3AviControl00001", "video/x-msvideo", ["-c:v", "mpeg4", "-q:v", "5", "-c:a", "libmp3lame"]),
}
os.makedirs(os.path.join(TMP, "clips"))
for fn, (_, _, args) in CLIPS.items(): ff(*SRC, *args, os.path.join(TMP, "clips", fn))
open(os.path.join(TMP, "clips", "sub.srt"), "w").write("1\n00:00:01,000 --> 00:00:04,000\nHello from the subtitle\n\n2\n00:00:05,000 --> 00:00:09,000\nSecond cue\n")
BY_ID = {v[0]: (k, v[1]) for k, v in CLIPS.items()}
SW = r"""
const reg = new Map();
self.addEventListener('install', e => self.skipWaiting()); self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('message', e => { const m = e.data || {}, p = e.ports[0];
  if (m.type === 'register') { reg.set(m.id, { base: m.base, token: m.token, size: m.size, mime: m.mime }); p && p.postMessage({ ok: true }); }
  else if (m.type === 'forget') { reg.delete(m.id); p && p.postMessage({ ok: true }); }
  else if (m.type === 'token') { for (const r of reg.values()) r.token = m.token; p && p.postMessage({ ok: true }); } });
self.addEventListener('fetch', e => { const u = new URL(e.request.url), mm = /__cinema_drive\/([\w-]+)$/.exec(u.pathname); if (!mm) return;
  e.respondWith((async () => { const r = reg.get(mm[1]); if (!r) return new Response('unregistered', { status: 404 });
    const h = { Authorization: 'Bearer ' + r.token }; const rg = e.request.headers.get('range'); if (rg) h.Range = rg;
    const up = await fetch(r.base + '/drive/v3/files/' + mm[1] + '?alt=media&supportsAllDrives=true', { headers: h });
    const hh = new Headers(up.headers); hh.set('Content-Type', r.mime); hh.set('Accept-Ranges', 'bytes'); return new Response(up.body, { status: up.status, headers: hh }); })()); });
"""
PAGE = """<!doctype html><meta charset=utf-8><title>hevc test</title><body style="background:#222;margin:0">
<script>
const Q = new URLSearchParams(location.search);
window.CINEMA_CONFIG = { googleClientId: "1234567890-test.apps.googleusercontent.com", driveApiBase: location.origin, coopTransport: "p2p" };
if (Q.get("maxbytes")) window.CINEMA_CONFIG.hevcMaxBytes = +Q.get("maxbytes");
window.google = { accounts: { oauth2: { initTokenClient: (c) => ({ requestAccessToken: () => setTimeout(() => c.callback({ access_token: "tok", expires_in: 3600 }), 10) }) } } };
</script>
<script src="cinema/core.js"></script><script src="cinema/net.js"></script><script src="cinema/providers.js"></script><script src="cinema/gdrive.js"></script><script src="cinema/session.js"></script><script src="cinema/ui.js"></script>
<script>
const self_ = { id: CinemaCore.randomId(), name: Q.get("name") || "Tester", gender: "male" };
const link = new CoopLink.Link(self_); let session, ui;
ui = new CinemaUI.UI({ getSession: () => session, getLink: () => link, where: () => "", onClosed() {} });
session = new CinemaSession.Session({ self: self_, container: ui.video, notify: (t) => { (window.__notes = window.__notes || []).push(t); } });
session.setLink(link); session.onChange(() => { if (ui.cinOpen) ui.refresh(); });
window.T = { self: self_, link, ui, session, C: CinemaCore };
setInterval(() => ui.placeScreen(null, session.joined), 200);
ui.open();
</script>"""


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(s, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def log_message(s, *a): pass
    def end_headers(s):
        s.send_header("Cache-Control", "no-store"); s.send_header("Access-Control-Allow-Origin", "*")
        s.send_header("Access-Control-Allow-Headers", "authorization, range, content-type"); s.send_header("Access-Control-Expose-Headers", "content-range, content-length, accept-ranges"); super().end_headers()
    def do_OPTIONS(s): s.send_response(204); s.end_headers()
    def _json(s, code, obj):
        d = json.dumps(obj).encode(); s.send_response(code); s.send_header("Content-Type", "application/json"); s.send_header("Content-Length", str(len(d))); s.end_headers(); s.wfile.write(d)
    def _drive(s, fid, q):
        if fid not in BY_ID: return s._json(404, {"error": {"code": 404, "errors": [{"reason": "notFound"}]}})
        if (s.headers.get("Authorization") or "") != "Bearer tok": return s._json(401, {"error": {"code": 401}})
        fn, mime = BY_ID[fid]; path = os.path.join(TMP, "clips", fn); size = os.path.getsize(path)
        if "alt=media" not in q: return s._json(200, {"id": fid, "name": fn, "mimeType": mime, "size": str(size), "trashed": False, "capabilities": {"canDownload": True}})
        rg, a, b, code = s.headers.get("Range"), 0, size - 1, 200
        if rg:
            m = re.match(r"bytes=(\d*)-(\d*)", rg)
            if m:
                if m.group(1) == "" and m.group(2): a = max(0, size - int(m.group(2)))
                else:
                    a = int(m.group(1) or 0)
                    if m.group(2): b = min(size - 1, int(m.group(2)))
                code = 206
        n = b - a + 1; s.send_response(code); s.send_header("Content-Type", mime); s.send_header("Accept-Ranges", "bytes"); s.send_header("Content-Length", str(n))
        if code == 206: s.send_header("Content-Range", f"bytes {a}-{b}/{size}")
        s.end_headers()
        try:
            with open(path, "rb") as f:
                f.seek(a); left = n
                while left > 0:
                    c = f.read(min(65536, left))
                    if not c: break
                    s.wfile.write(c); left -= len(c)
        except (BrokenPipeError, ConnectionResetError): pass
    def do_GET(s):
        p, _, q = s.path.partition("?"); m = re.match(r"^/drive/v3/files/([\w-]+)$", p)
        if m: return s._drive(m.group(1), q)
        if p == "/cinema-sw.js": d = SW.encode(); t = "application/javascript"
        elif p == "/__t.html": d = PAGE.encode(); t = "text/html"
        elif p.startswith("/__clips/"): fp = os.path.join(TMP, "clips", os.path.basename(p)); d = open(fp, "rb").read() if os.path.exists(fp) else None; t = "application/octet-stream"
        else: return super().do_GET()
        if d is None: s.send_response(404); s.end_headers(); return
        s.send_response(200); s.send_header("Content-Type", t); s.send_header("Content-Length", str(len(d))); s.end_headers(); s.wfile.write(d)


class T(socketserver.ThreadingMixIn, http.server.HTTPServer): daemon_threads = True; allow_reuse_address = True


srv = T(("127.0.0.1", 0), H); PORT = srv.server_address[1]; BASE = f"http://127.0.0.1:{PORT}"
threading.Thread(target=srv.serve_forever, daemon=True).start()

from playwright.sync_api import sync_playwright

SNAP = """() => { const v = document.querySelector('#cin-screen video'), q = v.getVideoPlaybackQuality(), a = T.session.adapter, i = T.session.info();
  return { paused: v.paused, t: +v.currentTime.toFixed(2), rs: v.readyState, vw: v.videoWidth, vh: v.videoHeight, dur: v.duration, frames: q.totalVideoFrames, ab: v.webkitAudioDecodedByteCount,
    err: v.error && v.error.code, ls: T.session.localState, label: i.label, status: i.status || '', ierr: i.error || '', conv: a && a.converting ? a.converting.text : '', converted: a && a.converted || null,
    tried: !!(a && a.hevcTried), blob: /^blob:/.test(v.currentSrc || ''), vol: v.volume, muted: v.muted, rate: v.playbackRate }; }"""
# mean luminance + spread of the picture the <video> is actually drawing (a black screen gives ~0 / 0)
PIC = """() => { const v = document.querySelector('#cin-screen video'), c = document.createElement('canvas'); c.width = 160; c.height = 90; const x = c.getContext('2d'); x.drawImage(v, 0, 0, 160, 90);
  const d = x.getImageData(0, 0, 160, 90).data; let s = 0, s2 = 0, n = 0; for (let i = 0; i < d.length; i += 4) { const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; s += l; s2 += l * l; n++; }
  const m = s / n; return { mean: +m.toFixed(1), sd: +Math.sqrt(Math.max(0, s2 / n - m * m)).toFixed(1) }; }"""


def snap(pg): return pg.evaluate(SNAP)


# pretend to be a computer whose GPU decodes HEVC but which cannot play AC-3 sound
MOCK_HEVC = """(() => { const cp = HTMLMediaElement.prototype.canPlayType; HTMLMediaElement.prototype.canPlayType = function (t) { if (/ac-3|ec-3/.test(t)) return ''; if (/hvc1|hev1/.test(t)) return 'probably'; return cp.call(this, t); };
  if (navigator.mediaCapabilities) navigator.mediaCapabilities.decodingInfo = async () => ({ supported: true, smooth: true, powerEfficient: true }); })();"""


def open_page(b, name="Tester", extra="", init=None):
    pg = b.new_page(viewport={"width": 1100, "height": 760}); pg.logs = []
    if init: pg.add_init_script(init)
    pg.on("console", lambda m: pg.logs.append(m.text[:200])); pg.on("pageerror", lambda e: pg.logs.append("PAGEERR " + str(e)[:200]))
    pg.goto(f"{BASE}/__t.html?name={name}{extra}"); pg.wait_for_function("window.T"); return pg


def load(pg, fid):
    return pg.evaluate("async (id) => { const r = await T.session.loadVideo('https://drive.google.com/file/d/' + id + '/view'); return r.ok ? 'ok' : r.error; }", fid)


def wait_ready(pg, timeout=150):
    """until the video has a picture size and enough data (conversion included); returns (seconds, snapshot)"""
    t0 = time.time(); s = snap(pg)
    while time.time() - t0 < timeout:
        s = snap(pg)
        if s["vw"] > 0 and s["rs"] >= 3 and not s["conv"]: return time.time() - t0, s
        if s["ierr"]: return time.time() - t0, s
        pg.wait_for_timeout(300)
    return time.time() - t0, s


def full_check(b, label, fid, expect_audio=True, sub=True):
    print(f"\n== {label}")
    pg = open_page(b)
    ok(load(pg, fid) == "ok", "loads the Drive link")
    secs, s = wait_ready(pg)
    ok(not s["ierr"], "no error shown to the player", s["ierr"])
    ok(s["vw"] > 0 and s["vh"] > 0, "the video has a picture size (not the black-screen case videoWidth=0)", f'{s["vw"]}x{s["vh"]}')
    path = "converted to H.264/AAC in the browser" if s["converted"] else "played natively (no conversion)"
    print(f"        path: {path}  (ready after {secs:.1f}s)"); notes.append((label, path, round(secs, 1)))
    ok(abs((s["dur"] or 0) - 12) < 0.6, "duration is right", s["dur"])
    r = pg.evaluate("JSON.stringify(T.session.play())"); ok(json.loads(r).get("ok") is True, "Play button works", r)
    pg.wait_for_timeout(500); s0 = snap(pg); pg.wait_for_timeout(3000); s1 = snap(pg)
    ok(s1["t"] - s0["t"] > 2.4, "time advances in real time", f'{s0["t"]} -> {s1["t"]}')
    ok(s1["frames"] - s0["frames"] >= 55, "video frames are being decoded (smooth, ~25 fps)", s1["frames"] - s0["frames"])
    if expect_audio and s1["ab"] is not None: ok(s1["ab"] > s0["ab"] > 0, "audio is being decoded", f'{s0["ab"]} -> {s1["ab"]}')
    pic = pg.evaluate(PIC); ok(pic["mean"] > 25 and pic["sd"] > 15, "the picture on screen is not black", pic)
    pg.screenshot(path=os.path.join(TMP, label.replace(" ", "_") + ".png"))
    # controls
    pg.evaluate("T.session.pause()"); pg.wait_for_timeout(400); a = snap(pg); pg.wait_for_timeout(700); c = snap(pg)
    ok(a["paused"] and abs(c["t"] - a["t"]) < 0.05, "Pause works", f'{a["t"]} / {c["t"]}')
    pg.evaluate("T.session.seek(8)"); pg.wait_for_timeout(700); s = snap(pg); ok(abs(s["t"] - 8) < 0.7, "Seek works", s["t"])
    pg.evaluate("T.session.play()"); pg.wait_for_timeout(1500); s = snap(pg); ok(s["t"] > 8.8 and not s["paused"], "Play continues after a seek", s["t"])
    pg.evaluate("T.session.setRate(1.5)"); pg.wait_for_timeout(300); ok(snap(pg)["rate"] == 1.5, "Speed control works")
    pg.evaluate("T.session.setRate(1)")
    pg.evaluate("T.session.setVolume(30)"); ok(abs(snap(pg)["vol"] - 0.3) < 0.01, "Volume works")
    pg.evaluate("T.session.toggleMute()"); ok(snap(pg)["muted"], "Mute works"); pg.evaluate("T.session.toggleMute()")
    if sub:  # subtitles through the real UI button / file picker
        pg.evaluate("T.session.seek(0.2)"); pg.wait_for_timeout(500)
        ok(pg.is_visible("#cin-sub"), "the CC Subtitles button is offered")
        pg.set_input_files("#cin-sub-file", os.path.join(TMP, "clips", "sub.srt")); pg.wait_for_timeout(500)
        ok(pg.evaluate("document.querySelectorAll('#cin-screen video track').length") == 1, "subtitle file (.srt) accepted")
        pg.evaluate("T.session.seek(2)"); pg.evaluate("T.session.play()"); pg.wait_for_timeout(900)
        cue = pg.evaluate("(() => { const t = document.querySelector('#cin-screen video').textTracks[0]; return t && t.activeCues && t.activeCues.length ? t.activeCues[0].text : null; })()")
        ok(cue == "Hello from the subtitle", "the subtitle shows at the right time", cue)
        pg.evaluate("T.session.seek(11.2)"); pg.evaluate("T.session.play()")
        t0 = time.time()
        while time.time() - t0 < 6 and snap(pg)["ls"] != "ended": pg.wait_for_timeout(250)
        ok(snap(pg)["ls"] == "ended", "playback reaches the end and reports 'ended'", snap(pg)["ls"])
    bad = [l for l in pg.logs if l.startswith("PAGEERR")]
    ok(not bad, "no JavaScript errors on the page", bad[:2]); pg.close()


def main():
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
        if os.environ.get("ONLY") == "two": two_players(b); return          # debugging aid: just the two-player section
        pg = open_page(b)
        native = pg.evaluate("!!document.createElement('video').canPlayType('video/mp4; codecs=\"hvc1.1.6.L93.B0\"')")
        print(f"browser HEVC decoding: {'YES (native path will be tested)' if native else 'NO (conversion path will be tested)'}")
        # ---- the file parser reads the real codecs out of every container
        HAVE = os.path.exists(os.path.join(ROOT, "cinema", "hevc.js"))
        print("\n== reading the codecs out of the files" + ("" if HAVE else "  (skipped: this copy has no cinema/hevc.js)"))
        if HAVE: pg.evaluate("new Promise((res) => { const s = document.createElement('script'); s.src = 'cinema/hevc.js'; s.onload = res; document.head.appendChild(s); })")
        exp = {"hevc_aac.mp4": ("mp4", True, "aac"), "hevc_aac_moovend.mp4": ("mp4", True, "aac"), "hevc_aac.mkv": ("mkv", True, "aac"), "hevc_ac3.mkv": ("mkv", True, "ac3"), "hevc10_aac.mkv": ("mkv", True, "aac"), "h264_aac.mp4": ("mp4", False, "aac")}
        if not HAVE: exp = {}
        for fn, (cont, hevc, au) in exp.items():
            fid = CLIPS[fn][0]; size = os.path.getsize(os.path.join(TMP, "clips", fn))
            r = pg.evaluate("""async ([id, size]) => { const rd = async (a, e) => { const r = await fetch('/drive/v3/files/' + id + '?alt=media', { headers: { Authorization: 'Bearer tok', Range: 'bytes=' + a + '-' + e } }); return new Uint8Array(await r.arrayBuffer()); };
              const i = await CinemaHevc.sniff(rd, size); return i && { c: i.container, h: i.hevc, a: i.audio && i.audio.audio, v: i.video && i.video.codec }; }""", [fid, size])
            ok(r is not None and r["c"] == cont and r["h"] == hevc and r["a"] == au, f"{fn}: {cont.upper()} {'HEVC' if hevc else 'H.264'} + {au.upper()} recognised", r)
        junk = "null" if not HAVE else pg.evaluate("""async () => { try { return (await CinemaHevc.sniff(async (a, e) => new Uint8Array(Math.min(e - a + 1, 4096)).fill(7), 100000)) === null ? 'null' : 'object'; } catch (e) { return 'threw ' + e.message; } }""")
        ok(junk == "null", "a file that is not MP4/MKV is reported as unknown (no exception)", junk)
        pg.close()

        full_check(b, "HEVC MP4 AAC", CLIPS["hevc_aac.mp4"][0])
        full_check(b, "H264 MP4 control", CLIPS["h264_aac.mp4"][0])
        # ---- regression: H.264 untouched, AVI behaves exactly as before
        print("\n== regression: H.264 and AVI")
        pg = open_page(b); load(pg, CLIPS["h264_aac.mp4"][0]); secs, s = wait_ready(pg, 30)
        ok(not s["tried"] and not s["converted"] and not s["blob"], "H.264 is never converted (streamed straight from Drive)", s["converted"])
        pg.close()
        pg = open_page(b); load(pg, CLIPS["mpeg4_mp3.avi"][0]); pg.wait_for_timeout(3500); s = snap(pg)
        ok(s["ierr"].startswith("Your browser can't play this file's format. Drive serves the original file"), "AVI still gives its original message (not touched)", s["ierr"][:60])
        ok(not s["converted"] and not s["conv"], "AVI is not sent to the HEVC converter"); pg.close()
        if QUICK: return
        full_check(b, "HEVC MP4 moov at end", CLIPS["hevc_aac_moovend.mp4"][0], sub=False)
        full_check(b, "HEVC MKV AAC", CLIPS["hevc_aac.mkv"][0], sub=False)
        full_check(b, "HEVC MKV AC3 audio", CLIPS["hevc_ac3.mkv"][0], sub=False)
        full_check(b, "HEVC 10-bit MKV", CLIPS["hevc10_aac.mkv"][0], sub=False)
        conversion_output(b)
        decision_and_ladder(b)
        # ---- too big: a clear message, no crash
        print("\n== file over the size limit")
        pg = open_page(b, extra="&maxbytes=100000"); load(pg, CLIPS["hevc_aac.mp4"][0]); pg.wait_for_timeout(5000); s = snap(pg)
        if not native: ok("works up to about" in s["ierr"] and "MB" in s["ierr"], "explains the size limit instead of crashing", s["ierr"][:90])
        pg.close()
        # ---- switching videos mid-conversion: the old conversion is cancelled and never replaces the new video
        print("\n== load another video while converting")
        pg = open_page(b); load(pg, CLIPS["hevc_aac.mp4"][0]); pg.wait_for_timeout(600); load(pg, CLIPS["h264_aac.mp4"][0]); secs, s = wait_ready(pg, 40); pg.wait_for_timeout(4000); s = snap(pg)
        ok(s["vw"] > 0 and not s["blob"] and not s["converted"] and not s["ierr"], "the new (H.264) video is showing, the stale conversion did not replace it", s["ierr"]); pg.close()
        # ---- two players: one converts later than the other and still lands on the shared position
        print("\n== two players, shared controls")
        two_players(b)
        b.close()


def conversion_output(b):
    """what ffmpeg really produces: remux keeps the HEVC video bit-for-bit and fixes the sound; transcode gives 8-bit H.264 + AAC; the download is reused"""
    print("\n== what the converter produces (checked with ffprobe)")
    import base64
    pg = open_page(b); pg.evaluate("new Promise((res) => { const s = document.createElement('script'); s.src = 'cinema/hevc.js'; s.onload = res; document.head.appendChild(s); })")
    fid = CLIPS["hevc_ac3.mkv"][0]; size = os.path.getsize(os.path.join(TMP, "clips", "hevc_ac3.mkv"))
    r = pg.evaluate("""async ([id, size]) => { const reads = []; const rd = async (a, e) => { reads.push(a); const r = await fetch('/drive/v3/files/' + id + '?alt=media', { headers: { Authorization: 'Bearer tok', Range: 'bytes=' + a + '-' + e } }); return new Uint8Array(await r.arrayBuffer()); };
      const info = await CinemaHevc.sniff(rd, size); reads.length = 0; const cache = {}, b64 = async (blob) => { const u = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return btoa(s); };
      const status = []; const m1 = await CinemaHevc.convert({ mode: 'remux', info, size, read: rd, cache, onStatus: (t) => status.push(t) }); const n1 = reads.length;
      const m2 = await CinemaHevc.convert({ mode: 'transcode', info, size, read: rd, cache }); return { n1, n2: reads.length - n1, remux: await b64(m1), transcode: await b64(m2), status: status.slice(0, 2) }; }""", [fid, size])
    ok(r["n1"] > 0 and r["n2"] == 0, "the second conversion of the same file does not download it again", f'{r["n1"]} then {r["n2"]} reads')
    ok(any("Preparing this video" in t for t in r["status"]), "progress text is shown while converting", r["status"][:1])
    for name, mode in (("remux", "remux"), ("transcode", "transcode")):
        fp = os.path.join(TMP, f"out_{name}.mp4"); open(fp, "wb").write(base64.b64decode(r[name]))
        pr = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_name,codec_tag_string,pix_fmt,width,height:format=duration", "-of", "json", fp], capture_output=True, text=True).stdout)
        v = [x for x in pr["streams"] if x.get("pix_fmt")][0]; a = [x for x in pr["streams"] if not x.get("pix_fmt")]
        dur = float(pr["format"]["duration"])
        if mode == "remux": ok(v["codec_name"] == "hevc" and v["codec_tag_string"] == "hvc1" and v["width"] == 640, "remux keeps the HEVC video untouched (hvc1 tag, same size)", f'{v["codec_name"]}/{v["codec_tag_string"]}')
        else: ok(v["codec_name"] == "h264" and v["pix_fmt"] == "yuv420p" and v["width"] == 640, "transcode gives 8-bit H.264 at the original size", f'{v["codec_name"]}/{v["pix_fmt"]}/{v["width"]}')
        ok(len(a) == 1 and a[0]["codec_name"] == "aac" and abs(dur - 12) < 0.5, f"{name}: AC-3 sound became AAC and the duration is kept", f'{a[0]["codec_name"] if a else None} {dur:.2f}s')
    pg.close()


def decision_and_ladder(b):
    print("\n== which fix is chosen, and the step-by-step escalation")
    PLAN = """async (aud) => { const i = { hevc: true, video: { codec: 'hvc1.1.6.L93.B0', w: 1920, h: 1080 }, audio: { audio: aud } }; return (await CinemaHevc.plan(i)).action; }"""
    pg = open_page(b, init=MOCK_HEVC); pg.evaluate("new Promise((res) => { const s = document.createElement('script'); s.src = 'cinema/hevc.js'; s.onload = res; document.head.appendChild(s); })")
    ok(pg.evaluate(PLAN, "aac") == "native", "HEVC decodable + AAC -> play the file as it is (no conversion)")
    ok(pg.evaluate(PLAN, "ac3") == "remux", "HEVC decodable + AC-3 sound the browser can't play -> repackage only")
    ok(pg.evaluate(PLAN, "dts") == "remux", "HEVC decodable + DTS -> repackage only"); pg.close()
    pg = open_page(b)
    pg.evaluate("new Promise((res) => { const s = document.createElement('script'); s.src = 'cinema/hevc.js'; s.onload = res; document.head.appendChild(s); })")
    ok(pg.evaluate(PLAN, "aac") == ("native" if pg.evaluate("!!document.createElement('video').canPlayType('video/mp4; codecs=\"hvc1.1.6.L93.B0\"')") else "transcode"), "no HEVC decoder -> re-encode (or native if this browser has one)"); pg.close()
    # a browser that CLAIMS to decode HEVC (mock) but really can't (this Chromium): the repackaged copy still has no picture, so it must escalate to H.264
    pg = open_page(b, init=MOCK_HEVC); load(pg, CLIPS["hevc_ac3.mkv"][0]); seen = []; t0 = time.time(); s = snap(pg)
    while time.time() - t0 < 120:
        s = snap(pg); m = pg.evaluate("T.session.adapter && T.session.adapter.converting ? T.session.adapter.converting.mode : null")
        if m and (not seen or seen[-1] != m): seen.append(m)
        if s["vw"] > 0 and s["rs"] >= 3 and not s["conv"] and s["converted"] == "transcode": break
        if s["ierr"]: break
        pg.wait_for_timeout(250)
    ok(seen == ["remux", "transcode"], "tries the cheap repackage first, then escalates to the re-encode only because it still had no picture", seen)
    ok(s["vw"] > 0 and not s["ierr"], "and the video ends up showing", s["ierr"])
    pg.evaluate("T.session.play()"); pg.wait_for_timeout(2500); s2 = snap(pg); pic = pg.evaluate(PIC)
    ok(s2["t"] > 1.5 and not s2["paused"] and pic["mean"] > 25, "playing with a picture after the escalation", f'{s2["t"]} {pic}'); pg.close()


DBG = """() => ({ link: T.link.open, peer: !!T.link.peer, st: T.session.state && { by: T.session.state.by.slice(0, 4), rev: T.session.state.rev, pb: T.session.state.playback, pos: Math.round(T.session.state.position), cmd: T.session.state.cmd }, joined: T.session.joined, peerJoined: T.session.peerJoined, local: T.session.localState, hidden: document.hidden, notes: (window.__notes || []).slice(-3) })"""


def two_players(b):
    # The direct browser-to-browser link of the game (cinema/net.js) occasionally comes up one-way in this sandbox: one side never learns
    # who its partner is, so it ignores everything. That is not video code, so a pair like that is thrown away and a new pair is made.
    for attempt in range(1, 5):
        A = open_page(b, "Ann"); B = open_page(b, "Ben")
        code = A.evaluate("T.link.createInvite()"); rep = B.evaluate("(c) => T.link.acceptInvite(c)", code); A.evaluate("(c) => T.link.acceptAnswer(c)", rep)
        t0 = time.time()
        while time.time() - t0 < 25 and not (A.evaluate("T.link.open && !!T.link.peer") and B.evaluate("T.link.open && !!T.link.peer")): A.wait_for_timeout(300)
        if A.evaluate("T.link.open && !!T.link.peer") and B.evaluate("T.link.open && !!T.link.peer"): break
        print(f"        (test link attempt {attempt}: one side never learned its partner: new pair)"); A.close(); B.close()
    else:
        ok(False, "the two test pages could not be linked over WebRTC here (sandbox network)"); return
    ok(True, f"two pages linked (WebRTC data channel, attempt {attempt})")
    fid = CLIPS["hevc_aac.mp4"][0]; load(A, fid); B.wait_for_function("T.session.active", timeout=10000); B.evaluate("T.session.join()")
    wait_ready(A); wait_ready(B)
    A.evaluate("T.session.play()"); A.wait_for_timeout(4000)
    a, bb = snap(A), snap(B)
    ok(not a["paused"] and not bb["paused"], "Ann pressed play: both are playing", f'{a["paused"]}/{bb["paused"]}')
    ok(abs(a["t"] - bb["t"]) < 1.5, "both are within 1.5 s of each other", f'{a["t"]} vs {bb["t"]}')
    B.evaluate("T.session.seek(3)"); B.evaluate("T.session.pause()"); A.wait_for_timeout(1500)
    a, bb = snap(A), snap(B)
    ok(a["paused"] and abs(a["t"] - 3) < 1.0, "Ben seeked + paused: Ann follows", f'{a["t"]} paused={a["paused"]}')
    if not a["paused"]: print("        debug:", json.dumps({"A": A.evaluate(DBG), "B": B.evaluate(DBG)}))
    # (seek to 1 s, not later: the clips are 12 s long, and Ann must not reach the end while Ben converts)
    # a late joiner: Ben leaves, Ann plays on, Ben rejoins and has to convert again, then lands on Ann's position
    B.evaluate("T.session.leave()"); A.evaluate("T.session.seek(1)"); A.evaluate("T.session.play()"); A.wait_for_timeout(1500)
    B.evaluate("T.session.join()"); secs, bs = wait_ready(B); B.wait_for_timeout(2500); a, bb = snap(A), snap(B)
    ok(not bb["paused"] and abs(a["t"] - bb["t"]) < 2.0, "a partner who finishes converting later joins at the shared position", f'{a["t"]} vs {bb["t"]}')
    bad = [l for p in (A, B) for l in p.logs if l.startswith("PAGEERR")]; ok(not bad, "no JavaScript errors on either page", bad[:2])
    A.close(); B.close()


try:
    main()
finally:
    srv.shutdown()
print("\n--- summary ---")
for n in notes: print("  ", n)
print("pictures:", TMP, "(kept)")
print("ALL PASSED" if not fails else f"{len(fails)} FAILED: " + "; ".join(fails))
sys.exit(1 if fails else 0)
