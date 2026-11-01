"""Cuts the sprites for the redesigned Main Hall + Gaming Room out of the supplied sprite sheets, byte-for-byte.
Usage: python tools/build_hall_assets.py <folder with the supplied PNG/GIF sheets>      (default /tmp/assets_x/assest)
What it does (and nothing else):  finds each sprite on its sheet (connected non-background pixels), crops it, drops the sheet's flat beige
background to transparent, turns the sheet's single flat shadow colour into the same 26% black shadow it was drawn with, and halves the
size (the sheets are 2x pixel-art) so one art pixel = one pixel, exactly like the rest of the game's art.  No recolouring, no filtering.
Animated props are cut frame-by-frame from Animations.gif into one horizontal strip each.   Writes assets/hall/*.png and hallart.js."""
import sys, os, json
import numpy as np
from PIL import Image, ImageSequence
from scipy import ndimage as ndi

SRC = (sys.argv[1] if len(sys.argv) > 1 else "/tmp/assets_x/assest").rstrip("/") + "/"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "hall"); os.makedirs(OUT, exist_ok=True)
BG = np.array([232, 214, 184]); SH = np.array([171, 155, 130])

def comps_of(mask):
    m = mask.copy(); m[:44] = False
    d = ndi.binary_dilation(m, structure=np.ones((3, 3)), iterations=3)
    lab, n = ndi.label(d); res = []
    for i, sl in enumerate(ndi.find_objects(lab)):
        y0, y1, x0, x1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
        sub = m[y0:y1, x0:x1] & (lab[y0:y1, x0:x1] == i + 1); ys, xs = np.where(sub)
        if len(ys): res.append([int(x0 + xs.min()), int(y0 + ys.min()), int(x0 + xs.max() + 1), int(y0 + ys.max() + 1)])
    res.sort(key=lambda c: (c[1] // 40, c[0])); return res

def to_rgba(rgb):   # rgb: HxWx3 int array (sheet pixels) -> RGBA, bg transparent, flat shadow colour -> 26% black
    h, w, _ = rgb.shape; out = np.zeros((h, w, 4), np.uint8)
    isbg = (np.abs(rgb - BG).sum(axis=2) == 0); issh = (np.abs(rgb - SH).sum(axis=2) == 0)
    out[..., :3] = rgb; out[isbg] = 0; out[issh] = (0, 0, 0, 67)
    out[~isbg & ~issh, 3] = 255; return out

def halve(a): return a[::2, ::2]

# ---- static sprites: name -> (sheet, component id) ----
SHEETS = {"furn": "Furniture.png", "decor": "Decor.png", "office": "Office, kids, household and pets.png"}
STATIC = {
 # main hall
 "bookshelf": ("furn", 4), "floor_lamp": ("furn", 11), "tv_console": ("furn", 13), "console_flowers": ("furn", 23), "piano": ("furn", 18),
 "armchair_a": ("furn", 19), "armchair_b": ("furn", 20), "guitar": ("furn", 21), "sofa_teal": ("furn", 27), "side_table": ("furn", 46),
 "coffee_table": ("furn", 47), "pouf_teal": ("furn", 55), "stool_red": ("furn", 57), "magazine_rack": ("furn", 53), "fireplace_static": ("furn", 17),
 "bed": ("furn", 69), "nightstand": ("furn", 92), "dining_table": ("furn", 109), "chair_dn": ("furn", 118), "chair_dn2": ("furn", 117),
 "plant_big": ("decor", 3), "plant_fiddle": ("decor", 4), "plant_palm": ("decor", 1), "plant_snake": ("decor", 14), "cactus": ("decor", 16),
 "rug_red": ("decor", 42), "rug_runner": ("decor", 40), "rug_green_round": ("decor", 56), "mat_home": ("decor", 65),
 "cuckoo": ("decor", 69), "coat_rack": ("decor", 72), "frames": ("decor", 73), "painting": ("decor", 79), "clock": ("decor", 100),
 "window_yellow": ("decor", 143), "door_red": ("decor", 131),
 # gaming room
 "desk_gaming": ("office", 8), "chair_gaming": ("office", 18), "water_cooler": ("office", 11), "keyboard_piano": ("office", 27),
 "punching_bag": ("office", 99), "pool_table": ("office", 100), "ping_pong": ("office", 101), "foosball": ("office", 104), "bike_blue": ("office", 118),
 "shelf_bottles": ("office", 120), "speaker": ("furn", 22), "beanbag_red": ("furn", 51), "beanbag_green": ("furn", 52), "sofa_navy": ("furn", 33),
 "rug_teal": ("decor", 44), "rug_blue": ("decor", 43), "gamepad": ("decor", 217), "poster_invader": ("decor", 85), "trophies": ("office", 60),
 "door_gray": ("decor", 135), "ac_unit": ("decor", 105), "plant_cactus_b": ("decor", 17), "tower_pc": ("office", 47), "console_white": ("furn", 60),
}
# ---- animated props (Animations.gif component id) ----
ANIM = {"tv_news": 7, "tv_night": 9, "fireplace": 11, "arcade_blue": 4, "arcade_red": 5, "server": 6, "aquarium": 15, "cage": 10, "cuckoo_a": 18,
        "neon_bolt": 43, "neon_pad": 45, "neon_heart": 42, "neon_moon": 44, "purifier": 14, "ac_a": 36, "robot_vac": 62, "pc_tower_a": 34, "dog": 39, "cat": 46,
        "string_lights": 67, "monitor_night": 54}

man = {"static": {}, "anim": {}}
sheets = {}
for k, fn in SHEETS.items():
    rgb = np.array(Image.open(SRC + fn).convert("RGB")).astype(int)
    sheets[k] = (rgb, comps_of(np.abs(rgb - BG).sum(axis=2) != 0))
for name, (k, i) in STATIC.items():
    rgb, cs = sheets[k]; x0, y0, x1, y1 = cs[i]
    x0 -= x0 % 2; y0 -= y0 % 2; x1 += x1 % 2; y1 += y1 % 2
    a = halve(to_rgba(rgb[y0:y1, x0:x1])); Image.fromarray(a).save(f"{OUT}/{name}.png")
    man["static"][name] = {"w": a.shape[1], "h": a.shape[0]}
# animated
gif = Image.open(SRC + "Animations.gif"); fr = [np.array(f.convert("RGB")).astype(int) for f in ImageSequence.Iterator(gif)]
um = np.zeros(fr[0].shape[:2], bool)
for f in fr: um |= (np.abs(f - BG).sum(axis=2) != 0)
acs = comps_of(um)
for name, i in ANIM.items():
    x0, y0, x1, y1 = acs[i]; x0 -= x0 % 2; y0 -= y0 % 2; x1 += x1 % 2; y1 += y1 % 2
    sig = [f[y0:y1, x0:x1].tobytes() for f in fr]
    per = next(p for p in range(1, 49) if 48 % p == 0 and all(sig[j] == sig[j % p] for j in range(48)))
    frames = [halve(to_rgba(fr[j][y0:y1, x0:x1])) for j in range(per)]
    strip = np.concatenate(frames, axis=1); Image.fromarray(strip).save(f"{OUT}/a_{name}.png")
    man["anim"][name] = {"w": frames[0].shape[1], "h": frames[0].shape[0], "n": per}
# tiles (128x128 swatches in the sheet = 64x64 art px)
til = np.array(Image.open(SRC + "Floors and walls.png").convert("RGB")).astype(int)
def swatch(x, y, name):
    a = halve(to_rgba(til[y:y + 128, x:x + 128])); Image.fromarray(a).save(f"{OUT}/{name}.png"); man["static"][name] = {"w": 64, "h": 64}
swatch(24, 86, "floor_wood")            # hall floor
swatch(714, 86, "floor_grey")           # gaming-room floor
swatch(24, 962, "wall_green")           # hall wall (green, white panelling)
swatch(162, 962, "wall_navy")           # gaming-room wall (navy, white panelling)
swatch(576, 86, "floor_wood2")
swatch(438, 500, "floor_grass")
# ---- the one piece that isn't in the sheets: the cellar staircase.  Painted pixel by pixel in the pack's own wood / wall-top colours. ----
from collections import Counter
def dom(x, y, n=1):   # n-th most common colour of a 128x128 swatch
    return Counter(map(tuple, til[y:y + 128, x:x + 128].reshape(-1, 3))).most_common(n + 1)[n][0]
W1, W2 = np.array(dom(990, 86, 0)), np.array(dom(990, 86, 1))           # dark wood (two tones)
L1 = np.array(dom(24, 86, 0))                                            # light plank
VOID = np.array(tuple(til[1300, 400]))                                   # the dark wall-top colour
def mix(a, b, t): return tuple(int(round(a[i] * (1 - t) + b[i] * t)) for i in range(3))
SW, SH_ = 48, 52
st = np.zeros((SH_, SW, 4), np.uint8)
def fill(x0, y0, x1, y1, c, a=255): st[y0:y1, x0:x1] = (*c, a)
fill(0, 0, 40, 46, mix(VOID, (0, 0, 0), .35))                            # the shaft
n = 6
for i in range(n):                                                       # treads: lit near the room, darker as they go down
    y1 = 46 - i * 7; y0 = y1 - 7; t = i / (n - 1)
    fill(2, y0, 38, y1, mix(L1, VOID, .15 + .75 * t))
    fill(2, y0, 38, y0 + 1, mix(L1, (255, 255, 255), .25 * (1 - t)))     # lip highlight
    fill(2, y1 - 1, 38, y1, mix(VOID, (0, 0, 0), .5))                    # shadow under the tread above
fill(0, 0, 2, 46, mix(VOID, (0, 0, 0), .2)); fill(38, 0, 40, 46, mix(VOID, (0, 0, 0), .2))
fill(40, 0, 48, 50, (0, 0, 0), 67)                                       # soft shadow on the floor beside the railing
for y in range(0, 46, 15):                                               # railing on the open (right) side: posts + rail
    fill(41, y + 8 if y else 8, 45, y + 24, tuple(W2))
    fill(41, y + 4, 45, y + 8, tuple(W1)); fill(41, y + 4, 42, y + 24, mix(W1, (255, 255, 255), .3))
fill(40, 2, 46, 8, tuple(W1)); fill(40, 2, 46, 3, mix(W1, (255, 255, 255), .35))
fill(40, 46, 46, 52, tuple(W2)); fill(40, 46, 46, 47, tuple(W1)); fill(41, 46, 45, 51, tuple(W1))   # newel post at the front
fill(0, 44, 38, 46, mix(L1, VOID, .05))                                  # threshold, flush with the floor
Image.fromarray(st).save(f"{OUT}/stairs_down.png"); man["static"]["stairs_down"] = {"w": SW, "h": SH_}
open(os.path.join(ROOT, "hallart.js"), "w").write("const HALL_ART = " + json.dumps(man, separators=(",", ":")) + ";\n")
print(len(man["static"]), "static,", len(man["anim"]), "animated")
for n, v in {**man["static"], **{"a_" + k: v for k, v in man["anim"].items()}}.items(): print(n, v)
