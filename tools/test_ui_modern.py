"""Modern UI layer: inventory (I), health, toast/day banner, prompts, panels, co-op button + code panel, desktop + phone layouts, console errors, overlaps.
Run: python tools/test_ui_modern.py   (screenshots go to $MAPSHOTS)"""
import subprocess, time, sys, os
from playwright.sync_api import sync_playwright
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = "8150"; URL = f"http://localhost:{PORT}/index.html"; out = os.environ.get("MAPSHOTS", "/tmp")
res, errs, bad = [], [], []
def chk(n, ok, x=""): res.append(bool(ok)); print(("PASS " if ok else "FAIL ") + n, x if not ok else "")
def ev(pg, js, a=None): return pg.evaluate(js, a) if a is not None else pg.evaluate(js)
def until(pg, js, t=5000):
    e = time.time() + t / 1000
    while time.time() < e:
        try:
            if ev(pg, js): return True
        except Exception: pass
        pg.wait_for_timeout(80)
    return False
def newpg(br, w, h, touch=False):
    ctx = br.new_context(viewport={"width": w, "height": h}, has_touch=touch, is_mobile=touch)
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append("console: " + m.text) if m.type == "error" and "favicon" not in m.text and "Failed to load resource" not in m.text else None)
    pg.on("response", lambda r: bad.append(r.url) if r.status >= 400 and "favicon" not in r.url and "/roms/" not in r.url else None)
    pg.goto(URL); pg.wait_for_timeout(1500); return pg
def rect(pg, sel): return ev(pg, "(s)=>{const e=document.querySelector(s); if(!e) return null; const c=getComputedStyle(e); if(c.display==='none'||c.visibility==='hidden') return null; const r=e.getBoundingClientRect(); return r.width? {l:r.left,t:r.top,r:r.right,b:r.bottom}:null}", sel)
def hit(a, b): return a and b and a["l"] < b["r"] and b["l"] < a["r"] and a["t"] < b["b"] and b["t"] < a["b"]
def css(pg, sel, prop): return ev(pg, "([s,p])=>getComputedStyle(document.querySelector(s))[p]", [sel, prop])

srv = subprocess.Popen([sys.executable, "-m", "http.server", PORT], cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
try:
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        pg = newpg(br, 1280, 720)
        chk("modern stylesheet is applied (tokens present)", ev(pg, "getComputedStyle(document.documentElement).getPropertyValue('--m-ink').trim()") == "#2b2a28")
        chk("no wooden look left on HUD plates (clock is warm glass, not oak)", "250, 247, 242" in css(pg, "#clock", "backgroundColor"), css(pg, "#clock", "backgroundColor"))
        chk("hotbar hidden during normal play", css(pg, "#hotbar", "opacity") == "0")
        chk("bag button hidden on desktop", css(pg, "#bag-btn", "display") == "none")
        pg.screenshot(path=f"{out}/ui_desktop_hud.png")
        # health
        ev(pg, "game.player.hp=40"); pg.wait_for_timeout(600)
        txt = ev(pg, "document.getElementById('health-text').textContent"); w = ev(pg, "document.getElementById('health-fill').style.width")
        chk("health display follows game.health", "40" in txt, f"{txt} {w}")
        pg.screenshot(path=f"{out}/ui_health_low.png")
        ev(pg, "game.player.hp=game.player.maxHp"); pg.wait_for_timeout(300)
        # inventory
        pg.keyboard.press("i"); pg.wait_for_timeout(350)
        chk("I opens the inventory", ev(pg, "game.uiMode")=="inventory" and not ev(pg, "document.getElementById('inventory-box').hidden"))
        chk("inventory panel is modern paper surface", "250, 247, 242" in css(pg, "#inventory-box", "backgroundColor"), css(pg, "#inventory-box", "backgroundColor"))
        chk("inventory still has items", ev(pg, "document.querySelectorAll('#inv-grid .inv-slot.filled').length") >= 3)
        pg.screenshot(path=f"{out}/ui_inventory.png")
        pg.keyboard.press("i"); pg.wait_for_timeout(200)
        chk("I closes it again", ev(pg, "game.uiMode") is None)
        pg.keyboard.press("3"); pg.wait_for_timeout(300)
        chk("hotbar peeks on tool change", css(pg, "#hotbar", "opacity") == "1")
        pg.screenshot(path=f"{out}/ui_hotbar.png"); pg.keyboard.press("1")
        # toast / day banner
        ev(pg, "game.showMessage('Good morning — a new day begins')"); pg.wait_for_timeout(450)
        chk("toast/day banner shows", css(pg, "#toast", "opacity") == "1" and "Good morning" in ev(pg, "document.getElementById('toast').textContent"))
        pg.screenshot(path=f"{out}/ui_toast.png")
        # sleep/day logic untouched: dawn message trigger exists
        chk("day progression API untouched", ev(pg, "typeof game.showMessage==='function' && typeof game.toggleInventory==='function'"))
        # interaction prompt
        ev(pg, "(()=>{const h=document.getElementById('hint'); h.hidden=false; h.textContent='E  Talk';})()"); pg.wait_for_timeout(300)
        pg.screenshot(path=f"{out}/ui_prompt.png")
        chk("prompt is a pill with ink text", css(pg, "#hint", "borderRadius") != "0px")
        ev(pg, "document.getElementById('hint').hidden=true")
        # panels: cooking, confirm, dialog, gameover
        ev(pg, "game.openCooking && game.openCooking()"); pg.wait_for_timeout(300); pg.screenshot(path=f"{out}/ui_cook.png")
        pg.keyboard.press("Escape"); pg.wait_for_timeout(200)
        ev(pg, "document.getElementById('confirm').hidden=false"); pg.wait_for_timeout(300); pg.screenshot(path=f"{out}/ui_confirm.png"); ev(pg, "document.getElementById('confirm').hidden=true")
        ev(pg, "(()=>{const d=document.getElementById('dialog'); d.hidden=false; d.querySelector('.dlg-name').textContent='Aisha'; d.querySelector('.dlg-text').textContent='Shall we watch a film tonight?'; d.querySelector('.dlg-foot').textContent='E to continue';})()"); pg.wait_for_timeout(300)
        pg.screenshot(path=f"{out}/ui_dialog.png"); ev(pg, "document.getElementById('dialog').hidden=true")
        ev(pg, "document.getElementById('gameover').hidden=false"); pg.wait_for_timeout(300); pg.screenshot(path=f"{out}/ui_gameover.png"); ev(pg, "document.getElementById('gameover').hidden=true")
        # co-op button + code panel
        chk("co-op button exists and is modern", ev(pg, "!!document.getElementById('coop-btn')"))
        ev(pg, "document.getElementById('coop-btn').click()"); pg.wait_for_timeout(400)
        chk("co-op panel opens", ev(pg, "!!document.getElementById('coop-panel') && getComputedStyle(document.getElementById('coop-panel')).display!=='none'"))
        pg.screenshot(path=f"{out}/ui_coop_panel.png")
        try:
            pg.click("#coop-host", timeout=2000); until(pg, "(document.getElementById('coop-offer')||{}).value", 15000); pg.screenshot(path=f"{out}/ui_coop_host.png")
            code = ev(pg, "(document.getElementById('coop-offer')||{}).value||''")
            chk("invite code is generated (format intact)", code.startswith("MV"), code[:20])
        except Exception as e: chk("host flow reachable", False, str(e)[:120])
        # overlaps desktop
        hud = {s: rect(pg, s) for s in ["#health", "#clock", "#menu-btn", "#coop-btn", "#energy"]}
        chk("desktop: health / clock / menu / co-op / energy do not overlap",
            not any(hit(hud[a], hud[b]) for a in hud for b in hud if a < b), str(hud))
        pg.close()
        # phone
        ph = newpg(br, 390, 780, touch=True)
        chk("phone: bag button visible and >=44px", (rect(ph, "#bag-btn") or {"r":0,"l":0,"b":0,"t":0}) and (rect(ph, "#bag-btn")["r"]-rect(ph, "#bag-btn")["l"]) >= 44)
        ph.screenshot(path=f"{out}/ui_phone_hud.png")
        ev(ph, "document.getElementById('bag-btn').click()"); ph.wait_for_timeout(350)
        chk("phone: bag button opens inventory", ev(ph, "game.uiMode")=="inventory"); ph.screenshot(path=f"{out}/ui_phone_inventory.png")
        ev(ph, "game.toggleInventory()"); ph.wait_for_timeout(200)
        ev(ph, "game.showMessage('Good morning')"); ph.wait_for_timeout(450); ph.screenshot(path=f"{out}/ui_phone_toast.png")
        ev(ph, "(()=>{const h=document.getElementById('hint'); h.hidden=false; h.textContent='Tap E — Open door';})()"); ph.wait_for_timeout(300)
        pr = {s: rect(ph, s) for s in ["#health", "#clock", "#bag-btn", "#hint", "#energy", "#menu-btn", "#coop-btn"]}
        names = list(pr)
        ov = [(a, b) for i, a in enumerate(names) for b in names[i+1:] if hit(pr[a], pr[b])]
        chk("phone: no HUD overlaps", not ov, str(ov) + str(pr))
        chk("phone: nothing past the screen edge", all(r["l"] >= -1 and r["r"] <= 391 for r in pr.values() if r), str(pr))
        ph.screenshot(path=f"{out}/ui_phone_prompt.png")
        # reduced motion
        ctx = br.new_context(viewport={"width": 900, "height": 600}, reduced_motion="reduce"); rm = ctx.new_page(); rm.goto(URL); rm.wait_for_timeout(1200)
        chk("reduced motion: no transition on the toast", css(rm, "#toast", "transitionDuration") in ("0s", "0s, 0s", "0s, 0s, 0s"), css(rm, "#toast", "transitionDuration"))
        br.close()
finally:
    srv.terminate()
real = [e for e in errs if "Failed to load" not in e]
chk("no console errors / page errors", not real, str(real[:5])); chk("no broken assets (4xx/5xx)", not bad, str(bad[:5]))
print(f"{sum(res)}/{len(res)} passed"); sys.exit(0 if all(res) else 1)
