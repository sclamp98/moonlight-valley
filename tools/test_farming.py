import asyncio, json
from playwright.async_api import async_playwright
RES=[]
def check(name, cond, info=""):
    RES.append((name, bool(cond))); print(("PASS " if cond else "FAIL ")+name, info)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); ctx=await b.new_context(viewport={"width":1280,"height":800}); pg=await ctx.new_page()
        errs=[]; pg.on("pageerror",lambda e:errs.append(str(e)))
        await pg.goto("http://localhost:8123/index.html"); await pg.wait_for_timeout(1500)
        q=lambda s: pg.evaluate(s)
        # setup: a tilled patch of 6 tiles on farm
        await q("()=>{game.setDay(5);window.T0=[[10,40],[11,40],[12,40],[13,40],[14,40],[15,40]]; game.energy=100; game.farm.constructor; }")
        # 1 till sets timer
        r=await q("()=>{const f=game.farm; T0.forEach(([x,y])=>f.till(x,y)); return T0.map(([x,y])=>f.since[f.idx(x,y)])}")
        check("till starts reset timer", all(v>=0 for v in r), r[:1])
        # 2 plant cancels timer; seeds consumed
        r=await q("()=>{const f=game.farm; f.plant(10,40,1); f.plant(11,40,2); return [f.since[f.idx(10,40)],f.since[f.idx(11,40)],f.since[f.idx(12,40)]>=0]}")
        check("planting cancels timer, untouched tilled tile keeps it", r[0]==-1 and r[1]==-1 and r[2]==True, r)
        # 3 growing crops never reset after 3 in-game days of elapsed clock
        r=await q("()=>{const f=game.farm; f.expire(FP.absTime()+24*3); return [f.hasSoil(10,40),f.cropAt(10,40),f.hasSoil(11,40),f.hasSoil(12,40)]}")
        check("crops not reset; empty tilled tile reset after >=24h", r[0] and r[1]==1 and r[2] and r[3]==False, r)
        # 4 not reset before 24h
        r=await q("()=>{const f=game.farm; f.till(20,40); const n=f.expire(FP.absTime()+23.9); const a=f.hasSoil(20,40); const m=f.expire(FP.absTime()+24); return [n,a,m,f.hasSoil(20,40)]}")
        check("exactly 24 game-hours: not at 23.9, yes at 24", r==[0,True,1,False], r)
        # 5 untouched ground unchanged
        r=await q("()=>{const f=game.farm; const before=f.soil.reduce((a,b)=>a+b,0); f.expire(1e6); return [before, f.soil.reduce((a,b)=>a+b,0), f.hasSoil(30,10)]}")
        check("untouched ground unaffected", r[2]==False)
        # 6 harvest: ripe wheat gives produce + 1..3 seeds
        await q("()=>{const f=game.farm; game.inventory.slots.fill(null);}")
        counts=[]
        for i in range(60):
            c=await q("""()=>{const f=game.farm,g=game; f.till(40,45); f.plant(40,45,1); f.grown[f.idx(40,45)]=4; const w0=g.inventory.countOf('wheat'), s0=g.inventory.countOf('seeds');
              const r=g.harvestAt(f,40,45); return [r&&r.seeds, g.inventory.countOf('wheat')-w0, g.inventory.countOf('seeds')-s0, f.cropAt(40,45), f.since[f.idx(40,45)]>=0]}""")
            counts.append(c)
        check("every wheat harvest: +1 wheat, seeds in 1..3", all(c[1]==1 and 1<=c[2]<=3 and c[0]==c[2] for c in counts))
        check("all of 1,2,3 seeds occur", {c[2] for c in counts}=={1,2,3}, sorted({c[2] for c in counts}))
        check("harvested tile empty and reset timer restarted", all(c[3]==0 and c[4] for c in counts))
        # 7 duplicate harvest
        r=await q("""()=>{const f=game.farm,g=game; g.inventory.slots.fill(null); f.till(41,45); f.plant(41,45,1); f.grown[f.idx(41,45)]=4;
           const a=g.harvestAt(f,41,45), b=g.harvestAt(f,41,45), c=g.harvestAt(f,41,45); return [!!a,b,c,g.inventory.countOf('wheat'),g.inventory.countOf('seeds')===a.seeds]}""")
        check("no duplicate harvest / seed reward", r[0] and r[1] is None and r[2] is None and r[3]==1 and r[4], r)
        # 8 tomato regrow: seeds every harvest, crop remains, no timer
        r=await q("""()=>{const f=game.farm,g=game; g.inventory.slots.fill(null); f.till(42,45); f.plant(42,45,2); f.grown[f.idx(42,45)]=6;
           const a=g.harvestAt(f,42,45); const s1=g.inventory.countOf('tomato_seeds'); f.grown[f.idx(42,45)]=6; f.flag[f.idx(42,45)]=2; const b=g.harvestAt(f,42,45);
           return [a.item,a.seeds>=1, f.cropAt(42,45), f.since[f.idx(42,45)], g.inventory.countOf('tomato'), g.inventory.countOf('tomato_seeds')>s1]}""")
        check("tomato harvest: produce+seeds each time, regrows, no reset timer", r[0]=="tomato" and r[1] and r[2]==2 and r[3]==-1 and r[4]==2 and r[5], r)
        # 9 configurable seed yield
        r=await q("""()=>{const old=CROPS.wheat.seedYield; CROPS.wheat.seedYield=[5,5]; const f=game.farm,g=game; g.inventory.slots.fill(null); f.till(43,45); f.plant(43,45,1); f.grown[f.idx(43,45)]=4; const a=g.harvestAt(f,43,45); CROPS.wheat.seedYield=old;
           const d=g.rollSeeds({}, ()=>0.999); const e=g.rollSeeds({}, ()=>0); return [a.seeds,d,e]}""")
        check("per-crop seedYield override + default 1-3", r==[5,3,1], r)
        # 10 inventory full: atomic
        r=await q("""()=>{const f=game.farm,g=game; g.inventory.slots.fill(null); for(let i=0;i<g.inventory.size;i++) g.inventory.slots[i]={id:'wood',qty:1};
           g.inventory.slots[0]={id:'wheat',qty:1}; f.till(44,45); f.plant(44,45,1); f.grown[f.idx(44,45)]=4; const a=g.harvestAt(f,44,45);
           return [a, f.isRipe(44,45), g.inventory.countOf('wheat'), g.inventory.countOf('seeds')]}""")
        check("full bag (wheat stack exists, seeds don't fit): nothing changes", r[0] is None and r[1] and r[2]==1 and r[3]==0, r)
        r=await q("""()=>{const f=game.farm,g=game; g.inventory.slots[1]=null; const a=g.harvestAt(f,44,45); return [!!a, g.inventory.countOf('wheat'), g.inventory.countOf('seeds')>=1]}""")
        check("with room it harvests fine", r[0] and r[1]==2 and r[2], r)
        # 11 real input path: E on ripe tile (useTile)
        r=await q("""()=>{const f=game.farm,g=game; g.inventory.slots.fill(null); f.till(12,41); f.plant(12,41,1); f.grown[f.idx(12,41)]=4; const T=48; g.player.x=12*T+9; g.player.y=40*T+12; g.player.dirKey='down'; g.tile={tx:12,ty:41};
           g.useTile(); return [g.inventory.countOf('wheat'), g.inventory.countOf('seeds'), g.crops]}""")
        check("E on ripe crop (useTile) gives produce + seeds", r[0]==1 and 1<=r[1]<=3, r)
        # 12 plant with seed item decrements, then harvest returns more seeds -> manageable loop
        r=await q("""()=>{const g=game,f=g.farm; g.inventory.slots.fill(null); g.inventory.add('seeds',1); g.inventory.add('hoe',1); g.sel=0; f.till(13,41); g.player.x=13*48+9; g.player.y=40*48+3; g.player.dirKey='down'; g.player.attackTimer=0; 
           g.sel=0; g.useSelected(); return [g.inventory.countOf('seeds'), f.cropAt(13,41), f.since[f.idx(13,41)]]}""")
        check("planting from inventory consumes seed and cancels timer", r==[0,1,-1], r)
        # 13 day transition: sleeping triggers expiry & growth
        r=await q("""()=>{const g=game,f=g.farm; f.till(30,44); f.since[f.idx(30,44)]=FP.absTime()-20; g.time=18; const d0=g.dayIndex; g.newDay(); return [g.dayIndex-d0, f.hasSoil(30,44)]}""")
        check("new day: tile idle 20h+ (6h to dawn) resets across the day change", r[0]==1 and r[1]==False, r)
        r=await q("""()=>{const g=game,f=g.farm; g.time=9; f.till(31,44); g.time=17; const d0=g.dayIndex; g.newDay(); return [f.hasSoil(31,44)]}""")
        check("tile tilled the same evening survives first dawn (<24h)", r[0]==True, r)
        r=await q("""()=>{const g=game,f=g.farm; g.time=17; g.newDay(); return [f.hasSoil(31,44)]}""")
        check("...and resets by the following dawn (>=24h)", r[0]==False, r)
        # 14 continuous tick in update
        r=await q("()=>{const g=game,f=g.farm; f.till(32,44); f.since[f.idx(32,44)]=FP.absTime()-24.5; return 1}")
        await pg.wait_for_timeout(1500)
        check("live clock check resets expired tiles while playing", await q("()=>!game.farm.hasSoil(32,44)"))
        # 15 unloaded page catches up
        r=await q("""()=>{const g=game; const pgx=g.getPage('1,0'); pgx.farm.till(5,5); pgx.farm.since[pgx.farm.idx(5,5)]=FP.absTime()-3; pgx.farm.till(6,5); pgx.farm.plant(6,5,1); g.time=18; g.newDay(); return [pgx.farm.hasSoil(5,5), pgx.farm.hasSoil(6,5)]}""")
        check("other page: empty tile reset, planted tile kept", r==[False,True], r)
        # 16 save / load persistence
        await q("""()=>{const g=game,f=g.farm; g.inventory.slots.fill(null); g.inventory.add('seeds',7); f.till(50,45); f.till(51,45); f.plant(51,45,2); f.grown[51+45*72]=3; g.saveGame(true); window.SNAP={since:f.since[f.idx(50,45)], now:FP.absTime(), day:g.dayIndex}}""")
        snap=await q("()=>SNAP")
        await pg.reload(); await pg.wait_for_timeout(1500)
        r=await q("""()=>{const f=game.farm; return [f.hasSoil(50,45), f.since[f.idx(50,45)], f.cropAt(51,45), f.grown[f.idx(51,45)], f.since[f.idx(51,45)], game.inventory.countOf('seeds'), game.dayIndex]}""")
        check("save/load: soil, crop type, growth stage, seed count, timer", r[0] and abs(r[1]-snap['since'])<1e-3 and r[2]==2 and r[3]==3 and r[4]==-1 and r[5]==7 and r[6]==snap['day'], r)
        # 17 legacy save without 'since' gets timers armed
        await q("""()=>{const raw=JSON.parse(localStorage.getItem(CONFIG.SAVE_KEY)); for(const id in raw.pages){ if(raw.pages[id].farm) delete raw.pages[id].farm.since;} localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(raw));}""")
        await pg.reload(); await pg.wait_for_timeout(1500)
        r=await q("()=>{const f=game.farm; return [f.hasSoil(50,45), f.since[f.idx(50,45)]>=0]}")
        check("old save (no timers): tilled tiles keep soil and get a fresh timer", r==[True,True], r)
        # 18 shop economy intact
        r=await q("()=>[SHOP_ITEMS.wheat.sell, SHOP_ITEMS.seeds.buy, SHOP_ITEMS.hoe.buy, SHOP_ITEMS.can.buy, SHOP_ITEMS.axe.buy]")
        check("shop: sells produce, buys seeds and tools", r[0]>0 and r[1]>0 and r[2]>0 and r[3]>0 and r[4]>0, r)
        check("no page errors", not errs, errs[:3])
        await b.close()
    print(sum(1 for _,c in RES if c),"/",len(RES),"passed")
asyncio.run(main())
