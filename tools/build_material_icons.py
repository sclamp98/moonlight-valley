#!/usr/bin/env python3
"""Draws the 16x16 inventory icons for the materials you get from breaking scenery.

    python3 tools/build_material_icons.py

Writes assets/fp/ic_{stone,flower,mushroom,plank,fiber}.png in the same dark-outline pixel style
as the other ic_*.png icons. Each icon is an ASCII map: one character = one pixel, '.' = clear.
"""
import os
from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "fp")

# palette: the outline colour is the one every existing ic_*.png uses
K = "#1d2727"
PAL = {
    "k": K,
    # stone
    "a": "#d3dae6", "b": "#a6b0c4", "c": "#76809a", "d": "#4f5870",
    # flower
    "p": "#f7a3c2", "q": "#e8709f", "y": "#fbe27a", "g": "#5fae52", "h": "#3a7d3e",
    # mushroom
    "r": "#d6483f", "s": "#9e2c33", "w": "#fff4e0", "t": "#efd9b0", "u": "#c9a97a",
    # plank / wood
    "L": "#efb381", "M": "#bf6a4d", "N": "#a66646", "O": "#764632", "n": "#cfd6df",
    # fiber / straw
    "f": "#f2d36b", "e": "#d9a93f", "i": "#a8782a", "j": "#8ab84a",
}

ICONS = {
    "stone": [
        "................",
        "................",
        "................",
        "......kkkk......",
        "....kkaabbkk....",
        "...kaabbbbcck...",
        "...kabbbbcccck..",
        "..kkkbbbccccdk..",
        ".kaabkbbcccdkk..",
        ".kabbbkkccdk.kk.",
        ".kbbbccckkkkkbbk",
        ".kbbccccddkabbck",
        "..kcccddddkbbcck",
        "...kkddddkkcccdk",
        ".....kkkkk.kkkk.",
        "................",
    ],
    "flower": [
        "................",
        "......kkk.......",
        ".....kppqk......",
        "....kppyyqk.....",
        "...kppyyyqqk....",
        "...kqpyyyqk.....",
        "....kqqpqkk.....",
        ".....kkkk.......",
        ".......kg.......",
        "......kgk.kk....",
        ".....kgkkgghk...",
        ".....kkgkgghk...",
        ".......kgkkk....",
        ".......kgk......",
        ".......kkk......",
        "................",
    ],
    "mushroom": [
        "................",
        "................",
        "......kkkkk.....",
        "....kkrrrrrkk...",
        "...krrwwrrrrsk..",
        "..krrwwwrrwwrsk.",
        "..krrrwrrrwwrrsk",
        "..krrrrrrrrrrssk",
        "..kssrrrrrrsssk.",
        "...kkkssssskkk..",
        "......kttuk.....",
        "......kttuk.....",
        "......kttuk.....",
        ".....kkttukk....",
        "......kkkkk.....",
        "................",
    ],
    "plank": [
        "................",
        "................",
        "..kkkkkkkkkkkk..",
        ".kLLLLLLLLLLLLMk",
        ".kLnLLLLLLLLnLMk",
        ".kMMMMMMMMMMMMOk",
        ".kkkkkkkkkkkkkkk",
        ".kLLLLLLLLLLLLMk",
        ".kLnLLLLLLLLnLMk",
        ".kMMMMMMMMMMMMOk",
        ".kkkkkkkkkkkkkkk",
        "..kLLLLLLLLLLMk.",
        "..kMMMMMMMMMMOk.",
        "...kkkkkkkkkkk..",
        "................",
        "................",
    ],
    "fiber": [
        "................",
        "....k.....k.....",
        "...kfk...kfk.k..",
        "...kfek.kfek.fk.",
        "..kfekkkkkekkfk.",
        "..kfeefekfeekfk.",
        "...kfeefeeefek..",
        "...kfefeefeek...",
        "....kkkkkkkkk...",
        "....kiiiiiiik...",
        "....kkkkkkkkk...",
        "...kfeefeefek...",
        "..kfefefeefefk..",
        "..kfek.kfek.kk..",
        "...kk...kk......",
        "................",
    ],
}


def render(rows):
    assert len(rows) == 16, len(rows)
    im = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    for y, row in enumerate(rows):
        assert len(row) == 16, (y, row, len(row))
        for x, ch in enumerate(row):
            if ch == ".":
                continue
            h = PAL[ch].lstrip("#")
            im.putpixel((x, y), tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) + (255,))
    return im


if __name__ == "__main__":
    for name, rows in ICONS.items():
        render(rows).save(os.path.join(OUT, f"ic_{name}.png"))
        print("wrote", f"ic_{name}.png")
