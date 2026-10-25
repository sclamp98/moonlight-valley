"""Co-op cinema integration test: TWO real browser contexts joined by a REAL WebRTC data channel (the same
invite/reply flow players use). Only the YouTube player is replaced by tools/cinema_fake_yt.js, because the CI
sandbox can't reach youtube.com; everything else (link, session, sync, UI, game) is the shipped code.
Run: python tools/test_cinema.py        (MAPSHOTS=<dir> to choose where screenshots go)"""
import subprocess, time, sys, os
from playwright.sync_api import sync_playwright

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = "8131"
URL = f"http://localhost:{PORT}/index.html"
FAKE = os.path.join(root, "tools", "cinema_fake_yt.js")
out = os.environ.get("MAPSHOTS", "/tmp")
V1, V2, V3 = "dQw4w9WgXcQ", "jNQXAC9IVRw", "9bZkp7q19f0"
res, errs = [], []


def chk(name, ok, extra=""):
    res.append(bool(ok)); print(("PASS " if ok else "FAIL ") + name, extra if not ok else "")


class P:
    """One player: a browser context + page running the game."""
    def __init__(self, browser, name, gender, tag, viewport=None):
        self.tag = tag
        self.ctx = browser.new_context(viewport=viewport or {"width": 1280, "height": 720})
        self.pg = self.ctx.new_page()
        self.pg.on("pageerror", lambda e: errs.append(f"[{tag}] {e}"))
        self.pg.on("console", lambda m: errs.append(f"[{tag}] console: {m.text}") if m.type == "error" and "favicon" not in m.text else None)
        self.pg.add_init_script(path=FAKE)
        self.pg.goto(URL); self.pg.wait_for_timeout(1200)
        self.name, self.gender = name, gender
        self.ev("(a)=>{ Cinema.ensure(game); Cinema.self.name=a[0]; Cinema.self.gender=a[1]; }", [name, gender])

    def ev(self, js, arg=None):
        return self.pg.evaluate(js, arg) if arg is not None else self.pg.evaluate(js)

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

    def at(self, act, slot=None):
        self.ev("""(a)=>{ const g=game, s=g.inside.spots.find(s=>s.act===a[0] && (a[1]==null || s.slot===a[1])), p=g.player;
          p.x += s.cx - p.cx; p.y += s.cy - p.cy; }""", [act, slot]); self.wait(150)

    def key(self, k): self.pg.keyboard.press(k); self.wait(120)

    def video(self): return self.ev("(Cinema.session.state||{}).videoId||null")
    def fp(self): return self.ev("(Cinema.session.adapter && Cinema.session.adapter.p) ? {s:Cinema.session.adapter.p.state, t:Cinema.session.adapter.p.getCurrentTime(), v:Cinema.session.adapter.p.vid, log:Cinema.session.adapter.p.log.slice()} : null")
    def info(self): return self.ev("Cinema.session.info()")
    def shot(self, n): self.pg.screenshot(path=f"{out}/{n}.png")
    def close(self): self.ctx.close()


def connect(a, b, timeout=15000):
    offer = a.ev("Cinema.link.createInvite()")
    reply = b.ev("(c)=>Cinema.link.acceptInvite(c)", offer)
    a.ev("(c)=>Cinema.link.acceptAnswer(c)", reply)
    ok = a.until("Cinema.link.open && !!Cinema.link.peer", timeout) and b.until("Cinema.link.open && !!Cinema.link.peer", timeout)
    return ok, offer, reply


srv = subprocess.Popen([sys.executable, "-m", "http.server", PORT], cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
vis = "(s)=>{const e=document.querySelector(s); if(!e) return false; const r=e.getBoundingClientRect(); return getComputedStyle(e).display!=='none' && r.width>0 && r.height>0}"
try:
    with sync_playwright() as pw:
        br = pw.chromium.launch(args=["--disable-features=WebRtcHideLocalIpsWithMdns"])
        A = P(br, "Ana", "female", "A"); B = P(br, "Ben", "male", "B")
        A.go_cinema(); B.go_cinema()
        chk("chat button hidden while not linked", not A.ev(f"({vis})('#chat-fab')"))
        ok, _, _ = connect(A, B)
        chk("link opens", ok)
        chk("chat button shows once linked, with the cinema panel CLOSED", A.until(f"({vis})('#chat-fab')") and not A.ev("Cinema.ui.cinOpen") and B.until(f"({vis})('#chat-fab')"))
        chk("chat button lives inside the fullscreen stage", A.ev("!!document.querySelector('#cin-stage #chat-fab') && !!document.querySelector('#cin-stage #cin-toasts')"))
        # B sends while A's chat is closed
        B.pg.click("#chat-fab"); B.wait(150)
        chk("chat button opens the chat without the cinema panel", not B.ev("document.getElementById('cin-chat').hidden") and not B.ev("Cinema.ui.cinOpen"))
        B.ev("(()=>{const i=document.getElementById('cin-chat-input'); i.value='hello <i>there</i>'; document.getElementById('cin-chat-form').requestSubmit();})()")
        chk("A gets a top toast with sender and text", A.until("document.querySelectorAll('#cin-toasts .cin-toast').length===1") and "Ben" in A.ev("document.querySelector('.cin-toast').textContent") and "hello <i>there</i>" in A.ev("document.querySelector('.cin-toast').textContent"))
        chk("toast text is not parsed as HTML", A.ev("!document.querySelector('.cin-toast i')"))
        chk("toast is at the top-centre, see-through", A.ev("(()=>{const r=document.querySelector('.cin-toast').getBoundingClientRect(); const bg=getComputedStyle(document.querySelector('.cin-toast')).backgroundColor; return r.top<40 && Math.abs(r.left+r.width/2-innerWidth/2)<4 && /rgba/.test(bg) && !/, 1\\)$/.test(bg)})()"))
        chk("badge shows 1 unread", A.ev("document.querySelector('#chat-fab .badge').textContent")=="1" and not A.ev("document.querySelector('#chat-fab .badge').hidden"))
        A.shot("chat_toast")
        A.pg.click(".cin-toast"); A.wait(200)
        chk("clicking the toast opens chat on the side, clears toasts + badge", not A.ev("document.getElementById('cin-chat').hidden") and A.ev("document.querySelectorAll('.cin-toast').length")==0 and A.ev("document.querySelector('#chat-fab .badge').hidden"))
        chk("message is in the chat list", "hello" in A.ev("document.getElementById('cin-chat-list').textContent"))
        A.key("Escape")
        chk("Escape closes chat even though cinema panel is closed", A.ev("document.getElementById('cin-chat').hidden"))
        for i in range(5):
            B.ev("(n)=>{const i=document.getElementById('cin-chat-input'); i.value='m'+n; document.getElementById('cin-chat-form').requestSubmit();}", i)
        A.wait(600)
        chk("at most 3 toasts stack", A.ev("document.querySelectorAll('.cin-toast').length")==3 and A.ev("document.querySelector('#chat-fab .badge').textContent")=="5")
        A.ev("document.getElementById('cin-toasts').textContent=''")
        A.pg.click("#chat-fab"); A.wait(100); A.pg.click("#chat-fab"); A.wait(100)
        chk("chat button toggles chat", A.ev("document.getElementById('cin-chat').hidden"))
        # ---------- shortcuts ----------
        for w in (A, B): w.ev("document.activeElement.blur()"); w.ev("Cinema.ui.closeChat()")
        A.at("tv"); A.key("e")
        r = A.ev("(v)=>{const i=document.getElementById('cin-url'); i.value='https://www.youtube.com/watch?v='+v; document.getElementById('cin-load').click(); return 1}", V1); A.wait(600)
        B.at("tv"); B.key("e"); B.until("!document.getElementById('cin-join').hidden"); B.pg.click("#cin-join")
        chk("both joined", A.until("Cinema.session.joined && Cinema.session.adapter.p") and B.until("Cinema.session.joined && Cinema.session.adapter.p"))
        A.pg.click("#cin-play"); B.until("Cinema.session.info().playing")
        A.pg.mouse.click(5, 300); A.wait(100)    # focus the page, not an input
        v0 = A.info()["volume"]; A.key("ArrowDown")
        chk("Down lowers volume 5", A.info()["volume"] == v0 - 5, str(A.info()["volume"]))
        A.key("ArrowUp"); A.key("ArrowUp")
        chk("Up raises volume", A.info()["volume"] == v0 + 5 or A.info()["volume"] == 100)
        chk("OSD feedback shown", A.ev("document.getElementById('cin-osd').textContent").endswith("%"))
        t0 = A.fp()["t"]; A.key("ArrowRight")
        chk("Right seeks ahead ~5s", 3 < A.fp()["t"] - t0 < 8, f"{t0} -> {A.fp()['t']}")
        chk("partner follows the arrow seek", B.until(f"Math.abs(Cinema.session.adapter.p.getCurrentTime() - {A.fp()['t']}) < 3", 4000))
        t1 = A.fp()["t"]; A.key("ArrowLeft")
        chk("Left seeks back ~5s", 3 < t1 - A.fp()["t"] < 8)
        t2 = A.fp()["t"]; A.pg.keyboard.press("Shift+ArrowRight"); A.wait(150)
        chk("Shift+Right seeks ~15s", 12 < A.fp()["t"] - t2 < 18)
        A.key("Space")
        chk("Space pauses both", A.until("!Cinema.session.info().playing") and B.until("!Cinema.session.info().playing", 5000))
        A.key("Space")
        chk("Space resumes both", A.until("Cinema.session.info().playing") and B.until("Cinema.session.info().playing", 5000))
        A.pg.focus("#cin-play"); A.key("Space")
        chk("Space with a button focused toggles once (no double toggle)", A.until("!Cinema.session.info().playing"))
        A.key("Space")
        # moving: game must not see these keys
        p0 = A.ev("game.player.y"); A.key("ArrowUp"); A.wait(200)
        chk("arrow keys do not walk the player while watching", abs(A.ev("game.player.y") - p0) < 1)
        # typing guard
        A.pg.click("#chat-fab"); A.pg.focus("#cin-chat-input"); v = A.info()["volume"]; t = A.fp()["t"]
        A.pg.keyboard.type("a b"); A.key("ArrowLeft"); A.key("ArrowDown")
        chk("shortcuts ignored while typing in chat", A.info()["volume"] == v and abs(A.fp()["t"] - t) < 2 and A.ev("document.getElementById('cin-chat-input').value") == "a b")
        # toast while panel open + video watching: chat closed
        A.key("Escape"); A.key("Escape")
        B.pg.click("#chat-fab") if B.ev("document.getElementById('cin-chat').hidden") else None
        B.ev("(()=>{const i=document.getElementById('cin-chat-input'); i.value='while watching'; document.getElementById('cin-chat-form').requestSubmit();})()")
        chk("toast also appears while the cinema panel is open", A.until("[...document.querySelectorAll('.cin-toast')].some(t=>t.textContent.includes('while watching'))"))
        # shortcuts inactive when not watching
        A.ev("Cinema.ui.close && Cinema.ui.close()"); A.wait(200); A.ev("game.sitting=null")
        v = A.info()["volume"]; A.key("ArrowUp")
        chk("shortcuts inactive when not in the watching view", A.info()["volume"] == v)
        # fullscreen state flag (class toggled by ui) enables them
        A.ev("Cinema.ui._fsOn=true"); A.key("ArrowUp")
        chk("shortcuts active in fullscreen mode", A.info()["volume"] == min(100, v + 5))
        A.ev("Cinema.ui._fsOn=false")
        br.close()
finally:
    srv.terminate()

chk("no uncaught page errors / console errors", not errs, "\n".join(errs[:8]))
print(sum(res), "/", len(res)); sys.exit(0 if all(res) else 1)
