"""Breakable scenery: trees, rocks, crates, bushes, flowers, mushrooms, fences... break and drop their materials.

    python3 -m http.server 8123      # in the game folder
    python3 tools/test_breakables.py
"""
import asyncio, json, sys
from playwright.async_api import async_playwright

RES = []
def check(name, cond, info=""):
    RES.append((name, bool(cond))); print(("PASS " if cond else "FAIL ") + name, info)

HELPERS = """() => {
  window.TT = {
    // stand just left of a point (x, y), facing right, with full energy and no cooldown
    at(x, y) { const g = game, p = g.player; p.x = x - 34 - p.w / 2; p.y = y - p.h / 2; p.face = { x: 1, y: 0 }; p.dirKey = 'right'; p.attackTimer = 0; g.energy = 100; g.uiMode = null; },
    standAt(pr) { TT.at(pr.cx0, pr.baseY - Math.max(pr.h, 10) / 2); },
    swing() { game.player.attackTimer = 0; game.energy = 100; game.useSelected(); },
    prop(kind) { return game.village.props.find((p) => p.bid && p.bid.split('@')[0] === kind && !p.pop); },
    counts(ids) { const o = {}; for (const id of ids) o[id] = game.inventory.countOf(id); return o; },
    clearBag() { game.inventory.slots.fill(null); game.inventory.add('axe', 1); game.sel = 0; },
  };
  return true;
}"""

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); ctx = await b.new_context(viewport={"width": 1280, "height": 800}); pg = await ctx.new_page()
        errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto("http://localhost:8123/index.html"); await pg.wait_for_timeout(1500)
        q = lambda s, a=None: pg.evaluate(s, a)
        await q(HELPERS)
        await q("() => { TT.clearBag(); }")

        # ---- 0. every kind of scenery is armed with a recipe, ids are unique ----
        kinds = await q("""() => { const m = {}; for (const p of game.village.props) if (p.bid) { const k = p.bid.split('@')[0]; m[k] = (m[k] || 0) + 1; } return m; }""")
        print("breakable props on the farm page:", kinds)
        check("bushes, fences, planters, crates, rocks, stumps, logs, mushrooms, flowers, scarecrow, swaying trees all breakable",
              all(k in kinds for k in ["bush", "fence", "fence_post", "planter", "crates", "rock_b", "stone_a", "stump_b", "log_fall", "mush_a", "mush_b", "flower_a", "scarecrow", "tree"]), list(kinds))
        check("not breakable: well, lanterns, houses", not any(k in kinds for k in ["well", "lantern", "house"]))
        check("prop ids are unique", await q("() => { const ids = game.village.props.filter(p => p.bid).map(p => p.bid); return new Set(ids).size === ids.length; }"))

        # ---- 1. each kind: takes exactly hp axe hits, stops blocking when it breaks, drops the right stuff, then disappears ----
        expect = {  # kind: {item: (min, max)}
            "crates": {"plank": (3, 4)}, "rock_b": {"stone": (3, 4)}, "stone_a": {"stone": (2, 3)}, "flower_a": {"flower": (1, 1)},
            "mush_a": {"mushroom": (1, 1)}, "bush_c": {"stick": (1, 2), "fiber": (1, 2)}, "scarecrow": {"fiber": (2, 3), "stick": (1, 2)},
            "log_fall": {"wood": (2, 3)}, "stump_b": {"wood": (1, 2)}, "fence": {"plank": (1, 1)}, "fence_post": {"stick": (1, 2)},
            "planter": {"plank": (2, 2)}, "tree": {"wood": (5, 7), "stick": (1, 2)},
        }
        ITEMS = ["stone", "flower", "mushroom", "plank", "fiber", "stick", "wood"]
        broken_ids = []
        for kind, want in expect.items():
            await q("() => TT.clearBag()")
            r = await pg.evaluate("""([kind, IT]) => {
              const pr = TT.prop(kind); if (!pr) return null;
              const hp = pr.bhp, id = pr.bid, before = TT.counts(IT); TT.standAt(pr);
              let swings = 0; while (!pr.pop && swings < 20) { TT.swing(); swings++; }
              const solidAfter = game.village.solids.includes(pr);
              const after = TT.counts(IT); const d = {}; for (const k in after) d[k] = after[k] - before[k];
              return { id, hp, swings, solidAfter, d, broke: !!pr.pop };
            }""", [kind, ITEMS])
            if r is None:
                check(f"{kind}: exists on this page", False); continue
            in_range = all(want[k][0] <= r["d"][k] <= want[k][1] for k in want)
            nothing_else = all(r["d"][k] == 0 for k in ITEMS if k not in want)
            ok_drops = in_range and nothing_else
            check(f"{kind}: breaks after exactly {r['hp']} axe hits", r["broke"] and r["swings"] == r["hp"], f"swings={r['swings']}")
            check(f"{kind}: stops blocking the moment it breaks", not r["solidAfter"])
            check(f"{kind}: drops its material {want}", ok_drops, r["d"])
            broken_ids.append(r["id"])
        await pg.wait_for_timeout(1200)
        gone = await q("(ids) => ids.filter((id) => game.village.props.some((p) => p.bid === id))", broken_ids)
        check("broken props are removed from the world after their animation", gone == [], gone)

        # ---- 2. the old axe -> tree behaviour is unchanged ----
        await q("() => TT.clearBag()")
        r = await q("""() => { const t = game.village.trees.find((t) => !t.stump && t.stage === 2 && !t.fall); const hp = t.hp; TT.at(t.cx0, t.baseY - 12);
              let n = 0; while (!t.fall && n < 20) { TT.swing(); n++; }
              return { n, hp, wood: game.inventory.countOf('wood'), expected: WORLD.TREE.wood[2] }; }""")
        check("big tree: still 6 hits for 7 wood", r["n"] == r["hp"] == 6 and r["wood"] == 7, r)

        # ---- 3. scattered ground flowers (painted into the grass layer) ----
        await q("() => TT.clearBag()")
        season = await q("() => FP.season")
        r = await q("""() => {
          const a = game.village, S3 = 3, T = 48, free = (x, y) => { const r = { x: x - 26, y: y - 26, w: 52, h: 52 }; return !a.propAt(r) && !a.treeAt(r); };
          const f = a.flowers.find((f) => !f.gone && a.ter[f.ty * a.W + f.tx] === FP.GRASS && free((f.tx * 16 + f.ox + 8) * S3, (f.ty * 16 + f.oy + 8) * S3) && a.flowerAt({ x: (f.tx * 16 + f.ox + 8) * S3 - 26, y: (f.ty * 16 + f.oy + 8) * S3 - 26, w: 52, h: 52 }));
          if (!f) return null;
          const x = (f.tx * 16 + f.ox + 8) * S3, y = (f.ty * 16 + f.oy + 8) * S3; TT.at(x, y); TT.swing();
          return { gone: f.gone, flower: game.inventory.countOf('flower'), season: FP.season };
        }""")
        check("a wildflower on the ground can be picked (drops 1 flower)", r and r["gone"] and r["flower"] == 1, r)

        # ---- 4. weapons break scenery too (a war axe hits 3x as hard); a monster in the way gets the hit instead ----
        await q("() => { TT.clearBag(); game.inventory.add('war_axe', 1); game.inventory.add('stick', 1); game.sel = 1; }")
        r = await q("""() => { const pr = TT.prop('fence'); if (!pr) return null;
              pr.bhp = 3; TT.standAt(pr); TT.swing(); return { kind: pr.bid, broke: !!pr.pop }; }""")
        check("war axe (3 dmg) breaks a 3-hp prop in ONE swing", r and r["broke"], r)
        await q("() => { game.sel = 2; }")
        r = await q("""() => { const pr = game.village.props.find((p) => p.brk && p.brk.hp === 2 && !p.pop && p.bhp === 2 && p.bid.startsWith('bush')); if (!pr) return null;
              TT.standAt(pr); TT.swing(); const h1 = pr.bhp; TT.swing(); return { h1, broke: !!pr.pop, name: game.weaponId }; }""")
        check("a wooden stick (1 dmg) breaks a 2-hp bush in two swings", r and r["h1"] == 1 and r["broke"], r)
        await q("() => { TT.clearBag(); game.inventory.add('stick', 1); game.sel = 1; }")
        r = await q("""() => { const pr = TT.prop('stump_b') || TT.prop('mush_b') || TT.prop('flower_b'); if (!pr) return null; const hp0 = pr.bhp; TT.standAt(pr);
              const m = new Monster('big', pr.cx0 - 20, pr.baseY - 50, game.world); game.monsters.list.push(m);
              const mh = m.hp; TT.swing(); return { monsterHit: m.hp < mh, propUntouched: pr.bhp === hp0 && !pr.pop }; }""")
        check("with a monster in the swing, the monster is hit and the scenery is left alone", r and r["monsterHit"] and r["propUntouched"], r)
        await q("() => { game.monsters.list.length = 0; }")

        # ---- 5. a full bag never loses the loot ----
        await q("() => { game.inventory.slots.fill({ id: 'gem', qty: 1 }); game.sel = 0; game.inventory.slots[0] = { id: 'axe', qty: 1 }; }")
        r = await q("""() => { const pr = TT.prop('flower_b') || TT.prop('mush_b') || TT.prop('flower_c') || TT.prop('flower_d'); if (!pr) return null; TT.standAt(pr);
              const n0 = game.objects.filter((o) => o instanceof DroppedItem).length; let n = 0; while (!pr.pop && n < 5) { TT.swing(); n++; }
              const drops = game.objects.filter((o) => o instanceof DroppedItem);
              return { dropped: drops.length - n0, ids: drops.map((d) => d.id), inBag: game.inventory.countOf('flower') + game.inventory.countOf('mushroom') }; }""")
        check("full bag: the material is dropped on the ground instead of vanishing", r and r["dropped"] == 1 and r["inBag"] == 0, r)
        r = await q("""() => { const d = game.objects.find((o) => o instanceof DroppedItem && ['flower', 'mushroom'].includes(o.id)); game.inventory.slots[5] = null; d.onInteract(game);
              return { pickedUp: !game.objects.includes(d), inBag: game.inventory.countOf(d.id) }; }""")
        check("...and walking up and pressing E picks it up once there is room", r["pickedUp"] and r["inBag"] == 1, r)

        # ---- 6. it all survives saving + reloading the page ----
        await q("() => { TT.clearBag(); game.saveGame(true); }")
        saved = await q("() => { const s = JSON.parse(localStorage.getItem(CONFIG.SAVE_KEY)).pages['0,0']; return { broken: s.broken, fgone: s.fgone }; }")
        check("save file lists what was broken", len(saved["broken"]) >= len(broken_ids) and len(saved["fgone"]) >= 1, {k: len(v) for k, v in saved.items()})
        await pg.reload(); await pg.wait_for_timeout(1800); await q(HELPERS)
        r = await q("""(ids) => ({ stillThere: ids.filter((id) => game.village.props.some((p) => p.bid === id)), fgone: game.village.flowers.filter((f) => f.gone).length,
                                 solids: ids.filter((id) => game.village.solids.some((s) => s.bid === id)) })""", broken_ids)
        check("after reload everything that was broken is still gone (and no longer blocks)", r["stillThere"] == [] and r["solids"] == [] and r["fgone"] >= 1, r)
        check("...while untouched scenery is still there", await q("() => game.village.props.filter((p) => p.brk).length") > 50)

        # ---- 7. new items look right: icons exist and show in the bag ----
        r = await q("""() => { const out = {}; for (const id of ['stone', 'flower', 'mushroom', 'plank', 'fiber']) { const d = ITEMS[id]; out[id] = !!d && d.type === 'material' && !!SHOP_ITEMS[id]; } return out; }""")
        check("5 new materials defined as items and sellable", all(r.values()), r)
        check("no page errors during the whole run", not errs, errs[:3])
        await b.close()

    bad = [n for n, ok in RES if not ok]
    print(f"\n{len(RES) - len(bad)}/{len(RES)} passed"); sys.exit(1 if bad else 0)

asyncio.run(main())
