import { Node, Button, Sprite, Label, Color, Widget, UITransform, Component, EventTouch, instantiate } from 'cc';
import { Assets } from '../../core/Assets';
import { G } from '../../core/Globals';
import { COLORS, hex } from './UIKit';

/**
 * Helpers for the UI that comes from prefabs (assets/prefabs, made by tools/prefab).
 *
 * A prefab button is a node with a Button component and three children:
 * "Fill" (sprite tinted with the button color), "Frame" (pixel-art border) and "Label".
 * A prefab bar is a dark sprite with a "Fill" child anchored on its left edge.
 */
export class PrefabUi {
    /** Instantiate a preloaded prefab under `parent` and lay out its widgets right away. */
    static create(name: string, parent: Node): Node {
        const p = Assets.prefab(name);
        if (!p) throw new Error('[PrefabUi] prefab not loaded: ' + name + ' (add it to PREFABS in Main.ts)');
        const n = instantiate(p);
        parent.addChild(n);
        PrefabUi.align(n);
        return n;
    }

    /** Instantiate a prefab and return its view component. */
    static view<T extends Component>(name: string, parent: Node, type: new (...a: any[]) => T): T {
        const v = PrefabUi.create(name, parent).getComponent(type);
        if (!v) throw new Error('[PrefabUi] prefab ' + name + ' has no ' + type.name);
        return v;
    }

    /**
     * Apply the Widgets of a node tree now (parents first), instead of waiting for the
     * engine to do it at the end of the frame, so code can read the final positions.
     */
    static align(root: Node) {
        const w = root.getComponent(Widget);
        if (w && w.enabled) w.updateAlignment();
        for (const c of root.children) PrefabUi.align(c);
    }

    static child<T extends Component>(node: Node | null, name: string, type: new (...a: any[]) => T): T | null {
        const c = node ? node.getChildByName(name) : null;
        return c ? c.getComponent(type) : null;
    }

    /** Width / height of a node. */
    static size(node: Node): { width: number; height: number } {
        const ui = node.getComponent(UITransform)!;
        return { width: ui.width, height: ui.height };
    }

    static setSize(node: Node, w: number, h: number) { node.getComponent(UITransform)!.setContentSize(w, h); }

    /** Swallow taps on a node so the map behind it never reacts. */
    static blockTaps(node: Node) {
        node.on(Node.EventType.TOUCH_START, (e: EventTouch) => { e.propagationStopped = true; }, node);
        node.on(Node.EventType.TOUCH_END, (e: EventTouch) => { e.propagationStopped = true; }, node);
    }
}

/**
 * Code side of a prefab button: click handler (with the click sound), text,
 * enabled / disabled look and color. Taps never go through to the map behind it,
 * even while the button is disabled.
 */
export class PrefabButton {
    node: Node;
    label: Label | null;
    enabled = true;
    private fill: Sprite | null;
    private frame: Sprite | null;
    private color: Color;
    private button: Button | null;

    constructor(node: Node | null, onClick?: () => void, color?: string) {
        if (!node) throw new Error('[PrefabButton] missing button node');
        this.node = node;
        this.button = node.getComponent(Button);
        this.label = PrefabUi.child(node, 'Label', Label);
        this.fill = PrefabUi.child(node, 'Fill', Sprite);
        this.frame = PrefabUi.child(node, 'Frame', Sprite);
        const c = this.fill ? this.fill.color : hex(COLORS.button);
        this.color = color ? hex(color) : new Color(c.r, c.g, c.b, c.a);
        PrefabUi.blockTaps(node);
        if (onClick) this.onClick(onClick);
    }

    onClick(cb: () => void) {
        this.node.on(Button.EventType.CLICK, () => {
            if (!this.enabled) return;
            G.main.playSfx('click');
            cb();
        }, this);
    }

    setText(s: string) { if (this.label) this.label.string = s; }

    setEnabled(v: boolean) {
        this.enabled = v;
        if (this.button) this.button.interactable = v;
        if (this.fill) this.fill.color = v ? this.color : hex(COLORS.disabled);
        if (this.frame) this.frame.color = v ? Color.WHITE : new Color(160, 160, 170, 255);
        if (this.label) this.label.color = hex(v ? COLORS.text : COLORS.textDim);
    }

    setColor(c: string) { this.color = hex(c); this.setEnabled(this.enabled); }

    setVisible(v: boolean) { this.node.active = v; }
}

/** Horizontal bar from a prefab (HP, volume, research...): sets the width and color of its "Fill". */
export class FillBar {
    node: Node;
    private fill: Sprite;
    private full: number;
    private h: number;
    private ratio = -1;
    private colorKey = '';

    constructor(node: Node | null, private color = COLORS.good) {
        if (!node) throw new Error('[FillBar] missing bar node');
        this.node = node;
        const f = PrefabUi.child(node, 'Fill', Sprite);
        if (!f) throw new Error('[FillBar] bar ' + node.name + ' has no Fill sprite');
        this.fill = f;
        const s = PrefabUi.size(f.node);
        this.full = s.width;
        this.h = s.height;
    }

    set(ratio: number, color?: string) {
        const r = Math.max(0, Math.min(1, ratio));
        if (r !== this.ratio) {
            this.ratio = r;
            PrefabUi.setSize(this.fill.node, this.full * r, this.h);
        }
        const c = color || this.color;
        if (c !== this.colorKey) {
            this.colorKey = c;
            this.fill.color = hex(c);
        }
    }
}
