import {
    Node, UITransform, Label, Graphics, Color, Layers, Sprite, SpriteFrame, Mask,
    EventTouch, EventMouse, Vec3, isValid,
} from 'cc';
import { Assets } from '../../core/Assets';
import { ConfigMgr } from '../../core/ConfigMgr';
import { Cost, RESOURCE_KEYS } from '../../core/GameTypes';
import { G } from '../../core/Globals';

/**
 * Helpers for the UI parts that are made in code: list contents, cost rows with
 * resource icons, labels on the maps, placeholders. Screens, popups and list items
 * themselves are prefabs (assets/prefabs, see PrefabUi).
 */

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
