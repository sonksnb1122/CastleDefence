import { Node, Label } from 'cc';
import { ConfigMgr } from '../core/ConfigMgr';
import { G } from '../core/Globals';
import { ResourceMgr } from '../core/ResourceMgr';
import { ResearchRowView } from './items/ResearchRowView';
import { SaveSlotView } from './items/SaveSlotView';
import { PauseView } from './popups/PauseView';
import { ResearchView } from './popups/ResearchView';
import { SaveLoadView } from './popups/SaveLoadView';
import { SettingsView } from './popups/SettingsView';
import { FillBar, PrefabButton, PrefabUi } from './common/PrefabUi';
import { confirm, toast } from './common/Popups';
import { COLORS, ScrollList, costRow, text } from './common/UIKit';

/** Overlays are small windows drawn above the current screen. They pause the game while open. */
export interface IOverlay { root: Node; destroy(): void; }

/** Pause menu (prefabs/popups/Pause): Resume, Save Game, Load Game, Setting, Go To Main Menu, Quit Game. */
export class PauseOverlay implements IOverlay {
    root: Node;
    constructor(parent: Node) {
        const canSave = ResourceMgr.inst.isPreparation;
        const v = PrefabUi.view('popups/Pause', parent, PauseView);
        this.root = v.node;
        new PrefabButton(v.resumeButton, () => G.main.closeOverlay());
        new PrefabButton(v.saveButton, () => G.main.openOverlay('save')).setEnabled(canSave);
        new PrefabButton(v.loadButton, () => G.main.openOverlay('load'));
        new PrefabButton(v.settingsButton, () => G.main.openOverlay('settings'));
        new PrefabButton(v.menuButton, () => confirm(this.root, 'Main Menu', 'Return to the main menu?\nUnsaved progress of the current wave is lost.', () => G.main.goto('menu')));
        new PrefabButton(v.quitButton, () => confirm(this.root, 'Quit Game', 'Quit the game?', () => G.main.quitGame()));
        if (v.saveHint) v.saveHint.node.active = !canSave;
    }
    destroy() { this.root.destroy(); }
}

/** Audio settings (prefabs/popups/Settings): music and sound effect volume. */
export class SettingsOverlay implements IOverlay {
    root: Node;
    constructor(parent: Node) {
        const v = PrefabUi.view('popups/Settings', parent, SettingsView);
        this.root = v.node;
        const row = (barNode: Node | null, value: Label | null, minus: Node | null, plus: Node | null, get: () => number, set: (x: number) => void) => {
            const bar = new FillBar(barNode, COLORS.accent);
            const refresh = () => { bar.set(get()); if (value) value.string = Math.round(get() * 100) + '%'; };
            new PrefabButton(minus, () => { set(Math.max(0, Math.round((get() - 0.1) * 10) / 10)); refresh(); });
            new PrefabButton(plus, () => { set(Math.min(1, Math.round((get() + 0.1) * 10) / 10)); refresh(); });
            refresh();
        };
        row(v.musicBar, v.musicValue, v.musicMinus, v.musicPlus, () => G.main.musicVolume, x => G.main.setVolumes(x, G.main.sfxVolume));
        row(v.sfxBar, v.sfxValue, v.sfxMinus, v.sfxPlus, () => G.main.sfxVolume, x => { G.main.setVolumes(G.main.musicVolume, x); G.main.playSfx('click'); });
        new PrefabButton(v.closeButton, () => G.main.closeOverlay());
    }
    destroy() { this.root.destroy(); }
}

/** Slot list used both for loading and for saving (prefabs/popups/SaveLoad). Slot 0 is the autosave. */
export class SaveLoadOverlay implements IOverlay {
    root: Node;
    private view: SaveLoadView;
    constructor(parent: Node, private mode: 'load' | 'save') {
        this.view = PrefabUi.view('popups/SaveLoad', parent, SaveLoadView);
        this.root = this.view.node;
        this.view.setTitle(mode === 'load' ? 'Load Game' : 'Save Game');
        new PrefabButton(this.view.backButton, () => G.main.closeOverlay());
        this.rebuild();
    }

    private rebuild() {
        const rows = this.view.rows!;
        rows.destroyAllChildren();
        const first = this.mode === 'load' ? 0 : 1;
        for (let slot = first; slot <= 3; slot++) {
            const y = 115 - (slot - first) * 68 - (this.mode === 'save' ? 30 : 0);
            const info = G.main.slotInfo(slot);
            const r = PrefabUi.view('items/SaveSlot', rows, SaveSlotView);
            r.node.setPosition(0, y, 0);
            const name = slot === 0 ? 'Autosave' : 'Slot ' + slot;
            let desc = 'Empty';
            if (info.exists) desc = info.valid ? `Wave ${info.wave}  -  ${new Date(info.savedAt).toLocaleString()}` : 'Corrupted save';
            r.slotName!.string = name;
            r.desc!.string = desc;
            const action = new PrefabButton(r.actionButton);
            if (this.mode === 'load') {
                action.setText('Load');
                action.onClick(() => this.load(slot));
                action.setEnabled(info.exists && info.valid);
            } else {
                action.setText(info.exists ? 'Overwrite' : 'Save');
                action.onClick(() => this.save(slot, info.exists));
            }
            const del = new PrefabButton(r.deleteButton, () => confirm(this.root, 'Delete Save', `Delete ${name}?`, () => { G.main.deleteSlot(slot); this.rebuild(); }));
            del.setVisible(slot > 0 && info.exists);
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

/** Technology list of the Research Lab (prefabs/popups/Research, data from research.json). */
export class ResearchOverlay implements IOverlay {
    root: Node;
    private rows: Array<{ id: string; level: Label; cost: Node; btn: PrefabButton }> = [];
    private capLabel: Label;
    private unsubscribe: () => void;
    constructor(parent: Node) {
        // Shorter than the screen so the header scroll stays below the top bar.
        const W = Math.min(900, G.main.W - 60), H = G.main.H - 150;
        const v = PrefabUi.view('popups/Research', parent, ResearchView);
        this.root = v.node;
        v.resize(W, H);
        this.capLabel = v.capLabel!;
        const area = PrefabUi.size(v.listArea!);
        const list = new ScrollList(v.listArea!, 0, 0, area.width, area.height);
        const rowH = 62;
        const techs: any[] = ConfigMgr.research.techs;
        techs.forEach((t, i) => {
            const r = PrefabUi.view('items/ResearchRow', list.content, ResearchRowView);
            r.node.setPosition(0, -rowH / 2 - 4 - i * rowH, 0);
            PrefabUi.setSize(r.node, W - 60, rowH - 6);
            PrefabUi.align(r.node);
            r.techName!.string = t.name;
            r.desc!.string = t.description;
            const btn = new PrefabButton(r.researchButton, () => this.research(t.id));
            this.rows.push({ id: t.id, level: r.level!, cost: r.cost!, btn });
        });
        list.setContentHeight(techs.length * rowH + 8);
        new PrefabButton(v.closeButton, () => G.main.closeOverlay());
        this.unsubscribe = ResourceMgr.inst.onChange(() => this.refresh());
        this.refresh();
    }

    private refresh() {
        const rm = ResourceMgr.inst;
        const cap = rm.maxTechLevel;
        const lab = rm.labLevel;
        this.capLabel.string = lab === 0
            ? 'Build a Research Lab to unlock research.'
            : `Research Lab Lv ${lab}: technologies up to level ${cap}. Upgrade the Lab to raise the limit.`;
        for (const r of this.rows) {
            const t = ConfigMgr.techDef(r.id);
            const lv = rm.techLevel(r.id);
            const endless = ResourceMgr.isEndless(t);
            const bonus = `(+${t.valuePerLevel * lv}${ConfigMgr.buffInfo(t.buffKey).unit})`;
            r.level.string = endless ? `Lv ${lv} (endless)   ${bonus}` : `Lv ${lv}/${Math.min(t.maxLevel, cap)}   ${bonus}`;
            r.cost.destroyAllChildren();
            const lock = rm.techLock(r.id);
            if (lock) { text(r.cost, lock, 13, 0, 0, { ax: 0, color: COLORS.textDim }); r.btn.setEnabled(false); continue; }
            if (!endless && lv >= t.maxLevel) { text(r.cost, 'Max level', 13, 0, 0, { ax: 0 }); r.btn.setEnabled(false); continue; }
            const cost = rm.techCost(r.id);
            costRow(r.cost, cost, 0, 0, { size: 18, fontSize: 13 });
            r.btn.setEnabled(!rm.techBlock(r.id) && rm.canAfford(cost) && rm.isPreparation);
        }
    }

    private research(id: string) {
        const err = ResourceMgr.inst.doResearch(id);
        if (err) toast(this.root, err);
        else { toast(this.root, 'Research complete', true); G.main.playSfx('upgrade'); }
    }
    destroy() { this.unsubscribe(); this.root.destroy(); }
}
