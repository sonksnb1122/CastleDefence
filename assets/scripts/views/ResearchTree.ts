import { Node, Label, Graphics, Mask, EventTouch, EventMouse, Vec3, Sprite, Color } from 'cc';
import { ConfigMgr } from '../core/ConfigMgr';
import { G } from '../core/Globals';
import { ResourceMgr } from '../core/ResourceMgr';
import { ResearchView } from './popups/ResearchView';
import { IOverlay } from './Overlays';
import { PrefabButton, PrefabUi } from './common/PrefabUi';
import { confirm, infoWindow, toast } from './common/Popups';
import { COLORS, drawBox, hex, mk, registerRedraw, sprite, text, toLocal } from './common/UIKit';
import { Assets } from '../core/Assets';

/** Size of a node square, distance between two columns / two rows, gap between two branches. */
const NODE = 44;
const COL = 64;
const ROW = 57;
const BRANCH_GAP = 40;
/** Space above the first row (branch names) and left of the first column (tier names). */
const HEAD = 26;
const GUTTER = 56;

interface TreeNode { id: string; t: any; x: number; y: number; g: Graphics; label: Label; level: Label; color: string; icon: Sprite | null; }

/** "#rrggbb" scaled by k (0 = black, 1 = same color). */
function shade(c: string, k: number): string {
    const v = parseInt(c.slice(1, 7), 16);
    const f = (x: number) => Math.max(0, Math.min(255, Math.round(x * k))).toString(16).padStart(2, '0');
    return '#' + f((v >> 16) & 255) + f((v >> 8) & 255) + f(v & 255);
}

/** Blend of two "#rrggbb" colors (t = 0: a, 1: b). */
function mix(a: string, b: string, t: number): string {
    const va = parseInt(a.slice(1, 7), 16), vb = parseInt(b.slice(1, 7), 16);
    const ch = (sh: number) => Math.round(((va >> sh) & 255) * (1 - t) + ((vb >> sh) & 255) * t).toString(16).padStart(2, '0');
    return '#' + ch(16) + ch(8) + ch(0);
}

/**
 * Research tree (prefabs/popups/Research). Tap a node: confirm window with its cost (or an info window when locked).
 * Branches side by side (research.json "branches"), tiers from top to bottom: tier N needs the
 * Research Lab Lv N, and a node needs its parent at max level. Lines between nodes light up in the
 * branch color once the parent is done. Drag to move around the tree, tap a node to see it below.
 * Node pictures are short texts for now (research.json "label").
 */
export class ResearchOverlay implements IOverlay {
    root: Node;
    private rm = ResourceMgr.inst;
    private nodes: TreeNode[] = [];
    private byId: { [id: string]: TreeNode } = {};
    private content: Node;
    private lines: Graphics;
    private tierLabels: Array<{ label: Label; y: number }> = [];
    private viewW: number;
    private viewH: number;
    private treeW = 0;
    private treeH = 0;
    private panX = 0;
    private panY = 0;
    private selected = '';
    private capLabel: Label;
    private unsubscribe: () => void;
    private tmp = new Vec3();

    constructor(parent: Node) {
        // Almost the whole screen; the top bar (resources) stays visible above it.
        const W = G.main.W - 24, H = G.main.H - 46;
        const v = PrefabUi.view('popups/Research', parent, ResearchView);
        this.root = v.node;
        v.resize(W, H);
        v.node.setPosition(0, -20, 0);
        v.setTitle('Research Tree');
        this.capLabel = v.capLabel!;
        new PrefabButton(v.closeButton, () => G.main.closeOverlay());

        // Tree viewport: everything between the title line and the Close button.
        const area = v.listArea!;
        const top = H / 2 - 80, bottom = -H / 2 + 66;
        this.viewW = W - 56;
        this.viewH = top - bottom;
        area.setPosition(0, (top + bottom) / 2, 0);
        PrefabUi.setSize(area, this.viewW, this.viewH);
        const frame = mk('TreeFrame', area, 0, 0, this.viewW, this.viewH);
        const fg = frame.addComponent(Graphics);
        drawBox(fg, this.viewW, this.viewH, '#15121d', COLORS.border);
        registerRedraw(frame, () => drawBox(fg, this.viewW, this.viewH, '#15121d', COLORS.border));
        const view = mk('View', area, 0, 0, this.viewW - 6, this.viewH - 6);
        view.addComponent(Mask);
        this.content = mk('Content', view, 0, 0, 0, 0, 0, 1);
        this.lines = mk('Lines', this.content).addComponent(Graphics);
        const gutter = mk('Tiers', view, -(this.viewW - 6) / 2, 0, GUTTER, this.viewH - 6, 0, 0.5);
        this.build(gutter);
        this.bindInput(view);

        this.unsubscribe = this.rm.onChange(() => this.refresh());
        // Start on the first technology that can be researched.
        const first = this.nodes.find(n => !this.rm.techBlock(n.id)) || this.nodes[0];
        if (first) { this.selected = first.id; this.centerOn(first); }
        this.refresh();
    }

    // ------------------------------------------------------------------ layout
    private build(gutter: Node) {
        const cfg = ConfigMgr.research;
        const techs: any[] = cfg.techs;
        const childrenOf: { [id: string]: any[] } = {};
        for (const t of techs) if (t.parent) (childrenOf[t.parent] = childrenOf[t.parent] || []).push(t);
        // Rows: a node one row below its parent when both are in the same tier.
        const depth: { [id: string]: number } = {};
        const depthOf = (t: any): number => {
            if (depth[t.id] !== undefined) return depth[t.id];
            const p = t.parent ? ConfigMgr.techDef(t.parent) : null;
            return (depth[t.id] = p && p.tier === t.tier ? depthOf(p) + 1 : 0);
        };
        // Tiers 1-3, then tier 4: the endless technologies, in a row of their own at the bottom.
        const lastTier = techs.reduce((m, t) => Math.max(m, t.tier), 3);
        const maxDepth: number[] = [], tierRow: number[] = [];
        for (let i = 0; i <= lastTier; i++) { maxDepth.push(0); tierRow.push(0); }
        for (const t of techs) maxDepth[t.tier] = Math.max(maxDepth[t.tier], depthOf(t));
        for (let tier = 2; tier <= lastTier; tier++) tierRow[tier] = tierRow[tier - 1] + maxDepth[tier - 1] + 1;
        const rows = tierRow[lastTier] + maxDepth[lastTier] + 1;
        const rowY = (r: number) => -(HEAD + ROW / 2 + r * ROW);

        // Columns: depth-first, a parent above its first child, leaves side by side.
        let x = GUTTER + 16;
        const colOf: { [id: string]: number } = {};
        for (const b of (cfg.branches || [])) {
            let col = 0;
            const place = (t: any): number => {
                const kids = childrenOf[t.id] || [];
                if (kids.length === 0) return (colOf[t.id] = col++);
                const first = place(kids[0]);
                for (let i = 1; i < kids.length; i++) place(kids[i]);
                return (colOf[t.id] = first);
            };
            const roots = techs.filter(t => t.branch === b.id && !t.parent);
            for (const r of roots) place(r);
            const left = x;
            for (const t of techs) if (t.branch === b.id) this.makeNode(t, left + COL / 2 + colOf[t.id] * COL, rowY(depthOf(t) + tierRow[t.tier]), b.color);
            const w = col * COL;
            text(this.content, b.name, 15, left + w / 2, -HEAD / 2, { bold: true, color: b.color });
            x += w + BRANCH_GAP;
        }
        this.treeW = x - BRANCH_GAP + 16;
        this.treeH = HEAD + rows * ROW + 8;

        // Tier bands: a dashed line between two tiers, the tier name in the fixed gutter on the left.
        for (let tier = 2; tier <= lastTier; tier++) this.separators.push(rowY(tierRow[tier]) + ROW / 2);
        const tiers: any[] = cfg.tiers || [];
        for (let tier = 1; tier <= lastTier; tier++) {
            const r0 = tierRow[tier], r1 = tierRow[tier] + maxDepth[tier];
            const y = (rowY(r0) + rowY(r1)) / 2;
            const def = tiers.find(t => t.tier === tier) || { labLevel: Math.min(3, tier) };
            const l = text(gutter, `${def.short || 'T' + tier}\nLab ${def.labLevel}`, 12, GUTTER / 2, 0, { bold: true, color: COLORS.textDim });
            this.tierLabels.push({ label: l, y });
        }
        const bg = gutter.addComponent(Graphics);
        bg.fillColor = hex('#15121d');
        bg.rect(0, -(this.viewH - 6) / 2, GUTTER, this.viewH - 6);
        bg.fill();
        bg.fillColor = hex(COLORS.border, 120);
        bg.rect(GUTTER - 2, -(this.viewH - 6) / 2, 2, this.viewH - 6);
        bg.fill();
    }

    private makeNode(t: any, x: number, y: number, color: string) {
        const n = mk('Tech_' + t.id, this.content, x, y, NODE, NODE);
        const g = n.addComponent(Graphics);
        // Picture: the node icon (research.json "icon"), or a short text for now ("label").
        const size = ConfigMgr.research.iconSize || 96;
        const frames = t.icon ? Assets.frames(t.icon, size, size) : [];
        const icon = frames.length ? sprite(n, frames[0], NODE - 6, NODE - 6) : null;
        const label = text(n, t.label || t.name.slice(0, 5), 11, 0, 7, { bold: true });
        label.node.active = !icon;
        // Level on a dark strip at the bottom of the square.
        const strip = mk('LevelStrip', n, 0, -NODE / 2 + 7, NODE - 4, 12).addComponent(Graphics);
        strip.fillColor = hex('#000000', 150);
        strip.rect(-(NODE - 4) / 2, -6, NODE - 4, 12);
        strip.fill();
        const level = text(n, '', 10, 0, -NODE / 2 + 7, { color: COLORS.textDim, bold: true });
        const node: TreeNode = { id: t.id, t, x, y, g, label, level, color, icon };
        registerRedraw(n, () => this.drawNode(node));
        this.nodes.push(node);
        this.byId[t.id] = node;
    }

    // ------------------------------------------------------------------ drawing
    private state(id: string): 'max' | 'open' | 'locked' {
        const t = ConfigMgr.techDef(id);
        const lv = this.rm.techLevel(id);
        if (t.maxLevel && lv >= t.maxLevel) return 'max';
        return this.rm.techLock(id) ? 'locked' : 'open';
    }

    private drawNode(n: TreeNode) {
        const st = this.state(n.id);
        const g = n.g;
        g.clear();
        // Background: bands from a dark shade at the top to the branch color at the bottom (like the hero
        // card backgrounds). Finished nodes are brightest, open ones a little darker, locked ones grey.
        const base = st === 'locked' ? '#4a4656' : st === 'open' ? shade(n.color, 0.75) : n.color;
        const top = shade(base, 0.22);
        const BANDS = 11, bh = NODE / BANDS;
        for (let i = 0; i < BANDS; i++) {
            g.fillColor = hex(mix(top, base, i / (BANDS - 1)));
            g.rect(-NODE / 2, NODE / 2 - (i + 1) * bh, NODE, bh + 0.5);
            g.fill();
        }
        // Frame: the branch color, darker (white when selected).
        g.lineWidth = n.id === this.selected ? 4 : 3;
        g.strokeColor = hex(n.id === this.selected ? '#ffffff' : st === 'locked' ? '#2e2b36' : shade(n.color, 0.5));
        g.rect(-NODE / 2, -NODE / 2, NODE, NODE);
        g.stroke();
        if (n.icon) n.icon.color = st === 'locked' ? new Color(110, 110, 120, 255) : Color.WHITE;
        n.label.color = hex(st === 'locked' ? '#8a8598' : '#ffffff');
        const lv = this.rm.techLevel(n.id);
        n.level.string = n.t.maxLevel ? `${lv}/${n.t.maxLevel}` : `${lv}`;
        n.level.color = hex(st === 'max' ? '#ffe08a' : st === 'locked' ? '#8a8598' : '#ffffff');
    }

    private drawLines() {
        const g = this.lines;
        // Tier separators were drawn once in build(); the connections are drawn on top of them.
        for (const n of this.nodes) {
            if (!n.t.parent) continue;
            const p = this.byId[n.t.parent];
            if (!p) continue;
            const done = this.rm.techLevel(p.id) >= p.t.maxLevel;
            g.lineWidth = done ? 4 : 2;
            g.strokeColor = hex(done ? n.color : '#5a5468');
            g.moveTo(p.x, p.y - NODE / 2);
            if (p.x === n.x) g.lineTo(n.x, n.y + NODE / 2);
            else {
                // Down from the parent, across just above the child's row, then down into the child.
                const midY = n.y + NODE / 2 + 9;
                g.lineTo(p.x, midY);
                g.lineTo(n.x, midY);
                g.lineTo(n.x, n.y + NODE / 2);
            }
            g.stroke();
        }
    }

    private refresh() {
        const lab = this.rm.labLevel;
        this.capLabel.string = lab === 0
            ? 'Build a Research Lab to unlock research.'
            : `Research Lab Lv ${lab}: tiers 1-${Math.min(3, lab)} open.` + (lab < 3 ? ' Upgrade the Lab to open the next tier.' : '') + '   Drag to move around the tree, tap a technology.';
        // Lines: redraw everything (tier separators included) so lit connections follow the progress.
        this.lines.clear();
        this.redrawSeparators();
        this.drawLines();
        for (const n of this.nodes) this.drawNode(n);
    }

    private separators: number[] = [];
    private redrawSeparators() {
        const g = this.lines;
        g.lineWidth = 1;
        g.strokeColor = hex('#ffffff', 40);
        for (const y of this.separators) for (let sx = 0; sx < this.treeW; sx += 16) { g.moveTo(sx, y); g.lineTo(sx + 8, y); }
        g.stroke();
    }

    // ------------------------------------------------------------------ selection
    /**
     * Tap on a node: it is highlighted and a window tells what it does. A technology that can be researched
     * opens a confirm window with its cost (like an upgrade); a locked or finished one an info window.
     */
    private select(id: string) {
        this.selected = id;
        for (const n of this.nodes) this.drawNode(n);
        const t = ConfigMgr.techDef(id);
        if (!t) return;
        const rm = this.rm;
        const lv = rm.techLevel(id);
        const endless = ResourceMgr.isEndless(t);
        const info = ConfigMgr.buffInfo(t.buffKey);
        const branch = ((ConfigMgr.research.branches || []) as any[]).find(b => b.id === t.branch);
        const where = `${branch ? branch.name : t.branch}, ${t.tier > 3 ? 'endless' : 'tier ' + t.tier}`;
        const shown = Math.round(t.valuePerLevel * lv * 100) / 100;
        const cap = rm.techCap(id);
        const capText = !endless && cap < t.maxLevel && cap > 0 ? ` (Lab limit ${cap})` : '';
        const level = (endless ? `Level ${lv} (endless)` : `Level ${lv}/${t.maxLevel}${capText}`) + (t.maxLevel === 1 || lv === 0 ? '' : `   now +${shown}${info.unit}`);
        const block = rm.techBlock(id);
        if (block) {
            infoWindow(this.root, t.name, [`(${where})`, t.description, '', level, block]);
            return;
        }
        confirm(this.root, t.name, `${t.description}\n${level}`, () => this.research(id), 'Research', 'Cancel', { label: 'Cost:', cost: rm.techCost(id) });
    }

    private research(id: string) {
        if (!id) return;
        const err = this.rm.doResearch(id);
        if (err) toast(this.root, err);
        else { toast(this.root, 'Research complete', true); G.main.playSfx('upgrade'); }
    }

    // ------------------------------------------------------------------ moving around
    private bindInput(view: Node) {
        let moved = 0;
        view.on(Node.EventType.TOUCH_START, (e: EventTouch) => { e.propagationStopped = true; moved = 0; }, this);
        view.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => {
            e.propagationStopped = true;
            const d = e.getUIDelta();
            moved += Math.abs(d.x) + Math.abs(d.y);
            this.panTo(this.panX - d.x, this.panY + d.y);
        }, this);
        view.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
            e.propagationStopped = true;
            if (moved > 8) return;
            const p = e.getUILocation();
            toLocal(this.content, p.x, p.y, this.tmp);
            const hit = this.nodes.find(n => Math.abs(this.tmp.x - n.x) <= NODE / 2 + 4 && Math.abs(this.tmp.y - n.y) <= NODE / 2 + 4);
            if (hit) this.select(hit.id);
        }, this);
        view.on(Node.EventType.MOUSE_WHEEL, (e: EventMouse) => this.panTo(this.panX - e.getScrollY() * 0.5, this.panY), this);
        this.panTo(0, 0);
    }

    /** Scroll position: panX / panY = part of the tree hidden on the left / at the top. */
    private panTo(x: number, y: number) {
        const vw = this.viewW - 6, vh = this.viewH - 6;
        this.panX = Math.max(0, Math.min(Math.max(0, this.treeW - vw), x));
        this.panY = Math.max(0, Math.min(Math.max(0, this.treeH - vh), y));
        this.content.setPosition(-vw / 2 - this.panX, vh / 2 + this.panY, 0);
        for (const t of this.tierLabels) t.label.node.setPosition(GUTTER / 2, vh / 2 + this.panY + t.y, 0);
    }

    private centerOn(n: TreeNode) {
        const vw = this.viewW - 6;
        this.panTo(n.x - vw / 2, -n.y - (this.viewH - 6) / 2);
    }

    destroy() { this.unsubscribe(); this.root.destroy(); }
}
