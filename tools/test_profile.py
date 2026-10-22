"""Title screen / profile checks. Run: python tools/test_profile.py"""
import subprocess, time, sys, os
from playwright.sync_api import sync_playwright
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8125"], cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); res = []; errs = []
def chk(n, ok, extra=""): res.append(bool(ok)); print(("PASS " if ok else "FAIL ") + n, extra)
out = os.environ.get("MAPSHOTS", "/tmp"); U = "http://localhost:8125/index.html?menu=1"
try:
  with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 1280, "height": 720}); pg = ctx.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(U); pg.wait_for_timeout(1500); ev = pg.evaluate
    chk("first launch shows create-farmer screen", ev("!document.getElementById('title').hidden && !!document.getElementById('nm')"))
    chk("game not started before choosing", ev("!(window.game instanceof Game)"))
    pg.click("#go"); chk("name is required", ev("!(window.game instanceof Game)"))
    pg.fill("#nm", "Zia"); pg.click(".gcard[data-g=female]"); pg.screenshot(path=f"{out}/menu_new.png")
    pg.click("#go"); pg.wait_for_timeout(1200)
    chk("game starts after Start", ev("!!window.game && document.getElementById('title').hidden"))
    chk("female + name applied", ev("CONFIG.PLAYER_CHARACTER==='female' && CONFIG.PLAYER_NAME==='Zia'"))
    ev("game.coins=777; game.saveGame(true)")
    chk("profile saved in its own slot", ev("Profiles.list.length===1 && !!localStorage.getItem(Profiles.saveKey(Profiles.list[0].id))"))
    pg.screenshot(path=f"{out}/menu_game.png")
    pg.reload(); pg.wait_for_timeout(1500)
    chk("relaunch shows Continue with the player", ev("(document.getElementById('b-cont')||{}).textContent||''").find("Zia") >= 0)
    pg.screenshot(path=f"{out}/menu_home.png")
    pg.click("#b-cont"); pg.wait_for_timeout(1200)
    chk("continue restores progress", ev("game.coins===777 && CONFIG.PLAYER_CHARACTER==='female'"))
    pg.reload(); pg.wait_for_timeout(1200); pg.click("#b-new"); pg.fill("#nm", "Ali"); pg.click("#go"); pg.wait_for_timeout(1200)
    chk("second player is independent (fresh coins, male)", ev("game.coins!==777 && CONFIG.PLAYER_CHARACTER==='male' && Profiles.list.length===2"), ev("game.coins"))
    ev("game.coins=5; game.saveGame(true)")
    pg.reload(); pg.wait_for_timeout(1200); pg.click("#b-load"); pg.wait_for_timeout(300); pg.screenshot(path=f"{out}/menu_load.png")
    chk("load list shows both", ev("document.querySelectorAll('.prow').length===2"))
    pg.click("[data-play]:nth-of-type(1)") if False else None
    ev("[...document.querySelectorAll('.prow')].find(r=>/Zia/.test(r.textContent)).querySelector('[data-play]').click()"); pg.wait_for_timeout(1200)
    chk("loading Zia gives her coins", ev("game.coins===777"))
    pg.on("dialog", lambda d: d.accept())
    pg.reload(); pg.wait_for_timeout(1200); pg.click("#b-load"); ev("[...document.querySelectorAll('.prow')].find(r=>/Ali/.test(r.textContent)).querySelector('[data-del]').click()"); pg.wait_for_timeout(300)
    chk("delete removes a save", ev("Profiles.list.length===1 && !localStorage.getItem('mv_save_'+'x')"))
    # legacy migration
    pg2 = ctx.new_page(); pg2.goto("http://localhost:8125/index.html?menu=1"); pg2.evaluate("localStorage.clear(); localStorage.setItem('moonlightValleySave', JSON.stringify({coins:42,day:3,mapVersion:4,visited:['0,0']}))"); pg2.reload(); pg2.wait_for_timeout(1200)
    chk("old single-slot save is adopted", pg2.evaluate("/42 coins/.test(document.getElementById('b-cont').textContent)"))
    pg2.click("#b-cont"); pg2.wait_for_timeout(1000); chk("adopted save loads", pg2.evaluate("game.coins===42"))
    chk("no page errors", not errs, errs); b.close()
finally:
  srv.terminate()
print(sum(res), "/", len(res)); sys.exit(0 if all(res) else 1)
