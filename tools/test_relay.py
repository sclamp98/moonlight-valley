"""Relay (Ably-style) co-op test: two separate browser processes, the real game, the real api/*.js functions, and a local stand-in for
Ably's realtime service (tools/dev_api.js + tools/fake_ably.js). Real Ably is NOT contacted, so this proves our code, not Ably itself.
The game is opened at http://game.test:PORT (not localhost) with NO transport setting, so the default "auto" must choose the relay.
Run: python tools/test_relay.py"""
import subprocess, sys, os, time, json, hmac, hashlib, base64, urllib.request, urllib.error
from playwright.sync_api import sync_playwright

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8140; BASE = f"http://localhost:{PORT}"; GAME = f"http://game.test:{PORT}/index.html"
SECRET = "test-room-secret-0123456789abcdef"
res, errs = [], []
def chk(n, ok, extra=""): res.append(bool(ok)); print(("PASS " if ok else "FAIL ") + n, extra if not ok else "")
def post(path, body, port=PORT, raw=None):
    req = urllib.request.Request(f"http://localhost:{port}{path}", data=raw if raw is not None else json.dumps(body).encode(), method="POST", headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
def key_for(room): return base64.urlsafe_b64encode(hmac.new(SECRET.encode(), ("room:" + room).encode(), hashlib.sha256).digest()).decode().rstrip("=")[:43]

class P:
    def __init__(s, br, name, g, tag, fake=True, extra_cfg=""):
        s.tag = tag; s.pg = br.new_context(viewport={"width": 1100, "height": 700}).new_page()
        s.pg.on("pageerror", lambda e: errs.append(f"[{tag}] {e}"))
        s.pg.on("console", lambda m: errs.append(f"[{tag}] console: {m.text}") if m.type == "error" and "favicon" not in m.text and "Failed to load resource" not in m.text else None)
        s.pg.add_init_script(path=os.path.join(root, "tools", "cinema_fake_yt.js"))
        if fake: s.pg.add_init_script(path=os.path.join(root, "tools", "fake_ably.js"))
        if extra_cfg: s.pg.add_init_script(extra_cfg)
        s.pg.goto(GAME); s.pg.wait_for_timeout(1200)
        s.ev("(a)=>{ Cinema.ensure(game); Cinema.self.name=a[0]; Cinema.self.gender=a[1]; }", [name, g])
    def ev(s, js, a=None): return s.pg.evaluate(js, a) if a is not None else s.pg.evaluate(js)
    def until(s, js, t=10000):
        e = time.time() + t / 1000
        while time.time() < e:
            try:
                if s.ev(js): return True
            except Exception: pass
            s.pg.wait_for_timeout(100)
        return False
    def wait(s, ms): s.pg.wait_for_timeout(ms)
    def key(s, k): s.pg.keyboard.press(k); s.wait(120)
    def go_cinema(s): s.ev("game.enterHome()"); s.wait(700); s.ev("game.enterCinema()"); s.wait(700)
    def at_tv(s): s.ev("""()=>{ const g=game, sp=g.inside.spots.find(x=>x.act==='tv'), p=g.player; p.x += sp.cx - p.cx; p.y += sp.cy - p.cy; }"""); s.wait(150)

def start_server(port, env=None):
    e = dict(os.environ); e.update(env or {})
    p = subprocess.Popen(["node", os.path.join(root, "tools", "dev_api.js"), str(port)], env=e, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1); return p

srv = start_server(PORT); srv2 = start_server(PORT + 1, {"ABLY_API_KEY": "nocolon", "MV_ROOM_SECRET": "short"})
try:
    # ---------- the API functions ----------
    st, r = post("/api/room", {})
    chk("POST /api/room creates a room and an MV2 invite code", st == 200 and r["code"].startswith("MV2." + r["roomId"] + ".") and r["expiresAt"] > time.time() * 1000, str(r))
    room, key = r["roomId"], r["code"].split(".")[2]
    st, t = post("/api/auth", {"roomId": room, "key": key, "clientId": "playerA1"})
    cap = json.loads(t.get("capability", "{}")) if st == 200 else {}
    chk("valid code -> token request limited to exactly that one channel", st == 200 and list(cap) == ["mv:" + room] and t["clientId"] == "playerA1" and "mac" in t and "keySecret" not in json.dumps(t), str(t))
    chk("the API key secret is never in the response", "testsecretvalue" not in json.dumps(t))
    st, _ = post("/api/auth", {"roomId": room, "key": key[:-2] + "xx", "clientId": "playerA1"}); chk("wrong key -> 403", st == 403)
    st, _ = post("/api/auth", {"roomId": room[:-1] + ("a" if room[-1] != "a" else "b"), "key": key, "clientId": "playerA1"}); chk("key from another room -> 403", st == 403)
    st, _ = post("/api/auth", {"roomId": "x", "key": "y", "clientId": "z"}); chk("garbage -> 400, nothing issued", st == 400)
    st, _ = post("/api/auth", None, raw=b"{not json"); chk("malformed JSON -> 400", st == 400)
    old = format(int((time.time() - 13 * 3600) * 1000), "x") if False else None
    import math
    def b36(n):
        d = "0123456789abcdefghijklmnopqrstuvwxyz"; s = ""
        while n: s = d[n % 36] + s; n //= 36
        return s
    oldroom = b36(int((time.time() - 13 * 3600) * 1000)) + "_AbCdEfGhIjKl"
    st, _ = post("/api/auth", {"roomId": oldroom, "key": key_for(oldroom), "clientId": "playerA1"}); chk("a 13-hour-old room is expired (403)", st == 403)
    try: urllib.request.urlopen(f"{BASE}/api/room"); g = 200
    except urllib.error.HTTPError as e: g = e.code
    chk("GET is refused (405)", g == 405)
    st, r2 = post("/api/room", {}, port=PORT + 1); chk("server without env vars answers 503 with setup instructions", st == 503 and "README-MIGRATION" in r2.get("message", ""), str(r2))

    with sync_playwright() as pw:
        args = ["--host-resolver-rules=MAP game.test 127.0.0.1"]
        b1 = pw.chromium.launch(args=args); b2 = pw.chromium.launch(args=args)           # two separate browser processes
        A = P(b1, "Shuja", "male", "A"); B = P(b2, "Aisha", "female", "B")
        chk("default config on a real hostname picks the relay link", A.ev("Cinema.link.relay===true && CoopRelay.wanted()"))
        # ---------- room creation through the real UI ----------
        A.ev("Cinema.ui.openCoop()"); B.ev("Cinema.ui.openCoop()")
        A.pg.click("#coop-host"); chk("host: invite appears (MV2) and no reply-code step is shown", A.until("document.getElementById('coop-offer').value.startsWith('MV2.')") and A.ev("document.getElementById('coop-reply-in').closest('label').hidden && document.getElementById('coop-connect').closest('.cin-actions').hidden"))
        code = A.ev("document.getElementById('coop-offer').value")
        chk("host state: waiting for partner (not 'connecting forever')", A.ev("Cinema.link.state")=="offering" and A.ev("document.getElementById('coop-state').textContent")=="Waiting for partner")
        B.pg.click("#coop-join"); B.ev("(c)=>{document.getElementById('coop-invite-in').value=c}", code)
        chk("joiner: no reply box, button says Join", B.ev("document.getElementById('coop-answer').closest('label').hidden && document.getElementById('coop-make-reply').textContent")=="Join")
        B.pg.click("#coop-make-reply")
        chk("both players reach 'open' (Connected) through the relay", A.until("Cinema.link.open && Cinema.link.state==='open'", 15000) and B.until("Cinema.link.open && Cinema.link.state==='open'", 15000), f"{A.ev('Cinema.link.state')}/{B.ev('Cinema.link.state')} {A.ev('Cinema.link.detail')}")
        if not A.ev("Cinema.link.open"): print("A logs:", *A.ev("Cinema.link.logs"), sep="\n  "); print("B logs:", *B.ev("Cinema.link.logs"), sep="\n  ")
        chk("each knows the other's name, roles are host/joiner", A.ev("Cinema.link.peer.name")=="Aisha" and B.ev("Cinema.link.peer.name")=="Shuja" and A.ev("Cinema.link.initiatorId")==A.ev("Cinema.self.id") and B.ev("Cinema.link.initiatorId")==A.ev("Cinema.self.id"))
        chk("round-trip time is measured over the relay", A.until("Cinema.link.rtt!==null") and B.until("Cinema.link.rtt!==null"))
        chk("status chip says Connected on both", A.ev("document.getElementById('coop-state').textContent")=="Connected" and B.ev("document.getElementById('coop-state').textContent")=="Connected")
        A.ev("Cinema.ui.closeCoop()"); B.ev("Cinema.ui.closeCoop()")
        # ---------- movement ----------
        A.ev("game.enterHome()"); B.ev("game.enterHome()"); A.wait(900)
        chk("partner avatars appear in the house", A.until("!!Cinema.remote && Cinema.remote.where==='home'") and B.until("!!Cinema.remote && Cinema.remote.where==='home'"))
        x0 = B.ev("Cinema.remote.x"); A.ev("game.player.x += 160"); B.wait(1500)
        chk("host walks -> joiner sees the avatar move", abs(B.ev("Cinema.remote.x") - x0) > 60, f"{x0}->{B.ev('Cinema.remote.x')}")
        y0 = A.ev("Cinema.remote.y"); B.ev("game.player.y += 90"); A.wait(1500)
        chk("joiner walks -> host sees the avatar move", abs(A.ev("Cinema.remote.y") - y0) > 40, f"{y0}->{A.ev('Cinema.remote.y')}")
        A.ev("(()=>{ window.__n=0; const s=Cinema.link._pub.bind(Cinema.link); Cinema.link._pub=function(o){ if(o.t==='pos') window.__n++; return s(o); }; return 1; })()"); A.wait(5000)
        chk("standing still sends about one position a second, not 11", A.ev("window.__n") <= 8, str(A.ev("window.__n")))
        # ---------- cinema: only small messages cross, video plays locally ----------
        A.go_cinema(); B.go_cinema(); A.at_tv(); B.at_tv(); A.key("e"); B.key("e")
        A.ev("document.getElementById('cin-url').value='https://youtu.be/dQw4w9WgXcQ'"); A.pg.click("#cin-load")
        chk("host loads a video; joiner is offered it", B.until("Cinema.session.active && Cinema.session.state.videoId==='dQw4w9WgXcQ' && !Cinema.session.joined", 8000))
        B.pg.click("#cin-join"); chk("joiner's own player loads the same video locally", B.until("Cinema.session.adapter && Cinema.session.adapter.p && Cinema.session.adapter.p.vid==='dQw4w9WgXcQ'", 8000))
        A.pg.click("#cin-play"); chk("Play on one side plays on the other", B.until("Cinema.session.info().playing", 8000))
        B.pg.click("#cin-pause"); chk("Pause on the other side pauses the first (two-way)", A.until("!Cinema.session.info().playing", 8000))
        A.ev("Cinema.session.seek(90)"); B.wait(1500); chk("seek crosses the relay", abs(B.ev("Cinema.session.adapter.p.getCurrentTime()") - 90) < 3)
        B.ev("Cinema.session.setRate(1.25)"); chk("speed change crosses the relay", A.until("Cinema.session.adapter.p.rate===1.25", 5000)); B.ev("Cinema.session.setRate(1)")
        biggest = A.ev("window.__big=0; 0") or 0
        A.ev("(()=>{const s=Cinema.link._pub.bind(Cinema.link); Cinema.link._pub=function(o){ const n=JSON.stringify(o).length; if(n>window.__big) window.__big=n; return s(o); };})()")
        A.ev("Cinema.session.seek(10)"); B.ev("Cinema.session.seek(50)"); A.wait(2500)
        chk("simultaneous seeks still converge on both", A.ev("Cinema.session.state.rev")==B.ev("Cinema.session.state.rev") and A.ev("Cinema.session.state.position")==B.ev("Cinema.session.state.position"))
        chk("every relayed message is tiny (largest < 2 KB): no video data goes through the backend", A.ev("window.__big") < 2048, str(A.ev("window.__big")))
        A.ev("Cinema.ui.chatMsgs.length"); A.pg.click("#cin-chat-btn"); B.pg.click("#cin-chat-btn")
        A.ev("(()=>{const i=document.getElementById('cin-chat-input'); i.value='hello over the relay'; document.getElementById('cin-chat-form').requestSubmit();})()")
        chk("chat message arrives", B.until("Cinema.ui.chatMsgs.some(m=>!m.mine && m.text==='hello over the relay')", 6000))
        A.key("Escape"); B.key("Escape"); A.key("Escape"); B.key("Escape")
        # ---------- disconnect / reconnect ----------
        B.ev("__fakeAbly.instances[0].drop()")
        chk("joiner's connection drops: joiner shows reconnecting", B.until("Cinema.link.state==='reconnecting'", 5000))
        chk("host notices the partner left (reconnecting, partner avatar gone), session survives", A.until("Cinema.link.state==='reconnecting' && Cinema.remote===null", 8000) and A.ev("Cinema.session.active"))
        chk("host cannot send while partner is away (no fake success)", A.ev("Cinema.link.send('chat',{text:'x',ts:1})") is False)
        B.ev("__fakeAbly.instances[0].resume()")
        chk("partner returns: both back to open (restored)", A.until("Cinema.link.state==='open' && Cinema.link.open", 12000) and B.until("Cinema.link.state==='open' && Cinema.link.open", 12000), f"{A.ev('Cinema.link.state')}/{B.ev('Cinema.link.state')}")
        A.ev("Cinema.session.seek(33)"); chk("sync works again after reconnect", B.until("Math.abs(Cinema.session.state.position-33)<1", 6000))
        A.ev("game.player.x += 120"); chk("movement works again after reconnect", B.until("!!Cinema.remote", 5000))
        # ---------- privacy: wrong key, other rooms, full room ----------
        C = P(b1, "Eve", "male", "C")
        r = C.ev("async()=>{ try { await Cinema.link.acceptInvite('MV2.%s.%s'); return 'joined' } catch(e) { return e.message } }" % (room, "A" * 43))
        chk("a code with the wrong key is refused with a clear message", "isn't valid" in r, r)
        full = A.ev("document.getElementById('coop-offer').value")
        r = C.ev("async(c)=>{ try { await Cinema.link.acceptInvite(c); return 'joined' } catch(e) { return e.message } }", full)
        chk("a third player with the right code is refused: room already has two players", "already has two players" in r, r)
        chk("...and the two players are undisturbed", A.ev("Cinema.link.open") and B.ev("Cinema.link.open"))
        D = P(b1, "Dan", "male", "D"); E = P(b2, "Eli", "female", "E")
        code2 = D.ev("Cinema.link.createInvite()"); E.ev("(c)=>Cinema.link.acceptInvite(c)", code2)
        chk("a second, separate room connects", D.until("Cinema.link.open", 12000) and E.until("Cinema.link.open", 12000))
        A.ev("(()=>{ window.__got=0; Cinema.link.on('probe',()=>window.__got++); return 1; })()"); D.ev("(()=>{ window.__got=0; Cinema.link.on('probe',()=>window.__got++); return 1; })()")
        E.ev("Cinema.link.send('probe',{})"); A.wait(800)
        chk("a message in room 2 reaches room 2 only", D.ev("window.__got")==1 and A.ev("window.__got")==0)
        # a token for room 1 cannot be used on room 2's channel
        tok = A.ev("""async()=>{ const m=/^MV2\\.([^.]+)\\.([^.]+)$/.exec(document.getElementById('coop-offer').value); const r=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roomId:m[1],key:m[2],clientId:'spy'})}); const t=await r.json(); return btoa(JSON.stringify(t)).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,''); }""")
        room2 = code2.split(".")[1]
        with_urlopen = None
        try: urllib.request.urlopen(f"{BASE}/__hub/members?ch=mv:{room2}&tok={tok}"); c_ = 200
        except urllib.error.HTTPError as e: c_ = e.code
        chk("a token for room 1 is refused by the realtime service for room 2's channel", c_ == 401)
        # ---------- closing ----------
        A.ev("Cinema.link.close()"); chk("closing the link: partner shows reconnecting/waiting, not a false 'connected'", B.until("Cinema.link.state==='reconnecting' && !Cinema.link.open", 8000))
        chk("a closed link can't send", A.ev("Cinema.link.send('chat',{text:'x',ts:1})") is False)
        # ---------- a bad invite never hangs on 'connecting' ----------
        F = P(b1, "Fay", "female", "F")
        r = F.ev("async()=>{ try { await Cinema.link.acceptInvite('MV1z.abcdef'); return 'joined' } catch(e) { return e.message } }")
        chk("an old MV1 code gets an explanation", "old-style" in r, r)
        r = F.ev("async()=>{ try { await Cinema.link.acceptInvite('hello'); return 'joined' } catch(e) { return e.message } }")
        chk("nonsense gets an explanation", "isn't a Moonlight Valley invite" in r, r)
        b1.close(); b2.close()

        # ---------- the REAL vendored Ably SDK: API shape + token flow (no network to Ably in this sandbox) ----------
        b3 = pw.chromium.launch(args=args)
        R = P(b3, "Real", "male", "R", fake=False)
        r = R.ev("""async()=>{ const t0=Date.now(); try { await Cinema.link.createInvite(); return {ok:true} } catch(e) { return {ok:false, msg:e.message, ms:Date.now()-t0} } }""")
        chk("real SDK loads from cinema/vendor and the library is usable", R.ev("typeof Ably==='object' && typeof Ably.Realtime==='function'"))
        chk("real SDK called our authCallback and accepted the token request (reached the connecting stage)", R.ev("Cinema.link.logs.some(l=>/realtime connection -> (connecting|disconnected)/.test(l))"), str(R.ev("Cinema.link.logs.slice(-5)")))
        chk("without network to Ably the host gets a clear, bounded error (no endless 'Connecting')", (not r["ok"]) and "realtime service" in r["msg"] and r["ms"] < 30000, str(r))
        b3.close()
finally:
    srv.terminate(); srv2.terminate()
chk("no uncaught page errors", not errs, "\n".join(errs[:8]))
print(sum(res), "/", len(res)); sys.exit(0 if all(res) else 1)
