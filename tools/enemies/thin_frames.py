"""
Keeps only some frames of a sprite sheet (frames in one row, cellW x cellH each), in place.
Used to shorten the death animations (many frames were almost the same) and to cut the Flying Demon's
"fall" part off its death sheet.
Usage: python thin_frames.py <sheet.png> <cellW> <cellH> <frame,frame,...>     (0-based, in the new order)
       python thin_frames.py <sheet.png> <cellW> <cellH> every2                  (every 2nd frame + the last one)
Prints the new frame count (enemy.json "frames").
"""
import sys
from PIL import Image

path, cw, ch, which = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
im = Image.open(path).convert('RGBA')
n = im.width // cw
if which == 'every2':
    keep = list(range(0, n, 2))
    if keep[-1] != n - 1: keep.append(n - 1)
else:
    keep = [int(x) for x in which.split(',')]
out = Image.new('RGBA', (cw * len(keep), ch), (0, 0, 0, 0))
for i, k in enumerate(keep):
    out.paste(im.crop((k * cw, 0, k * cw + cw, ch)), (i * cw, 0))
out.save(path, optimize=True)
print(len(keep))
