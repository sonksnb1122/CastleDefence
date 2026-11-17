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
}

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

    /** Defense bonus of a wave: +add for every `everyWaves` waves (waves.json defenseGrowth). */
    static defenseAdd(wave: number): number {
        const g = ConfigMgr.waves.defenseGrowth;
        if (!g || !g.everyWaves) return 0;
        return (g.add || 0) * Math.floor((wave - 1) / g.everyWaves);
    }

    static enemyCount(wave: number): number {
        const cfg = ConfigMgr.waves;
        return cfg.enemyCountBase + cfg.enemyCountPerWave * (wave - 1);
    }

    static build(wave: number): WavePlan {
        const cfg = ConfigMgr.waves;
        const step = WaveMgr.growthStep(wave);
        const g = cfg.growth;
        const hpG = Math.pow(g.hp, step), dmgG = Math.pow(g.damage, step), spdG = Math.pow(g.moveSpeed, step);
        const entry = (time: number, enemyId: string, mul: any, scale: number, boss: boolean): SpawnEntry => ({
            time, enemyId,
            hpMul: hpG * ((mul && mul.hp) || 1),
            damageMul: dmgG * ((mul && mul.damage) || 1),
            speedMul: spdG * ((mul && mul.moveSpeed) || 1),
            goldMul: (mul && mul.goldReward) || 1,
            scale: scale || 1,
            boss,
            defAdd: WaveMgr.defenseAdd(wave),
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
            const boss = cfg.bossRule && wave % cfg.bossRule.every === 0 ? cfg.bossRule : null;
            const interval = Math.max(cfg.minSpawnInterval, cfg.spawnInterval - (cfg.spawnIntervalDecayPerWave || 0) * (wave - 1));
            let normalCount = 0;
            if (!boss || boss.keepNormalEnemies) {
                normalCount = WaveMgr.enemyCount(wave);
                const weights = WaveMgr.weightsFor(wave);
                for (let i = 0; i < normalCount; i++) entries.push(entry(i * interval, WaveMgr.pick(weights), null, 1, false));
            }
            if (boss) {
                name = `Wave ${wave} - Boss`;
                const at = normalCount * interval * 0.5;
                for (let i = 0; i < (boss.count || 1); i++) entries.push(entry(at + i * 2, boss.enemyId, boss.statMul, boss.scale, true));
            }
        }
        entries.sort((a, b) => a.time - b.time);
        return { wave, name, entries };
    }

    /** Spawn weights of the tier that contains this wave. */
    private static weightsFor(wave: number): { [id: string]: number } {
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
