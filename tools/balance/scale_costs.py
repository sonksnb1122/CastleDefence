"""Scale the research costs from a reference research.json and round them to nice numbers.
Usage: python scale_costs.py <reference research.json> <out research.json> <basic factor> <after-awakening factor> [awaken factor]
'basic': every finite technology above the awakening line (the endless ones keep their price), 'after': the 'afterAwakening' ones.
Energy Cores are kept as they are."""
import json, math, sys

def nice(x):
    """Round to a nice number: steps of 5 below 100, 10 below 1000, 250 below 10000, then 500."""
    if x <= 0: return 0
    step = 5 if x < 100 else 10 if x < 1000 else 250 if x < 10000 else 500
    return int(max(step, round(x / step) * step))

ref, out, fb, fa = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4])
fw = float(sys.argv[5]) if len(sys.argv) > 5 else fb
src = open(ref, encoding='utf-8').read()
d = json.loads(src)
cur = json.load(open(out, encoding='utf-8'))
byId = {t['id']: t for t in d['techs']}
for t in cur['techs']:
    r = byId.get(t['id'])
    if not r or t['maxLevel'] <= 0: continue   # endless technologies keep their price
    f = fw if t['id'] == 'r_awaken' else fa if t.get('afterAwakening') else fb
    t['baseCost'] = {k: (v if k == 'core' else nice(v * f)) for k, v in r['baseCost'].items()}
open(out, 'w', encoding='utf-8').write(json.dumps(cur, indent=2, ensure_ascii=True))
