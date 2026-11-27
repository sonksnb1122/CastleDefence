import { ConfigMgr } from '../core/ConfigMgr';

/** One enemy scheduled to appear during a wave. */
export interface SpawnEntry {
    time: number;
    enemyId: string;
    hpMul: number;
    damageMul: number;
    speedMul: number;
    goldMul: number;
    scale: number;
    boss: boolean;
    /** Flat defense added to physic and magic def (grows every N waves). */
    defAdd: number;
    /** Highest physic / magic def this enemy can have (normal 70, boss 90 by default). */
    defMax?: number;
    /** Mutant type (waves.json "mutants"), or undefined. */
    mutant?: string;
}

/** Defense of the enemies of a wave (highest values among the enemies that can appear). */
export interface WaveDefense { physic: number; magic: number; bossPhysic: number; bossMagic: number; hasBoss: boolean; }

export interface WavePlan { wave: number; name: string; entries: SpawnEntry[]; }

/**
 * Builds the spawn list of a wave from waves.json:
 * explicit overrides (special / boss waves, spawn groups) or the default
 * formula (count grows every wave, stats grow every N waves).
 */
export class WaveMgr {
    static growthStep(wave: number): number {
        return Math.floor((wave - 1) / ConfigMgr.waves.growth.everyWaves);
    }

    /**
     * Defense bonus of a wave (waves.json defenseGrowth): nothing before `startWave`,
     * then +`add` at `startWave` and again every `everyWaves` waves.
     */
    static defenseAdd(wave: number): number {
        const g = ConfigMgr.waves.defenseGrowth;
        if (!g || !g.everyWaves) return 0;
        const start = g.startWave || 1;
        if (wave < start) return 0;
        return (g.add || 0) * (1 + Math.floor((wave - start) / g.everyWaves));
    }

    /** First wave after `wave` where enemy defense goes up again (0 when it is already maxed everywhere). */
    static nextDefenseWave(wave: number): number {
        const g = ConfigMgr.waves.defenseGrowth;
        if (!g || !g.everyWaves) return 0;
        const now = WaveMgr.defense(wave);
        for (let w = wave + 1; w <= wave + 200; w++) {
            const d = WaveMgr.defense(w);
            if (d.physic > now.physic || d.magic > now.magic || d.bossPhysic > now.bossPhysic || d.bossMagic > now.bossMagic) return w;
        }
        return 0;
    }

    /**
     * Extra status resistance (%) of the enemies of a wave (waves.json "statusResistance"):
     * grows evenly from startWave up to max at maxWave (or by perWave); bosses get bossBonus more.
     * Only for the listed status types.
     */
    static statusResist(wave: number, boss: boolean): { types: string[]; value: number } {
        const r = ConfigMgr.waves.statusResistance;
        if (!r || wave < r.startWave) return { types: [], value: 0 };
        const per = r.maxWave ? (r.max || 0) / Math.max(1, r.maxWave - r.startWave + 1) : (r.perWave || 0);
        const v = Math.min(r.max || 100, Math.round((wave - r.startWave + 1) * per)) + (boss ? r.bossBonus || 0 : 0);
        return { types: r.types || [], value: Math.min(95, v) };
    }

    /**
     * Final damage taken reduction (%) of the enemies of a wave (waves.json "finalDamageReduction"): linear
     * between its "points" [wave, %] (0 before the first one, the last value after the last one), bosses +bossBonus.
     * Hero skills ignore it.
     */
    static finalReduce(wave: number, boss: boolean): number {
        const r = ConfigMgr.waves.finalDamageReduction;
        const pts: number[][] = (r && r.points) || [];
        if (!pts.length || wave < pts[0][0]) return 0;
        let v = pts[pts.length - 1][1];
        for (let i = 0; i + 1 < pts.length; i++) {
            const [w0, v0] = pts[i], [w1, v1] = pts[i + 1];
            if (wave >= w0 && wave <= w1) { v = v0 + (v1 - v0) * (wave - w0) / Math.max(1, w1 - w0); break; }
        }
        v += boss ? r.bossBonus || 0 : 0;
        return Math.max(0, Math.min(99, Math.round(v * 10) / 10));
    }

    static defCaps(): { normal: number; boss: number } {
        const g = ConfigMgr.waves.defenseGrowth || {};
        return { normal: g.max || 70, boss: g.bossMax || g.max || 90 };
    }

    /** Highest physic / magic def among the enemies (and the boss) of a wave. */
    static defense(wave: number): WaveDefense {
        const g = ConfigMgr.waves.defenseGrowth || {};
        const caps = WaveMgr.defCaps();
        const add = WaveMgr.defenseAdd(wave);
        const out: WaveDefense = { physic: 0, magic: 0, bossPhysic: 0, bossMagic: 0, hasBoss: false };
        for (const id in WaveMgr.weightsFor(wave)) {
            const d = ConfigMgr.enemyDef(id);
            if (!d) continue;
            out.physic = Math.max(out.physic, Math.min(caps.normal, d.physicDef + add));
            out.magic = Math.max(out.magic, Math.min(caps.normal, d.magicDef + add));
        }
        const boss = WaveMgr.bossRule(wave);
        const bd = boss && ConfigMgr.enemyDef(boss.enemyId);
        if (bd) {
            out.hasBoss = wave % boss.every === 0;
            out.bossPhysic = Math.min(caps.boss, bd.physicDef + add + (g.bossAdd || 0));
            out.bossMagic = Math.min(caps.boss, bd.magicDef + add + (g.bossAdd || 0));
        }
        return out;
    }

    /**
     * Enemy HP multiplier of a wave. With waves.json "hpCurve" ({ base, segments: [{ fromWave, perWave }] })
     * HP grows every wave by the factor of the segment the wave is in, times every "steps" entry already reached;
     * otherwise growth.hp every growth.everyWaves.
     */
    static hpGrowth(wave: number): number {
        const c = ConfigMgr.waves.hpCurve;
        if (!c || !Array.isArray(c.segments) || c.segments.length === 0) return Math.pow(ConfigMgr.waves.growth.hp, WaveMgr.growthStep(wave));
        let mul = c.base || 1;
        for (let w = 2; w <= wave; w++) {
            let f = 1;
            for (const s of c.segments) if (w >= s.fromWave) f = s.perWave;
            mul *= f;
        }
        // One-off steps: from "fromWave" on, HP is multiplied by "mul" (e.g. x1.2 after wave 100).
        for (const b of (c.steps || [])) if (wave >= b.fromWave) mul *= b.mul;
        return mul;
    }

    /**
     * Extra enemy damage multiplier of a wave (waves.json "damageBoost": linear between its "points" [wave, x],
     * 1 before the first one, the last value after the last one): late waves hit the wall harder.
     */
    static damageBoost(wave: number): number {
        const pts: number[][] = (ConfigMgr.waves.damageBoost && ConfigMgr.waves.damageBoost.points) || [];
        if (!pts.length || wave < pts[0][0]) return 1;
        for (let i = 0; i + 1 < pts.length; i++) {
            const [w0, v0] = pts[i], [w1, v1] = pts[i + 1];
            if (wave >= w0 && wave <= w1) return v0 + (v1 - v0) * (wave - w0) / Math.max(1, w1 - w0);
        }
        return pts[pts.length - 1][1];
    }

    /** Ranged enemies (Flying Demon, Lich) do not get the damage boost: they keep shooting while they live. */
    static isRanged(id: string): boolean { const d = ConfigMgr.enemyDef(id); return !!(d && d.ranged); }

    /** A mutant type of waves.json "mutants" by id. */
    static mutantDef(id: string): any {
        const m = ConfigMgr.waves.mutants;
        return (m && (m.types || []).find((t: any) => t.id === id)) || null;
    }

    /**
     * Turns a normal enemy into a mutant (waves.json "mutants": "chancePct" of the walking enemies from
     * "fromWave"): bigger, tinted, faster and stronger (multipliers of its type).
     */
    static mutate(e: SpawnEntry, wave: number) {
        const m = ConfigMgr.waves.mutants;
        if (!m || wave < (m.fromWave || 1) || e.boss || Math.random() * 100 >= (m.chancePct || 0)) return;
        const def = ConfigMgr.enemyDef(e.enemyId);
        if (!def || def.ranged || def.flying) return;
        const types = (m.types || []).filter((t: any) => (t.weight || 0) > 0);
        if (!types.length) return;
        let r = Math.random() * types.reduce((a: number, t: any) => a + t.weight, 0), t = types[0];
        for (const x of types) { r -= x.weight; if (r < 0) { t = x; break; } }
        e.mutant = t.id;
        e.hpMul *= t.hpMul || 1;
        e.damageMul *= t.damageMul || 1;
        e.speedMul *= t.speedMul || 1;
        e.goldMul *= t.goldMul || 1;
        e.scale *= t.scale || 1;
    }

    static enemyCount(wave: number): number {
        const cfg = ConfigMgr.waves;
        return cfg.enemyCountBase + cfg.enemyCountPerWave * (wave - 1);
    }

    /**
     * The boss rule of a wave: waves.json "bossRule", with the last of its "byWave" entries whose "fromWave"
     * is reached (other boss enemy, multipliers, scale), e.g. the Lich King from wave 70.
     */
    static bossRule(wave: number): any {
        const r = ConfigMgr.waves.bossRule;
        if (!r) return null;
        let out = r;
        for (const b of (r.byWave || [])) {
            if (wave < b.fromWave) continue;
            out = Object.assign({}, r, b);
            // "scaleGrowth": the boss grows at every boss wave after its first one (up to "maxScale").
            if (b.scaleGrowth) {
                const n = Math.max(0, Math.floor((wave - b.fromWave) / (r.every || 10)));
                out.scale = Math.min(b.maxScale || Infinity, (b.scale || 1) + n * b.scaleGrowth);
            }
        }
        return out;
    }

    static build(wave: number): WavePlan {
        const cfg = ConfigMgr.waves;
        const step = WaveMgr.growthStep(wave);
        const g = cfg.growth;
        const hpG = WaveMgr.hpGrowth(wave), dmgG = Math.pow(g.damage, step), boost = WaveMgr.damageBoost(wave), spdG = Math.pow(g.moveSpeed, step);
        // Gold per kill grows with the enemies, so stronger waves pay for the endless research.
        const goldG = Math.pow(g.goldReward || 1, step);
        const dg = cfg.defenseGrowth || {};
        const caps = WaveMgr.defCaps();
        // Milestone waves (waves.json milestones): extra strong checkpoints of the progression.
        let ms: any = null;
        for (const m of (cfg.milestones || [])) if (m.wave === wave) ms = m;
        const msHp = (ms && ms.hpMul) || 1, msDmg = (ms && ms.damageMul) || 1;
        // countScaleRef: more enemies than the reference count share the same total HP and gold
        // (each normal enemy gets refCount / count of them), so a bigger crowd does not change the balance.
        const ref = cfg.countScaleRef;
        const share = ref ? Math.min(1, (ref.base + ref.perWave * (wave - 1)) / WaveMgr.enemyCount(wave)) : 1;
        const entry = (time: number, enemyId: string, mul: any, scale: number, boss: boolean): SpawnEntry => ({
            time, enemyId,
            hpMul: hpG * msHp * ((mul && mul.hp) || 1),
            damageMul: dmgG * msDmg * (WaveMgr.isRanged(enemyId) ? 1 : boost) * ((mul && mul.damage) || 1),
            speedMul: spdG * ((mul && mul.moveSpeed) || 1),
            goldMul: goldG * ((mul && mul.goldReward) || 1),
            scale: scale || 1,
            boss,
            defAdd: WaveMgr.defenseAdd(wave) + (boss ? (dg.bossAdd || 0) : 0),
            defMax: boss ? caps.boss : caps.normal,
        });
        const entries: SpawnEntry[] = [];
        let name = `Wave ${wave}`;

        let override: any = null;
        for (const o of (cfg.overrides || [])) if (o.wave === wave) override = o;

        if (override) {
            name = `Wave ${wave} - ${override.name || override.type || 'Special'}`;
            for (const grp of override.groups) {
                const interval = grp.interval === undefined ? cfg.spawnInterval : grp.interval;
                for (let i = 0; i < grp.count; i++) {
                    entries.push(entry((grp.delay || 0) + i * interval, grp.enemyId, grp.statMul, grp.scale, !!grp.boss));
                }
            }
        } else {
            const br = WaveMgr.bossRule(wave);
            const boss = br && wave % br.every === 0 ? br : null;
            const interval = Math.max(cfg.minSpawnInterval, cfg.spawnInterval - (cfg.spawnIntervalDecayPerWave || 0) * (wave - 1));
            let normalCount = 0;
            if (ms && ms.name) name = `Wave ${wave} - ${ms.name}`;
            if (!boss || boss.keepNormalEnemies) {
                normalCount = Math.round(WaveMgr.enemyCount(wave) * ((ms && ms.countMul) || 1));
                const weights = WaveMgr.weightsFor(wave);
                const shared = share < 1 ? { hp: share, goldReward: share } : null;
                for (let i = 0; i < normalCount; i++) {
                    const en = entry(i * interval, WaveMgr.pick(weights), shared, 1, false);
                    WaveMgr.mutate(en, wave);
                    entries.push(en);
                }
            }
            if (boss) {
                if (!ms || !ms.name) name = `Wave ${wave} - Boss`;
                const at = normalCount * interval * 0.5;
                const bossCount = (ms && ms.bossCount) || boss.count || 1;
                for (let i = 0; i < bossCount; i++) entries.push(entry(at + i * 2, boss.enemyId, boss.statMul, boss.scale, true));
            }
        }
        entries.sort((a, b) => a.time - b.time);
        return { wave, name, entries };
    }

    /** Spawn weights of the tier that contains this wave. */
    static weightsFor(wave: number): { [id: string]: number } {
        const cfg = ConfigMgr.waves;
        let tier = cfg.tiers[cfg.tiers.length - 1];
        for (const t of cfg.tiers) if (wave >= t.fromWave && wave <= t.toWave) { tier = t; break; }
        if (tier.weights) return tier.weights;
        const out: { [id: string]: number } = {};
        for (const id of (tier.enemies || [])) out[id] = ConfigMgr.enemyDef(id).spawnWeight;
        return out;
    }

    private static pick(weights: { [id: string]: number }): string {
        let total = 0;
        for (const id in weights) total += weights[id];
        let roll = Math.random() * total;
        let last = '';
        for (const id in weights) {
            last = id;
            roll -= weights[id];
            if (roll <= 0) return id;
        }
        return last;
    }

    /** Short description of a wave for the UI. */
    static summary(wave: number): string {
        const plan = WaveMgr.build(wave);
        const counts: { [id: string]: number } = {};
        for (const e of plan.entries) counts[e.enemyId] = (counts[e.enemyId] || 0) + 1;
        const cfg = ConfigMgr.waves;
        let fixed = false;
        for (const o of (cfg.overrides || [])) if (o.wave === wave) fixed = true;
        if (!fixed) return `${plan.entries.length} enemies`;
        return Object.keys(counts).map(id => `${counts[id]}x ${ConfigMgr.enemyDef(id).name}`).join(', ');
    }
}
