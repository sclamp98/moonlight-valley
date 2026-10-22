#!/usr/bin/env python3
"""Draws the cinema-cellar furniture (pixel art, same 1x scale and warm palette as assets/home/int_*).
usage: build_cinema_assets.py <game dir>      -> assets/cinema/*.png + cinema/art.js (sizes + TV screen rect)
Sprites are drawn at 1x; the game scales them x3 like the rest of the home kit."""
import sys, os, json
from PIL import Image, ImageDraw

GAME = sys.argv[1] if len(sys.argv) > 1 else "."
OUT = f"{GAME}/assets/cinema"
os.makedirs(OUT, exist_ok=True)

H = lambda s: tuple(int(s[i:i + 2], 16) for i in (1, 3, 5)) + (255,)
OUTLINE = H("#2b1d24")
# wood (matches the home kit), plum velvet, brass, screen
W1, W2, W3, W4 = H("#ab7757"), H("#94614a"), H("#82503f"), H("#5d3731")
P1, P2, P3, P4, P5 = H("#b4647f"), H("#9a4c68"), H("#7c3a55"), H("#5c2a40"), H("#432032")
BR1, BR2 = H("#f0c872"), H("#c8923c")
CR1, CR2, CR3 = H("#b3414a"), H("#8e2f3c"), H("#6a2230")

art = {}


def canvas(w, h):
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    return im, ImageDraw.Draw(im)


def outline(im, color=OUTLINE):
    """1px dark outline around the opaque pixels (what the kit's sprites have)."""
    w, h = im.size
    src = im.load()
    out = im.copy()
    o = out.load()
    for y in range(h):
        for x in range(w):
            if src[x, y][3] == 0:
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < h and src[nx, ny][3] > 0:
                        o[x, y] = color
                        break
    return out


def pad(im, n=1):
    out = Image.new("RGBA", (im.width + 2 * n, im.height + 2 * n), (0, 0, 0, 0))
    out.paste(im, (n, n))
    return out


def save(name, im, **meta):
    im.save(f"{OUT}/{name}.png")
    art[name] = dict(w=im.width, h=im.height, **meta)


def rect(d, x0, y0, x1, y1, c):
    d.rectangle([x0, y0, x1, y1], fill=c)


# ---------------------------------------------------------------- TV + cabinet (96 x 58)
def tv_stand():
    im, d = canvas(94, 56)
    # cabinet
    rect(d, 2, 47, 91, 53, W2); rect(d, 2, 47, 91, 48, W1); rect(d, 2, 52, 91, 53, W3)
    for x in (16, 46, 76): rect(d, x, 49, x + 12, 51, W4)          # drawer slits
    for x in (30, 60): rect(d, x, 49, x, 51, W3)
    rect(d, 4, 54, 9, 55, W4); rect(d, 84, 54, 89, 55, W4)            # feet
    # TV body
    rect(d, 2, 0, 91, 46, H("#3a3042"))
    rect(d, 2, 0, 91, 1, H("#554a60"))                                # top highlight
    rect(d, 2, 45, 91, 46, H("#251e2c"))
    rect(d, 4, 2, 89, 44, H("#1e1826"))                               # bezel
    rect(d, 6, 4, 87, 42, H("#0d0b14"))                               # screen (80 x 39 usable; game draws on it)
    for y in range(4, 43, 3): rect(d, 6, y, 87, y, H("#12101c"))      # faint scanlines
    rect(d, 6, 4, 9, 4, H("#2a2640")); rect(d, 6, 5, 6, 8, H("#2a2640"))  # glass glint
    d.point((46, 44), fill=BR1)                                       # power light
    # brass nameplate
    rect(d, 41, 45, 52, 45, BR2)
    return outline(pad(im, 1))


# the TV screen rect inside the (padded) sprite, art px
SCREEN = dict(x=7, y=5, w=82, h=39)


# ---------------------------------------------------------------- sofa (68 x ~40), split in seat (behind people) + back (in front of them)
def sofa_master():
    im, d = canvas(68, 40)
    # arms (outer faces, full height)
    for x0 in (0, 59):
        rect(d, x0, 2, x0 + 8, 37, P3)
        rect(d, x0 + 1, 2, x0 + 7, 4, P1)                              # rolled top
        rect(d, x0 + 1, 5, x0 + 7, 5, P2)
        rect(d, x0, 34, x0 + 8, 37, P4)
        rect(d, x0 + 2, 38, x0 + 3, 39, W4); rect(d, x0 + 5, 38, x0 + 6, 39, W4)
    # seat cushions (seen from behind/above, beyond the back-rest)
    rect(d, 9, 5, 58, 15, P2)
    rect(d, 9, 5, 58, 6, P1)
    rect(d, 33, 5, 34, 15, P4)                                          # seam between the two seats
    rect(d, 9, 14, 58, 15, P3)
    # back-rest (rear face, drawn over the people)
    rect(d, 9, 13, 58, 35, P3)
    rect(d, 9, 12, 58, 14, P1)                                          # top edge highlight
    rect(d, 9, 15, 58, 16, P2)
    rect(d, 9, 33, 58, 35, P4)
    rect(d, 33, 15, 34, 33, P4)                                         # split between the two back cushions
    for x in (21, 45):                                                  # tufting buttons
        for y in (21, 27):
            d.point((x, y), fill=BR1); d.point((x + 1, y + 1), fill=BR2)
            d.point((x - 3, y + 2), fill=P4); d.point((x + 4, y + 2), fill=P4)
    rect(d, 9, 36, 58, 37, P5)                                          # skirt
    for x in (12, 53): rect(d, x, 38, x + 1, 39, W4)
    return outline(pad(im, 1))


def sofa():
    m = sofa_master()
    # rows are padded by 1: seat part = rows 0..16, back part = rows 14..end  (overlap hides the seam)
    seat = m.crop((0, 0, m.width, 20))
    back = m.crop((0, 14, m.width, m.height))
    save("sofa_seat", seat)
    save("sofa_back", back, dy=14)
    art["sofa"] = dict(w=m.width, h=m.height, seats=[18, 52], seatFootY=28, backTop=13)


# ---------------------------------------------------------------- curtains (14 x 44)
def curtain(flip):
    im, d = canvas(14, 44)
    rect(d, 0, 0, 13, 3, BR2); rect(d, 0, 0, 13, 0, BR1)                # rod
    for x in range(0, 14):
        c = (CR1, CR2, CR3, CR2)[x % 4]
        rect(d, x, 4, x, 42 - (x % 3 == 0), c)
    rect(d, 0, 22, 13, 24, BR2); rect(d, 0, 22, 13, 22, BR1)            # tie-back
    rect(d, 5, 24, 8, 27, BR2)
    im = outline(pad(im, 1))
    return im.transpose(Image.FLIP_LEFT_RIGHT) if flip else im


# ---------------------------------------------------------------- lamp table (20 x 34) and snack table (24 x 24)
def lamp_table():
    im, d = canvas(18, 33)
    # lamp
    rect(d, 4, 0, 13, 8, H("#f6d98a")); rect(d, 5, 1, 12, 7, H("#ffeaa6")); rect(d, 3, 8, 14, 9, BR2)
    rect(d, 8, 10, 9, 15, BR2)
    rect(d, 6, 16, 11, 16, BR2)
    # table
    rect(d, 1, 17, 16, 20, W1); rect(d, 1, 20, 16, 21, W3)
    rect(d, 2, 22, 3, 31, W2); rect(d, 14, 22, 15, 31, W2)
    rect(d, 2, 26, 15, 26, W3)
    return outline(pad(im, 1))


def snack_table():
    im, d = canvas(24, 24)
    # popcorn bucket (red/white stripes) with fluffy top
    for x in range(5, 14):
        c = CR1 if (x // 2) % 2 == 0 else H("#f3ead2")
        rect(d, x, 7, x, 14, c)
    rect(d, 4, 6, 14, 6, H("#f3ead2"))
    for (x, y) in [(5, 3), (8, 2), (11, 3), (6, 5), (9, 4), (12, 5), (7, 3), (10, 5)]:
        rect(d, x, y, x + 1, y + 1, H("#fff3c4")); d.point((x, y + 1), fill=H("#f1d78a"))
    # soda cup
    rect(d, 17, 8, 20, 14, H("#6fa7d8")); rect(d, 17, 8, 20, 8, H("#f3ead2")); d.point((19, 5), fill=H("#f3ead2")); rect(d, 19, 6, 19, 8, H("#f3ead2"))
    # little table
    rect(d, 1, 15, 22, 17, W1); rect(d, 1, 17, 22, 18, W3)
    rect(d, 3, 19, 4, 22, W2); rect(d, 19, 19, 20, 22, W2)
    return outline(pad(im, 1))


# ---------------------------------------------------------------- posters (16 x 22)
def poster(kind):
    im, d = canvas(14, 20)
    rect(d, 0, 0, 13, 19, H("#e9d9b5"))
    rect(d, 1, 1, 12, 18, H("#22284d"))
    if kind == "moon":
        d.ellipse([4, 3, 9, 8], fill=H("#f6e9a8"))
        d.ellipse([6, 3, 10, 7], fill=H("#22284d"))
        for p in [(2, 2), (11, 4), (3, 9), (10, 10)]: d.point(p, fill=H("#ffffff"))
        d.polygon([(1, 18), (5, 11), (8, 14), (11, 10), (12, 18)], fill=H("#2d6a4f"))
        rect(d, 1, 16, 12, 18, H("#1b4332"))
    else:
        d.polygon([(7, 14), (3, 9), (4, 6), (7, 8), (10, 6), (11, 9)], fill=CR1)
        d.polygon([(7, 13), (4, 9), (5, 7), (7, 9), (9, 7), (10, 9)], fill=CR2)
        for p in [(2, 3), (11, 3), (3, 16), (10, 16)]: d.point(p, fill=BR1)
        rect(d, 3, 17, 10, 17, BR2)
    return outline(pad(im, 1))


# ---------------------------------------------------------------- night rug (100 x 60) with a star border
def rug():
    im, d = canvas(98, 58)
    d.rounded_rectangle([0, 0, 97, 57], radius=6, fill=H("#2f2c5c"))
    d.rounded_rectangle([3, 3, 94, 54], radius=4, outline=BR2, width=1)
    d.rounded_rectangle([6, 6, 91, 51], radius=3, fill=H("#3b3672"))
    d.rounded_rectangle([9, 9, 88, 48], radius=2, fill=H("#2a2655"))
    for x in range(14, 86, 9):
        for y in (13, 41):
            d.point((x, y), fill=BR1); d.point((x - 1, y), fill=BR2); d.point((x + 1, y), fill=BR2); d.point((x, y - 1), fill=BR2); d.point((x, y + 1), fill=BR2)
    # fringe
    for x in range(2, 96, 3):
        d.point((x, 0), fill=H("#8a8fb8")); d.point((x, 57), fill=H("#8a8fb8"))
    return im


for n, f in (("tv_stand", tv_stand),):
    save(n, f(), screen=SCREEN)
sofa()
save("curtain_l", curtain(False)); save("curtain_r", curtain(True))
save("lamp_table", lamp_table()); save("snack_table", snack_table())
save("poster_moon", poster("moon")); save("poster_heart", poster("heart"))
save("rug_night", rug())

os.makedirs(f"{GAME}/cinema", exist_ok=True)
with open(f"{GAME}/cinema/art.js", "w") as f:
    f.write("/* generated by tools/build_cinema_assets.py */\nconst CINEMA_ART = " + json.dumps(art) + ";\n")
print("wrote", len(art), "sprites")
