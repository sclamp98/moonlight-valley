import numpy as np
from PIL import Image
from scipy import ndimage as ndi

VID = {'f1': ('v_female_movement_1', 246), 'f2': ('v_female_movement_2', 248), 'mw': ('v_man_wapons_1', 253)}
_cache = {}

def path(v, k): return f'{VID[v][0]}/f_{k:03d}.png'

def cutout(v, k, T=40, pocket=250, swoosh=False, drop_dark_detached=False):
    """Return (rgba uint8 array). Background removed by flood fill from the borders; big enclosed
    background pockets removed; optional translucent swoosh + removal of detached dark projectiles."""
    key = (v, k, T, pocket, swoosh, drop_dark_detached)
    if key in _cache: return _cache[key]
    rgb = np.array(Image.open(path(v, k)).convert('RGB')).astype(int)
    bg = VID[v][1]
    dist = np.abs(rgb - bg).sum(2)
    near = dist < T
    lab, n = ndi.label(near)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))); border.discard(0)
    bgmask = np.isin(lab, list(border))
    sizes = ndi.sum(near, lab, range(1, n + 1))
    for i, sz in enumerate(sizes, 1):
        if sz > pocket: bgmask |= (lab == i)
    fg = ~bgmask
    alpha = np.where(fg, 255, 0).astype(np.uint8)
    out_rgb = rgb.copy()
    mx, mn = rgb.max(2), rgb.min(2)
    if swoosh:
        # neutral light-gray motion streak: make it a soft translucent smoke instead of solid gray
        core = fg & ((mx < 150) | ((mx - mn) > 22))
        core = ndi.binary_dilation(core, iterations=7)
        sw = fg & ~core & ((mx - mn) < 14) & (mx >= 150)
        a = np.clip((bg - mx) / 90.0, 0, 1) * 0.85
        alpha = np.where(sw, (a * 255).astype(np.uint8), alpha)
        out_rgb[sw] = (95, 95, 100)
    # components: drop specks, and (optionally) detached dark things (arrow / bolt in flight)
    l2, n2 = ndi.label(alpha > 0)
    if n2:
        sz2 = ndi.sum(alpha > 0, l2, range(1, n2 + 1))
        main = 1 + int(np.argmax(sz2))
        near_main = ndi.binary_dilation(l2 == main, iterations=10)
        for i in range(1, n2 + 1):
            m = l2 == i
            if sz2[i - 1] < 6: alpha[m] = 0; continue
            if drop_dark_detached and i != main and not (near_main & m).any():
                sat = (mx[m] - mn[m]).mean()
                translucent = alpha[m].mean() < 200          # swoosh streaks stay
                if not translucent and sat < 60 and sz2[i - 1] < 9000: alpha[m] = 0   # arrow / bolt in flight
    res = np.dstack([out_rgb.astype(np.uint8), alpha])
    _cache[key] = res
    return res

def bbox(rgba, amin=128):
    ys, xs = np.where(rgba[..., 3] >= amin)
    return xs.min(), xs.max(), ys.min(), ys.max()

def shorts_x(rgba, lo=0.36, hi=0.62, vlo=40, vhi=175, sat=30):
    """x-centre of the neutral-gray shorts inside a row band (fractions of body height)."""
    x0, x1, y0, y1 = bbox(rgba)
    H = y1 - y0
    rgb = rgba[..., :3].astype(int)
    mx, mn = rgb.max(2), rgb.min(2)
    m = (rgba[..., 3] >= 200) & (mx >= vlo) & (mx <= vhi) & ((mx - mn) < sat)
    band = np.zeros_like(m); band[int(y0 + lo * H):int(y0 + hi * H), :] = True
    m &= band
    lab, n = ndi.label(ndi.binary_closing(m, iterations=2))
    if n == 0: return (x0 + x1) / 2.0
    sz = ndi.sum(m, lab, range(1, n + 1)); k = 1 + int(np.argmax(sz))
    xs = np.where((lab == k) & m)[1]
    return (xs.min() + xs.max()) / 2.0

def comp_white(a):
    al = a[..., 3:4] / 255.0
    return a[..., :3] * al + 255.0 * (1 - al)

def feet_x(rgba):
    """x-centre of the skin pixels in the bottom quarter of the body (planted feet / lower legs)."""
    x0, x1, y0, y1 = bbox(rgba); H = y1 - y0
    rgb = rgba[..., :3].astype(int); R, G, B = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    m = (rgba[..., 3] >= 200) & (R > G + 15) & (G > B + 5)
    m[:int(y0 + 0.75 * H)] = False
    xs = np.where(m)[1]
    return xs.mean() if len(xs) else (x0 + x1) / 2.0
