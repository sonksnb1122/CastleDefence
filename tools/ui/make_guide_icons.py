"""Makes the small pictures of the Guide / Tutorials prefabs (assets/resources/sprites/ui):
  red_dot.png      24 px red dot with a light rim (things to do)
  check_tick.png   22 px green tick (goal reached)
Usage: python make_guide_icons.py <sprites/ui folder>"""
import os, sys
import numpy as np
from PIL import Image

out = sys.argv[1]
S = 24
yy, xx = np.mgrid[0:S, 0:S] + 0.5
d = np.hypot(xx - S / 2, yy - S / 2)
img = np.zeros((S, S, 4), np.uint8)
rim = d <= S / 2 - 0.5
core = d <= S / 2 - 3
img[rim] = (255, 236, 236, 255)
img[core] = (229, 48, 48, 255)
img[(d <= S / 2 - 6) & (yy < S / 2 - 1) & (xx < S / 2)] = (255, 110, 110, 255)   # small highlight
Image.fromarray(img, 'RGBA').save(os.path.join(out, 'red_dot.png'), optimize=True)

T = 22
im = Image.new('RGBA', (T, T), (0, 0, 0, 0)); px = im.load()
def dot(x, y, c):
    for dx in (0, 1, 2):
        for dy in (0, 1, 2):
            if 0 <= x + dx < T and 0 <= y + dy < T: px[x + dx, y + dy] = c
pts = [(3, 11), (4, 12), (5, 13), (6, 14), (7, 15), (8, 14), (9, 13), (10, 12), (11, 11), (12, 10), (13, 9), (14, 8), (15, 7), (16, 6), (17, 5)]
for x, y in pts: dot(x - 1, y - 1, (20, 40, 20, 255))      # dark outline
for x, y in pts: dot(x, y, (123, 214, 106, 255))
im.save(os.path.join(out, 'check_tick.png'), optimize=True)
