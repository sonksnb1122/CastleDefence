import { ConfigMgr } from '../ConfigMgr';
import { BuffEntry, Cost } from '../GameTypes';
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

    /** Stars of a hero: its card stars plus the promotions. */
    stars(id: string): number {
        const def = ConfigMgr.heroDef(id);
        return (def ? def.stars : 0) + ((this.rm.data.heroStars && this.rm.data.heroStars[id]) || 0);
    }

    /** Research "Ascension" (tier 3) allows promotions. */
    get promoteUnlocked(): boolean { return this.rm.buff('heroStarUnlock') > 0; }

    /** Cost of the promotion to 5 stars (heroes.json "promotion", by current stars), or null at 5 stars. */
    promoteCost(id: string): Cost | null {
        const s = this.stars(id);
        if (s >= 5) return null;
        const c = (ConfigMgr.heroes.promotion || {})[String(s)];
        return c ? Object.assign({}, c) : null;
    }

    /** Why a hero cannot be promoted now (cost aside), or null. */
    promoteBlock(id: string): string | null {
        if (!this.owns(id)) return 'Hero not recruited';
        if (this.stars(id) >= 5) return 'Already 5 stars';
        if (!this.promoteUnlocked) return 'Research "Ascension" first (Research Lab Lv 3)';
        if (!this.promoteCost(id)) return 'No promotion cost in heroes.json';
        return null;
    }

    /**
     * Promotion straight to 5 stars: one new random buff (not owned by the hero yet) per star gained,
     * so a 3-star hero gets 2 buffs and a 4-star hero 1. Returns the new buffs, or an error.
     */
    promote(id: string): { buffs?: BuffEntry[]; error?: string } {
        const rm = this.rm;
        if (!rm.isPreparation) return { error: 'Cannot promote during combat' };
        const block = this.promoteBlock(id);
        if (block) return { error: block };
        const cost = this.promoteCost(id)!;
        if (!rm.canAfford(cost)) return { error: 'Not enough resources' };
        const gain = 5 - this.stars(id);
        const rolls = (rm.data.heroRolls[id] || []).slice();
        const buffs: BuffEntry[] = [];
        for (let i = 0; i < gain; i++) {
            const all: any[] = ConfigMgr.herobuff.buffs;
            const pool = all.filter(b => !rolls.some(r => r.key === b.key));
            const b = pool.length ? pool[Math.floor(Math.random() * pool.length)] : all[Math.floor(Math.random() * all.length)];
            const buff: BuffEntry = { key: b.key, value: b.min + Math.floor(Math.random() * (b.max - b.min + 1)) };
            rolls.push(buff);
            buffs.push(buff);
        }
        rm.wall.keepGain(() => {
            rm.data.heroRolls[id] = rolls;
            if (!rm.data.heroStars) rm.data.heroStars = {};
            rm.data.heroStars[id] = (rm.data.heroStars[id] || 0) + gain;
            rm.buffs.invalidate();
        });
        rm.spend(cost);
        return { buffs };
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
