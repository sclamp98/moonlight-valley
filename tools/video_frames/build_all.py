import sys, json, os
sys.path.insert(0, '/home/claude/work')
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
import vp
from vp import *

def loop_frames(s, L, n=8): return [int(s + i * L / n + 0.5) for i in range(n)]

# ---- set definitions -------------------------------------------------------------------------
# name: dict(v=video, frames=[...], prefix=file prefix, refH=standing height, floor=None|int, cut=dict, anchor=dict)
FEM = dict(lo=0.45, hi=0.62, vlo=40, vhi=190, sat=30)
MAL = dict(lo=0.38, hi=0.58, vlo=0, vhi=105, sat=30)
FREF = 618   # female standing head->floor height (video px)
MREF = 544   # male height inside the weapons video (0.987 x the walking-video male = 551)
SETS = {
  'fem_walk_down':  dict(v='f1', frames=loop_frames(4, 34),   refH=FREF, floor=None, anchor=FEM, cut={}),
  'fem_walk_up':    dict(v='f1', frames=loop_frames(109, 34), refH=FREF, floor=None, anchor=FEM, cut={}),
  'fem_walk_right': dict(v='f1', frames=loop_frames(186, 33), refH=FREF, floor=None, anchor=FEM, cut={}),
  'fem_eat':        dict(v='f2', frames=list(range(1, 90, 4)) + [238], refH=FREF, floor=681, anchor='hipconst', cut={}),
  'fem_swing':      dict(v='f2', frames=[104, 110, 116, 122, 131, 137, 143, 149, 158, 161], refH=FREF, floor=681, anchor='hipconst', cut={}),
  'fem_stand_down': dict(v='f2', frames=[238], refH=FREF, floor=681, anchor=FEM, cut={}),
  'fem_stand_up':   dict(v='f1', frames=[129], refH=FREF, floor=None, anchor=FEM, cut={}),
  'fem_stand_right':dict(v='f1', frames=[194], refH=FREF, floor=None, anchor='bbox', cut={}),
  'mal_sword':      dict(v='mw', frames=[31, 33, 35, 37, 39, 41, 43, 45, 47], refH=MREF, floor=659, anchor='feet', cut=dict(swoosh=True, drop_dark_detached=True)),
  'mal_bow':        dict(v='mw', frames=[70, 76, 82, 85, 88, 94, 100, 106], refH=MREF, floor=659, anchor='feet', cut=dict(drop_dark_detached=True)),
  'mal_xbow':       dict(v='mw', frames=[145, 148, 151, 154, 157, 160, 163, 166, 169], clip={148: 330}, refH=MREF, floor=659, anchor='feet', cut=dict(drop_dark_detached=True)),
  'mal_pistol':     dict(v='mw', frames=[190, 193, 199, 202, 205, 208], refH=MREF, floor=659, anchor='feet', cut=dict(drop_dark_detached=True)),
}

def anchors(spec, rgbas):
    if spec['anchor'] == 'feet':   # in-place character: one constant anchor per set (median planted-feet x)
        return np.full(len(rgbas), float(np.median([feet_x(r) for r in rgbas])))
    if spec['anchor'] == 'bbox':
        return np.array([(bbox(r)[0] + bbox(r)[1]) / 2.0 for r in rgbas])
    if spec['anchor'] == 'hipconst':   # in-place: one constant hip anchor (median of the per-frame estimates)
        return np.full(len(rgbas), float(np.median([shorts_x(r, **FEM) for r in rgbas])))
    xs = np.array([shorts_x(r, **spec['anchor']) for r in rgbas])
    if len(xs) >= 5: xs = ndi.median_filter(xs, size=5, mode='nearest')
    return xs

def build(name, spec, outdir):
    rg = [cutout(spec['v'], k, **spec['cut']) for k in spec['frames']]
    ax = anchors(spec, rg)
    bbs = [bbox(r, amin=20) for r in rg]
    floor = spec['floor'] if spec['floor'] else int(np.median([b[3] for b in bbs])) + 1
    top = max(0, min(b[2] for b in bbs) - 3)
    bottom = max(max(b[3] for b in bbs), floor) + 3
    left = int(np.ceil(max(a - b[0] for a, b in zip(ax, bbs)))) + 3
    right = int(np.ceil(max(b[1] - a for a, b in zip(ax, bbs)))) + 3
    W, H = left + right, bottom - top
    for i, (r, a) in enumerate(zip(rg, ax)):
        cl = spec.get('clip', {}).get(spec['frames'][i])
        if cl is not None:                      # erase everything further right than anchor+cl (e.g. a bolt in flight)
            r = r.copy(); r[:, int(a + cl):, 3] = 0
        out = np.zeros((H, W, 4), np.uint8)
        off = left - int(round(a))                  # shift so the anchor lands at x = left
        h, w = r.shape[:2]
        x0, x1 = max(0, off), min(W, off + w)
        out[:, x0:x1] = r[top:bottom, x0 - off:x1 - off]
        Image.fromarray(out, 'RGBA').save(f'{outdir}/{name}_{i}.png', optimize=True)
    return dict(n=len(rg), W=int(W), H=int(H), ax=int(left), pad=int(bottom - floor), refH=int(spec['refH']))

if __name__ == '__main__':
    only = sys.argv[1:]
    os.makedirs('out2', exist_ok=True)
    meta = json.load(open('out2/meta.json')) if os.path.exists('out2/meta.json') else {}
    for name, spec in SETS.items():
        if only and name not in only: continue
        meta[name] = build(name, spec, 'out2'); print(name, meta[name])
    json.dump(meta, open('out2/meta.json', 'w'), indent=1)
