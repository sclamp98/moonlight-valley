#!/usr/bin/env python3
"""Hand-drawn 16x16 pixel icons for the weapons and ammo, plus the Armory building (a recolour of the shop).
usage: build_weapon_assets.py <game dir>"""
import sys, math
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
G = sys.argv[1]; OUT = f"{G}/assets/fp"
C = dict(k=(38,28,44), s=(226,234,244), S=(160,176,200), d=(96,112,140), w=(176,112,64), W=(112,68,38), g=(240,196,76), G=(176,128,40),
         r=(190,70,60), R=(120,38,44), y=(255,232,130), o=(240,140,60), c=(236,224,196), b=(62,68,82), B=(98,108,128), f=(250,250,250), n=(80,50,30), l=(150,200,90))
class Ic:
    def __init__(s): s.a = np.zeros((16,16,4), np.uint8)
    def px(s, x, y, c):
        x, y = int(round(x)), int(round(y))
        if 0 <= x < 16 and 0 <= y < 16: s.a[y, x] = (*C[c], 255)
    def line(s, x0, y0, x1, y1, c, w=1):
        n = int(max(abs(x1-x0), abs(y1-y0))*2)+1
        for i in range(n+1):
            t = i/n; x = x0+(x1-x0)*t; y = y0+(y1-y0)*t
            s.px(x, y, c)
            if w > 1:
                s.px(x+1, y, c) if abs(x1-x0) < abs(y1-y0) else s.px(x, y+1, c)
    def rect(s, x0, y0, x1, y1, c):
        for y in range(y0, y1+1):
            for x in range(x0, x1+1): s.px(x, y, c)
    def save(s, name):
        m = s.a[..., 3] > 0; edge = ndi.binary_dilation(m, structure=[[0,1,0],[1,1,1],[0,1,0]]) & ~m
        s.a[edge] = (*C['k'], 255)
        Image.fromarray(s.a).save(f"{OUT}/ic_{name}.png")
def blade(i, x0, y0, x1, y1):    # 2px blade: light edge + mid
    i.line(x0, y0, x1, y1, 'S', 2); i.line(x0+1, y0, x1+1, y1-0, 's') if False else None
    i.line(x0, y0-1, x1, y1-1, 's')

# dagger
i = Ic(); i.line(8,8,13,3,'S',2); i.line(8,7,13,2,'s'); i.line(5,9,8,6,'G',1); i.line(6,10,9,7,'g'); i.line(3,12,6,9,'W'); i.line(4,12,6,10,'w'); i.px(2,13,'g'); i.save("dagger")
# steel sword
i = Ic(); i.line(7,9,14,2,'S',2); i.line(7,8,14,1,'s'); i.line(4,8,8,12,'G',1); i.line(4,7,8,11,'g'); i.line(4,12,7,9,'R'); i.line(3,13,5,11,'r'); i.line(2,14,3,13,'W'); i.px(1,15,'g'); i.save("steel_sword")
# spear
i = Ic(); i.line(2,14,11,5,'W',1); i.line(2,13,11,4,'w'); i.line(10,6,14,2,'S',2); i.line(11,3,14,2,'s'); i.px(14,1,'s'); i.px(13,3,'s'); i.line(9,6,6,9,'R'); i.save("spear")
# war axe
i = Ic(); i.line(3,13,11,5,'W',1); i.line(3,12,11,4,'w')
for (x,y) in [(8,2),(9,2),(10,2),(11,2),(12,2),(8,3),(9,3),(10,3),(11,3),(12,3),(13,3),(9,4),(10,4),(12,4),(13,4),(14,4),(12,5),(13,5),(14,5),(13,6),(14,6),(12,7),(13,7)]: i.px(x,y,'S')
for (x,y) in [(9,2),(10,2),(11,2),(8,3),(9,3)]: i.px(x,y,'s')
i.px(7,1,'S'); i.px(14,7,'S'); i.px(1,14,'g'); i.save("war_axe")
# bow (vertical arc, string on the right so it points right)
i = Ic()
for t in range(0, 21):
    u = t/20; x = 4 + 6*math.sin(math.pi*u)*-1 + 6; y = 1 + 14*u
    i.px(x if False else 11 - 7*math.sin(math.pi*u), y, 'w')
for t in range(0, 21):
    u = t/20; i.px(10.5 - 7*math.sin(math.pi*u) - 1, 1+14*u, 'W') if False else None
i.line(11,1,11,14,'c'); i.rect(3,7,5,8,'W'); i.px(11,0,'W'); i.px(11,15,'W')
i.save("bow")
# crossbow (pointing right)
i = Ic(); i.rect(2,7,13,8,'w'); i.rect(2,8,13,8,'W'); i.line(3,9,5,12,'W'); i.line(4,9,6,12,'w'); i.line(10,2,10,13,'W'); i.line(11,2,11,13,'w'); i.line(10,2,7,7,'c'); i.line(10,13,7,8,'c'); i.rect(8,6,13,6,'S'); i.px(14,6,'s'); i.save("crossbow")
# pistol (pointing right)
i = Ic(); i.rect(3,5,14,7,'B'); i.rect(3,5,14,5,'S'); i.rect(4,8,6,9,'b'); i.rect(4,8,7,13,'W'); i.rect(5,9,6,13,'w'); i.line(8,8,9,10,'b'); i.px(14,5,'s'); i.px(3,6,'d'); i.save("pistol")
# shotgun (pointing right)
i = Ic(); i.rect(5,5,15,6,'B'); i.rect(5,5,15,5,'S'); i.rect(5,7,12,7,'d'); i.rect(8,6,11,8,'W'); i.rect(1,6,5,10,'w'); i.rect(1,9,5,10,'W'); i.line(5,6,2,9,'w'); i.rect(6,7,7,8,'b'); i.save("shotgun")
# ammo: arrow, bolt, bullet, shell
i = Ic(); i.line(3,13,12,4,'W'); i.line(12,4,14,2,'S',2); i.px(14,1,'s'); i.line(3,13,2,10,'f'); i.line(3,13,6,14,'f'); i.line(4,12,3,9,'r'); i.line(4,12,7,13,'r'); i.save("arrow")
i = Ic(); i.line(3,12,12,3,'n',2); i.line(12,3,14,1,'S',2); i.line(3,12,2,9,'B'); i.line(3,12,6,13,'B'); i.save("bolt")
i = Ic()
for dx in (0,4,8):
    i.rect(3+dx,6,5+dx,12,'g'); i.rect(3+dx,6,3+dx,12,'y'); i.rect(3+dx,3,5+dx,5,'o'); i.px(4+dx,2,'o'); i.rect(3+dx,13,5+dx,13,'G')
i.save("bullet")
i = Ic(); i.rect(3,4,7,13,'r'); i.rect(3,4,3,13,'o'); i.rect(3,11,7,13,'g'); i.rect(9,5,13,13,'r'); i.rect(9,5,9,13,'o'); i.rect(9,11,13,13,'g'); i.rect(4,3,6,3,'R'); i.rect(10,4,12,4,'R'); i.save("shell")

# Armory building: the General Store with swapped blue/red + crossed swords on the sign
for sfx in ("warm", "snow"):
    im = Image.open(f"{OUT}/bld_shop_{sfx}.png").convert("RGBA"); a = np.array(im)
    r, g, b = [a[..., k].astype(int) for k in range(3)]
    roof = (b > r + 40) & (b > g) & (a[..., 3] > 0); awn = (r > g + 70) & (r > b + 70) & (a[..., 3] > 0)
    for m in (roof, awn):
        a[m, 0], a[m, 2] = a[m, 2].copy(), a[m, 0].copy()
    yellow = (r > 200) & (g > 150) & (b < 150) & (a[..., 3] > 0)
    ys, xs = np.where(yellow)
    sel = (ys < 30) & (xs > 25) & (xs < 55)
    for y, x in zip(ys[sel], xs[sel]): a[y, x] = (176, 108, 80, 255)  # paint the coin out (sign colour)
    im = Image.fromarray(a.astype(np.uint8)).copy()
    cx, cy = 38, 16   # crossed swords on the sign
    px = im.load()
    def put(x, y, c): px[x, y] = (*C[c], 255)
    for t in range(-6, 7):
        put(cx + t, cy + t, 'S'); put(cx + t, cy - t, 'S')
        if t > -5 and t < 5: put(cx + t, cy + t - 1, 's'); put(cx + t, cy - t - 1, 's')
    for (x, y) in [(cx-6, cy+6), (cx+6, cy+6), (cx-7, cy+7), (cx+7, cy+7)]: put(x, y, 'g')
    put(cx, cy, 'g'); put(cx, cy-1, 'G')
    im.save(f"{OUT}/bld_armory_{sfx}.png")
print("ok")
