"""
Pack the combat sprite sheets (enemies, towers, projectiles, impacts) into one
texture so the battle can be drawn in a few draw calls instead of one per sheet.

Usage (from the project root):
    python tools/atlas/pack_atlas.py assets/resources

Writes assets/resources/sprites/atlas/combat.png and combat.json:
    { "image": "sprites/atlas/combat", "regions": { "sprites/enemies/x_move": [x, y, w, h], ... } }
The game still uses the original paths in the configs; Assets.ts looks them up
in the manifest. Run it again after changing any of those sheets.
"""
import json, os, sys
from PIL import Image

FOLDERS = ['sprites/enemies', 'sprites/towers']
PAD = 2              # empty pixels between sheets (no bleeding with pixel art filtering)
MAX_W = 4096
WHITE = 8            # solid white block used for health bars

def main(res):
    items = []
    for folder in FOLDERS:
        d = os.path.join(res, folder)
        for f in sorted(os.listdir(d)):
            if f.endswith('.png'):
                items.append((folder + '/' + f[:-4], Image.open(os.path.join(d, f)).convert('RGBA')))
    items.append(('white', Image.new('RGBA', (WHITE, WHITE), (255, 255, 255, 255))))
    # Shelf packing, tallest first.
    items.sort(key=lambda it: (-it[1].height, -it[1].width))
    x = y = shelf_h = 0
    placed = {}
    width_used = 0
    for name, img in items:
        w, h = img.size
        if x + w > MAX_W:
            x = 0; y += shelf_h + PAD; shelf_h = 0
        placed[name] = (x, y, w, h)
        x += w + PAD; shelf_h = max(shelf_h, h); width_used = max(width_used, x)
    height = y + shelf_h
    W = 1
    while W < width_used: W *= 2
    H = 1
    while H < height: H *= 2
    atlas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    for name, img in items:
        px, py, _, _ = placed[name]
        atlas.paste(img, (px, py))
    out = os.path.join(res, 'sprites/atlas')
    os.makedirs(out, exist_ok=True)
    atlas.save(os.path.join(out, 'combat.png'), optimize=True)
    with open(os.path.join(out, 'combat.json'), 'w') as fp:
        json.dump({'image': 'sprites/atlas/combat', 'regions': {k: list(v) for k, v in sorted(placed.items())}}, fp, indent=1)
    print('atlas %dx%d, %d sheets' % (W, H, len(items)))

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'assets/resources')
