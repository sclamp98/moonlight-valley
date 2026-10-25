#!/usr/bin/env python3
"""Builds the co-op EMOTE sprites (kiss + hip slap) from the two couple videos.

Usage (from the project root; needs ffmpeg, numpy, scipy, pillow):
    python tools/build_emote_assets.py kiss_1.mp4 slap_1.mp4 hug___knee_2.mp4
        [--work /tmp/emote_work]        where the full-size video frames are extracted (re-used if present)

Writes   assets/emote/kiss_<i>.png, assets/emote/slap_<i>.png     (one canvas per clip, both people in every frame)
         cinema/emote_art.js                                         (EMOTE_ART: timing, canvas numbers, slots, shadows)

Why a *pair* sprite: in both clips the two bodies overlap (hug, kiss, a hand on a hip) so they can't be cut apart.
The game plays the pair as one animation drawn between the two farmers (cinema/emotes.js), and hides the two
normal sprites while it runs.

Source segments (24 fps, 1280x720, flat light-grey background):
    kiss_1.mp4   take 2, frames 244-384   walk in -> kiss/hug -> step apart.
                 (take 1 of that video has a push-in zoom that crops the feet off, so it is not used)
    slap_1.mp4   frames 140-238           back to the camera -> wind-up -> slap (impact spark) -> she hops round -> he flexes.
                 (frames 1-132 are a front-view kiss + a hard cut at 132/133 into the back-view shot; not used)

    hug_knee_2.mp4   (hug___knee_2.mp4)
                 hug   frames 1-60     walk in -> hug (hearts are part of the video) -> (hard cut at 61, not used)
                 knee  frames 76-156   WOMAN ALONE: drops to her knees, idles, ties her hair (the "!" bubble) -> holds the last frame
                 grab  frames 156-236  she kneels, he walks in and takes her chin. The video FLIPS sides at frame 175/176 (man left, woman right);
                                       frames >= 176 are mirrored back and shifted 36 px so her kneeling spot matches frame 174.

Everything in EMOTE_ART is in output-canvas pixels. At draw time k = CONFIG.SPRITE_H.player / refH (same rule as drawVid in game.js).
"""
import sys, os, json, argparse, subprocess, glob
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

OUT_SCALE = 0.5          # full-res video px -> stored px (the home room is shown ~1.5x, so this stays sharp)
FPS = 24.0

def rng(a, b, step): return list(range(a, b + 1, step))

def hug_frames(): return rng(1, 27, 2) + rng(28, 60, 4)
def grab_frames(): return rng(156, 174, 2) + rng(176, 204, 2) + rng(208, 236, 4)
def knee_frames(): return rng(76, 82, 1) + [84, 90, 96, 102] + rng(104, 156, 2)
FLIP_FROM, FLIP_SHIFT = 176, 36        # grab: mirrored back about the frame centre, then moved left by 36 px (measured on her kneeling shorts)
PAIR_REFH = 559.0                      # (woman 583 + man 535) / 2 standing height in the video: one scale for hug / knee / grab

CLIPS = {
    'kiss': dict(
        frames=rng(244, 300, 2) + [302, 308, 314, 320, 326, 332, 338] + rng(342, 382, 2) + [384],
        floor=675, speed=1.1,
        marks=dict(kissFrom=270, kissTo=342),          # source frames: lips touch .. start to part (hearts float meanwhile)
    ),
    'hug': dict(video='hug', frames=hug_frames(), floor=677, speed=1.0, refH=PAIR_REFH, fade=0.35, endSame=True, marks={}),
    'grab': dict(video='hug', frames=grab_frames(), floor=676, speed=1.0, refH=PAIR_REFH, fade=0.35, endSame=True, marks={}, prep='unflip'),
    'knee': dict(video='hug', frames=knee_frames(), floor=676, solo=True, drop=7, hold=156, split=690, speed=1.0, refH=PAIR_REFH),
    'slap': dict(
        frames=rng(140, 172, 2) + rng(173, 184, 1) + rng(186, 226, 2) + rng(228, 238, 2),
        floor=673, speed=1.0,
        marks=dict(impact=175),                         # source frame of the hit
    ),
}

def extract(video, work, name):
    d = os.path.join(work, f'v_{name}')
    if glob.glob(os.path.join(d, 'f_*.png')): return d
    os.makedirs(d, exist_ok=True)
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', video, '-vsync', '0', os.path.join(d, 'f_%03d.png')], check=True)
    return d

def cutout(path, T=40, pocket=120, erode=2):
    """RGBA of the people: background removed by flood fill from the borders (+ big enclosed pockets), then a small
    erosion with the colour bled outward from the interior, so the compression halo of the video never shows."""
    rgb = np.array(Image.open(path).convert('RGB')).astype(int)
    corners = np.concatenate([rgb[:30, :30].reshape(-1, 3), rgb[-30:, -30:].reshape(-1, 3), rgb[:30, -30:].reshape(-1, 3)])
    bg = np.median(corners, axis=0)
    near = np.abs(rgb - bg).sum(2) < T
    lab, n = ndi.label(near)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))); border.discard(0)
    bgm = np.isin(lab, list(border))
    sizes = ndi.sum(near, lab, range(1, n + 1))
    for i, sz in enumerate(sizes, 1):
        if sz > pocket: bgm |= (lab == i)
    fg = ~bgm
    l2, n2 = ndi.label(fg)
    s2 = ndi.sum(fg, l2, range(1, n2 + 1))
    keep = np.zeros_like(fg)
    for i, s in enumerate(s2, 1):
        if s >= 40: keep |= (l2 == i)           # drops specks, keeps hearts / the impact spark
    core = ndi.binary_erosion(keep, iterations=erode) if erode else keep
    _, (iy, ix) = ndi.distance_transform_edt(~core, return_indices=True)
    col = rgb[iy, ix].astype(np.uint8)          # every pixel takes the colour of the nearest interior pixel
    alpha = ndi.gaussian_filter(core.astype(np.float32), 0.7)
    alpha[~ndi.binary_dilation(core, iterations=1)] = 0
    return np.dstack([col, np.clip(alpha * 255, 0, 255).astype(np.uint8)])

def unflip(a):
    f = a[:, ::-1]; out = np.zeros_like(a); out[:, :-FLIP_SHIFT] = f[:, FLIP_SHIFT:]; return out

def people(alpha, minpix=3000):
    """The (up to) two separate bodies of an *un-touching* frame, left to right: bbox + centre x."""
    m = alpha > 128
    lab, n = ndi.label(ndi.binary_closing(m, iterations=6))
    out = []
    for i in range(1, n + 1):
        ys, xs = np.where((lab == i) & m)
        if len(ys) < minpix: continue
        out.append(dict(x0=int(xs.min()), x1=int(xs.max()), y0=int(ys.min()), y1=int(ys.max())))
    out.sort(key=lambda c: c['x0'])
    for c in out: c['cx'] = (c['x0'] + c['x1']) / 2.0; c['h'] = c['y1'] - c['y0']
    return out

def build(name, spec, vdir, outdir):
    fr = spec['frames']; floor = spec['floor']
    rgba = [cutout(os.path.join(vdir, f'f_{k:03d}.png')) for k in fr]
    if spec.get('prep') == 'unflip': rgba = [unflip(a) if k >= FLIP_FROM else a for k, a in zip(fr, rgba)]
    p0 = people(rgba[0][..., 3]); p1 = p0 if spec.get('endSame') else people(rgba[-1][..., 3])
    assert len(p0) == 2 and len(p1) == 2, f'{name}: first/last frame must show two separate people ({len(p0)}, {len(p1)})'
    mid = (p0[0]['cx'] + p0[1]['cx']) / 2.0                      # the pair's anchor (video px)
    bbs = []
    for a in rgba:
        ys, xs = np.where(a[..., 3] > 40); bbs.append((xs.min(), xs.max(), ys.min(), ys.max()))
    left = int(np.ceil(max(mid - b[0] for b in bbs))) + 4
    right = int(np.ceil(max(b[1] - mid for b in bbs))) + 4
    top = max(0, min(b[2] for b in bbs) - 4)
    bottom = max(max(b[3] for b in bbs), floor) + 4
    left += left % 2; right += right % 2; bottom += (bottom - top) % 2
    x_lo = int(round(mid)) - left
    W, H = left + right, bottom - top
    os.makedirs(outdir, exist_ok=True)
    for f in glob.glob(os.path.join(outdir, f'{name}_*.png')): os.remove(f)
    feet = []
    for i, a in enumerate(rgba):
        canvas = np.zeros((H, W, 4), np.uint8)
        sx0, sx1 = max(0, x_lo), min(a.shape[1], x_lo + W)
        canvas[:, sx0 - x_lo:sx1 - x_lo] = a[top:bottom, sx0:sx1]
        im = Image.fromarray(canvas, 'RGBA').resize((int(W * OUT_SCALE), int(H * OUT_SCALE)), Image.LANCZOS)
        im = im.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)   # ~4x smaller, looks identical
        im.save(os.path.join(outdir, f'{name}_{i}.png'), optimize=True)
        # shadow extent: columns covered by the lowest rows of the bodies (output px, canvas-left based)
        al = canvas[..., 3] > 128; ys = np.where(al.any(1))[0]; yb = ys.max()
        cols = np.where(al[max(0, yb - 14):yb + 1].any(0))[0]
        feet.append([round(cols.min() * OUT_SCALE, 1), round(cols.max() * OUT_SCALE, 1)])
    # the two people's standing heights decide the draw scale: one scale for the pair, between the two normal sprites
    refH = spec.get('refH') or (np.mean([p0[0]['h'], p1[0]['h']]) + np.mean([p0[1]['h'], p1[1]['h']])) / 2.0
    t0 = fr[0]
    times = [round((k - t0) / FPS / spec['speed'], 4) for k in fr]
    dur = round(times[-1] + 2.0 / FPS / spec['speed'], 4)          # the last frame is held for ~2 source frames
    rel = lambda x: round((x - mid) * OUT_SCALE, 1)                 # x relative to the pair anchor, output px
    art = dict(
        n=len(fr), t=times, dur=dur, W=int(W * OUT_SCALE), H=int(H * OUT_SCALE),
        ax=round((mid - x_lo) * OUT_SCALE, 1), pad=round((bottom - floor) * OUT_SCALE, 1), refH=round(refH * OUT_SCALE, 1),
        # where the two normal sprites stand before / after (x relative to the anchor): woman then man
        slots=dict(f0=rel(p0[0]['cx']), m0=rel(p0[1]['cx']), f1=rel(p1[0]['cx']), m1=rel(p1[1]['cx'])),
        feet=feet, fade=spec.get('fade', 0.15), fixedFemale=(name == 'grab'),
        marks={k: round((v - t0) / FPS / spec['speed'], 3) for k, v in spec['marks'].items()},
    )
    return art

def build_solo(name, spec, vdir, outdir):
    """Woman alone (everything left of spec['split'], her \"!\" bubble included). The anchor is the centre of her body in the HOLD frame,
    so the kneeling pose sits exactly where the farmer stands. The first spec['drop'] frames are the drop to the knees (played backwards to stand up)."""
    fr, floor = spec['frames'], spec['floor']
    rgba = []
    for k in fr:
        a = cutout(os.path.join(vdir, f'f_{k:03d}.png')); a[:, spec['split']:, 3] = 0; rgba.append(a)
    hold = rgba[fr.index(spec['hold'])]; ys, xs = np.where(hold[..., 3] > 128); mid = (xs.min() + xs.max()) / 2.0
    bbs = []
    for a in rgba:
        ys, xs = np.where(a[..., 3] > 40); bbs.append((xs.min(), xs.max(), ys.min(), ys.max()))
    left = int(np.ceil(max(mid - b[0] for b in bbs))) + 4; right = int(np.ceil(max(b[1] - mid for b in bbs))) + 4
    top = max(0, min(b[2] for b in bbs) - 4); bottom = max(max(b[3] for b in bbs), floor) + 4
    left += left % 2; right += right % 2; bottom += (bottom - top) % 2
    x_lo = int(round(mid)) - left; W, H = left + right, bottom - top
    os.makedirs(outdir, exist_ok=True)
    for f in glob.glob(os.path.join(outdir, f'{name}_*.png')): os.remove(f)
    for i, a in enumerate(rgba):
        canvas = np.zeros((H, W, 4), np.uint8); sx0, sx1 = max(0, x_lo), min(a.shape[1], x_lo + W)
        canvas[:, sx0 - x_lo:sx1 - x_lo] = a[top:bottom, sx0:sx1]
        im = Image.fromarray(canvas, 'RGBA').resize((int(W * OUT_SCALE), int(H * OUT_SCALE)), Image.LANCZOS)
        im.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(os.path.join(outdir, f'{name}_{i}.png'), optimize=True)
    t0 = fr[0]; times = [round((k - t0) / FPS / spec['speed'], 4) for k in fr]
    return dict(n=len(fr), t=times, dur=round(times[-1] + 1.0 / FPS, 4), W=int(W * OUT_SCALE), H=int(H * OUT_SCALE), ax=round((mid - x_lo) * OUT_SCALE, 1),
                pad=round((bottom - floor) * OUT_SCALE, 1), refH=round(spec['refH'] * OUT_SCALE, 1), drop=spec['drop'], upDur=round(spec['drop'] / FPS, 3), solo=True)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('kiss'); ap.add_argument('slap'); ap.add_argument('hugknee', help='hug___knee_2.mp4'); ap.add_argument('--work', default='/tmp/emote_work')
    a = ap.parse_args()
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    outdir = os.path.join(root, 'assets', 'emote')
    art = {}
    vids = {'kiss': a.kiss, 'slap': a.slap, 'hug': a.hugknee}
    for name in ('kiss', 'slap', 'hug', 'knee', 'grab'):
        spec = CLIPS[name]; vkey = spec.get('video', name)
        vdir = extract(vids[vkey], a.work, vkey)
        art[name] = (build_solo if spec.get('solo') else build)(name, spec, vdir, outdir)
        m = art[name]; print(name, {k: m[k] for k in ('n', 'dur', 'W', 'H', 'ax', 'pad', 'refH', 'slots', 'marks') if k in m})
    js = '/* generated by tools/build_emote_assets.py */\nconst EMOTE_ART = ' + json.dumps(art, separators=(',', ':')) + ';\n'
    open(os.path.join(root, 'cinema', 'emote_art.js'), 'w').write(js)
    size = sum(os.path.getsize(f) for f in glob.glob(os.path.join(outdir, '*.png')))
    print('wrote cinema/emote_art.js and', len(glob.glob(os.path.join(outdir, '*.png'))), 'frames in assets/emote/', f'({size / 1e6:.1f} MB)')

if __name__ == '__main__':
    main()
