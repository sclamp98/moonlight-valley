#!/usr/bin/env python3
"""Cuts the Main Characters Home kit (craftpix) into game sprites -> assets/home/*.png + homeart.js
usage: build_home_assets.py <kit Tiled_files dir> <game dir>"""
import sys, json, colorsys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

KIT, GAME = sys.argv[1], sys.argv[2]
OUT = f"{GAME}/assets/home"
op = lambda n: Image.open(f"{KIT}/{n}").convert("RGBA")
INT, EXT, WALL, DOOR, SMOKE, TREES, BJUMP = (op(n) for n in ["Interior.png", "exterior.png", "walls_floor.png", "Doors_windows_animation.png", "Smoke_animation.png", "Trees_animation.png", "bird_jump_animation.png"])
art = {"int": {}, "ext": {}, "anim": {}}

def crop(im, r): x, y, w, h = r; return im.crop((x, y, x + w, y + h))
def parts(im, r, it=0, minpx=6):
    x0, y0, w, h = r; a = np.array(crop(im, r))[:, :, 3] > 0
    lab, n = ndi.label(ndi.binary_dilation(a, iterations=it) if it else a); out = []
    for s in ndi.find_objects(lab):
        sub = a[s]
        if sub.sum() < minpx: continue
        ys, xs = np.where(sub); y, x = s
        out.append((x0 + x.start + int(xs.min()), y0 + y.start + int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)))
    return sorted(out)
def save(group, name, im, **meta):
    im.save(f"{OUT}/{group}_{name}.png"); art[group][name] = dict(w=im.width, h=im.height, **meta)

# ---------- interior pieces ----------
I = {  # name: rect in Interior.png
 "cabinet": (102, 18, 19, 27), "barrel": (173, 18, 16, 24), "drawer": (139, 23, 13, 19), "crate_s": (194, 23, 13, 17), "stairs": (18, 25, 43, 59),
 "potion_table": (100, 52, 26, 38), "pantry": (22, 101, 51, 55), "bookshelf": (179, 97, 26, 44), "dining": (135, 146, 65, 57), "jug_glass": (27, 165, 18, 36),
 "rack": (52, 168, 24, 32), "weapon_rack": (82, 168, 34, 32), "oval_table": (21, 208, 39, 35), "chair_l": (77, 208, 11, 24), "chair_r": (105, 208, 11, 24),
 "chair_f": (130, 228, 12, 21), "chair_b": (130, 194, 12, 22), "hang_plant": (147, 218, 22, 31), "garlic": (189, 204, 14, 40),
 "rug_round": (26, 262, 94, 83), "rug_red": (142, 265, 52, 62), "runner": (16, 334, 159, 63), "rug_s": (156, 336, 40, 63),
}
def biggest(r):
    ps = parts(INT, r, 0, 30); return max(ps, key=lambda q: q[2] * q[3])
for n, r in I.items():
    if n in ("rug_round", "rug_red", "rug_s"): r = biggest(r)
    if n == "runner": continue
    im = crop(INT, r)
    if n == "rug_round":  # drop the stray corner squares: keep only the biggest connected blob
        a = np.array(im); lab, k = ndi.label(a[:, :, 3] > 0); big = np.argmax(ndi.sum(a[:, :, 3] > 0, lab, range(1, k + 1))) + 1; a[lab != big] = 0; im = Image.fromarray(a)
    save("int", n, im)
# split groups
for k, (n, nm) in enumerate(zip(parts(INT, (132, 51, 60, 39)), ["table", "barrel2", "crate_m"])): save("int", nm, crop(INT, n))
sp = parts(INT, (69, 65, 26, 24)); [save("int", nm, crop(INT, n)) for n, nm in zip(sp, ["stool", "crate_l"])]
sh = parts(INT, (81, 97, 93, 58)); [save("int", nm, crop(INT, n)) for n, nm in zip(sh, ["shelf_a", "shelf_b"])]
# the small decoration row at the bottom of the sheet
deco = parts(INT, (16, 368, 196, 50), 1)
names = ["vase", "pitcher", "bowl_herbs", "pot_plant", "sprout", "sack", "red_pot", "sack_big", "sack_m", "sack_s", "garlic1", "potion_g", "potion_r", "potion_y", "bread"]
for n, nm in zip([d for d in parts(INT, (16, 368, 196, 50), 1)], names): pass
sacks = parts(INT, (16, 368, 196, 50), 1)
print("deco parts", len(sacks), sacks)
for i, r in enumerate(sacks): save("int", f"deco{i}", crop(INT, r))
for nm, r in {"pot_flower": (18, 373, 10, 19), "pitcher": (34, 376, 14, 16), "bowl_herbs": (56, 375, 16, 17), "pot_plant": (87, 377, 16, 17), "sprout": (113, 378, 14, 15),
              "sword_l": (23, 404, 34, 8), "sword_s": (71, 404, 20, 8)}.items(): save("int", nm, crop(INT, r))

# ---------- the double bed: two beds joined, shared frame (one pillow + blanket each) ----------
bed = crop(INT, (67, 16, 23, 39))
left, right = bed.crop((2, 0, 20, 39)), bed.crop((3, 0, 21, 39))
dbl = Image.new("RGBA", (left.width + right.width, 39), (0, 0, 0, 0)); dbl.alpha_composite(left, (0, 0)); dbl.alpha_composite(right, (left.width, 0))
# crop of the single bed starting at col 2 so that pillow is cols 2..16: record geometry
save("int", "bed_single", bed)
save("int", "bed_double", dbl, pillows=[[9, 14], [27, 14]], blanket_y=19, foot_y=36)
# the blanket (rows >= 19) drawn over a sleeper
save("int", "bed_cover", dbl.crop((0, 19, dbl.width, 39)), y=19)

# ---------- room shell ----------
save("int", "wall", crop(WALL, (16, 144, 32, 32)))
fl = crop(WALL, (64, 144, 64, 32)); base = Image.new("RGBA", fl.size, tuple(np.array(fl)[2, 2][:3]) + (255,)); base.alpha_composite(fl); save("int", "floor", base)
save("int", "window_wall", crop(WALL, (135, 147, 17, 20)))
save("int", "edge_bottom", crop(WALL, (112, 205, 48, 19)))
save("int", "void", crop(WALL, (20, 196, 16, 16)))
# doors: 3 variants of 32x32, 6 frames each; windows: 6 frames
for v in range(3):
    st = Image.new("RGBA", (32 * 6, 32), (0, 0, 0, 0))
    for f in range(6): st.alpha_composite(crop(DOOR, (v * 32, f * 32, 32, 32)), (f * 32, 0))
    save("anim", f"door{v}", st, frames=6, fw=32)
win = Image.new("RGBA", (24 * 6, 24), (0, 0, 0, 0))
for f in range(6): win.alpha_composite(crop(DOOR, (104, f * 32 + 2, 24, 24)), (f * 24, 0))
save("anim", "window", win, frames=6, fw=24)
sm = SMOKE; save("anim", "smoke", sm, frames=6, fw=48)

# ---------- exterior ----------
items = json.load(open(sys.argv[3]))  # [id,x,y,w,h]
E = {it[0]: tuple(it[1:]) for it in items}
def rect(i): return E[i]
house = crop(EXT, rect(0)); 
FOLIAGE = {"tree_a": 14, "tree_big": 25, "apple_a": 26, "apple_b": 27, "apple_s": 22, "oak_dark": 53, "oak_dark2": 66, "bush_a": 28, "bush_b": 29, "bush_c": 31, "bush_d": 32, "bush_e": 58,
           "bush_f": 62, "bush_g": 64, "bush_round": 24, "bush_light": 11, "flower_a": 86, "flower_b": 87, "flower_c": 88, "flower_d": 96, "flower_e": 97, "weed": 84, "grass_a": 85}
PLAIN = {"scarecrow": 54, "mush_big": 55, "mush_a": 59, "mush_b": 60, "mush_c": 61, "mush_d": 63, "crates": 50, "crate_one": 56, "log_stand": 57, "log_fall": 65, "rock_a": 67, "rock_b": 68, "rock_c": 69,
         "rock_d": 72, "rock_e": 73, "stump_a": 71, "stump_b": 74, "stump_c": 75, "stone_a": 76, "stone_b": 77, "stone_c": 78, "stone_d": 79, "well": 51, "well2": 52, "boulder_a": 34, "boulder_b": 35,
         "rubble_a": 38, "rubble_b": 39, "pebble_a": 40, "pebble_b": 41, "doormat": 4, "porch_step": 5, "rock_s1": 81, "rock_s2": 82}
def hue_shift(im, f):
    a = np.array(im).astype(float) / 255; out = a.copy()
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx, mn = a[..., :3].max(-1), a[..., :3].min(-1)
    green = (g >= r) & (g >= b) & (mx - mn > 0.06)
    for y, x in zip(*np.where(green & (a[..., 3] > 0))):
        h, s, v = colorsys.rgb_to_hsv(r[y, x], g[y, x], b[y, x]); out[y, x, :3] = colorsys.hsv_to_rgb(*f(h, s, v))
    return Image.fromarray((out * 255).astype(np.uint8))
SEAS = {"spring": lambda h, s, v: (h - 0.015, min(1, s * 0.95), min(1, v * 1.07)),
        "summer": lambda h, s, v: (h, s, v),
        "autumn": lambda h, s, v: (0.095 + (h - 0.25) * 0.35, min(1, s * 1.12), v * 0.98),
        "winter": lambda h, s, v: (0.52, s * 0.18, min(1, 0.55 + v * 0.55))}
def snowy_roof(im):
    a = np.array(im).astype(float)
    red = (a[..., 0] > a[..., 1] + 35) & (a[..., 0] > a[..., 2] + 35) & (a[..., 3] > 0)
    h = a.shape[0]
    for y, x in zip(*np.where(red)):
        t = 0.62; a[y, x, :3] = a[y, x, :3] * (1 - t) + np.array([236, 244, 252]) * t
    return Image.fromarray(a.astype(np.uint8))
for s in SEAS:
    hs = hue_shift(house, SEAS[s]) if s != "summer" else house
    if s == "winter": hs = snowy_roof(hs)
    save("ext", f"house_{s}", hs)
    for n, i in FOLIAGE.items(): save("ext", f"{n}_{s}", hue_shift(crop(EXT, rect(i)), SEAS[s]) if s != "summer" else crop(EXT, rect(i)))
for n, i in PLAIN.items(): save("ext", n, crop(EXT, rect(i)))
# chimney: where the smoke strip (48x48 frames, chimney at frame x16..31,y32..47) overlays the house crop
hx, hy, _, _ = rect(0)
art["house"] = dict(w=house.width, h=house.height, door=[87, 107, 99, 127], doorCx=97, base=127, smoke=[29 - hx, 2 - hy])
# ---------- animated trees (13 frames of 80px) ----------
a = np.array(TREES)[:, :, 3] > 0
band = a[0:80].copy()
for k in range(1, 13): band |= a[80 * k:80 * k + 80]
cols = band.any(0); runs = []; x = 0
while x < len(cols):
    if cols[x]:
        x1 = x
        while x1 < len(cols) and cols[x1]: x1 += 1
        runs.append((x, x1)); x = x1
    else: x += 1
for i, (x0, x1) in enumerate(runs):
    sub = band[:, x0:x1]; ys = np.where(sub.any(1))[0]; y0, y1 = int(ys.min()), int(ys.max()) + 1; w, h = x1 - x0, y1 - y0
    if w * h < 400: continue
    st = Image.new("RGBA", (w * 13, h), (0, 0, 0, 0))
    for k in range(13): st.alpha_composite(TREES.crop((x0, 80 * k + y0, x1, 80 * k + y1)), (k * w, 0))
    for sn in SEAS: save("anim", f"tree{i}_{sn}", hue_shift(st, SEAS[sn]) if sn != "summer" else st, frames=13, fw=w, foot=h)
    print("tree", i, x0, y0, w, h)
# ---------- crow hop strip ----------
cr = BJUMP.crop((0, 0, 640, 16)); save("anim", "crow", cr, frames=40, fw=16)

with open(f"{GAME}/homeart.js", "w") as f: f.write("const HOME_ART = " + json.dumps(art) + ";\n")
print("ok", {k: len(v) for k, v in art.items() if isinstance(v, dict)})
