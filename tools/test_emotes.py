"""Co-op emote integration test: TWO real browsers joined by a REAL WebRTC data channel (same invite flow as players).
Kiss (K) and hip slap (H, man only): range check, both farmers locked + animated on both screens, partner can't stop it,
mirroring, positions agree afterwards, disconnect mid-emote, cinema room.   Run: python tools/test_emotes.py"""
import subprocess, time, sys, os
from playwright.sync_api import sync_playwright

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = "8129"; URL = f"http://localhost:{PORT}/index.html"
FAKE = os.path.join(root, "tools", "cinema_fake_yt.js"); out = os.environ.get("MAPSHOTS", "/tmp")
res, errs = [], []
def chk(name, ok, extra=""): res.append(bool(ok)); print(("PASS " if ok else "FAIL ") + name, extra if not ok else "")

class P:
    def __init__(self, browser, name, gender, tag):
        self.tag = tag; self.ctx = browser.new_context(viewport={"width": 1280, "height": 720}); self.pg = self.ctx.new_page()
        self.pg.on("pageerror", lambda e: errs.append(f"[{tag}] {e}"))
        self.pg.on("console", lambda m: errs.append(f"[{tag}] console: {m.text}") if m.type == "error" and "favicon" not in m.text else None)
        self.pg.add_init_script(path=FAKE); self.pg.goto(URL); self.pg.wait_for_timeout(1200)
        self.ev("(a)=>{ Cinema.ensure(game); Cinema.self.name=a[0]; Cinema.self.gender=a[1]; CONFIG.PLAYER_NAME=a[0]; }", [name, gender])
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
    def key(self, k): self.pg.keyboard.press(k); self.wait(60)
    def active(self): return self.ev("!!Emotes.active")
    def msg(self): return self.ev("game.toastEl.textContent")
    def shot(self, n): self.pg.screenshot(path=f"{out}/{n}.png")

def connect(a, b):
    offer = a.ev("Cinema.link.createInvite()"); reply = b.ev("(c)=>Cinema.link.acceptInvite(c)", offer); a.ev("(c)=>Cinema.link.acceptAnswer(c)", reply)
    return a.until("Cinema.link.open && !!Cinema.link.peer", 15000) and b.until("Cinema.link.open && !!Cinema.link.peer", 15000)

# put a player at a free spot of the room, nudged by (dx,dy) from a base free spot found by search
FREE = """(a)=>{ const g=game, room=g.inside, p=g.player, W=room.world;
  const free=(x,y)=>x>=0&&y>=0&&x+30<=W.width&&y+30<=W.height&&!room.solids.some(s=>x<s.x+s.w&&x+30>s.x&&y<s.y+s.h&&y+30>s.y);
  if(a.base){ p.x=a.base.x+a.dx; p.y=a.base.y+a.dy; return free(p.x,p.y); }
  for(let y=W.height*0.35;y<W.height*0.9;y+=10) for(let x=W.width*0.1;x<W.width*0.8;x+=10){ let ok=true; for(let dx=-10;dx<=150;dx+=10) for(let dy=-10;dy<=10;dy+=10) if(!free(x+dx,y+dy)) ok=false; if(ok){ p.x=x; p.y=y; return {x,y}; } }
  return null; }"""

srv = subprocess.Popen([sys.executable, "-m", "http.server", PORT], cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
try:
    with sync_playwright() as pw:
        br = pw.chromium.launch(args=["--disable-features=WebRtcHideLocalIpsWithMdns"])
        A = P(br, "Ana", "female", "A"); B = P(br, "Ben", "male", "B")
        chk("emote module is loaded and all frames exist", A.ev("typeof Emotes==='object' && EMOTE_ART.kiss.n>20 && EMOTE_ART.slap.n>20"))
        chk("connected over WebRTC", connect(A, B))
        for X in (A, B): X.ev("game.enterHome()")
        A.wait(1000)
        base = A.ev(FREE, {"base": None})
        assert base, "no free spot found"
        A.ev(FREE, {"base": base, "dx": 0, "dy": 0}); B.ev(FREE, {"base": base, "dx": 140, "dy": 0})   # 140px apart = too far
        A.wait(500)
        chk("each sees the other in the house", A.ev("Cinema.remote && Cinema.remote.where==='home'") and B.ev("Cinema.remote && Cinema.remote.where==='home'"))

        # ---- out of range
        A.key("k"); A.wait(200)
        chk("kiss refused when too far (no emote, message shown)", not A.active() and not B.active() and "closer" in A.msg().lower(), A.msg())
        B.key("h"); B.wait(200)
        chk("slap refused when too far", not A.active() and not B.active())

        # ---- in range: kiss started by the woman
        B.ev(FREE, {"base": base, "dx": 60, "dy": 10}); A.wait(600)
        chk("prompt keys appear when close (state ok)", A.ev("(()=>{const s=Emotes; return !!Cinema.remote && Math.hypot(game.player.cx-Cinema.remote.cx, game.player.cy-Cinema.remote.cy)<=85;})()"))
        A.shot("emote_prompt")
        pa0 = A.ev("({x:game.player.x,y:game.player.y})")
        A.key("k"); A.wait(250)
        chk("woman presses K: her emote is running", A.active())
        chk("...and it started on the man's screen too (he did nothing)", B.until("!!Emotes.active", 2000))
        B.pg.keyboard.down("a"); B.pg.keyboard.down("w")        # the partner tries to walk away / fight it
        B.wait(900)
        mid = A.ev("({a:Emotes.active && Emotes.active.kind})")
        A.wait(1200)
        chk("partner cannot move away while it plays", B.ev("Emotes.active && Math.hypot(game.player.x-Emotes.active.L.m0.x+15, 0)<1 || Emotes.active && Math.abs((game.player.x+15)-(Emotes.active.L.f0.x))>0") is not None and B.active())
        B.shot("emote_kiss_B"); A.shot("emote_kiss_A")
        chk("both normal sprites are hidden during the pair animation", A.ev("game.player.emoAlpha===0") and A.ev("Cinema.remote.emoAlpha===0") and B.ev("game.player.emoAlpha===0"))
        B.pg.keyboard.up("a"); B.pg.keyboard.up("w")
        B.key("e"); B.key("i"); B.key("Escape")
        chk("partner pressing E / I / Esc does nothing during it", B.active() and B.ev("game.uiMode===null"))
        chk("both are still inside the house", A.ev("!!game.inside") and B.ev("!!game.inside"))
        chk("both finish by themselves", A.until("!Emotes.active", 9000) and B.until("!Emotes.active", 3000))
        A.wait(500)
        pa, pb = A.ev("({x:game.player.x,y:game.player.y,d:game.player.dirKey,al:game.player.emoAlpha})"), B.ev("({x:game.player.x,y:game.player.y,d:game.player.dirKey,al:game.player.emoAlpha})")
        ra = A.ev("({x:Cinema.remote.x,y:Cinema.remote.y,al:Cinema.remote.emoAlpha})"); rb = B.ev("({x:Cinema.remote.x,y:Cinema.remote.y})")
        chk("woman stands facing right (man is on her right), man faces left", pa["d"] == "right" and pb["d"] == "left", f"{pa} {pb}")
        chk("normal sprites are back (no leftover alpha)", pa["al"] is None and ra["al"] is None)
        chk("positions agree on both screens afterwards (<3px)", abs(pa["x"]-rb["x"]) < 3 and abs(pa["y"]-rb["y"]) < 3 and abs(pb["x"]-ra["x"]) < 3 and abs(pb["y"]-ra["y"]) < 3, f"{pa} {pb} {ra} {rb}")
        chk("both on the same line (side by side), ~50px apart", abs(pa["y"]-pb["y"]) < 2 and 35 < pb["x"]-pa["x"]-30 < 60 or 35 < pb["x"]-pa["x"] < 70, f"{pa} {pb}")
        A.wait(300)
        chk("farmers can walk again", A.ev("(()=>{ return !Emotes.active; })()"))
        x0 = B.ev("game.player.x"); B.pg.keyboard.down("d"); B.wait(400); B.pg.keyboard.up("d")
        chk("control is back: man can walk", B.ev("game.player.x") > x0 + 5)

        # ---- slap: only the man; woman is refused
        B.ev(FREE, {"base": base, "dx": 60, "dy": 0}); A.ev(FREE, {"base": base, "dx": 0, "dy": 0}); A.wait(600)
        A.key("h"); A.wait(250)
        chk("woman pressing H is refused (men only)", not A.active() and not B.active() and "man" in A.msg().lower(), A.msg())
        B.key("h"); B.wait(250)
        chk("man presses H: slap runs on both screens", B.active() and A.until("!!Emotes.active && Emotes.active.kind==='slap'", 2000))
        smack = "game.ui.floaters.some(f=>f.text==='Smack!')"
        chk("a 'Smack!' pops up at the hit on both screens", A.until(smack, 4000, 40) and B.until(smack, 2000, 40))
        A.shot("emote_slap_A"); B.shot("emote_slap_B")
        chk("slap finishes on both", A.until("!Emotes.active", 8000) and B.until("!Emotes.active", 3000))
        chk("after the slap: woman back to camera, man facing camera", A.ev("game.player.dirKey")=="up" and B.ev("game.player.dirKey")=="down")

        # ---- mirrored: man standing LEFT of the woman
        A.ev(FREE, {"base": base, "dx": 60, "dy": 0}); B.ev(FREE, {"base": base, "dx": 0, "dy": 0}); A.wait(600)
        B.key("k"); B.wait(300)
        chk("man on the left: art mirrored on both screens", B.ev("Emotes.active.flip===true") and A.until("Emotes.active && Emotes.active.flip===true", 2000))
        B.wait(2800); B.shot("emote_kiss_mirrored")
        chk("mirrored kiss finishes: man faces right, woman faces left", A.until("!Emotes.active", 8000) and B.until("!Emotes.active", 3000) and B.ev("game.player.dirKey")=="right" and A.ev("game.player.dirKey")=="left")

        # ---- both press at the same time: exactly one emote
        A.ev(FREE, {"base": base, "dx": 0, "dy": 0}); B.ev(FREE, {"base": base, "dx": 60, "dy": 0}); A.wait(600)
        A.pg.keyboard.down("k"); B.pg.keyboard.down("h"); A.wait(40); A.pg.keyboard.up("k"); B.pg.keyboard.up("h"); A.wait(900)
        ka, kb = A.ev("Emotes.active && Emotes.active.kind"), B.ev("Emotes.active && Emotes.active.kind")
        chk("simultaneous K and H: both screens agree on one emote", ka and ka == kb, f"{ka} {kb}")
        A.until("!Emotes.active", 9000); B.until("!Emotes.active", 3000)

        # ---- link dies mid-emote
        A.ev(FREE, {"base": base, "dx": 0, "dy": 0}); B.ev(FREE, {"base": base, "dx": 60, "dy": 0}); A.wait(600)
        A.key("k"); A.wait(1500)
        B.ev("Cinema.link.close && Cinema.link.close()") if B.ev("typeof Cinema.link.close==='function'") else B.ctx.close()
        chk("partner disconnects mid-emote: the other farmer is freed and visible", A.until("!Emotes.active && game.player.emoAlpha===undefined", 8000))
        A.ev("game.input.down.clear()")

        # ---- cinema room
        A2 = P(br, "Ana", "female", "A2"); B2 = P(br, "Ben", "male", "B2")
        chk("reconnect for the cinema", connect(A2, B2))
        for X in (A2, B2): X.ev("game.enterHome()"); X.wait(700); X.ev("game.enterCinema()"); X.wait(700)
        base2 = A2.ev(FREE, {"base": None}); B2.ev(FREE, {"base": base2, "dx": 55, "dy": 0}); A2.wait(600)
        B2.key("k"); chk("kiss works in the cinema room too", B2.active() and A2.until("!!Emotes.active", 2000))
        B2.wait(2600); B2.shot("emote_cinema_B"); A2.shot("emote_cinema_A")
        chk("cinema kiss ends cleanly", A2.until("!Emotes.active", 9000) and B2.until("!Emotes.active", 3000))
        A2.ev(FREE, {"base": base2, "dx": -80, "dy": 0}); B2.ev("game.player.x=game.player.x"); 
        # sitting on the sofa blocks it
        B2.ev("game.sitCinema(0)"); B2.wait(300); B2.key("k")
        chk("sitting on the sofa: no emote", not B2.active() and not A2.active())

        chk("no page errors", not errs, "\n".join(errs[:6]))
        br.close()
finally:
    srv.terminate()
print(f"\n{sum(res)}/{len(res)} passed"); sys.exit(0 if all(res) else 1)
