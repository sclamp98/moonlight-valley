"""(copy of the cinema harness) Co-op cinema integration test: TWO real browser contexts joined by a REAL WebRTC data channel (the same
invite/reply flow players use). Only the YouTube player is replaced by tools/cinema_fake_yt.js, because the CI
sandbox can't reach youtube.com; everything else (link, session, sync, UI, game) is the shipped code.
Run: python tools/test_cinema.py        (MAPSHOTS=<dir> to choose where screenshots go)"""
import subprocess, time, sys, os
from playwright.sync_api import sync_playwright

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = "8133"
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
bad = []

WBOT = """(p)=>{ window.__wp=p; if(window.__wb) return; window.__wb=setInterval(()=>{ if(Math.random()<window.__wp){ const b=document.querySelector('#arc .hole.up'); if(b) b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true})); } },25); }"""
MBOT = """(failLevel)=>{ window.__fl=failLevel; window.__busy=false; if(window.__mb) return; window.__mb=setInterval(()=>{ const st=Arcade._state(); if(!st.run||st.run.game!=='memory'||st.run.dead||st.run.waiting) return; const s=document.getElementById('m-st'); if(!s||!/Your turn/.test(s.textContent)||window.__busy) return;
  const level=+document.getElementById('m-l').textContent, seq=ArcadeCore.memorySequence(st.run.seed, ArcadeCore.memoryLen(level)), pads=document.querySelectorAll('#arc .pad'); window.__busy=true; let i=0;
  const hit=(p)=>pads[p].dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true}));
  const step=()=>{ if(level>=window.__fl){ hit((seq[0]+1)%4); setTimeout(()=>{window.__busy=false},800); return; } hit(seq[i]); i++; if(i<seq.length) setTimeout(step,110); else setTimeout(()=>{window.__busy=false},250); };
  step(); },80); }"""
RBOT = """(ms)=>{ window.__rt=ms; if(window.__rb) return; window.__armed=false; window.__rb=setInterval(()=>{ const rx=document.querySelector('#arc .rx'); if(!rx||window.__rt<0&&!window.__early) return; const go=rx.classList.contains('go');
  if(window.__early && /Wait/.test(rx.textContent)){ window.__early=false; rx.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true})); }
  if(window.__rt>=0){ if(go&&!window.__armed){ window.__armed=true; setTimeout(()=>rx.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true})), window.__rt); } if(!go) window.__armed=false; } },4); }"""

def open_machine(w):
    w.ev("(()=>{const s=game.gamingRoom.spots.find(s=>s.act==='arcade1'); game.player.x=s.cx-15; game.player.y=s.cy-5})()"); w.wait(350)
    w.key("e"); return w.until("Arcade.isOpen", 4000)
def stt(w): return w.ev("(()=>{const s=Arcade._state(); return {open:s.open, m:s.match&&{g:s.match.game,seed:s.match.seed,phase:s.match.phase,n:s.match.n,first:s.match.first,p1:s.match.p1,verdict:s.match.verdict,my:s.match.myRes,peer:s.match.peerRes,away:s.match.away,live:s.match.live,void:s.match.voidWhy}, run:s.run}})()")
def txt(w, sel): return w.ev("(s)=>{const e=document.querySelector(s); return e?e.textContent:null}", sel)
def chips(w): return w.ev("[...document.querySelectorAll('#arc-board .chip')].map(c=>({t:c.textContent, lead:c.classList.contains('lead'), away:c.classList.contains('away')}))")
def start_vs(A, B, game, short=True):
    for w in (A, B):
        if short: w.ev("ArcadeCore.WHACK.MS = 8000")
        w.ev("Arcade.cfg.awayMs = 3000")
    if not A.ev("Arcade.isOpen"): open_machine(A)
    A.until("!!document.querySelector('[data-vs=%s]') && !document.querySelector('[data-vs=%s]').disabled" % (game, game), 5000)
    A.pg.click("[data-vs=%s]" % game)
    ok = B.until("(()=>{const i=document.getElementById('arc-invite'); return !!i && !i.hidden})()", 5000)
    return ok
def wall_start(w): return w.ev("(()=>{const r=Arcade._state().run; return r? Date.now() + (r.startPerf - performance.now()) : null})()")
def shutdown_bots(w): w.ev("(()=>{for(const k of ['__wb','__mb','__rb']){ if(window[k]){clearInterval(window[k]); window[k]=null;} } window.__busy=false; window.__early=false;})()")

try:
    with sync_playwright() as pw:
        br = pw.chromium.launch(args=["--disable-features=WebRtcHideLocalIpsWithMdns"])
        A = P(br, "Ana", "female", "A"); B = P(br, "Ben", "male", "B")
        for w in (A, B): w.pg.on("response", lambda r: bad.append(r.url) if r.status >= 400 else None)
        for w in (A, B): w.ev("game.enterHome()"); w.until("game.inside && !game.fade", 5000)
        chk("Arcade module is loaded on both sides", A.ev("typeof Arcade==='object' && typeof ArcadeCore==='object'") and B.ev("typeof Arcade==='object'"))
        A.ev("game.passDoor('gaming')"); A.wait(500)
        ok, _, _ = connect(A, B); chk("real co-op link opens between the two browsers", ok)
        B.ev("game.passDoor('gaming')"); chk("both players are in the Gaming Room (each sees the other there)", A.until("Cinema.remote && Cinema.remote.where==='gaming'", 6000) and B.until("Cinema.remote && Cinema.remote.where==='gaming'", 6000))
        # ---------- opening the machine, solo screens, controls frozen ----------
        A.ev("(()=>{const s=game.gamingRoom.spots.find(s=>s.act==='arcade1'); game.player.x=s.cx-15; game.player.y=s.cy-5})()"); A.wait(350)
        chk("walking up to the blue cabinet offers 'Play Arcade'", "Play Arcade" in txt(A, "#hint"), txt(A, "#hint"))
        A.key("e"); chk("E opens the arcade menu", A.until("Arcade.isOpen", 3000) and A.ev("document.querySelectorAll('#arc .gcard').length")==3)
        chk("menu lists all three games with high-score lines", all(n in txt(A, "#arc-menu") for n in ("Whack-a-Mole", "Memory Lights", "How Fast?")))
        p0 = A.ev("({x:game.player.x,y:game.player.y,hp:game.sel})")
        for k in ["w","a","s","d","ArrowUp","ArrowLeft","1","2","i","c","q"]: A.pg.keyboard.press(k)
        A.wait(250)
        p1 = A.ev("({x:game.player.x,y:game.player.y,hp:game.sel,ui:game.uiMode})")
        chk("keyboard is the machine's: the farmer does not move, hotbar/inventory keys do nothing", p0["x"]==p1["x"] and p0["y"]==p1["y"] and p0["hp"]==p1["hp"] and not p1["ui"], str((p0,p1)))
        chk("'vs Ben' buttons are offered and enabled while Ben is in the Gaming Room", A.ev("[...document.querySelectorAll('[data-vs]')].length")==3 and not A.ev("document.querySelector('[data-vs=whack]').disabled"))
        # Ben leaves the room: vs disabled
        B.ev("game.passDoor('gamingBack')"); A.until("Cinema.remote && Cinema.remote.where==='home'", 5000); A.ev("Arcade._state()"); 
        A.ev("(()=>{document.querySelector('#arc-x').click()})()"); open_machine(A)
        chk("with Ben elsewhere the challenge buttons are disabled and the menu says so", A.ev("document.querySelector('[data-vs=whack]').disabled") and "isn't in the Gaming Room" in txt(A, "#arc-note"), txt(A, "#arc-note"))
        B.ev("game.passDoor('gaming')"); A.until("Cinema.remote && Cinema.remote.where==='gaming'", 5000)
        A.ev("document.querySelector('#arc-x').click()"); A.wait(200)
        chk("Exit returns to the Gaming Room with controls back", not A.ev("Arcade.isOpen") and not A.ev("document.body.classList.contains('arc-open')"))
        A.pg.keyboard.down("d"); A.wait(300); A.pg.keyboard.up("d"); chk("farmer walks again after leaving the machine", A.ev("game.player.x") != p1["x"])
        open_machine(A); A.ev("(()=>{const s=document.querySelector('#arc-x'); s.click()})()")
        # ---------- decline / cancel ----------
        chk("challenge shows an invitation banner on Ben's screen (he is NOT at the machine)", start_vs(A, B, "whack"))
        chk("invitation names the challenger and the game", "Ana" in txt(B, "#arc-invite span") and "Whack-a-Mole" in txt(B, "#arc-invite span"), txt(B, "#arc-invite span"))
        chk("challenger sees a waiting dialog", A.ev("!document.getElementById('arc-wait').hidden"))
        B.key("n")
        chk("Ben pressing N declines: Ana is told and gets her menu back", A.until("document.getElementById('arc-wait').hidden && /declined/.test(document.getElementById('arc-note').textContent)", 5000), txt(A, "#arc-note"))
        chk("banner is gone after declining", B.ev("document.getElementById('arc-invite').hidden"))
        A.pg.click("[data-vs=whack]"); B.until("!document.getElementById('arc-invite').hidden", 4000)
        A.pg.click("#arc-wait button")
        chk("challenger cancelling removes Ben's banner", B.until("document.getElementById('arc-invite').hidden", 4000))
        # ---------- M1: Whack-a-Mole, real 30 s round: Ana hits everything, Ben hits nothing ----------
        for w in (A, B): w.ev("ArcadeCore.WHACK.MS = 30000")
        A.pg.click("[data-vs=whack]"); B.until("!document.getElementById('arc-invite').hidden", 4000)
        B.pg.click("#arc-invite [data-y]")
        chk("both screens leave the menu and start the SAME game", A.until("(Arcade._state().run||{}).game==='whack'", 5000) and B.until("(Arcade._state().run||{}).game==='whack'", 5000))
        sa, sb = stt(A), stt(B)
        chk("same seed on both screens (same moles for both players)", sa["m"]["seed"] == sb["m"]["seed"] and sa["m"]["seed"] > 0)
        wa, wb = wall_start(A), wall_start(B)
        chk("countdown ends at the same moment on both (within 300 ms)", wa and wb and abs(wa - wb) < 300, "%s vs %s" % (wa, wb))
        chk("both boards show both names, P1 / P2", all(("Ana" in t and "Ben" in t) for t in [" ".join(c["t"] for c in chips(A)), " ".join(c["t"] for c in chips(B))]) and "P1" in txt(A, "#arc-board") and "P2" in txt(A, "#arc-board"), str(chips(A)))
        A.ev(WBOT, 1.0); B.ev(WBOT, 0.0)
        A.wait(9000)
        ca, cb = chips(A), chips(B)
        chk("live scoreboard: Ana leads on BOTH screens and is marked 'Leading'", ca[0]["lead"] and cb[1]["lead"] and not ca[1]["lead"] and not cb[0]["lead"] and "Leading" in ca[0]["t"] and "1st" in ca[0]["t"] and "2nd" in ca[1]["t"], str((ca, cb)))
        import re
        na = int(re.search(r"(\d+) hit", ca[0]["t"]).group(1)); nb_view = int(re.search(r"(\d+) hit", cb[1]["t"]).group(1))
        chk("Ben's view of Ana's score matches Ana's own score (live sync)", abs(na - nb_view) <= 1 and na >= 3, "%s vs %s" % (na, nb_view))
        A.shot("arc_whack_board_A"); B.shot("arc_whack_board_B")
        chk("round ends and both get results", A.until("(Arcade._state().match||{}).phase==='done'", 30000) and B.until("(Arcade._state().match||{}).phase==='done'", 30000))
        ra, rb = stt(A)["m"], stt(B)["m"]
        chk("both sides computed the same winner", ra["verdict"] == "a" and rb["verdict"] == "b", str((ra["verdict"], rb["verdict"])))
        chk("scores are attached to the right player on both screens", ra["my"]["h"] == rb["peer"]["h"] and ra["peer"]["h"] == rb["my"]["h"] == 0 and ra["my"]["h"] > 10, str((ra["my"], rb["peer"])))
        chk("Ana sees YOU WIN!, Ben sees YOU LOSE!", txt(A, "#arc-banner") == "YOU WIN!" and txt(B, "#arc-banner") == "YOU LOSE!", str((txt(A, "#arc-banner"), txt(B, "#arc-banner"))))
        chk("both name the same winner (Ana) and mark the card WINNER!", "Ana" in txt(A, "#arc-winner") and "Ana" in txt(B, "#arc-winner") and txt(A, ".pc.winner .nm").startswith("Ana") and txt(B, ".pc.winner .nm").startswith("Ana") and txt(A, ".pc.winner .tag") == "WINNER!")
        chk("result screen shows both players' scores, avatars and Play Again / Return buttons", A.ev("document.querySelectorAll('#arc-res .pc').length")==2 and A.ev("document.querySelectorAll('#arc-res .pc canvas').length")==2 and A.ev("!!document.querySelector('#arc-res [data-act=again]') && !!document.querySelector('#arc-res [data-act=leave]')"))
        A.shot("arc_winner_A"); B.shot("arc_loser_B")
        # ---------- rematch needs both to agree; then a DRAW ----------
        for w in (A, B): w.ev("ArcadeCore.WHACK.MS = 8000")
        shutdown_bots(A); shutdown_bots(B)
        seed1 = stt(A)["m"]["seed"]
        A.pg.click("#arc-res [data-act=again]"); A.wait(500)
        chk("one player pressing Play Again waits for the other (no auto-start)", A.ev("!document.querySelector('#arc-res [data-act=again]').disabled === false") and "Waiting for Ben" in txt(A, "#arc-res .info") and stt(B)["m"]["phase"] == "done" and "wants a rematch" in txt(B, "#arc-res .info"), txt(A, "#arc-res .info"))
        B.pg.click("#arc-res [data-act=again]")
        chk("both agreeing starts a new round with a NEW seed", A.until("(Arcade._state().run||{}).game==='whack'", 6000) and B.until("(Arcade._state().run||{}).game==='whack'", 6000) and stt(A)["m"]["seed"] != seed1 and stt(A)["m"]["seed"] == stt(B)["m"]["seed"])
        A.ev(WBOT, 1.0); B.ev(WBOT, 1.0)
        chk("round 2 completes", A.until("(Arcade._state().match||{}).phase==='done'", 20000) and B.until("(Arcade._state().match||{}).phase==='done'", 20000))
        ra, rb = stt(A)["m"], stt(B)["m"]
        chk("both hit every mole -> equal scores -> DRAW! on both screens", ra["verdict"] == "draw" and rb["verdict"] == "draw" and txt(A, "#arc-banner") == "DRAW!" and txt(B, "#arc-banner") == "DRAW!" and ra["my"]["h"] == ra["peer"]["h"], str((ra["my"], ra["peer"])))
        chk("a draw has no WINNER! card", A.ev("document.querySelectorAll('#arc-res .pc.winner').length")==0)
        shutdown_bots(A); shutdown_bots(B)
        A.pg.click("#arc-res [data-act=leave]")
        chk("Return to Gaming Room closes the machine for me and tells Ben", not A.ev("Arcade.isOpen") and B.until("/left the machine/.test(document.querySelector('#arc-res .info').textContent) && document.querySelector('#arc-res [data-act=again]').disabled", 4000))
        B.pg.click("#arc-res [data-act=leave]")
        # ---------- M2: Memory Lights, turn based, same sequence ----------
        chk("memory: invitation", start_vs(A, B, "memory", short=False))
        B.key("y")
        chk("memory: Ben accepted with the Y key, both screens in the game", A.until("(Arcade._state().run||{}).game==='memory'", 5000) and B.until("(Arcade._state().run||{}).game==='memory'", 5000))
        chk("memory: same seed", stt(A)["m"]["seed"] == stt(B)["m"]["seed"])
        chk("memory: the challenger plays first, the partner is told to wait", not stt(A)["run"]["waiting"] and stt(B)["run"]["waiting"] and "Ana is playing" in txt(B, "#m-st"), txt(B, "#m-st"))
        A.ev(MBOT, 3); B.ev(MBOT, 4)                       # Ana fails on level 3 (2 completed), Ben fails on level 4 (3 completed)
        chk("memory: Ben's screen follows Ana's live level and shows her leading", B.until("/Lv [12]/.test(document.getElementById('arc-board').textContent)", 20000))
        chk("memory: Ben's turn starts after Ana's result arrives", B.until("(Arcade._state().run||{}).waiting===false", 40000) and stt(B)["m"]["peer"] is not None)
        chk("memory: results", A.until("(Arcade._state().match||{}).phase==='done'", 90000) and B.until("(Arcade._state().match||{}).phase==='done'", 90000))
        ra, rb = stt(A)["m"], stt(B)["m"]
        chk("memory: highest level and score tracked per player", ra["my"]["lv"] == 2 and ra["my"]["score"] == 30 and ra["peer"]["lv"] == 3 and ra["peer"]["score"] == 60 and rb["my"]["lv"] == 3 and rb["peer"]["lv"] == 2, str((ra["my"], ra["peer"])))
        chk("memory: Ben wins on both screens (higher level)", ra["verdict"] == "b" and rb["verdict"] == "a" and txt(A, "#arc-banner") == "YOU LOSE!" and txt(B, "#arc-banner") == "YOU WIN!" and "Ben" in txt(A, "#arc-winner"))
        A.shot("arc_memory_result_A")
        shutdown_bots(A); shutdown_bots(B)
        first1 = stt(A)["m"]["first"]
        A.pg.click("#arc-res [data-act=again]"); B.pg.click("#arc-res [data-act=again]")
        chk("memory rematch: the other player now goes first (fair turn order)", A.until("(Arcade._state().run||{}).game==='memory'", 6000) and stt(A)["m"]["first"] != first1 and stt(A)["m"]["first"] == stt(B)["m"]["first"])
        A.ev(MBOT, 1); B.ev(MBOT, 1)                       # both fail immediately
        chk("memory rematch finishes", A.until("(Arcade._state().match||{}).phase==='done'", 40000) and B.until("(Arcade._state().match||{}).phase==='done'", 40000))
        ra, rb = stt(A)["m"], stt(B)["m"]
        chk("memory: same result for both (level 0) -> DRAW! on both screens", ra["verdict"] == "draw" and rb["verdict"] == "draw" and txt(A, "#arc-banner") == "DRAW!" and txt(B, "#arc-banner") == "DRAW!", str((ra["my"], ra["peer"])))
        shutdown_bots(A); shutdown_bots(B); A.pg.click("#arc-res [data-act=leave]"); B.pg.click("#arc-res [data-act=leave]")
        # ---------- M3: How Fast? ----------
        chk("reaction: invitation", start_vs(A, B, "reaction", short=False)); B.pg.click("#arc-invite [data-y]")
        chk("reaction: both screens in the game with the same seed", A.until("(Arcade._state().run||{}).game==='reaction'", 5000) and B.until("(Arcade._state().run||{}).game==='reaction'", 5000) and stt(A)["m"]["seed"] == stt(B)["m"]["seed"])
        wa, wb = wall_start(A), wall_start(B); chk("reaction: GO signals are on the same shared timeline (start within 300 ms)", abs(wa - wb) < 300, "%s %s" % (wa, wb))
        A.ev(RBOT, 200); B.ev("(()=>{window.__early=true})()"); B.ev(RBOT, 350)       # Ben also pushes early in round 1 (false start)
        chk("reaction: waiting signal then GO appears on both screens", A.until("document.querySelector('#arc .rx.go')!==null", 12000) and B.until("document.querySelector('#arc .rx.go')!==null", 12000))
        A.shot("arc_reaction_go_A")
        chk("reaction: round 1 result shown", A.until("Arcade._state().match.live.me && Arcade._state().match.live.me.r>=1", 12000))
        chk("reaction: live scoreboard shows both averages (lower is better)", B.until("/ms avg/.test(document.getElementById('arc-board').textContent)", 15000))
        chk("reaction: game over", A.until("(Arcade._state().match||{}).phase==='done'", 50000) and B.until("(Arcade._state().match||{}).phase==='done'", 50000))
        ra, rb = stt(A)["m"], stt(B)["m"]
        chk("reaction: Ben's round-1 false start is recorded as the 1000 ms penalty (flagged), Ana's round 1 is a real time", rb["my"]["f"][0] == 1 and rb["my"]["t"][0] == 1000 and ra["my"]["f"][0] == 0 and 100 <= ra["my"]["t"][0] < 600, str((ra["my"]["t"], rb["my"]["t"])))
        chk("reaction: times recorded independently in ms (Ana ~200, Ben ~350 on real rounds)", all(150 <= x <= 330 for x, f in zip(ra["my"]["t"], ra["my"]["f"]) if not f) and all(300 <= x <= 520 for x, f in zip(rb["my"]["t"][1:], rb["my"]["f"][1:]) if not f), str((ra["my"]["t"], rb["my"]["t"])))
        chk("reaction: each side holds the other's times unchanged", ra["peer"]["t"] == rb["my"]["t"] and rb["peer"]["t"] == ra["my"]["t"])
        chk("reaction: lower average (Ana) wins on both screens", ra["verdict"] == "a" and rb["verdict"] == "b" and txt(A, "#arc-banner") == "YOU WIN!" and txt(B, "#arc-banner") == "YOU LOSE!")
        A.shot("arc_reaction_result_A")
        shutdown_bots(A); shutdown_bots(B)
        A.pg.click("#arc-res [data-act=again]"); B.pg.click("#arc-res [data-act=again]")
        chk("reaction rematch starts", A.until("(Arcade._state().run||{}).game==='reaction'", 6000) and B.until("(Arcade._state().run||{}).game==='reaction'", 6000))
        chk("reaction: nobody presses -> every round is a miss for both -> equal -> DRAW!", A.until("(Arcade._state().match||{}).phase==='done'", 60000) and B.until("(Arcade._state().match||{}).phase==='done'", 60000) and stt(A)["m"]["verdict"] == "draw" and stt(B)["m"]["verdict"] == "draw" and all(x == 1000 for x in stt(A)["m"]["my"]["t"]))
        A.pg.click("#arc-res [data-act=leave]"); B.pg.click("#arc-res [data-act=leave]")
        # ---------- reliability: duplicate / invalid results, disconnects, leaving, reconnect ----------
        chk("reliability: new match", start_vs(A, B, "whack")); B.key("y"); A.until("(Arcade._state().run||{}).game==='whack'", 5000); B.until("(Arcade._state().run||{}).game==='whack'", 5000)
        m_id = stt(B)["m"]; mm = B.ev("Arcade._state().match.m")
        B.ev("(m)=>{Cinema.link.send('arc',{a:'rs',m:m,h:2}); Cinema.link.send('arc',{a:'rs',m:m,h:9});}", mm); A.wait(600)
        chk("duplicate result submission is ignored (first one counts)", stt(A)["m"]["peer"] and stt(A)["m"]["peer"]["h"] == 2, str(stt(A)["m"]["peer"]))
        A.ev(WBOT, 1.0)
        chk("a result from the wrong match id is ignored", (B.ev("(m)=>{Cinema.link.send('arc',{a:'sc',m:'zzz_9',s:5}); return 1}", mm), A.wait(300), stt(A)["m"]["live"]["peer"] is None or stt(A)["m"]["live"]["peer"]["s"] != 5)[2])
        A.until("(Arcade._state().match||{}).phase==='done'", 20000); B.wait(500)
        shutdown_bots(A); A.pg.click("#arc-res [data-act=leave]"); B.pg.click("#arc-res [data-act=leave]") if B.ev("Arcade.isOpen") else None
        chk("invalid result (more hits than moles) voids the match with a readable reason", start_vs(A, B, "whack")); B.key("y"); A.until("(Arcade._state().run||{}).game==='whack'", 5000); B.until("(Arcade._state().run||{}).game==='whack'", 5000)
        B.ev("(m)=>{Cinema.link.send('arc',{a:'rs',m:m,h:999});}", B.ev("Arcade._state().match.m")); A.wait(600)
        chk("...A is told the result wasn't valid and the match doesn't count", stt(A)["m"]["phase"] == "void" and "valid" in (stt(A)["m"]["void"] or ""), str(stt(A)["m"]))
        A.ev(WBOT, 1.0); A.until("!!document.getElementById('arc-void')", 45000)
        chk("...A finishes and sees NO CONTEST, not a fake winner", txt(A, "#arc-void") is not None and txt(A, "#arc-banner") is None, str((txt(A, "#arc-void"), txt(A, "#arc-banner"), stt(A)["m"])))
        A.pg.click("#arc-res [data-act=leave]"); B.pg.click("#arc-x")
        shutdown_bots(A); shutdown_bots(B)
        # disconnect mid-round
        chk("disconnect test: match starts", start_vs(A, B, "whack", short=False)); B.key("y"); A.until("(Arcade._state().run||{}).game==='whack'", 5000)
        A.ev(WBOT, 1.0); A.wait(7000); B.ev("Cinema.link.close()")
        chk("partner link drops: scoreboard marks Ben disconnected (not still competing)", A.until("document.querySelector('#arc-board .chip.away')!==null", 8000))
        chk("...after the grace period the match is voided with the reason", A.until("(Arcade._state().match||{}).phase==='void'", 10000) and "disconnected" in (stt(A)["m"]["void"] or ""), str(stt(A)["m"]["void"]))
        chk("...Ana can still finish her round and sees NO CONTEST (no winner announced)", A.until("(()=>{const e=document.getElementById('arc-void'); return !!e && /disconnected/.test(e.textContent) && !!(Arcade._state().match||{}).myRes})()", 45000) and txt(A, "#arc-banner") is None and "disconnected" in txt(A, "#arc-void"), str((txt(A, "#arc-void"), txt(A, "#arc-banner"), stt(A)["m"], A.ev("ArcadeCore.WHACK.MS"))))
        shutdown_bots(A)
        A.pg.click("#arc-res [data-act=leave]")
        br.close()
finally:
    srv.terminate()

chk("no uncaught page errors / console errors", not errs, "\n".join(errs[:8]))
chk("no 4xx/5xx responses (no broken asset paths)", not [u for u in bad if "favicon" not in u], "\n".join(bad[:8]))
print(sum(res), "/", len(res)); sys.exit(0 if all(res) else 1)
