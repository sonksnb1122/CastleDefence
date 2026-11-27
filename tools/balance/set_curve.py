"""Write waves.json "hpCurve" from target HP multipliers at given waves (geometric growth between them).
Usage: python set_curve.py <waves.json> "1:6,5:14,10:100,..." """
import json, sys
f, spec = sys.argv[1], sys.argv[2]
pts = [tuple(float(x) for x in p.split(':')) for p in spec.split(',')]
d = json.load(open(f, encoding='utf-8'))
c = d['hpCurve']
c['base'] = pts[0][1]
segs = []
for (w0, m0), (w1, m1) in zip(pts, pts[1:]):
    segs.append({'fromWave': int(w0) + 1, 'perWave': round((m1 / m0) ** (1 / (w1 - w0)), 4)})
segs.append({'fromWave': int(pts[-1][0]) + 1, 'perWave': 1.0})
c['segments'] = segs
open(f, 'w', encoding='utf-8').write(json.dumps(d, indent=2, ensure_ascii=True))
m = c['base']; out = {1: m}
for w in range(2, 121):
    fac = 1
    for s in segs:
        if w >= s['fromWave']: fac = s['perWave']
    m *= fac; out[w] = m
print({w: round(out[w]) for w in (1, 5, 10, 15, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120)})
