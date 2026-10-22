#!/usr/bin/env python3
"""Builds the FRONT and BACK walk cycles (assets/male_walk_down_*.png, male_walk_up_*.png)
from the standing poses male_down.png / male_up.png.

The standing sprite is warped (no cut-and-paste seams) into an 8-frame walk:
  * legs alternate: planted foot slides back while the other swings forward with a lift
  * body dips on the contact frames and rises on the passing frames, with a small sway
  * arms swing opposite to the legs
Run from the game folder:  python tools/make_walk_frames.py
Tweak STRIDE / LIFT / DIP / SWAY / ARM below to taste (px on the 276x575 source art).
"""
import os, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ASSETS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets")
N = 8
STRIDE, LIFT, DIP, SWAY, ARM = 13.0, 15.0, 9.0, 3.0, 20.0

def smooth(t):
    t = np.clip(t, 0, 1); return t * t * (3 - 2 * t)

def analyse(a):
    """Find hip pivot, leg gap centre, arm masks from the alpha channel."""
    H, W = a.shape
    # leg gap: lowest rows have two runs; centre of the gap at y = H-80
    row = np.where(a[H - 80])[0]
    gaps = np.where(np.diff(row) > 4)[0]
    g = gaps[np.argmax(np.diff(row)[gaps])]
    gapx = (row[g] + row[g + 1]) / 2
    # hip pivot: first row (scanning down from the waist) where the centre column is empty
    y = int(H * 0.5)
    while y < H and a[y, int(gapx)]: y += 1
    hip = y - 8
    # arms: components below the armpit once they separate from the torso
    split = None
    for y in range(int(H * 0.35), int(H * 0.7)):
        r = np.where(a[y])[0]
        runs = 1 + int((np.diff(r) > 3).sum())
        if runs >= 3: split = y; break
    W = a.shape[1]
    lab, n = ndi.label(a[split + 4:, :])
    pad = np.zeros_like(lab); full = np.zeros(a.shape, int); full[split + 4:] = lab
    cx_l = np.where(a[split + 40])[0][0] + 12; cx_r = np.where(a[split + 40])[0][-1] - 12
    L = full == full[split + 40, cx_l]; R = full == full[split + 40, cx_r]
    r0 = int(H * 0.26)
    for m, side in ((L, "l"), (R, "r")):  # extend each arm straight up to the shoulder
        xs_ = np.where(m.any(0))[0]; x0, x1 = xs_.min(), xs_.max()
        cols = slice(0, x1 + 1) if side == "l" else slice(x0, W)
        m[r0:split + 4, cols] |= a[r0:split + 4, cols]
    ys = np.where(L.any(1))[0]; hand = ys.max(); shoulder = int(H * 0.26)
    return gapx, hip, L, R, shoulder, hand

def foot_state(t):
    """t in [0,1): stance (0..0.5) foot slides back; swing (0.5..1) foot comes forward with a lift. returns (s, lift)"""
    if t < 0.5: return STRIDE - 2 * STRIDE * (t / 0.5), 0.0
    u = (t - 0.5) / 0.5
    return -STRIDE + 2 * STRIDE * u, LIFT * np.sin(np.pi * u)

def build(name, sgn):
    im = Image.open(os.path.join(ASSETS, name + ".png")).convert("RGBA")
    arr = np.asarray(im).astype(np.float32) / 255.0
    arr[..., :3] *= arr[..., 3:4]                      # premultiply -> clean edges when resampling
    a = arr[..., 3] > 0.16
    H, W = a.shape
    gapx, hip, Lm, Rm, shoulder, hand = analyse(a)
    print(f"{name}: gap x={gapx:.0f} hip y={hip} shoulder={shoulder} hand={hand}")
    grow = lambda m: ndi.gaussian_filter(ndi.binary_dilation(m, iterations=3).astype(np.float32), 1.5)  # outline pixels move with the arm
    Lw, Rw = grow(Lm), grow(Rm)
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
    v = np.clip((ys - shoulder) / max(1, hand - 50 - shoulder), 0, 1) ** 1.25   # hands (last 50px) move rigidly
    side = smooth((xs - (gapx - 5)) / 10.0)            # 0 = left leg, 1 = right leg (soft 10px seam)
    for k in range(N):
        t = k / N
        sA, hA = foot_state(t)                          # left leg (screen-left)
        sB, hB = foot_state((t + 0.5) % 1.0)            # right leg
        if sgn > 0: DA, DB = (STRIDE - sA) + hA, (STRIDE - sB) + hB       # walking toward camera: forward foot is lowest
        else:       DA, DB = (STRIDE + sA) + hA, (STRIDE + sB) + hB       # walking away: trailing foot is lowest
        D = DA * (1 - side) + DB * side
        dip = DIP * (1 + np.cos(4 * np.pi * t)) / 2    # body lowest on contact, highest when passing
        sway = -SWAY * np.sin(2 * np.pi * t)
        top = hip + dip
        # body (above the hip) is shifted; legs are stretched between the hip and the lifted foot
        leg_len_out = np.maximum((H - D) - top, 1.0)
        sy = np.where(ys <= top, ys - dip, hip + (ys - top) * ((H - hip) / leg_len_out))
        sy = np.where(ys > H - D, -10.0, sy)           # below the lifted foot: empty
        sx = xs - sway * smooth((hip + 30 - ys) / 60.0)  # sway fades out toward the feet
        # arms swing opposite to the legs: the arm on the same side as the *trailing* leg goes forward
        fwdL, fwdR = sB / STRIDE, sA / STRIDE
        armdy = sgn * ARM * (fwdL * Lw + fwdR * Rw) * v
        sy = sy - armdy
        out = np.zeros_like(arr)
        for c in range(4):
            out[..., c] = ndi.map_coordinates(arr[..., c], [sy, sx], order=1, mode="constant", cval=0.0)
        al = out[..., 3:4]
        out[..., :3] = np.where(al > 1e-4, out[..., :3] / np.maximum(al, 1e-4), 0)
        out = np.clip(out * 255 + 0.5, 0, 255).astype(np.uint8)
        # clean the faint fringe the bilinear warp leaves
        out[..., 3] = np.where(out[..., 3] < 24, 0, out[..., 3])
        lab, n = ndi.label(out[..., 3] > 0)                       # drop detached specks left by the warp
        if n > 1:
            sizes = ndi.sum(np.ones_like(lab), lab, range(1, n + 1))
            for i, sz in enumerate(sizes, 1):
                if sz < 150: out[lab == i] = 0
        Image.fromarray(out, "RGBA").save(os.path.join(ASSETS, f"male_walk_{'down' if sgn > 0 else 'up'}_{k}.png"))

if __name__ == "__main__":
    build("male_down", +1); build("male_up", -1); print("walk frames written")
