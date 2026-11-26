// Generates every prefab of the game (screens, popups, list items) and the .meta files of
// the prefabs and of their view scripts. The layouts match the old code-built UI.
// Usage: node build_prefabs.js <project dir> <ui_frames.json from ui_metas.py>
//
// The prefabs can be edited in the editor afterwards; running this again overwrites them,
// so once the layouts are tuned in the editor, edit them there and stop using this script.
const fs = require('fs');
const path = require('path');
const { PrefabWriter, compressUuid, newUuid, hex, prefabMeta, scriptMeta, bundleFolderMeta } = require('./PrefabWriter');

const [proj, framesFile] = process.argv.slice(2);
const frames = JSON.parse(fs.readFileSync(framesFile, 'utf8'));
const cfgDir = path.join(proj, 'assets/resources/config');
const heroesCfg = JSON.parse(fs.readFileSync(path.join(cfgDir, 'heroes.json'), 'utf8'));
const buildingCfg = JSON.parse(fs.readFileSync(path.join(cfgDir, 'building.json'), 'utf8'));
const researchCfg = JSON.parse(fs.readFileSync(path.join(cfgDir, 'research.json'), 'utf8'));
const UI = heroesCfg.ui;

// Stable uuids: generated once, then reused so the editor keeps its references.
const uuidFile = path.join(__dirname, 'uuids.json');
const uuids = fs.existsSync(uuidFile) ? JSON.parse(fs.readFileSync(uuidFile, 'utf8')) : {};
const uuid = key => (uuids[key] = uuids[key] || newUuid());

const SPLASH = '7d8f9b89-4fd1-4c9f-a3ab-38ec7cded7ca@f9941'; // built-in white sprite of the engine
const C = {
  panel: '#2a2438', panelLight: '#3a3350', border: '#11101a', accent: '#f2c14e',
  text: '#f4efe6', textDim: '#b5adc4', good: '#7bd66a', bad: '#ff6b6b',
  button: '#4a6fa5', buttonAlt: '#6a4c93', buttonDanger: '#b0413e', buttonOk: '#3f8f5b',
};
const frameUuid = p => { const f = frames[p]; if (!f) throw new Error('no sprite frame for ' + p); return f.uuid + '@f9941'; };
const SCREEN_W = 1024, SCREEN_H = 576;

// ------------------------------------------------------------------ building blocks

/** 9-slice frame like the old UIKit.sliced(): node of size w/k x h/k scaled by k. */
function sliced(w, parent, name, cfg, x, y, width, height, color) {
  const k = cfg.scale || 1;
  const n = w.node(name, parent, { x, y, w: width / k, h: height / k, sx: k });
  w.sprite(n, frameUuid(cfg.path), { type: 1, color });
  return n;
}

/** Flat colored box (white engine sprite tinted). */
function box(w, parent, name, x, y, width, height, rgba, o = {}) {
  const n = w.node(name, parent, Object.assign({ x, y, w: width, h: height }, o));
  w.sprite(n, SPLASH, { color: rgba });
  return n;
}

/**
 * Panel like the old drawBox(): fill, light top edge, dark bottom edge and a dark border.
 * The node itself is the border; "Fill" (with "Shine" / "Shade") follows its size through Widgets,
 * so code can resize a panel and call PrefabUi.align().
 */
function panel(w, parent, name, x, y, width, height, fill, stroke = C.border, alpha = 255, o = {}) {
  if (!stroke) return box(w, parent, name, x, y, width, height, hex(fill, alpha), o);
  const n = box(w, parent, name, x, y, width, height, hex(stroke, alpha), o);
  const f = box(w, n, 'Fill', 0, 0, width - 4, height - 4, hex(fill, alpha));
  w.widget(f, { left: 2, right: 2, top: 2, bottom: 2 });
  const shine = box(w, f, 'Shine', 0, (height - 4) / 2 - 2, width - 4, 4, [255, 255, 255, Math.min(alpha, 40)]);
  w.widget(shine, { left: 0, right: 0, top: 0 });
  const shade = box(w, f, 'Shade', 0, -(height - 4) / 2 + 2, width - 4, 4, [0, 0, 0, Math.min(alpha, 60)]);
  w.widget(shade, { left: 0, right: 0, bottom: 0 });
  return n;
}

/** Bar: dark background with a "Fill" anchored on the left edge (see FillBar). */
function fillBar(w, parent, name, x, y, width, height, color) {
  const n = box(w, parent, name, x, y, width + 2, height + 2, hex(C.border));
  box(w, n, 'Fill', -width / 2, 0, width, height, hex(color), { ax: 0 });
  return n;
}

/** Label. o: color, bold, ax, ay, width (wrapped, grows downwards), align, lineHeight, active. */
function label(w, parent, name, str, x, y, size, o = {}) {
  const ax = o.ax == null ? 0.5 : o.ax, ay = o.ay == null ? 0.5 : o.ay;
  const lh = o.lineHeight || Math.round(size * 1.25);
  const n = w.node(name, parent, { x, y, w: o.width || 0, h: lh, ax, ay, active: o.active });
  const align = o.align != null ? o.align : (ax === 0 ? 0 : ax === 1 ? 2 : 1);
  w.label(n, str, { size, bold: o.bold, color: hex(o.color || C.text), align, lineHeight: lh, overflow: o.width ? 3 : 0, wrap: !!o.width });
  return n;
}
const lab = (w, n) => w.compOf(n, 'cc.Label');
const spr = (w, n) => w.compOf(n, 'cc.Sprite');

/** Button: Fill (tinted) + Frame + Label, like the old UIKit.UIButton. style 'game' or 'menu'. */
function button(w, parent, name, text, x, y, width, height, color, fontSize, style = 'game', o = {}) {
  const st = buildingCfg.uiStyle.buttons[style];
  const ins = st.insets;
  const k = Math.min(height / st.height, width / (ins.left + ins.right + 6));
  const n = w.node(name, parent, { x, y, w: width, h: height, active: o.active });
  w.button(n);
  const base = { width: st.width, height: st.height, insets: ins, scale: k };
  sliced(w, n, 'Fill', Object.assign({ path: st.fill }, base), 0, 0, width, height, hex(color));
  sliced(w, n, 'Frame', Object.assign({ path: st.frame }, base), 0, 0, width, height);
  const l = w.node('Label', n, { x: o.labelX || 0, y: o.labelY || 0, w: 0, h: Math.round(fontSize * 1.25) });
  w.label(l, text, { size: fontSize, bold: true, color: hex(C.text) });
  if (o.widget) w.widget(n, o.widget);
  return n;
}

/** Picture button (pause). */
function iconButton(w, parent, name, framePath, x, y, size, o = {}) {
  const n = w.node(name, parent, { x, y, w: size, h: size });
  w.sprite(n, frameUuid(framePath));
  w.button(n, { zoomScale: 0.9 });
  if (o.widget) w.widget(n, o.widget);
  return n;
}

/** Empty node; `stretch` makes it fill its parent (screen roots, slots). */
function holder(w, parent, name, o = {}) {
  const n = w.node(name, parent, Object.assign({ w: SCREEN_W, h: SCREEN_H }, o));
  if (o.stretch !== false) w.widget(n, { left: 0, right: 0, top: 0, bottom: 0 });
  return n;
}

/**
 * Ornate popup like the old UIKit.fancyModal(): veil, solid backing, popupBg frame and the
 * popupHeader scroll with the title. Returns the "Box" node (content) and the PopupView refs.
 */
function popup(w, name, title, width, height) {
  const root = w.node(name, null, { w: width, h: height });
  const veil = box(w, root, 'Veil', 0, 0, 4096, 4096, [0, 0, 0, 170]);
  w.blockInput(veil); // swallow every tap behind the popup
  const backing = box(w, root, 'Backing', 0, 0, width - 28, height - 36, hex('#101230'));
  const frame = sliced(w, root, 'Frame', UI.popupBg, 0, 0, width, height);
  const b = w.node('Box', root, { w: width, h: height });
  const head = UI.popupHeader;
  const hk = head.scale || 1, hh = head.height * hk, hy = height / 2 - 8;
  const hw = Math.max(220, Math.min(width - 60, title.length * 16 + 120));
  const header = sliced(w, b, 'Header', head, 0, hy, hw, hh);
  const t = label(w, b, 'Title', title, 0, hy, 22, { bold: true, color: '#5a2a1a' });
  return { root, box: b, refs: { backing, frame, box: b, header, title: lab(w, t) } };
}

/** Screen root: fills the screen layer. */
function screen(w, name) {
  const root = w.node(name, null, { w: SCREEN_W, h: SCREEN_H });
  w.widget(root, { left: 0, right: 0, top: 0, bottom: 0 });
  return root;
}

// ------------------------------------------------------------------ output

const written = [];
function write(rel, content) {
  const f = path.join(proj, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
  written.push(rel);
}

/** View script of a prefab: assets/scripts/views/<dir>/<Class>.ts (its .meta gives the class id). */
const VIEW_DIRS = {};
function viewScript(cls, dir) {
  VIEW_DIRS[cls] = dir;
  return compressUuid(uuid('script:' + cls));
}

function save(w, rel, root, cls, dir, refs) {
  if (cls) w.script(root, viewScript(cls, dir), refs);
  write(`assets/prefabs/${rel}.prefab`, w.toJSON());
  write(`assets/prefabs/${rel}.prefab.meta`, prefabMeta(uuid('prefab:' + rel), path.basename(rel)));
}

// ------------------------------------------------------------------ popups

function pausePopup() {
  const w = new PrefabWriter('Pause');
  const p = popup(w, 'Pause', 'Paused', 360, 470);
  const items = [
    ['Resume', 'resumeButton', C.buttonOk], ['Save Game', 'saveButton', C.button], ['Load Game', 'loadButton', C.button],
    ['Setting', 'settingsButton', C.button], ['Go To Main Menu', 'menuButton', C.buttonAlt], ['Quit Game', 'quitButton', C.buttonDanger],
  ];
  const refs = p.refs;
  items.forEach(([text, field, color], i) => { refs[field] = button(w, p.box, field.replace('Button', '') + 'Button', text, 0, 132 - i * 58, 260, 46, color, 19, 'menu'); });
  refs.saveHint = lab(w, label(w, p.box, 'SaveHint', 'Saving is disabled during combat', 0, -206, 12, { color: C.textDim }));
  save(w, 'popups/Pause', p.root, 'PauseView', 'popups', refs);
}

function settingsPopup() {
  const w = new PrefabWriter('Settings');
  const p = popup(w, 'Settings', 'Setting', 480, 470);
  const refs = p.refs;
  [['Music', 'music', 145], ['Sound FX', 'sfx', 95]].forEach(([name, key, y]) => {
    const row = w.node(name.replace(' ', '') + 'Row', p.box, { y, w: 440, h: 36 });
    label(w, row, 'Name', name, -200, 0, 18, { ax: 0 });
    refs[key + 'Bar'] = fillBar(w, row, 'Bar', 40, 0, 150, 14, C.accent);
    refs[key + 'Value'] = lab(w, label(w, row, 'Value', '100%', 175, 0, 16, { ax: 0 }));
    refs[key + 'Minus'] = button(w, row, 'Minus', '-', -70, 0, 36, 34, C.button, 22, 'menu');
    refs[key + 'Plus'] = button(w, row, 'Plus', '+', 150, 0, 36, 34, C.button, 22, 'menu');
  });
  // Battle display options: On / Off toggles (SettingsOverlay sets the text and color).
  label(w, p.box, 'DisplayTitle', 'Battle display', -200, 50, 16, { ax: 0, color: C.textDim });
  [['Damage Numbers', 'damageToggle', 12], ['Health Bars', 'hpBarToggle', -36], ['Effects', 'effectsToggle', -84]].forEach(([name, key, y]) => {
    const row = w.node(name.replace(' ', '') + 'Row', p.box, { y, w: 440, h: 36 });
    label(w, row, 'Name', name, -200, 0, 18, { ax: 0 });
    refs[key] = button(w, row, 'Toggle', 'On', 150, 0, 90, 34, C.buttonOk, 18, 'menu');
  });
  refs.closeButton = button(w, p.box, 'CloseButton', 'Close', 0, -172, 160, 44, C.button, 18, 'menu');
  save(w, 'popups/Settings', p.root, 'SettingsView', 'popups', refs);
}

function saveLoadPopup() {
  const w = new PrefabWriter('SaveLoad');
  const p = popup(w, 'SaveLoad', 'Load Game', 580, 440);
  const refs = p.refs;
  refs.rows = w.node('Rows', p.box, { w: 580, h: 440 });
  refs.backButton = button(w, p.box, 'BackButton', 'Back', 0, -176, 160, 44, C.button, 18, 'menu');
  save(w, 'popups/SaveLoad', p.root, 'SaveLoadView', 'popups', refs);
}

/**
 * Research tree window (views/ResearchTree.ts draws the tree in TreeArea): one button per branch
 * (research.json "branches") to jump to it, zoom buttons and Close.
 */
function researchTreePopup() {
  const W = SCREEN_W - 24, H = SCREEN_H - 46;
  const w = new PrefabWriter('ResearchTree');
  const p = popup(w, 'ResearchTree', 'Research Tree', W, H);
  const refs = p.refs;
  const cap = label(w, p.box, 'CapLabel', 'Research Lab Lv 1: tier 1 open.', -W / 2 + 36, H / 2 - 64, 14, { ax: 0, color: C.textDim });
  w.widget(cap, { left: 36, top: 55 });
  refs.capLabel = lab(w, cap);
  // Branch buttons, right-aligned on the line of the Lab text.
  const TW = 104, TG = 6, branches = researchCfg.branches || [];
  const tabs = w.node('Tabs', p.box, { x: W / 2 - 34 - (branches.length * (TW + TG) - TG) / 2, y: H / 2 - 64, w: branches.length * (TW + TG) - TG, h: 30 });
  w.widget(tabs, { right: 34, top: 49 });
  branches.forEach((b, i) => {
    const x = -tabs_w(branches.length, TW, TG) / 2 + TW / 2 + i * (TW + TG);
    button(w, tabs, 'Tab_' + b.id, b.name, x, 0, TW, 30, b.color, 13);
  });
  refs.tabs = tabs;
  refs.treeArea = w.node('TreeArea', p.box, { y: -12, w: W - 56, h: H - 160 });
  w.widget(refs.treeArea, { left: 28, right: 28, top: 86, bottom: 66 });
  refs.closeButton = button(w, p.box, 'CloseButton', 'Close', 0, -H / 2 + 40, 160, 42, C.button, 18, 'game', { widget: { bottom: 19 } });
  refs.zoomOutButton = button(w, p.box, 'ZoomOutButton', '-', W / 2 - 120, -H / 2 + 40, 50, 42, C.buttonAlt, 22, 'game', { widget: { right: 95, bottom: 19 } });
  refs.zoomInButton = button(w, p.box, 'ZoomInButton', '+', W / 2 - 64, -H / 2 + 40, 50, 42, C.buttonAlt, 22, 'game', { widget: { right: 39, bottom: 19 } });
  save(w, 'popups/ResearchTree', p.root, 'ResearchTreeView', 'popups', refs);
}
const tabs_w = (n, tw, tg) => n * (tw + tg) - tg;

/**
 * Hero window (tap a hero card): animated card on the left, texts in InfoArea (code stacks them in a
 * scroll list), icon buttons Learn skill / Promote under the texts. No Close button: a tap on the
 * veil closes it.
 */
function heroInfoPopup() {
  const W = 680, H = 500;
  const w = new PrefabWriter('HeroInfo');
  const p = popup(w, 'HeroInfo', 'Hero', W, H);
  const refs = p.refs;
  const c = heroesCfg.card, imgH = 320, imgW = Math.round(imgH * c.cellW / c.cellH);
  refs.art = panel(w, p.box, 'Art', -W / 2 + 34 + imgW / 2, 4, imgW - 8, imgH - 8, '#1c1826');
  const x0 = -W / 2 + 34 + imgW + 24, colW = W / 2 - 30 - x0, top = 62, bottom = 118;
  refs.infoArea = w.node('InfoArea', p.box, { x: x0 + colW / 2, y: (bottom - top) / 2, w: colW, h: H - top - bottom });
  w.widget(refs.infoArea, { left: x0 + W / 2, right: 30, top, bottom });
  const iconBtn = (name, caption, x) => {
    const n = w.node(name, p.box, { x, y: -H / 2 + 78, w: 60, h: 60 });
    w.sprite(w.node('Icon', n, { w: 56, h: 56 }), null);
    refs[name.charAt(0).toLowerCase() + name.slice(1) + 'Caption'] = lab(w, label(w, n, 'Caption', caption, 0, -38, 12, { bold: true }));
    return n;
  };
  refs.learnButton = iconBtn('LearnButton', 'Learn skill', x0 + colW / 2 - 60);
  refs.promoteButton = iconBtn('PromoteButton', 'Promote', x0 + colW / 2 + 60);
  save(w, 'popups/HeroInfo', p.root, 'HeroInfoView', 'popups', refs);
}

function confirmPopup() {
  const w = new PrefabWriter('Confirm');
  const p = popup(w, 'Confirm', 'Confirm', 460, 280);
  const refs = p.refs;
  refs.body = lab(w, label(w, p.box, 'Body', 'Are you sure?', 0, 78, 18, { width: 380, ay: 1, align: 1 }));
  refs.price = w.node('Price', p.box, { y: -36 });
  refs.okButton = button(w, p.box, 'OkButton', 'Confirm', -100, -92, 150, 44, C.buttonOk, 18);
  refs.cancelButton = button(w, p.box, 'CancelButton', 'Cancel', 100, -92, 150, 44, C.buttonDanger, 18);
  save(w, 'popups/Confirm', p.root, 'ConfirmView', 'popups', refs);
}

function messagePopup() {
  const W = 460, H = 300;
  const w = new PrefabWriter('Message');
  const p = popup(w, 'Message', 'Message', W, H);
  const refs = p.refs;
  const body = label(w, p.box, 'Body', 'Message text', 0, H / 2 - 62, 17, { width: W - 70, ay: 1, align: 0 });
  w.widget(body, { left: 35, right: 35, top: 62 });
  refs.body = lab(w, body);
  refs.closeButton = button(w, p.box, 'CloseButton', 'Close', 0, -H / 2 + 36, 150, 42, C.button, 18, 'game', { widget: { bottom: 15 } });
  save(w, 'popups/Message', p.root, 'MessageView', 'popups', refs);
}

function infoPopup() {
  const W = 500, H = 400;
  const w = new PrefabWriter('Info');
  const p = popup(w, 'Info', 'Info', W, H);
  const refs = p.refs;
  refs.content = w.node('Content', p.box, { w: W, h: H });
  w.widget(refs.content, { left: 0, right: 0, top: 0, bottom: 0 });
  refs.closeButton = button(w, p.box, 'CloseButton', 'Close', 0, -H / 2 + 36, 150, 42, C.button, 18, 'game', { widget: { bottom: 15 } });
  // Optional action (e.g. "Research"): shown by the code, the Close button then moves to the right.
  refs.actionButton = button(w, p.box, 'ActionButton', 'OK', -95, -H / 2 + 36, 150, 42, C.buttonOk, 18, 'game', { widget: { bottom: 15 } });
  save(w, 'popups/Info', p.root, 'InfoView', 'popups', refs);
}

function buildPopup() {
  const W = 540, H = 360;
  const w = new PrefabWriter('Build');
  const p = popup(w, 'Build', 'Build', W, H);
  const refs = p.refs;
  refs.rows = w.node('Rows', p.box, { w: W, h: H });
  w.widget(refs.rows, { left: 0, right: 0, top: 0, bottom: 0 });
  refs.closeButton = button(w, p.box, 'CloseButton', 'Close', 0, -H / 2 + 38, 140, 38, C.button, 18, 'game', { widget: { bottom: 19 } });
  save(w, 'popups/Build', p.root, 'BuildView', 'popups', refs);
}

function newHeroPopup() {
  const w = new PrefabWriter('NewHero');
  const p = popup(w, 'NewHero', 'New Hero!', 560, 440);
  const refs = p.refs;
  const c = heroesCfg.card, imgH = 320, imgW = Math.round(imgH * c.cellW / c.cellH);
  refs.art = panel(w, p.box, 'Art', -150, -24, imgW - 8, imgH - 8, '#1c1826');
  refs.heroName = lab(w, label(w, p.box, 'HeroName', 'Hero Name', 0, 126, 20, { ax: 0, bold: true }));
  refs.passive = lab(w, label(w, p.box, 'Passive', '[Passive]', 0, 102, 13, { ax: 0, color: C.accent }));
  refs.buffs = lab(w, label(w, p.box, 'Buffs', 'Buff 1\nBuff 2', 0, 87, 14, { ax: 0, ay: 1, color: '#bfe8b0', lineHeight: 22 }));
  refs.closeButton = button(w, p.box, 'CloseButton', 'Close', 130, -162, 150, 42, C.button, 18);
  save(w, 'popups/NewHero', p.root, 'NewHeroView', 'popups', refs);
}

// ------------------------------------------------------------------ items

function topBarItem() {
  const w = new PrefabWriter('TopBar');
  const root = w.node('TopBar', null, { w: SCREEN_W, h: 40 });
  w.widget(root, { left: 0, right: 0, top: 0 });
  const refs = {};
  refs.background = panel(w, root, 'Background', 0, 0, SCREEN_W + 16, 40, C.panel);
  w.widget(refs.background, { left: -8, right: -8 });
  const fr = buildingCfg.uiStyle.topBar;
  refs.frame = sliced(w, root, 'Frame', fr, 0, -6, SCREEN_W, 52);
  const k = fr.scale || 1, c = fr.center;
  const orn = w.node('Ornament', root, { y: -32, w: c.width * k, h: c.height * k, ay: 0 });
  w.sprite(orn, frameUuid(c.path));
  const left = w.node('Left', root, { x: -SCREEN_W / 2, w: 600, h: 40, ax: 0 });
  w.widget(left, { left: 0 });
  [['food', 'Food', '#9be37a'], ['material', 'Material', '#c3cbd6'], ['gold', 'Gold', '#f2c14e']].forEach(([key, name, color], i) => {
    const g = w.node(name, left, { x: 16 + 190 * i, w: 150, h: 40, ax: 0 });
    const icon = w.node('Icon', g, { x: 14, w: 28, h: 28 });
    w.sprite(icon, frameUuid(buildingCfg.resourceIcons[key]));
    refs[key] = lab(w, label(w, g, 'Amount', '0', 34, 0, 18, { ax: 0, color, bold: true }));
  });
  // Energy Core (boss drop). Its icon is set at runtime (TopBar) from building.json "resourceIcons.core".
  {
    const g = w.node('Core', left, { x: 16 + 190 * 3, w: 110, h: 40, ax: 0 });
    refs.coreIcon = w.node('Icon', g, { x: 14, w: 28, h: 28 });
    refs.core = lab(w, label(w, g, 'Amount', '0', 34, 0, 18, { ax: 0, color: '#7fd8ff', bold: true }));
  }
  const right = w.node('Right', root, { x: SCREEN_W / 2, w: 400, h: 40, ax: 1 });
  w.widget(right, { right: 0 });
  refs.towers = lab(w, label(w, right, 'Towers', 'Towers 0/10', -360, 0, 16, { ax: 0, bold: true, color: '#cfe3ff' }));
  refs.wave = lab(w, label(w, right, 'Wave', 'Wave 1', -220, 0, 17, { ax: 0, bold: true }));
  refs.state = lab(w, label(w, right, 'State', 'Preparation', -16, 0, 15, { ax: 1, color: C.good }));
  save(w, 'items/TopBar', root, 'TopBarView', 'items', refs);
}

function defTabItem() {
  const W = 300, H = 74, HS = 24;
  const w = new PrefabWriter('DefTab');
  const root = w.node('DefTab', null, { w: W, h: H });
  const refs = {};
  const big = refs.expanded = panel(w, root, 'Expanded', 0, 0, W, H, '#1b1626', null, 190);
  refs.title = lab(w, label(w, big, 'Title', 'Enemy armor - Wave 1', -W / 2 + 10, H / 2 - 12, 13, { ax: 0, bold: true, color: C.accent }));
  ['Physic', 'Magic'].forEach((name, i) => {
    const y0 = H / 2 - 31 - i * 17;
    label(w, big, name + 'Name', name, -W / 2 + 10, y0, 12, { ax: 0, color: C.textDim });
    refs[name.toLowerCase() + 'Bar'] = fillBar(w, big, name + 'Bar', -W / 2 + 120, y0, 120, 8, C.good);
    refs[name.toLowerCase() + 'Value'] = lab(w, label(w, big, name + 'Value', '0 / 0', W / 2 - 10, y0, 12, { ax: 1, bold: true }));
  });
  refs.footer = lab(w, label(w, big, 'Footer', 'Enemy DEF rises at wave 10', -W / 2 + 10, -H / 2 + 9, 11, { ax: 0, color: C.textDim }));
  const small = refs.collapsed = panel(w, root, 'Collapsed', 0, 0, W, HS, '#1b1626', null, 190, { active: false });
  refs.smallLabel = lab(w, label(w, small, 'Label', 'Armor W1   Phy 0/0   Mag 0/0', -W / 2 + 10, 0, 12, { ax: 0, bold: true }));
  refs.toggle = panel(w, root, 'Toggle', W / 2 - 13, H / 2 - 11, 20, 18, C.panelLight, C.border, 230);
  refs.toggleLabel = lab(w, label(w, refs.toggle, 'Label', '-', 0, 1, 14, { bold: true, color: C.accent }));
  save(w, 'items/DefTab', root, 'DefTabView', 'items', refs);
}

function saveSlotItem() {
  const w = new PrefabWriter('SaveSlot');
  const root = w.node('SaveSlot', null, { w: 510, h: 58 });
  panel(w, root, 'Panel', 0, 0, 510, 58, C.panelLight);
  const refs = {};
  refs.slotName = lab(w, label(w, root, 'SlotName', 'Slot 1', -240, 10, 18, { ax: 0, bold: true }));
  refs.desc = lab(w, label(w, root, 'Desc', 'Empty', -240, -13, 14, { ax: 0, color: C.textDim }));
  refs.actionButton = button(w, root, 'ActionButton', 'Load', 140, 0, 100, 38, C.buttonOk, 16, 'menu');
  refs.deleteButton = button(w, root, 'DeleteButton', 'X', 225, 0, 38, 38, C.buttonDanger, 16, 'menu');
  save(w, 'items/SaveSlot', root, 'SaveSlotView', 'items', refs);
}

function buildRowItem() {
  const w = new PrefabWriter('BuildRow');
  const root = w.node('BuildRow', null, { w: 480, h: 64 });
  sliced(w, root, 'Frame', Object.assign({}, UI.cardFrame, { scale: 1 }), 0, 0, 480, 64);
  const refs = {};
  refs.icon = spr(w, box(w, root, 'Icon', -198, 0, 50, 50, [255, 255, 255, 255]));
  refs.title = lab(w, label(w, root, 'Title', 'Building  (0/5)', -162, 12, 17, { ax: 0, bold: true }));
  refs.cost = w.node('Cost', root, { x: -162, y: -12 });
  refs.buildButton = button(w, root, 'BuildButton', 'Build', 172, 0, 96, 38, C.buttonOk, 16);
  save(w, 'items/BuildRow', root, 'BuildRowView', 'items', refs);
}

function heroCardItem() {
  const w = new PrefabWriter('HeroCard');
  const W = 448, H = 182, padX = 34, padY = 18;
  const root = w.node('HeroCard', null, { w: W, h: H });
  const refs = {};
  refs.frame = spr(w, sliced(w, root, 'Frame', UI.cardFrame, 0, 0, W, H));
  const c = heroesCfg.card;
  const imgH = H - padY * 2, imgW = Math.round(imgH * c.cellW / c.cellH);
  // Everything is placed from the left edge, so the card can be made narrower on small screens.
  refs.art = panel(w, root, 'Art', -W / 2 + padX + imgW / 2, 0, imgW - 8, imgH - 8, '#1c1826');
  w.widget(refs.art, { left: padX + 4 });
  refs.placeholder = lab(w, label(w, refs.art, 'Placeholder', 'Hero', 0, 0, 13, { color: C.textDim }));
  const tx = -W / 2 + padX + imgW + 6 + 12, ty = H / 2 - 26;
  const text = (name, str, y, size, o) => { const n = label(w, root, name, str, tx, y, size, Object.assign({ ax: 0 }, o)); w.widget(n, { left: tx + W / 2 }); return lab(w, n); };
  refs.heroName = text('HeroName', 'Hero Name', ty, 16, { bold: true });
  refs.passive = text('Passive', '[Passive]', ty - 18, 12, { color: C.accent });
  refs.buffs = text('Buffs', 'Buff 1\nBuff 2', ty - 36 + 8, 12, { ay: 1, color: '#bfe8b0', lineHeight: 16 });
  // "+" at the top right corner: learn a skill from a skill book (shown by the recruitment screen).
  refs.learnButton = button(w, root, 'LearnButton', '+', W / 2 - 30, H / 2 - 28, 34, 34, C.buttonOk, 20, 'game', { active: false });
  w.widget(refs.learnButton, { right: 13, top: 11 });
  save(w, 'items/HeroCard', root, 'HeroCardView', 'items', refs);
}

function skillCardItem() {
  // Small hero card of the battle HUD (hero skills): hero picture, skill name, recharge overlay, highlight.
  const w = new PrefabWriter('SkillCard');
  const W = 74, H = 104;
  const root = w.node('SkillCard', null, { w: W, h: H });
  const refs = {};
  refs.glow = box(w, root, 'Glow', 0, 0, W + 10, H + 10, hex('#ffe27a', 235), { active: false });
  refs.frame = spr(w, sliced(w, root, 'Frame', UI.cardFrame, 0, 0, W, H));
  refs.art = panel(w, root, 'Art', 0, 8, W - 16, H - 36, '#1c1826');
  refs.placeholder = lab(w, label(w, refs.art, 'Placeholder', 'Hero', 0, 0, 11, { color: C.textDim }));
  refs.skillName = lab(w, label(w, root, 'SkillName', 'Skill', 0, -H / 2 + 13, 10, { bold: true, width: W - 8 }));
  refs.shade = box(w, root, 'Shade', 0, 0, W - 6, H - 6, hex('#000000', 150), { active: false });
  refs.status = lab(w, label(w, root, 'Status', '', 0, 6, 13, { bold: true, width: W - 8, color: '#ffe27a' }));
  save(w, 'items/SkillCard', root, 'SkillCardView', 'items', refs);
}

function levelTagItem() {
  const w = new PrefabWriter('LevelTag');
  const root = w.node('LevelTag', null, { w: 128, h: 30 });
  sliced(w, root, 'Frame', UI.levelTag, 0, 0, 128, 30);
  label(w, root, 'Label', 'Lv 1', 0, 1, 16, { bold: true, color: '#fff6dc' });
  save(w, 'items/LevelTag', root);
}

function arcButtonItem() {
  // Round action button of the building / tower menus: a see-through light blue bubble ("Fill") with
  // the action icon on top. Both pictures are set by arcMenu (building.json "uiIcons").
  const w = new PrefabWriter('ArcButton');
  const root = w.node('ArcButton', null, { w: 40, h: 40 });
  w.button(root, { zoomScale: 0.9 });
  w.sprite(w.node('Fill', root, { w: 40, h: 40 }), null);
  w.sprite(w.node('Icon', root, { w: 28, h: 28 }), null);
  save(w, 'items/ArcButton', root);
}

function towerButtonItem() {
  const w = new PrefabWriter('TowerButton');
  const root = button(w, null, 'TowerButton', 'Tower', 0, 0, 164, 44, C.button, 13, 'game', { labelY: 10 });
  w.node('Cost', root, { y: -9 });
  save(w, 'items/TowerButton', root);
}

function toastItem() {
  const w = new PrefabWriter('Toast');
  const root = w.node('Toast', null, { w: 220, h: 36 });
  panel(w, root, 'Bg', 0, 0, 220, 36, '#4a2730');
  label(w, root, 'Label', 'Message', 0, 0, 17, { color: '#ffd0d0' });
  save(w, 'items/Toast', root);
}

// ------------------------------------------------------------------ screens

function loadingScreen() {
  const w = new PrefabWriter('Loading');
  const root = screen(w, 'Loading');
  const refs = {};
  box(w, root, 'Background', 0, 0, 4096, 4096, hex('#1b1626'));
  label(w, root, 'Title', 'CASTLE DEFENSE', 0, 90, 52, { bold: true, color: C.accent });
  refs.bar = fillBar(w, root, 'Bar', 0, -40, 420, 18, C.accent);
  refs.percent = lab(w, label(w, root, 'Percent', '0%', 0, -40, 16, { bold: true }));
  refs.step = lab(w, label(w, root, 'Step', 'Loading...', 0, -76, 16, { color: C.textDim }));
  const err = label(w, root, 'Error', '', 0, 30, 13, { width: SCREEN_W - 80, ay: 1, align: 0, color: '#ff8a8a' });
  w.widget(err, { left: 40, right: 40 });
  refs.error = lab(w, err);
  save(w, 'screens/Loading', root, 'LoadingView', 'screens', refs);
}

function mainMenuScreen() {
  const w = new PrefabWriter('MainMenu');
  const root = screen(w, 'MainMenuUi');
  const refs = {};
  box(w, root, 'Veil', 0, 0, 4096, 4096, hex('#0d0a14', 165));
  label(w, root, 'Title', 'CASTLE DEFENSE', 0, 175, 56, { bold: true, color: C.accent });
  label(w, root, 'Subtitle', 'Hold the wall. Grow the castle.', 0, 128, 18, { color: '#e6dcf2' });
  [['New Game', 'newGameButton', C.buttonOk], ['Load Game', 'loadButton', C.button], ['Setting', 'settingsButton', C.button], ['Quit Game', 'quitButton', C.buttonDanger]]
    .forEach(([text, field, color], i) => { refs[field] = button(w, root, field.replace('Button', '') + 'Button', text, 0, 50 - i * 62, 270, 50, color, 22, 'menu'); });
  const warn = label(w, root, 'Warnings', '', -SCREEN_W / 2 + 10, -SCREEN_H / 2 + 10, 12, { ax: 0, ay: 0, color: '#ffb36b' });
  w.widget(warn, { left: 10, bottom: 10 });
  refs.warnings = lab(w, warn);
  save(w, 'screens/MainMenu', root, 'MainMenuView', 'screens', refs);
}

/** Pause picture button in the bottom left corner. */
const pauseButton = (w, root) => iconButton(w, root, 'PauseButton', buildingCfg.uiIcons.pause, -SCREEN_W / 2 + 34, -SCREEN_H / 2 + 34, 52, { widget: { left: 8, bottom: 8 } });

function inCastleScreen() {
  const w = new PrefabWriter('InCastle');
  const root = screen(w, 'InCastle');
  const refs = {};
  box(w, root, 'Background', 0, 0, 4096, 4096, hex('#3b5d3a'));
  refs.worldHolder = holder(w, root, 'WorldHolder');
  refs.topBarSlot = holder(w, root, 'TopBarSlot');
  refs.defTabSlot = holder(w, root, 'DefTabSlot');
  refs.outsideButton = button(w, root, 'OutsideButton', 'Go Outside >', SCREEN_W / 2 - 86, SCREEN_H / 2 - 66, 156, 40, C.buttonOk, 17, 'game', { widget: { right: 8, top: 46 } });
  refs.pauseButton = pauseButton(w, root);
  refs.baseButton = button(w, root, 'BaseButton', 'Base', -SCREEN_W / 2 + 112, -SCREEN_H / 2 + 30, 76, 40, C.button, 16, 'game', { widget: { left: 74, bottom: 10 } });
  refs.buildButton = button(w, root, 'BuildButton', 'Build', 0, -SCREEN_H / 2 + 30, 140, 40, C.button, 18, 'game', { widget: { bottom: 10 } });
  refs.cancelButton = button(w, root, 'CancelButton', 'Cancel placement', 0, -SCREEN_H / 2 + 30, 200, 40, C.buttonDanger, 16, 'game', { widget: { bottom: 10 }, active: false });
  save(w, 'screens/InCastle', root, 'InCastleView', 'screens', refs);
}

function outCastleScreen() {
  const w = new PrefabWriter('OutCastle');
  const root = screen(w, 'OutCastle');
  const refs = {};
  refs.worldHolder = holder(w, root, 'WorldHolder');
  refs.topBarSlot = holder(w, root, 'TopBarSlot');
  // Wall status, anchored on the top left corner (children are placed from that corner).
  const wall = w.node('WallPanel', root, { x: -SCREEN_W / 2, y: SCREEN_H / 2, w: 560, h: 80, ax: 0, ay: 1 });
  w.widget(wall, { left: 0, top: 0 });
  panel(w, wall, 'Strip', 264, -56, 540, 28, '#1b1626', null, 170);
  label(w, wall, 'WallTitle', 'Wall', 14, -56, 14, { ax: 0, bold: true });
  refs.wallBar = fillBar(w, wall, 'WallBar', 150, -56, 180, 12, '#6ad66a');
  refs.wallLabel = lab(w, label(w, wall, 'WallLabel', '1000 / 1000   DEF 0/0', 250, -56, 13, { ax: 0 }));
  refs.repairButton = button(w, wall, 'RepairButton', 'Repair', 470, -58, 86, 28, C.button, 13);
  refs.defTabSlot = holder(w, root, 'DefTabSlot');
  refs.enterButton = button(w, root, 'EnterButton', '< Enter Castle', SCREEN_W / 2 - 86, SCREEN_H / 2 - 66, 156, 40, C.buttonOk, 17, 'game', { widget: { right: 8, top: 46 } });
  refs.startButton = button(w, root, 'StartButton', 'Start Wave', SCREEN_W / 2 - 96, -SCREEN_H / 2 + 30, 176, 44, C.buttonDanger, 18, 'game', { widget: { right: 8, bottom: 8 } });
  const info = label(w, root, 'WaveInfo', 'Next: 24 enemies', SCREEN_W / 2 - 10, -SCREEN_H / 2 + 66, 14, { ax: 1, color: '#1b1626', bold: true });
  w.widget(info, { right: 10, bottom: 57 });
  refs.waveInfo = lab(w, info);
  refs.pauseButton = pauseButton(w, root);
  refs.speedButton = button(w, root, 'SpeedButton', 'x1', -SCREEN_W / 2 + 102, -SCREEN_H / 2 + 30, 56, 40, C.button, 17, 'game', { widget: { left: 74, bottom: 10 } });
  // Temporary: casts the skills of skills.json one after another (testing); << and >> pick the previous / next one.
  refs.skillBackButton = button(w, root, 'SkillBackButton', '<<', -SCREEN_W / 2 + 32, -SCREEN_H / 2 + 140, 44, 40, C.button, 16, 'game', { widget: { left: 10, bottom: 120 }, active: false });
  refs.skillTestButton = button(w, root, 'SkillTestButton', 'Skill', -SCREEN_W / 2 + 160, -SCREEN_H / 2 + 140, 200, 40, C.buttonOk, 15, 'game', { widget: { left: 60, bottom: 120 }, active: false });
  refs.skillSkipButton = button(w, root, 'SkillSkipButton', '>>', -SCREEN_W / 2 + 288, -SCREEN_H / 2 + 140, 44, 40, C.button, 16, 'game', { widget: { left: 266, bottom: 120 }, active: false });
  refs.cancelButton = button(w, root, 'CancelButton', 'Cancel placement', 0, -SCREEN_H / 2 + 30, 200, 40, C.buttonDanger, 16, 'game', { widget: { bottom: 10 }, active: false });
  refs.buildBar = w.node('BuildBar', root, { x: 20, y: -SCREEN_H / 2 + 30, w: 520, h: 44 });
  w.widget(refs.buildBar, { bottom: 8 });
  // Battle: hero skill cards in place of the build buttons (filled by OutCastleScreen), and the
  // description of the selected card on the right.
  refs.heroSkillBar = w.node('HeroSkillBar', root, { x: 40, y: -SCREEN_H / 2 + 62, w: 560, h: 110, active: false });
  w.widget(refs.heroSkillBar, { bottom: 7 });
  const skillInfo = w.node('SkillInfo', root, { x: SCREEN_W / 2 - 148, y: -40, w: 280, h: 190, active: false });
  w.widget(skillInfo, { right: 8 });
  sliced(w, skillInfo, 'Frame', UI.listBg, 0, 0, 280, 190);
  box(w, skillInfo, 'Backing', 0, 0, 250, 160, hex('#1d1830', 235));
  refs.skillInfo = skillInfo;
  refs.skillInfoTitle = lab(w, label(w, skillInfo, 'Title', 'Skill', 0, 66, 17, { bold: true, color: C.accent, width: 240 }));
  refs.skillInfoType = lab(w, label(w, skillInfo, 'Type', 'Hero', 0, 44, 12, { color: '#9fe8ff', width: 240 }));
  refs.skillInfoText = lab(w, label(w, skillInfo, 'Text', 'Description', 0, 30, 13, { width: 236, ay: 1, align: 1, color: '#e6e0f0' }));
  save(w, 'screens/OutCastle', root, 'OutCastleView', 'screens', refs);
}

function heroRecruitScreen() {
  const w = new PrefabWriter('HeroRecruit');
  const root = screen(w, 'HeroRecruit');
  const refs = {};
  box(w, root, 'Background', 0, 0, 4096, 4096, hex('#241d33'));
  refs.topBarSlot = holder(w, root, 'TopBarSlot');
  const listW = 470, listTop = SCREEN_H / 2 - 126, listBottom = -SCREEN_H / 2 + 72, listH = listTop - listBottom;
  [['Owned', -1], ['Locked', 1]].forEach(([name, side]) => {
    const area = w.node(name + 'Area', root, { x: side * SCREEN_W / 4, y: (listTop + listBottom) / 2, w: listW, h: listH });
    w.widget(area, { top: 126, hc: side * 0.25, hcPct: true });
    sliced(w, area, 'Frame', UI.listBg, 0, 0, listW + 36, listH + 36);
    refs[name.toLowerCase() + 'Area'] = area;
    const head = w.node(name + 'Header', root, { x: side * SCREEN_W / 4, y: SCREEN_H / 2 - 84, w: 280, h: 48 });
    w.widget(head, { top: 60, hc: side * 0.25, hcPct: true });
    sliced(w, head, 'Scroll', Object.assign({}, UI.popupHeader, { scale: 1.5 }), 0, 0, 280, 48);
    refs[name.toLowerCase() + 'Title'] = lab(w, label(w, head, 'Title', name === 'Owned' ? 'Owned heroes (0/3)' : 'Not recruited (27)', 0, 0, 18, { bold: true, color: '#5a2a1a' }));
  });
  refs.backButton = button(w, root, 'BackButton', '< Back', -SCREEN_W / 2 + 70, -SCREEN_H / 2 + 30, 120, 40, C.buttonAlt, 17, 'game', { widget: { left: 10, bottom: 10 } });
  refs.recruitButton = button(w, root, 'RecruitButton', 'Recruit', 0, -SCREEN_H / 2 + 30, 360, 42, C.buttonOk, 17, 'game', { widget: { bottom: 9 }, labelX: -110 });
  refs.recruitCost = w.node('Cost', refs.recruitButton, { x: 50 });
  save(w, 'screens/HeroRecruit', root, 'HeroRecruitView', 'screens', refs);
}

function tradeScreen() {
  // Market of the Base: trade one resource for another (rates and fee: building.json "trade").
  const w = new PrefabWriter('Trade');
  const root = screen(w, 'Trade');
  const refs = {};
  box(w, root, 'Background', 0, 0, 4096, 4096, hex('#241d33'));
  refs.topBarSlot = holder(w, root, 'TopBarSlot');
  const head = w.node('Header', root, { y: SCREEN_H / 2 - 84, w: 280, h: 48 });
  w.widget(head, { top: 60 });
  sliced(w, head, 'Scroll', Object.assign({}, UI.popupHeader, { scale: 1.5 }), 0, 0, 280, 48);
  label(w, head, 'Title', 'Market', 0, 0, 20, { bold: true, color: '#5a2a1a' });
  // Centered panel: "Trade Amount" column, step buttons in the middle, "Receive Amount" column.
  const PW = 760, PH = 330;
  const area = w.node('Panel', root, { y: -14, w: PW, h: PH });
  sliced(w, area, 'Frame', UI.listBg, 0, 0, PW + 36, PH + 36);
  // Dark inner backing over the blue frame center, so white text and icons read well.
  box(w, area, 'Backing', 0, 0, PW + 4, PH + 4, hex('#1d1830', 235));
  const col = (name, x, title) => {
    label(w, area, name + 'Title', title, x, PH / 2 - 30, 19, { bold: true, color: C.accent });
    [['Gold', 'gold'], ['Material', 'material'], ['Food', 'food']].forEach(([n], i) => {
      // One resource: icon + amount, centered as a group by TradeScreen (amounts owned are in the top bar).
      const b = button(w, area, name + n, '', x, PH / 2 - 92 - i * 74, 210, 58, C.panelLight, 17, 'game');
      w.node('Icon', b, { x: -30, w: 36, h: 36 });
      label(w, b, 'Amount', '0', -8, 0, 22, { ax: 0, bold: true });
      refs[name.toLowerCase() + n] = b;
    });
  };
  col('Give', -PW / 2 + 135, 'Trade Amount');
  col('Get', PW / 2 - 135, 'Receive Amount');
  // Middle: arrow, amount step buttons and the rate of this wave.
  const mid = w.node('Middle', area, { w: 300, h: PH });
  label(w, mid, 'Arrow', '>>>', 0, PH / 2 - 30, 26, { bold: true, color: C.accent });
  // Two rows of three step buttons, narrow enough to leave a gap to both columns.
  [['Minus1000', '-1K', C.button], ['Minus100', '-100', C.button], ['Plus100', '+100', C.button],
   ['Plus1000', '+1K', C.button], ['Plus10000', '+10K', C.button], ['Max', 'Max', C.buttonAlt]].forEach(([n, t, color], i) => {
    const field = n === 'Max' ? 'maxButton' : n.charAt(0).toLowerCase() + n.slice(1) + 'Button';
    refs[field] = button(w, mid, n + 'Button', t, -78 + (i % 3) * 78, 84 - Math.floor(i / 3) * 46, 70, 38, color, 15);
  });
  // Rate of this wave (green when better than usual, red when worse), then fee and price changes.
  refs.rateLabel = lab(w, label(w, mid, 'Rate', '1 gold = 0.7 food', 0, -16, 17, { bold: true }));
  // Top-anchored: 2-3 lines growing downwards.
  refs.infoLabel = lab(w, label(w, mid, 'Info', 'Market fee 20%', 0, -32, 14, { width: 290, ay: 1, align: 1, bold: true, color: '#d8d0e6' }));
  refs.header = head;
  refs.marketPanel = area;
  // Skill Books tab (hidden at first): books owned on the left, books for sale this wave on the right,
  // laid out like the hero recruitment.
  const listW = 470, listTop = SCREEN_H / 2 - 126, listBottom = -SCREEN_H / 2 + 72, listH = listTop - listBottom;
  [['OwnedBooks', -1, 'Skill books (0)'], ['Shop', 1, 'For sale this wave']].forEach(([name, side, title]) => {
    const a = w.node(name + 'Area', root, { x: side * SCREEN_W / 4, y: (listTop + listBottom) / 2, w: listW, h: listH, active: false });
    w.widget(a, { top: 126, hc: side * 0.25, hcPct: true });
    sliced(w, a, 'Frame', UI.listBg, 0, 0, listW + 36, listH + 36);
    const key = name.charAt(0).toLowerCase() + name.slice(1);
    refs[key + 'Area'] = a;
    const h = w.node(name + 'Header', root, { x: side * SCREEN_W / 4, y: SCREEN_H / 2 - 84, w: 280, h: 48, active: false });
    w.widget(h, { top: 60, hc: side * 0.25, hcPct: true });
    sliced(w, h, 'Scroll', Object.assign({}, UI.popupHeader, { scale: 1.5 }), 0, 0, 280, 48);
    refs[key + 'Header'] = h;
    refs[key + 'Title'] = lab(w, label(w, h, 'Title', title, 0, 0, 18, { bold: true, color: '#5a2a1a' }));
  });
  refs.backButton = button(w, root, 'BackButton', '< Back', -SCREEN_W / 2 + 70, -SCREEN_H / 2 + 30, 120, 40, C.buttonAlt, 17, 'game', { widget: { left: 10, bottom: 10 } });
  refs.tradeButton = button(w, root, 'TradeButton', 'Trade', 0, -SCREEN_H / 2 + 30, 220, 42, C.buttonOk, 18, 'game', { widget: { bottom: 9 } });
  // Tabs (bottom right): resource Market / Skill Books.
  refs.marketTab = button(w, root, 'MarketTab', 'Market', SCREEN_W / 2 - 215, -SCREEN_H / 2 + 30, 120, 40, C.buttonOk, 16, 'game', { widget: { right: 155, bottom: 10 } });
  refs.booksTab = button(w, root, 'BooksTab', 'Skill Books', SCREEN_W / 2 - 80, -SCREEN_H / 2 + 30, 140, 40, C.button, 16, 'game', { widget: { right: 10, bottom: 10 } });
  save(w, 'screens/Trade', root, 'TradeView', 'screens', refs);
}

// ------------------------------------------------------------------ run

[pausePopup, settingsPopup, saveLoadPopup, researchTreePopup, heroInfoPopup, confirmPopup, messagePopup, infoPopup, buildPopup, newHeroPopup,
  topBarItem, defTabItem, saveSlotItem, buildRowItem, heroCardItem, skillCardItem, levelTagItem, arcButtonItem, towerButtonItem, toastItem,
  loadingScreen, mainMenuScreen, inCastleScreen, outCastleScreen, heroRecruitScreen, tradeScreen].forEach(f => f());
viewScript('PopupView', 'popups');
for (const cls in VIEW_DIRS) write(`assets/scripts/views/${VIEW_DIRS[cls]}/${cls}.ts.meta`, scriptMeta(uuid('script:' + cls)));
write('assets/prefabs.meta', bundleFolderMeta(uuid('folder:prefabs'), 'prefabs', 6));
write('assets/bundles/heroes.meta', bundleFolderMeta(uuid('folder:bundles/heroes'), 'heroes', 5));
fs.writeFileSync(uuidFile, JSON.stringify(uuids, null, 2));
console.log('wrote ' + written.length + ' files');
