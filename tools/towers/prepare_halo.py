"""
Prepares the Halo Spire art ("Spire - Tower Pack 3" by Baldur / Foozle, CC0: Tower 05 base, Tower 06 weapons):
  art/combat/towers/base_t5.png         the 3 levels of the base (64 x 128 cells, as base_t1)
  art/combat/towers/t6_l<N>_weapon.png  the crystal of each level (as it is)
  art/halo/halo_ring.png                the halo: one thin white ring (drawn here, not from the pack). The game
                                        scales it from the tower up to the halo radius, so it never covers the
                                        tower (tower.json "halo": ring radius 'ringRadius' in a 'size' px image)
Usage: python prepare_halo.py <newtower folder> <art/combat/towers> <art/halo>
       python prepare_halo.py --ring <art/halo>          (only the ring)
"""
import os, sys
import numpy as np
from PIL import Image

SIZE, RING_R = 256, 124        # image size, ring radius (tower.json "halo": size / ringRadius)
CORE, GLOW = 1.6, 3.5          # half width of the solid line / of the soft glow around it (px)

def ring(out_dir):
    yy, xx = np.mgrid[0:SIZE, 0:SIZE] + 0.5
    d = np.abs(np.hypot(xx - SIZE / 2, yy - SIZE / 2) - RING_R)
    core = np.clip(CORE + 0.5 - d, 0, 1)                     # anti-aliased solid line
    glow = np.clip(1 - d / (CORE + GLOW), 0, 1) ** 2 * 0.45  # soft halo around it
    a = np.maximum(core, glow)
    img = np.zeros((SIZE, SIZE, 4), np.uint8)
    img[..., :3] = 255
    img[..., 3] = (a * 255).round().astype(np.uint8)
    Image.fromarray(img, 'RGBA').save(os.path.join(out_dir, 'halo_ring.png'), optimize=True)

if sys.argv[1] == '--ring':
    ring(sys.argv[2])
    sys.exit(0)
src, towers, halo = sys.argv[1], sys.argv[2], sys.argv[3]
W = os.path.join(src, 'Towers Weapons', 'Tower 06', 'Spritesheets', 'Tower 06 - Level 0%d - Weapon.png')
Image.open(os.path.join(src, 'Towers bases', 'PNGs', 'Tower 05.png')).convert('RGBA').save(os.path.join(towers, 'base_t5.png'), optimize=True)
for lv in (1, 2, 3):
    Image.open(W % lv).convert('RGBA').save(os.path.join(towers, 't6_l%d_weapon.png' % lv), optimize=True)
ring(halo)
