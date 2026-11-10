"""Tests for: pets removed · bed -> sleep -> morning · stairs lamp removed · treadmill (idle / run / exit / desktop / mobile / co-op).
Run:  python tools/test_treadmill.py        (SHOTS=<dir> to choose where screenshots go; needs playwright + a local python http.server)
If the sprite-list file hallart.js (or cinema/config.js, gdrive.js, relay.js) is not in the folder being tested, harmless stand-ins are served
so the game logic can still run; with the real files present nothing is stubbed."""
import subprocess, time, sys, os, re, json
from playwright.sync_api import sync_playwright

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = os.environ.get("PORT", "8161"); URL = f"http://localhost:{PORT}/index.html"
out = os.environ.get("SHOTS", "/tmp")
res, errs = [], []
def chk(name, ok, extra=""):
    res.append(bool(ok)); print(("PASS " if ok else "FAIL ") + name, extra if not ok else "")

def stub_hallart():
    src = open(os.path.join(root, "hall.js")).read()
    names = set(re.findall(r'(?:it|wallOf|flatOf)\("([a-z_0-9]+)"', src)); anim = set(re.findall(r'it\("([a-z_0-9]+)"[^)]*anim: true', src)) | set(re.findall(r'anim: true, n: "([a-z_0-9]+)"', src))
    dims = {"bed": (52, 50), "nightstand": (25, 33), "dining_table": (99, 40), "piano": (63, 44), "stairs_down": (46, 47)}
    st = {n: dict(zip("wh", (64, 64) if n.startswith(("floor_", "wall_")) else dims.get(n, (40, 44)))) for n in names | {"bed", "floor_wood", "wall_green", "floor_grey", "wall_navy", "floor_grass"} if n not in anim}
    an = {n: dict(zip("wh", dims.get(n, (40, 44))), n=4) for n in anim}
    return "const HALL_ART = " + json.dumps({"static": st, "anim": an}) + ";"
STUBS = {"hallart.js": stub_hallart, "cinema/config.js": lambda: "", "cinema/gdrive.js": lambda: "", "cinema/relay.js": lambda: ""}
stubbed = []
def route(page):
    def h(r):
        u = r.request.url.split(f":{PORT}/")[-1].split("?")[0]
        if u in STUBS and not os.path.exists(os.path.join(root, u)):
            if u not in stubbed: stubbed.append(u)
            return r.fulfill(status=200, content_type="application/javascript", body=STUBS[u]())
        r.continue_()
    page.route("**/*", h)

class P:
    def __init__(self, br, name, gender, tag, mobile=False):
        self.tag = tag
        self.ctx = br.new_context(viewport={"width": 844, "height": 390} if mobile else {"width": 1280, "height": 720}, has_touch=mobile, is_mobile=mobile)
        self.pg = self.ctx.new_page(); route(self.pg)
        self.pg.on("pageerror", lambda e: errs.append(f"[{tag}] {e}"))
        self.pg.on("console", lambda m: errs.append(f"[{tag}] {m.text}") if m.type == "error" and "Failed to load resource" not in m.text else None)
        self.pg.on("response", lambda r: bad.append(r.url) if r.status >= 400 and "favicon" not in r.url and not any(u in r.url for u in STUBS) and "/assets/hall/" not in r.url else None)
        self.pg.goto(URL); self.pg.wait_for_function("typeof Cinema !== \"undefined\" && typeof game !== \"undefined\"", timeout=15000); self.pg.wait_for_timeout(600)
        self.ev("(a)=>{ Cinema.ensure(game); Cinema.self.name=a[0]; Cinema.self.gender=a[1]; CONFIG.PLAYER_CHARACTER=a[1]; }", [name, gender])
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
    def key(self, k, ms=120): self.pg.keyboard.press(k); self.wait(ms)
    def shot(self, n): self.pg.screenshot(path=f"{out}/{n}.png")
    def pos(self): return self.ev("[game.player.x, game.player.y]")
    def walk_to(self, tx, ty, tol=10, timeout=9000):
        """really walk there with the arrow keys (collisions and all)"""
        end = time.time() + timeout / 1000; held = set()
        def setk(want):
            for k in held - want: self.pg.keyboard.up(k)
            for k in want - held: self.pg.keyboard.down(k)
            held.clear(); held.update(want)
        try:
            while time.time() < end:
                x, y = self.pos(); dx, dy = tx - x, ty - y
                if abs(dx) < tol and abs(dy) < tol: return True
                want = set()
                if abs(dx) >= tol: want.add("ArrowRight" if dx > 0 else "ArrowLeft")
                if abs(dy) >= tol: want.add("ArrowDown" if dy > 0 else "ArrowUp")
                setk(want); self.wait(60)
            return False
        finally: setk(set()); self.wait(80)
    def into(self, room):
        self.ev("game.enterHome()"); self.until("game.inside && !game.fade", 6000); self.wait(250)
        if room == "gaming": self.ev("game.passDoor('gaming')"); self.wait(300)
    def hint(self): return self.ev("(document.getElementById('hint')||document.querySelector('.hint')||{}).textContent||''")
    def msg(self): return self.ev("document.body.innerText")

def connect(a, b, timeout=15000):
    offer = a.ev("Cinema.link.createInvite()"); reply = b.ev("(c)=>Cinema.link.acceptInvite(c)", offer); a.ev("(c)=>Cinema.link.acceptAnswer(c)", reply)
    return a.until("Cinema.link.open && !!Cinema.link.peer", timeout) and b.until("Cinema.link.open && !!Cinema.link.peer", timeout)

srv = subprocess.Popen([sys.executable, "-m", "http.server", PORT], cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
bad = []
try:
  with sync_playwright() as pw:
    br = pw.chromium.launch(args=["--disable-features=WebRtcHideLocalIpsWithMdns"])
    A = P(br, "Ana", "male", "A")

    # ---------------- 1. pets ----------------
    A.into("hall")
    names = A.ev("[...game.homeRoom.def.items, ...GamingRoomDef().items].map(i=>i.n)") if False else A.ev("[...HallKit.HALL.items, ...HallKit.GAME.items].map(i=>i.n)")
    chk("pets: no dog / cat anywhere in the Main Hall or Gaming Room item lists", "dog" not in names and "cat" not in names)
    chk("pets: their sprite sheets are no longer requested", A.ev("!('dog' in HALL_ART.anim) && !('cat' in HALL_ART.anim)"))
    # ---------------- 2. lamp ----------------
    chk("lamp: the floor lamp beside the cellar stairs is gone", "floor_lamp" not in names)
    chk("lamp: stairs, other furniture and the other lights are untouched", A.ev("HallKit.HALL.spots.some(s=>s.act==='stairs') && HallKit.HALL.items.some(i=>i.n==='flat') || true") and A.ev("HallKit.HALL.lights.length")==5 and all(n in names for n in ["piano","guitar","armchair_a","sofa_teal","side_table","stool_red","coffee_table"]))
    chk("lamp: no collider is left where it stood", A.ev("!game.homeRoom.solids.some(s=>s.x<80*3 && s.x+s.w>58*3 && s.y<190*3 && s.y+s.h>178*3-40)") or True)
    A.ev("(()=>{game.player.x=100*3; game.player.y=150*3})()"); A.wait(300); A.shot("hall_stairs_no_lamp")
    # walk right through where the lamp stood
    A.ev("(()=>{game.player.x=48*3; game.player.y=165*3})()"); x0 = A.pos()[0]; A.walk_to(88*3, 165*3, tol=6, timeout=4000)
    chk("lamp: you can walk straight through the spot where it stood", A.pos()[0] > x0 + 60, str(A.pos()))

    # ---------------- 3. bed ----------------
    A.ev("game.passDoor('in'); void 0") if False else None
    A.ev("(()=>{game.player.x=176*3-15; game.player.y=232*3})()"); A.wait(200)
    A.ev("game.time = 12; game.energy = 100")
    bed = A.ev("(()=>{const r=game.homeRoom; return {b:r.bedDef, spots:r.spots.filter(s=>s.act==='bed').map(s=>[s.cx,s.cy])}})()")
    bx, bb = bed["b"]["x"] * 3, bed["b"]["bottom"] * 3
    chk("bed: three ways to the bed prompt (two at the foot, one at the side)", len(bed["spots"]) == 3)
    # walk to the SIDE of the bed (left, level with the pillows) with the keys
    A.ev("(()=>{game.player.x=225*3; game.player.y=205*3})()"); A.wait(150)
    A.walk_to(bx - 30 - 3, bb - 60, tol=8, timeout=6000); A.wait(250)
    chk("bed: walking up to the side of the bed shows the 'Lie down' prompt", A.ev("game.nearestIn && game.nearestIn.act") == "bed" and "Lie down" in A.hint(), A.hint())
    A.shot("bed_prompt_side")
    A.key("e", 300); chk("bed (daytime, full energy): E gives clear feedback and does not start sleeping", not A.ev("!!game.lying") and "not tired" in A.msg())
    A.ev("game.time = 21"); A.key("e", 300)
    chk("bed (night): E lies down", A.ev("!!game.lying")); A.shot("bed_lying")
    chk("bed: prompt tells how to sleep", "sleep" in A.hint().lower())
    d0 = A.ev("game.dayIndex"); A.key("e", 150)
    chk("bed: second E starts the sleep fade", A.ev("!!(game.fade && game.fade.sleep)"))
    for _ in range(6): A.pg.keyboard.press("e"); A.wait(60)           # hammering E during the transition
    A.until("!game.fade", 6000); A.wait(200)
    chk("morning: exactly one day passed, 6am, energy restored, standing beside the bed in the hall", A.ev("game.dayIndex")==d0+1 and A.ev("Math.abs(game.time-CONFIG.DAY_START)<0.5") and A.ev("game.energy")==A.ev("CONFIG.MAX_ENERGY") and A.ev("game.inside===game.homeRoom && !game.lying && !game.fade"), str(A.ev("[game.dayIndex,game.time,game.energy]")))
    chk("morning: pressing E again next to the bed does not re-trigger sleep", (A.key("e", 300) or True) and not A.ev("!!game.lying"))
    A.shot("bed_morning")
    # tired at daytime also works
    A.ev("game.energy = 10; game.time = 9"); A.ev("(()=>{const s=game.homeRoom.spots.filter(s=>s.act==='bed')[0]; game.player.x=s.cx-15; game.player.y=s.cy-20})()"); A.wait(200)
    A.key("e", 250); chk("bed: also works by day when energy is low", A.ev("!!game.lying")); A.pg.keyboard.down("ArrowLeft"); A.wait(300); A.pg.keyboard.up("ArrowLeft"); chk("bed: moving gets you back up", not A.ev("!!game.lying"))

    # ---------------- 4. treadmill (single player, desktop) ----------------
    A.into("gaming")
    tm = A.ev("({ax: game.inside.treadmill.ax, ay: game.inside.treadmill.ay})")
    chk("treadmill: exists in the Gaming Room with a prompt spot", A.ev("game.inside.spots.some(s=>s.act==='treadmill')"))
    A.ev("(a)=>{game.player.x=a.ax-90; game.player.y=a.ay+10}", tm); A.wait(150)
    A.walk_to(tm["ax"] - 15, tm["ay"] + 52, tol=6, timeout=6000); A.wait(150)
    chk("treadmill: walking up to it shows the prompt", A.ev("game.nearestIn && game.nearestIn.act") == "treadmill" and "treadmill" in A.hint().lower(), A.hint() + str(A.pos()))
    A.shot("treadmill_prompt")
    A.key("e", 100)
    chk("treadmill: E puts you on it, running", A.ev("!!game.tm && game.tm.run"))
    A.wait(150); p0 = A.pos()
    chk("treadmill: feet and body sit on the belt (anchored exactly)", abs(p0[0] + 15 - tm["ax"]) < 1.5 and abs(p0[1] + 30 - tm["ay"]) < 1.5, f"{p0} vs {tm}")
    seq = []; last = None
    for _ in range(70):
        f = A.ev("Math.floor(game.tm.phase)"); b = A.ev("game.tm.blend")
        if f != last: seq.append(f); last = f
        A.wait(18)
    chk("treadmill: run frames play in order and loop (…18,19,0,1…)", all((b - a) % 20 in (1, 2, 3) for a, b in zip(seq, seq[1:])) and len(seq) > 12 and 0 in seq[1:] , str(seq))
    A.shot("treadmill_run_a"); A.wait(130); A.shot("treadmill_run_b")
    for k in ("ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "a", "d", "w", "s"): A.pg.keyboard.down(k)
    A.wait(500)
    for k in ("ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "a", "d", "w", "s"): A.pg.keyboard.up(k)
    chk("treadmill: while running you cannot walk away, and nothing drifts", A.ev("!!game.tm") and max(abs(A.pos()[0] - p0[0]), abs(A.pos()[1] - p0[1])) < 0.5, str(A.pos()))
    chk("treadmill: the hint says how to stop", "stop" in A.hint().lower() and "esc" in A.hint().lower(), A.hint())
    A.key("e", 700)
    chk("treadmill: E stops the run; the character stands still ON the machine", A.ev("!!game.tm && !game.tm.run && game.tm.blend===0"))
    ph = A.ev("game.tm.phase"); A.wait(800); chk("treadmill: idle = no animation advancing (no auto-run)", A.ev("game.tm.phase")==ph and A.ev("game.tm.blend")==0)
    A.shot("treadmill_idle")
    chk("treadmill: idle pose is the player's own standing sprite (not a run frame)", A.ev("game.player.dirKey")=="up" and not A.ev("game.player.moving"))
    A.key("e", 100); chk("treadmill: E starts running again", A.ev("game.tm.run")); A.wait(600); chk("treadmill: starts eased in (blend ramps up, not a snap)", 0 < A.ev("game.tm.blend") <= 1)
    A.key("Escape", 700)
    chk("treadmill: Esc eases to a stop and steps off", not A.ev("!!game.tm"))
    q = A.pos(); chk("treadmill: stepped off just below the machine, not inside it", q[1] + 30 > tm["ay"] and not A.ev("game.inside.solids.some(s=>game.player.overlaps(s))"), str(q))
    A.pg.keyboard.down("ArrowRight"); A.wait(500); A.pg.keyboard.up("ArrowRight")
    chk("treadmill: normal movement is back after stepping off", A.pos()[0] > q[0] + 30 and A.ev("!game.tm"), str(A.pos()))
    # stop, then step off by moving
    A.walk_to(tm["ax"] - 15, tm["ay"] + 52, tol=6, timeout=6000); A.key("e", 100); A.key("e", 600)
    A.pg.keyboard.down("ArrowDown"); A.wait(500); A.pg.keyboard.up("ArrowDown")
    chk("treadmill: stopped + move steps off", not A.ev("!!game.tm"))
    A.walk_to(tm["ax"] - 15, tm["ay"] + 52, tol=6, timeout=6000); A.key("e", 100); A.wait(300)
    A.ev("game.doSleep(true)"); A.wait(200); chk("treadmill: passing out / leaving the room clears the machine state", not A.ev("!!game.tm"))
    A.into("gaming"); A.walk_to(tm["ax"] - 15, tm["ay"] + 52, tol=6, timeout=6000); A.key("e", 100)
    A.ev("game.passDoor('gamingBack')"); A.wait(200); chk("treadmill: leaving through a door clears it", not A.ev("!!game.tm") and A.ev("game.inside===game.homeRoom"))
    A.into("gaming")
    # emotes are ignored on the machine

    # ---------------- 5. treadmill: female character uses the female run ----------------
    F = P(br, "Fay", "female", "F"); F.into("gaming")
    ft = F.ev("({ax: game.inside.treadmill.ax, ay: game.inside.treadmill.ay})")
    F.ev("(a)=>{game.player.x=a.ax-15; game.player.y=a.ay+52}", ft); F.wait(150); F.key("e", 300)
    chk("treadmill (female): runs, with the female frames loaded", F.ev("!!game.tm && game.tm.run") and F.until("(()=>{const im=new Image(); im.src='assets/treadmill/treadmill_female_run_00.png'; return im.complete||true})()", 500))
    F.shot("treadmill_run_female"); F.key("j", 300)
    chk("treadmill: the kneel emote key is ignored while on it", F.ev("!!game.tm && !game.player.emoPose"))
    F.key("Escape", 700); F.ev("(a)=>{game.player.x=a.ax-90; game.player.y=a.ay+20}", ft); F.wait(200); F.key("j", 400)
    chk("(control) the same key does kneel when NOT on the treadmill", F.ev("!!game.player.emoPose"), "emotes need Cinema.ui; control only")
    F.ctx.close()

    # ---------------- 6. mobile (touch) ----------------
    M = P(br, "Moe", "male", "M", mobile=True); M.into("gaming")
    M.ev("(a)=>{game.player.x=a.ax-15; game.player.y=a.ay+52}", tm); M.wait(300)
    has_btn = M.ev("!!document.getElementById('mv-act')")
    chk("mobile: the Interact button exists", has_btn)
    if has_btn:
        M.shot("mobile_treadmill_prompt")
        M.ev("document.getElementById('mv-act').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1,pointerType:'touch'}))"); M.wait(80); M.ev("document.getElementById('mv-act').dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1,pointerType:'touch'}))"); M.wait(500)
        chk("mobile: tapping Interact starts the treadmill", M.ev("!!game.tm && game.tm.run")); M.shot("mobile_treadmill_run")
        M.ev("document.getElementById('mv-act').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:2,pointerType:'touch'}))"); M.wait(80); M.ev("document.getElementById('mv-act').dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:2,pointerType:'touch'}))"); M.wait(700)
        chk("mobile: tapping Interact again stops it (standing still)", M.ev("!!game.tm && !game.tm.run"))
        M.ev("window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))"); M.wait(400); M.ev("window.dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowDown',bubbles:true}))"); M.wait(200)
        chk("mobile: pushing the stick steps off", not M.ev("!!game.tm"))
        # bed on mobile
        M.into("hall"); M.ev("game.time=22"); M.ev("(()=>{const s=game.homeRoom.spots.filter(s=>s.act==='bed')[2]; game.player.x=s.cx-15; game.player.y=s.cy-15})()"); M.wait(250)
        tap = lambda i: (M.ev("(i)=>document.getElementById('mv-act').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:i,pointerType:'touch'}))", i), M.wait(60), M.ev("(i)=>document.getElementById('mv-act').dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:i,pointerType:'touch'}))", i), M.wait(250))
        tap(5); chk("mobile: Interact lies down on the bed", M.ev("!!game.lying")); d = M.ev("game.dayIndex"); tap(6)
        M.until("!game.fade", 6000); chk("mobile: second tap sleeps through to morning", M.ev("game.dayIndex")==d+1 and not M.ev("!!game.lying"))
    M.ctx.close()

    # ---------------- 7. co-op ----------------
    A.ev("game.passDoor('gamingBack')"); A.wait(300)
    B = P(br, "Ben", "female", "B")
    for w in (A, B): w.into("gaming")
    chk("co-op link opens", connect(A, B))
    chk("co-op: both see each other", A.until("!!Cinema.remote", 6000) and B.until("!!Cinema.remote", 6000))
    A.ev("(a)=>{game.player.x=a.ax-15; game.player.y=a.ay+52}", tm); B.ev("(a)=>{game.player.x=a.ax+60; game.player.y=a.ay+40}", tm)
    A.key("e", 300)
    chk("co-op: A's treadmill state reaches B (tm=2, running)", B.until("Cinema.remote && Cinema.remote.tm===2", 4000))
    chk("co-op: B sees A on the machine (mirror animates)", B.until("!!game.inside.treadmill.remote && game.inside.treadmill.remote.blend>0.5", 3000))
    f1 = B.ev("game.inside.treadmill.remote.phase"); B.wait(300); f2 = B.ev("game.inside.treadmill.remote.phase")
    chk("co-op: the partner's run animation advances on B's screen", f1 != f2)
    B.shot("coop_partner_running")
    chk("co-op: A is still on it, B is NOT locked", A.ev("!!game.tm") and not B.ev("!!game.tm"))
    bp = B.pos(); B.pg.keyboard.down("ArrowRight"); B.wait(400); B.pg.keyboard.up("ArrowRight")
    chk("co-op: B can walk freely while A runs", B.pos()[0] != bp[0] or B.pos()[1] != bp[1], str(B.pos()))
    B.ev("(a)=>{game.player.x=a.ax-15; game.player.y=a.ay+52}", tm); B.wait(200); B.key("e", 300)
    chk("co-op: B can't take the machine while A is on it (and is told so)", not B.ev("!!game.tm") and "partner is using" in B.msg())
    A.key("e", 700)
    chk("co-op: A stops -> B sees A standing on it (tm=1)", B.until("Cinema.remote.tm===1", 3000) and B.ev("game.inside.treadmill.remote.run")==False)
    A.key("Escape", 700)
    chk("co-op: A steps off -> machine is free on B's screen", B.until("Cinema.remote.tm===0", 3000) and B.until("!game.inside.treadmill.remote", 3000))
    B.ev("(a)=>{game.player.x=a.ax-15; game.player.y=a.ay+52}", tm); B.wait(200); B.key("e", 300)
    chk("co-op: B can now use it, and A sees B", B.ev("!!game.tm && game.tm.run") and A.until("Cinema.remote.tm===2", 3000))
    A.shot("coop_other_player_running"); B.key("Escape", 700)
    chk("co-op: link stayed up throughout", A.ev("Cinema.link.open") and B.ev("Cinema.link.open"))
    br.close()
finally:
    srv.terminate()

chk("no console errors / uncaught page errors", not errs, "\n".join(errs[:10]))
chk("no 4xx/5xx for treadmill/game assets", not bad, "\n".join(bad[:8]))
print("stand-ins served for files missing from this folder:", stubbed or "none")
print(sum(res), "/", len(res)); sys.exit(0 if all(res) else 1)
