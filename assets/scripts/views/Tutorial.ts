import { Node, UITransform, sys, isValid, EventTouch } from 'cc';
import { ConfigMgr } from '../core/ConfigMgr';
import { G } from '../core/Globals';
import type { IOverlay } from './Overlays';
import { TutorialFrameView } from './items/TutorialFrameView';
import { TutorialsView } from './popups/TutorialsView';
import { templateButton } from './common/ButtonTemplate';
import { Popup, openPopup } from './common/PopupTemplate';
import { PrefabButton, PrefabUi } from './common/PrefabUi';
import { toast } from './common/Popups';
import { COLORS, ScrollList, text } from './common/UIKit';

/** Parts of a screen a tutorial step can point at (guide.json "target"), resolved when the step shows. */
export type TutorialTargets = { [key: string]: () => Node | null | undefined };

const STORE_KEY = 'castle_defense_tutorials';
const PAD = 6;
const POPUP_W = 440;

/**
 * Tutorials (config/guide.json): the first time the player opens a part of the game, notes pop up one after the
 * other. The part a note is about gets a red frame and the rest of the screen is dimmed; "Next" goes to the next
 * note, the last one ("Got it") gives the game back. The game is paused meanwhile (Main.update).
 * Which tutorials were seen is kept on this device (local storage), not in the save files.
 */
export class Tutorial {
    /** The tutorial on screen (null when none). */
    static active: Tutorial | null = null;
    /** Off for the automated tests and the progression bot. */
    static enabled = true;
    private static queue: Array<{ id: string; targets: TutorialTargets }> = [];
    private static seenIds: { [id: string]: boolean } | null = null;

    // ------------------------------------------------------------------ seen flags
    private static seen(): { [id: string]: boolean } {
        if (!Tutorial.seenIds) {
            Tutorial.seenIds = {};
            try {
                const raw = sys.localStorage.getItem(STORE_KEY);
                if (raw) Tutorial.seenIds = JSON.parse(raw) || {};
            } catch (e) { /* no storage: every tutorial shows once per run */ }
        }
        return Tutorial.seenIds!;
    }
    static isSeen(id: string): boolean { return !!Tutorial.seen()[id]; }
    private static markSeen(id: string) {
        Tutorial.seen()[id] = true;
        try { sys.localStorage.setItem(STORE_KEY, JSON.stringify(Tutorial.seenIds)); } catch (e) { /* ignore */ }
    }
    /** Every tutorial shows again the next time its part of the game opens. */
    static resetAll() {
        Tutorial.seenIds = {};
        try { sys.localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
    }

    static def(id: string): any {
        const list = (ConfigMgr.guide && ConfigMgr.guide.tutorials) || [];
        return list.find((t: any) => t.id === id) || null;
    }

    /** Show a tutorial the first time (queued behind the one on screen, if any). */
    static show(id: string, targets: TutorialTargets) {
        if (!Tutorial.enabled || Tutorial.isSeen(id) || !Tutorial.def(id)) return;
        if (Tutorial.queue.some(q => q.id === id) || (Tutorial.active && Tutorial.active.id === id)) return;
        Tutorial.queue.push({ id, targets });
        if (!Tutorial.active) Tutorial.next();
    }

    /** Remove the tutorial on screen and the queued ones (screen change). They show again next time. */
    static close() {
        Tutorial.queue.length = 0;
        if (Tutorial.active) Tutorial.active.destroy();
        Tutorial.active = null;
    }

    private static next() {
        const q = Tutorial.queue.shift();
        if (!q) return;
        const layer = G.main.topLayer;
        if (!layer || !isValid(layer)) return;
        Tutorial.active = new Tutorial(q.id, q.targets, layer);
    }

    // ------------------------------------------------------------------ one tutorial on screen
    private root: Node;
    private frame: TutorialFrameView;
    private popup: Popup | null = null;
    private steps: any[];
    private index = -1;

    private constructor(readonly id: string, private targets: TutorialTargets, layer: Node) {
        this.steps = Tutorial.def(id).steps || [];
        // prefabs/items/TutorialFrame: the dim and the red border; it takes every tap (the screen below stays still).
        this.frame = PrefabUi.view('items/TutorialFrame', layer, TutorialFrameView);
        this.root = this.frame.node;
        PrefabUi.blockTaps(this.root);
        this.root.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => { e.propagationStopped = true; }, this);
        this.step();
    }

    private destroy() { if (isValid(this.root)) this.root.destroy(); }

    /** Next step whose target is on screen (steps pointing at a hidden part are skipped). */
    private step() {
        if (this.popup) { this.popup.close(); this.popup = null; }
        let st: any = null, target: Node | null = null;
        while (++this.index < this.steps.length) {
            st = this.steps[this.index];
            if (!st.target) { target = null; break; }
            const fn = this.targets[st.target];
            const n = fn ? fn() : null;
            if (n && isValid(n) && n.activeInHierarchy) { target = n; break; }
        }
        if (this.index >= this.steps.length) { this.finish(); return; }
        const hole = target ? Tutorial.rectOf(target, this.root) : null;
        this.drawDim(hole);
        this.showPopup(st, hole);
    }

    private finish() {
        Tutorial.markSeen(this.id);
        this.destroy();
        Tutorial.active = null;
        Tutorial.next();
    }

    /** Size the four dark boxes around the framed part and its red border (no part: the whole screen is dimmed). */
    private drawDim(hole: { x: number; y: number; w: number; h: number } | null) {
        const f = this.frame, W = G.main.W, H = G.main.H, B = 3;
        const put = (n: Node | null, x0: number, y0: number, x1: number, y1: number) => {
            if (!n) return;
            const w = Math.max(0, x1 - x0), h = Math.max(0, y1 - y0);
            n.active = w > 0 && h > 0;
            PrefabUi.setSize(n, w, h);
            n.setPosition((x0 + x1) / 2, (y0 + y1) / 2, 0);
        };
        if (!hole) {
            put(f.dimTop, -W / 2, -H / 2, W / 2, H / 2);
            for (const n of [f.dimBottom, f.dimLeft, f.dimRight, f.borderTop, f.borderBottom, f.borderLeft, f.borderRight]) if (n) n.active = false;
            return;
        }
        const x0 = hole.x - hole.w / 2 - PAD, x1 = hole.x + hole.w / 2 + PAD;
        const y0 = hole.y - hole.h / 2 - PAD, y1 = hole.y + hole.h / 2 + PAD;
        put(f.dimTop, -W / 2, y1, W / 2, H / 2);
        put(f.dimBottom, -W / 2, -H / 2, W / 2, y0);
        put(f.dimLeft, -W / 2, y0, x0, y1);
        put(f.dimRight, x1, y0, W / 2, y1);
        put(f.borderTop, x0 - B, y1, x1 + B, y1 + B);
        put(f.borderBottom, x0 - B, y0 - B, x1 + B, y0);
        put(f.borderLeft, x0 - B, y0, x0, y1);
        put(f.borderRight, x1, y0, x1 + B, y1);
    }

    private showPopup(st: any, hole: { x: number; y: number; w: number; h: number } | null) {
        const shown = this.steps.length;
        // Height from the text length (about 46 characters per line at this width).
        const lines = String(st.text || '').split('\n').reduce((a, p) => a + Math.max(1, Math.ceil(p.length / 46)), 0);
        const h = Math.min(G.main.H - 40, 150 + lines * 24);
        const last = this.index >= shown - 1 || !this.steps.slice(this.index + 1).some(s => !s.target || this.targetVisible(s.target));
        // PopupTemplate without its veil (the frame already dims the screen).
        const v = openPopup(this.root, {
            title: st.title || '', body: st.text || '', width: POPUP_W, height: h, veil: false,
            buttons: [{ text: last ? 'Got it' : `Next (${this.index + 1}/${shown})`, width: 170, keepOpen: true, onClick: () => this.step() }],
        });
        this.popup = v;
        // Beside the framed part (below, above, right or left of it) when it fits on the screen; a big framed part
        // gets the note over its lower part.
        const W = G.main.W, H = G.main.H, gap = PAD + 14;
        let x = 0, y = 0;
        if (hole) {
            const cx = Math.max(-W / 2 + POPUP_W / 2 + 6, Math.min(W / 2 - POPUP_W / 2 - 6, hole.x));
            const below = hole.y - hole.h / 2 - gap - h / 2, above = hole.y + hole.h / 2 + gap + h / 2;
            const right = hole.x + hole.w / 2 + gap + POPUP_W / 2, left = hole.x - hole.w / 2 - gap - POPUP_W / 2;
            const cy = Math.max(-H / 2 + h / 2 + 6, Math.min(H / 2 - h / 2 - 6, hole.y));
            if (below - h / 2 >= -H / 2 + 6) { x = cx; y = below; }
            else if (above + h / 2 <= H / 2 - 6) { x = cx; y = above; }
            else if (right + POPUP_W / 2 <= W / 2 - 6) { x = right; y = cy; }
            else if (left - POPUP_W / 2 >= -W / 2 + 6) { x = left; y = cy; }
            else { x = cx; y = -H / 2 + h / 2 + 12; }
        }
        v.node.setPosition(x, Math.max(-H / 2 + h / 2 + 4, Math.min(H / 2 - h / 2 - 4, y)), 0);
    }

    private targetVisible(key: string): boolean {
        const fn = this.targets[key];
        const n = fn ? fn() : null;
        return !!n && isValid(n) && n.activeInHierarchy;
    }

    /** Bounding box of a node in the space of `host` (center x, y and size), through every parent's position and scale. */
    static rectOf(n: Node, host: Node): { x: number; y: number; w: number; h: number } {
        const ui = n.getComponent(UITransform);
        const w = ui ? ui.width : 0, h = ui ? ui.height : 0;
        const u: any = ui, ax = u ? (u.anchorX !== undefined ? u.anchorX : u.ax) : 0.5, ay = u ? (u.anchorY !== undefined ? u.anchorY : u.ay) : 0.5;
        const toRoot = (node: Node, x: number, y: number) => {
            let p: Node | null = node;
            while (p && p.parent) { x = p.position.x + x * p.scale.x; y = p.position.y + y * p.scale.y; p = p.parent; }
            return { x, y };
        };
        const a = toRoot(n, -w * ax, -h * ay), b = toRoot(n, w * (1 - ax), h * (1 - ay));
        const o = toRoot(host, 0, 0);
        return { x: (a.x + b.x) / 2 - o.x, y: (a.y + b.y) / 2 - o.y, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
    }
}

/** Tutorials window (prefabs/popups/Tutorials, from the main menu / pause menu): every tutorial of guide.json, and a reset. */
export class TutorialsOverlay implements IOverlay {
    root: Node;
    private list: ScrollList | null = null;
    private rows: Array<{ id: string; btn: PrefabButton; newMark: Node }> = [];

    constructor(parent: Node) {
        const v = PrefabUi.view('popups/Tutorials', parent, TutorialsView);
        this.root = v.node;
        const W = Math.min(PrefabUi.size(v.node).width, G.main.W - 30), H = Math.min(PrefabUi.size(v.node).height, G.main.H - 30);
        v.resize(W, H);
        new PrefabButton(v.closeButton, () => G.main.closeOverlay());
        new PrefabButton(v.resetButton, () => {
            Tutorial.resetAll();
            for (const r of this.rows) r.newMark.active = true;
            toast(this.root, 'The tutorials will show again in the game', true);
        });
        // Topic buttons (items/ButtonTemplate with a "NEW" mark) stacked from the top of TopicList.
        const tuts: any[] = (ConfigMgr.guide && ConfigMgr.guide.tutorials) || [];
        const area = PrefabUi.size(v.topicList!);
        tuts.forEach((t, i) => {
            const rh = 36;
            const btn = templateButton(v.topicList!, t.title, { width: 210, height: rh, fontSize: 16, color: COLORS.panelLight, onClick: () => this.select(t.id) });
            btn.node.setPosition(0, area.height / 2 - rh / 2 - i * (rh + 6), 0);
            if (btn.label) btn.label.node.setPosition(-12, 0, 0);
            const newMark = text(btn.node, 'NEW', 11, 74, 0, { bold: true, color: COLORS.accent }).node;
            newMark.active = !Tutorial.isSeen(t.id);
            this.rows.push({ id: t.id, btn, newMark });
        });
        // Notes of the chosen topic: a scroll list filling PageArea.
        const pa = PrefabUi.size(v.pageArea!);
        this.list = new ScrollList(v.pageArea!, 0, 0, pa.width, pa.height);
        if (tuts.length) this.select(tuts[0].id);
    }

    private select(id: string) {
        const t = Tutorial.def(id);
        if (!t || !this.list) return;
        for (const r of this.rows) r.btn.setColor(r.id === id ? COLORS.buttonAlt : COLORS.panelLight);
        this.list.clear();
        const w = this.list.w - 30;
        let y = -10;
        const put = (s: string, size: number, color: string, bold: boolean, gap: number) => {
            const l = text(this.list!.content, s, size, -w / 2, y, { ax: 0, ay: 1, width: w, color, bold });
            y -= PrefabUi.labelHeight(l) + gap;
        };
        put(t.title, 20, COLORS.accent, true, 10);
        for (const st of t.steps) {
            put(st.title, 16, COLORS.text, true, 3);
            put(st.text, 14, COLORS.textDim, false, 12);
        }
        this.list.setContentHeight(-y + 10);
    }

    destroy() { this.root.destroy(); }
}
