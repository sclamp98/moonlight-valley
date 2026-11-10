#!/usr/bin/env python3
"""Builds the treadmill art from the supplied treadmill video (tradmill_1.mp4, 1280x720 @ 24 fps, white background).

Usage:  ffmpeg -i tradmill_1.mp4 -vsync 0 full/f_%03d.png
        python tools/build_treadmill_assets.py        (run from a folder that contains full/)
Writes ./out/treadmill_{male,female}_run_00..N.png, treadmill_base.png (the machine on its own) and prints the numbers used by cinema/treadmill.js.

Video segments (1-based frame numbers): male run 1-107 | female run 108-214 | both side by side 215-240 (not used).
Each run is one ~20-frame stride loop, taken straight from the video (no re-drawn frames).  Every frame shares one canvas, so the machine
stays put while only the runner moves.  treadmill_base.png is the same canvas with the runner taken out (median of both runs + a row fill
behind the body), so the idle pose is simply the player's own standing sprite on the machine.
"""
import numpy as np, os, sys, json
from PIL import Image
from scipy import ndimage as ndi

BOX = (380, 30, 900, 720)                    # shared canvas (x0, y0, x1, y1) in video pixels
LOOP = 20                                    # frames per stride loop
def load(i): return np.asarray(Image.open(f'full/f_{i:03d}.png').convert('RGB'), dtype=np.float32)[BOX[1]:BOX[3], BOX[0]:BOX[2]]

def cutout(rgb):
    near = np.abs(rgb - 255).sum(2) < 60
    pure = np.abs(rgb - 255).sum(2) < 24                    # near-pure white pockets (gap between the legs, under an arm) are background too
    lab, n = ndi.label(near)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))); border.discard(0)
    bg = np.isin(lab, list(border))
    sizes = ndi.sum(near, lab, range(1, n + 1))
    for i, sz in enumerate(sizes, 1):
        if sz > 250: bg |= (lab == i)           # big enclosed white pockets (between arm and torso)
    lp, npk = ndi.label(pure)
    for i, sz in enumerate(ndi.sum(pure, lp, range(1, npk + 1)), 1):
        if sz > 12: bg |= (lp == i)
    fg = ~bg
    l2, n2 = ndi.label(fg); sz2 = ndi.sum(fg, l2, range(1, n2 + 1))
    keep = np.zeros_like(fg)
    for i, s in enumerate(sz2, 1):
        if s >= 40: keep |= (l2 == i)
    return keep

def best_loop(a, b):
    """start frame s in [a, b-LOOP] whose frame s+LOOP looks most like frame s (smoothest wrap)."""
    g = {i: load(i).mean(2) for i in range(a, b + 1)}
    best = min(range(a + 4, b - LOOP - 3), key=lambda s: np.abs(g[s] - g[s + LOOP]).mean() + 0.5 * np.abs(g[s + 1] - g[s + LOOP + 1]).mean())
    return best

def build_base(M, F):
    d = np.abs(M - F).max(2) > 28
    skin = (M[..., 0] - M[..., 2] > 35) & (M[..., 0] > 150)                       # skin / hair left behind where the legs swung
    d = ndi.binary_dilation(ndi.binary_closing(d | skin, iterations=3), iterations=12)
    base = M.copy()
    alpha = cutout(base)
    H, W = d.shape
    def edge(y, x0, x1):                                                         # machine colour just outside the hole (ignores background / skin)
        px = base[y, max(0, x0):x1].reshape(-1, 3)
        px = px[(np.abs(px - 255).sum(1) > 60) & ~((px[:, 0] - px[:, 2] > 35) & (px[:, 0] > 150))]
        return np.median(px, axis=0) if len(px) else None
    for y in range(H):
        row = d[y]
        if not row.any(): continue
        xs = np.where(row)[0]
        for sg in np.split(xs, np.where(np.diff(xs) > 1)[0] + 1):
            a, b = sg[0], sg[-1]
            alpha[y, a:b + 1] = False
            if a < 14 or b > W - 15 or not ((292 <= y <= 306) or y >= 456): continue
            l = edge(y, a - 14, a - 1); r = edge(y, b + 2, b + 15)
            if l is None or r is None: continue
            for x in range(a, b + 1): base[y, x] = l + (r - l) * (x - a) / max(1, b - a)
            alpha[y, a:b + 1] = True
    alpha[:290] = False                                                          # the arcs above the grips are hidden behind the runner's shoulders: drop them, the machine reads fine without
    return base, alpha

SCALE = 0.5                                  # stored at half the video size (still ~3x the on-screen size) to keep the download small
def save(rgb, a, path):
    im = Image.fromarray(np.dstack([np.clip(rgb, 0, 255).astype(np.uint8), (a * 255).astype(np.uint8)])).convert('RGBa')
    im.resize((round(im.width * SCALE), round(im.height * SCALE)), Image.LANCZOS).convert('RGBA').save(path, optimize=True)

def main():
    os.makedirs('out', exist_ok=True)
    runs = {'male': (1, 107), 'female': (108, 214)}
    meta = {}
    starts = {k: best_loop(*v) for k, v in runs.items()}
    meds = {k: np.median(np.stack([load(i) for i in range(*[runs[k][0], runs[k][1] + 1])]), axis=0) for k in runs}
    base, balpha = build_base(meds['male'], meds['female'])
    save(base, balpha, 'out/treadmill_base.png')
    for k, s in starts.items():
        for j in range(LOOP):
            rgb = load(s + j); save(rgb, cutout(rgb), f'out/treadmill_{k}_run_{j:02d}.png')
    meta = {'starts': starts, 'loop': LOOP, 'box': BOX, 'canvas': [round(260), round(345)], 'ax': 128, 'pad': 52, 'refH': 275.5, 'note': 'machine centre x=128, runner stance foot-line y=292 (canvas 260x345); video runner is 551 px head-to-toe at full size = 275.5 here'}
    json.dump(meta, open('out/meta.json', 'w')); print(meta)

if __name__ == '__main__': main()
