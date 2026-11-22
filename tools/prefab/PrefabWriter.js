// Writes Cocos Creator 3.8 .prefab files (the same JSON the editor saves).
// Only the components the game needs: UITransform, Sprite, Label, Button, Widget,
// BlockInputEvents and custom script components.
const crypto = require('crypto');

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Script uuid -> class id used as "__type__" (same as the editor's compressUuid). */
function compressUuid(uuid) {
  const h = uuid.replace(/-/g, '');
  let out = h.slice(0, 5);
  for (let i = 5; i < 32; i += 3) { const v = parseInt(h.slice(i, i + 3), 16); out += B64[v >> 6] + B64[v & 63]; }
  return out;
}

function newUuid() { return crypto.randomUUID(); }

/** 22 chars id like the editor's fileId. */
function fileId() { return crypto.randomBytes(16).toString('base64').replace(/=+$/, '').slice(0, 22); }

const vec3 = (x = 0, y = 0, z = 0) => ({ __type__: 'cc.Vec3', x, y, z });
const color = c => ({ __type__: 'cc.Color', r: c[0], g: c[1], b: c[2], a: c.length > 3 ? c[3] : 255 });
const hex = (s, a = 255) => { const v = parseInt(s.replace('#', ''), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255, a]; };

const UI_2D = 33554432;

class PrefabWriter {
  constructor(name) {
    this.objs = [{ __type__: 'cc.Prefab', _name: name, _objFlags: 0, __editorExtras__: {}, _native: '', data: { __id__: 1 }, optimizationPolicy: 0, persistent: false }];
    this.root = null;
  }
  add(o) { this.objs.push(o); return this.objs.length - 1; }
  ref(i) { return { __id__: i }; }

  /** New node; returns its index. opts: x, y, sx, sy, angle, active, w, h, ax, ay */
  node(name, parent, o = {}) {
    const id = this.add({
      __type__: 'cc.Node', _name: name, _objFlags: 0, __editorExtras__: {},
      _parent: parent == null ? null : this.ref(parent), _children: [], _active: o.active !== false, _components: [], _prefab: null,
      _lpos: vec3(o.x || 0, o.y || 0, 0), _lrot: { __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 },
      _lscale: vec3(o.sx == null ? 1 : o.sx, o.sy == null ? (o.sx == null ? 1 : o.sx) : o.sy, 1),
      _mobility: 0, _layer: UI_2D, _euler: vec3(0, 0, o.angle || 0), _id: '',
    });
    if (o.angle) { const r = o.angle * Math.PI / 360; this.objs[id]._lrot = { __type__: 'cc.Quat', x: 0, y: 0, z: Math.sin(r), w: Math.cos(r) }; }
    if (parent == null) this.root = id; else this.objs[parent]._children.push(this.ref(id));
    const info = this.add({ __type__: 'cc.PrefabInfo', root: this.ref(1), asset: this.ref(0), fileId: fileId(), instance: null, targetOverrides: null });
    this.objs[id]._prefab = this.ref(info);
    this.comp(id, 'cc.UITransform', {
      _contentSize: { __type__: 'cc.Size', width: o.w || 0, height: o.h || 0 },
      _anchorPoint: { __type__: 'cc.Vec2', x: o.ax == null ? 0.5 : o.ax, y: o.ay == null ? 0.5 : o.ay },
    });
    return id;
  }

  /** Add a component to node `n`; returns the component index. */
  comp(n, type, fields) {
    const id = this.add(Object.assign({ __type__: type, _name: '', _objFlags: 0, __editorExtras__: {}, node: this.ref(n), _enabled: true, __prefab: null }, fields, { _id: '' }));
    this.objs[id].__prefab = this.ref(this.add({ __type__: 'cc.CompPrefabInfo', fileId: fileId() }));
    this.objs[n]._components.push(this.ref(id));
    return id;
  }

  /** frame: sprite frame uuid ("<image uuid>@f9941") or null. type 0 simple, 1 sliced. */
  sprite(n, frame, o = {}) {
    return this.comp(n, 'cc.Sprite', {
      _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4, _color: color(o.color || [255, 255, 255, 255]),
      _spriteFrame: frame ? { __uuid__: frame, __expectedType__: 'cc.SpriteFrame' } : null,
      _type: o.type || 0, _fillType: 0, _sizeMode: 0, _fillCenter: { __type__: 'cc.Vec2', x: 0, y: 0 }, _fillStart: 0, _fillRange: 0,
      _isTrimmedMode: false, _useGrayscale: false, _atlas: null,
    });
  }

  /**
   * Widget: o.left / right / top / bottom / hc / vc (null = not aligned on that side).
   * hcPct / vcPct: the center offsets are a fraction of the parent size instead of pixels.
   */
  widget(n, o = {}) {
    const has = k => o[k] != null;
    const flags = (has('top') ? 1 : 0) | (has('vc') ? 2 : 0) | (has('bottom') ? 4 : 0) | (has('left') ? 8 : 0) | (has('hc') ? 16 : 0) | (has('right') ? 32 : 0);
    return this.comp(n, 'cc.Widget', {
      _alignFlags: flags, _target: null,
      _left: o.left || 0, _right: o.right || 0, _top: o.top || 0, _bottom: o.bottom || 0, _horizontalCenter: o.hc || 0, _verticalCenter: o.vc || 0,
      _isAbsLeft: true, _isAbsRight: true, _isAbsTop: true, _isAbsBottom: true, _isAbsHorizontalCenter: !o.hcPct, _isAbsVerticalCenter: !o.vcPct,
      _originalWidth: 0, _originalHeight: 0, _alignMode: 1, _lockFlags: 0,
    });
  }

  /** Index of the first component of `type` on node `n`. */
  compOf(n, type) {
    for (const r of this.objs[n]._components) if (this.objs[r.__id__].__type__ === type) return r.__id__;
    throw new Error('node ' + this.objs[n]._name + ' has no ' + type);
  }

  /** align: 0 left, 1 center, 2 right. */
  label(n, str, o = {}) {
    const size = o.size || 20;
    return this.comp(n, 'cc.Label', {
      _customMaterial: null, _srcBlendFactor: 2, _dstBlendFactor: 4, _color: color(o.color || [255, 255, 255, 255]),
      _string: str, _horizontalAlign: o.align == null ? 1 : o.align, _verticalAlign: 1, _actualFontSize: size, _fontSize: size,
      _fontFamily: 'Arial', _lineHeight: o.lineHeight || Math.round(size * 1.25), _overflow: o.overflow || 0, _enableWrapText: !!o.wrap,
      _font: null, _isSystemFontUsed: true, _spacingX: 0, _isItalic: false, _isBold: !!o.bold, _isUnderline: false, _underlineHeight: 2,
      _cacheMode: o.cacheMode || 0, _enableOutline: false, _enableShadow: false,
    });
  }

  /** Button that shrinks a little when pressed (like the code-built buttons). */
  button(n, o = {}) {
    return this.comp(n, 'cc.Button', {
      clickEvents: [], _interactable: o.interactable !== false, _transition: 3,
      _normalColor: color([255, 255, 255, 255]), _hoverColor: color([211, 211, 211, 255]), _pressedColor: color([255, 255, 255, 255]), _disabledColor: color([124, 124, 124, 255]),
      _normalSprite: null, _hoverSprite: null, _pressedSprite: null, _disabledSprite: null,
      _duration: 0.08, _zoomScale: o.zoomScale || 0.94, _target: this.ref(n),
    });
  }

  blockInput(n) { return this.comp(n, 'cc.BlockInputEvents', {}); }

  /** Custom script component: classId from compressUuid(script uuid); refs: { field: node or component index } */
  script(n, classId, refs = {}, plain = {}) {
    const fields = Object.assign({}, plain);
    for (const k in refs) fields[k] = refs[k] == null ? null : this.ref(refs[k]);
    return this.comp(n, classId, fields);
  }

  toJSON() { return JSON.stringify(this.objs, null, 2); }
}

function prefabMeta(uuid, name) {
  return JSON.stringify({ ver: '1.1.50', importer: 'prefab', imported: true, uuid, files: ['.json'], subMetas: {}, userData: { syncNodeName: name } }, null, 2);
}
function scriptMeta(uuid) {
  return JSON.stringify({ ver: '4.0.24', importer: 'typescript', imported: true, uuid, files: [], subMetas: {}, userData: {} }, null, 2);
}
function bundleFolderMeta(uuid, bundleName, priority) {
  return JSON.stringify({ ver: '1.2.0', importer: 'directory', imported: true, uuid, files: [], subMetas: {}, userData: { isBundle: true, bundleConfigID: 'default', bundleName, priority } }, null, 2);
}

module.exports = { PrefabWriter, compressUuid, newUuid, hex, prefabMeta, scriptMeta, bundleFolderMeta };
