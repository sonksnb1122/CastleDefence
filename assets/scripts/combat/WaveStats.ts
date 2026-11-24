/**
 * Statistics of one wave, collected by CombatManager and shown in the "Wave cleared" window:
 * damage per tower type, shots that hit, effects that were triggered and the damage they dealt.
 * Damage is counted as HP actually removed (overkill is not counted).
 */
export interface TowerStat {
    id: string;
    name: string;
    towers: number;
    damage: number;
    shots: number;
    /** Shots whose explosion damaged at least one enemy. */
    hits: number;
}

export interface EffectStat {
    key: string;
    name: string;
    /** Tower type the effect belongs to (for sorting), '' when unknown. */
    towerId: string;
    /** Times the effect landed (status applied, chain jumped, bonus damage dealt...); -1 = not counted. */
    triggers: number;
    /** Times the status was resisted by the enemy. */
    resisted: number;
    /** HP removed by the effect (0 for effects that deal no damage). */
    damage: number;
    /** True when the effect deals damage (the Damage column is filled). */
    dealsDamage: boolean;
}

export class WaveStats {
    wave = 0;
    /** Seconds the wave lasted. */
    time = 0;
    totalDamage = 0;
    kills = 0;
    towers: { [id: string]: TowerStat } = {};
    effects: { [key: string]: EffectStat } = {};

    reset(wave: number, towers: Array<{ id: string; name: string }>) {
        this.wave = wave;
        this.time = 0;
        this.totalDamage = 0;
        this.kills = 0;
        this.towers = {};
        this.effects = {};
        for (const t of towers) this.tower(t.id, t.name).towers++;
    }

    tower(id: string, name = id): TowerStat {
        return this.towers[id] || (this.towers[id] = { id, name, towers: 0, damage: 0, shots: 0, hits: 0 });
    }

    shot(towerId: string, hit: boolean) {
        const t = this.tower(towerId);
        t.shots++;
        if (hit) t.hits++;
    }

    damage(towerId: string, amount: number) {
        if (amount <= 0) return;
        this.tower(towerId).damage += amount;
        this.totalDamage += amount;
    }

    effect(key: string, name: string, towerId: string, dealsDamage = false): EffectStat {
        let s = this.effects[key];
        if (!s) s = this.effects[key] = { key, name, towerId, triggers: 0, resisted: 0, damage: 0, dealsDamage };
        if (dealsDamage) s.dealsDamage = true;
        return s;
    }

    trigger(key: string, name: string, towerId: string, dealsDamage = false) { this.effect(key, name, towerId, dealsDamage).triggers++; }

    resist(key: string, name: string, towerId: string) { this.effect(key, name, towerId).resisted++; }

    effectDamage(key: string, name: string, towerId: string, amount: number, counted = true) {
        if (amount <= 0) return;
        const s = this.effect(key, name, towerId, true);
        s.damage += amount;
        if (!counted && s.triggers === 0) s.triggers = -1;
    }

    /** Tower rows in display order (Crossbow, Crystal, Catapult, then any other). */
    towerList(order: string[]): TowerStat[] {
        const list = Object.keys(this.towers).map(k => this.towers[k]).filter(t => t.towers > 0 || t.damage > 0);
        const rank = (id: string) => { const i = order.indexOf(id); return i < 0 ? 99 : i; };
        return list.sort((a, b) => rank(a.id) - rank(b.id));
    }

    effectList(order: string[]): EffectStat[] {
        const list = Object.keys(this.effects).map(k => this.effects[k]).filter(e => e.triggers !== 0 || e.damage > 0 || e.resisted > 0);
        const rank = (id: string) => { const i = order.indexOf(id); return i < 0 ? 99 : i; };
        return list.sort((a, b) => rank(a.towerId) - rank(b.towerId) || b.damage - a.damage || b.triggers - a.triggers);
    }
}
