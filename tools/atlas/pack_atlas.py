"""
Pack sprite sheets into atlas textures so they load as one file and draw in a few batches.

  combat:   the combat sheets (enemies, towers, projectiles, impacts, status icons). Sources live in
            art/combat/<enemies|towers|status> at the project root and keep the key "sprites/<folder>/<name>".
  halo:     the Halo Spire rings (art/halo, big mostly empty cells): their own atlas keeps the combat atlas
            at 4096 x 1024. Keys "sprites/towers/<name>".
  boss:     the boss sheets (body animations, spell effects, shield). Sources live in art/boss/<boss>/
            at the project root and keep the key "sprites/bosses/<name>". Full color (the shield has soft alpha).
  research: the research tree icons. Their sources live OUTSIDE assets/resources (art/research at the
            project root, 96 x 96 PNG named after the icon) so the build only ships the atlas. The atlas
            is reduced to 256 colors and drawn with smooth filtering.

Usage (from the project root):
    python tools/atlas/pack_atlas.py assets/resources [combat|halo|boss|research|all]   (default: all)

Writes assets/resources/sprites/atlas/<name>.png and <name>.json:
    { "image": "sprites/atlas/<name>", "regions": { "sprites/enemies/x_move": [x, y, w, h], ... } }
The game still uses the original paths in the configs ("sprites/research/off_damage" for the icons);
Assets.ts looks them up in the manifests. Run it again after changing any of those pictures.
"""
import json, os, sys
from PIL import Image

FOLDERS = ['enemies', 'towers', 'status']   # under <project>/art/combat
PAD = 2              # empty pixels between sheets (no bleeding with pixel art filtering)
MAX_W = 4096
WHITE = 8            # solid white block used for health bars

def combat(res):
    items = []
    for folder in FOLDERS:
        d = os.path.join(res, '..', '..', 'art', 'combat', folder)
        for f in sorted(os.listdir(d)):
            if f.endswith('.png'):
                items.append(('sprites/' + folder + '/' + f[:-4], Image.open(os.path.join(d, f)).convert('RGBA')))
    items.append(('white', Image.new('RGBA', (WHITE, WHITE), (255, 255, 255, 255))))
    pack(res, 'combat', items)

def halo(res):
    d = os.path.join(res, '..', '..', 'art', 'halo')
    items = [('sprites/towers/' + f[:-4], Image.open(os.path.join(d, f)).convert('RGBA'))
             for f in sorted(os.listdir(d)) if f.endswith('.png')]
    # Smooth art (shield, rings), drawn bigger than its pixels: linear filtering, full color.
    pack(res, 'halo', items, linear=True)

def boss(res):
    # Sources: <project>/art/boss/<boss>/*.png, served under the path "sprites/bosses/<name>".
    root = os.path.join(res, '..', '..', 'art', 'boss')
    items = []
    for b in sorted(os.listdir(root)):
        d = os.path.join(root, b)
        if not os.path.isdir(d): continue
        for f in sorted(os.listdir(d)):
            if f.endswith('.png'):
                items.append(('sprites/bosses/' + f[:-4], Image.open(os.path.join(d, f)).convert('RGBA')))
    pack(res, 'boss', items)

def research(res):
    # Sources: <project>/art/research/*.png, served under the path "sprites/research/<name>".
    src = os.path.join(res, '..', '..', 'art', 'research')
    items = [('sprites/research/' + f[:-4], Image.open(os.path.join(src, f)).convert('RGBA'))
             for f in sorted(os.listdir(src)) if f.endswith('.png')]
    pack(res, 'research', items, linear=True, colors=256, max_w=2048)

def pack(res, atlas_name, items, linear=False, colors=None, max_w=MAX_W):
    # Shelf packing, tallest first.
    items.sort(key=lambda it: (-it[1].height, -it[1].width))
    x = y = shelf_h = 0
    placed = {}
    width_used = 0
    for name, img in items:
        w, h = img.size
        if x + w > max_w:
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
    if colors:
        # One shared palette (keeps the alpha of the glows); about 6x smaller than full color.
        atlas = atlas.quantize(colors, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    atlas.save(os.path.join(out, atlas_name + '.png'), optimize=True)
    manifest = {'image': 'sprites/atlas/' + atlas_name, 'regions': {k: list(v) for k, v in sorted(placed.items())}}
    if linear:
        manifest['linear'] = True
    with open(os.path.join(out, atlas_name + '.json'), 'w') as fp:
        json.dump(manifest, fp, indent=1)
    print('%s atlas %dx%d, %d sheets' % (atlas_name, W, H, len(items)))

if __name__ == '__main__':
    res = sys.argv[1] if len(sys.argv) > 1 else 'assets/resources'
    which = sys.argv[2] if len(sys.argv) > 2 else 'all'
    if which in ('combat', 'all'): combat(res)
    if which in ('halo', 'all'): halo(res)
    if which in ('boss', 'all'): boss(res)
    if which in ('research', 'all'): research(res)
