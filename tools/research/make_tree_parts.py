"""
Draws the pictures of the research tree window (art/research/, packed into sprites/atlas/research with the icons,
so the whole tree is drawn from one texture):
  tree_node_bg.png     node square, grayscale: 11 bands from 22% at the top to 100% at the bottom, with the darker
                       level strip baked in. The game tints it with the node color (the bands then go from 22% of
                       the color to the full color, like before).
  tree_node_frame.png  the node frame: a white 3 px square border (1 px clear margin), tinted by the game.
  tree_white.png       white 6 x 6: links between nodes (the game uses its middle 2 x 2 cell, so no edge blur).
  tree_dash.png        dashed line, 288 x 4 (dashes of 11 px every 18 px on rows 1-2): the tier separators.
Usage: python make_tree_parts.py <art/research>
"""
import os, sys
import numpy as np
from PIL import Image

out = sys.argv[1]
N = 52
img = np.zeros((N, N, 4), np.float64)
bh = N / 11
for y in range(N):
    band = min(10, int(y / bh))
    v = 0.22 + 0.78 * band / 10
    img[y, :, :3] = v
img[:, :, 3] = 1
img[37:51, 2:50, :3] *= 1 - 150 / 255          # level strip (black, alpha 150)
Image.fromarray((img * 255).round().astype(np.uint8), 'RGBA').save(os.path.join(out, 'tree_node_bg.png'), optimize=True)

F = 58
fr = np.zeros((F, F, 4), np.uint8)
fr[1:F - 1, 1:F - 1] = (255, 255, 255, 255)
fr[4:F - 4, 4:F - 4] = 0
Image.fromarray(fr, 'RGBA').save(os.path.join(out, 'tree_node_frame.png'), optimize=True)

Image.new('RGBA', (6, 6), (255, 255, 255, 255)).save(os.path.join(out, 'tree_white.png'), optimize=True)

d = np.zeros((4, 288, 4), np.uint8)
for x in range(288):
    if x % 18 < 11: d[1:3, x] = (255, 255, 255, 255)
Image.fromarray(d, 'RGBA').save(os.path.join(out, 'tree_dash.png'), optimize=True)
