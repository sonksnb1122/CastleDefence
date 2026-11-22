import { Node, Label } from 'cc';
import { G } from '../../core/Globals';
import { ResourceMgr } from '../../core/ResourceMgr';
import { TopBarView } from '../items/TopBarView';
import { PrefabButton, PrefabUi } from './PrefabUi';
import { COLORS, hex, mk } from './UIKit';

/** Resource bar shown at the top of the castle and battlefield screens (prefabs/items/TopBar). */
export class TopBar {
    node: Node;
    private view: TopBarView;
    private labels: { [k: string]: Label } = {};
    private unsubscribe: () => void;

    /**
     * `showTowers`: "Towers x/y" (battlefield only).
     * `demoValue`: main menu background bar. Only the three resources are shown,
     * all with this fixed amount, and the player's data is never read.
     */
    constructor(parent: Node, private showTowers = false, private demoValue: number | null = null) {
        this.view = PrefabUi.view('items/TopBar', parent, TopBarView);
        this.node = this.view.node;
        const v = this.view;
        this.labels = { food: v.food!, material: v.material!, gold: v.gold! };
        if (v.background) PrefabUi.blockTaps(v.background);   // the bar blocks taps on the map below
        if (v.towers) v.towers.node.active = showTowers && demoValue === null;
        for (const l of [v.wave, v.state]) if (l) l.node.active = demoValue === null;
        this.layout();
        this.unsubscribe = demoValue === null ? ResourceMgr.inst.onChange(() => this.refresh()) : () => { /* nothing to unsubscribe */ };
    }

    /** Fit the bar to the screen width. Called again whenever the window is resized. */
    layout() {
        const W = G.main.W, v = this.view;
        PrefabUi.setSize(this.node, W, PrefabUi.size(this.node).height);
        PrefabUi.align(this.node);
        // The ornate frame is pixel art scaled up, so its size is the screen width divided by its scale.
        // Exactly the screen width (not wider), so its corner ornaments are not cut off by the screen edges.
        if (v.frame) { const k = v.frame.scale.x || 1; PrefabUi.setSize(v.frame, W / k, PrefabUi.size(v.frame).height); }
        // Resources share the left part (narrow screens get a smaller spacing), wave + state sit on the right edge.
        const spacing = Math.max(120, Math.min(190, (W - 330) / 3));
        ['food', 'material', 'gold'].forEach((k, i) => {
            const group = this.labels[k].node.parent!;
            group.setPosition(16 + spacing * i, group.position.y, 0);
        });
        if (this.demoValue !== null) {
            for (const k in this.labels) this.labels[k].string = String(this.demoValue);
            return;
        }
        this.refresh();
    }

    refresh() {
        if (this.demoValue !== null) return;
        const rm = ResourceMgr.inst, v = this.view;
        for (const k in this.labels) this.labels[k].string = String(Math.floor(rm.get(k)));
        v.wave!.string = 'Wave ' + rm.data.currentWave;
        if (this.showTowers) v.towers!.string = `Towers ${rm.data.towers.length}/${rm.towerLimit}`;
        v.state!.string = rm.isPreparation ? 'Preparation' : 'COMBAT';
        v.state!.color = hex(rm.isPreparation ? COLORS.good : COLORS.bad);
    }

    destroy() { this.unsubscribe(); }
}

/**
 * Small action buttons (prefabs/items/ArcButton) laid out on an arc below
 * (or above) a selected building or tower.
 */
export function arcMenu(parent: Node, cx: number, cy: number, items: Array<{ label: string; color?: string; onClick: () => void; enabled?: boolean }>, below = true, radius = 78): Node {
    const root = mk('ArcMenu', parent, cx, cy);
    const n = items.length;
    const from = below ? 200 : 160, to = below ? 340 : 20;
    for (let i = 0; i < n; i++) {
        const a = (n === 1 ? (from + to) / 2 : from + (to - from) * i / (n - 1)) * Math.PI / 180;
        const node = PrefabUi.create('items/ArcButton', root);
        node.setPosition(Math.cos(a) * radius * 1.8, Math.sin(a) * radius, 0);
        const b = new PrefabButton(node, items[i].onClick, items[i].color || COLORS.buttonAlt);
        b.setText(items[i].label);
        b.setEnabled(items[i].enabled !== false);
    }
    return root;
}
