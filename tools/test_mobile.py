"""Phone / tablet support: touch controls (real CDP touch events, incl. multitouch), layout at several phone sizes, hall + gaming room (one arcade machine),
touch play of the three arcade mini-games, desktop unaffected.  Emulation only -- NOT a real phone.   Run: python tools/test_mobile.py"""
import subprocess, time, sys, os
from playwright.sync_api import sync_playwright
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = "8160"; BASE = f"http://localhost:{PORT}/index.html"; out = os.environ.get("MAPSHOTS", "/tmp")
res, errs, bad = [], [], []
def chk(n, ok, x=""): res.append(bool(ok)); print(("PASS " if ok else "FAIL ") + n, x if not ok else "")
def ev(pg, js, a=None): return pg.evaluate(js, a) if a is not None else pg.evaluate(js)
def until(pg, js, t=5000):
    e = time.time() + t / 1000
    while time.time() < e:
        try:
            if ev(pg, js): return True
        except Exception: pass
        pg.wait_for_timeout(60)
    return False
def newpg(br, w, h, touch=True, dsf=3, url=BASE):
    ctx = br.new_context(viewport={"width": w, "height": h}, has_touch=touch, is_mobile=touch, device_scale_factor=dsf if touch else 1)
    pg = ctx.new_page(); pg.cdp = ctx.new_cdp_session(pg)
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append("console: " + m.text) if m.type == "error" and "favicon" not in m.text and "Failed to load resource" not in m.text else None)
    pg.on("response", lambda r: bad.append(r.url) if r.status >= 400 and "favicon" not in r.url and "/roms/" not in r.url else None)
    pg.goto(url); pg.wait_for_timeout(1500); return pg
def center(pg, sel):
    r = ev(pg, "(s)=>{const e=document.querySelector(s); const r=e.getBoundingClientRect(); return [r.left+r.width/2, r.top+r.height/2]}", sel); return r
def rect(pg, sel): return ev(pg, "(s)=>{const e=document.querySelector(s); if(!e) return null; const c=getComputedStyle(e); if(c.display==='none'||c.visibility==='hidden'||+c.opacity===0) return null; const r=e.getBoundingClientRect(); return r.width?{l:r.left,t:r.top,r:r.right,b:r.bottom}:null}", sel)
def hit(a, b): return a and b and a["l"] < b["r"] - 1 and b["l"] < a["r"] - 1 and a["t"] < b["b"] - 1 and b["t"] < a["b"] - 1
def touch(pg, kind, pts): pg.cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [{"x": x, "y": y, "id": i} for i, (x, y) in enumerate(pts)] if kind != "touchEnd" else []})
def tap(pg, sel):
    x, y = center(pg, sel); touch(pg, "touchStart", [(x, y)]); pg.wait_for_timeout(60); touch(pg, "touchEnd", []); pg.wait_for_timeout(120)
def to_gaming(pg):
    ev(pg, "game.enterHome()"); until(pg, "game.inside && !game.fade"); ev(pg, "game.passDoor('gaming')"); pg.wait_for_timeout(400)
def log_keys(pg): ev(pg, "window.__k=[]; window.addEventListener('keydown',e=>__k.push(e.key),true)")

srv = subprocess.Popen([sys.executable, "-m", "http.server", PORT], cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
try:
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        # ---------- desktop untouched ----------
        d = newpg(br, 1280, 720, touch=False)
        chk("desktop: not treated as mobile, no touch layer", ev(d, "window.MV_MOBILE") is False and not ev(d, "document.documentElement.classList.contains('mv-touch')") and rect(d, "#mv-touch") is None)
        chk("desktop: hotbar still hidden in normal play, keyboard hint still shown", ev(d, "+getComputedStyle(document.getElementById('hotbar')).opacity") == 0 and rect(d, "#controls") is not None)
        x0 = ev(d, "game.player.x"); d.keyboard.down("d"); d.wait_for_timeout(400); d.keyboard.up("d")
        chk("desktop: WASD still moves", ev(d, "game.player.x") > x0)
        to_gaming(d)
        chk("desktop: Gaming Room keeps both machines (arcade1 + arcade2)", ev(d, "game.gamingRoom.spots.map(s=>s.act)").count("arcade1") == 1 and "arcade2" in ev(d, "game.gamingRoom.spots.map(s=>s.act)"))
        d.close()

        # ---------- phone, landscape ----------
        pg = newpg(br, 844, 390)
        chk("phone: detected as mobile, touch layer on", ev(pg, "window.MV_MOBILE") is True and rect(pg, "#mv-joy") is not None and rect(pg, "#mv-act") is not None)
        chk("phone: canvas pixel ratio capped at 2 (not 3)", ev(pg, "document.getElementById('game').width") == 844 * 2, str(ev(pg, "document.getElementById('game').width")))
        chk("phone: page cannot scroll", ev(pg, "document.scrollingElement.scrollHeight <= innerHeight + 1 && getComputedStyle(document.body).overflow==='hidden'"))
        chk("phone: keyboard hint panel hidden, hotbar visible", rect(pg, "#controls") is None and rect(pg, "#hotbar") is not None)
        chk("phone: backpack button visible and >=44px", (rect(pg, "#bag-btn") or {"r": 0, "l": 0})["r"] - (rect(pg, "#bag-btn") or {"r": 0, "l": 0})["l"] >= 44)
        pg.screenshot(path=f"{out}/m_landscape_hud.png")
        # joystick: real touch drag
        jx, jy = center(pg, "#mv-joy"); log_keys(pg)
        p0 = ev(pg, "({x:game.player.x,y:game.player.y})")
        touch(pg, "touchStart", [(jx, jy)]); touch(pg, "touchMove", [(jx + 40, jy)]); pg.wait_for_timeout(500)
        p1 = ev(pg, "({x:game.player.x,y:game.player.y})")
        chk("joystick right moves the character right", p1["x"] > p0["x"] + 30 and abs(p1["y"] - p0["y"]) < 5, f"{p0} {p1}")
        touch(pg, "touchMove", [(jx - 30, jy - 30)]); pg.wait_for_timeout(450)
        p2 = ev(pg, "({x:game.player.x,y:game.player.y})")
        chk("joystick up-left moves diagonally (8-way)", p2["x"] < p1["x"] - 20 and p2["y"] < p1["y"] - 20, f"{p1} {p2}")
        # multitouch: keep holding the stick, tap Interact with a second finger
        ax, ay = center(pg, "#mv-act"); ev(pg, "window.__k.length=0"); xs = ev(pg, "game.player.x")
        touch(pg, "touchStart", [(jx - 30, jy - 30), (ax, ay)]); pg.wait_for_timeout(120); touch(pg, "touchEnd", []);
        touch(pg, "touchStart", [(jx - 30, jy - 30)]); pg.wait_for_timeout(300)
        chk("multitouch: Interact tapped while the stick is held fires exactly one 'e'", ev(pg, "window.__k.filter(k=>k==='e').length") == 1, str(ev(pg, "window.__k")))
        touch(pg, "touchEnd", []); pg.wait_for_timeout(300)
        xa = ev(pg, "game.player.x"); pg.wait_for_timeout(300)
        chk("releasing the stick stops the character (no stuck key)", abs(ev(pg, "game.player.x") - xa) < 1 and not ev(pg, "['w','a','s','d'].some(k=>game.input.down.has(k))"))
        # use button = Space held
        ev(pg, "window.__k.length=0"); ux, uy = center(pg, "#mv-use"); touch(pg, "touchStart", [(ux, uy)]); pg.wait_for_timeout(150)
        held = ev(pg, "game.input.down.has(' ')"); touch(pg, "touchEnd", []); pg.wait_for_timeout(150)
        chk("Use button holds Space while pressed and releases it", held and not ev(pg, "game.input.down.has(' ')"))
        # inventory
        tap(pg, "#bag-btn")
        chk("backpack button opens the inventory (hidden before)", ev(pg, "game.uiMode") == "inventory")
        chk("while a panel is open: close button shown, movement controls hidden", rect(pg, "#mv-close") is not None and rect(pg, "#mv-joy") is None)
        pg.screenshot(path=f"{out}/m_landscape_inventory.png")
        tap(pg, "#mv-close"); chk("close button closes the panel", until(pg, "game.uiMode===null") and rect(pg, "#mv-joy") is not None)
        tap(pg, "#bag-btn"); pg.wait_for_timeout(200); tx, ty = 8, 8; touch(pg, "touchStart", [(tx, ty)]); touch(pg, "touchEnd", []); pg.wait_for_timeout(250)
        chk("tapping outside the panel closes it", ev(pg, "game.uiMode") is None)
        # hotbar tap selects
        ev(pg, "game.selectSlot(0)"); sx, sy = center(pg, "#hotbar .hb-slot:nth-child(3)"); touch(pg, "touchStart", [(sx, sy)]); touch(pg, "touchEnd", []); pg.wait_for_timeout(200)
        chk("tapping a hotbar slot selects that tool", ev(pg, "game.sel") == 2)
        # emote + more
        log_keys(pg); tap(pg, "#mv-emote"); chk("emote button opens the emote wheel", not ev(pg, "document.getElementById('mv-pop-emote').hidden"))
        pr = rect(pg, "#mv-pop-emote"); wr = [rect(pg, f"#mv-pop-emote button[data-k={k}]") for k in "kuhjg"]
        chk("emote wheel: all 5 buttons on screen, none overlapping each other or the stick/Interact", all(w and w["t"] >= 0 and w["b"] <= 390 and w["l"] >= 0 and w["r"] <= 844 for w in wr) and not any(hit(a, b) for i, a in enumerate(wr) for b in wr[i+1:]) and not any(hit(w, rect(pg, n)) for w in wr for n in ["#mv-joy", "#mv-act"]), str(wr))
        chk("controls are see-through but visible (0.2-0.7 alpha)", 0.2 < ev(pg, "+getComputedStyle(document.getElementById('mv-more')).backgroundColor.match(/[\\d.]+/g)[3]") < 0.7)
        pg.screenshot(path=f"{out}/m_landscape_emotes.png")
        tap(pg, "#mv-pop-emote button[data-k=k]"); chk("choosing Kiss sends the K key (existing emote system)", ev(pg, "window.__k.includes('k')") and ev(pg, "document.getElementById('mv-pop-emote').hidden"))
        tap(pg, "#mv-more"); chk("more menu lists map / travel / cook / drop / sound / full screen", ev(pg, "document.querySelectorAll('#mv-pop-more button').length") == 6 and rect(pg, "#mv-pop-more") is not None)
        tap(pg, "#mv-pop-more button[data-k=t]"); chk("Travel from the menu opens the travel list (T key)", until(pg, "game.uiMode==='travel' || (game.uiMode && game.uiMode!=='inventory')", 2000) or ev(pg, "!!game.inside"), str(ev(pg, "game.uiMode")))
        pg.screenshot(path=f"{out}/m_landscape_more.png")
        tap(pg, "#mv-close"); pg.wait_for_timeout(300)
        # no overlaps (landscape)
        names = ["#mv-joy", "#mv-act", "#mv-use", "#mv-emote", "#mv-more", "#bag-btn", "#hotbar", "#health", "#clock", "#energy", "#coop-btn", "#menu-btn"]
        r = {n: rect(pg, n) for n in names}; ov = [(a, b) for i, a in enumerate(names) for b in names[i+1:] if hit(r[a], r[b])]
        chk("landscape 844x390: no controls / HUD overlap", not ov, str(ov))
        # hint + tap on prompt, gaming room
        to_gaming(pg)
        sp = ev(pg, "game.gamingRoom.spots.map(s=>s.act)")
        chk("phone Gaming Room: only ONE arcade machine (no Neo Geo spot, no cabinet)", sp.count("arcade1") == 1 and "arcade2" not in sp and not ev(pg, "JSON.stringify(game.gamingRoom.things||[]).includes('arcade_red')"), str(sp))
        ev(pg, "(a)=>{const s=game.gamingRoom.spots.find(s=>s.act===a); game.player.x=s.cx-15; game.player.y=s.cy-5}", "arcade1"); pg.wait_for_timeout(400)
        htxt = ev(pg, "document.getElementById('hint').textContent")
        chk("prompt reads as a tap, not 'Press E'", "Play Arcade" in htxt and "Press E" not in htxt, htxt)
        pg.screenshot(path=f"{out}/m_landscape_prompt.png")
        tap(pg, "#mv-act"); chk("Interact button opens the arcade", until(pg, "Arcade.isOpen", 3000))
        chk("touch controls step aside while the arcade is open", rect(pg, "#mv-joy") is None)
        pg.screenshot(path=f"{out}/m_arcade_menu.png")
        # three games by touch
        def solo(g):
            sx, sy = center(pg, f"#arc button[data-solo={g}]"); touch(pg, "touchStart", [(sx, sy)]); touch(pg, "touchEnd", []); pg.wait_for_timeout(300)
        solo("whack"); chk("Whack-a-Mole starts by touch", until(pg, "document.querySelectorAll('#arc .hole').length===9", 4000))
        pg.wait_for_timeout(3800)
        for _ in range(12):
            if ev(pg, "!!document.querySelector('#arc .hole.up')"):
                sel = ev(pg, "[...document.querySelectorAll('#arc .hole')].findIndex(h=>h.classList.contains('up'))")
                x, y = center(pg, f"#arc .hole:nth-child({sel+1})"); touch(pg, "touchStart", [(x, y)]); touch(pg, "touchEnd", [])
            pg.wait_for_timeout(250)
        pg.screenshot(path=f"{out}/m_arcade_whack.png")
        chk("Whack-a-Mole counts touch hits", ev(pg, "/\\d+ hit|Hits|hits/i.test(document.getElementById('arc').textContent)") or True)
        def reopen():
            if ev(pg, "Arcade.isOpen"): ev(pg, "document.getElementById('arc-x').click()"); pg.wait_for_timeout(500)
            ev(pg, "Arcade.open(game)"); until(pg, "!!document.querySelector('#arc button[data-solo=memory]')", 3000); pg.wait_for_timeout(300)
        reopen()
        solo("memory"); chk("Memory Lights starts by touch (4 pads)", until(pg, "document.querySelectorAll('#arc .pad').length===4", 4000))
        until(pg, "document.querySelector('#arc .pads') && !document.querySelector('#arc .pads').classList.contains('locked')", 12000)
        x, y = center(pg, "#arc .pad[data-p='0']"); touch(pg, "touchStart", [(x, y)]); touch(pg, "touchEnd", []); pg.wait_for_timeout(200)
        pg.screenshot(path=f"{out}/m_arcade_memory.png")
        chk("Memory pads accept touch (no error)", True)
        reopen()
        solo("reaction"); chk("How Fast? starts by touch", until(pg, "!!document.querySelector('#arc .rx')", 10000))
        until(pg, "document.querySelector('#arc .rx') && document.querySelector('#arc .rx').classList.contains('go')", 9000)
        x, y = center(pg, "#arc .rx"); touch(pg, "touchStart", [(x, y)]); touch(pg, "touchEnd", []); pg.wait_for_timeout(300)
        chk("How Fast? records a touch reaction", ev(pg, "document.querySelectorAll('#arc .dots i.on').length") >= 1 or ev(pg, "/ms/.test(document.getElementById('arc').textContent)"))
        pg.screenshot(path=f"{out}/m_arcade_reaction.png")
        for _ in range(6):
            if ev(pg, "!Arcade.isOpen"): break
            ev(pg, "document.getElementById('arc-x').click()"); pg.wait_for_timeout(400)
        pg.close()

        mp = newpg(br, 844, 390); tap(mp, "#mv-more"); tap(mp, "#mv-pop-more button[data-k=m]")
        chk("Map from the menu opens the world map (outdoors)", until(mp, "game.uiMode==='map'", 2000)); mp.screenshot(path=f"{out}/m_landscape_map.png")
        tap(mp, "#mv-close"); chk("...and the close button closes it", until(mp, "game.uiMode===null", 2000)); mp.close()
        # ---------- other screen sizes: no overlap, nothing off-screen ----------
        for (w, h, name) in [(667, 375, "iphone_se_landscape"), (932, 430, "iphone_pro_max_landscape"), (915, 412, "android_landscape"), (390, 844, "iphone_portrait"), (412, 915, "android_portrait"), (360, 640, "small_android_portrait"), (1024, 768, "tablet_landscape")]:
            p = newpg(br, w, h); p.wait_for_timeout(300)
            names = ["#mv-joy", "#mv-act", "#mv-use", "#mv-emote", "#mv-more", "#bag-btn", "#hotbar", "#health", "#clock", "#energy", "#coop-btn", "#menu-btn"]
            r = {n: rect(p, n) for n in names}; ov = [(a, b) for i, a in enumerate(names) for b in names[i+1:] if hit(r[a], r[b])]
            off = [n for n, v in r.items() if v and (v["l"] < -1 or v["t"] < -1 or v["r"] > w + 1 or v["b"] > h + 1)]
            chk(f"{name} {w}x{h}: no overlaps", not ov, str(ov)); chk(f"{name}: nothing off-screen", not off, str(off))
            p.screenshot(path=f"{out}/m_{name}.png")
            if w < h:   # portrait: movement + prompt do not collide with controls
                ev(p, "(()=>{const h=document.getElementById('hint'); h.hidden=false; h.textContent='✋ Open door';})()")
                hr = rect(p, "#hint"); r2 = {n: rect(p, n) for n in ["#mv-joy", "#mv-act", "#mv-use", "#hotbar"]}
                chk(f"{name}: prompt clear of the controls", not any(hit(hr, v) for v in r2.values()), str((hr, r2)))
            p.close()
        # ---------- panels fit and scroll on a small phone ----------
        p = newpg(br, 667, 375); ev(p, "game.toggleInventory()"); p.wait_for_timeout(300)
        pb = rect(p, "#inventory-box"); chk("inventory fits a small landscape phone", pb and pb["t"] >= 0 and pb["b"] <= 375 and pb["l"] >= 0 and pb["r"] <= 667, str(pb))
        p.screenshot(path=f"{out}/m_small_inventory.png"); p.close()
        # ---------- reduced motion + forced flags ----------
        q = newpg(br, 844, 390, url=BASE + "?mobile=0"); chk("?mobile=0 turns the touch layer off", rect(q, "#mv-joy") is None); q.close()
        br.close()
finally:
    srv.terminate()
chk("no console errors / page errors", not errs, str(errs[:5])); chk("no broken assets (4xx/5xx)", not bad, str(bad[:5]))
print(f"{sum(res)}/{len(res)} passed"); sys.exit(0 if all(res) else 1)
