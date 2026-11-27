"""
Makes the Halo Spire shield sheets of art/halo from two "Shield Round Magic" sheets (512 x 512 cells, 4 per row):
  shield_loop.png      the shield while it stands (loop)
  shield_collapse.png  it breaks
Every frame is cut to the middle 448 x 448 px (the bubble is 366 px wide) and shrunk to CELL px (premultiplied
alpha, so the thin lines keep their color). Only the right KEEP share of the bubble is kept (the side the enemy
projectiles come from; the rest would cover the towers): the cells are CELL px high and narrower. 2 rows per sheet (so both sheets sit side by side in one 512 px
high atlas row). Empty cells at the end of a sheet are skipped. The halo atlas is packed with linear filtering:
the shield is drawn bigger than its cells and must stay smooth, not blocky.
Prints the frame counts and the bubble radius in the new cells (tower.json "shield": "frames", "ringRadius").
Usage: python prepare_shield.py <loop.png> <collapse.png> <art/halo>
"""
import os, sys
import numpy as np
from PIL import Image

CELL, CUT, SRC = 256, 448, 512
KEEP = 0.4          # right 2/5 of the bubble width
FADE = 18           # px over which the cut edge fades in
loop, collapse, out = sys.argv[1:4]
for path, name in ((loop, 'shield_loop'), (collapse, 'shield_collapse')):
    im = Image.open(path).convert('RGBA')
    cols, rows = im.width // SRC, im.height // SRC
    cells = []
    for i in range(cols * rows):
        x, y = (i % cols) * SRC, (i // cols) * SRC
        c = im.crop((x, y, x + SRC, y + SRC))
        if np.array(c)[..., 3].max() > 8: cells.append(c)
    m = (SRC - CUT) // 2
    per_row = (len(cells) + 1) // 2
    R = 183 * CELL / CUT
    x0 = int(CELL / 2 + (1 - 2 * KEEP) * R)       # first kept column of a cell
    W = CELL - x0
    sheet = Image.new('RGBA', (W * per_row, CELL * 2), (0, 0, 0, 0))
    for i, c in enumerate(cells):
        f = c.crop((m, m, m + CUT, m + CUT)).convert('RGBa').resize((CELL, CELL), Image.LANCZOS).convert('RGBA')
        part = np.array(f.crop((x0, 0, CELL, CELL))).astype(np.float64)
        part[:, :FADE, 3] *= np.linspace(0, 1, FADE)[None, :]       # soft cut edge
        sheet.paste(Image.fromarray(part.round().astype(np.uint8), 'RGBA'), ((i % per_row) * W, (i // per_row) * CELL))
    sheet.save(os.path.join(out, name + '.png'), optimize=True)
    print(name, 'frames', len(cells))
print('ringRadius', round(183 * CELL / CUT, 1), 'cellW', W, 'cellH', CELL, 'centerX', CELL // 2 - x0, '(bubble center, from the left of a cell)')
