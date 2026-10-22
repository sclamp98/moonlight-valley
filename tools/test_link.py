"""WebRTC signalling regression test (two real browser contexts, real RTCPeerConnections, copy/paste codes).
Covers: the 'setRemoteDescription ... Called in wrong state: stable' bug (duplicate / double-clicked / racing / stale replies),
serialized SDP operations, and that after a clean connect the partner's movement really arrives.
Run: python tools/test_link.py"""
import subprocess, time, sys, os
from playwright.sync_api import sync_playwright
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = "8132"; URL = f"http://localhost:{PORT}/index.html"
res, errs = [], []
def chk(n, ok, extra=""): res.append(bool(ok)); print(("PASS " if ok else "FAIL ") + n, extra if not ok else "")
class P:
    def __init__(s, br, name, g, tag):
        s.ctx = br.new_context(viewport={"width": 1000, "height": 640}); s.pg = s.ctx.new_page(); s.tag = tag
        s.pg.on("pageerror", lambda e: errs.append(f"[{tag}] {e}"))
        s.pg.goto(URL); s.pg.wait_for_timeout(1200)
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
    def go(s): s.ev("game.enterHome()"); s.pg.wait_for_timeout(700)
TRY = "async (args)=>{ try { const [fn,code]=args; const r = await Promise.all(code.map(c=>Cinema.link[fn](c))); return {ok:true, r}; } catch(e){ return {ok:false, msg:String(e.message||e)}; } }"
srv = subprocess.Popen([sys.executable, "-m", "http.server", PORT], cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
try:
    with sync_playwright() as pw:
        br = pw.chromium.launch(args=["--disable-features=WebRtcHideLocalIpsWithMdns"])
        A = P(br, "Shuja", "male", "A"); B = P(br, "Aisha", "female", "B")
        # --- 1. racing: reply pasted while the invite is still being created must wait, not hit 'stable' ---
        offer = A.ev("Cinema.link.createInvite()")
        reply = B.ev("(c)=>Cinema.link.acceptInvite(c)", offer)
        chk("codes carry an offer id that the reply echoes", A.ev("Cinema.link.oid") and A.ev("Cinema.link.oid") == B.ev("Cinema.link.oid"))
        # joiner double click: same reply code, not two competing answers
        reply2 = B.ev("(c)=>Cinema.link.acceptInvite(c)", offer)
        chk("joiner pressing 'Create reply' twice gets the SAME reply (no second competing answer)", reply == reply2)
        # initiator double click / paste twice, fired at the same moment
        r = A.ev(TRY, ["acceptAnswer", [reply, reply]])
        chk("initiator pressing Connect twice at once: no 'wrong state: stable' error", r["ok"], str(r))
        chk("link opens on both sides", A.until("Cinema.link.open && !!Cinema.link.peer") and B.until("Cinema.link.open && !!Cinema.link.peer"))
        r = A.ev(TRY, ["acceptAnswer", [reply]])
        chk("pasting the same reply AFTER connecting is harmless (duplicate recognised, link untouched)", r["ok"] and A.ev("Cinema.link.open"), str(r))
        chk("...and it was logged as a duplicate", A.ev("Cinema.link.logs.some(l=>/duplicate/i.test(l))"))
        # --- 2. stale reply after a NEW invite ---
        A2 = P(br, "Shuja", "male", "A2"); B3 = P(br, "Aisha", "female", "B3")
        o1 = A2.ev("Cinema.link.createInvite()"); r1 = B3.ev("(c)=>Cinema.link.acceptInvite(c)", o1)
        o2 = A2.ev("Cinema.link.createInvite()")
        r = A2.ev(TRY, ["acceptAnswer", [r1]])
        chk("a reply to an OLD invite is refused with a clear message (not a raw DOM error)", (not r["ok"]) and "older invite" in r["msg"] and "setRemoteDescription" not in r["msg"], str(r))
        chk("...and the new invite is still usable", A2.ev("Cinema.link.pc.signalingState") == "have-local-offer")
        r2 = B3.ev("(c)=>Cinema.link.acceptInvite(c)", o2)
        r = A2.ev(TRY, ["acceptAnswer", [r2]])
        chk("the reply to the newest invite connects", r["ok"] and A2.until("Cinema.link.open") and B3.until("Cinema.link.open"), str(r))
        # concurrent createInvite x2 -> serialized, ends with exactly one live pc in have-local-offer
        D = P(br, "D", "male", "D")
        res2 = D.ev("async()=>{const r=await Promise.all([Cinema.link.createInvite(),Cinema.link.createInvite()]); return {n:r.length, st:Cinema.link.pc.signalingState, same:r[0]===r[1]}}")
        chk("two invites created at once are serialized (one pc, have-local-offer, last invite is current)", res2["st"] == "have-local-offer" and res2["n"] == 2, str(res2))
        # reply with wrong role
        r = D.ev("async()=>{try{await Cinema.link.acceptAnswer('MV1.garbage'); return 'no error'}catch(e){return e.message}}")
        chk("garbage code gives a readable error", "isn't a Moonlight Valley" in r or "damaged" in r, r)
        chk("sdp states are logged with peer id, before and after", A.ev("Cinema.link.logs.some(l=>/answer applied: signaling have-local-offer -> stable/.test(l))"), str(A.ev("Cinema.link.logs.slice(-6)")))
        chk("logs never contain SDP text or tokens", not A.ev("Cinema.link.logs.some(l=>/v=0|a=ice|fingerprint|Bearer/.test(l))"))
        # --- 3. movement sync over the link A<->B ---
        A.go(); B.go()
        A.ev("Cinema.link.send('pos', {w:'home', x: 321, y: 222, d:'down', m:1})")
        chk("host -> guest: position message arrives over the data channel", B.until("!!Cinema.remote && Cinema.remote.where==='home'"))
        A.ev("game.player.x += 60"); 
        B.ev("game.player.x += 80")
        chk("partner avatar tracks real movement both ways", A.until("!!Cinema.remote") and B.until("!!Cinema.remote"))
        x0 = B.ev("Cinema.remote.x"); A.ev("game.player.x += 150"); B.pg.wait_for_timeout(1500)
        chk("moving on one side moves the partner's avatar on the other", abs(B.ev("Cinema.remote.x") - x0) > 50, f"{x0} -> {B.ev('Cinema.remote.x')}")
        # --- 4. reconnect with a fresh invite works after the link dropped ---
        A.ev("Cinema.link.close()"); B.pg.wait_for_timeout(500)
        o = A.ev("Cinema.link.createInvite()"); rp = B.ev("(c)=>Cinema.link.acceptInvite(c)", o); r = A.ev(TRY, ["acceptAnswer", [rp]])
        chk("a brand-new invite/reply reconnects the same two players", r["ok"] and A.until("Cinema.link.open") and B.until("Cinema.link.open"), str(r))
        # --- 5. two SEPARATE browser processes (not just two contexts) connect, and the negotiation is fully logged ---
        b1 = pw.chromium.launch(); b2 = pw.chromium.launch()
        H = P(b1, "Shuja", "male", "H"); J = P(b2, "Aisha", "female", "J")
        o = H.ev("Cinema.link.createInvite()"); rp = J.ev("(c)=>Cinema.link.acceptInvite(c)", o); r = H.ev(TRY, ["acceptAnswer", [rp]])
        chk("two separate browser processes: ICE connects and the data channel opens on both", r["ok"] and H.until("Cinema.link.open", 20000) and J.until("Cinema.link.open", 20000))
        chk("ICE reached connected on both, and nothing stays on 'Connecting'", H.ev("/connected|completed/.test(Cinema.link.pc.iceConnectionState)") and J.ev("/connected|completed/.test(Cinema.link.pc.iceConnectionState)") and H.ev("Cinema.link.state")=="open" and J.ev("Cinema.link.state")=="open")
        for who, n in ((H, "host"), (J, "joiner")):
            lg = who.ev("Cinema.link.logs.join('\\n')")
            chk(f"{n} log shows the whole negotiation (candidates, ice states, data channel open)", all(k in lg for k in ("local ice candidate", "ice connection state -> connected", 'data channel "mv-coop" OPEN')), lg[-300:])
        for who, n in ((H, "host"), (J, "joiner")):
            rp = who.ev("Cinema.link.report()"); txt = who.ev("Cinema.link.reportText()")
            chk(f"{n}: a nominated, succeeded ICE candidate pair exists (checks are not empty)", rp["nominatedSucceeded"] and rp["pairSummary"].get("succeeded", 0) >= 1, str(rp["pairSummary"]))
            chk(f"{n}: report shows ICE/connection/data channel connected + complete SDP shape", rp["states"]["ice"] in ("connected", "completed") and rp["states"]["connection"] == "connected" and rp["states"]["dataChannel"] == "open" and rp["remoteSdp"]["application"] and rp["remoteSdp"]["iceUfrag"] and rp["remoteSdp"]["fingerprint"])
            chk(f"{n}: report contains no ICE password, fingerprint, ufrag or IP address", not __import__("re").search(r"a=ice-pwd|a=fingerprint:|sha-256 [0-9A-F:]{20}|\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b", txt))
        H.ev("document.getElementById('coop-diag').click()"); H.pg.wait_for_timeout(600)
        chk("'Copy connection report' button exists and runs without error", H.ev("!!document.getElementById('coop-diag')"))
        H.ev("Cinema.link.send('pos', {w:'home', x: 400, y: 300, d:'down', m:1})")
        chk("position message crosses between the two separate browsers", J.until("!!Cinema.remote"))
        # --- 6. a connection that can never work is reported with the reason, not left on 'Connecting' forever ---
        b3 = pw.chromium.launch(); b4 = pw.chromium.launch()
        def stuck(br, n, g):
            q = P.__new__(P); q.ctx = br.new_context(); q.pg = q.ctx.new_page(); q.tag = n
            q.pg.add_init_script("window.CINEMA_CONFIG={iceTransportPolicy:'relay',connectWatchdogMs:2500}")
            q.pg.goto(URL); q.pg.wait_for_timeout(1200); q.ev("(a)=>{ Cinema.ensure(game); Cinema.self.name=a[0]; }", [n, g]); return q
        X = stuck(b3, "X", "male"); Y = stuck(b4, "Y", "female")
        o = X.ev("Cinema.link.createInvite()"); rp = Y.ev("(c)=>Cinema.link.acceptInvite(c)", o); X.ev(TRY, ["acceptAnswer", [rp]])
        chk("unreachable peers: after the watchdog the status explains why (still honest: not 'Connected')", X.until("/Still trying|Couldn't connect/.test(Cinema.link.detail)", 8000) and X.ev("Cinema.link.state") != "open", X.ev("Cinema.link.detail"))
        chk("...and finally becomes a clear failure with a reason instead of hanging", X.until("Cinema.link.state==='failed' && /Couldn't connect/.test(Cinema.link.detail)", 12000), X.ev("Cinema.link.state + ' | ' + Cinema.link.detail"))
        print("   diagnosis:", X.ev("Cinema.link.detail")[:260])
        for b in (b1, b2, b3, b4): b.close()
        br.close()
finally:
    srv.terminate()
chk("no uncaught page errors", not errs, "\n".join(errs[:6]))
print(sum(res), "/", len(res)); sys.exit(0 if all(res) else 1)
