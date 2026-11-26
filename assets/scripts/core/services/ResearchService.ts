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

    /** Research Lab level a technology tier needs (research.json "tiers"; tier N = Lab Lv N by default). */
    static tierLab(t: any): number {
        const tiers: any[] = (ConfigMgr.research && ConfigMgr.research.tiers) || [];
        const d = tiers.find(x => x.tier === t.tier);
        return d ? d.labLevel : (t.tier || 1);
    }

    /** True when a technology is at its max level (endless ones never are). */
    isMaxed(id: string): boolean {
        const t = ConfigMgr.techDef(id);
        return !!t && !ResearchService.isEndless(t) && this.level(id) >= t.maxLevel;
    }

    /**
     * Why a technology cannot be researched at all yet, or null. Research tree rules:
     *  - a tier needs its Research Lab level (tier 1 = Lv 1, tier 2 = Lv 2, tier 3 = Lv 3);
     *  - a node needs its parent node (previous node of the same branch) at max level.
     */
    lock(id: string): string | null {
        const t = ConfigMgr.techDef(id);
        if (!t) return 'Unknown technology';
        const lab = this.labLevel;
        if (lab === 0) return 'Build a Research Lab first';
        const need = ResearchService.tierLab(t);
        if (lab < need) return `Needs Research Lab Lv ${need}`;
        if (t.parent && !this.isMaxed(t.parent)) {
            const p = ConfigMgr.techDef(t.parent);
            return `Needs ${p ? p.name : t.parent} at max level`;
        }
        // "requires": other technologies that must be at max level too (not drawn in the tree).
        for (const r of (t.requires || [])) {
            if (this.isMaxed(r)) continue;
            const q = ConfigMgr.techDef(r);
            return `Needs ${q ? q.name : r} at max level`;
        }
        // "requiresAll" (Tower Awakening): every other finite technology at max level.
        if (t.requiresAll) {
            const left = this.missingForAll(id);
            if (left.length) return `Needs every technology above the awakening line at max level (${left.length} left)`;
        }
        return null;
    }

    /**
     * Technologies a "requiresAll" node still waits for: every finite technology that is not at max level,
     * except endless ones, the node itself, the nodes below it (its children need it first) and the
     * "afterAwakening" ones (drawn below it, e.g. Warding / Empowering / Mending Halo).
     */
    missingForAll(id: string): any[] {
        const below = (t: any): boolean => {
            for (let p = t; p && p.parent; p = ConfigMgr.techDef(p.parent)) if (p.parent === id) return true;
            return false;
        };
        return ConfigMgr.research.techs.filter((t: any) =>
            t.id !== id && !t.afterAwakening && !ResearchService.isEndless(t) && !below(t) && this.level(t.id) < t.maxLevel);
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
            // Energy Cores (special research) are never discounted.
            out[k] = Math.ceil(t.baseCost[k] * growth * (1 - (k === 'core' ? 0 : discount) / 100));
        }
        return out;
    }

    /**
     * Highest level the Research Lab allows for this technology:
     *  - "labCaps": one limit per Lab level (e.g. Armor Piercing 2 / 5 / 10);
     *  - "halfCap": half the levels until the Research Lab reaches Lv 3;
     *  - otherwise every level as soon as the tier is open.
     */
    capOf(t: any): number {
        const lab = this.labLevel;
        if (lab < ResearchService.tierLab(t)) return 0;
        const max = ResearchService.isEndless(t) ? Infinity : t.maxLevel;
        if (Array.isArray(t.labCaps) && t.labCaps.length) return Math.min(max, t.labCaps[Math.min(lab, t.labCaps.length) - 1]);
        if (t.halfCap && lab < 3) return Math.ceil(max / 2);
        return max;
    }
    capOfId(id: string): number { const t = ConfigMgr.techDef(id); return t ? this.capOf(t) : 0; }

    /** Why the next level of a technology cannot be researched (cost aside), or null. */
    block(id: string): string | null {
        const t = ConfigMgr.techDef(id);
        if (!t) return 'Unknown technology';
        const lock = this.lock(id);
        if (lock) return lock;
        const lv = this.level(id);
        if (ResearchService.isEndless(t)) return null;
        if (lv >= t.maxLevel) return 'Already at max level';
        if (lv >= this.capOf(t)) return t.halfCap ? 'Research Lab Lv 3 unlocks the other levels' : 'Upgrade the Research Lab first';
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
