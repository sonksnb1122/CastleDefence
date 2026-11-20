import { Node, Label, EventTouch } from 'cc';
import { ConfigMgr } from '../core/ConfigMgr';
import { ResourceMgr } from '../core/ResourceMgr';
import { WaveMgr } from '../combat/WaveMgr';
import { Bar, COLORS, hex, mk, panel, setVisible, text } from './UIKit';

const W = 300, H = 74, H_SMALL = 24;

/**
 * Small tab in the top left corner: how much enemy defense reduction
 * (Armor / Spell Piercing research + heroes) the next wave needs, compared
 * with what the player has. Enemy defense starts growing at wave 10, so this
 * keeps an easy-to-miss research visible.
 *
 * Needed reduction = 2 x highest enemy def - waves.json defenseGrowth.targetEffective
 * (the damage formula counts defense twice, see CombatManager.defenseMultiplier).
 */
export class DefTab {
    node: Node;
    private title: Label;
    private rows: Array<{ bar: Bar; value: Label }> = [];
    private footer: Label;
    private unsubscribe: () => void;
    private big: Node;
    private small: Node;
    private toggleLabel: Label;
    private left = 0;
    private top = 0;
    /** Shared by every screen, so the tab stays the way the player left it. */
    private static collapsed = false;

    /** (x, y) is the top left corner of the tab. */
    constructor(parent: Node, x: number, y: number) {
        this.node = mk('DefTab', parent);
        // Expanded tab: title, one bar per damage type and a hint line.
        this.big = mk('Expanded', this.node);
        this.blockTaps(panel(this.big, 0, 0, W, H, '#1b1626', null, 190));
        this.title = text(this.big, '', 13, -W / 2 + 10, H / 2 - 12, { ax: 0, bold: true, color: COLORS.accent });
        ['Physic', 'Magic'].forEach((name, i) => {
            const y0 = H / 2 - 31 - i * 17;
            text(this.big, name, 12, -W / 2 + 10, y0, { ax: 0, color: COLORS.textDim });
            const bar = new Bar(this.big, -W / 2 + 120, y0, 120, 8, COLORS.good);
            const value = text(this.big, '', 12, W / 2 - 10, y0, { ax: 1, bold: true });
            this.rows.push({ bar, value });
        });
        this.footer = text(this.big, '', 11, -W / 2 + 10, -H / 2 + 9, { ax: 0, color: COLORS.textDim });
        // Collapsed tab: one line with both values.
        this.small = mk('Collapsed', this.node);
        this.blockTaps(panel(this.small, 0, 0, W, H_SMALL, '#1b1626', null, 190));
        this.smallLabel = text(this.small, '', 12, -W / 2 + 10, 0, { ax: 0, bold: true });
        // Expand / collapse button in the top right corner of the tab.
        const btn = panel(this.node, 0, 0, 20, 18, '#3a3350', '#11101a', 230);
        this.toggleBtn = btn;
        this.toggleLabel = text(btn, '', 14, 0, 1, { bold: true, color: COLORS.accent });
        btn.on(Node.EventType.TOUCH_START, (e: EventTouch) => { e.propagationStopped = true; }, btn);
        btn.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
            e.propagationStopped = true;
            DefTab.collapsed = !DefTab.collapsed;
            this.applyState();
        }, btn);
        this.setTopLeft(x, y);
        this.unsubscribe = ResourceMgr.inst.onChange(() => this.refresh());
        this.refresh();
    }

    private smallLabel: Label;
    private toggleBtn: Node;

    private blockTaps(n: Node) {
        // The tab blocks taps so the map / battlefield below does not react.
        n.on(Node.EventType.TOUCH_START, (e: EventTouch) => { e.propagationStopped = true; }, n);
        n.on(Node.EventType.TOUCH_END, (e: EventTouch) => { e.propagationStopped = true; }, n);
    }

    /** Show the expanded or collapsed version, keeping the top left corner in place. */
    private applyState() {
        const c = DefTab.collapsed;
        const h = c ? H_SMALL : H;
        setVisible(this.big, !c);
        setVisible(this.small, c);
        this.node.setPosition(this.left + W / 2, this.top - h / 2, 0);
        this.toggleBtn.setPosition(W / 2 - 13, h / 2 - 11, 0);
        this.toggleLabel.string = c ? '+' : '-';
    }

    /** Move the tab so its top left corner is at (x, y). */
    setTopLeft(x: number, y: number) { this.left = x; this.top = y; this.applyState(); }

    /** Reduction needed against a defense value (never negative). */
    static needed(def: number): number {
        const g = ConfigMgr.waves.defenseGrowth || {};
        return Math.max(0, def * 2 - (g.targetEffective || 40));
    }

    refresh() {
        const rm = ResourceMgr.inst;
        if (!rm.data) return;
        const wave = rm.data.currentWave;
        const d = WaveMgr.defense(wave);
        this.title.string = `Enemy armor - Wave ${wave}` + (d.hasBoss ? `  (Boss DEF ${Math.max(d.bossPhysic, d.bossMagic)})` : '');
        const have = [rm.buff('enemyPhysicDefReduce'), rm.buff('enemyMagicDefReduce')];
        const need = [DefTab.needed(d.physic), DefTab.needed(d.magic)];
        let short = false;
        const colors: string[] = [];
        this.rows.forEach((r, i) => {
            const ok = have[i] >= need[i];
            if (!ok) short = true;
            const color = ok ? COLORS.good : have[i] >= need[i] - 10 ? '#f0a33c' : COLORS.bad;
            r.bar.set(need[i] <= 0 ? 1 : have[i] / need[i], color);
            r.value.string = `${have[i]} / ${need[i]}`;
            r.value.color = hex(color);
            colors.push(color);
        });
        // Collapsed line: colored by the worst of the two values.
        const worst = colors.indexOf(COLORS.bad) >= 0 ? COLORS.bad : colors.indexOf('#f0a33c') >= 0 ? '#f0a33c' : COLORS.good;
        this.smallLabel.string = `Armor W${wave}   Phy ${have[0]}/${need[0]}   Mag ${have[1]}/${need[1]}`;
        this.smallLabel.color = hex(worst);
        const next = WaveMgr.nextDefenseWave(wave);
        const cap = rm.maxTechLevel;
        const techMax = (ConfigMgr.techDef('r_pdef') || { maxLevel: 0 }).maxLevel;
        if (short && cap < techMax && rm.techLevel('r_pdef') >= cap && rm.techLevel('r_mdef') >= cap) this.footer.string = 'Research Lab limit reached: upgrade the Lab';
        else if (short) this.footer.string = 'Research Armor / Spell Piercing!';
        else this.footer.string = next ? `Enemy DEF rises at wave ${next}` : 'Enemy DEF is at its maximum';
    }

    destroy() {
        this.unsubscribe();
        this.node.destroy();
    }
}
