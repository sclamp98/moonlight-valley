#!/usr/bin/env python3
"""Builds the FRONT walk, BACK walk, standing and EATING frames from the movement video.

Usage:  ffmpeg -i man_movemnt_3.mp4 -vsync 0 full/f_%03d.png
        python tools/build_video_frames.py        (run from a folder that contains full/)
Writes assets/male_walk_down_*.png, male_walk_up_*.png, male_stand_down/up.png, male_eat_*.png
into ./out and prints the canvas numbers used by VIDEO_FRAME in game.js.
Video segments (24 fps): front walk 1-66 | stand 67-105 | eat 106-178 | back walk 194-231 | back stand 232-240.
Each walk cycle is one 24-frame loop sampled to 8 frames; all frames share one canvas, centred on the hips.
"""
import numpy as np, json, os, sys
from PIL import Image
from scipy import ndimage as ndi

def cutout(path):
    rgb = np.array(Image.open(path).convert('RGB')).astype(int)
    bg = np.array([253,253,253])
    dist = np.abs(rgb-bg).sum(2)
    near = dist < 40
    lab, n = ndi.label(near)
    border = set(np.unique(np.concatenate([lab[0],lab[-1],lab[:,0],lab[:,-1]])))
    border.discard(0)
    bgmask = np.isin(lab, list(border))
    # enclosed background pockets (gap between a raised arm and the torso) are large;
    # eye whites / teeth are small, so only big enclosed near-white areas are removed
    sizes_n = ndi.sum(near, lab, range(1, n + 1))
    for i, sz in enumerate(sizes_n, 1):
        if sz > 250: bgmask |= (lab == i)
    fg = ~bgmask
    # drop tiny specks that are not crumbs (keep comps >= 6 px), keep everything else
    l2, n2 = ndi.label(fg)
    sizes = ndi.sum(fg, l2, range(1,n2+1))
    keep = np.zeros_like(fg)
    for i,s in enumerate(sizes,1):
        if s >= 6: keep |= (l2==i)
    return rgb, keep

def hip_center(rgb, fg, top):
    # dark gray shorts: low saturation, dark
    r,g,b = rgb[...,0],rgb[...,1],rgb[...,2]
    mx = rgb.max(2); mn = rgb.min(2)
    shorts = (mx<95)&((mx-mn)<28)&fg
    ys,xs = np.where(shorts)
    # restrict to the largest blob of shorts region around body (hip band)
    lab,n = ndi.label(ndi.binary_closing(shorts, iterations=2))
    if n==0: return None
    sz = ndi.sum(shorts, lab, range(1,n+1))
    k = 1+int(np.argmax(sz))
    ys,xs = np.where((lab==k)&shorts)
    return xs.mean(), ys.mean(), ys.min(), ys.max()



def hip_x(rgb, fg):
    mx = rgb.max(2); mn = rgb.min(2)
    shorts = (mx < 100) & ((mx - mn) < 30) & fg
    band = np.zeros_like(shorts); band[318:432, :] = True
    shorts &= band
    lab, n = ndi.label(ndi.binary_closing(shorts, iterations=2))
    sz = ndi.sum(shorts, lab, range(1, n + 1))
    k = 1 + int(np.argmax(sz))
    m = (lab == k) & shorts
    ys, xs = np.where(m)
    return (xs.min() + xs.max()) / 2.0

def prep(k):
    rgb, fg = cutout(f'full/f_{k:03d}.png')
    cx = hip_x(rgb, fg)
    rgba = np.dstack([rgb.astype(np.uint8), (fg * 255).astype(np.uint8)])
    return rgba, cx



FRONT = [21 + 3*i for i in range(8)]          # 21..42  (24-frame loop, 8 samples)
BACK  = [201 + 3*i for i in range(8)]         # 201..222
STAND_FRONT, STAND_BACK = 100, 240
EAT   = list(range(106, 179, 4))              # 106..178, arm up -> chew -> arm down
sel = sorted(set(FRONT + BACK + EAT + [STAND_FRONT, STAND_BACK]))

data = {}
for k in sel:
    rgba, cx = prep(k)
    ys, xs = np.where(rgba[..., 3] > 0)
    data[k] = (rgba, cx, xs.min(), xs.max(), ys.min(), ys.max())

# reference standing size / ground line (from the clean front standing frame)
_, _, _, _, ytop_s, ybot_s = data[STAND_FRONT]
GROUND = ybot_s + 1                      # y where the feet touch the floor
REF_H = GROUND - ytop_s                  # head-top -> feet height of the standing pose (video px)

ymin = min(v[4] for v in data.values()); ymax = max(v[5] for v in data.values())
half = max(max(v[1] - v[2], v[3] - v[1]) for v in data.values())
W = int(np.ceil(half + 6) * 2); W += W % 2
top = ymin - 3; bottom = ymax + 3
H = bottom - top
pad = bottom - GROUND                    # px the canvas extends below the standing floor line
print('GROUND', GROUND, 'REF_H', REF_H, 'canvas', W, H, 'pad', pad, 'ymin', ymin, 'ymax', ymax, 'half', half)

def save(k, name):
    rgba, cx, *_ = data[k]
    out = np.zeros((H, W, 4), np.uint8)
    off = int(round(W / 2 - cx))
    h, w = rgba.shape[:2]
    # paste rows top..bottom, shifted so hip centre sits on canvas centre
    src_y0, src_y1 = top, min(bottom, h)
    x0 = max(0, off); x1 = min(W, off + w)
    out[0:src_y1 - src_y0, x0:x1] = rgba[src_y0:src_y1, x0 - off:x1 - off]
    Image.fromarray(out, 'RGBA').save(f'out/{name}.png', optimize=True)

os.makedirs('out', exist_ok=True)
for i, k in enumerate(FRONT): save(k, f'male_walk_down_{i}')
for i, k in enumerate(BACK):  save(k, f'male_walk_up_{i}')
eat_names = []
for i, k in enumerate(EAT):   save(k, f'male_eat_{i}')
# finish the eat clip on the neutral stance so it never snaps from a half-raised arm
save(STAND_FRONT, f'male_eat_{len(EAT)}')
save(STAND_FRONT, 'male_stand_down'); save(STAND_BACK, 'male_stand_up')
meta = dict(W=int(W), H=int(H), REF_H=int(REF_H), PAD=int(pad), EAT_FRAMES=len(EAT) + 1)
json.dump(meta, open('out/meta.json', 'w')); print(meta)
