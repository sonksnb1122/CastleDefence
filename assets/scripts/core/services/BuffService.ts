import { ConfigMgr } from '../ConfigMgr';
import { BuffEntry } from '../GameTypes';
import type { ResourceMgr } from '../ResourceMgr';

/**
 * Totals of every buff coming from research and owned heroes.
 * All buffs are additive percentage points (or flat points for defense values).
 */
export class BuffService {
    private cache: { [key: string]: number } | null = null;

    constructor(private rm: ResourceMgr) {}

    /** Forget the totals (research / heroes changed). */
    invalidate() { this.cache = null; }

    /** Total buff for a key. `towerId` adds tower specific buffs (e.g. hero passives). */
    buff(key: string, towerId?: string): number {
        if (!this.cache) this.cache = this.build();
        let v = this.cache[key] || 0;
        if (towerId) v += this.cache[key + '@' + towerId] || 0;
        return v;
    }

    private build(): { [key: string]: number } {
        const out: { [key: string]: number } = {};
        const add = (e: BuffEntry) => {
            const k = e.towerId ? e.key + '@' + e.towerId : e.key;
            out[k] = (out[k] || 0) + e.value;
        };
        const d = this.rm.data;
        for (const t of ConfigMgr.research.techs) {
            const lv = d.research[t.id] || 0;
            if (lv <= 0) continue;
            add({ key: t.buffKey, value: t.valuePerLevel * lv, towerId: t.towerId });
            // "lvl:effect:<id>": levels of the chance technologies = the effect's level (EffectScaling).
            if (typeof t.buffKey === 'string' && t.buffKey.indexOf('effect:') === 0) out['lvl:' + t.buffKey] = (out['lvl:' + t.buffKey] || 0) + lv;
        }
        for (const id of d.heroes) {
            for (const e of this.heroBuffs(id)) add(e);
            // "passive:<id>" = 1 for every passive skill a hero learned (rules in CombatManager / EffectScaling).
            for (const sid of this.rm.skills.learned(id)) if (ConfigMgr.passiveDef(sid)) out['passive:' + sid] = 1;
        }
        return out;
    }

    /** Rolled buffs + configured passive buffs of one hero. */
    heroBuffs(heroId: string): BuffEntry[] {
        const def = ConfigMgr.heroDef(heroId);
        const list: BuffEntry[] = (this.rm.data.heroRolls[heroId] || []).slice();
        if (def && def.passive) for (const b of def.passive.buffs) list.push(b);
        // Passive skills the hero learned (skills.json "passives").
        for (const b of this.rm.skills.passiveBuffs(heroId)) list.push(b);
        return list;
    }

    /** Human readable list of every active buff (for the Base info panel). */
    activeBuffLines(fromHeroesOnly: boolean): string[] {
        const totals: { [k: string]: number } = {};
        const add = (e: BuffEntry) => {
            const k = e.towerId ? e.key + '@' + e.towerId : e.key;
            totals[k] = (totals[k] || 0) + e.value;
        };
        const d = this.rm.data;
        if (!fromHeroesOnly) {
            for (const t of ConfigMgr.research.techs) {
                const lv = d.research[t.id] || 0;
                if (lv > 0) add({ key: t.buffKey, value: t.valuePerLevel * lv });
            }
        }
        for (const id of d.heroes) for (const e of this.heroBuffs(id)) add(e);
        const lines: string[] = [];
        for (const k in totals) {
            const parts = k.split('@');
            const info = ConfigMgr.buffInfo(parts[0]);
            lines.push(`${info.name}${parts[1] ? ' (' + parts[1] + ')' : ''}: +${totals[k]}${info.unit}`);
        }
        return lines;
    }

    /** Random buffs of every hero (one per star), rolled once per game. */
    static rollAllHeroes(): { [id: string]: BuffEntry[] } {
        const out: { [id: string]: BuffEntry[] } = {};
        for (const h of ConfigMgr.heroes.heroes) {
            const pool: any[] = ConfigMgr.herobuff.buffs.slice();
            const picks: BuffEntry[] = [];
            for (let i = 0; i < h.stars && pool.length > 0; i++) {
                const b = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
                picks.push({ key: b.key, value: b.min + Math.floor(Math.random() * (b.max - b.min + 1)) });
            }
            out[h.id] = picks;
        }
        return out;
    }
}
