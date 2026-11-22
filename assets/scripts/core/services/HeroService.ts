import { ConfigMgr } from '../ConfigMgr';
import { Cost } from '../GameTypes';
import type { ResourceMgr } from '../ResourceMgr';

/** Hero recruitment (gacha): limits, price and the random pick. */
export class HeroService {
    constructor(private rm: ResourceMgr) {}

    owns(id: string): boolean { return this.rm.data.heroes.indexOf(id) >= 0; }

    /** Heroes that can be owned at the current Base level. */
    get limit(): number {
        const lv = ConfigMgr.buildingLevel('base', this.rm.baseLevel);
        return lv && typeof lv.heroLimit === 'number' ? lv.heroLimit : ConfigMgr.heroes.heroes.length;
    }

    /** Price of the next recruit: base cost plus a bit more for every hero already owned. */
    recruitCost(): Cost {
        const cfg = ConfigMgr.building;
        const base: Cost = cfg.recruitCost || {};
        const per: Cost = cfg.recruitCostPerHero || {};
        const n = this.rm.data.heroes.length;
        const out: Cost = {};
        for (const k in base) out[k] = Math.round(base[k] + (per[k] || 0) * n);
        for (const k in per) if (!(k in out)) out[k] = Math.round(per[k] * n);
        return out;
    }

    /** Pay the recruit cost and get a random hero not owned yet (weighted by stars). */
    recruit(): { heroId?: string; error?: string } {
        const rm = this.rm;
        if (!rm.isPreparation) return { error: 'Cannot recruit during combat' };
        const pool: any[] = ConfigMgr.heroes.heroes.filter((h: any) => !this.owns(h.id));
        if (pool.length === 0) return { error: 'All heroes are already recruited' };
        if (rm.data.heroes.length >= this.limit) return { error: `Hero limit reached (${this.limit}). Upgrade the Base` };
        const cost = this.recruitCost();
        if (!rm.canAfford(cost)) return { error: 'Not enough resources' };
        const weights = ConfigMgr.heroes.starWeights || {};
        let total = 0;
        for (const h of pool) total += weights[String(h.stars)] || 1;
        let roll = Math.random() * total;
        let picked = pool[pool.length - 1];
        for (const h of pool) {
            roll -= weights[String(h.stars)] || 1;
            if (roll <= 0) { picked = h; break; }
        }
        rm.wall.keepGain(() => {
            rm.data.heroes.push(picked.id);
            rm.buffs.invalidate();
        });
        rm.spend(cost);
        return { heroId: picked.id };
    }
}
