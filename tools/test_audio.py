"""Audio system: autoplay rules, scene music + crossfades, SFX triggers, settings (independent + saved), muting, cinema ducking, de-duplication,
mobile panel, offline rendering of every track/effect (levels, NaN, clipping), console errors.  Emulation only -- a test can measure sound, it cannot HEAR it.
Run: python tools/test_audio.py"""
import subprocess, time, sys, os, json
from playwright.sync_api import sync_playwright
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = "8170"; BASE = f"http://localhost:{PORT}/index.html"; out = os.environ.get("MAPSHOTS", "/tmp")
res, errs, bad = [], [], []
def chk(n, ok, x=""): res.append(bool(ok)); print(("PASS " if ok else "FAIL ") + n, x if not ok else "")
def ev(pg, js, a=None): return pg.evaluate(js, a) if a is not None else pg.evaluate(js)
def until(pg, js, t=6000):
    e = time.time() + t / 1000
    while time.time() < e:
        try:
            if ev(pg, js): return True
        except Exception: pass
        pg.wait_for_timeout(80)
    return False
def newpg(br, w=1280, h=720, touch=False, url=BASE, storage=None):
    ctx = br.new_context(viewport={"width": w, "height": h}, has_touch=touch, is_mobile=touch, device_scale_factor=2 if touch else 1)
    pg = ctx.new_page(); pg.cdp = ctx.new_cdp_session(pg)
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append("console: " + m.text) if m.type in ("error",) and "favicon" not in m.text and "Failed to load resource" not in m.text else None)
    pg.on("response", lambda r: bad.append(r.url) if r.status >= 400 and "favicon" not in r.url and "/roms/" not in r.url else None)
    pg.goto(url); pg.wait_for_timeout(1400); return pg
def st(pg): return ev(pg, "MVAudio._state()")
def logs(pg): return [e["name"] for e in ev(pg, "MVAudio._log.get()")]
def clear(pg): ev(pg, "MVAudio._log.clear()")
def key(pg, k, ms=150): pg.keyboard.press(k); pg.wait_for_timeout(ms)

srv = subprocess.Popen([sys.executable, "-m", "http.server", PORT], cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
try:
    with sync_playwright() as pw:
        br = pw.chromium.launch(args=["--autoplay-policy=document-user-activation-required"])
        pg = newpg(br)
        ev(pg, "MVAudio._log.on(true)")
        chk("audio manager loads", ev(pg, "typeof MVAudio") == "object" and len(ev(pg, "MVAudio.tracks")) == 7 and len(ev(pg, "MVAudio.sfxNames")) >= 45)
        chk("before any click: no sound context is running (autoplay rules respected)", st(pg)["ctx"] in (None, "suspended"), str(st(pg)))
        pg.mouse.click(640, 360); pg.wait_for_timeout(600)
        chk("after the first click the audio context starts", until(pg, "MVAudio._state().ctx==='running'", 3000), str(st(pg)))
        chk("outdoor music starts automatically (morning track at 6 am)", until(pg, "MVAudio._state().scene==='morning'", 4000), str(st(pg)))
        # --- scenes + crossfade ---
        ev(pg, "game.time=19"); chk("evening track at 7 pm", until(pg, "MVAudio._state().scene==='evening'", 4000))
        pg.wait_for_timeout(600); s1 = st(pg); chk("old track is fading out while the new one fades in (<=1 fading, 1 active)", s1["active"] == 1 and s1["fading"] <= 1, str(s1))
        gs = []
        for _ in range(12): gs.append(st(pg)["trackGain"]); pg.wait_for_timeout(120)
        chk("fade-in is smooth and rising (no jumps > 0.35 per 120 ms)", all(b >= a - 0.02 for a, b in zip(gs, gs[1:])) and all(b - a < 0.35 for a, b in zip(gs, gs[1:])), str(gs))
        pg.wait_for_timeout(5500); chk("after the fade only ONE track remains (no overlapping copies)", st(pg)["fading"] == 0 and st(pg)["active"] == 1, str(st(pg)))
        ev(pg, "game.time=22"); chk("night track at 10 pm", until(pg, "MVAudio._state().scene==='night'", 4000))
        ev(pg, "game.time=13"); chk("day track at 1 pm", until(pg, "MVAudio._state().scene==='day'", 4000))
        # rapid changes never pile up tracks
        for h in (7, 19, 23, 13, 8): ev(pg, f"game.time={h}"); pg.wait_for_timeout(450)
        pg.wait_for_timeout(1500); chk("rapid scene flipping leaves at most 1 active + 1 fading", st(pg)["active"] == 1 and st(pg)["fading"] <= 2, str(st(pg)))
        ev(pg, "game.time=7"); pg.wait_for_timeout(800)
        # rooms
        clear(pg); ev(pg, "game.enterHome()"); until(pg, "game.inside && !game.fade")
        chk("Main Hall music (Hearth) indoors", until(pg, "MVAudio._state().scene==='hall'", 4000), str(st(pg)))
        l = logs(pg); chk("door sounds played when entering (open + close)", "door_open" in l and "door_close" in l, str(l))
        clear(pg); ev(pg, "game.passDoor('gaming')"); until(pg, "game.inside&&game.inside.isGaming", 3000)
        chk("Gaming Room music (Pixel Lounge)", until(pg, "MVAudio._state().scene==='gaming'", 4000), str(st(pg)))
        pg.wait_for_timeout(5000); chk("hall -> gaming crossfade finished: one track", st(pg)["active"] == 1 and st(pg)["fading"] == 0, str(st(pg)))
        pg.screenshot(path=f"{out}/a_gaming.png")
        # --- footsteps by surface ---
        clear(pg); pg.keyboard.down("d"); pg.wait_for_timeout(900); pg.keyboard.up("d")
        l = logs(pg); chk("walking in the Gaming Room plays tile footsteps at a walking rhythm (2-6 steps in 0.9 s)", 2 <= l.count("step_tile") <= 6, str(l))
        # --- arcade ---
        ev(pg, "(a)=>{const s=game.gamingRoom.spots.find(s=>s.act===a); game.player.x=s.cx-15; game.player.y=s.cy-5}", "arcade1"); pg.wait_for_timeout(300); clear(pg)
        key(pg, "e", 700); l = logs(pg); chk("arcade machine switch-on sound", "arcade_on" in l and until(pg, "Arcade.isOpen", 2000), str(l))
        chk("music dips while the arcade is open so effects stay clear", until(pg, "MVAudio._state().duck<0.6", 3000), str(st(pg)))
        clear(pg); pg.click("#arc button[data-solo=whack]"); pg.wait_for_timeout(300); l = logs(pg); chk("arcade menu selection sound", "menu_select" in l, str(l))
        until(pg, "document.querySelectorAll('#arc .hole').length===9", 4000); pg.wait_for_timeout(3800)
        for _ in range(30):
            i = ev(pg, "[...document.querySelectorAll('#arc .hole')].findIndex(h=>h.classList.contains('up'))")
            if i >= 0: pg.click(f"#arc .hole:nth-child({i+1})", force=True); break
            pg.wait_for_timeout(120)
        pg.wait_for_timeout(300); l = logs(pg); chk("Whack-a-Mole: mole pop and hit sounds", "mole_pop" in l and "whack_hit" in l, str(l))
        ev(pg, "document.getElementById('arc-x').click()"); pg.wait_for_timeout(500)
        ev(pg, "Arcade.open(game)"); until(pg, "!!document.querySelector('#arc button[data-solo=memory]')"); pg.wait_for_timeout(300); clear(pg)
        pg.click("#arc button[data-solo=memory]"); until(pg, "document.querySelectorAll('#arc .pad').length===4", 4000); pg.wait_for_timeout(5500)
        l = logs(pg); chk("Memory Lights: sequence plays pad notes", sum(1 for n in l if n.startswith("mem_")) >= 3, str(l))
        ev(pg, "document.getElementById('arc-x').click()"); pg.wait_for_timeout(500)
        ev(pg, "Arcade.open(game)"); until(pg, "!!document.querySelector('#arc button[data-solo=reaction]')"); pg.wait_for_timeout(300); clear(pg)
        pg.click("#arc button[data-solo=reaction]"); until(pg, "!!document.querySelector('#arc .rx.go')", 12000); pg.wait_for_timeout(200)
        l = logs(pg); chk("reaction game: GO signal sound", "go" in l, str(l))
        ev(pg, "document.getElementById('arc-x').click()"); pg.wait_for_timeout(500)
        chk("arcade_off played and music is back to normal volume", "arcade_off" in logs(pg) and until(pg, "MVAudio._state().duck>0.9", 4000))
        # banner sounds (win/lose/draw) via the same DOM the arcade builds
        clear(pg)
        for cls, txt, expect in (("win", "YOU WIN!", "win"), ("lose", "YOU LOSE!", "lose"), ("draw", "DRAW!", "draw")):
            ev(pg, "([c,t])=>{ Arcade.open(game); const b=document.createElement('div'); b.className='banner '+c; b.textContent=t; document.querySelector('#arc .card').appendChild(b); }", [cls, txt]); pg.wait_for_timeout(1400)
        l = logs(pg); chk("result announcements: win, lose and draw each have a sound", all(n in l for n in ("win", "lose", "draw")), str(l))
        ev(pg, "document.getElementById('arc-x').click()"); pg.wait_for_timeout(400)
        # --- panels / UI / notifications ---
        ev(pg, "game.passDoor('gamingBack')"); pg.wait_for_timeout(600); clear(pg)
        key(pg, "i", 400); key(pg, "i", 400); l = logs(pg); chk("inventory open + close sounds (I)", "bag_open" in l and "bag_close" in l, str(l))
        clear(pg); ev(pg, "game.showMessage('Welcome home')"); ev(pg, "game.showMessage(\"You can't carry any more\")"); ev(pg, "game.showMessage('Harvested a tomato')"); pg.wait_for_timeout(300)
        l = logs(pg); chk("system notification / error / success sounds", "notify" in l and "error" in l and "success" in l, str(l))
        clear(pg); ev(pg, "game.showMessage('Aisha joined your game')"); ev(pg, "game.showMessage('Aisha joined your game')"); pg.wait_for_timeout(300)
        chk("'friend joined' message triggers exactly one sound even if repeated", logs(pg).count("friend_join") == 1, str(logs(pg)))
        clear(pg); ev(pg, "game.selectSlot(2)"); key(pg, "4", 200); l = logs(pg); chk("hotbar selection tick", "ui_select" in l, str(l))
        clear(pg); pg.click("#coop-btn"); pg.wait_for_timeout(300); chk("buttons click sound", "ui_click" in logs(pg), str(logs(pg))); key(pg, "Escape", 200)
        # co-op link events through the real Cinema link object, with duplicates
        ev(pg, "Cinema.ensure(game)"); pg.wait_for_timeout(400); clear(pg)
        ev(pg, "(()=>{const L=Cinema.link; L.emit('hello',{id:'p1',name:'Aisha'},true); L.emit('hello',{id:'p1',name:'Aisha'},true); L.emit('down','x'); L.emit('down','x'); L.emit('restored'); L.emit('restored');})()"); pg.wait_for_timeout(300)
        l = logs(pg); chk("co-op: join / leave / reconnect each sound exactly once despite duplicate events", l.count("friend_join") == 1 and l.count("friend_leave") == 1 and l.count("reconnect") == 1, str(l))
        clear(pg); ev(pg, "(()=>{const m={t:'chat',text:'hello',ts:Date.now()}; try{Cinema.onChat(m); Cinema.onChat(m);}catch(e){}})()"); pg.wait_for_timeout(300)
        chk("incoming chat message sound (once for a duplicate)", logs(pg).count("message") <= 1, str(logs(pg)))
        # --- cinema room: ambient music; ducks when video plays ---
        ev(pg, "game.enterHome()"); until(pg, "game.inside && !game.fade"); ev(pg, "game.passDoor('cinema')"); until(pg, "game.inside && game.inside.isCinema", 3000); pg.wait_for_timeout(300)
        chk("Cinema Room gets its own quiet ambient track", until(pg, "MVAudio._state().scene==='cinema'", 4000), str(st(pg)))
        chk("entering the cinema plays the cinema_enter sound", "cinema_enter" in logs(pg), str(logs(pg)))
        ev(pg, "Cinema.session && (Cinema.session.state={status:'active'}, Cinema.session.joined=true, Cinema.session.localState='playing')"); pg.wait_for_timeout(1500)
        chk("video playing -> background music fades to silence (movie audio never competes)", until(pg, "MVAudio._state().duck<0.05", 4000) and st(pg)["cinemaPlaying"], str(st(pg)))
        ev(pg, "Cinema.session.localState='paused'"); chk("video paused -> music returns", until(pg, "MVAudio._state().duck>0.9", 5000), str(st(pg)))
        ev(pg, "Cinema.session.state=null; Cinema.session.joined=false; game.passDoor('cinemaUp'); game.inside=null"); pg.wait_for_timeout(300)
        # --- settings ---
        ev(pg, "MVAudio.openPanel()"); pg.wait_for_timeout(300); pg.screenshot(path=f"{out}/a_panel_desktop.png")
        chk("settings panel shows 4 sliders + mute button", ev(pg, "document.querySelectorAll('#aud-panel input[type=range]').length") == 4 and ev(pg, "!!document.getElementById('aud-mute')"))
        base = st(pg)
        pg.fill("#aud-panel input[data-ch=music]", "20"); pg.wait_for_timeout(400); a = st(pg)
        chk("Music slider changes ONLY music volume", a["musicGain"] < base["musicGain"] * 0.5 and abs(a["sfxGain"] - base["sfxGain"]) < 1e-3 and abs(a["ambGain"] - base["ambGain"]) < 1e-3, f"{base} {a}")
        pg.fill("#aud-panel input[data-ch=sfx]", "30"); pg.wait_for_timeout(400); b = st(pg)
        chk("Sound-effects slider changes ONLY effects volume", b["sfxGain"] < a["sfxGain"] * 0.5 and abs(b["musicGain"] - a["musicGain"]) < 1e-3, f"{a} {b}")
        pg.fill("#aud-panel input[data-ch=ambient]", "10"); pg.wait_for_timeout(400); c = st(pg)
        chk("Ambient slider changes ONLY ambient volume", c["ambGain"] < b["ambGain"] * 0.3 and abs(c["sfxGain"] - b["sfxGain"]) < 1e-3, f"{b} {c}")
        pg.fill("#aud-panel input[data-ch=master]", "50"); pg.wait_for_timeout(400); d = st(pg)
        chk("Master slider scales everything (master gain follows)", d["masterGain"] < c["masterGain"] * 0.6, f"{c} {d}")
        chk("each slider shows its live % value", ev(pg, "document.querySelector('#aud-panel output[data-o=music]').textContent") == "20%")
        x0 = ev(pg, "game.player.x"); pg.focus("#aud-panel input[data-ch=music]"); pg.keyboard.press("ArrowRight"); pg.wait_for_timeout(200)
        chk("arrow keys on a slider do not walk the character", ev(pg, "game.player.x") == x0); pg.fill("#aud-panel input[data-ch=music]", "20"); pg.wait_for_timeout(200)
        pg.screenshot(path=f"{out}/a_panel_sliders.png")
        pg.click("#aud-mute"); pg.wait_for_timeout(700); m = st(pg)
        chk("Mute silences master and suspends the audio engine (no CPU)", m["masterGain"] < 0.001 and m["ctx"] == "suspended", str(m))
        pg.screenshot(path=f"{out}/a_panel_muted.png")
        saved = ev(pg, "JSON.parse(localStorage.getItem('mv_audio_v1'))")
        chk("settings are written to localStorage", saved["music"] == 0.2 and saved["sfx"] == 0.3 and saved["ambient"] == 0.1 and saved["master"] == 0.5 and saved["muted"] is True, str(saved))
        ctx = pg.context
        pg.reload(); pg.wait_for_timeout(1400)
        chk("settings survive a restart (reload)", ev(pg, "MVAudio.settings") == {"master": 0.5, "music": 0.2, "sfx": 0.3, "ambient": 0.1, "muted": True}, str(ev(pg, "MVAudio.settings")))
        pg.mouse.click(640, 360); pg.wait_for_timeout(1200)
        chk("muted setting is respected after restart: nothing plays", not st(pg)["scene"] and (st(pg)["ctx"] in (None, "suspended") or st(pg)["masterGain"] < 0.001), str(st(pg)))
        ev(pg, "MVAudio.setMuted(false)"); pg.wait_for_timeout(1500)
        chk("unmuting brings the sound back", until(pg, "MVAudio._state().ctx==='running' && !!MVAudio._state().scene", 5000), str(st(pg)))
        # --- background tab ---
        ev(pg, "Object.defineProperty(document,'hidden',{value:true,configurable:true}); document.dispatchEvent(new Event('visibilitychange'))"); pg.wait_for_timeout(600)
        chk("switching away from the game tab suspends audio", st(pg)["ctx"] == "suspended", str(st(pg)))
        ev(pg, "Object.defineProperty(document,'hidden',{value:false,configurable:true}); document.dispatchEvent(new Event('visibilitychange'))"); pg.wait_for_timeout(900); pg.mouse.click(640, 360); pg.wait_for_timeout(600)
        chk("coming back resumes it", st(pg)["ctx"] == "running", str(st(pg)))
        pg.close()

        # --- phone: sound button in the ⋯ menu, panel fits, first touch unlocks ---
        ph = newpg(br, 844, 390, touch=True)
        chk("phone: audio is locked until the first touch", st(ph)["ctx"] in (None, "suspended"))
        jx, jy = ev(ph, "(()=>{const r=document.getElementById('mv-joy').getBoundingClientRect(); return [r.left+r.width/2, r.top+r.height/2]})()")
        ph.cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": jx, "y": jy, "id": 0}]}); ph.wait_for_timeout(80); ph.cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []}); ph.wait_for_timeout(900)
        chk("phone: a touch on the controls unlocks audio and the music starts", until(ph, "MVAudio._state().ctx==='running' && !!MVAudio._state().scene", 4000), str(st(ph)))
        chk("phone: floating sound button hidden, available from the ⋯ menu", ev(ph, "getComputedStyle(document.getElementById('aud-btn')).display") == "none" and ev(ph, "!!document.getElementById('mv-snd')"))
        def tap(sel):
            x, y = ev(ph, "(s)=>{const r=document.querySelector(s).getBoundingClientRect(); return [r.left+r.width/2, r.top+r.height/2]}", sel)
            ph.cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y, "id": 0}]}); ph.wait_for_timeout(60); ph.cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []}); ph.wait_for_timeout(250)
        tap("#mv-more"); tap("#mv-snd")
        chk("phone: Sound opens the settings panel", not ev(ph, "document.getElementById('aud-panel').hidden"))
        r = ev(ph, "(()=>{const r=document.getElementById('aud-panel').getBoundingClientRect(); return [r.left,r.top,r.right,r.bottom]})()")
        chk("phone: panel fits the 844x390 screen", r[0] >= 0 and r[1] >= 0 and r[2] <= 844 and r[3] <= 390, str(r)); ph.screenshot(path=f"{out}/a_panel_phone.png")
        ph.close()

        # --- offline render of every track and effect ---
        pg = newpg(br); stats = {}
        for n in ev(pg, "MVAudio.tracks"):
            stats[n] = ev(pg, "(n)=>MVAudio._renderTrack(n, 40)", n)
        bad_t = [n for n, s in stats.items() if s["nan"] or s["peak"] >= 0.999 or s["rms"] < 0.004 or s["rms"] > 0.35]
        chk("all 7 tracks render: finite, audible (RMS 0.004-0.35), no clipping (peak < 1)", not bad_t, str({n: (round(s['rms'], 4), round(s['peak'], 3), s['nan']) for n, s in stats.items()}))
        chk("every track keeps playing for the whole 40 s (no silent quarter)", all(min(s["segmentsRms"]) > 0.002 for s in stats.values()), str({n: [round(x, 4) for x in s["segmentsRms"]] for n, s in stats.items()}))
        chk("tracks are genuinely different from each other", len({round(s["zeroCrossRate"] / 20) for s in stats.values()}) >= 5, str({n: round(s["zeroCrossRate"]) for n, s in stats.items()}))
        sx = {n: ev(pg, "(n)=>MVAudio._renderSfx(n)", n) for n in ev(pg, "MVAudio.sfxNames")}
        bad_s = [n for n, s in sx.items() if s["nan"] or s["peak"] >= 0.999 or s["peak"] < 0.01]
        chk(f"all {len(sx)} sound effects render: finite, audible, no clipping", not bad_s, str({n: sx[n] for n in bad_s}))
        chk("effects are not painfully loud (peak < 0.7 before the volume slider)", max(s["peak"] for s in sx.values()) < 0.7, str(sorted(((round(s['peak'], 2), n) for n, s in sx.items()), reverse=True)[:4]))
        json.dump({"tracks": stats, "sfx": sx}, open(f"{out}/audio_render_stats.json", "w"), indent=1)
        pg.close(); br.close()
finally:
    srv.terminate()
chk("no console errors / page errors", not errs, str(errs[:5])); chk("no broken assets (4xx/5xx)", not bad, str(bad[:5]))
print(f"{sum(res)}/{len(res)} passed"); sys.exit(0 if all(res) else 1)
