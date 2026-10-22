import asyncio
from playwright.async_api import async_playwright
RES=[]
def check(n,c,i=""): RES.append(c); print(("PASS " if c else "FAIL ")+n, i)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(viewport={"width":1280,"height":800})
        errs=[]; pg.on("pageerror",lambda e:errs.append(str(e))); pg.on("console",lambda m: errs.append(m.text) if m.type=="error" else None)
        await pg.goto("http://localhost:8123/index.html"); await pg.wait_for_timeout(1500)
        q=lambda s: pg.evaluate(s)
        # go to Willow Village, stand at armory door
        await q("()=>{game.enterPage('-1,0'); const a=game.objects.find(o=>o.role==='weapons'); window.AR=a; game.player.x=a.doorX-15; game.player.y=a.baseY+25; game.beginPage(); game.camera.follow(game.player,game.world,0,true); game.coins=5000;}")
        await pg.wait_for_timeout(600)
        check("armory exists with role weapons", await q("()=>!!AR && AR.label==='Ironleaf Armory'"))
        await pg.screenshot(path="shots/w1_armory.png")
        await pg.keyboard.press("e"); await pg.wait_for_timeout(400)
        check("E opens weapon shop", await q("()=>game.uiMode==='shop' && game.shopCat==='weapons' && document.getElementById('shop-title').textContent==='Ironleaf Armory'"))
        rows=await q("()=>[...document.querySelectorAll('#shop-buy-list .cook-row')].map(r=>r.innerText.replace(/\\n/g,' | '))")
        print(rows)
        check("shop lists all 8 weapons + 4 ammo, no seeds", len(rows)==12 and not any('Seeds' in r for r in rows), len(rows))
        await pg.screenshot(path="shots/w2_shop.png")
        # buy all
        r=await q("""()=>{const g=game; g.inventory.slots.fill(null); const c0=g.coins; const out={};
          for (const id of ['dagger','spear','steel_sword','war_axe','bow','crossbow','pistol','shotgun','arrow','bolt','bullet','shell']) { const b=g.coins; g.buyItem(id); out[id]=[b-g.coins, g.inventory.countOf(id)]; }
          return out}""")
        print(r)
        check("prices charged, ammo comes in packs", r['dagger']==[90,1] and r['arrow']==[30,10] and r['bullet']==[80,12] and r['shell']==[72,6] and r['pistol']==[520,1])
        r=await q("()=>{const g=game; g.coins=10; const n=g.inventory.countOf('pistol'); g.buyItem('pistol'); return [n,g.inventory.countOf('pistol'),g.coins]}")
        check("can't buy without coins", r==[1,1,10], r)
        await q("()=>{game.closeAllPanels()}")
        # damage table
        dm=await q("()=>Object.fromEntries(Object.entries(WEAPONS).map(([k,w])=>[k,[w.damage*(w.ranged&&w.ranged.pellets||1), w.cooldown]]))")
        print(dm)
        check("every weapon has a distinct damage profile", len({tuple(v) for v in dm.values()})==len(dm))
        # combat tests on farm page
        await q("()=>{game.enterPage('0,0'); game.player.x=2100; game.player.y=1330; game.beginPage(); game.time=21; game.syncNight(); game.monsters.list=[]; game.energy=100;}")
        async def kill_test(wid, dist):
            return await pg.evaluate("""([wid,dist])=>{const g=game,p=g.player; g.weapon=WEAPONS[wid]; p.attackTimer=0; p.face={x:1,y:0}; g.monsters.list=[]; 
              const m=new Monster('big', p.cx+dist-27, p.cy-27, g.world); m.hp=1000; m.maxHp=1000; g.monsters.list.push(m); g.projectiles=[]; g.attack(null); window.M=m; return 1}""",[wid,dist])
        for wid,dist in [("sword",50),("dagger",40),("steel_sword",55),("war_axe",55),("spear",90)]:
            await kill_test(wid,dist); await pg.wait_for_timeout(100)
            d=await q("()=>1000-M.hp"); check(f"melee {wid} deals {WEAPONS_DMG[wid]}", d==WEAPONS_DMG[wid], d)
        # ranged: ammo consumption + damage on hit
        for wid,dist,ammo,n in [("bow",300,"arrow",1),("crossbow",300,"bolt",1),("pistol",300,"bullet",1),("shotgun",100,"shell",1)]:
            a0=await q(f"()=>game.inventory.countOf('{ammo}')")
            await kill_test(wid,dist); await pg.wait_for_timeout(700)
            a1=await q(f"()=>game.inventory.countOf('{ammo}')"); d=await q("()=>1000-M.hp")
            exp=WEAPONS_DMG[wid]
            check(f"ranged {wid}: 1 {ammo} used, hit for ~{exp}", a0-a1==1 and (d==exp if wid!='shotgun' else 14<=d<=84 and d%14==0), [d,a0-a1])
        # out of ammo
        r=await q("""()=>{const g=game,p=g.player; g.inventory.removeById('bullet', g.inventory.countOf('bullet')); g.weapon=WEAPONS.pistol; p.attackTimer=0; g.projectiles=[]; g.attack(null); return [g.projectiles.length, g.inventory.countOf('bullet')]}""")
        check("no ammo: no shot fired", r==[0,0], r)
        # projectile stops on wall
        r=await q("""()=>{const g=game,p=g.player; g.inventory.add('arrow',3); g.weapon=WEAPONS.bow; p.attackTimer=0; p.face={x:0,y:-1}; p.x=2100; p.y=1330; g.monsters.list=[]; g.attack(null); const n=g.projectiles.length; for(let i=0;i<120;i++) g.updateProjectiles(1/60,g.getSolids()); return [n,g.projectiles.length]}""")
        check("arrows expire / hit scenery", r[0]==1 and r[1]==0, r)
        # real input: click to shoot via hotbar
        await q("()=>{const g=game; g.inventory.slots.fill(null); g.inventory.add('pistol',1); g.inventory.add('bullet',12); g.sel=0; g.monsters.list=[]; g.player.attackTimer=0; g.player.x=2100; g.player.y=1330; g.camera.follow(g.player,g.world,0,true);}")
        await pg.mouse.move(900,400); await pg.mouse.down(); await pg.wait_for_timeout(60); await pg.mouse.up()
        await pg.wait_for_timeout(40); await pg.screenshot(path="shots/w3_fire.png")
        check("mouse click fires toward cursor", await q("()=>game.inventory.countOf('bullet')")==11)
        await q("()=>{const g=game; g.inventory.slots.fill(null); g.inventory.add('war_axe',1); g.sel=0; g.player.attackTimer=0; g.player.face={x:1,y:0};}")
        await pg.mouse.move(900,400); await pg.mouse.down(); await pg.wait_for_timeout(60); await pg.mouse.up(); await pg.wait_for_timeout(60); await pg.screenshot(path="shots/w4_swing.png")
        # save/load keeps weapons
        await q("()=>{game.inventory.add('bow',1); game.inventory.add('arrow',7); game.saveGame(true)}")
        await pg.reload(); await pg.wait_for_timeout(1200)
        check("weapons + ammo persist in save", await q("()=>[game.inventory.countOf('bow'),game.inventory.countOf('arrow')]")==[1,7])
        check("no page errors", not errs, errs[:3])
        await b.close()
    print(sum(RES),"/",len(RES))
WEAPONS_DMG={"sword":26,"dagger":16,"steel_sword":40,"war_axe":70,"spear":32,"bow":24,"crossbow":48,"pistol":30,"shotgun":14}
asyncio.run(main())
