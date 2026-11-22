import { ConfigMgr } from '../ConfigMgr';
import { Cost } from '../GameTypes';
import type { ResourceMgr } from '../ResourceMgr';

/** Technologies of the Research Lab: limits, prerequisites, costs, researching. */
export class ResearchService {
    constructor(private rm: ResourceMgr) {}

    level(id: string): number { return this.rm.data.research[id] || 0; }

    /** Highest technology level allowed by the research buildings (0 = no lab). */
    get maxTechLevel(): number {
        let max = 0;
        for (const b of this.rm.data.buildings) {
            const lv = ConfigMgr.buildingLevel(b.id, b.level);
            if (lv && lv.maxTechLevel) max = Math.max(max, lv.maxTechLevel);
        }
        return max;
    }

    /** Level of the Research Lab (0 = none built). */
    get labLevel(): number {
        let lv = 0;
        for (const b of this.rm.data.buildings) if (b.id === 'research') lv = Math.max(lv, b.level);
        return lv;
    }

    /** Endless technologies have maxLevel 0. */
    static isEndless(t: any): boolean { return !t.maxLevel; }

    /** Why a technology cannot be researched at all yet (missing lab level / prerequisites), or null. */
    lock(id: string): string | null {
        const t = ConfigMgr.techDef(id);
        const req = t && t.requires;
        if (!req) return null;
        if (req.labLevel && this.labLevel < req.labLevel) return `Needs Research Lab Lv ${req.labLevel}`;
        for (const rid of (req.techsMaxed || [])) {
            const r = ConfigMgr.techDef(rid);
            if (r && this.level(rid) < r.maxLevel) return `Needs ${r.name} at max level`;
        }
        return null;
    }

    /**
     * Cost of the next level of a technology, research discount included.
     * `growthKeys` (optional) limits the cost growth to some resources; the others stay at the base cost.
     */
    cost(id: string): Cost {
        const t = ConfigMgr.techDef(id);
        const lv = this.level(id);
        const discount = Math.min(90, this.rm.buff('researchCostReduce'));
        const keys: string[] | null = Array.isArray(t.growthKeys) ? t.growthKeys : null;
        const out: Cost = {};
        for (const k in t.baseCost) {
            const growth = !keys || keys.indexOf(k) >= 0 ? Math.pow(t.costGrowth, lv) : 1;
            out[k] = Math.ceil(t.baseCost[k] * growth * (1 - discount / 100));
        }
        return out;
    }

    /** Why the next level of a technology cannot be researched (cost aside), or null. */
    block(id: string): string | null {
        const t = ConfigMgr.techDef(id);
        if (!t) return 'Unknown technology';
        const lock = this.lock(id);
        if (lock) return lock;
        const lv = this.level(id);
        if (ResearchService.isEndless(t)) return null;
        if (lv >= t.maxLevel) return 'Already at max level';
        if (lv >= this.maxTechLevel) return this.maxTechLevel === 0 ? 'Build a Research Lab first' : 'Upgrade the Research Lab first';
        return null;
    }

    research(id: string): string | null {
        const rm = this.rm;
        if (!rm.isPreparation) return 'Cannot research during combat';
        const block = this.block(id);
        if (block) return block;
        const lv = this.level(id);
        const cost = this.cost(id);
        if (!rm.canAfford(cost)) return 'Not enough resources';
        rm.wall.keepGain(() => {
            rm.data.research[id] = lv + 1;
            rm.buffs.invalidate();
        });
        // Smart Targeting switches every tower to the new mode (the player can still pick another one).
        if (ConfigMgr.techDef(id).buffKey === 'smartTarget') for (const t of rm.data.towers) t.targetMode = 'Smart';
        rm.spend(cost);
        return null;
    }
}
