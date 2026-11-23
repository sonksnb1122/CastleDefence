import { Node, Label, UIOpacity, Color } from 'cc';
import { hex, resIcon, text } from '../views/common/UIKit';

/**
 * Floating number of the battle (damage, gold, wall hits). Pooled: a finished
 * text hides its node and is restarted with show(). The label uses the CHAR
 * cache, so every number shares one glyph texture instead of making a new
 * texture for each string. A dark outline keeps it readable on any background.
 *
 * Texts shown on an enemy follow it while it lives and are stacked in rows
 * (CombatManager keeps at most 3 rows per enemy, the newest at the bottom).
 */
export class CombatText {
    node: Node;
    private label: Label;
    private op: UIOpacity;
    private icons: { [key: string]: Node } = {};
    private life = 0;
    private total = 1;
    /** Enemy the text is stacked on (null: the text stays where it was shown). */
    owner: { x: number; y: number; alive: boolean } | null = null;
    /** Row in the owner's stack (0 = lowest). */
    row = 0;
    /** The enemy stack this text is in (CombatManager), null when free. */
    stack: CombatText[] | null = null;
    private ax = 0;
    private ay = 0;
    private rowY = 0;
    /** Row height; 0 for a free text that just floats up. */
    private rowH = 0;

    constructor(parent: Node) {
        this.label = text(parent, '', 16);
        this.label.cacheMode = Label.CacheMode.CHAR;
        this.label.enableOutline = true;
        this.label.outlineColor = new Color(16, 10, 20, 255);
        this.label.outlineWidth = 2;
        this.node = this.label.node;
        this.op = this.node.addComponent(UIOpacity);
        this.node.active = false;
    }

    show(str: string, x: number, y: number, color: string, size: number, life: number, icon?: string) {
        this.label.string = str;
        this.label.fontSize = size;
        this.label.lineHeight = Math.round(size * 1.25);
        this.label.color = hex(color);
        this.node.setPosition(x, y, 0);
        this.ax = x; this.ay = y;
        this.owner = null; this.stack = null; this.row = 0; this.rowY = 0; this.rowH = 0;
        this.op.opacity = 255;
        this.life = this.total = life;
        for (const k in this.icons) this.icons[k].active = false;
        if (icon) {
            // Optional resource icon in front of the text (e.g. gold dropped by an enemy).
            if (!this.icons[icon]) {
                const s = resIcon(this.node, icon, size + 4);
                if (s) this.icons[icon] = s.node;
            }
            const n = this.icons[icon];
            if (n) { n.active = true; n.setPosition(-(str.length * size * 0.3) - size * 0.7, 0, 0); }
        }
        this.node.active = true;
    }

    /**
     * Show the text in row 0 of an enemy's stack. (dx, dy) is the offset from the enemy center.
     */
    showOn(owner: { x: number; y: number; alive: boolean }, dx: number, dy: number, rowH: number, str: string, color: string, size: number, life: number) {
        this.show(str, owner.x + dx, owner.y + dy, color, size, life);
        this.owner = owner;
        this.rowH = rowH;
        this.ax = dx; this.ay = dy;
    }

    /** Stop following the enemy (keeps the current position). */
    detach() {
        if (this.owner) { this.ax += this.owner.x; this.ay += this.owner.y; this.owner = null; }
        this.stack = null;
    }

    /** Hide the text on the next update (pushed out of a full stack). */
    expire() { this.life = 0; this.node.active = false; }

    /** Returns false once finished (the node is hidden and can be reused). */
    update(dt: number): boolean {
        this.life -= dt;
        if (this.life <= 0) { this.node.active = false; this.owner = null; return false; }
        if (this.owner && !this.owner.alive) {
            // The enemy died: keep the text where it is.
            this.ax += this.owner.x; this.ay += this.owner.y; this.owner = null;
        }
        if (this.rowH > 0) {
            // Slide toward its row, with a small rise over its life.
            const want = this.row * this.rowH;
            this.rowY += (want - this.rowY) * Math.min(1, dt * 14);
            const rise = 8 * (1 - this.life / this.total);
            const bx = this.owner ? this.owner.x + this.ax : this.ax;
            const by = this.owner ? this.owner.y + this.ay : this.ay;
            this.node.setPosition(bx, by + this.rowY + rise, 0);
        } else {
            const p = this.node.position;
            this.node.setPosition(p.x, p.y + 36 * dt, 0);
        }
        this.op.opacity = Math.round(255 * Math.min(1, this.life / (this.total * 0.5)));
        return true;
    }
}
