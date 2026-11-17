import { Node, Label, EventTouch } from 'cc';
import { G } from '../core/Globals';
import { ResourceMgr } from '../core/ResourceMgr';
import { COLORS, UIButton, button, hex, mk, panel, text } from './UIKit';

/** Resource bar shown at the top of the castle and battlefield screens. */
export class TopBar {
    node: Node;
    private labels: { [k: string]: Label } = {};
    private waveLabel: Label = null as any;
    private stateLabel: Label = null as any;
    private unsubscribe: () => void;

    constructor(parent: Node) {
        this.node = mk('TopBar', parent);
        this.layout();
        this.unsubscribe = ResourceMgr.inst.onChange(() => this.refresh());
    }

    /** (Re)build the bar for the current screen size. Called again whenever the window is resized. */
    layout() {
        const W = G.main.W, H = G.main.H;
        this.node.destroyAllChildren();
        this.labels = {};
        this.node.setPosition(0, H / 2 - 20, 0);
        // Wider than the screen on purpose so no gap can appear at the edges.
        const bg = panel(this.node, 0, 0, W + 16, 40, COLORS.panel);
        bg.on(Node.EventType.TOUCH_START, (e: EventTouch) => { e.propagationStopped = true; }, bg); // the bar blocks taps on the map below
        bg.on(Node.EventType.TOUCH_END, (e: EventTouch) => { e.propagationStopped = true; }, bg);
        const items: Array<[string, string, string]> = [['food', 'Food', '#9be37a'], ['material', 'Material', '#c3cbd6'], ['gold', 'Gold', '#f2c14e']];
        // Resources share the left part, wave + state sit on the right edge.
        const spacing = Math.max(120, Math.min(190, (W - 330) / 3));
        let x = -W / 2 + 16;
        for (const [key, name, color] of items) {
            text(this.node, name, 15, x, 0, { ax: 0, color: COLORS.textDim });
            this.labels[key] = text(this.node, '0', 18, x + name.length * 9 + 10, 0, { ax: 0, color, bold: true });
            x += spacing;
        }
        this.waveLabel = text(this.node, '', 17, W / 2 - 220, 0, { ax: 0, bold: true });
        this.stateLabel = text(this.node, '', 15, W / 2 - 16, 0, { ax: 1 });
        this.refresh();
    }

    refresh() {
        const rm = ResourceMgr.inst;
        for (const k in this.labels) this.labels[k].string = String(Math.floor(rm.get(k)));
        this.waveLabel.string = 'Wave ' + rm.data.currentWave;
        this.stateLabel.string = rm.isPreparation ? 'Preparation' : 'COMBAT';
        this.stateLabel.color = hex(rm.isPreparation ? COLORS.good : COLORS.bad);
    }

    destroy() { this.unsubscribe(); }
}

/**
 * Round-ish action buttons laid out on an arc below (or above) a selected
 * building or tower.
 */
export function arcMenu(parent: Node, cx: number, cy: number, items: Array<{ label: string; color?: string; onClick: () => void; enabled?: boolean }>, below = true, radius = 78): Node {
    const root = mk('ArcMenu', parent, cx, cy);
    const n = items.length;
    const from = below ? 200 : 160, to = below ? 340 : 20;
    for (let i = 0; i < n; i++) {
        const a = (n === 1 ? (from + to) / 2 : from + (to - from) * i / (n - 1)) * Math.PI / 180;
        const b: UIButton = button(root, items[i].label, Math.cos(a) * radius * 1.8, Math.sin(a) * radius, 74, 28, items[i].onClick, items[i].color || COLORS.buttonAlt, 13);
        if (items[i].enabled === false) b.setEnabled(false);
    }
    return root;
}
