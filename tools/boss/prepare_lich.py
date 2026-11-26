"""
Prepares the Lich boss sheets (AW - Lich King by artistworld, Frost palette) for the game:
mirrors every frame (the pack faces right, enemies walk to the left), crops each animation to the
union of its frames (cells only as big as needed), and prints the anchor of each animation so the
ground pivot (96, 164 in the pack cells) stays at the same place in every animation.

Usage: python prepare_lich.py <newboss folder> <shield loop png> <shield collapse png> <out folder>
Writes art/boss/lich/*.png into <out folder> and prints the JSON for enemy.json.
"""
import json, os, sys
from PIL import Image

src, shield_loop, shield_collapse, out = sys.argv[1:5]
os.makedirs(out, exist_ok=True)
S = os.path.join(src, 'Frost', 'Strips')
FX = os.path.join(src, 'FX', 'Frost', 'Strips')
BODY = {  # game name: (file, cell w, frames, frame time)
    'move': ('Lich_Frost_Float_192x168_6f.png', 192, 6, 0.11),
    'attack': ('Lich_Frost_Cast_272x168_14f.png', 272, 14, 0.11),
    'summon': ('Lich_Frost_Summon_208x168_13f.png', 208, 13, 0.1),
    'taunt': ('Lich_Frost_Taunt_208x168_13f.png', 208, 13, 0.11),
    'teleportOut': ('Lich_Frost_TeleportOut_192x168_9f.png', 192, 9, 0.08),
    'teleportIn': ('Lich_Frost_TeleportIn_192x168_9f.png', 192, 9, 0.08),
    'dead': ('Lich_Frost_Death_256x168_23f.png', 256, 23, 0.1),
}
PIVOT = (96, 164)
BODY_UP = 55      # the enemy node sits this many px above the ground pivot (body centre: hits, HP bar)
H = 168

def cells(im, w, n, h=None):
    h = h or im.height
    cols = im.width // w
    return [im.crop(((i % cols) * w, (i // cols) * h, (i % cols) * w + w, (i // cols) * h + h)) for i in range(n)]

def save_strip(frames, name):
    w, h = frames[0].size
    o = Image.new('RGBA', (w * len(frames), h), (0, 0, 0, 0))
    for i, f in enumerate(frames): o.paste(f, (i * w, 0))
    o.save(os.path.join(out, name + '.png'), optimize=True)
    return o.size

anims = {}
for key, (fn, cw, n, ft) in BODY.items():
    im = Image.open(os.path.join(S, fn)).convert('RGBA')
    fr = [f.transpose(Image.FLIP_LEFT_RIGHT) for f in cells(im, cw, n)]
    px = cw - PIVOT[0]                     # pivot x after the mirror
    box = None
    for f in fr:
        b = f.getbbox()
        if b: box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
    x0, y0, x1, y1 = box[0], box[1], box[2], max(box[3], PIVOT[1] + 1)
    fr = [f.crop((x0, y0, x1, y1)) for f in fr]
    w, h = x1 - x0, y1 - y0
    pivot_from_bottom = h - (PIVOT[1] - y0)
    anchor = [round((px - x0) / w, 4), round((pivot_from_bottom + BODY_UP) / h, 4)]
    size = save_strip(fr, 'lich_' + key)
    anims[key] = {'path': 'sprites/bosses/lich_' + key, 'cellW': w, 'cellH': h, 'frames': n, 'frameTime': ft, 'anchor': anchor}
    print(key, size, 'cell', w, h, 'anchor', anchor, file=sys.stderr)

# Effects: the Soul Bolt flies to the left (mirrored); impact and summon circle as they are.
def fx(fn, w, h, n, name, flip=False):
    im = Image.open(os.path.join(FX, fn)).convert('RGBA')
    fr = cells(im, w, n, h)
    if flip: fr = [f.transpose(Image.FLIP_LEFT_RIGHT) for f in fr]
    save_strip(fr, name)
fx('Lich_Frost_SoulBolt_51x33_6f.png', 51, 33, 6, 'lich_soulbolt', True)
fx('Lich_Frost_SoulBolt_Impact_58x58_5f.png', 58, 58, 5, 'lich_impact')
fx('Lich_Frost_SummonCircle_128x80_12f.png', 128, 80, 12, 'lich_summoncircle')

# Shield (Shield Elliptic Magic, 384x512 cells): scaled down to fit around the Lich.
K = 0.4
def shield(path, n, name):
    im = Image.open(path).convert('RGBA')
    fr = cells(im, 384, n, 512)
    w, h = round(384 * K), round(512 * K)
    fr = [f.resize((w, h), Image.LANCZOS) for f in fr]
    save_strip(fr, name)
    print(name, w, h, n, file=sys.stderr)
shield(shield_loop, 10, 'lich_shield_loop')
shield(shield_collapse, 8, 'lich_shield_collapse')
print(json.dumps(anims, indent=2))
