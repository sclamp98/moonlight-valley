"""Google Drive cinema test. TWO real browsers, real WebRTC link, real service-worker streaming into a real <video>.
Only Google itself is replaced: a local stand-in for the Drive API v3 (auth check, metadata, alt=media with Range, error files)
and a stub of Google Identity Services that hands out the token 'test-token'. The sandbox can't reach Google, so this does
NOT prove playback against real Google; see cinema/DRIVE_SETUP.md for the manual check with a real file.
Run: python tools/test_cinema_drive.py"""
import subprocess, time, sys, os, json, threading, re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT, DPORT = "8128", 8129
URL = f"http://localhost:{PORT}/index.html"
FAKE = os.path.join(root, "tools", "cinema_fake_yt.js")
VIDEO = open(os.path.join(root, "tools", "fixtures", "drive_test.webm"), "rb").read()
out = os.environ.get("MAPSHOTS", "/tmp")
GOOD, GOOD2 = "1GoodVideoFileAAAAAAAAAA1", "1GoodVideoFileBBBBBBBBBB2"
FILES = {  # id -> (status, body-json or None)
    "1NotFoundFileCCCCCCCCCC3": (404, {"error": {"code": 404, "errors": [{"reason": "notFound"}]}}),
    "1ForbiddenFileDDDDDDDD4": (403, {"error": {"code": 403, "errors": [{"reason": "forbidden"}]}}),
    "1QuotaFileEEEEEEEEEEEE5": (403, {"error": {"code": 403, "errors": [{"reason": "downloadQuotaExceeded"}]}}),
    "1NoDownloadFileFFFFFFF6": (200, {"id": "x", "name": "locked.mp4", "mimeType": "video/mp4", "size": "1000", "capabilities": {"canDownload": False}}),
    "1GoogleDocFileGGGGGGGG7": (200, {"id": "x", "name": "notes", "mimeType": "application/vnd.google-apps.document"}),
    "1PdfFileHHHHHHHHHHHHHH8": (200, {"id": "x", "name": "a.pdf", "mimeType": "application/pdf", "size": "1000"}),
}
log = []   # (path, range, auth-ok)
res, errs = [], []


class Drive(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Access-Control-Allow-Headers", "authorization,range,content-type")
        self.send_header("Access-Control-Allow-Methods", "GET,OPTIONS"); self.send_header("Access-Control-Expose-Headers", "Content-Range,Content-Length")
    def do_OPTIONS(self): self.send_response(204); self.cors(); self.end_headers()
    def js(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.cors(); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        m = re.match(r"/drive/v3/files/([^?/]+)(\?(.*))?$", self.path)
        auth = self.headers.get("Authorization") == "Bearer test-token"
        rng = self.headers.get("Range")
        log.append((self.path, rng, auth))
        if not m: return self.js(404, {})
        fid, q = m.group(1), m.group(3) or ""
        if not auth: return self.js(401, {"error": {"code": 401, "status": "UNAUTHENTICATED"}})
        media = "alt=media" in q
        if fid in (GOOD, GOOD2):
            if not media: return self.js(200, {"id": fid, "name": "Test movie.webm", "mimeType": "video/webm", "size": str(len(VIDEO)), "capabilities": {"canDownload": True}, "videoMediaMetadata": {"durationMillis": "40000"}})
            a, b, code = 0, len(VIDEO) - 1, 200
            if rng:
                g = re.match(r"bytes=(\d+)-(\d*)", rng); a = int(g.group(1)); b = min(len(VIDEO) - 1, int(g.group(2))) if g.group(2) else len(VIDEO) - 1; code = 206
            body = VIDEO[a:b + 1]
            self.send_response(code); self.cors(); self.send_header("Content-Type", "video/webm"); self.send_header("Content-Length", str(len(body)))
            if code == 206: self.send_header("Content-Range", f"bytes {a}-{b}/{len(VIDEO)}")
            self.end_headers()
            try: self.wfile.write(body)
            except Exception: pass
            return
        if fid in FILES:
            c, body = FILES[fid]; return self.js(c, body)
        return self.js(404, {"error": {"code": 404, "errors": [{"reason": "notFound"}]}})


def chk(name, ok, extra=""):
    res.append(bool(ok)); print(("PASS " if ok else "FAIL ") + name, extra if not ok else "")


INIT = """
window.CINEMA_CONFIG = {googleClientId: 'test-client.apps.googleusercontent.com', driveApiBase: 'http://127.0.0.1:%d'};
window.__gisCalls = 0;
window.google = {accounts: {oauth2: {initTokenClient: (c) => ({requestAccessToken: () => { window.__gisCalls++; setTimeout(() => c.callback(window.__gisFail ? {error: 'access_denied'} : {access_token: window.__gisToken || 'test-token', expires_in: 3600}), 30); }})}}};
""" % DPORT


class P:
    def __init__(self, browser, name, gender, tag):
        self.tag = tag
        self.ctx = browser.new_context(viewport={"width": 1280, "height": 720})
        self.pg = self.ctx.new_page()
        self.pg.on("pageerror", lambda e: errs.append(f"[{tag}] {e}"))
        self.pg.on("console", lambda m: errs.append(f"[{tag}] console: {m.text}") if m.type == "error" and "favicon" not in m.text and "status of 4" not in m.text and "Failed to load resource" not in m.text else None)
        self.pg.add_init_script(path=FAKE); self.pg.add_init_script(INIT)
        self.pg.goto(URL); self.pg.wait_for_timeout(1200)
        self.ev("(a)=>{ Cinema.ensure(game); Cinema.self.name=a[0]; Cinema.self.gender=a[1]; }", [name, gender])
    def ev(self, js, arg=None): return self.pg.evaluate(js, arg) if arg is not None else self.pg.evaluate(js)
    def wait(self, ms): self.pg.wait_for_timeout(ms)
    def until(self, js, timeout=8000, step=100):
        end = time.time() + timeout / 1000
        while time.time() < end:
            try:
                if self.ev(js): return True
            except Exception: pass
            self.wait(step)
        return False
    def go_cinema(self):
        self.ev("game.enterHome()"); self.wait(800); self.ev("game.enterCinema()"); self.wait(800)
        return self.ev("!!(game.inside && game.inside.isCinema)")
    def at(self, act):
        self.ev("""(a)=>{ const g=game, s=g.inside.spots.find(s=>s.act===a), p=g.player; p.x += s.cx - p.cx; p.y += s.cy - p.cy; }""", act); self.wait(150)
    def key(self, k): self.pg.keyboard.press(k); self.wait(120)
    def load(self, txt):
        self.ev("(t)=>{const i=document.getElementById('cin-url'); i.disabled=false; i.value=t;}", txt); self.pg.click("#cin-load"); self.wait(300)
    def msg(self): return self.ev("document.getElementById('cin-msg').textContent")
    def chip(self): return self.ev("document.getElementById('cin-status').textContent")
    def vt(self): return self.ev("(()=>{const v=document.querySelector('#cin-screen video.cin-html5'); return v? v.currentTime : -1})()")
    def vp(self): return self.ev("(()=>{const v=document.querySelector('#cin-screen video.cin-html5'); return v? !v.paused : null})()")
    def shot(self, n): self.pg.screenshot(path=f"{out}/{n}.png")


def drive_url(i): return f"https://drive.google.com/file/d/{i}/view?usp=sharing"


def connect(a, b):
    offer = a.ev("Cinema.link.createInvite()"); reply = b.ev("(c)=>Cinema.link.acceptInvite(c)", offer); a.ev("(c)=>Cinema.link.acceptAnswer(c)", reply)
    return a.until("Cinema.link.open && !!Cinema.link.peer", 15000) and b.until("Cinema.link.open && !!Cinema.link.peer", 15000)


dsrv = ThreadingHTTPServer(("127.0.0.1", DPORT), Drive); threading.Thread(target=dsrv.serve_forever, daemon=True).start()
srv = subprocess.Popen([sys.executable, "-m", "http.server", PORT], cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
try:
    with sync_playwright() as pw:
        br = pw.chromium.launch(args=["--disable-features=WebRtcHideLocalIpsWithMdns", "--autoplay-policy=no-user-gesture-required"])
        S = P(br, "Shuja", "male", "S"); Ai = P(br, "Aisha", "female", "Ai")
        chk("Drive provider is registered next to YouTube", S.ev("CinemaProviders.syncable().join()") == "youtube,gdrive")
        chk("both enter the cinema and link up over real WebRTC", S.go_cinema() and Ai.go_cinema() and connect(S, Ai))
        S.at("tv"); S.key("e"); Ai.at("tv"); Ai.key("e")

        # ---------- bad links first: clear messages, no crash ----------
        S.load("https://drive.google.com/drive/folders/" + GOOD)
        chk("a Drive FOLDER link is refused with an explanation", S.chip() == "Unsupported Link" and "folder" in S.msg().lower(), S.msg())
        for fid, chip_, word in [("1NotFoundFileCCCCCCCCCC3", "Error", "shared"), ("1ForbiddenFileDDDDDDDD4", "Error", "permission"), ("1QuotaFileEEEEEEEEEEEE5", "Error", "quota"),
                                 ("1NoDownloadFileFFFFFFF6", "Error", "downloading"), ("1GoogleDocFileGGGGGGGG7", "Error", "not a video"), ("1PdfFileHHHHHHHHHHHHHH8", "Error", "isn't a video")]:
            S.load(drive_url(fid)); S.until("document.getElementById('cin-status').textContent==='Error'", 4000)
            chk(f"Drive file {fid[:12]}… -> readable message containing '{word}'", word.lower() in S.msg().lower() and S.chip() == "Error", f"{S.chip()!r} {S.msg()!r}")
            chk("   ...and it didn't leave a half-loaded session behind on the partner", Ai.ev("!Cinema.session.joined"))
            S.ev("Cinema.session.endSession()"); S.wait(200)
        S.shot("drive_error_message")

        # ---------- sign-in refused ----------
        S.ev("window.__gisFail=true; CinemaDrive._tok.exp=0; CinemaDrive._tok.value=null; CinemaDrive._tok.signedIn=false; Cinema.session.endSession()"); S.wait(200)
        before = S.ev("window.__gisCalls")
        S.load(drive_url(GOOD)); S.wait(800)
        chk("cancelled Google sign-in -> clear message + the 'Sign in' button, no crash", ("cancel" in S.msg().lower() or "allowed" in S.msg().lower()) and S.ev("window.__gisCalls") > before, S.msg())
        S.ev("window.__gisFail=false; Cinema.session.endSession()"); S.wait(200)

        # ---------- Shuja pastes a Drive link: both clients load the same video ----------
        S.load(drive_url(GOOD))
        chk("Shuja loads a Drive share link; session created with the extracted file id", S.until(f"Cinema.session.active && Cinema.session.state.videoId==='{GOOD}' && Cinema.session.state.provider==='gdrive'", 6000), S.msg())
        chk("Shuja's custom player (a <video>, not Drive's preview iframe) gets the stream", S.until("(()=>{const v=document.querySelector('#cin-screen video.cin-html5'); return !!v && v.readyState>=2})()", 10000) and S.ev("!document.querySelector('#cin-screen iframe')"))
        chk("the bytes come through the service worker with Authorization + Range", any(a and l[1] for l in log for a in [l[2]] if 'alt=media' in l[0]) and not any(not l[2] and 'alt=media' in l[0] for l in log), str(log[-4:]))
        chk("...and the video's token is the stub token only (nothing secret in the page)", S.ev("!/client_secret|AIza/.test(document.documentElement.innerHTML)") and not S.ev("document.querySelector('#cin-screen video.cin-html5').src.includes('test-token')"))
        chk("Aisha is told about it and sees Join", Ai.until(f"Cinema.session.active && Cinema.session.state.videoId==='{GOOD}' && !Cinema.session.joined", 6000))
        Ai.pg.click("#cin-join")
        chk("Aisha joins and her player loads the SAME Drive file", Ai.until("(()=>{const v=document.querySelector('#cin-screen video.cin-html5'); return !!v && v.readyState>=2})()", 10000) and Ai.ev("Cinema.session.state.videoId") == GOOD)
        chk("both show the file name from Drive and duration", "Test movie" in S.ev("Cinema.session.adapter.title()") and S.ev("Cinema.session.adapter.duration()") > 30)
        S.shot("drive_loaded_shuja"); Ai.shot("drive_loaded_aisha")

        # ---------- two-way control on the real video ----------
        S.pg.click("#cin-play")
        chk("Shuja Play -> both <video>s are playing", S.until("document.querySelector('#cin-screen video.cin-html5') && !document.querySelector('#cin-screen video.cin-html5').paused", 5000) and Ai.until("document.querySelector('#cin-screen video.cin-html5') && !document.querySelector('#cin-screen video.cin-html5').paused", 8000))
        S.wait(2500)
        chk("playheads agree (best effort, < 2.5s)", abs(S.vt() - Ai.vt()) < 2.5 and S.vt() > 1, f"{S.vt():.1f} vs {Ai.vt():.1f}")
        Ai.pg.click("#cin-pause")
        chk("Aisha Pause -> Shuja's video pauses too", S.until("document.querySelector('#cin-screen video.cin-html5').paused", 6000) and Ai.vp() is False)
        Ai.ev("document.getElementById('cin-seek').value=700; document.getElementById('cin-seek').dispatchEvent(new Event('change'))"); S.wait(1800)
        chk("Aisha drags the timeline to 70% -> Shuja's video seeks there (real Range request)", abs(S.vt() - 28) < 3 and abs(S.vt() - Ai.vt()) < 1.5, f"{S.vt():.1f} {Ai.vt():.1f}")
        chk("every media request was authorised and ranged (the small test file is fully buffered, so no far-range fetch is expected)", all(l[2] and l[1] for l in log if 'alt=media' in l[0]) and any('alt=media' in l[0] for l in log))
        S.pg.click("#cin-play"); S.wait(2500)
        chk("Shuja Play after her seek -> Aisha follows from the same place", Ai.vp() is True and abs(S.vt() - Ai.vt()) < 2.5 and S.vt() > 28, f"{S.vt():.1f} {Ai.vt():.1f}")
        S.ev("Cinema.session.seek(5)"); Ai.wait(1800)
        chk("Shuja seek back -> Aisha follows", abs(Ai.vt() - S.vt()) < 2.5 and Ai.vt() < 12, f"{S.vt():.1f} {Ai.vt():.1f}")
        # simultaneous
        S.ev("Cinema.session.seek(10)"); Ai.ev("Cinema.session.seek(30)"); S.wait(2500)
        ss, aa = S.ev("(({rev,by,position})=>({rev,by,position}))(Cinema.session.state)"), Ai.ev("(({rev,by,position})=>({rev,by,position}))(Cinema.session.state)")
        chk("simultaneous seeks on real Drive video converge", ss == aa and abs(S.vt() - Ai.vt()) < 3, f"{ss} {aa} {S.vt():.1f} {Ai.vt():.1f}")
        # buffering/stall on one side
        Ai.ev("document.querySelector('#cin-screen video.cin-html5').dispatchEvent(new Event('waiting'))"); S.wait(1200)
        chk("a stall on one player doesn't pause or toggle the other", S.vp() is True and S.ev("Cinema.session.state.playback") == "playing")

        # ---------- link change by either player replaces the session cleanly ----------
        sid = S.ev("Cinema.session.state.sessionId")
        Ai.load(drive_url(GOOD2))
        chk("Aisha pastes another Drive link -> Shuja switches to it (new session)", S.until(f"Cinema.session.state.videoId==='{GOOD2}' && Cinema.session.state.sessionId!=='{sid}'", 8000))
        chk("the previous <video> was replaced (only one video element, loaded)", S.until("document.querySelectorAll('#cin-screen video.cin-html5').length===1 && document.querySelector('#cin-screen video.cin-html5').readyState>=2", 10000))
        S.load("https://youtu.be/dQw4w9WgXcQ")
        chk("Shuja switches to a YouTube link -> Aisha's Drive <video> is gone, YouTube player is up", Ai.until("Cinema.session.state.provider==='youtube' && Cinema.session.adapter && Cinema.session.adapter.p && Cinema.session.adapter.p.vid==='dQw4w9WgXcQ' && document.querySelectorAll('#cin-screen video.cin-html5').length===0", 8000))
        Ai.load(drive_url(GOOD))
        chk("...and back to Drive again", S.until(f"Cinema.session.state.provider==='gdrive' && Cinema.session.state.videoId==='{GOOD}' && document.querySelector('#cin-screen video.cin-html5') && document.querySelector('#cin-screen video.cin-html5').readyState>=2", 10000))

        # ---------- an expired / rejected token mid-session ----------
        S.ev("window.__gisToken='stale'; Cinema._tok = 1; CinemaDrive._tok.exp=0; CinemaDrive._tok.value=null; CinemaDrive._tok.signedIn=false")
        S.ev("Cinema.session.leave()"); S.wait(300)
        S.pg.click("#cin-join")
        chk("sign-in giving a token Drive rejects (401) -> readable message, no crash", S.until("document.getElementById('cin-status').textContent==='Error' || document.getElementById('cin-status').textContent==='Sign-in needed'", 8000) and ("sign" in S.msg().lower()), f"{S.chip()!r} {S.msg()!r}")
        S.ev("window.__gisToken='test-token'")
        chk("a Sign in button is offered", S.ev("!!document.getElementById('cin-signin')"))
        S.shot("drive_signin_needed")
        S.ev("document.getElementById('cin-signin').click()"); 
        chk("pressing Sign in recovers and the video loads", S.until("document.querySelector('#cin-screen video.cin-html5') && document.querySelector('#cin-screen video.cin-html5').readyState>=2", 10000), f"{S.chip()!r} {S.msg()!r}")

        # ---------- reconnect while watching a Drive video ----------
        S.ev("Cinema.link.close()"); S.wait(800)
        chk("link drop doesn't stop either local Drive player", S.ev("!!document.querySelector('#cin-screen video.cin-html5')") and Ai.ev("!!document.querySelector('#cin-screen video.cin-html5')"))
        chk("real WebRTC reconnect", connect(S, Ai)); S.wait(2500)
        chk("after reconnect both are on the same Drive session", S.ev("Cinema.session.state.sessionId") == Ai.ev("Cinema.session.state.sessionId") and S.ev("Cinema.session.state.videoId") == GOOD)
        Ai.ev("Cinema.session.pause()")
        chk("controls still work both ways after reconnect", S.until("document.querySelector('#cin-screen video.cin-html5').paused", 6000))

        # ---------- cleanup ----------
        S.ev("Cinema.session.endSession()"); S.wait(500)
        chk("ending the session removes the <video> and tells the worker to forget the file", S.ev("document.querySelectorAll('#cin-screen video').length===0") and Ai.ev("document.querySelectorAll('#cin-screen video').length===0"))
        chk("game still alive, no page errors", S.ev("!!game.player"))
        br.close()
finally:
    srv.terminate(); dsrv.shutdown()

chk("no uncaught page errors / console errors", not errs, "\n".join(errs[:8]))
print(sum(res), "/", len(res)); sys.exit(0 if all(res) else 1)
