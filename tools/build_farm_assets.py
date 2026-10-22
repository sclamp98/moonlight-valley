#!/usr/bin/env python3
"""Builds assets/fp/* (and fpdata.js) from the Pixel Farm RPG free pack.

  python3 -I tools/build_farm_assets.py "<pack folder>" assets/fp

Everything the game needs that the pack does not ship (seasons, house/barn/coop sprites, tool icons,
NPC colour variants ...) is generated here from the pack's own palette, so the look stays consistent.
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw

PACK, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
SEASONS = ["spring", "summer", "autumn", "winter"]
MANIFEST = {}


def load(p):
    return np.array(Image.open(os.path.join(PACK, p)).convert("RGBA"))


def save(a, name):
    Image.fromarray(np.asarray(a).astype(np.uint8), "RGBA").save(os.path.join(OUT, name), optimize=True)


def hexrgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


# ---------------------------------------------------------------- colour helpers
def rgb2hsv(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = rgb.max(-1); mn = rgb.min(-1); d = mx - mn
    h = np.zeros_like(mx)
    m = d > 1e-9
    rc = (mx == r) & m; gc = (mx == g) & m & ~rc; bc = m & ~rc & ~gc
    h[rc] = ((g - b)[rc] / d[rc]) % 6
    h[gc] = ((b - r)[gc] / d[gc]) + 2
    h[bc] = ((r - g)[bc] / d[bc]) + 4
    s = np.where(mx > 0, d / np.maximum(mx, 1e-9), 0)
    return h * 60.0, s, mx


def hsv2rgb(h, s, v):
    h = (h % 360.0) / 60.0
    i = np.floor(h).astype(int) % 6
    f = h - np.floor(h)
    p = v * (1 - s); q = v * (1 - s * f); t = v * (1 - s * (1 - f))
    r = np.choose(i, [v, q, p, p, t, v]); g = np.choose(i, [t, v, v, q, p, p]); b = np.choose(i, [p, p, t, v, v, q])
    return np.stack([r, g, b], -1)


def foliage(a, season, evergreen=False):
    """Season-shift every leaf/grass green of an RGBA array (dark outlines are left alone)."""
    if season == "spring" and not evergreen:
        return a.copy()
    out = a.astype(float) / 255.0
    h, s, v = rgb2hsv(out[..., :3])
    m = (h >= 60) & (h <= 170) & (s > 0.25) & (v > 0.28) & (out[..., 3] > 0)
    h2, s2, v2 = h.copy(), s.copy(), v.copy()
    if season == "spring":
        pass
    elif season == "summer" or (season == "autumn" and evergreen):
        h2 = h - 9; s2 = np.minimum(1, s * 1.08); v2 = v * 0.9
    elif season == "autumn":
        h2 = 40 - (h - 105) * 0.55; s2 = np.minimum(0.92, s * 1.05 + 0.06); v2 = np.minimum(1, v * 1.0 + 0.02)
    elif season == "winter":
        h2 = np.full_like(h, 208); s2 = 0.07 + (1 - v) * 0.22; v2 = 0.52 + v * 0.56
    rgb = hsv2rgb(h2, np.clip(s2, 0, 1), np.clip(v2, 0, 1))
    out[..., :3] = np.where(m[..., None], rgb, out[..., :3])
    return np.clip(out * 255 + 0.5, 0, 255).astype(np.uint8)


CREAM, TAN = (253, 230, 178), (239, 179, 129)
SAND = {  # (cream, tan) per season for tiles
    "spring": (CREAM, TAN), "summer": ((253, 222, 160), (240, 170, 110)),
    "autumn": ((246, 214, 158), (226, 160, 104)), "winter": ((222, 212, 196), (186, 170, 146)),
}


def sandwater(a, season):
    a = a.copy()
    c0, t0 = SAND[season]
    cream = (a[..., 0] == CREAM[0]) & (a[..., 1] == CREAM[1]) & (a[..., 2] == CREAM[2]) & (a[..., 3] > 0)
    tan = (a[..., 0] == TAN[0]) & (a[..., 1] == TAN[1]) & (a[..., 2] == TAN[2]) & (a[..., 3] > 0)
    a[cream, :3] = c0; a[tan, :3] = t0
    if season == "winter":  # cooler, paler water
        o = a.astype(float) / 255
        h, s, v = rgb2hsv(o[..., :3])
        m = (h > 180) & (h < 225) & (s > 0.1) & (a[..., 3] > 0)
        rgb = hsv2rgb(h, s * 0.62, np.minimum(1, v * 1.04 + 0.03))
        o[..., :3] = np.where(m[..., None], rgb, o[..., :3])
        a = np.clip(o * 255 + 0.5, 0, 255).astype(np.uint8)
    return a


def key_cream(a):
    a = a.copy()
    m = (a[..., 0] == CREAM[0]) & (a[..., 1] == CREAM[1]) & (a[..., 2] == CREAM[2])
    a[m] = (0, 0, 0, 0)
    return a


# ---------------------------------------------------------------- dual-grid tile atlases
# Each junction tile covers the four cells around a grid corner; bit order: NW=1 NE=2 SW=4 SE=8.
PIECE = {15: (1, 1), 8: (0, 0), 12: (1, 0), 4: (2, 0), 10: (0, 1), 5: (2, 1), 2: (0, 2), 3: (1, 2), 1: (2, 2),
         7: (3, 0), 11: (4, 0), 13: (3, 1), 14: (4, 1)}
QUAD = {1: (0, 0), 2: (8, 0), 4: (0, 8), 8: (8, 8)}  # bit -> (x, y) of its 8x8 quadrant


def tile_of(sheet, tx, ty):
    return sheet[ty * 16:(ty + 1) * 16, tx * 16:(tx + 1) * 16]


def atlas(sheet, empty):
    """16 junction tiles (index = mask) from a 3x3 blob + 2x2 inner-corner block laid out like the pack's tilesets."""
    tiles = []
    for m in range(16):
        if m == 0:
            tiles.append(empty.copy()); continue
        if m in PIECE:
            tiles.append(tile_of(sheet, *PIECE[m]).copy()); continue
        t = empty.copy()  # the two diagonal cases: stitch the single-corner tiles together
        for bit in (1, 2, 4, 8):
            if m & bit:
                x, y = QUAD[bit]
                src = tile_of(sheet, *PIECE[bit])
                t[y:y + 8, x:x + 8] = src[y:y + 8, x:x + 8]
        tiles.append(t)
    return tiles


def strip(tiles):
    return np.concatenate(tiles, axis=1)


# ---------------------------------------------------------------- terrain
def build_terrain():
    gp = load("Tiles/GrassPath.png")
    bt = load("Tiles/BeachTiles.png")
    td = load("Tiles/TilledDirt.png")
    clear = np.zeros((16, 16, 4), np.uint8)
    for s in SEASONS:
        g = foliage(gp, s)
        g = sandwater(g, s)  # the peach rim of the grass blob follows the path colour
        deco = [tile_of(g, 3, 2), tile_of(g, 4, 2), tile_of(g, 3, 3), tile_of(g, 4, 3)]
        gk = key_cream(g)
        at = atlas(gk, clear)
        # decorations sit on the plain grass colour already, so they stay opaque
        save(strip(at + deco), f"grass_{s}.png")
        # beach: 6 animation frames, each row = 16 masks + 6 pebble variants of the plain sand tile
        rows = []
        for f in range(6):
            sh = sandwater(bt[:, f * 80:(f + 1) * 80], s)
            water = tile_of(sh, 0, 3)
            tl = atlas(sh, water)
            pebbles = [tile_of(sh, 3, 2), tile_of(sh, 4, 2), tile_of(sh, 3, 3), tile_of(sh, 4, 3), tile_of(sh, 3, 4), tile_of(sh, 4, 4)]
            rows.append(strip(tl + pebbles))
        save(np.concatenate(rows, axis=0), f"beach_{s}.png")
    # tilled soil: dry and wet, outline rim + speckle
    keyed = key_cream(td)
    alpha = keyed[..., 3] > 0
    pad = np.pad(alpha, 1)
    rim = alpha & ~(pad[:-2, 1:-1] & pad[2:, 1:-1] & pad[1:-1, :-2] & pad[1:-1, 2:])
    yy, xx = np.mgrid[0:td.shape[0], 0:td.shape[1]]
    spk = ((xx * 7 + yy * 13 + (xx * yy) % 5) % 9) == 0
    for name, base, spec, edge in (("dry", (150, 100, 66), (132, 86, 56), (104, 66, 42)), ("wet", (102, 66, 44), (88, 55, 37), (70, 44, 30))):
        a = np.zeros_like(keyed)
        a[alpha] = (*base, 255)
        a[alpha & spk] = (*spec, 255)
        a[rim] = (*edge, 255)
        save(strip(atlas(a, clear)), f"soil_{name}.png")
    MANIFEST["terrain"] = {"tile": 16, "masks": 16, "grassDeco": 4, "beachDeco": 6, "beachFrames": 6}


# ---------------------------------------------------------------- trees, bushes, crops, chest, props
def dominant(a, lo_v=0.15, hue=(5, 40)):
    o = a.astype(float) / 255
    h, s, v = rgb2hsv(o[..., :3])
    m = (a[..., 3] > 0) & (h >= hue[0]) & (h <= hue[1]) & (s > 0.3)
    return m


def build_nature():
    info = {}
    for kind, ev in (("oak", False), ("birch", False), ("pine", True)):
        a = load(f"Environment/{kind.capitalize()}Tree.png")
        for s in SEASONS:
            save(foliage(a, s, ev), f"tree_{kind}_{s}.png")
    for s in SEASONS:
        save(foliage(load("Environment/Bush.png"), s), f"bush_{s}.png")
    # stumps: cut from the trunk of each full-grown tree, flattened with a pale cut face
    for kind in ("oak", "birch", "pine"):
        a = load(f"Environment/{kind.capitalize()}Tree.png")[:, 96:144]
        ys, xs = np.where(a[..., 3] > 0)
        cx = 24
        st = np.zeros((16, 16, 4), np.uint8)
        trunk = a[36:47, 16:32].copy()  # lowest 11 rows around the trunk
        # recolour: keep only trunk-coloured / dark outline pixels
        o = trunk.astype(float) / 255
        h, s, v = rgb2hsv(o[..., :3])
        keep = (trunk[..., 3] > 0) & (((h < 45) & (s > 0.08)) | (v < 0.28) | ((s < 0.2) & (v > 0.7) & (kind == "birch")))
        trunk[~keep] = 0
        # stump body = the trunk rows, shifted so the base sits at row 14
        body = np.zeros((16, 16, 4), np.uint8)
        body[5:16, :] = trunk
        # top: pale cut ellipse
        cut = Image.new("RGBA", (16, 16), (0, 0, 0, 0)); d = ImageDraw.Draw(cut)
        d.ellipse((2, 2, 13, 8), fill=(29, 39, 39, 255)); d.ellipse((3, 3, 12, 7), fill=(235, 190, 130, 255))
        d.ellipse((5, 4, 10, 6), outline=(200, 140, 90, 255))
        c = np.array(cut)
        # trunk silhouette to a plain barrel so thin saplings don't produce odd shapes
        barrel = Image.new("RGBA", (16, 16), (0, 0, 0, 0)); d = ImageDraw.Draw(barrel)
        base = (171, 78, 65, 255) if kind != "birch" else (225, 232, 232, 255)
        shade = (139, 60, 60, 255) if kind != "birch" else (190, 214, 222, 255)
        d.rectangle((3, 5, 12, 13), fill=base, outline=(29, 39, 39, 255))
        d.rectangle((9, 6, 11, 12), fill=shade)
        d.ellipse((1, 11, 14, 15), fill=base, outline=(29, 39, 39, 255))
        d.rectangle((3, 6, 12, 12), fill=base); d.rectangle((9, 6, 11, 12), fill=shade)
        d.line((5, 8, 5, 12), fill=shade)
        d.ellipse((2, 2, 13, 8), fill=(29, 39, 39, 255)); d.ellipse((3, 3, 12, 7), fill=(240, 200, 140, 255))
        d.ellipse((5, 4, 10, 6), outline=(205, 150, 95, 255))
        save(np.array(barrel), f"stump_{kind}.png")
    # crops (frames 0 packet, 1-4 growth, 5 produce) + withered version
    for c in ("Tomato", "Wheat"):
        a = load(f"Crops/{c}.png")
        save(a, f"crop_{c.lower()}.png")
        o = a.astype(float) / 255
        h, s, v = rgb2hsv(o[..., :3])
        m = (a[..., 3] > 0) & (v > 0.3)
        rgb = hsv2rgb(np.full_like(h, 32), np.minimum(1, s * 0.35 + 0.05), v * 0.62 + 0.04)
        o[..., :3] = np.where(m[..., None], rgb, o[..., :3])
        save(np.clip(o * 255 + .5, 0, 255).astype(np.uint8), f"crop_{c.lower()}_dead.png")
    save(load("Crops/Seeds.png"), "seeds.png")
    save(load("Environment/Chest.png"), "chest.png")
    save(load("Environment/Flowers.png"), "flowers.png")
    save(load("Environment/Planters.png"), "planters.png")
    save(load("Environment/Sign.png"), "signs.png")
    save(load("Environment/Lantern.png"), "lantern.png")
    wb = load("Crops/WheatBlock.png")
    save(wb, "wheatblock.png")


# ---------------------------------------------------------------- characters
def sheet_rows(src, cw, rows_n, frames, crop, name_rows):
    """slice `rows_n` direction rows x `frames` columns from a sheet and crop each cell"""
    x0, y0, x1, y1 = crop
    out = []
    for r in range(rows_n):
        cells = []
        for f in range(frames):
            cell = src[r * cw:(r + 1) * cw, f * cw:(f + 1) * cw]
            cells.append(cell[y0:y1, x0:x1])
        out.append(cells)
    return out


def swap(a, table):
    a = a.copy()
    for src, dst in table.items():
        s = hexrgb(src)
        m = (a[..., 0] == s[0]) & (a[..., 1] == s[1]) & (a[..., 2] == s[2]) & (a[..., 3] > 0)
        a[m, :3] = hexrgb(dst)
    return a


FARMER_VARIANTS = {
    "wren": {},
    "blond": {"ab4e41": "e0b34a", "8b3c3c": "b98a2c", "bf6a4d": "f2d078", "3567b9": "4aa04f", "2b4797": "367a3a"},
    "dark": {"ab4e41": "3b2c2e", "8b3c3c": "241a1c", "bf6a4d": "5a4548", "3567b9": "c4473d", "2b4797": "9a3330"},
    "elder": {"ab4e41": "d3d7dc", "8b3c3c": "a6adb7", "bf6a4d": "eef0f3", "3567b9": "8c6b47", "2b4797": "6c5236", "bccab6": "e6d2a6", "d9dfd3": "f0e2bc"},
    "violet": {"ab4e41": "7c4aa8", "8b3c3c": "5a3480", "bf6a4d": "a070cc", "3567b9": "d98a3a", "2b4797": "b0692a"},
    "teal": {"ab4e41": "d8742c", "8b3c3c": "a8541c", "bf6a4d": "efa060", "3567b9": "2f9d9a", "2b4797": "237a78"},
}


def build_characters():
    crop = (28, 32, 52, 56)  # 24x24 around the chibi farmer; feet land on row 21, centre column 12
    cw = 24
    idle, walk, plant = load("Player/Idle.png"), load("Player/Walk.png"), load("Player/Plant.png")
    parts = [sheet_rows(idle, 80, 3, 4, crop, None), sheet_rows(walk, 80, 3, 8, crop, None), sheet_rows(plant, 80, 3, 7, crop, None)]
    for name, table in FARMER_VARIANTS.items():
        sheet = np.zeros((9 * cw, 8 * cw, 4), np.uint8)
        for pi, rows in enumerate(parts):
            for r, cells in enumerate(rows):
                for f, cell in enumerate(cells):
                    sheet[(pi * 3 + r) * cw:(pi * 3 + r + 1) * cw, f * cw:(f + 1) * cw] = swap(cell, table)
        save(sheet, f"npc_{name}.png")
    MANIFEST["farmer"] = {"cw": cw, "ch": cw, "foot": 21, "cx": 12, "anims": {"idle": [0, 4, 4], "walk": [3, 8, 11], "plant": [6, 7, 9]}, "variants": list(FARMER_VARIANTS)}

    # skeletons
    sc = (16, 30, 64, 68); sw, sh = 48, 38
    sk = {n: sheet_rows(load(f"Skeleton/{n}.png"), 80, 3, f, sc, None) for n, f in (("Idle", 4), ("Walk", 8), ("Attack", 4), ("Hurt", 4))}
    death = load("Skeleton/Death.png")
    death_cells = [death[:, f * 80:(f + 1) * 80][sc[1]:sc[3], sc[0]:sc[2]] for f in range(6)]
    SK_VAR = {"bone": {}, "violet": {"f6f7f4": "e0c8f4", "bed6de": "ad8ed0", "96bad2": "7a5aa6"},
              "ember": {"f6f7f4": "f6c8b0", "bed6de": "dc8c70", "96bad2": "a8503e"}}
    for vn, table in SK_VAR.items():
        sheet = np.zeros((13 * sh, 8 * sw, 4), np.uint8)
        for ai, n in enumerate(("Idle", "Walk", "Attack", "Hurt")):
            for r in range(3):
                for f, cell in enumerate(sk[n][r]):
                    sheet[(ai * 3 + r) * sh:(ai * 3 + r + 1) * sh, f * sw:(f + 1) * sw] = swap(cell, table)
        for f, cell in enumerate(death_cells):
            sheet[12 * sh:13 * sh, f * sw:(f + 1) * sw] = swap(cell, table)
        save(sheet, f"skel_{vn}.png")
    MANIFEST["skeleton"] = {"cw": sw, "ch": sh, "foot": 23, "cx": 24, "anims": {"idle": [0, 4, 4], "walk": [3, 8, 11], "attack": [6, 4, 9], "hurt": [9, 4, 6], "death": [12, 6, 8]}, "variants": list(SK_VAR)}

    # chickens (face right)
    ch = load("Animals/Chicken.png")
    CH_VAR = {"white": {}, "brown": {"f6f7f4": "c4845a", "bed6de": "a66a44", "96bad2": "7e4d30"},
              "gold": {"f6f7f4": "f7dc86", "bed6de": "e0b457", "96bad2": "b98a3a"}}
    box = (8, 12, 40, 36)
    for vn, table in CH_VAR.items():
        cells = [swap(ch[:, f * 48:(f + 1) * 48][box[1]:box[3], box[0]:box[2]], table) for f in range(5)]
        save(np.concatenate(cells, axis=1), f"chicken_{vn}.png")
    MANIFEST["chicken"] = {"cw": 32, "ch": 24, "foot": 19, "cx": 16, "frames": 5, "variants": list(CH_VAR)}


# ---------------------------------------------------------------- tiny pixel-art toolkit for icons + buildings
K = (29, 39, 39, 255)
P = {
    "k": K, "c": (253, 230, 178, 255), "t": (239, 179, 129, 255), "r": (171, 78, 65, 255), "R": (139, 60, 60, 255), "o": (191, 106, 77, 255),
    "b": (53, 103, 185, 255), "B": (43, 71, 151, 255), "g": (87, 189, 73, 255), "G": (65, 154, 76, 255), "d": (55, 123, 80, 255),
    "l": (136, 218, 87, 255), "y": (247, 222, 123, 255), "Y": (244, 191, 87, 255), "W": (217, 223, 211, 255), "s": (188, 202, 182, 255),
    "a": (99, 182, 229, 255), "A": (181, 236, 243, 255), "z": (227, 251, 250, 255), "n": (166, 102, 70, 255), "N": (118, 70, 50, 255),
    "m": (150, 164, 172, 255), "M": (96, 110, 122, 255), "p": (150, 100, 200, 255), "P": (106, 66, 156, 255), "e": (250, 244, 232, 255),
    "E": (226, 212, 192, 255), "h": (255, 255, 255, 255), "x": (236, 21, 20, 255), "X": (193, 22, 56, 255), "O": (239, 152, 55, 255),
    "w": (232, 240, 248, 255), "v": (190, 208, 226, 255), "u": (88, 66, 52, 255),
}


class Pix:
    """A small RGBA canvas with fill helpers that take palette letters."""

    def __init__(self, w, h):
        self.w, self.h = w, h
        self.im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.im)

    @staticmethod
    def col(c):
        return c if isinstance(c, tuple) else P[c]

    def rect(self, x0, y0, x1, y1, c):
        self.d.rectangle((x0, y0, x1, y1), fill=self.col(c))

    def poly(self, pts, c):
        self.d.polygon(pts, fill=self.col(c))

    def line(self, pts, c, w=1):
        self.d.line(pts, fill=self.col(c), width=w)

    def ell(self, box, c, outline=None):
        self.d.ellipse(box, fill=self.col(c), outline=self.col(outline) if outline else None)

    def px(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.im.putpixel((x, y), self.col(c))

    def outline(self, c="k"):
        a = np.array(self.im)
        al = a[..., 3] > 0
        pad = np.pad(al, 1)
        near = pad[:-2, 1:-1] | pad[2:, 1:-1] | pad[1:-1, :-2] | pad[1:-1, 2:]
        edge = near & ~al
        a[edge] = self.col(c)
        self.im = Image.fromarray(a, "RGBA"); self.d = ImageDraw.Draw(self.im)
        return self

    def arr(self):
        return np.array(self.im)

    def save(self, name):
        save(self.arr(), name)


def ascii_icon(rows):
    p = Pix(16, 16)
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch != ".":
                p.px(x, y, ch)
    return p


def build_icons():
    ic = {}
    # crop items come straight from the pack: packet = frame 0, produce = frame 5
    def from_sheet(sheet, f):
        a = load(sheet)[:, f * 16:(f + 1) * 16]
        ys, xs = np.where(a[..., 3] > 0)
        crop = a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        out = np.zeros((16, 16, 4), np.uint8)
        oy = (16 - crop.shape[0]) // 2; ox = (16 - crop.shape[1]) // 2
        out[oy:oy + crop.shape[0], ox:ox + crop.shape[1]] = crop
        return out
    ic["seeds"] = from_sheet("Crops/Wheat.png", 0)
    ic["tomato_seeds"] = from_sheet("Crops/Tomato.png", 0)
    ic["wheat"] = from_sheet("Crops/Wheat.png", 5)
    ic["tomato"] = from_sheet("Crops/Tomato.png", 5)

    p = Pix(16, 16)  # hoe
    p.line([(3, 13), (11, 5)], "n", 2); p.poly([(9, 3), (13, 2), (14, 5), (12, 8), (10, 6)], "m"); p.line([(10, 4), (13, 3)], "W")
    ic["hoe"] = p.outline().arr()
    p = Pix(16, 16)  # axe
    p.line([(3, 13), (10, 6)], "n", 2); p.poly([(8, 2), (13, 3), (14, 8), (10, 9), (8, 6)], "m"); p.line([(13, 3), (14, 8)], "W"); p.line([(9, 3), (12, 4)], "s")
    ic["axe"] = p.outline().arr()
    p = Pix(16, 16)  # watering can
    p.rect(3, 6, 10, 12, "b"); p.rect(3, 6, 10, 7, "a"); p.rect(9, 7, 10, 12, "B")
    p.line([(10, 9), (14, 5)], "b", 2); p.rect(13, 3, 14, 4, "a"); p.line([(4, 5), (6, 3), (9, 3), (10, 5)], "m")
    p.px(2, 8, "B"); p.px(2, 9, "B")
    ic["can"] = p.outline().arr()
    p = Pix(16, 16)  # stick
    p.line([(3, 13), (12, 4)], "n", 2); p.line([(4, 12), (11, 5)], "o"); p.px(12, 3, "n"); p.px(5, 8, "n")
    ic["stick"] = p.outline().arr()
    p = Pix(16, 16)  # sword
    p.line([(4, 11), (12, 3)], "W", 2); p.line([(5, 10), (12, 3)], "h"); p.line([(3, 8), (8, 13)], "Y", 2); p.line([(2, 14), (4, 12)], "n", 2)
    ic["sword"] = p.outline().arr()
    p = Pix(16, 16)  # moon gem
    p.poly([(8, 1), (13, 5), (8, 14), (3, 5)], "a"); p.poly([(8, 1), (13, 5), (8, 6)], "A"); p.poly([(8, 6), (13, 5), (8, 14)], "b"); p.line([(3, 5), (13, 5)], "z")
    ic["gem"] = p.outline().arr()
    p = Pix(16, 16)  # bread
    p.ell((1, 5, 14, 13), "o"); p.ell((2, 5, 13, 11), "t"); p.line([(5, 6), (6, 10)], "o"); p.line([(8, 6), (9, 10)], "o"); p.line([(11, 6), (12, 9)], "o")
    ic["bread"] = p.outline().arr()
    p = Pix(16, 16)  # potion
    p.rect(6, 2, 9, 5, "E"); p.rect(5, 1, 10, 2, "n"); p.ell((2, 5, 13, 14), "x"); p.ell((3, 6, 7, 9), "o"); p.px(4, 7, "h"); p.rect(6, 4, 9, 6, "A")
    ic["potion"] = p.outline().arr()
    p = Pix(16, 16)  # egg
    p.ell((3, 2, 12, 14), "e"); p.rect(6, 12, 11, 13, "E"); p.ell((5, 4, 7, 7), "h")
    ic["egg"] = p.outline().arr()
    p = Pix(16, 16)  # fried egg
    p.ell((1, 4, 14, 14), "e"); p.ell((2, 3, 9, 8), "e"); p.ell((7, 6, 12, 11), "e"); p.ell((5, 6, 10, 11), "Y"); p.px(6, 7, "y")
    ic["fried_egg"] = p.outline().arr()
    p = Pix(16, 16)  # wood log
    p.rect(2, 5, 12, 12, "n"); p.rect(2, 10, 12, 12, "N"); p.line([(4, 7), (10, 7)], "o"); p.ell((9, 4, 14, 13), "t"); p.ell((10, 6, 13, 11), "c"); p.ell((11, 8, 12, 9), "o")
    ic["wood"] = p.outline().arr()
    p = Pix(16, 16)  # tomato stew
    p.rect(2, 8, 13, 9, "N"); p.poly([(2, 9), (13, 9), (11, 14), (4, 14)], "n"); p.ell((3, 5, 12, 10), "x"); p.ell((5, 6, 8, 8), "X"); p.px(10, 7, "y"); p.px(7, 4, "z"); p.px(9, 3, "z")
    ic["stew"] = p.outline().arr()
    for k, a in ic.items():
        save(a, f"ic_{k}.png")
    MANIFEST["icons"] = list(ic)

    # weather icons for the clock panel (16x16 each)
    def wx(name, f):
        q = Pix(16, 16); f(q); q.outline().save(f"wx_{name}.png")
    def sun(q):
        q.ell((4, 4, 11, 11), "y"); q.ell((5, 5, 10, 10), "Y")
        for a, b in [((8, 0), (8, 2)), ((8, 13), (8, 15)), ((0, 8), (2, 8)), ((13, 8), (15, 8)), ((2, 2), (3, 3)), ((12, 12), (13, 13)), ((12, 3), (13, 2)), ((2, 13), (3, 12))]:
            q.line([a, b], "y")
    def cloud(q, col="W"):
        q.ell((1, 6, 8, 13), col); q.ell((5, 3, 12, 11), col); q.ell((8, 7, 15, 13), col); q.rect(4, 9, 12, 13, col)
    def rain(q):
        cloud(q, "s")
        for x, y in [(4, 12), (8, 12), (12, 12), (6, 14), (10, 14)]:
            q.line([(x, y), (x - 1, y + 1)], "a")
    def storm(q):
        cloud(q, "M"); q.poly([(8, 8), (5, 13), (8, 12), (7, 15), (11, 10), (8, 11)], "y")
    def snow(q):
        cloud(q, "w")
        for x, y in [(4, 13), (8, 12), (12, 13), (6, 15), (10, 15)]:
            q.px(x, y, "z")
    wx("sun", sun); wx("cloud", cloud); wx("rain", rain); wx("storm", storm); wx("snow", snow)


# ---------------------------------------------------------------- buildings and props (procedural, in the pack's palette)
def shingles(p, pts_poly, x0, x1, y0, y1, main, dark, light, row=4):
    mask = Image.new("L", (p.w, p.h), 0)
    ImageDraw.Draw(mask).polygon(pts_poly, fill=255)
    layer = Pix(p.w, p.h)
    for i, y in enumerate(range(y0, y1 + 1, row)):
        layer.rect(x0, y, x1, min(y + row - 1, y1), main if i % 2 == 0 else dark)
        layer.line([(x0, y), (x1, y)], light if i % 2 == 0 else main)
        # vertical shingle joints
        off = 0 if i % 2 == 0 else 3
        for x in range(x0 + off, x1, 6):
            layer.line([(x, y + 1), (x, y + row - 1)], dark if i % 2 == 0 else main)
    p.im.paste(layer.im, (0, 0), mask)
    p.d = ImageDraw.Draw(p.im)


def roof_colors(kind, snow):
    if snow:
        return ("w", "v", "h")
    return {"red": ("r", "R", "o"), "blue": ("b", "B", "a"), "green": ("g", "G", "l"), "plum": ("p", "P", (190, 150, 230, 255))}[kind]


def house(kind="red", snow=False, w=64):
    h = 58
    p = Pix(w, h)
    m, dk, lt = roof_colors(kind, snow)
    cx = w // 2
    p.rect(w - 21, 1, w - 14, 14, "r"); p.rect(w - 21, 1, w - 14, 3, "o"); p.line([(w - 17, 4), (w - 17, 13)], "R")  # chimney
    if snow: p.rect(w - 22, 0, w - 13, 2, "h")
    p.rect(8, 27, w - 9, 52, "c")                                    # wall
    for x in range(12, w - 9, 7): p.line([(x, 30), (x, 47)], "E")    # planks
    p.rect(8, 47, w - 9, 52, "t")                                    # stone base
    for x in range(8, w - 9, 6): p.line([(x, 47), (x, 52)], "o")
    p.rect(8, 27, w - 9, 29, "E")                                    # eave shadow
    poly = [(2, 29), (14, 8), (w - 15, 8), (w - 3, 29)]
    p.poly(poly, m)
    shingles(p, poly, 2, w - 3, 8, 28, m, dk, lt)
    p.line([(14, 8), (w - 15, 8)], lt)
    if snow:
        for x in range(4, w - 4, 3):
            p.px(x, 29, "h"); p.px(x + 1, 30 if (x // 3) % 2 else 29, "h")
        p.rect(14, 8, w - 15, 9, "h")
    p.ell((cx - 3, 12, cx + 3, 18), "E"); p.ell((cx - 2, 13, cx + 2, 17), "a")  # attic round window
    p.line([(cx - 3, 15), (cx + 3, 15)], "c"); p.line([(cx, 12), (cx, 18)], "c")
    # door
    p.rect(cx - 5, 36, cx + 4, 52, "n"); p.rect(cx - 5, 36, cx + 4, 37, "o")
    p.rect(cx - 4, 39, cx - 1, 46, "N"); p.rect(cx, 39, cx + 3, 46, "N"); p.px(cx + 2, 45, "y"); p.px(cx + 2, 44, "y")
    p.rect(cx - 7, 35, cx - 6, 52, "c"); p.rect(cx + 5, 35, cx + 6, 52, "c")
    p.rect(cx - 7, 34, cx + 6, 35, "c")
    # windows with shutters
    for wx in (13, w - 24):
        p.rect(wx - 2, 33, wx + 10, 44, "G" if kind != "green" else "d")
        p.rect(wx, 33, wx + 8, 43, "c"); p.rect(wx + 1, 34, wx + 7, 42, "a")
        p.line([(wx + 4, 34), (wx + 4, 42)], "c"); p.line([(wx + 1, 38), (wx + 7, 38)], "c")
        p.px(wx + 2, 35, "A"); p.px(wx + 3, 36, "A"); p.px(wx + 6, 40, "A")
        p.rect(wx - 1, 44, wx + 9, 45, "n")
    p.rect(cx - 8, 52, cx + 7, 54, "W"); p.line([(cx - 8, 52), (cx + 7, 52)], "s")
    return p.outline()


def barn(snow=False):
    w, h = 80, 66
    p = Pix(w, h)
    p.rect(6, 28, 73, 62, "r")
    for x in range(8, 73, 4): p.line([(x, 28), (x, 62)], "R")
    p.rect(6, 58, 73, 62, "W"); p.line([(6, 58), (73, 58)], "s")
    poly = [(1, 30), (9, 15), (26, 5), (53, 5), (70, 15), (78, 30)]
    m, dk, lt = ("w", "v", "h") if snow else ("R", (110, 46, 52, 255), "r")
    p.poly(poly, m); shingles(p, poly, 1, 78, 5, 30, m, dk, lt, 4)
    if snow:
        p.rect(26, 5, 53, 7, "h")
        for x in range(2, 78, 3): p.px(x, 30, "h")
    p.rect(30, 33, 49, 62, "W"); p.rect(32, 35, 47, 62, "r")
    for x in range(33, 47, 3): p.line([(x, 36), (x, 62)], "R")
    p.line([(32, 35), (47, 61)], "W", 2); p.line([(47, 35), (32, 61)], "W", 2)
    p.rect(35, 12, 44, 22, "W"); p.rect(36, 13, 43, 21, "k"); p.line([(39, 13), (39, 21)], "W"); p.line([(36, 17), (43, 17)], "W")
    p.rect(11, 38, 20, 47, "W"); p.rect(12, 39, 19, 46, "a"); p.line([(15, 39), (15, 46)], "W"); p.line([(12, 42), (19, 42)], "W")
    p.rect(59, 38, 68, 47, "W"); p.rect(60, 39, 67, 46, "a"); p.line([(63, 39), (63, 46)], "W"); p.line([(60, 42), (67, 42)], "W")
    return p.outline()


def coop(snow=False):
    w, h = 44, 42
    p = Pix(w, h)
    p.rect(4, 18, 39, 37, "n")
    for y in range(20, 37, 4): p.line([(4, y), (39, y)], "N")
    p.rect(4, 33, 39, 37, "N")
    poly = [(1, 19), (10, 6), (33, 6), (42, 19)]
    m, dk, lt = ("w", "v", "h") if snow else ("r", "R", "o")
    p.poly(poly, m); shingles(p, poly, 1, 42, 6, 19, m, dk, lt, 3)
    if snow:
        p.rect(10, 6, 33, 7, "h")
        for x in range(2, 42, 3): p.px(x, 19, "h")
    p.rect(16, 23, 26, 37, "k"); p.rect(17, 24, 25, 37, "N")   # doorway
    p.poly([(15, 38), (27, 38), (29, 41), (13, 41)], "o"); p.line([(14, 40), (28, 40)], "n")  # ramp
    p.rect(7, 23, 12, 28, "k"); p.rect(8, 24, 11, 27, "y")     # nest window
    p.line([(7, 25), (12, 25)], "n"); p.line([(30, 24), (35, 24)], "N")
    for x, y in [(6, 36), (8, 35), (33, 36), (36, 35), (35, 37)]: p.px(x, y, "Y")  # hay tufts
    return p.outline()


def shop(snow=False):
    w, h = 76, 60
    p = Pix(w, h)
    p.rect(6, 22, w - 7, 55, "c")
    for x in range(10, w - 7, 7): p.line([(x, 24), (x, 52)], "E")
    p.rect(6, 49, w - 7, 55, "t")
    poly = [(2, 24), (10, 6), (w - 11, 6), (w - 3, 24)]
    m, dk, lt = ("w", "v", "h") if snow else ("b", "B", "a")
    p.poly(poly, m); shingles(p, poly, 2, w - 3, 6, 24, m, dk, lt, 4)
    if snow:
        p.rect(10, 6, w - 11, 7, "h")
        for x in range(3, w - 3, 3): p.px(x, 24, "h")
    # sign board with a coin
    p.rect(w // 2 - 12, 11, w // 2 + 11, 21, "n"); p.rect(w // 2 - 11, 12, w // 2 + 10, 20, "o"); p.ell((w // 2 - 4, 12, w // 2 + 3, 19), "Y"); p.ell((w // 2 - 2, 14, w // 2 + 1, 17), "y")
    # awning
    for i, x in enumerate(range(4, w - 4, 6)):
        col = "x" if i % 2 == 0 else "e"
        p.rect(x, 27, min(x + 5, w - 5), 35, col)
        p.ell((x, 33, min(x + 5, w - 5), 38), col)
    p.line([(4, 27), (w - 5, 27)], "R")
    # window with produce + door
    p.rect(11, 40, 36, 52, "n"); p.rect(12, 41, 35, 51, "a"); p.line([(24, 41), (24, 51)], "n")
    p.rect(12, 48, 35, 51, "N")
    for x, c in [(15, "x"), (19, "O"), (22, "x"), (27, "g"), (31, "O")]: p.ell((x, 45, x + 3, 48), c)
    p.rect(46, 38, 60, 55, "n"); p.rect(47, 39, 59, 55, "N"); p.rect(49, 41, 57, 48, "a"); p.px(57, 52, "y")
    p.rect(44, 36, 62, 38, "c")
    return p.outline()


def well(snow=False):
    p = Pix(24, 32)
    p.rect(3, 8, 5, 22, "n"); p.rect(18, 8, 20, 22, "n")
    poly = [(1, 9), (7, 2), (16, 2), (22, 9)]
    p.poly(poly, "w" if snow else "r"); shingles(p, poly, 1, 22, 2, 9, *(("w", "v", "h") if snow else ("r", "R", "o")), 3)
    p.ell((1, 17, 22, 29), "s"); p.ell((3, 18, 20, 26), "M"); p.ell((4, 19, 19, 25), "a" if not snow else "A")
    p.rect(1, 22, 22, 28, "W"); p.rect(1, 22, 22, 22, "s")
    for x in range(2, 22, 4): p.line([(x, 23), (x, 28)], "s")
    p.ell((1, 25, 22, 30), "W")
    p.ell((3, 18, 20, 25), "M"); p.ell((4, 19, 19, 24), "a" if not snow else "A")
    p.line([(11, 8), (11, 16)], "N"); p.rect(9, 15, 13, 18, "n")
    return p.outline()


def kitchen(frame):
    p = Pix(28, 30)
    p.line([(5, 6), (14, 22)], "N", 2); p.line([(22, 6), (14, 22)], "N", 2); p.line([(14, 4), (14, 22)], "N")
    p.line([(14, 8), (14, 12)], "M")
    p.poly([(7, 12), (21, 12), (19, 20), (9, 20)], "M"); p.rect(6, 11, 22, 13, "m"); p.line([(9, 14), (9, 18)], "m")
    p.ell((8, 11, 20, 14), "k")
    for dx in (0, 4, 9, 13): p.px(8 + dx, 8 - (frame + dx) % 3, "z")
    for x0 in (5, 8, 11, 14, 17, 19): p.ell((x0, 22, x0 + 4, 27), "s")
    p.rect(8, 22, 20, 25, "N"); p.line([(6, 24), (22, 24)], "n", 2)
    fl = [[(9, 22), (11, 17), (13, 21), (14, 15), (16, 21), (18, 17), (19, 22)],
          [(9, 22), (12, 16), (13, 20), (15, 14), (17, 20), (19, 18), (19, 22)],
          [(9, 22), (10, 18), (13, 20), (14, 16), (16, 20), (18, 15), (19, 22)]][frame % 3]
    p.poly(fl, "O"); p.poly([(11, 22), (14, 18), (17, 22)], "Y"); p.poly([(13, 22), (14, 20), (15, 22)], "y")
    return p.outline()


def fences(snow):
    h = Pix(16, 20)
    rail, shade = ("n", "N") if not snow else ("w", "v")
    h.rect(0, 7, 15, 9, rail); h.rect(0, 9, 15, 9, shade); h.rect(0, 13, 15, 15, rail); h.rect(0, 15, 15, 15, shade)
    h.outline()
    post = Pix(16, 20)
    post.rect(5, 3, 10, 18, "o" if not snow else "w"); post.rect(8, 3, 10, 18, "n" if not snow else "v"); post.rect(5, 3, 10, 5, "t" if not snow else "h")
    post.outline()
    v = Pix(16, 20)
    v.rect(6, 0, 9, 19, rail); v.rect(8, 0, 9, 19, shade)
    v.outline()
    return h, post, v


def build_buildings():
    for snow in (False, True):
        sfx = "snow" if snow else "warm"
        for kind in ("red", "blue", "green", "plum"):
            house(kind, snow).save(f"bld_house_{kind}_{sfx}.png")
        barn(snow).save(f"bld_barn_{sfx}.png"); coop(snow).save(f"bld_coop_{sfx}.png")
        shop(snow).save(f"bld_shop_{sfx}.png"); well(snow).save(f"bld_well_{sfx}.png")
        h, post, v = fences(snow)
        h.save(f"fence_h_{sfx}.png"); post.save(f"fence_post_{sfx}.png"); v.save(f"fence_v_{sfx}.png")
    frames = [kitchen(i).arr() for i in range(3)]
    save(np.concatenate(frames, axis=1), "kitchen.png")
    MANIFEST["buildings"] = {
        "house": {"w": 64, "h": 58, "door": 32, "base": 55}, "barn": {"w": 80, "h": 66, "door": 40, "base": 63},
        "coop": {"w": 44, "h": 42, "door": 21, "base": 41}, "shop": {"w": 76, "h": 60, "door": 53, "base": 56},
        "well": {"w": 24, "h": 32, "door": 12, "base": 31}, "kitchen": {"w": 28, "h": 30, "frames": 3, "base": 28}}


if __name__ == "__main__":
    build_terrain(); build_nature(); build_characters(); build_icons(); build_buildings()
    with open(os.path.join(OUT, "manifest.json"), "w") as f:
        json.dump(MANIFEST, f, indent=1)
    print("ok", len(os.listdir(OUT)), "files")
