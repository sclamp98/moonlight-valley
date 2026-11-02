"""Inventory visibility (I / Esc), the house-style HUD at desktop + phone sizes, and the Neo Geo cabinet (picker, ROM loading, errors, return).
The emulator itself (EmulatorJS) is replaced by a tiny stand-in page through NEOGEO_CONFIG.buildEmulatorHtml, because the sandbox cannot reach the emulator CDN
and has no ROMs.  That proves OUR side (cabinet, list, loading, errors, teardown, controls) -- it does NOT prove that a real Neo Geo game runs.
Run: python tools/test_hud_neogeo.py"""
import subprocess, time, sys, os, json
from playwright.sync_api import sync_playwright

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = "8134"; URL = f"http://localhost:{PORT}/index.html"
out = os.environ.get("MAPSHOTS", "/tmp")
res, errs, bad = [], [], []


def chk(name, ok, extra=""):
    res.append(bool(ok)); print(("PASS " if ok else "FAIL ") + name, extra if not ok else "")


MANIFEST = {"bios": "neogeo.zip", "games": [
    {"id": "alpha", "name": "Alpha Blaster", "file": "alpha.zip", "maker": "Test Co", "year": 1994},
    {"id": "ghost", "name": "Ghost Game", "file": "ghost.zip"},
    {"id": "hang", "name": "Hangs Forever", "file": "hang.zip"},
    {"id": "bad", "name": "Crashes", "file": "bad.zip"},
    {"id": "evil", "name": "Evil Path", "file": "../../etc/passwd.zip"},          # must be skipped
    {"name": "No File"},                                                          # must be skipped
]}
FAKE_CFG = """window.NEOGEO_CONFIG = { bootTimeoutMs: 2500, buildEmulatorHtml: function (o) {
  var mode = /hang/.test(o.url) ? 'hang' : /bad/.test(o.url) ? 'bad' : 'ok';
  return '<!doctype html><body style="background:#123;color:#fff"><div id=t>FAKE EMULATOR ' + o.name + ' bios=' + (o.bios||'none') + '</div><script>' +
    (mode === 'ok' ? 'setTimeout(function(){parent.postMessage({ngx:"started"},"*")},300);' : mode === 'bad' ? 'setTimeout(function(){parent.postMessage({ngx:"error",text:"core crashed"},"*")},300);' : '') + '<\\/script></body>'; } };"""


def new_page(br, vw=1280, vh=720, manifest=MANIFEST):
    ctx = br.new_context(viewport={"width": vw, "height": vh}, has_touch=vw < 500)
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append("console: " + m.text) if m.type == "error" and "favicon" not in m.text and "Failed to load resource" not in m.text else None)
    pg.on("response", lambda r: bad.append(r.url) if r.status >= 400 and "ghost.zip" not in r.url and "favicon" not in r.url else None)
    pg.add_init_script(FAKE_CFG)
    pg.route("**/roms/neogeo/games.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(manifest)))
    pg.route("**/roms/neogeo/*.zip", lambda r: r.fulfill(status=404, body="") if "ghost" in r.request.url else r.fulfill(status=200, content_type="application/zip", body=b"PK\x03\x04fake"))
    pg.goto(URL); pg.wait_for_timeout(1500)
    return pg


def ev(pg, js, arg=None): return pg.evaluate(js, arg) if arg is not None else pg.evaluate(js)
def until(pg, js, t=6000):
    e = time.time() + t / 1000
    while time.time() < e:
        try:
            if ev(pg, js): return True
        except Exception: pass
        pg.wait_for_timeout(80)
    return False
def key(pg, k, ms=120): pg.keyboard.press(k); pg.wait_for_timeout(ms)
def to_gaming(pg):
    ev(pg, "game.enterHome()"); until(pg, "game.inside && !game.fade"); ev(pg, "game.passDoor('gaming')"); pg.wait_for_timeout(300)
def at(pg, act):
    ev(pg, "(a)=>{const s=game.gamingRoom.spots.find(s=>s.act===a); game.player.x=s.cx-15; game.player.y=s.cy-5}", act); pg.wait_for_timeout(300)


srv = subprocess.Popen([sys.executable, "-m", "http.server", PORT], cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
try:
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        pg = new_page(br)
        # ================= inventory =================
        hb = ev(pg, "(()=>{const b=document.getElementById('hotbar'); const c=getComputedStyle(b); return {op:+c.opacity, pe:c.pointerEvents, peek:b.classList.contains('peek')}})()")
        chk("inventory (hotbar) is NOT on screen during normal play", hb["op"] == 0 and hb["pe"] == "none" and not hb["peek"], str(hb))
        chk("no backpack panel open at start", ev(pg, "game.uiMode") is None and ev(pg, "document.getElementById('inventory-box').hidden"))
        chk("the bag button is not shown on a desktop (keyboard) screen", ev(pg, "getComputedStyle(document.getElementById('bag-btn')).display") == "none")
        key(pg, "i"); chk("pressing I opens the inventory", ev(pg, "game.uiMode") == "inventory" and not ev(pg, "document.getElementById('inventory-box').hidden"))
        pg.screenshot(path=f"{out}/hud_inventory_open.png")
        chk("the inventory still lists the starter items (data untouched)", ev(pg, "game.inventory.slots.filter(Boolean).length") >= 6 and ev(pg, "document.querySelectorAll('#inv-grid .inv-slot, #inv-grid > *').length") > 0)
        key(pg, "i"); chk("pressing I again closes it", ev(pg, "game.uiMode") is None and ev(pg, "document.getElementById('inventory-box').hidden"))
        key(pg, "i"); key(pg, "Escape"); chk("Escape closes it too", ev(pg, "game.uiMode") is None)
        x0 = ev(pg, "game.player.x"); pg.keyboard.down("d"); pg.wait_for_timeout(400); pg.keyboard.up("d")
        chk("closing the inventory gives movement back", ev(pg, "game.player.x") != x0)
        key(pg, "3"); chk("number keys still select a tool", ev(pg, "game.sel") == 2)
        chk("...and the hotbar peeks in for a moment so you can see it", until(pg, "document.getElementById('hotbar').classList.contains('peek') && +getComputedStyle(document.getElementById('hotbar')).opacity > 0.9", 1500))
        pg.screenshot(path=f"{out}/hud_hotbar_peek.png")
        chk("...then hides again by itself", until(pg, "!document.getElementById('hotbar').classList.contains('peek')", 4000))
        key(pg, "1")
        # typing guard: chat box
        ev(pg, "(()=>{Cinema.ensure(game); Cinema.ui.openChat(); const i=document.getElementById('cin-chat-input'); i.disabled=false; i.focus();})()")
        pg.keyboard.type("hi i")
        chk("typing the letter i in a text field does not open the inventory", ev(pg, "game.uiMode") is None and "i" in ev(pg, "document.getElementById('cin-chat-input').value"), str(ev(pg, "game.uiMode")))
        ev(pg, "Cinema.ui.closeChat(); document.activeElement.blur()")
        # ================= gaming room: cabinets =================
        to_gaming(pg)
        at(pg, "arcade2")
        chk("red cabinet offers 'Play Arcade' and is a Neo Geo cabinet spot", "Play Arcade" in ev(pg, "document.getElementById('hint').textContent") and ev(pg, "game.nearestIn && game.nearestIn.name")== "Neo Geo cabinet")
        pg.screenshot(path=f"{out}/hud_prompt.png")
        chk("the cabinet is a solid object in the room", ev(pg, "game.gamingRoom.solids.length") > 8 and ev(pg, "game.gamingRoom.spots.some(s=>s.act==='arcade2') && game.gamingRoom.spots.some(s=>s.act==='arcade1')"))
        key(pg, "e")
        chk("E opens the Neo Geo selection screen", until(pg, "NeoGeo.isOpen && document.querySelectorAll('#ngx .game').length>0", 4000))
        names = ev(pg, "[...document.querySelectorAll('#ngx .game h3')].map(h=>h.textContent)")
        chk("games from games.json are listed; unsafe / incomplete entries are skipped", names == ["Alpha Blaster", "Ghost Game", "Hangs Forever", "Crashes"], str(names))
        chk("names and details shown", "Test Co" in ev(pg, "document.getElementById('ngx').textContent"))
        pg.screenshot(path=f"{out}/neogeo_list.png")
        p0 = ev(pg, "({x:game.player.x,y:game.player.y,s:game.sel})")
        for k in ["w", "a", "s", "d", "ArrowUp", "2", "i", "c", "q"]: pg.keyboard.press(k)
        pg.wait_for_timeout(250)
        chk("the cabinet owns the keyboard: no walking, no hotbar, no inventory", ev(pg, "game.player.x")==p0["x"] and ev(pg, "game.player.y")==p0["y"] and ev(pg, "game.sel")==p0["s"] and ev(pg, "game.uiMode") is None)
        # installed game starts
        pg.click("#ngx .game[data-id=alpha] button")
        chk("Play on an installed game starts the emulator frame", until(pg, "!!document.querySelector('#ngx iframe') && NeoGeo._state().session && NeoGeo._state().session.done", 5000))
        frame_text = ev(pg, "document.querySelector('#ngx iframe').srcdoc")
        chk("the emulator runs in a sandboxed iframe (can be thrown away) and was given the game + the BIOS from the manifest", "Alpha Blaster" in frame_text and "neogeo.zip" in frame_text and ev(pg, "document.querySelector('#ngx iframe').getAttribute('sandbox')") is not None)
        pg.screenshot(path=f"{out}/neogeo_playing.png")
        pg.click("#ngx-x")
        chk("◀ Games returns to the list and removes the emulator completely", until(pg, "!document.querySelector('#ngx iframe') && document.querySelectorAll('#ngx .game').length>0 && NeoGeo.isOpen", 3000) and ev(pg, "NeoGeo._state().session") is None)
        # missing rom
        pg.click("#ngx .game[data-id=ghost] button")
        chk("a ROM listed but not installed gives a readable message, no emulator, no crash", until(pg, "/isn't installed/.test(document.getElementById('ngx-msg').textContent)", 3000) and not ev(pg, "!!document.querySelector('#ngx iframe')"))
        # hang -> timeout
        pg.click("#ngx .game[data-id=hang] button")
        chk("an emulator that never starts times out with a clear message and returns to the list", until(pg, "/didn't start in time/.test(document.getElementById('ngx-msg').textContent)", 6000) and ev(pg, "document.querySelectorAll('#ngx .game').length")>0)
        # crash
        pg.click("#ngx .game[data-id=bad] button")
        chk("an emulator error is shown readably and the game list comes back", until(pg, "/core crashed/.test(document.getElementById('ngx-msg').textContent)", 4000) and ev(pg, "document.getElementById('ngx-msg').classList.contains('err')"))
        # local ROM
        open(f"/tmp/ngx_ok.zip", "wb").write(b"PK\x03\x04hello"); open("/tmp/ngx_empty.zip", "wb").write(b""); open("/tmp/ngx_note.txt", "wb").write(b"hi")
        pg.set_input_files("#ngx-file", "/tmp/ngx_note.txt")
        chk("a file that is not a zip is refused with a readable message", until(pg, "/Unsupported file type/.test(document.getElementById('ngx-msg').textContent)", 2000) and not ev(pg, "!!document.querySelector('#ngx iframe')"))
        pg.set_input_files("#ngx-file", "/tmp/ngx_empty.zip")
        chk("an empty file is refused", until(pg, "/empty/.test(document.getElementById('ngx-msg').textContent)", 2000))
        pg.set_input_files("#ngx-bios", "/tmp/ngx_ok.zip")
        chk("a BIOS zip can be loaded for the visit", until(pg, "/neogeo|ngx_ok/.test(document.getElementById('ngx-bios-line').textContent)", 2000))
        pg.set_input_files("#ngx-file", "/tmp/ngx_ok.zip")
        chk("loading a ROM from the player's computer starts it (local blob, nothing uploaded)", until(pg, "!!document.querySelector('#ngx iframe') && NeoGeo._state().session && NeoGeo._state().session.done", 5000) and "blob:" in ev(pg, "document.querySelector('#ngx iframe').srcdoc"))
        pg.click("#ngx-x")
        chk("the on-screen ◀ Games button works even while the emulator has the keyboard", until(pg, "!document.querySelector('#ngx iframe') && NeoGeo.isOpen", 2000))
        pg.click("#ngx header b"); key(pg, "Escape")
        chk("leaving the cabinet restores everything", until(pg, "!NeoGeo.isOpen && !document.body.classList.contains('ngx-open') && document.getElementById('ngx').hidden", 2000))
        x0 = ev(pg, "game.player.x"); pg.keyboard.down("a"); pg.wait_for_timeout(300); pg.keyboard.up("a")
        chk("the farmer can walk again", ev(pg, "game.player.x") != x0)
        key(pg, "i"); chk("inventory opens again after the cabinet closes", ev(pg, "game.uiMode") == "inventory"); key(pg, "i")
        # inventory not over a machine
        at(pg, "arcade2"); key(pg, "e"); until(pg, "NeoGeo.isOpen"); key(pg, "i")
        chk("I does not open the inventory over the Neo Geo cabinet", ev(pg, "game.uiMode") is None)
        key(pg, "Escape")
        at(pg, "arcade1"); key(pg, "e"); chk("the other cabinet still opens the mini-game menu", until(pg, "Arcade.isOpen", 3000)); key(pg, "i")
        chk("I does not open the inventory over the mini-games", ev(pg, "game.uiMode") is None)
        key(pg, "Escape"); until(pg, "!Arcade.isOpen")
        # leaving the room while open closes it
        at(pg, "arcade2"); key(pg, "e"); until(pg, "NeoGeo.isOpen"); ev(pg, "game.passDoor('gamingBack')")
        chk("changing room closes the cabinet cleanly", not ev(pg, "NeoGeo.isOpen") and ev(pg, "game.inside===game.homeRoom"))
        pg.context.close()

        # ================= empty / broken manifests =================
        pg = new_page(br, manifest={"bios": "", "games": []}); to_gaming(pg); at(pg, "arcade2"); key(pg, "e")
        chk("empty games.json shows the 'no games installed' help (nothing crashes)", until(pg, "/No Neo Geo games installed/.test(document.getElementById('ngx').textContent)", 3000))
        pg.context.close()
        pg = new_page(br, manifest={"oops": 1}); to_gaming(pg); at(pg, "arcade2"); key(pg, "e")
        chk("a malformed games.json gives a readable message and the ROM loader still works", until(pg, "/Couldn't read/.test(document.getElementById('ngx-msg').textContent) && !!document.getElementById('ngx-file')", 3000))
        pg.context.close()

        # ================= HUD layout =================
        def boxes(pg):
            return ev(pg, """(()=>{const out={}; for (const id of ['clock','health','energy','hotbar','hint','bag-btn','coords','can-water','coop-btn','chat-fab']) { const e=document.getElementById(id); if(!e) continue; const c=getComputedStyle(e); if(c.display==='none'||e.hidden||+c.opacity===0&&id!=='hotbar') continue; const r=e.getBoundingClientRect(); if(r.width) out[id]=[r.left,r.top,r.right,r.bottom]; } return {out, vw:innerWidth, vh:innerHeight}})()""")
        def overlaps(a, b): return not (a[2] <= b[0] or b[2] <= a[0] or a[3] <= b[1] or b[3] <= a[1])
        for vw, vh, tag in [(1280, 720, "desktop"), (390, 780, "phone"), (800, 480, "phone_land")]:
            pg = new_page(br, vw, vh); ev(pg, "game.enterHome()"); until(pg, "game.inside && !game.fade"); pg.wait_for_timeout(500)
            ev(pg, "Cinema.ensure(game)"); key(pg, "2"); ev(pg, "(()=>{const p=game.homeRoom.spots.find(s=>s.act==='gaming'); game.player.x=p.cx-45; game.player.y=p.cy-5})()"); pg.wait_for_timeout(500)
            b = boxes(pg); o = b["out"]
            chk(f"[{tag}] every visible HUD piece is inside the screen", all(v[0] >= -1 and v[1] >= -1 and v[2] <= b["vw"] + 1 and v[3] <= b["vh"] + 1 for v in o.values()), str(o))
            names_ = [k for k in o if k not in ("coords",)]
            clash = [(x, y) for i, x in enumerate(names_) for y in names_[i + 1:] if overlaps(o[x], o[y])]
            chk(f"[{tag}] no two HUD pieces overlap (hotbar peeking + prompt + clock + bars)", not clash, str(clash))
            pg.screenshot(path=f"{out}/hud_{tag}.png")
            if tag == "phone":
                chk("[phone] a bag button is available (no I key on a touch screen) and opens the inventory", ev(pg, "getComputedStyle(document.getElementById('bag-btn')).display") != "none")
                pg.tap("#bag-btn"); pg.wait_for_timeout(250)
                chk("[phone] tapping the bag opens the inventory, tapping again closes it", ev(pg, "game.uiMode") == "inventory")
                pg.screenshot(path=f"{out}/hud_phone_inventory.png")
            pg.context.close()
        br.close()
finally:
    srv.terminate()

chk("no page errors / console errors", not errs, "\n".join(errs[:6]))
chk("no broken asset paths (4xx/5xx)", not bad, "\n".join(bad[:6]))
print(sum(res), "/", len(res)); sys.exit(0 if all(res) else 1)
