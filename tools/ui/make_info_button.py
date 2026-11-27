"""Makes sprites/ui/btn_info.png from btn_pause.png: the two pause bars are painted over with the button
color and a pixel "i" in the same cream / dark outline is drawn instead (castle Guide button)."""
import sys
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGBA'); px = im.load()
W, H = im.size
def purple(c):
    r, g, b, a = c
    return b > 150 and g < 70 and b > r * 0.8
for y in range(18, 78):
    for x in range(20, 76):
        if not purple(px[x, y]):
            px[x, y] = px[48, y]          # the gap between the bars has the button gradient
# "i": a dot and a stem, cream with a dark outline (colors of the pause bars)
OUT = (55, 32, 29, 255)
def cream(y): t = (y - 24) / 46; return (253, int(250 - 17 * t), int(224 - 56 * t), 255)
def block(x0, y0, x1, y1):
    for y in range(y0, y1):
        for x in range(x0, x1):
            edge = x in (x0, x0 + 1, x1 - 1, x1 - 2) or y in (y0, y0 + 1, y1 - 1, y1 - 2)
            px[x, y] = OUT if edge else cream(y)
block(41, 24, 55, 37)
block(41, 41, 55, 72)
im.save(dst, optimize=True)
