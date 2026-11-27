"""
.meta of a NEW image of assets/resources/sprites/ui (no meta yet): an image with a "sprite-frame" sub-asset,
like the ones ui_metas.py makes, with a new uuid. The image is added to ui_frames.json so the prefabs can use it.
An image that already has a meta keeps it (its uuid never changes).
Usage: python new_ui_meta.py <project assets dir> <name> [<name> ...]      (name: file name without .png)
"""
import json, os, sys, uuid
from PIL import Image
from ui_metas import sprite_frame_meta

assets, names = sys.argv[1], sys.argv[2:]
here = os.path.dirname(os.path.abspath(__file__))
frames_file = os.path.join(here, 'ui_frames.json')
table = json.load(open(frames_file))
for name in names:
    png = os.path.join(assets, 'resources/sprites/ui', name + '.png')
    meta_path = png + '.meta'
    w, h = Image.open(png).size
    if os.path.exists(meta_path):
        meta = json.load(open(meta_path))
    else:
        u = str(uuid.uuid4())
        meta = {'ver': '1.0.27', 'importer': 'image', 'imported': True, 'uuid': u, 'files': ['.json', '.png'],
                'subMetas': {'6c48a': {'importer': 'texture', 'uuid': u + '@6c48a', 'displayName': name, 'id': '6c48a', 'name': 'texture',
                                       'userData': {'wrapModeS': 'clamp-to-edge', 'wrapModeT': 'clamp-to-edge', 'minfilter': 'linear', 'magfilter': 'linear',
                                                    'mipfilter': 'none', 'anisotropy': 0, 'isUuid': True, 'imageUuidOrDatabaseUri': u, 'visible': False,
                                                    'premultiplyAlpha': False},
                                       'ver': '1.0.22', 'imported': True, 'files': ['.json'], 'subMetas': {}}},
                'userData': {'type': 'sprite-frame', 'fixAlphaTransparencyArtifacts': False, 'hasAlpha': True, 'redirect': u + '@6c48a'}}
        meta = sprite_frame_meta(meta, w, h, (0, 0, 0, 0))
        with open(meta_path, 'w') as fp: json.dump(meta, fp, indent=2)
    table['sprites/ui/' + name] = {'uuid': meta['uuid'], 'w': w, 'h': h, 'border': [0, 0, 0, 0]}
with open(frames_file, 'w') as fp: json.dump(table, fp, indent=1)
print('ok', names)
