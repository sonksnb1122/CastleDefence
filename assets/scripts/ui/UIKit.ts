import {
    Node, UITransform, Label, Graphics, Color, Layers, Sprite, SpriteFrame, Mask, UIOpacity,
    EventTouch, EventMouse, Vec3, isValid,
} from 'cc';
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

/** Simple push button built from a Graphics box and a Label. */
export class UIButton {
    node: Node;
    label: Label;
    enabled = true;
    private g: Graphics;
    private color: string;
    constructor(parent: Node | null, str: string, x: number, y: number, public w: number, public h: number, private onClick: () => void, color = COLORS.button, fontSize = 18) {
        this.color = color;
        this.node = mk('Button', parent, x, y, w, h);
        this.g = this.node.addComponent(Graphics);
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
    private redraw() {
        drawBox(this.g, this.w, this.h, this.enabled ? this.color : COLORS.disabled, COLORS.border);
        this.label.color = hex(this.enabled ? COLORS.text : COLORS.textDim);
    }
}

export function button(parent: Node | null, str: string, x: number, y: number, w: number, h: number, onClick: () => void, color = COLORS.button, fontSize = 18): UIButton {
    return new UIButton(parent, str, x, y, w, h, onClick, color, fontSize);
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

/** Yes / No confirmation popup. */
export function confirm(parent: Node, title: string, body: string, onOk: () => void, okText = 'Confirm', cancelText = 'Cancel') {
    const m = modal(parent, title, 440, 250);
    text(m.box, body, 18, 0, 70, { width: 390, ay: 1, align: 'center' });
    button(m.box, okText, -100, -90, 150, 44, () => { m.close(); onOk(); }, COLORS.buttonOk);
    button(m.box, cancelText, 100, -90, 150, 44, () => m.close(), COLORS.buttonDanger);
}

/** Information popup with a single Close button. */
export function message(parent: Node, title: string, body: string, onClose?: () => void, w = 460, h = 300): Node {
    const m = modal(parent, title, w, h);
    text(m.box, body, 17, 0, h / 2 - 56, { width: w - 50, ay: 1, align: 'left' });
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
    constructor(parent: Node, str: string, x: number, y: number, color: string, size = 16, life = 0.8) {
        const l = text(parent, str, size, x, y, { color, bold: true });
        this.node = l.node;
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
    constructor(parent: Node, x: number, y: number, public w: number, public h: number) {
        this.node = mk('ScrollList', parent, x, y, w, h);
        panel(this.node, 0, 0, w, h, '#1c1826');
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
