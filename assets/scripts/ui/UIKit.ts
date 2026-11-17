import {
    Node, UITransform, Label, Graphics, Color, Layers, Sprite, SpriteFrame, Mask, UIOpacity,
    EventTouch, EventMouse, Vec3, isValid,
} from 'cc';
import { Assets } from '../core/Assets';
import { ConfigMgr } from '../core/ConfigMgr';
import { Cost, RESOURCE_KEYS } from '../core/GameTypes';
import { G } from '../core/Globals';

/** Code-only UI helpers: every screen in the game is built with these. */

export const COLORS = {
    panel: '#2a2438', panelLight: '#3a3350', border: '#11101a', accent: '#f2c14e',
    text: '#f4efe6', textDim: '#b5adc4', good: '#7bd66a', bad: '#ff6b6b',
    button: '#4a6fa5', buttonAlt: '#6a4c93', buttonDanger: '#b0413e', buttonOk: '#3f8f5b', disabled: '#55515f',
};

export function hex(c: string, alpha = 255): Color {
    const s = c.charAt(0) === '#' ? c.substring(1) : c;
    const v = parseInt(s, 16);
    return new Color((v >> 16) & 255, (v >> 8) & 255, v & 255, alpha);
}

/**
 * A Graphics component loses its drawing while its node is inactive, and the engine only
 * notifies the node whose `active` flag changed, not its children. Everything drawn with
 * Graphics therefore registers a redraw callback here, and containers are shown / hidden
 * with `setVisible`, which redraws the whole subtree when it becomes visible again.
 */
const redrawers = new WeakMap<Node, () => void>();

export function registerRedraw(node: Node, fn: () => void) { redrawers.set(node, fn); }

function redrawTree(node: Node) {
    if (!node.active) return;
    const fn = redrawers.get(node);
    if (fn) fn();
    for (const c of node.children) redrawTree(c);
}

/** Show or hide a node. Always use this (not `node.active`) for nodes that contain buttons, panels or bars. */
export function setVisible(node: Node, visible: boolean) {
    node.active = visible;
    if (!visible) return;
    redrawTree(node);
    // Once more on the next frame, after the engine has re-enabled the components.
    G.main.after(0, () => { if (isValid(node) && node.activeInHierarchy) redrawTree(node); });
}

/** Create a UI node (layer UI_2D) with a UITransform. */
export function mk(name: string, parent: Node | null, x = 0, y = 0, w = 0, h = 0, ax = 0.5, ay = 0.5): Node {
    const n = new Node(name);
    n.layer = Layers.Enum.UI_2D;
    const ui = n.addComponent(UITransform);
    ui.setContentSize(w, h);
    ui.setAnchorPoint(ax, ay);
    if (parent) parent.addChild(n);
    n.setPosition(x, y, 0);
    return n;
}

/** Filled (and optionally outlined) rectangle. The node is centered on (x,y). */
export function panel(parent: Node | null, x: number, y: number, w: number, h: number, fill: string, stroke: string | null = COLORS.border, alpha = 255): Node {
    const n = mk('Panel', parent, x, y, w, h);
    const g = n.addComponent(Graphics);
    drawBox(g, w, h, fill, stroke, alpha);
    registerRedraw(n, () => drawBox(g, w, h, fill, stroke, alpha));
    return n;
}

/** Chunky "pixel" box: flat fill, dark outline, light top edge. */
export function drawBox(g: Graphics, w: number, h: number, fill: string, stroke: string | null, alpha = 255) {
    g.clear();
    g.fillColor = hex(fill, alpha);
    g.rect(-w / 2, -h / 2, w, h);
    g.fill();
    if (stroke) {
        g.fillColor = new Color(255, 255, 255, Math.min(alpha, 40));
        g.rect(-w / 2, h / 2 - 4, w, 4);
        g.fill();
        g.fillColor = new Color(0, 0, 0, Math.min(alpha, 60));
        g.rect(-w / 2, -h / 2, w, 4);
        g.fill();
        g.lineWidth = 3;
        g.strokeColor = hex(stroke, alpha);
        g.rect(-w / 2, -h / 2, w, h);
        g.stroke();
    }
}

export interface TextOpts { color?: string; ax?: number; ay?: number; width?: number; bold?: boolean; align?: 'left' | 'center' | 'right'; }

export function text(parent: Node | null, str: string, size: number, x = 0, y = 0, opts: TextOpts = {}): Label {
    const ax = opts.ax === undefined ? 0.5 : opts.ax;
    const ay = opts.ay === undefined ? 0.5 : opts.ay;
    const n = mk('Text', parent, x, y, opts.width || 0, 0, ax, ay);
    const label = n.addComponent(Label);
    label.fontSize = size;
    label.lineHeight = Math.round(size * 1.25);
    label.color = hex(opts.color || COLORS.text);
    label.isBold = !!opts.bold;
    const align = opts.align || (ax === 0 ? 'left' : ax === 1 ? 'right' : 'center');
    label.horizontalAlign = align === 'left' ? Label.HorizontalAlign.LEFT : align === 'right' ? Label.HorizontalAlign.RIGHT : Label.HorizontalAlign.CENTER;
    if (opts.width) {
        // Fixed width, wrapped text that grows downwards.
        label.overflow = Label.Overflow.RESIZE_HEIGHT;
        label.enableWrapText = true;
        n.getComponent(UITransform)!.setContentSize(opts.width, label.lineHeight);
    }
    label.string = str;
    return label;
}

export function sprite(parent: Node | null, frame: SpriteFrame | null, w: number, h: number, x = 0, y = 0, ax = 0.5, ay = 0.5): Sprite {
    const n = mk('Sprite', parent, x, y, w, h, ax, ay);
    const s = n.addComponent(Sprite);
    s.sizeMode = Sprite.SizeMode.CUSTOM;
    s.trim = false;
    s.spriteFrame = frame;
    n.getComponent(UITransform)!.setContentSize(w, h);
    return s;
}

/**
 * 9-slice frame (pixel art border that keeps its corners while the middle stretches).
 * `cfg` = { path, width, height, insets, scale }. The node is centered on (x,y) and covers
 * w x h on screen; `scale` enlarges the pixel art. Returns null when the texture is missing.
 */
export function sliced(parent: Node | null, cfg: any, x: number, y: number, w: number, h: number): Sprite | null {
    if (!cfg || !cfg.path) return null;
    const frame = Assets.slicedFrame(cfg.path, cfg.width, cfg.height, cfg.insets);
    if (!frame) return null;
    const k = cfg.scale || 1;
    const n = mk('Frame', parent, x, y, w / k, h / k);
    const s = n.addComponent(Sprite);
    s.type = Sprite.Type.SLICED;
    s.sizeMode = Sprite.SizeMode.CUSTOM;
    s.trim = false;
    s.spriteFrame = frame;
    n.getComponent(UITransform)!.setContentSize(w / k, h / k);
    n.setScale(k, k, 1);
    return s;
}

/** Picture from building.json "uiIcons" (e.g. 'pause', 'play') as a plain sprite. Returns null when the art is missing. */
export function uiIcon(parent: Node | null, name: string, size: number, x = 0, y = 0): Sprite | null {
    const cfg = ConfigMgr.uiIcon(name);
    const frames = cfg ? Assets.frames(cfg.path, cfg.size, cfg.size) : [];
    if (frames.length === 0) return null;
    return sprite(parent, frames[0], size, size, x, y);
}

/**
 * Button that is just a picture (e.g. the pause button). Behaves like UIButton:
 * shrinks while pressed, plays the click sound and never taps the map behind it.
 * Returns null when the art is missing so the caller can fall back to a text button.
 */
export function iconButton(parent: Node | null, name: string, x: number, y: number, size: number, onClick: () => void): Node | null {
    const s = uiIcon(parent, name, size, x, y);
    if (!s) return null;
    const n = s.node;
    n.name = 'IconButton_' + name;
    n.on(Node.EventType.TOUCH_START, (e: EventTouch) => { e.propagationStopped = true; n.setScale(0.9, 0.9, 1); }, n);
    n.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => { e.propagationStopped = true; }, n);
    n.on(Node.EventType.TOUCH_CANCEL, (e: EventTouch) => { e.propagationStopped = true; n.setScale(1, 1, 1); }, n);
    n.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
        e.propagationStopped = true;
        n.setScale(1, 1, 1);
        G.main.playSfx('click');
        onClick();
    }, n);
    return n;
}

/** Icon of a resource ('food' | 'material' | 'gold'). Returns null when the icon art is missing. */
export function resIcon(parent: Node | null, key: string, size: number, x = 0, y = 0): Sprite | null {
    const cfg = ConfigMgr.resourceIcon(key);
    const frames = cfg ? Assets.frames(cfg.path, cfg.size, cfg.size) : [];
    if (frames.length === 0) return null;
    return sprite(parent, frames[0], size, size, x, y);
}

export interface CostRowOpts { size?: number; fontSize?: number; color?: string; align?: 'left' | 'center' | 'right'; label?: string; bold?: boolean; }

/**
 * One line of "icon amount" pairs for a cost / reward (order: food, material, gold),
 * optionally preceded by a text label. (x,y) is the left, center or right end of the
 * line depending on `align`. Falls back to words when an icon is missing.
 */
export function costRow(parent: Node | null, cost: Cost | null, x: number, y: number, opts: CostRowOpts = {}): Node {
    const size = opts.size || 20, fs = opts.fontSize || 15, color = opts.color || COLORS.text;
    const root = mk('CostRow', parent, x, y);
    const parts: Array<{ w: number; make: (px: number) => void }> = [];
    const charW = fs * 0.58;
    if (opts.label) {
        const l = opts.label;
        parts.push({ w: l.length * fs * 0.5 + 10, make: px => { text(root, l, fs, px, 0, { ax: 0, color, bold: opts.bold }); } });
    }
    let any = false;
    for (const k of RESOURCE_KEYS) {
        if (!cost || !cost[k]) continue;
        any = true;
        const amount = String(cost[k]);
        const hasIcon = !!ConfigMgr.resourceIcon(k) && Assets.has(ConfigMgr.resourceIcon(k)!.path);
        if (hasIcon) {
            parts.push({ w: size + 3 + amount.length * charW + 12, make: px => {
                resIcon(root, k, size, px + size / 2, 0);
                text(root, amount, fs, px + size + 3, 0, { ax: 0, color, bold: opts.bold });
            } });
        } else {
            const s = `${amount} ${k}`;
            parts.push({ w: s.length * charW + 12, make: px => { text(root, s, fs, px, 0, { ax: 0, color, bold: opts.bold }); } });
        }
    }
    if (!any) parts.push({ w: 4 * charW, make: px => { text(root, 'free', fs, px, 0, { ax: 0, color }); } });
    let total = 0;
    for (const p of parts) total += p.w;
    let px = opts.align === 'center' ? -total / 2 : opts.align === 'right' ? -total : 0;
    for (const p of parts) { p.make(px); px += p.w; }
    return root;
}

/** Simple push button built from a Graphics box and a Label. */
export class UIButton {
    node: Node;
    label: Label;
    enabled = true;
    private g: Graphics;
    private color: string;
    /** Pixel-art frame (border only) and the fill under it, tinted with the button color. */
    private fill: Sprite | null = null;
    private frame: Sprite | null = null;
    constructor(parent: Node | null, str: string, x: number, y: number, public w: number, public h: number, private onClick: () => void, color = COLORS.button, fontSize = 18, style = 'game') {
        this.color = color;
        this.node = mk('Button', parent, x, y, w, h);
        this.g = this.node.addComponent(Graphics);
        this.makeFrame(style);
        this.label = text(this.node, str, fontSize, 0, 0, { bold: true });
        this.redraw();
        // Touch events bubble to parent nodes; stop them so a button never also taps the map behind it.
        this.node.on(Node.EventType.TOUCH_START, (e: EventTouch) => { e.propagationStopped = true; if (this.enabled) this.node.setScale(0.94, 0.94, 1); }, this);
        this.node.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => { e.propagationStopped = true; }, this);
        this.node.on(Node.EventType.TOUCH_CANCEL, (e: EventTouch) => { e.propagationStopped = true; this.node.setScale(1, 1, 1); }, this);
        this.node.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
            e.propagationStopped = true;
            this.node.setScale(1, 1, 1);
            if (!this.enabled) return;
            G.main.playSfx('click');
            this.onClick();
        }, this);
        registerRedraw(this.node, () => this.redraw());
    }
    setText(s: string) { this.label.string = s; }
    setEnabled(v: boolean) { if (this.enabled !== v) { this.enabled = v; this.redraw(); } }
    setColor(c: string) { this.color = c; this.redraw(); }
    setVisible(v: boolean) { setVisible(this.node, v); }
    /**
     * Builds the frame from building.json "uiStyle.buttons[style]". The art is scaled to the
     * button height; very narrow buttons are scaled down further so the end ornaments fit.
     * Without the art the button keeps the plain box drawn in code.
     */
    private makeFrame(style: string) {
        const st = ConfigMgr.buttonStyle(style);
        if (!st || !Assets.has(st.frame) || !Assets.has(st.fill)) return;
        const ins = st.insets;
        const k = Math.min(this.h / st.height, this.w / (ins.left + ins.right + 6));
        const base = { width: st.width, height: st.height, insets: ins, scale: k };
        this.fill = sliced(this.node, Object.assign({ path: st.fill }, base), 0, 0, this.w, this.h);
        this.frame = sliced(this.node, Object.assign({ path: st.frame }, base), 0, 0, this.w, this.h);
    }
    private redraw() {
        if (this.fill && this.frame) {
            this.g.clear();
            this.fill.color = hex(this.enabled ? this.color : COLORS.disabled);
            this.frame.color = this.enabled ? Color.WHITE : new Color(160, 160, 170, 255);
        } else {
            drawBox(this.g, this.w, this.h, this.enabled ? this.color : COLORS.disabled, COLORS.border);
        }
        this.label.color = hex(this.enabled ? COLORS.text : COLORS.textDim);
    }
}

/** Button with the gameplay frame (used on the play screens and their popups). */
export function button(parent: Node | null, str: string, x: number, y: number, w: number, h: number, onClick: () => void, color = COLORS.button, fontSize = 18): UIButton {
    return new UIButton(parent, str, x, y, w, h, onClick, color, fontSize, 'game');
}

/** Button with the menu frame (main menu, pause menu, setting, save / load). */
export function menuButton(parent: Node | null, str: string, x: number, y: number, w: number, h: number, onClick: () => void, color = COLORS.button, fontSize = 18): UIButton {
    return new UIButton(parent, str, x, y, w, h, onClick, color, fontSize, 'menu');
}

/** Full screen dim layer that swallows every touch below it. */
export function blocker(parent: Node, alpha = 170, onTap?: () => void): Node {
    const w = G.main.W + 400, h = G.main.H + 400;
    const n = mk('Blocker', parent, 0, 0, w, h);
    const g = n.addComponent(Graphics);
    g.fillColor = new Color(0, 0, 0, alpha);
    g.rect(-w / 2, -h / 2, w, h);
    g.fill();
    n.on(Node.EventType.TOUCH_START, (e: EventTouch) => { e.propagationStopped = true; }, n);
    n.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => { e.propagationStopped = true; }, n);
    n.on(Node.EventType.TOUCH_END, (e: EventTouch) => { e.propagationStopped = true; if (onTap) onTap(); }, n);
    return n;
}

/** Modal window with a title. Returns the content root (centered) and a close function. */
export function modal(parent: Node, title: string, w: number, h: number): { root: Node; box: Node; close: () => void } {
    const root = mk('Modal', parent);
    blocker(root);
    const box = panel(root, 0, 0, w, h, COLORS.panel);
    box.on(Node.EventType.TOUCH_START, (e: EventTouch) => { e.propagationStopped = true; }, box);
    box.on(Node.EventType.TOUCH_END, (e: EventTouch) => { e.propagationStopped = true; }, box);
    panel(box, 0, h / 2 - 22, w - 6, 38, COLORS.panelLight, null);
    text(box, title, 22, 0, h / 2 - 22, { bold: true, color: COLORS.accent });
    return { root, box, close: () => { if (isValid(root)) root.destroy(); } };
}

/**
 * Ornate window: the "popupBg" frame with the "popupHeader" scroll on its top edge
 * (heroes.json "ui"). Falls back to the standard modal when the art is missing.
 */
export function fancyModal(parent: Node, title: string, w: number, h: number): { root: Node; box: Node; close: () => void } {
    const bgCfg = ConfigMgr.uiFrame('popupBg');
    if (!bgCfg || !Assets.has(bgCfg.path)) return modal(parent, title, w, h);
    const root = mk('Modal', parent);
    blocker(root);
    // The frame art is slightly see-through; a solid backing keeps the content readable.
    panel(root, 0, 0, w - 28, h - 36, '#101230', null);
    sliced(root, bgCfg, 0, 0, w, h);
    const box = mk('Box', root, 0, 0, w, h);
    box.on(Node.EventType.TOUCH_START, (e: EventTouch) => { e.propagationStopped = true; }, box);
    box.on(Node.EventType.TOUCH_END, (e: EventTouch) => { e.propagationStopped = true; }, box);
    // Header scroll sits on the top border.
    const headCfg = ConfigMgr.uiFrame('popupHeader');
    const hk = headCfg ? headCfg.scale || 1 : 1;
    const hh = headCfg ? headCfg.height * hk : 40, hy = h / 2 - 8;
    const hw = Math.max(220, Math.min(w - 60, title.length * 16 + 120));
    if (!sliced(box, headCfg, 0, hy, hw, hh)) panel(box, 0, hy, hw, 40, COLORS.panelLight);
    text(box, title, 22, 0, hy, { bold: true, color: '#5a2a1a' });
    return { root, box, close: () => { if (isValid(root)) root.destroy(); } };
}

/** Yes / No confirmation popup. */
export function confirm(parent: Node, title: string, body: string, onOk: () => void, okText = 'Confirm', cancelText = 'Cancel', price?: { label: string; cost: Cost }) {
    const m = fancyModal(parent, title, 460, 280);
    text(m.box, body, 18, 0, 78, { width: 380, ay: 1, align: 'center' });
    // Cost / refund line with resource icons, just above the buttons.
    if (price) costRow(m.box, price.cost, 0, -36, { align: 'center', label: price.label, size: 24, fontSize: 18, bold: true });
    button(m.box, okText, -100, -92, 150, 44, () => { m.close(); onOk(); }, COLORS.buttonOk);
    button(m.box, cancelText, 100, -92, 150, 44, () => m.close(), COLORS.buttonDanger);
}

/** Information popup with a single Close button. */
export function message(parent: Node, title: string, body: string, onClose?: () => void, w = 460, h = 300): Node {
    const m = fancyModal(parent, title, w, h);
    text(m.box, body, 17, 0, h / 2 - 62, { width: w - 70, ay: 1, align: 'left' });
    button(m.box, 'Close', 0, -h / 2 + 36, 150, 42, () => { m.close(); if (onClose) onClose(); });
    return m.root;
}

/** Short message that fades away near the top of the screen. */
export function toast(parent: Node, msg: string, good = false) {
    const old = parent.getChildByName('Toast');
    if (old) old.destroy();
    const n = mk('Toast', parent, 0, G.main.H / 2 - 90);
    const w = Math.max(220, msg.length * 10 + 40);
    const bg = panel(n, 0, 0, w, 36, good ? '#274a33' : '#4a2730');
    bg.name = 'Bg';
    text(n, msg, 17, 0, 0, { color: good ? COLORS.good : '#ffd0d0' });
    G.main.after(1.8, () => { if (isValid(n)) n.destroy(); });
}

/** Label that floats up and disappears (damage numbers, gold, ...). */
export class FloatText {
    node: Node;
    private life: number;
    private total: number;
    private op: UIOpacity;
    constructor(parent: Node, str: string, x: number, y: number, color: string, size = 16, life = 0.8, icon?: string) {
        const l = text(parent, str, size, x, y, { color, bold: true });
        this.node = l.node;
        // Optional resource icon in front of the text (e.g. gold dropped by an enemy).
        if (icon) resIcon(this.node, icon, size + 4, -(str.length * size * 0.3) - size * 0.7, 0);
        this.op = this.node.addComponent(UIOpacity);
        this.life = this.total = life;
    }
    /** Returns false once finished (node destroyed). */
    update(dt: number): boolean {
        this.life -= dt;
        if (this.life <= 0) { this.node.destroy(); return false; }
        const p = this.node.position;
        this.node.setPosition(p.x, p.y + 36 * dt, 0);
        this.op.opacity = Math.round(255 * Math.min(1, this.life / (this.total * 0.5)));
        return true;
    }
}

/**
 * Vertical scroll list: a masked viewport with a content node that can be
 * dragged or scrolled with the mouse wheel. Add children to `content` using
 * coordinates relative to the top-center of the viewport (y goes down = negative).
 */
export class ScrollList {
    node: Node;
    content: Node;
    private contentHeight = 0;
    private offset = 0;
    /** Current scroll offset in pixels (0 = top). */
    get scroll(): number { return this.offset; }
    /** Height of the visible viewport. */
    get viewHeight(): number { return this.h - 6; }
    /** `bg = false` leaves the area transparent so a framed background can be placed behind it. */
    constructor(parent: Node, x: number, y: number, public w: number, public h: number, bg = true) {
        this.node = mk('ScrollList', parent, x, y, w, h);
        if (bg) panel(this.node, 0, 0, w, h, '#1c1826');
        else panel(this.node, 0, 0, w, h, '#000000', null, 1);   // invisible: still catches drags between cards
        const view = mk('View', this.node, 0, 0, w - 6, h - 6);
        view.addComponent(Mask);
        this.content = mk('Content', view, 0, (h - 6) / 2, 0, 0, 0.5, 1);
        this.node.on(Node.EventType.TOUCH_START, (e: EventTouch) => { e.propagationStopped = true; }, this);
        this.node.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => { e.propagationStopped = true; this.scrollBy(e.getUIDelta().y); }, this);
        this.node.on(Node.EventType.MOUSE_WHEEL, (e: EventMouse) => { this.scrollBy(-e.getScrollY() * 0.4); }, this);
    }
    setContentHeight(h: number) { this.contentHeight = h; this.scrollBy(0); }
    clear() { this.content.destroyAllChildren(); this.offset = 0; this.setContentHeight(0); }
    scrollBy(dy: number) {
        const max = Math.max(0, this.contentHeight - (this.h - 6));
        this.offset = Math.min(max, Math.max(0, this.offset + dy));
        this.content.setPosition(0, (this.h - 6) / 2 + this.offset, 0);
    }
}

/** Convert a touch / mouse UI location into the local space of `node`. */
export function toLocal(node: Node, uiX: number, uiY: number, out: Vec3): Vec3 {
    return node.getComponent(UITransform)!.convertToNodeSpaceAR(new Vec3(uiX, uiY, 0), out);
}

/** Small horizontal bar (HP, volume, ...). */
export class Bar {
    node: Node;
    private g: Graphics;
    constructor(parent: Node, x: number, y: number, private w: number, private h: number, private color: string) {
        this.node = mk('Bar', parent, x, y, w, h);
        this.g = this.node.addComponent(Graphics);
        this.set(1);
        registerRedraw(this.node, () => this.set(this.ratio, this.barColor));
    }
    private ratio = 1;
    private barColor: string | undefined;
    set(ratio: number, color?: string) {
        const r = Math.max(0, Math.min(1, ratio));
        this.ratio = r;
        this.barColor = color;
        const g = this.g, w = this.w, h = this.h;
        g.clear();
        g.fillColor = hex('#11101a');
        g.rect(-w / 2 - 1, -h / 2 - 1, w + 2, h + 2);
        g.fill();
        if (r > 0) {
            g.fillColor = hex(color || this.color);
            g.rect(-w / 2, -h / 2, w * r, h);
            g.fill();
        }
    }
}
