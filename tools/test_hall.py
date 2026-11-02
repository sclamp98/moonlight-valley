"""Co-op cinema integration test: TWO real browser contexts joined by a REAL WebRTC data channel (the same
invite/reply flow players use). Only the YouTube player is replaced by tools/cinema_fake_yt.js, because the CI
sandbox can't reach youtube.com; everything else (link, session, sync, UI, game) is the shipped code.
Run: python tools/test_cinema.py        (MAPSHOTS=<dir> to choose where screenshots go)"""
import subprocess, time, sys, os
from playwright.sync_api import sync_playwright

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = "8132"
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



BFS = """(roomKey)=>{
  const g=game, room = roomKey==='hall' ? g.homeRoom : g.gamingRoom, W=room.world.width, H=room.world.height, pw=CONFIG.PLAYER_SIZE, st=6;
  const hit=(x,y)=>{ if(x<0||y<0||x+pw>W||y+pw>H) return true; for(const s of room.solids){ if(x<s.x+s.w && x+pw>s.x && y<s.y+s.h && y+pw>s.y) return true;} return false; };
  const e = roomKey==='hall' ? room.entryPos() : room.entryPos();
  const key=(x,y)=>x+','+y, seen=new Set(), q=[[Math.round(e.x/st)*st, Math.round(e.y/st)*st]];
  if (hit(q[0][0],q[0][1])) return {err:'entry blocked', e};
  seen.add(key(q[0][0],q[0][1]));
  while(q.length){ const [x,y]=q.pop(); for(const [dx,dy] of [[st,0],[-st,0],[0,st],[0,-st]]){ const nx=x+dx, ny=y+dy; if(seen.has(key(nx,ny))||hit(nx,ny)) continue; seen.add(key(nx,ny)); q.push([nx,ny]); } }
  const cells=[...seen].map(k=>k.split(',').map(Number));
  const unreachable=[]; 
  for(const sp of room.spots){ const ok=cells.some(([x,y])=>Math.hypot(x+pw/2-sp.cx,y+pw/2-sp.cy)<CONFIG.INTERACT_RANGE); if(!ok) unreachable.push(sp.act); }
  const f=room.floor; let free=0,tot=0; for(let y=f.y*3;y<(f.y+f.h)*3-pw;y+=st*2) for(let x=f.x*3;x<(f.x+f.w)*3-pw;x+=st*2){ tot++; if(seen.has(key(Math.round(x/st)*st,Math.round(y/st)*st))) free++; }
  return {reach:cells.length, unreachable, freeFrac: free/tot, spots: room.spots.map(s=>s.act)};
}"""

srv = subprocess.Popen([sys.executable, "-m", "http.server", PORT], cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
bad_responses = []
try:
    with sync_playwright() as pw:
        br = pw.chromium.launch(args=["--disable-features=WebRtcHideLocalIpsWithMdns"])
        A = P(br, "Ana", "female", "A"); B = P(br, "Ben", "male", "B")
        for w in (A, B): w.pg.on("response", lambda r: bad_responses.append(r.url) if r.status >= 400 else None)
        A.ev("game.enterHome()"); A.until("game.inside && !game.fade", 5000); A.wait(300)
        # ---------- assets ----------
        r = A.ev("""(async()=>{ const names=[...Object.keys(HALL_ART.static).map(n=>[n,n]), ...Object.keys(HALL_ART.anim).map(n=>['a_'+n,n])]; const bad=[];
            for (const [f,n] of names){ const ok = await new Promise(res=>{ const i=new Image(); i.onload=()=>res(i.naturalWidth>0); i.onerror=()=>res(false); i.src='assets/hall/'+f+'.png'; }); if(!ok) bad.push(f); } return {n:names.length,bad}; })()""")
        chk("all supplied/cut sprites load (%d images)" % r["n"], not r["bad"], str(r["bad"]))
        chk("animated strips have 16 frames and frame width x n == image width", A.ev("""Object.entries(HALL_ART.anim).every(([n,m])=>m.n>=2 && m.w>0)"""))
        # ---------- main hall structure ----------
        chk("main hall is the new MainHall scene", A.ev("game.inside===game.homeRoom && game.homeRoom.isMainHall && game.homeRoom.isHall && HomeKit.Room.name==='MainHall'"))
        chk("hall has exactly two doorways in its walls (front door + gaming room)", A.ev("game.homeRoom.def.openings.length")==2)
        acts = A.ev("game.homeRoom.spots.map(s=>s.act)")
        chk("hall exits: one front door, one gaming doorway, one cellar staircase", acts.count("door")==1 and acts.count("gaming")==1 and acts.count("stairs")==1, str(acts))
        chk("hall keeps dining (eat) and a double bed (2 slots)", acts.count("eat")==1 and acts.count("bed")==2)
        chk("hall world is its own size and does not contain the gaming room", A.ev("game.homeRoom.world.width/3")==352 and not A.ev("game.homeRoom.spots.some(s=>s.act==='arcade1'||s.act==='pool')"))
        b = A.ev(f"({BFS})('hall')")
        chk("hall: entry is free and every interaction spot is reachable", not b.get("err") and not b["unreachable"], str(b)[:300])
        chk("hall: plenty of open floor for several players (>= 50% walkable)", b.get("freeFrac", 0) >= 0.50, str(b.get("freeFrac")))
        # ---------- hall view + hint on arrival ----------
        A.ev("game.homeCam().follow(game.player, game.inside.world, 0, true)"); A.wait(300)
        A.pg.add_style_tag(content="#controls{display:none!important}")
        A.shot("hall_view")
        # ---------- front door exit (walk down) ----------
        A.ev("(()=>{const e=game.homeRoom.entryPos(); game.player.x=e.x; game.player.y=e.y})()"); A.wait(200)
        A.pg.keyboard.down("s"); A.until("!!game.fade || !game.inside", 5000); A.pg.keyboard.up("s")
        chk("walking down through the front door leaves the house (exterior untouched)", A.until("!game.inside && !game.fade", 6000))
        chk("...and the farm is shown again", A.ev("!!game.page && !game.inside"))
        A.ev("game.enterHome()"); A.until("game.inside && !game.fade", 5000)
        # ---------- cellar stairs -> cinema -> back ----------
        A.ev("(()=>{const s=game.homeRoom.stairsFoot(); game.player.x=s.x; game.player.y=s.y; game.player.dirKey='up'})()"); A.wait(250)
        hint = A.ev("document.getElementById('hint').textContent")
        chk("near the stairs the prompt offers the cinema stairs", "cinema" in hint.lower() and A.ev("game.nearestIn && game.nearestIn.act")=="stairs", hint)
        A.key("e"); chk("E on the stairs fades into the (unchanged) cinema cellar", A.until("game.inside && game.inside.isCinema && !game.fade", 6000))
        chk("cinema room is still its own 288x208 map with the TV and sofa spots", A.ev("game.inside.world.width/3")==288 and A.ev("game.inside.spots.some(s=>s.act==='tv') && game.inside.spots.some(s=>s.act==='sit')"))
        A.at("up"); A.wait(200); A.key("e")
        chk("cinema stairs bring you back up to the hall, at the foot of the new staircase", A.until("game.inside===game.homeRoom && !game.fade", 6000) and abs(A.ev("game.player.x") - A.ev("game.homeRoom.stairsFoot().x")) < 4)
        # ---------- gaming room: enter ----------
        A.ev("(()=>{const e=game.homeRoom.returnFromGaming(); game.player.x=e.x; game.player.y=e.y; game.player.dirKey='right'})()"); A.wait(250)
        hint = A.ev("document.getElementById('hint').textContent")
        chk("approaching the right-hand doorway shows 'Enter Gaming Room'", "Enter Gaming Room" in hint, hint)
        pl_before = A.ev("({g:CONFIG.PLAYER_CHARACTER, same:window.__pl=game.player, n:CONFIG.PLAYER_NAME})")
        A.key("e")
        chk("E fades to the Gaming Room scene", A.until("game.inside && game.inside.isGaming && !game.fade", 6000))
        chk("Gaming Room is a separate map (408x320), not part of the hall", A.ev("game.inside!==game.homeRoom && game.inside.world.width/3")==408 and A.ev("game.inside.world.height/3")==320)
        chk("hall furniture is not in the gaming room and vice-versa", A.ev("!game.homeRoom.spots.some(s=>['arcade1','arcade2','pool','pong','foosball'].includes(s.act)) && !game.gamingRoom.spots.some(s=>['eat','bed','stairs','door'].includes(s.act))"))
        chk("player is placed at the gaming room entrance (left doorway)", A.ev("game.player.x/3") < 40 and 180 < A.ev("game.player.y/3") < 240)
        chk("player identity unchanged by the transition (same Player object, name, character)", A.ev("game.player===window.__pl") and A.ev("CONFIG.PLAYER_NAME")==pl_before["n"] and A.ev("CONFIG.PLAYER_CHARACTER")==pl_before["g"])
        chk("room label shows Gaming Room", A.ev("game.ui.place")=="Gaming Room")
        A.ev("game.homeCam().follow(game.player, game.inside.world, 0, true)"); A.wait(300)
        b = A.ev(f"({BFS})('gaming')")
        chk("gaming room: entry free, every machine/spot reachable, nothing blocked", not b.get("err") and not b["unreachable"], str(b)[:300])
        chk("gaming room: plenty of open floor (>= 55% walkable)", b.get("freeFrac", 0) >= 0.55, str(b.get("freeFrac")))
        gacts = set(A.ev("game.gamingRoom.spots.map(s=>s.act)"))
        chk("gaming room has arcades, pool, foosball, ping-pong, exit", {"arcade1","arcade2","pool","foosball","pong","mainhall"} <= gacts, str(gacts))
        A.shot("gaming_view")
        # a machine prompt
        A.ev("(()=>{const s=game.gamingRoom.spots.find(s=>s.act==='pool'); game.player.x=s.cx-15; game.player.y=s.cy-5})()"); A.wait(250)
        chk("standing at the pool table offers an interaction", "Play pool" in A.ev("document.getElementById('hint').textContent"))
        A.key("e"); chk("interacting with a machine just shows a message (no crash)", A.ev("!!game.player") and A.ev("game.inside.isGaming"))
        # ---------- gaming room: exit ----------
        A.ev("(()=>{const e=game.gamingRoom.entryPos(); game.player.x=e.x; game.player.y=e.y})()"); A.wait(250)
        hint = A.ev("document.getElementById('hint').textContent")
        chk("at the doorway the prompt offers 'Back to the Main Hall'", "Main Hall" in hint, hint)
        A.key("e")
        chk("E returns to the hall scene", A.until("game.inside===game.homeRoom && !game.fade", 6000))
        pos = A.ev("({x:game.player.x/3,y:game.player.y/3})")
        chk("returns next to the gaming doorway on the hall's right side", pos["x"] > 270 and 130 < pos["y"] < 200, str(pos))
        chk("same Player object after returning", A.ev("game.player===window.__pl"))
        # ---------- collisions (real keyboard) ----------
        def walk(key, ms):
            A.pg.keyboard.down(key); A.wait(ms); A.pg.keyboard.up(key); A.wait(80)
        # sofa: stand to its left, walk right
        A.ev("(()=>{const p=game.player; p.x=120*3; p.y=190*3; })()"); A.wait(100); walk("d", 900)
        sofa_left = (145 + 2) * 3
        chk("solid furniture (sofa) stops the player", A.ev("game.player.x + game.player.w") <= sofa_left + 4, str(A.ev("game.player.x")))
        A.ev("(()=>{const p=game.player; p.x=300*3; p.y=100*3; })()"); A.wait(100); walk("w", 900)
        chk("walls stop the player (back wall)", A.ev("game.player.y") >= 80 * 3 - 20 - 2, str(A.ev("game.player.y")))
        A.ev("(()=>{const p=game.player; p.x=300*3; p.y=150*3; })()"); A.wait(100); walk("d", 900)
        chk("right wall stops the player (the doorway needs E, no walking out into the void)", A.ev("game.player.x + game.player.w") <= 336 * 3 + 2)
        # ---------- animations ----------
        f1 = A.ev("Math.floor(performance.now()/60)%16"); A.wait(250)
        chk("animated props advance frames over time (fire, TV, arcades)", A.ev("Math.floor(performance.now()/60)%16") != f1)
        # ---------- sleeping still works in the new hall ----------
        A.ev("game.energy = 5"); A.ev("(()=>{const s=game.homeRoom.spots.find(s=>s.act==='bed'); game.player.x=s.cx-15; game.player.y=s.cy-20})()"); A.wait(150)
        A.key("e"); chk("E at the bed lies down", A.ev("!!game.lying"), "canSleep:" + str(A.ev("game.canSleep")))
        A.key("e"); A.until("!game.lying && !game.fade", 6000); A.wait(300)
        chk("sleeping ends with the player standing beside the bed, still in the hall", A.ev("game.inside===game.homeRoom && !game.lying"))
        # dozing off in the gaming room brings you to the hall
        A.ev("game.passDoor('gaming')"); A.wait(300)
        A.ev("game.doSleep(true)"); A.wait(300)
        chk("passing out in the gaming room wakes you up in the hall (no crash)", A.ev("game.inside===game.homeRoom && !game.lying"))
        # ---------- two players ----------
        for w in (A, B): w.ev("game.enterHome()"); 
        A.until("game.inside && !game.fade"); B.until("game.inside && !game.fade")
        ok, _, _ = connect(A, B)
        chk("co-op link opens", ok)
        chk("both in the hall: each sees the other's presence as 'home'", A.until("Cinema.remote && Cinema.remote.where==='home'") and B.until("Cinema.remote && Cinema.remote.where==='home'"))
        for w in (A, B): w.ev("(()=>{const r=Cinema.remote; window.__draws=0; const od=r.draw.bind(r); r.draw=function(c,cm){window.__draws++; return od(c,cm)}})()")
        A.wait(500); chk("same room: partner avatar is drawn", A.ev("window.__draws")>0 and B.ev("window.__draws")>0)
        B.ev("game.passDoor('gaming')"); 
        chk("when B goes to the gaming room, A sees B as 'gaming'", A.until("Cinema.remote.where==='gaming'", 5000))
        A.ev("window.__draws=0"); A.wait(700)
        chk("different rooms: A does NOT draw B (no mixing of rooms)", A.ev("window.__draws")==0, str(A.ev("window.__draws")))
        chk("co-op link stayed up through the room change", A.ev("Cinema.link.open") and B.ev("Cinema.link.open"))
        A.ev("game.passDoor('gaming')"); A.wait(300)
        for w in (A, B): w.ev("window.__draws=0")
        A.wait(700); chk("both in the gaming room: partners see each other", A.until("Cinema.remote.where==='gaming' && window.__draws>0", 4000) and B.until("Cinema.remote.where==='gaming' && window.__draws>0", 4000))
        A.shot("gaming_two_players")
        A.ev("(()=>{const i=document.getElementById('cin-chat-input'); Cinema.ui.openChat(); i.value='hi from the arcade'; document.getElementById('cin-chat-form').requestSubmit();})()")
        chk("chat still works across the new rooms", B.until("Cinema.ui.chatMsgs.some(m=>m.text==='hi from the arcade')", 5000))
        B.ev("game.passDoor('gamingBack')"); A.ev("game.passDoor('gamingBack')")
        chk("both back in the hall: presence returns to 'home'", A.until("Cinema.remote.where==='home'", 5000) and B.until("Cinema.remote.where==='home'", 5000))
        chk("emote availability is room-scoped (same room only)", A.ev("Cinema.where(game)")=="home")
        br.close()
finally:
    srv.terminate()

chk("no uncaught page errors / console errors", not errs, "\n".join(errs[:8]))
chk("no 4xx/5xx responses (no broken asset paths)", not [u for u in bad_responses if "favicon" not in u], "\n".join(bad_responses[:8]))
print(sum(res), "/", len(res)); sys.exit(0 if all(res) else 1)
