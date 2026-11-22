"""
Turn the UI images (assets/resources/sprites/ui) into "sprite-frame" assets with their
9-slice borders, so prefabs can use them directly. Keeps every uuid, so nothing that
already uses these images breaks (the code still loads them as textures).
Usage: python ui_metas.py <dir with the original .png.meta files> <project assets dir> <out dir>
"""
import json, os, sys
from PIL import Image

def borders(cfgdir):
    b = json.load(open(os.path.join(cfgdir, 'building.json')))
    h = json.load(open(os.path.join(cfgdir, 'heroes.json')))
    out = {}
    def put(path, ins):
        out[os.path.basename(path)] = (ins.get('top', 0), ins.get('bottom', 0), ins.get('left', 0), ins.get('right', 0))
    for st in b['uiStyle']['buttons'].values():
        put(st['frame'], st['insets']); put(st['fill'], st['insets'])
    put(b['uiStyle']['topBar']['path'], b['uiStyle']['topBar']['insets'])
    for f in h['ui'].values(): put(f['path'], f['insets'])
    return out

def sprite_frame_meta(meta, w, h, b):
    uuid = meta['uuid']
    tex = meta['subMetas']['6c48a']
    tex['userData'].update({'wrapModeS': 'clamp-to-edge', 'wrapModeT': 'clamp-to-edge', 'premultiplyAlpha': False})
    hw, hh = w / 2, h / 2
    sf = {
        'ver': '1.0.12', 'importer': 'sprite-frame', 'uuid': uuid + '@f9941', 'imported': True, 'files': ['.json'], 'subMetas': {},
        'userData': {
            'wrapModeS': 'clamp-to-edge', 'wrapModeT': 'clamp-to-edge', 'minfilter': 'linear', 'magfilter': 'linear',
            'premultiplyAlpha': False, 'generateMipmap': False, 'anisotropy': 1,
            'trimType': 'none', 'trimThreshold': 1, 'rotated': False, 'offsetX': 0, 'offsetY': 0,
            'trimX': 0, 'trimY': 0, 'width': w, 'height': h, 'rawWidth': w, 'rawHeight': h,
            'borderTop': b[0], 'borderBottom': b[1], 'borderLeft': b[2], 'borderRight': b[3],
            'isUuid': True, 'imageUuidOrDatabaseUri': uuid + '@6c48a', 'atlasUuid': '', 'mipfilter': 'none',
            'packable': False,
            'vertices': {
                'rawPosition': [-hw, -hh, 0, hw, -hh, 0, -hw, hh, 0, hw, hh, 0],
                'indexes': [0, 1, 2, 2, 1, 3],
                'uv': [0, h, w, h, 0, 0, w, 0],
                'nuv': [0, 0, 1, 0, 0, 1, 1, 1],
                'minPos': [-hw, -hh, 0], 'maxPos': [hw, hh, 0],
            },
            'pixelsToUnit': 100, 'pivotX': 0.5, 'pivotY': 0.5, 'meshType': 0,
        },
        'displayName': tex.get('displayName', ''), 'id': 'f9941', 'name': 'spriteFrame',
    }
    meta['subMetas']['f9941'] = sf
    meta['userData']['type'] = 'sprite-frame'
    return meta

def main(src, assets, out):
    bd = borders(os.path.join(assets, 'resources/config'))
    ui = os.path.join(assets, 'resources/sprites/ui')
    os.makedirs(out, exist_ok=True)
    table = {}
    for f in sorted(os.listdir(src)):
        if not f.endswith('.png.meta'): continue
        name = f[:-9]
        meta = json.load(open(os.path.join(src, f)))
        w, h = Image.open(os.path.join(ui, name + '.png')).size
        meta = sprite_frame_meta(meta, w, h, bd.get(name, (0, 0, 0, 0)))
        with open(os.path.join(out, f), 'w') as fp: json.dump(meta, fp, indent=2)
        table['sprites/ui/' + name] = {'uuid': meta['uuid'], 'w': w, 'h': h, 'border': bd.get(name, (0, 0, 0, 0))}
    with open(os.path.join(out, 'ui_frames.json'), 'w') as fp: json.dump(table, fp, indent=1)
    print(len(table), 'metas')

if __name__ == '__main__':
    main(*sys.argv[1:4])
