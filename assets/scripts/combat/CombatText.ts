import { Node, Label, UIOpacity } from 'cc';
import { hex, resIcon, text } from '../views/common/UIKit';

/**
 * Floating number of the battle (damage, gold, wall hits). Pooled: a finished
 * text hides its node and is restarted with show(). The label uses the CHAR
 * cache, so every number shares one glyph texture instead of making a new
 * texture for each string.
 */
export class CombatText {
    node: Node;
    private label: Label;
    private op: UIOpacity;
    private icons: { [key: string]: Node } = {};
    private life = 0;
    private total = 1;

    constructor(parent: Node) {
        this.label = text(parent, '', 16);
        this.label.cacheMode = Label.CacheMode.CHAR;
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

    /** Returns false once finished (the node is hidden and can be reused). */
    update(dt: number): boolean {
        this.life -= dt;
        if (this.life <= 0) { this.node.active = false; return false; }
        const p = this.node.position;
        this.node.setPosition(p.x, p.y + 36 * dt, 0);
        this.op.opacity = Math.round(255 * Math.min(1, this.life / (this.total * 0.5)));
        return true;
    }
}
