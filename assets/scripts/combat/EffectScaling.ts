import { ConfigMgr } from '../core/ConfigMgr';

/**
 * Tower effects grow with their research (effects.json "effectScaling" and each effect's "scaling"):
 *  - level 1-10 = levels of the effect's two chance technologies; it raises the flat damage / debuff value;
 *  - Mastery 0-3 (the Mastery technology) adds the "mastery" fields one by one (Mastery 3 = the full effect);
 *  - some hero passives change the numbers too (see PASSIVES_IN_RESOLVE).
 * resolve() returns a copy of the effect with every number worked out (and its own status copy for
 * status effects), cached per effect / level / mastery / tower level / passives.
 */
export interface EffectCtx {
    level: number;
    mastery: number;
    /** Level of the technology under the Mastery (research "effectPlus:<id>"), 0 = none. */
    plus?: number;
    towerLevel: number;
    /** True when a hero owns this passive (skills.json id). */
    has: (passiveId: string) => boolean;
}

/** Passives that change the resolved numbers (the others act in CombatManager during the fight). */
const PASSIVES_IN_RESOLVE = ['p_long_shot', 'p_hemorrhage', 'p_deep_cuts', 'p_bitter_cold', 'p_tremor', 'p_sunder'];

export function passiveParams(id: string): any {
    const p = ConfigMgr.passiveDef(id);
    return (p && p.params) || {};
}

export class EffectScaling {
    private static cache = new Map<string, any>();

    static get maxLevel(): number { const s = ConfigMgr.effects.effectScaling; return (s && s.levels) || 10; }

    static towerLevelMul(towerLevel: number): number {
        const s = ConfigMgr.effects.effectScaling;
        const list: number[] = (s && s.towerLevelMul) || [1];
        return list[Math.max(0, Math.min(list.length - 1, towerLevel - 1))] || 1;
    }

    /** [a, b] at level 1 and at the last level, linear in between; 0 below level 1. */
    static lerp(range: number[] | undefined, level: number): number {
        if (!range || level <= 0) return 0;
        const n = EffectScaling.maxLevel;
        const l = Math.min(n, level);
        return range[0] + (range[1] - range[0]) * (n > 1 ? (l - 1) / (n - 1) : 1);
    }

    /** Clears the cache (configs reloaded). */
    static reset() { EffectScaling.cache.clear(); }

    static resolve(def: any, ctx: EffectCtx): any {
        const pas = PASSIVES_IN_RESOLVE.filter(p => ctx.has(p));
        const key = `${def.id}|${ctx.level}|${ctx.mastery}|${ctx.plus || 0}|${ctx.towerLevel}|${pas.join(',')}`;
        const hit = EffectScaling.cache.get(key);
        if (hit) return hit;
        const out = EffectScaling.build(def, ctx, (p: string) => pas.indexOf(p) >= 0);
        EffectScaling.cache.set(key, out);
        return out;
    }

    private static build(def: any, ctx: EffectCtx, has: (p: string) => boolean): any {
        const sc = def.scaling || {};
        const out: any = Object.assign({}, def);
        delete out.scaling;
        out.level = ctx.level;
        out.mastery = ctx.mastery;
        out.plus = ctx.plus || 0;
        out.hitPct = 0;
        const base = def.kind === 'status' ? ConfigMgr.statusDef(def.statusId) : null;
        const st: any = base ? Object.assign({}, base) : null;
        let statusValueSet = false;
        const apply = (o: any) => {
            if (!o) return;
            for (const k in o) {
                if (k === 'status') {
                    if (!st) continue;
                    for (const sk in o.status) { st[sk] = o.status[sk]; if (sk === 'value') statusValueSet = true; }
                } else out[k] = o[k];
            }
        };
        apply(sc.base);
        const mastery: any[] = sc.mastery || [];
        for (let i = 0; i < Math.min(ctx.mastery, mastery.length); i++) apply(mastery[i]);
        // "plus": one entry per level of the technology under the Mastery (each entry holds the full values).
        const plus: any[] = sc.plus || [];
        if (ctx.plus && ctx.plus > 0 && plus.length) apply(plus[Math.min(ctx.plus, plus.length) - 1]);
        // "flatSet" (a Mastery level): the flat damage of that level instead of the research range.
        out.flat = (out.flatSet !== undefined ? out.flatSet : EffectScaling.lerp(sc.flat, ctx.level)) * EffectScaling.towerLevelMul(ctx.towerLevel);
        if (st && sc.value && !statusValueSet) st.value = EffectScaling.lerp(sc.value, ctx.level);
        const full = ctx.mastery >= mastery.length;

        // Passives that change the numbers.
        if (def.id === 'piercing_bolt' && has('p_long_shot')) {
            const p = passiveParams('p_long_shot');
            out.maxTargets = (out.maxTargets || 1) + (p.extraTargets || 2);
            out.range = p.range || out.range;
        }
        if (st && st.type === 'bleed') {
            if (has('p_hemorrhage')) {
                const p = passiveParams('p_hemorrhage');
                out.spread = { stacks: p.spreadStacks || 2, range: p.spreadRange || 140 };
                if (full) st.currentHpPctPerTick = (p.currentHpPctPerSec || 0.1) * (st.tickInterval || 1);
                else out.flat *= p.flatMul || 1.5;
            }
            if (has('p_deep_cuts')) {
                const p = passiveParams('p_deep_cuts');
                if (full) st.burstAtMaxStacks = { maxHpPct: p.burstMaxHpPct || 6, stacks: Math.max(1, (st.maxStacks || 1) - 1) };
                else out.flat *= p.flatMul || 1.5;
            }
        }
        if (def.id === 'frost_explosion' && st && has('p_bitter_cold')) st.value += passiveParams('p_bitter_cold').slow || 15;
        if (def.id === 'shockwave' && st && has('p_tremor')) {
            const p = passiveParams('p_tremor');
            st.duration += p.stun || 0.2;
            if (st.immuneHit) st.immuneHit = { maxHpPct: st.immuneHit.maxHpPct * (p.immuneMul || 1.5) };
            else out.flat *= p.flatMul || 1.5;
        }
        if (def.id === 'armor_break' && st && has('p_sunder')) {
            st.stacking = 'StackValue';
            st.maxStacks = passiveParams('p_sunder').maxStacks || 3;
        }
        if (st) out.status = st;
        return out;
    }

    /** One line for the tower info window: what the effect does at its current level. */
    static describe(r: any, withLevel = false): string {
        const b = EffectScaling.body(r);
        if (withLevel) return `Lv ${r.level}${r.mastery > 0 ? ', Mastery ' + r.mastery : ''}: ` + b;
        return b.charAt(0).toUpperCase() + b.substring(1);
    }

    private static body(r: any): string {
        const f = Math.round(r.flat);
        const st = r.status || {};
        const n = (v: number) => String(Math.round(v * 10) / 10);
        const sec = (v: number) => n(v) + ' s';
        const stacks = (m: number) => m > 1 ? ` (stacks up to ${m} times)` : '';
        switch (r.id) {
            case 'piercing_bolt':
                return `the bolt flies on to ${r.maxTargets} more enemies nearby (${r.range} px) and deals ${f} damage to each` +
                    (r.hitPct > 0 ? `, or ${r.hitPct}% of the shot's damage when that is more` : '') + '.';
            case 'chain_lightning':
                return `lightning jumps to ${r.maxTargets} more enemies nearby (${r.range} px), ${f} damage each` +
                    (r.hitPct > 0 ? `, or ${r.hitPct}% of the shot's damage when that is more` : '') + '; it also starts when the shot misses.';
            case 'bleeding_bolt':
                return `the target bleeds: ${r.hitPct > 0 ? '(' + f + ' + ' + r.hitPct + '% of the shot\'s damage)' : f} physical damage per second for each stack, ${sec(st.duration)}${stacks(st.maxStacks)}` +
                    (st.burstAtMaxStacks ? `; at ${st.burstAtMaxStacks.stacks || st.maxStacks} stacks it bursts for ${n(st.burstAtMaxStacks.maxHpPct)}% of the max HP (1/3 on bosses)` : '') + '.';
            case 'hunters_mark':
                return `the target takes +${n(st.value)}% damage from every Crossbow per stack for ${sec(st.duration)}${stacks(st.maxStacks)}` +
                    (st.atMaxStacks ? `; at ${st.maxStacks} stacks each Crossbow hit also deals ${n(st.atMaxStacks.currentHpPct)}% of the current HP (1/3 on bosses, at most 10 hits)` : '') + '.';
            case 'frost_explosion':
                return `every enemy in the explosion moves ${n(st.value)}% slower for ${sec(st.duration)}.`;
            case 'arcane_vulnerability':
                return `enemies hit take +${n(st.value)}% magic damage per stack for ${sec(st.duration)}${stacks(st.maxStacks)}` +
                    (r.chainTargets > 0 ? `; it also lands on the first ${r.chainTargets} enemies of a Chain Lightning, whose jumps deal +${n(r.chainDmgPct || 0)}%` : ' (not on Chain Lightning targets)') + '.';
            case 'shockwave':
                return `enemies hit take ${f} damage and are stunned for ${sec(st.duration)} (then immune to stun for ${sec(st.immunityAfter || 0)})` +
                    (st.immuneHit ? `; an enemy immune to stun loses ${n(st.immuneHit.maxHpPct)}% of its max HP instead (1/3 on bosses)` : '') + '.';
            case 'heavy_impact':
                return `+${f} damage on every hit (through defense)` + (r.value > 0 ? `, or ${n(r.value)}% of the target's max HP when that is more (${Math.round((r.bossMul !== undefined ? r.bossMul : 1 / 3) * 100)}% on bosses, at most ${r.capHitMul || 5} normal hits)` : '') + '.';
            case 'armor_break':
                return `enemies hit lose ${n(st.value)} defense for ${sec(st.duration)}${st.stacking === 'StackValue' ? stacks(st.maxStacks) : ''} (each point removed = about +1% damage taken).`;
        }
        return r.description || '';
    }
}
