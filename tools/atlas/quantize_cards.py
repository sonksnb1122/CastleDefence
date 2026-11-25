"""
Reduce the hero card sheets (assets/bundles/heroes/*_card_sheet.png) to 256-color PNGs, about 4x smaller.

  - Ordered (Bayer 4x4) dither on the colors: no banding on the gradient backgrounds, and the
    pattern stays still between the animation frames of a sheet (error diffusion would flicker).
  - Alpha is kept exact: fully clear pixels stay clear, opaque pixels stay opaque; the soft edge
    pixels get their own 32 palette entries.

Usage (from the project root):
    python tools/atlas/quantize_cards.py assets/bundles/heroes            (every *_card_sheet.png, in place)
    python tools/atlas/quantize_cards.py <in.png> <out.png>               (one file)
Run it on the full-color source of a new or changed sheet. Needs Python + Pillow + NumPy.
"""
import glob, os, sys
import numpy as np
from PIL import Image
B=np.array([[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]],float)/16-0.5
SEMI=32   # palette entries for the soft (semi-transparent) edge pixels
def strip_quant(px, n, mode):
    im=Image.fromarray(px.reshape(1,-1,px.shape[-1]).astype(np.uint8), mode)
    q=im.quantize(n, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    pal=np.array(q.getpalette(rawmode='RGBA' if mode=='RGBA' else 'RGB')[:n*(4 if mode=='RGBA' else 3)]).reshape(-1,4 if mode=='RGBA' else 3)
    return np.array(q).reshape(-1), pal
def quantize(im, amp=20):
    a=np.array(im.convert('RGBA')).astype(float); h,w=a.shape[:2]
    t=np.tile(B,(h//4+1,w//4+1))[:h,:w]*amp
    a[...,:3]=np.clip(a[...,:3]+t[...,None],0,255)
    al=a[...,3]; op=al==255; semi=(al>0)&(al<255)
    idx=np.zeros((h,w),np.uint8); pal=np.zeros((256,4),int)   # entry 0 = clear
    ns=min(SEMI, max(1,int(semi.sum()))) if semi.any() else 0
    if semi.any():
        i,p=strip_quant(a[semi],ns,'RGBA'); ns=len(p); pal[1:1+ns]=p; idx[semi]=i+1
    no=255-ns
    if op.any():
        i,p=strip_quant(a[op][:,:3],no,'RGB'); pal[1+ns:1+ns+len(p),:3]=p; pal[1+ns:1+ns+len(p),3]=255; idx[op]=i+1+ns
    out=Image.fromarray(idx,'P'); out.putpalette(pal[:,:3].astype(np.uint8).flatten().tolist())
    out.info['transparency']=bytes(pal[:,3].astype(np.uint8).tolist())
    return out

def save(im, out):
    q = quantize(im)
    q.save(out, optimize=True, transparency=q.info['transparency'])

if __name__ == '__main__':
    a = sys.argv[1] if len(sys.argv) > 1 else 'assets/bundles/heroes'
    if os.path.isdir(a):
        for f in sorted(glob.glob(os.path.join(a, '*_card_sheet.png'))):
            before = os.path.getsize(f); save(Image.open(f), f)
            print('%s  %d KB -> %d KB' % (os.path.basename(f), before // 1024, os.path.getsize(f) // 1024))
    else:
        save(Image.open(a), sys.argv[2] if len(sys.argv) > 2 else a)
