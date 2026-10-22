#!/usr/bin/env python3
"""One-off cleanup for the video-derived side-view frames (run once; safe to re-run):
  * male_walk_*  : remove leftover white background blobs, give every frame the same canvas
                   (587px tall like male_right.png, torso centred) so the character no longer
                   jitters sideways or changes size from frame to frame.
  * male_attack_*: same height as the standing pose (bottom-aligned), so the swing keeps the
                   body at the same scale.  Widths are kept as drawn.
"""
import os, glob
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

A = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets")
H = 587

def clean_white(arr):
    rgb, a = arr[..., :3].astype(int), arr[..., 3]
    white = (a > 40) & (rgb.min(2) > 215)
    lab, n = ndi.label(white)
    if not n: return arr
    sizes = ndi.sum(white, lab, range(1, n + 1))
    kill = np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s >= 150])      # big blobs = background leftovers (eye whites are tiny)
    halo = ndi.binary_dilation(kill, iterations=2) & (rgb.min(2) > 175) & (a > 0)
    arr[kill | halo, 3] = 0
    return arr

def to_canvas(arr, w, x_off):
    out = np.zeros((H, w, 4), np.uint8); h = arr.shape[0]
    out[H - h:, x_off:x_off + arr.shape[1]] = arr                                # bottom-aligned
    return out

walk = [np.array(Image.open(f"{A}/male_walk_{i}.png").convert("RGBA")) for i in range(8)]
walk = [clean_white(f) for f in walk]
cx = []
for f in walk:
    a = f[..., 3] > 40; ys, xs = np.where(a); h = f.shape[0]
    band = (ys > h * 0.30) & (ys < h * 0.55); cx.append(xs[band].mean())          # torso centre
half = int(max(max(c, f.shape[1] - c) for c, f in zip(cx, walk))) + 2
for i, (f, c) in enumerate(zip(walk, cx)):
    Image.fromarray(to_canvas(f, half * 2, int(round(half - c)))).save(f"{A}/male_walk_{i}.png")
for p in sorted(glob.glob(f"{A}/male_attack_*.png")):
    f = np.array(Image.open(p).convert("RGBA"))
    Image.fromarray(to_canvas(f, f.shape[1], 0)).save(p)
print("side frames normalised; walk canvas", half * 2, "x", H)
