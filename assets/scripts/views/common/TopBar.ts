import { Node, Label, Sprite, SpriteFrame } from 'cc';
import { Assets } from '../../core/Assets';
import { ConfigMgr } from '../../core/ConfigMgr';
import { G } from '../../core/Globals';
import { ResourceMgr } from '../../core/ResourceMgr';
import { TopBarView } from '../items/TopBarView';
import { PrefabButton, PrefabUi } from './PrefabUi';
import { COLORS, hex, mk, resIcon, text } from './UIKit';

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
        if (v.core) {
            this.labels.core = v.core;
            if (v.coreIcon) resIcon(v.coreIcon, 'core', 28);
        }
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
        const keys = Object.keys(this.labels);
        const spacing = Math.max(105, Math.min(170, (W - 420) / keys.length));
        keys.forEach((k, i) => {
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
/** Tint of the action bubbles (the picture is white and see-through). */
const BUBBLE_COLOR = '#a8dcff';
/** The arc is wider than high: x = cos * radius * ARC_X. */
export const ARC_X = 1.4;

export interface ArcItem { label: string; icon?: string; color?: string; onClick: () => void; enabled?: boolean; }

/**
 * Round action buttons in an arc around a building / tower (prefabs/items/ArcButton): a see-through
 * light blue bubble and the action icon (building.json "uiIcons": "act_<icon>").
 * `label` is used when there is no icon art.
 */
export function arcMenu(parent: Node, cx: number, cy: number, items: ArcItem[], below = true, radius = 78): Node {
    const root = mk('ArcMenu', parent, cx, cy);
    const n = items.length;
    const from = below ? 200 : 160, to = below ? 340 : 20;
    const bubble = iconFrame('bubble');
    for (let i = 0; i < n; i++) {
        const a = (n === 1 ? (from + to) / 2 : from + (to - from) * i / (n - 1)) * Math.PI / 180;
        const node = PrefabUi.create('items/ArcButton', root);
        node.name = 'Arc ' + items[i].label;
        node.setPosition(Math.cos(a) * radius * ARC_X, Math.sin(a) * radius, 0);
        const fill = PrefabUi.child(node, 'Fill', Sprite);
        if (fill) fill.spriteFrame = bubble;
        const icon = PrefabUi.child(node, 'Icon', Sprite);
        const art = items[i].icon ? iconFrame('act_' + items[i].icon) : null;
        if (icon) icon.spriteFrame = art;
        if (!art) text(node, items[i].label, 12, 0, 0, { bold: true });
        // Every bubble is the same see-through light blue, so the icons stand out on any background.
        const b = new PrefabButton(node, items[i].onClick, BUBBLE_COLOR);
        b.setEnabled(items[i].enabled !== false);
    }
    return root;
}

/** First frame of a "uiIcons" picture, or null when the art is missing. */
function iconFrame(name: string): SpriteFrame | null {
    const cfg = ConfigMgr.uiIcon(name);
    const frames = cfg ? Assets.frames(cfg.path, cfg.size, cfg.size) : [];
    return frames.length > 0 ? frames[0] : null;
}
