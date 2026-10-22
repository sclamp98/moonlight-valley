"""Headless checks for the mini-map, full map and way-point. Run: python tools/test_map.py (serves the game itself)."""
import subprocess, time, sys, os
from playwright.sync_api import sync_playwright
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8124"], cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); res = []; errs = []
def chk(n, ok, extra=""): res.append(ok); print(("PASS " if ok else "FAIL ") + n, extra)
out = os.environ.get("MAPSHOTS", "/tmp")
try:
  with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1280, "height": 720}); pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto("http://localhost:8124/index.html"); pg.wait_for_timeout(2500)
    ev = pg.evaluate
    chk("minimap canvas exists and is drawn", ev("!!document.getElementById('mini-cv') && document.getElementById('mini-cv').getContext('2d').getImageData(60,50,1,1).data[3]>0"))
    ev("window.game.time=12")
    pg.click("#worldmap"); pg.wait_for_timeout(400)
    chk("clicking minimap opens full map", ev("game.uiMode==='map' && !document.getElementById('map-box').hidden"))
    chk("map lists shops", ev("[...document.querySelectorAll('#map-places .pl span')].map(e=>e.textContent).some(t=>/General Store/.test(t)) && [...document.querySelectorAll('#map-places .pl span')].some(e=>/Armory/.test(e.textContent))"))
    chk("all 9 pages have terrain", ev("WORLD.order.every(id=>game.mapPageInfo(id).canvas.width===72)"))
    pg.screenshot(path=f"{out}/map_full.png")
    # click on the Armory row -> waypoint on page -1,0 ... then check
    ev("[...document.querySelectorAll('#map-places .pl')].find(e=>/Armory/.test(e.textContent)).click()")
    chk("clicking a place sets a way-point", ev("game.waypoint && /Armory/.test(game.waypoint.name)"), ev("JSON.stringify(game.waypoint)"))
    # click map canvas on a spot -> waypoint
    box = ev("(()=>{const r=document.getElementById('map-canvas').getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()")
    pg.mouse.click(box[0] + box[2] * (1.5 / 3), box[1] + box[3] * (1.5 / 3) - 40)
    chk("clicking the map sets a way-point on the page", ev("game.waypoint && game.waypoint.page==='0,0'"), ev("JSON.stringify(game.waypoint)"))
    pg.mouse.click(box[0] + box[2] * (1.5 / 3), box[1] + box[3] * (1.5 / 3) - 40)
    chk("clicking it again clears it", ev("game.waypoint===null"))
    pg.mouse.click(box[0] + box[2] * 0.2, box[1] + box[3] * 0.5)
    pg.mouse.click(box[0] + box[2] * 0.2, box[1] + box[3] * 0.5, button="right")
    chk("right-click clears", ev("game.waypoint===null"))
    pg.keyboard.press("Escape"); pg.wait_for_timeout(200)
    chk("Esc closes the map", ev("game.uiMode===null && document.getElementById('map-box').hidden"))
    pg.keyboard.press("m"); pg.wait_for_timeout(200); chk("M opens", ev("game.uiMode==='map'"))
    pg.keyboard.press("m"); pg.wait_for_timeout(200); chk("M closes", ev("game.uiMode===null"))
    # in-page waypoint renders flag, then arrival clears it
    ev("game.setWaypoint({page:'0,0',tx:(game.player.cx/48)+6,ty:game.player.cy/48,name:'Test spot'})"); pg.wait_for_timeout(300)
    pg.screenshot(path=f"{out}/map_flag.png")
    ev("game.setWaypoint({page:'0,0',tx:(game.player.cx/48)+40,ty:game.player.cy/48,name:'Far spot'})"); pg.wait_for_timeout(300)
    pg.screenshot(path=f"{out}/map_arrow.png")
    ev("game.setWaypoint({page:'0,0',tx:game.player.cx/48,ty:game.player.cy/48,name:'Here'})"); pg.wait_for_timeout(400)
    chk("arriving clears the way-point", ev("game.waypoint===null"))
    # other page -> exit arrow & BFS
    ev("game.setWaypoint({page:'1,1',tx:30,ty:30,name:'Faraway'})"); pg.wait_for_timeout(300)
    step = ev("game.waypointStep()"); chk("route to another page picks an exit", step in ("E", "S", "N", "W"), step)
    chk("target is on the page edge", ev("(()=>{const t=game.waypointTarget();return t&&(t.x===0||t.y===0||t.x===72*48||t.y===56*48)})()"))
    pg.screenshot(path=f"{out}/map_exit_arrow.png")
    # save + reload
    ev("game.saveGame(true)"); pg.reload(); pg.wait_for_timeout(2500)
    chk("way-point persists across reload", ev("game.waypoint && game.waypoint.name==='Faraway'"))
    # travel to another page: minimap follows
    ev("game.enterPage('-1,0'); game.beginPage()"); pg.wait_for_timeout(300)
    chk("minimap name follows page", ev("document.getElementById('wm-name').textContent")==ev("game.page.spec.name"))
    ev("game.time=23"); pg.wait_for_timeout(300)
    chk("no page errors", not errs, errs)
    b.close()
finally:
  srv.terminate()
print(sum(res), "/", len(res)); sys.exit(0 if all(res) else 1)
