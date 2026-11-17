import { Node } from 'cc';
import { ConfigMgr } from '../core/ConfigMgr';
import { G } from '../core/Globals';
import { ResourceMgr } from '../core/ResourceMgr';
import { Cost } from '../core/GameTypes';
import { Bar, COLORS, ScrollList, UIButton, button, confirm, costRow, fancyModal, menuButton, message, mk, modal, panel, text, toast, uiIcon } from '../ui/UIKit';

/** Overlays are small windows drawn above the current screen. They pause the game while open. */
export interface IOverlay { root: Node; destroy(): void; }

/** Pause menu: Save Game, Load Game, Setting, Go To Main Menu, Quit Game. */
export class PauseOverlay implements IOverlay {
    root: Node;
    constructor(parent: Node) {
        const m = fancyModal(parent, 'Paused', 360, 470);
        this.root = m.root;
        const canSave = ResourceMgr.inst.isPreparation;
        const items: Array<[string, () => void, string, boolean]> = [
            ['Resume', () => G.main.closeOverlay(), COLORS.buttonOk, true],
            ['Save Game', () => G.main.openOverlay('save'), COLORS.button, canSave],
            ['Load Game', () => G.main.openOverlay('load'), COLORS.button, true],
            ['Setting', () => G.main.openOverlay('settings'), COLORS.button, true],
            ['Go To Main Menu', () => confirm(this.root, 'Main Menu', 'Return to the main menu?\nUnsaved progress of the current wave is lost.', () => G.main.goto('menu')), COLORS.buttonAlt, true],
            ['Quit Game', () => confirm(this.root, 'Quit Game', 'Quit the game?', () => G.main.quitGame()), COLORS.buttonDanger, true],
        ];
        items.forEach((it, i) => {
            const b = menuButton(m.box, it[0], 0, 132 - i * 58, 260, 46, it[1], it[2], 19);
            b.setEnabled(it[3]);
            if (it[0] === 'Resume') uiIcon(b.node, 'play', 32, -82, 0);   // play picture on the Resume button
        });
        if (!canSave) text(m.box, 'Saving is disabled during combat', 12, 0, -206, { color: COLORS.textDim });
    }
    destroy() { this.root.destroy(); }
}

/** Audio settings: music and sound effect volume. */
export class SettingsOverlay implements IOverlay {
    root: Node;
    constructor(parent: Node) {
        const m = modal(parent, 'Setting', 460, 300);
        this.root = m.root;
        const row = (name: string, y: number, get: () => number, set: (v: number) => void) => {
            text(m.box, name, 18, -200, y, { ax: 0 });
            const bar = new Bar(m.box, 40, y, 150, 14, COLORS.accent);
            const value = text(m.box, '', 16, 175, y, { ax: 0 });
            const refresh = () => { bar.set(get()); value.string = Math.round(get() * 100) + '%'; };
            menuButton(m.box, '-', -70, y, 36, 34, () => { set(Math.max(0, Math.round((get() - 0.1) * 10) / 10)); refresh(); }, COLORS.button, 22);
            menuButton(m.box, '+', 150, y, 36, 34, () => { set(Math.min(1, Math.round((get() + 0.1) * 10) / 10)); refresh(); }, COLORS.button, 22);
            refresh();
        };
        row('Music', 60, () => G.main.musicVolume, v => G.main.setVolumes(v, G.main.sfxVolume));
        row('Sound FX', 0, () => G.main.sfxVolume, v => { G.main.setVolumes(G.main.musicVolume, v); G.main.playSfx('click'); });
        menuButton(m.box, 'Close', 0, -105, 160, 44, () => G.main.closeOverlay());
    }
    destroy() { this.root.destroy(); }
}

/** Slot list used both for loading and for saving. Slot 0 is the autosave. */
export class SaveLoadOverlay implements IOverlay {
    root: Node;
    private box: Node;
    private rows: Node | null = null;
    constructor(parent: Node, private mode: 'load' | 'save') {
        const m = modal(parent, mode === 'load' ? 'Load Game' : 'Save Game', 560, 420);
        this.root = m.root;
        this.box = m.box;
        menuButton(m.box, 'Back', 0, -170, 160, 44, () => G.main.closeOverlay());
        this.rebuild();
    }

    private rebuild() {
        if (this.rows) this.rows.destroy();
        this.rows = mk('Rows', this.box);
        const first = this.mode === 'load' ? 0 : 1;
        for (let slot = first; slot <= 3; slot++) {
            const y = 115 - (slot - first) * 68 - (this.mode === 'save' ? 30 : 0);
            const info = G.main.slotInfo(slot);
            panel(this.rows, 0, y, 510, 58, COLORS.panelLight);
            const name = slot === 0 ? 'Autosave' : 'Slot ' + slot;
            let desc = 'Empty';
            if (info.exists) desc = info.valid ? `Wave ${info.wave}  -  ${new Date(info.savedAt).toLocaleString()}` : 'Corrupted save';
            text(this.rows, name, 18, -240, y + 10, { ax: 0, bold: true });
            text(this.rows, desc, 14, -240, y - 13, { ax: 0, color: COLORS.textDim });
            if (this.mode === 'load') {
                const b = menuButton(this.rows, 'Load', 150, y, 80, 38, () => this.load(slot), COLORS.buttonOk, 16);
                b.setEnabled(info.exists && info.valid);
            } else {
                menuButton(this.rows, info.exists ? 'Overwrite' : 'Save', 140, y, 100, 38, () => this.save(slot, info.exists), COLORS.buttonOk, 16);
            }
            if (slot > 0 && info.exists) {
                menuButton(this.rows, 'X', 225, y, 38, 38, () => confirm(this.root, 'Delete Save', `Delete ${name}?`, () => { G.main.deleteSlot(slot); this.rebuild(); }), COLORS.buttonDanger, 16);
            }
        }
    }

    private load(slot: number) {
        const err = G.main.loadFromSlot(slot);
        if (err) toast(this.root, err);
    }

    private save(slot: number, exists: boolean) {
        const run = () => {
            if (G.main.saveToSlot(slot)) { toast(this.root, 'Game saved', true); this.rebuild(); }
            else toast(this.root, 'Saving failed');
        };
        if (exists) confirm(this.root, 'Overwrite', `Overwrite Slot ${slot}?`, run);
        else run();
    }
    destroy() { this.root.destroy(); }
}

/** Technology list of the Research Lab (data from research.json). */
export class ResearchOverlay implements IOverlay {
    root: Node;
    private rows: Array<{ id: string; level: any; cost: any; btn: UIButton }> = [];
    private capLabel: any;
    private unsubscribe: () => void;
    constructor(parent: Node) {
        const W = Math.min(900, G.main.W - 60), H = G.main.H - 60;
        const m = modal(parent, 'Research', W, H);
        this.root = m.root;
        this.capLabel = text(m.box, '', 14, -W / 2 + 24, H / 2 - 62, { ax: 0, color: COLORS.textDim });
        const list = new ScrollList(m.box, 0, -8, W - 40, H - 150);
        const rowH = 62;
        const techs: any[] = ConfigMgr.research.techs;
        techs.forEach((t, i) => {
            const y = -rowH / 2 - 4 - i * rowH;
            panel(list.content, 0, y, W - 60, rowH - 6, COLORS.panelLight);
            text(list.content, t.name, 17, -W / 2 + 50, y + 13, { ax: 0, bold: true });
            text(list.content, t.description, 13, -W / 2 + 50, y - 11, { ax: 0, color: COLORS.textDim });
            const level = text(list.content, '', 15, 40, y + 13, { ax: 0, color: COLORS.accent });
            const cost = mk('Cost', list.content, 40, y - 11);
            const btn = button(list.content, 'Research', W / 2 - 110, y, 110, 38, () => this.research(t.id), COLORS.buttonOk, 15);
            this.rows.push({ id: t.id, level, cost, btn });
        });
        list.setContentHeight(techs.length * rowH + 8);
        button(m.box, 'Close', 0, -H / 2 + 34, 160, 42, () => G.main.closeOverlay());
        this.unsubscribe = ResourceMgr.inst.onChange(() => this.refresh());
        this.refresh();
    }

    private refresh() {
        const rm = ResourceMgr.inst;
        const cap = rm.maxTechLevel;
        this.capLabel.string = `Research Lab allows technology level ${cap}. Costs are reduced by hero buffs.`;
        for (const r of this.rows) {
            const t = ConfigMgr.techDef(r.id);
            const lv = rm.techLevel(r.id);
            r.level.string = `Lv ${lv}/${t.maxLevel}   (+${t.valuePerLevel * lv}${ConfigMgr.buffInfo(t.buffKey).unit})`;
            r.cost.destroyAllChildren();
            if (lv >= t.maxLevel) { text(r.cost, 'Max level', 13, 0, 0, { ax: 0 }); r.btn.setEnabled(false); continue; }
            const cost = rm.techCost(r.id);
            costRow(r.cost, cost, 0, 0, { size: 18, fontSize: 13 });
            r.btn.setEnabled(lv < cap && rm.canAfford(cost) && rm.isPreparation);
        }
    }

    private research(id: string) {
        const err = ResourceMgr.inst.doResearch(id);
        if (err) toast(this.root, err);
        else toast(this.root, 'Research complete', true);
    }
    destroy() { this.unsubscribe(); this.root.destroy(); }
}

/** A line of an info window: plain text, or a label followed by a cost / amount with resource icons. */
export type InfoLine = string | { label: string; cost: Cost };

/** Generic helper: info window listing lines. Long lists become scrollable. */
export function infoWindow(parent: Node, title: string, lines: InfoLine[]) {
    const W = 500, LINE = 22;
    // Estimate wrapped height (about 52 characters fit on one line).
    const rowsOf = (l: InfoLine) => (typeof l === 'string' ? Math.max(1, Math.ceil(l.length / 52)) : 1);
    let rows = 0;
    for (const l of lines) rows += rowsOf(l);
    const maxH = G.main.H - 60;
    const wanted = 130 + rows * LINE;
    const scroll = wanted > maxH;
    const H = scroll ? maxH : wanted;
    const m = modal(parent, title, W, H);
    let host: Node = m.box, left = -W / 2 + 25, y = H / 2 - 56;
    if (scroll) {
        const list = new ScrollList(m.box, 0, 8, W - 30, maxH - 130);
        list.setContentHeight(rows * LINE + 20);
        host = list.content; left = -(W - 60) / 2; y = -8;
    }
    // Consecutive text lines share one wrapped label; cost lines are drawn with icons.
    let pending: string[] = [];
    const flush = () => {
        if (pending.length === 0) return;
        let n = 0;
        for (const p of pending) n += rowsOf(p);
        text(host, pending.join('\n'), 17, left, y, { width: W - 60, ax: 0, ay: 1, align: 'left' });
        y -= n * LINE;
        pending = [];
    };
    for (const l of lines) {
        if (typeof l === 'string') { pending.push(l); continue; }
        flush();
        costRow(host, l.cost, left, y - LINE / 2, { label: l.label, size: 20, fontSize: 17 });
        y -= LINE;
    }
    flush();
    button(m.box, 'Close', 0, -H / 2 + 36, 150, 42, () => m.close());
}
