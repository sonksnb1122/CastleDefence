import { Node, Label, EventTouch } from 'cc';
import { ConfigMgr } from '../../core/ConfigMgr';
import { ResourceMgr } from '../../core/ResourceMgr';
import { WaveMgr } from '../../combat/WaveMgr';
import { DefTabView } from '../items/DefTabView';
import { FillBar, PrefabUi } from './PrefabUi';
import { COLORS, hex } from './UIKit';

/**
 * Small tab in the top left corner (prefabs/items/DefTab): how much enemy defense
 * reduction (Armor / Spell Piercing research + heroes) the next wave needs, compared
 * with what the player has. Enemy defense starts growing at wave 10, so this
 * keeps an easy-to-miss research visible.
 *
 * Needed reduction = 2 x highest enemy def - waves.json defenseGrowth.targetEffective
 * (the damage formula counts defense twice, see CombatManager.defenseMultiplier).
 */
export class DefTab {
    node: Node;
    private view: DefTabView;
    private rows: Array<{ bar: FillBar; value: Label }> = [];
    private unsubscribe: () => void;
    private left = 0;
    private top = 0;
    /** Shared by every screen, so the tab stays the way the player left it. */
    private static collapsed = false;

    /** (x, y) is the top left corner of the tab. */
    constructor(parent: Node, x: number, y: number) {
        const v = this.view = PrefabUi.view('items/DefTab', parent, DefTabView);
        this.node = v.node;
        this.rows = [
            { bar: new FillBar(v.physicBar, COLORS.good), value: v.physicValue! },
            { bar: new FillBar(v.magicBar, COLORS.good), value: v.magicValue! },
        ];
        // The tab blocks taps so the map / battlefield below does not react.
        for (const n of [v.expanded, v.collapsed]) if (n) PrefabUi.blockTaps(n);
        const btn = v.toggle!;
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

    /** Show the expanded or collapsed version, keeping the top left corner in place. */
    private applyState() {
        const v = this.view, c = DefTab.collapsed;
        const big = PrefabUi.size(v.expanded!), small = PrefabUi.size(v.collapsed!);
        const w = big.width, h = c ? small.height : big.height;
        v.expanded!.active = !c;
        v.collapsed!.active = c;
        this.node.setPosition(this.left + w / 2, this.top - h / 2, 0);
        v.collapsed!.setPosition(0, 0, 0);
        v.toggle!.setPosition(w / 2 - 13, h / 2 - 11, 0);
        v.toggleLabel!.string = c ? '+' : '-';
    }

    /** Move the tab so its top left corner is at (x, y). */
    setTopLeft(x: number, y: number) { this.left = x; this.top = y; this.applyState(); }

    /** Reduction needed against a defense value (never negative). */
    static needed(def: number): number {
        const g = ConfigMgr.waves.defenseGrowth || {};
        return Math.max(0, def * 2 - (g.targetEffective || 40));
    }

    refresh() {
        const rm = ResourceMgr.inst, v = this.view;
        if (!rm.data) return;
        const wave = rm.data.currentWave;
        const d = WaveMgr.defense(wave);
        v.title!.string = `Enemy armor - Wave ${wave}` + (d.hasBoss ? `  (Boss DEF ${Math.max(d.bossPhysic, d.bossMagic)})` : '');
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
        v.smallLabel!.string = `Armor W${wave}   Phy ${have[0]}/${need[0]}   Mag ${have[1]}/${need[1]}`;
        v.smallLabel!.color = hex(worst);
        const next = WaveMgr.nextDefenseWave(wave);
        const cap = rm.maxTechLevel;
        const techMax = (ConfigMgr.techDef('r_pdef') || { maxLevel: 0 }).maxLevel;
        if (short && cap < techMax && rm.techLevel('r_pdef') >= cap && rm.techLevel('r_mdef') >= cap) v.footer!.string = 'Research Lab limit reached: upgrade the Lab';
        else if (short) v.footer!.string = 'Research Armor / Spell Piercing!';
        else v.footer!.string = next ? `Enemy DEF rises at wave ${next}` : 'Enemy DEF is at its maximum';
    }

    destroy() {
        this.unsubscribe();
        this.node.destroy();
    }
}
