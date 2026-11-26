import { Node, Graphics, UIOpacity, UITransform, isValid, Color, Sprite } from 'cc';
import { Assets } from '../core/Assets';
import { ConfigMgr } from '../core/ConfigMgr';
import { Display } from '../core/Display';
import { DamageResult, DamageType, ShotInfo } from '../core/GameTypes';
import { G } from '../core/Globals';
import { ResourceMgr } from '../core/ResourceMgr';
import { hex, mk, sprite } from '../views/common/UIKit';
import { CombatText } from './CombatText';
import { Enemy, IEnemyHost } from './Enemy';
import { Projectile } from './Projectile';
import { SpriteAnim } from './SpriteAnim';
import { ITowerHost, TowerUnit } from './TowerUnit';
import { SpawnEntry, WaveMgr, WavePlan } from './WaveMgr';
import { WaveStats } from './WaveStats';
import { ISkillHost, SkillManager } from './SkillManager';
import { passiveParams } from './EffectScaling';

/** A short visual effect. `kind` says which pool it goes back to. */
interface Fx { kind: 'impact' | 'ground' | 'ring' | 'line'; node: Node; anim?: SpriteAnim; g?: Graphics; life: number; total: number; op?: UIOpacity; }

export interface CombatEvents {
    onWallChanged(): void;
    onWaveCleared(wave: number, goldFromKills: number): void;
    onGameOver(wave: number): void;
}

const MAX_FLOAT_TEXTS = 70;
/** Halo Spire: half width of the band in which the ring touches a projectile (line + projectile size). */
const HALO_EDGE = 10;
/** Damage texts on one enemy are stacked in rows above its head (newest at the bottom). */
const TEXT_ROWS = 3;
const TEXT_ROW_H = 19;
/** A shot whose enemy died on the way flies on to a living enemy this close to it. */
const REDIRECT_RANGE = 80;
/** Area shots also reserve their damage on the enemies this close to the target (part of the explosion radius). */
const SPLASH_RESERVE = 0.7;

/** Damage a flying shot has reserved on one enemy (see reserve / unreserve). */
interface Reservation { e: Enemy; serial: number; amount: number; }

/**
 * Runs one battle: spawning, targeting, projectiles, explosions and the single
 * damage pipeline every tower goes through.
 */
export class CombatManager implements IEnemyHost, ITowerHost, ISkillHost {
    enemies: Enemy[] = [];
    towers: TowerUnit[] = [];
    projectiles: Projectile[] = [];
    wallRightX: number;
    active = false;
    wave = 0;
    plan: WavePlan | null = null;
    goldFromKills = 0;
    /** Energy Cores dropped by the bosses of this wave (waves.json "bossCoreDrop"). */
    coresFromKills = 0;
    /** Statistics of the running (or last) wave, see WaveStats. */
    stats = new WaveStats();
    /** Active skills (skills.json). */
    skills: SkillManager;
    /** Hits on the wall still blocked by Barrier Block (this wave only). */
    barrierCharges = 0;
    /** Seconds left of the passives Last Stand (wall kept at 1 HP) and Bulwark (wall defense multiplied). */
    lastStandTime = 0;
    bulwarkTime = 0;

    // Who is dealing the damage that applyDamage is about to apply (wave statistics).
    private ctxTower = '';
    /** The whole hit belongs to this effect (chain jump, Bleed burst, stun-immune hit). */
    private ctxEffect: { key: string; name: string } | null = null;
    /** Flat bonus parts of the current hit (Heavy Impact, Hunter's Mark x5). */
    private ctxFlat: Array<{ key: string; name: string; amount: number }> = [];

    private queue: SpawnEntry[] = [];
    private elapsed = 0;
    private fx: Fx[] = [];
    private floats: CombatText[] = [];
    /** Texts stacked on each enemy (see enemyFloat). */
    private stacks = new Map<Enemy, CombatText[]>();
    private serialSeq = 0;
    // Pools: finished objects keep their (hidden) nodes and are reused instead of being destroyed.
    private enemyPool: Enemy[] = [];
    private projectilePool: Projectile[] = [];
    private fxPool: { impact: Fx[]; ground: Fx[]; ring: Fx[]; line: Fx[] } = { impact: [], ground: [], ring: [], line: [] };
    /** Effects drawn under the enemies (big explosions, see impactFx). */
    private groundFxLayer: Node;
    private textPool: CombatText[] = [];
    /** Projectiles of ranged enemies flying to the wall (their nodes come from the impact fx pool). */
    private enemyShots: Array<{ f: Fx; x: number; y: number; tx: number; tipX: number; speed: number; damage: number; type: string; impact: any; boss: boolean }> = [];
    private sortTimer = 0;
    private gameOver = false;
    private rm = ResourceMgr.inst;
    /**
     * Demo battle (main menu background): no buffs, no rewards, no sound,
     * the wall cannot be damaged and the fight never ends.
     */
    demo = false;

    /** Research + hero buff; always 0 in demo mode so the menu never reads player data. */
    private buff(key: string, towerId?: string): number { return this.demo ? 0 : this.rm.buff(key, towerId); }
    /** A hero owns this passive skill (never in demo mode). */
    private hasPassive(id: string): boolean { return this.buff('passive:' + id) > 0; }
    /** Owned and not recharging (passives with "cooldownWaves"). */
    private passiveReady(id: string): boolean { return this.hasPassive(id) && this.rm.skills.passiveReady(id); }
    private startPassiveCooldown(id: string) { this.rm.skills.startPassiveCooldown(id); }

    constructor(private enemyLayer: Node, private fxLayer: Node, private textLayer: Node, private events: CombatEvents) {
        const wall = ConfigMgr.tower.battlefield.wall;
        this.wallRightX = wall.x + wall.width;
        // Layer just below the enemies, for impacts that must not hide them.
        const parent = enemyLayer.parent;
        this.groundFxLayer = mk('GroundFx', parent || fxLayer);
        if (parent) this.groundFxLayer.setSiblingIndex(parent.children.indexOf(enemyLayer));
        this.skills = new SkillManager(this, fxLayer, this.groundFxLayer);
    }

    get enemiesLeft(): number { return this.queue.length + this.enemies.filter(e => e.alive).length; }

    // ------------------------------------------------------------------ wave control
    startWave(wave: number) {
        this.wave = wave;
        this.plan = WaveMgr.build(wave);
        this.queue = this.plan.entries.slice();
        this.elapsed = 0;
        this.goldFromKills = 0;
        this.coresFromKills = 0;
        this.gameOver = false;
        this.active = true;
        this.barrierCharges = 0;
        this.lastStandTime = 0;
        this.bulwarkTime = 0;
        this.stats.reset(wave, this.towers.map(t => ({ id: t.save.id, name: (t.def && t.def.name) || t.save.id })));
    }


    /** Demo mode: spawn one enemy right away (the menu background keeps calling this). */
    spawnDemo(enemyId: string, hpMul: number, speedMul: number) {
        this.spawn({ time: 0, enemyId, hpMul, damageMul: 1, speedMul, goldMul: 1, scale: 1, boss: false, defAdd: 0 });
    }

    private spawn(entry: SpawnEntry, at?: { x: number; y: number }) {
        const def = ConfigMgr.enemyDef(entry.enemyId);
        const bf = ConfigMgr.tower.battlefield;
        const defMax = entry.defMax || WaveMgr.defCaps().normal;
        // Consistent rounding: HP / damage / gold are rounded to integers, speed keeps decimals.
        const stats = {
            hp: Math.max(1, Math.round(def.hp * entry.hpMul * (1 - Math.min(90, this.buff('enemyHpReduce')) / 100))),
            damage: Math.max(0, Math.round(def.damage * entry.damageMul * (1 - Math.min(90, this.buff('enemyDamageReduce')) / 100))),
            moveSpeed: Math.max(0, def.moveSpeed * entry.speedMul * (1 - Math.min(90, this.buff('enemyMoveSpeedReduce')) / 100)),
            goldReward: Math.round(def.goldReward * entry.goldMul),
            scale: entry.scale,
            boss: entry.boss,
            physicDef: Math.min(defMax, def.physicDef + entry.defAdd),
            magicDef: Math.min(defMax, def.magicDef + entry.defAdd),
            statusResist: this.demo ? undefined : WaveMgr.statusResist(this.wave, entry.boss),
        };
        const y = at ? at.y : bf.enemyLaneY[0] + Math.random() * (bf.enemyLaneY[1] - bf.enemyLaneY[0]);
        const e = this.enemyPool.pop() || new Enemy(this.enemyLayer);
        e.spawn(def, stats, at ? at.x : bf.spawnX, y);
        e.serial = ++this.serialSeq;
        this.enemies.push(e);
        if (entry.boss && !this.demo) G.main.playSfx('boss');
    }

    // ------------------------------------------------------------------ update
    update(dt: number) {
        this.skills.update(dt);
        // Visual effects keep running even between waves.
        for (let i = this.fx.length - 1; i >= 0; i--) {
            const f = this.fx[i];
            if (!this.updateFx(f, dt)) { this.fx.splice(i, 1); f.node.active = false; this.fxPool[f.kind].push(f); }
        }
        for (let i = this.floats.length - 1; i >= 0; i--) {
            const t = this.floats[i];
            if (t.update(dt)) continue;
            if (t.stack) { const k = t.stack.indexOf(t); if (k >= 0) t.stack.splice(k, 1); t.stack = null; }
            this.textPool.push(this.floats.splice(i, 1)[0]);
        }

        const host = this.active ? this : null;
        this.assignHalos();
        for (const t of this.towers) t.update(dt, host);
        this.updateHalos(dt);

        if (this.active) {
            if (this.lastStandTime > 0) this.lastStandTime -= dt;
            if (this.bulwarkTime > 0) this.bulwarkTime -= dt;
            this.elapsed += dt;
            this.stats.time += dt;
            while (this.queue.length > 0 && this.queue[0].time <= this.elapsed) this.spawn(this.queue.shift()!);
        }

        for (const e of this.enemies) e.update(dt, this);

        this.updateEnemyShots(dt);
        this.updateSummons(dt);

        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const p = this.projectiles[i];
            if (p.target && !p.target.alive) this.redirect(p);
            if (p.update(dt)) {
                this.unreserve(p.shot);
                this.explode(p.shot, p.tx, p.ty, p.target, p.cfg);
                p.release();
                this.projectilePool.push(p);
                this.projectiles.splice(i, 1);
            }
        }

        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const e = this.enemies[i];
            if (e.removed) { this.dropTexts(e); e.release(); this.enemyPool.push(e); this.enemies.splice(i, 1); }
        }

        // Draw order: enemies lower on the screen are in front.
        this.sortTimer -= dt;
        if (this.sortTimer <= 0 && this.enemies.length > 1) {
            this.sortTimer = 0.4;
            const sorted = this.enemies.slice().sort((a, b) => b.y - a.y);
            for (let i = 0; i < sorted.length; i++) sorted[i].node.setSiblingIndex(i);
        }

        if (this.active && !this.demo && !this.gameOver && this.queue.length === 0 && !this.enemies.some(e => e.alive)) {
            this.active = false;
            for (const p of this.projectiles) { p.release(); this.projectilePool.push(p); }
            this.projectiles.length = 0;
            this.skills.clear();
            this.events.onWaveCleared(this.wave, this.goldFromKills);
        }
    }

    /** Remove everything that belongs to the running battle. */
    clear() {
        const all: Node[] = [];
        for (const e of this.enemies.concat(this.enemyPool)) all.push(e.node);
        for (const p of this.projectiles.concat(this.projectilePool)) all.push(...p.nodes);
        for (const f of this.fx.concat(this.fxPool.impact, this.fxPool.ground, this.fxPool.ring, this.fxPool.line)) all.push(f.node);
        for (const sh of this.enemyShots) all.push(sh.f.node);
        this.enemyShots.length = 0;
        for (const h of this.halos) all.push(h.f.node);
        this.halos.length = 0;
        this.summons.length = 0;
        for (const t of this.floats.concat(this.textPool)) all.push(t.node);
        for (const n of all) if (isValid(n)) n.destroy();
        this.enemies.length = 0; this.projectiles.length = 0; this.fx.length = 0; this.floats.length = 0;
        this.enemyPool.length = 0; this.projectilePool.length = 0; this.textPool.length = 0;
        this.fxPool = { impact: [], ground: [], ring: [], line: [] };
        this.queue.length = 0;
        this.stacks.clear();
        this.skills.clear();
        this.active = false;
    }

    // ------------------------------------------------------------------ targeting (shared by every tower)
    isValidTarget(tower: TowerUnit, e: Enemy | null): boolean {
        if (!e || !e.alive) return false;
        if (e.flying && tower.def.hitsFlying === false) return false;   // the Catapult cannot hit flying enemies
        if (e.x > ConfigMgr.tower.battlefield.worldWidth) return false; // not on the field yet
        const r = tower.stats().range + e.radius;
        const dx = e.x - tower.cx, dy = e.y - tower.cy;
        return dx * dx + dy * dy <= r * r;
    }

    selectTarget(tower: TowerUnit): Enemy | null {
        const mode = tower.save.targetMode;
        if (mode === 'Smart') return this.smartTarget(tower);
        let best: Enemy | null = null;
        let bestScore = Infinity;
        for (const e of this.enemies) {
            if (!this.isValidTarget(tower, e) || this.isOverkill(tower, e)) continue;
            let score: number;
            switch (mode) {
                case 'LowestHP': score = e.hp; break;
                case 'HighestHP': score = -e.hp; break;
                case 'Nearest': score = Math.hypot(e.x - tower.cx, e.y - tower.cy); break;
                default: score = e.x; // First: closest to the wall
            }
            if (score < bestScore) { bestScore = score; best = e; }
        }
        return best;
    }

    /**
     * True when the shots already flying at this enemy are enough to kill it.
     * Towers with "avoidOverkill" in tower.json (Crossbow, Crystal) then aim at another enemy
     * instead of wasting shots; the Catapult does not, its big explosion hits the enemies around it too.
     */
    isOverkill(tower: TowerUnit, e: Enemy | null): boolean {
        return !!e && !!tower.def.avoidOverkill && this.doomed(e);
    }

    private doomed(e: Enemy): boolean { return e.pendingDamage > 0 && e.hp - e.pendingDamage <= 0; }

    /** Smart targeting keeps a target unless another one is clearly better (saves weapon turning). */
    shouldRetarget(tower: TowerUnit): boolean {
        if (tower.save.targetMode !== 'Smart') return false;
        tower.retargetTimer -= 1;
        if (tower.retargetTimer > 0) return false;
        tower.retargetTimer = 10; // re-evaluate every 10 frames
        const cur = tower.target;
        if (!cur || !this.isValidTarget(tower, cur)) return true;
        const best = this.smartTarget(tower);
        return !!best && best !== cur && this.smartScore(tower, best) > this.smartScore(tower, cur) * 1.25;
    }

    /**
     * Smart targeting (Research Lab Lv 3):
     *  - every tower: ignores enemies that the shots already in flight will kill (no overkill),
     *    prefers enemies close to the wall (danger) and finishing blows;
     *  - Crossbow (smartRole "closestToWall"): the enemy closest to the wall;
     *  - Crystal: highest damage after defense (lowest def) and the nearest enemies;
     *    marks are used (Hunter's Mark for Crossbow, Arcane Vulnerability for magic);
     *  - Catapult: the enemy at the center of the biggest group inside its explosion.
     */
    smartTarget(tower: TowerUnit): Enemy | null {
        let best: Enemy | null = null, bestScore = -Infinity;
        for (const e of this.enemies) {
            if (!this.isValidTarget(tower, e) || this.isOverkill(tower, e)) continue;
            const sc = this.smartScore(tower, e);
            if (sc > bestScore) { bestScore = sc; best = e; }
        }
        return best;
    }

    smartScore(tower: TowerUnit, e: Enemy): number {
        const s = tower.stats();
        const types = tower.def.damageTypes as DamageType[];
        const hpLeft = e.hp - e.pendingDamage;
        if (hpLeft <= 0) return -1e9 + e.hp;               // already dead once the shots land
        // Damage of one shot against this enemy (defense, marks).
        const hit = (en: Enemy) => {
            let m = -Infinity;
            for (const t of types) m = Math.max(m, this.defenseMultiplier(en, t) * (1 + en.markBonus(tower.save.id, t) / 100));
            return Math.max(0.01, m) * tower.baseDamage() * (1 + this.buff('damage', tower.save.id) / 100);
        };
        // Length of the field between the spawn and the wall (used for the "close to the wall" weights).
        const fieldW = ConfigMgr.tower.battlefield.worldWidth - this.wallRightX;
        // Useful damage: never more than what is left (no overkill); a kill is worth a bonus.
        const useful = (en: Enemy) => {
            const left = en.hp - en.pendingDamage;
            if (left <= 0) return 0;
            const d = hit(en);
            return Math.min(d, left) / en.maxHp + (d >= left ? 0.5 : 0);
        };
        if (s.explosion > 40 && tower.def.explosionBuffable) {
            // Area towers: total useful damage of the explosion centred on this enemy.
            const r2 = s.explosion * s.explosion;
            let total = 0;
            const bossBonus = tower.def.smartBossBonus || 0;
            for (const o of this.enemies) {
                if (!o.alive || (o.flying && tower.def.hitsFlying === false)) continue;
                const dx = o.x - e.x, dy = o.y - e.y;
                if (dx * dx + dy * dy <= r2) {
                    const c = Math.max(0, Math.min(1, 1 - (o.x - this.wallRightX) / fieldW));
                    const od = 1 + 2 * c;
                    if (o.boss && bossBonus > 0 && o.hp - o.pendingDamage > 0) {
                        // A boss has so much HP that one hit is a small share of it: count a hit as a whole
                        // enemy, weighted more and more as the boss gets close to the wall ("smartBossBonus").
                        total += od * (1 + bossBonus * c);
                    } else total += useful(o) * od;
                }
            }
            return total;
        }
        // Crossbow: its job is the enemy closest to the wall (skipping the ones the shots in flight will kill).
        if (tower.def.smartRole === 'closestToWall') {
            return 10 - (e.x - this.wallRightX) / fieldW;
        }
        // Single target (Crystal): enemies close to the wall get a much higher priority
        // (x1 at the spawn, x5 at a quarter of the field, up to x9 at the wall), then damage dealt and distance.
        const c = Math.max(0, Math.min(1, 1 - (e.x - this.wallRightX) / fieldW));
        const nearWall = 1 + 4 * c + (c > 0.75 ? 16 * (c - 0.75) : 0);
        const dist = Math.hypot(e.x - tower.cx, e.y - tower.cy);
        return useful(e) * nearWall * (1 + e.wallDamage() / 100) * (1.1 - 0.2 * dist / Math.max(1, s.range));
    }

    spawnProjectile(tower: TowerUnit, shot: ShotInfo, target: Enemy, fromX: number, fromY: number, angleDeg: number) {
        const cfg = tower.lv.sprite.projectile;
        const speed = cfg.speed * (1 + this.buff('projectileSpeed', shot.towerId) / 100);
        (shot as any).impact = tower.lv.sprite.impact;
        // Expected damage (no crit) so the next shots go to other enemies instead of overkilling this one.
        this.reserve(shot, target);
        const p = this.projectilePool.pop() || new Projectile(this.fxLayer);
        p.launch(shot, cfg, target, fromX, fromY, angleDeg, speed, tower.scale);
        this.projectiles.push(p);
        if (!this.demo) G.main.playSfx('shoot_' + shot.towerId, 'shoot');
    }

    private avoidsOverkill(towerId: string): boolean { const d = ConfigMgr.towerDef(towerId); return !!(d && d.avoidOverkill); }

    /** computeDamage without the random parts (no dodge, no crit). */
    expectedDamage(shot: ShotInfo, e: Enemy): number {
        const base = shot.damage * (1 + this.buff('damage', shot.towerId) / 100);
        let normal = -Infinity;
        for (const type of shot.damageTypes) {
            let d = base * this.defenseMultiplier(e, type);
            d *= 1 + e.markBonus(shot.towerId, type) / 100;
            if (type === 'physic') d *= 1 - e.abilityValue('physicDamageReduction') / 100;
            if (d > normal) normal = d;
        }
        if (shot.isAoe) normal *= 1 - e.abilityValue('aoeReduction') / 100;
        return Math.max(1, Math.floor(normal));
    }

    /**
     * The enemy of a shot died before the shot landed: send the shot to the nearest living enemy
     * (within REDIRECT_RANGE) that is not already doomed, so the shot is not wasted.
     */
    private redirect(p: Projectile) {
        // When every enemy around is already doomed, the shot still goes to the nearest one: the reserved shots
        // may miss or be dodged, and an area shot still hits the enemies around it.
        let best: Enemy | null = null, bestD = REDIRECT_RANGE * REDIRECT_RANGE;
        let fallback: Enemy | null = null, fallbackD = REDIRECT_RANGE * REDIRECT_RANGE;
        for (const e of this.enemies) {
            if (!e.alive || e.x > ConfigMgr.tower.battlefield.worldWidth) continue;
            const dx = e.x - p.tx, dy = e.y - p.ty, d = dx * dx + dy * dy;
            if (this.doomed(e)) { if (d < fallbackD) { fallbackD = d; fallback = e; } continue; }
            if (d < bestD) { bestD = d; best = e; }
        }
        best = best || fallback;
        if (!best) return;
        p.target = best;
        this.unreserve(p.shot);
        this.reserve(p.shot, best);
    }

    /**
     * Reserve the expected damage of a flying shot: on its target and, for an area shot, on the
     * enemies close around it (they are very likely inside the explosion when it lands).
     * Other towers then skip the enemies these reservations already kill.
     */
    private reserve(shot: ShotInfo, target: Enemy) {
        const list: Reservation[] = [];
        const add = (e: Enemy) => {
            const amount = this.expectedDamage(shot, e);
            e.pendingDamage += amount;
            list.push({ e, serial: e.serial, amount });
        };
        add(target);
        if (shot.isAoe && shot.explosionRange > 0) {
            const r = shot.explosionRange * SPLASH_RESERVE, r2 = r * r;
            for (const o of this.enemies) {
                if (o === target || !o.alive) continue;
                const dx = o.x - target.x, dy = o.y - target.y;
                if (dx * dx + dy * dy <= r2) add(o);
            }
        }
        (shot as any).reserved = list;
    }

    /** Give back the reservations of a shot (it landed or changed target). */
    private unreserve(shot: ShotInfo) {
        const list: Reservation[] | undefined = (shot as any).reserved;
        if (!list) return;
        for (const r of list) if (r.e.serial === r.serial) r.e.pendingDamage = Math.max(0, r.e.pendingDamage - r.amount);
        (shot as any).reserved = null;
    }

    // ------------------------------------------------------------------ damage pipeline
    /**
     * The one place where tower damage is computed:
     *  1-2 base damage with damage buffs
     *  3-5 effective defense (may be negative) -> multiplier -> normal damage
     *      (for physic+magic towers the higher of the two results is used)
     *  6-7 critical roll and multiplier
     *  8-9 floor, minimum 1
     */
    computeDamage(shot: ShotInfo, e: Enemy, baseMul = 1, flatBonus = 0): DamageResult {
        const rm = this.rm;
        if (Math.random() * 100 < e.abilityValue('dodge')) return { amount: 0, crit: false, dodged: true };
        const base = shot.damage * baseMul * (1 + this.buff('damage', shot.towerId) / 100);
        let normal = -Infinity, amp = 0, ampType: DamageType = 'physic';
        const open = this.hasPassive('p_open_season') ? (passiveParams('p_open_season').share || 0.333) : 0;
        for (const type of shot.damageTypes) {
            let d = base * this.defenseMultiplier(e, type);
            const mark = e.markBonus(shot.towerId, type, open) / 100;
            d *= 1 + mark;
            if (type === 'physic') d *= 1 - e.abilityValue('physicDamageReduction') / 100;
            if (d > normal) { normal = d; amp = mark > 0 ? d - d / (1 + mark) : 0; ampType = type; }
        }
        if (shot.isAoe) { const k = 1 - e.abilityValue('aoeReduction') / 100; normal *= k; amp *= k; }
        // Passives: Bitter Cold (Crystal vs slowed enemies), Aftershock (after a Shockwave stun).
        let more = 1;
        if (shot.towerId === 'crystal' && e.slowed && this.hasPassive('p_bitter_cold')) more += (passiveParams('p_bitter_cold').crystalDamage || 15) / 100;
        if (e.aftershock > 0 && this.hasPassive('p_aftershock')) more += (passiveParams('p_aftershock').damage || 30) / 100;
        normal *= more; amp *= more;
        normal += flatBonus;
        const critRate = Math.max(0, Math.min(100, shot.critRate + this.buff('critRate', shot.towerId)));
        let critDamage = shot.critDamage + this.buff('critDamage', shot.towerId);
        if (e.armorBroken && this.hasPassive('p_exposed')) critDamage += passiveParams('p_exposed').critDamage || 25;
        const crit = Math.random() * 100 < critRate;
        const mul = crit ? critDamage / 100 : 1;
        const final = normal * mul;
        return { amount: Math.max(1, Math.floor(final + 1e-6)), crit, dodged: false, flat: Math.max(0, flatBonus * mul), amp: Math.max(0, amp * mul), ampType };
    }

    /** 1 - EffectiveDefense / 100, where EffectiveDefense = def * 2 - reductions (not clamped). */
    defenseMultiplier(e: Enemy, type: DamageType): number {
        const def = type === 'physic' ? e.physicDef : e.magicDef;
        const reduction = this.buff(type === 'physic' ? 'enemyPhysicDefReduce' : 'enemyMagicDefReduce') + e.defReduction(type);
        const effective = def * 2 - reduction;
        return 1 - effective / 100;
    }

    /** Steps 10-12: apply to HP, check death, pay the reward once. */
    private applyDamage(e: Enemy, res: DamageResult) {
        if (!e.alive) return;
        if (res.dodged) { this.enemyFloat(e, 'MISS', '#cccccc', 13); return; }
        if (!this.demo && this.ctxTower) this.recordHit(e, res);
        const shielded = e.shieldHp > 0;
        const died = e.takeDamage(res.amount);
        // Crits: red, bigger, with a thick outline so they look bold. Light blue: absorbed by a spell shield.
        if (shielded) this.enemyFloat(e, res.amount + (res.crit ? '!' : ''), '#8fd8ff', res.crit ? 17 : 14);
        else if (res.crit) this.enemyFloat(e, res.amount + '!', '#ff3030', 19, 3);
        else this.enemyFloat(e, String(res.amount), '#ffffff', 15);
        if (died) this.onEnemyKilled(e);
    }

    // ------------------------------------------------------------------ skills (ISkillHost)
    /** Skill damage: true damage (no defense, no crit), counted under "Skills" in the wave statistics. */
    skillHit(e: Enemy, amount: number, skill: any) {
        // Spell Weave: Arcane Vulnerability stacks raise skill damage by a share of their value.
        if (this.hasPassive('p_spell_weave')) amount = Math.floor(amount * (1 + e.markBonus('', 'magic') * (passiveParams('p_spell_weave').share || 0.5) / 100));
        const prevTower = this.ctxTower, prevEffect = this.ctxEffect;
        this.ctxTower = 'skill';
        this.ctxEffect = { key: 'skill_' + skill.id, name: skill.name };
        if (!this.demo) this.stats.tower('skill', 'Skills');
        this.applyDamage(e, { amount, crit: false, dodged: false });
        this.ctxTower = prevTower;
        this.ctxEffect = prevEffect;
    }

    skillCast(skill: any) {
        if (this.demo) return;
        this.stats.tower('skill', 'Skills');
        this.stats.trigger('skill_' + skill.id, skill.name, 'skill', !!(skill.effect && skill.effect.damagePct));
    }

    /** Holy Heal: the wall gets its full HP back. */
    healWall() {
        if (this.demo) return;
        const max = this.rm.wallMaxHp();
        const gain = Math.max(0, max - this.rm.data.wallHp);
        this.rm.data.wallHp = max;
        this.rm.notify();
        this.float('+' + Math.round(gain), this.wallRightX - 20, 470, '#7bd66a', 20, true);
        this.events.onWallChanged();
    }

    /** Wave statistics of one hit: HP really removed, split between the tower and its effects. */
    private recordHit(e: Enemy, res: DamageResult) {
        const eff = Math.min(res.amount, Math.max(0, e.hp));
        if (eff <= 0) return;
        const st = this.stats, tower = this.ctxTower;
        st.damage(tower, eff);
        if (this.ctxEffect) { st.effectDamage(this.ctxEffect.key, this.ctxEffect.name, tower, eff); return; }
        const k = eff / res.amount;
        if (res.flat && this.ctxFlat.length > 0) {
            let sum = 0;
            for (const f of this.ctxFlat) sum += f.amount;
            for (const f of this.ctxFlat) if (sum > 0) st.effectDamage(f.key, f.name, tower, res.flat * k * f.amount / sum);
        }
        if (res.amp) {
            // Extra damage of a damage mark: Hunter's Mark (Crossbow) or Arcane Vulnerability (magic).
            const hunter = res.ampType !== 'magic';
            st.effectDamage((hunter ? 'amp_hunter_' : 'amp_arcane_') + tower, hunter ? "Hunter's Mark (bonus damage)" : 'Arcane Vulnerability (bonus damage)', tower, res.amp * k, false);
        }
    }

    private onEnemyKilled(e: Enemy) {
        if (e.rewarded) return;
        e.rewarded = true;
        if (!this.demo) this.stats.kills++;
        if (!this.demo) this.onKillPassives(e);
        const gold = this.demo ? e.goldReward : this.rm.killGold(e.goldReward) + (!e.boss && this.hasPassive('p_treasure_hunter') ? (passiveParams('p_treasure_hunter').gold || 1) : 0);
        this.float('+' + gold, e.x + 8, e.y - 6, '#f2c14e', 15, true, 'gold');
        if (this.demo) return;
        this.goldFromKills += gold;
        this.rm.add({ gold });
        if (e.boss) {
            // Bosses drop Energy Cores.
            // waves.json "bossCoreDrop": base + floor(wave / perWaves) cores per boss (more in the later waves).
            const drop = ConfigMgr.waves.bossCoreDrop || {};
            const cores = typeof drop === 'number' ? drop : (drop.base || 0) + (drop.perWaves > 0 ? Math.floor(this.wave / drop.perWaves) : 0);
            if (cores > 0) {
                this.coresFromKills += cores;
                this.rm.add({ core: cores });
                this.float('+' + cores, e.x + 8, e.y + 18, '#7fd8ff', 18, true, 'core');
            }
        }
        G.main.playSfx('die_' + e.def.id, e.def.sfx && e.def.sfx.die);
        G.main.playSfx('coin');
    }

    /** Passives that act when an enemy dies: Prey (marks move on), Treasure Hunter and Spoils of War (bosses). */
    private onKillPassives(e: Enemy) {
        if (this.hasPassive('p_prey')) {
            const m = e.deathStatuses.find(x => x.def.id === 'hunter_mark');
            if (m && m.stacks >= Math.max(1, m.def.maxStacks || 1)) {
                const p = passiveParams('p_prey');
                let best = (p.range || 200) * (p.range || 200), next: Enemy | null = null;
                for (const o of this.enemies) {
                    if (o === e || !o.alive) continue;
                    const d = (o.x - e.x) * (o.x - e.x) + (o.y - e.y) * (o.y - e.y);
                    if (d <= best) { best = d; next = o; }
                }
                if (next) {
                    for (let i = 0; i < Math.min(p.stacks || 3, m.def.maxStacks || 1); i++) next.applyStatus(m.def, m.sourceUid);
                    this.lineFx(e.x, e.y, next.x, next.y, '#ffffff');
                }
            }
        }
        if (!e.boss) return;
        if (this.hasPassive('p_treasure_hunter')) {
            const p = passiveParams('p_treasure_hunter');
            const gold = p.bossGold || 8888, core = p.bossCore || 1;
            this.rm.add({ gold, core });
            this.goldFromKills += gold;
            this.coresFromKills += core;
            this.float('+' + gold, e.x + 8, e.y + 40, '#f2c14e', 18, true, 'gold');
        }
        if (this.hasPassive('p_spoils_of_war')) this.rm.data.spoilsPending = true;
    }

    /** Damage over time from Bleed / Burn. Goes through defense but never crits. */
    applyDot(e: Enemy, rawDamage: number, type: DamageType, statusType: string, sourceUid = 0, statusId = '', currentHpPct = 0) {
        if (!e.alive) return;
        const buff = this.buff(statusType === 'bleed' ? 'bleedDamage' : 'burnDamage');
        // Hemorrhage (Bleeding Bolt Mastery 3): + a share of the current HP per tick, not reduced by defense.
        const extra = currentHpPct > 0 ? e.hp * currentHpPct / 100 * this.percentHpMul(e) : 0;
        const amount = Math.max(1, Math.floor(rawDamage * (1 + buff / 100) * this.defenseMultiplier(e, type) + extra));
        if (!this.demo) {
            const src = this.towerByUid(sourceUid);
            const tower = src ? src.save.id : 'other';
            if (!src) this.stats.tower('other', 'Other');
            const def = ConfigMgr.statusDef(statusId);
            const eff = Math.min(amount, Math.max(0, e.hp));
            this.stats.damage(tower, eff);
            this.stats.effectDamage('dot_' + (statusId || statusType), ((def && def.name) || statusType) + ' (damage over time)', tower, eff, false);
        }
        const died = e.takeDamage(amount);
        this.enemyFloat(e, String(amount), statusType === 'bleed' ? '#ff7a7a' : '#ffa64d', 13);
        if (died) this.onEnemyKilled(e);
    }

    /**
     * Explosion at (x,y): every living enemy whose center is inside the radius
     * takes full damage exactly once. Damage and crits are rolled per enemy.
     */
    explode(shot: ShotInfo, x: number, y: number, primary: Enemy | null, projCfg: any) {
        const hit: Enemy[] = [];
        const r2 = shot.explosionRange * shot.explosionRange;
        const noFlying = !this.hitsFlying(shot.towerId);
        for (const e of this.enemies) {
            if (!e.alive || (noFlying && e.flying)) continue;
            const dx = e.x - x, dy = e.y - y;
            if (e === primary || dx * dx + dy * dy <= r2) hit.push(e);
        }
        this.impactFx(shot, x, y);
        const tower = this.towerByUid(shot.towerUid);
        const st = this.demo ? null : this.stats;
        if (st) st.shot(shot.towerId, hit.length > 0);
        this.ctxTower = shot.towerId;
        // "effectChance" (Arcane Mastery research, heroes) adds percentage points on top of the effect's
        // own chance and above its cap: a researched effect at 50% becomes 75% with +25%.
        const extra = this.buff('effectChance', shot.towerId);
        const chance = (ef: any) => ef.unlocked || ef.chance > 0 ? Math.min(100, Math.min(ef.maxChance || 100, ef.chance) + extra) : 0;
        const ready = (ef: any) => !tower || !(tower.effectCooldowns[ef.id] > 0);
        const used = (ef: any) => { if (tower && ef.cooldown > 0) tower.effectCooldowns[ef.id] = ef.cooldown; };
        const statusCount: { [id: string]: number } = {};
        const hitDamage = shot.damage * (1 + this.buff('damage', shot.towerId) / 100);

        for (const e of hit) {
            // Pre-damage effects (Heavy Impact: flat bonus, or a share of the max HP with Mastery).
            let bonus = 0;
            this.ctxFlat.length = 0;
            for (const ef of shot.effects) {
                if (ef.kind === 'bonusMaxHp' && ready(ef) && Math.random() * 100 < chance(ef)) {
                    const b = this.heavyBonus(ef, shot, e);
                    bonus += b;
                    if (st) { st.trigger(ef.id, ef.name, shot.towerId, true); this.ctxFlat.push({ key: ef.id, name: ef.name, amount: b }); }
                }
            }
            const mb = this.markHpBonus(shot, e);
            if (mb > 0) {
                bonus += mb;
                if (st) { st.trigger('hunter_full', "Hunter's Mark x5 (+1% current HP)", shot.towerId, true); this.ctxFlat.push({ key: 'hunter_full', name: "Hunter's Mark x5 (+1% current HP)", amount: mb }); }
            }
            this.applyDamage(e, this.computeDamage(shot, e, 1, bonus));
            this.ctxFlat.length = 0;
            if (!e.alive) continue;
            // Post-damage effects: status effects on the enemies that were hit.
            this.rollStatuses(shot, e, statusCount, chance, ready, hitDamage);
        }
        for (const ef of shot.effects) if (ef.kind === 'status' && statusCount[ef.id]) used(ef);

        // Chain / pierce: jumps from the impact point to enemies that were not hit yet.
        for (const ef of shot.effects) {
            // "fromImpact" (Chain Lightning): the lightning jumps from the impact point even when the shot hit no enemy.
            if (ef.kind !== 'chain' || !ready(ef) || (hit.length === 0 && !ef.fromImpact)) continue;
            if (Math.random() * 100 >= chance(ef)) continue;
            used(ef);
            if (!this.demo) G.main.playSfx(shot.damageTypes[0] === 'magic' ? 'fx_lightning' : 'hit_' + shot.towerId);
            let jumped = false;
            const lightning = ef.id === 'chain_lightning';
            const conductor = lightning && this.hasPassive('p_conductor');
            const overload = lightning && this.hasPassive('p_overload') ? (passiveParams('p_overload').perJump || 10) : 0;
            const skewer = ef.id === 'piercing_bolt' && this.hasPassive('p_skewer');
            let fromX = x, fromY = y;
            for (let n = 0; n < (ef.maxTargets || 1); n++) {
                const next = this.nextJump(hit, fromX, fromY, ef.range, conductor);
                if (!next) break;
                hit.push(next);
                this.lineFx(fromX, fromY, next.x, next.y, shot.damageTypes[0] === 'magic' ? '#9fe8ff' : '#ffffff');
                fromX = next.x; fromY = next.y;
                jumped = true;
                // Flat damage (through defense, no crit), or a share of the hit with Mastery, whichever is bigger.
                // Overload: every jump deals perJump % more (of the hit: + perJump points).
                const k = 1 + overload * n / 100;
                const flat = this.flatHit(next, ef.flat * k, shot.damageTypes);
                const share = ef.hitPct > 0 ? this.computeDamage(shot, next, (ef.hitPct + overload * n) / 100, this.markHpBonus(shot, next)) : null;
                this.ctxEffect = { key: ef.id, name: ef.name };
                this.applyDamage(next, share && share.amount > flat.amount ? share : flat);
                this.ctxEffect = null;
                if (!next.alive) continue;
                if (conductor && next.slowed) this.stunFor(next, passiveParams('p_conductor').stun || 0.3, shot.towerUid);
                // Skewer: the pierced enemies can get the Crossbow's status effects too.
                // (their own count: the shot's status limits are for the explosion targets).
                if (skewer) this.rollStatuses(shot, next, {}, chance, ready, hitDamage);
            }
            if (st && jumped) st.trigger(ef.id, ef.name, shot.towerId, true);
        }
        this.ctxTower = '';
        if (!this.demo) {
            // Catapult stones crash down (explode), the other towers have their own hit sound.
            if (shot.towerId === 'catapult') G.main.playSfx('explode');
            else G.main.playSfx('hit_' + shot.towerId, shot.isAoe ? 'explode' : 'hit');
        }
    }

    /** False for towers that cannot hit flying enemies (tower.json "hitsFlying": false, the Catapult). */
    private hitsFlying(towerId: string): boolean {
        const t = ConfigMgr.towerDef(towerId);
        return !t || t.hitsFlying !== false;
    }

    /** Next enemy of a chain: the closest one not hit yet; with Conductor a slowed one first. */
    private nextJump(hit: Enemy[], fromX: number, fromY: number, range: number, preferSlowed: boolean): Enemy | null {
        let next: Enemy | null = null, slowed: Enemy | null = null;
        let best = range * range, bestSlow = range * range;
        for (const e of this.enemies) {
            if (!e.alive || hit.indexOf(e) >= 0) continue;
            const d = (e.x - fromX) * (e.x - fromX) + (e.y - fromY) * (e.y - fromY);
            if (d <= best) { best = d; next = e; }
            if (preferSlowed && d <= bestSlow && e.slowed) { bestSlow = d; slowed = e; }
        }
        return slowed || next;
    }

    /** Flat effect damage: through defense (the best of the shot's damage types), never a crit. */
    private flatHit(e: Enemy, amount: number, types: DamageType[]): DamageResult {
        let m = 0;
        for (const t of types) m = Math.max(m, this.defenseMultiplier(e, t));
        return { amount: Math.max(1, Math.floor(amount * m)), crit: false, dodged: false };
    }

    /** Heavy Impact bonus: flat, or a share of the max HP (Mastery) when bigger; Crusher / Giant Slayer passives. */
    private heavyBonus(ef: any, shot: ShotInfo, e: Enemy): number {
        let pct = 0;
        if (ef.value > 0) pct = Math.min(ef.capHitMul ? shot.damage * ef.capHitMul : (ef.cap || Infinity), e.maxHp * ef.value / 100 * this.percentHpMul(e));
        let b = Math.max(ef.flat || 0, pct);
        if ((e.armorBroken || e.stunned) && this.hasPassive('p_crusher')) b *= passiveParams('p_crusher').mul || 1.667;
        if (e.boss && this.hasPassive('p_giant_slayer')) b *= passiveParams('p_giant_slayer').bossMul || 1.5;
        return b;
    }

    /** Rolls the status effects of a shot on one enemy (explosion targets, and pierced enemies with Skewer). */
    private rollStatuses(shot: ShotInfo, e: Enemy, statusCount: { [id: string]: number }, chance: (ef: any) => number, ready: (ef: any) => boolean, hitDamage: number) {
        const st = this.demo ? null : this.stats;
        for (const ef of shot.effects) {
            if (ef.kind !== 'status' || !ready(ef) || !e.alive) continue;
            if ((statusCount[ef.id] || 0) >= (ef.maxTargets || 1)) continue;
            if (Math.random() * 100 >= chance(ef)) continue;
            const def = ef.status || ConfigMgr.statusDef(ef.statusId);
            const wasSlowed = e.slowed;
            // Bleed: flat damage per second per stack (+ a share of the hit with Mastery).
            const value = def.type === 'bleed' ? (ef.flat || 0) + hitDamage * (ef.hitPct || 0) / 100 : undefined;
            const landed = this.applyStatusFromTower(e, def, shot.towerUid, hitDamage, value);
            if (st) { if (landed === 'landed') st.trigger(ef.id, ef.name, shot.towerId); else if (landed === 'resisted') st.resist(ef.id, ef.name, shot.towerId); }
            if (!statusCount[ef.id] && !this.demo) this.effectSfx(def.id);
            statusCount[ef.id] = (statusCount[ef.id] || 0) + 1;
            if (landed === 'resisted') continue;
            if (def.type === 'stun') {
                // Shockwave: flat damage on every enemy it reaches (stunned or immune).
                if (ef.flat > 0 && e.alive) this.hitAsEffect(e, this.flatHit(e, ef.flat, shot.damageTypes).amount, ef.id + '_flat', ef.name + ' (damage)', shot.towerId, false);
                if (landed === 'landed' && this.hasPassive('p_aftershock')) e.aftershock = def.duration + (passiveParams('p_aftershock').time || 1);
            }
            if (landed !== 'landed' || !e.alive) continue;
            if (def.id === 'slow' && this.hasPassive('p_deep_freeze')) {
                // Deep Freeze: a slowed enemy hit by Frost again `hits` times is frozen.
                const p = passiveParams('p_deep_freeze');
                if (!wasSlowed) e.frostHits = 0;
                else if (++e.frostHits >= (p.hits || 2)) { e.frostHits = 0; this.stunFor(e, p.stun || 1, shot.towerUid, 'FROZEN'); }
            }
            if (def.type === 'bleed' && ef.spread) this.spreadBleed(e, def, shot.towerUid, value || 0, ef.spread);
            if (def.id === 'arcane_mark' && this.hasPassive('p_arcane_rupture') && e.stacksOf(def.id) >= Math.max(1, def.maxStacks || 1)) this.arcaneRupture(e, ef, shot, hitDamage);
        }
    }

    /** Hemorrhage: an enemy whose Bleed just reached its full stacks spreads stacks to the enemies nearby. */
    private spreading = false;
    private spreadBleed(e: Enemy, def: any, sourceUid: number, value: number, spread: { stacks: number; range: number }) {
        if (this.spreading || e.stacksOf(def.id) < Math.max(1, def.maxStacks || 1)) return;
        this.spreading = true;
        const r2 = spread.range * spread.range;
        for (const o of this.enemies) {
            if (o === e || !o.alive) continue;
            if ((o.x - e.x) * (o.x - e.x) + (o.y - e.y) * (o.y - e.y) > r2) continue;
            for (let i = 0; i < spread.stacks && o.alive; i++) this.applyStatusFromTower(o, def, sourceUid, 0, value);
        }
        this.spreading = false;
    }

    /** Arcane Rupture: full Arcane Vulnerability stacks explode (max HP share with Mastery 3, flat before). */
    private arcaneRupture(e: Enemy, ef: any, shot: ShotInfo, hitDamage: number) {
        const p = passiveParams('p_arcane_rupture');
        const full = ef.mastery >= 3;
        e.clearStatus('arcane_mark');
        const r2 = (p.range || 100) * (p.range || 100);
        this.ringFxAt(e.x, e.y, p.range || 100, '#b48cff');
        for (const o of this.enemies.slice()) {
            if (!o.alive || (o.x - e.x) * (o.x - e.x) + (o.y - e.y) * (o.y - e.y) > r2) continue;
            const amount = full
                ? Math.max(1, Math.floor(this.capPercentHp(o.maxHp * (p.maxHpPct || 4) / 100 * this.percentHpMul(o), hitDamage, shot.towerId)))
                : this.flatHit(o, ef.flat || 0, ['magic']).amount;
            this.hitAsEffect(o, amount, 'arcane_rupture', 'Arcane Rupture', shot.towerId);
        }
    }

    /** Stun of a passive (Deep Freeze, Conductor): the Stun status for `seconds`, stun immunity still applies. */
    private stunFor(e: Enemy, seconds: number, sourceUid: number, text = '') {
        const base = ConfigMgr.statusDef('stun');
        if (!base || e.isImmune('stun') || !e.alive) return;
        const def = Object.assign({}, base, { duration: seconds, immuneHit: null });
        if (e.applyStatus(def, sourceUid) && text) this.enemyFloat(e, text, '#9fe8ff', 13);
    }

    /** Sound of a status effect landing (Frost slow, Bleed, Shockwave stun). */
    private effectSfx(statusId: string) {
        const def = ConfigMgr.statusDef(statusId);
        if (!def) return;
        if (def.type === 'slow') G.main.playSfx('fx_frost');
        else if (def.type === 'bleed') G.main.playSfx('fx_bleed');
        else if (def.type === 'stun') G.main.playSfx('wall_hit');
    }

    /**
     * `def`: the status (the resolved copy of the tower effect, see EffectScaling). `hitDamage`: damage of the
     * shot before defense (statuses with "percentOfHit", caps of the max HP shares). `value`: the status value
     * when the effect gives it (Bleed). Returns 'landed', 'resisted', or 'immune' (blocked by the immunity; may
     * have dealt the stun-immune hit instead).
     */
    private applyStatusFromTower(e: Enemy, def: any, sourceUid: number, hitDamage = 0, value?: number): 'landed' | 'resisted' | 'immune' {
        if (!def) return 'resisted';
        const src = this.towerByUid(sourceUid);
        const srcId = src ? src.save.id : '';
        if (e.isImmune(def.type)) {
            // Stun immunity: a stunning hit that lands during the immunity deals a share of the max HP instead (effects.json "immuneHit").
            if (def.immuneHit && def.immuneHit.maxHpPct > 0 && !e.resists(def)) { // the hit must still beat the resistance
                const amount = Math.max(1, Math.floor(this.capPercentHp(e.maxHp * def.immuneHit.maxHpPct / 100 * this.percentHpMul(e), hitDamage, srcId)));
                this.hitAsEffect(e, amount, 'immune_' + def.id, def.name + ' (immune: ' + def.immuneHit.maxHpPct + '% max HP)', srcId);
            }
            return 'immune';
        }
        let durationMul = 1, valueMul = 1;
        if (value !== undefined) valueMul = Math.max(0.01, value) / Math.max(0.0001, def.value || 1);
        else if (def.percentOfHit) valueMul = Math.max(0.01, hitDamage / 100);
        if (def.type === 'slow') { durationMul += this.buff('slowDuration') / 100; valueMul += this.buff('slowEffect') / 100; }
        if (def.type === 'stun') durationMul += this.buff('stunDuration') / 100;
        if (!e.applyStatus(def, sourceUid, durationMul, valueMul)) {
            // Marks and Bleed land many times per second: no "RESIST" text for them (it would cover the field).
            if (def.type !== 'mark' && def.type !== 'bleed') this.enemyFloat(e, 'RESIST', '#aaaaaa', 12);
            return 'resisted';
        }
        // Burst at full stacks (Bleed x5, Deep Cuts: one stack earlier): the stacks are removed and the enemy loses a share of its max HP.
        const burst = def.burstAtMaxStacks;
        if (burst && e.stacksOf(def.id) >= Math.max(1, burst.stacks || def.maxStacks || 1)) {
            e.clearStatus(def.id);
            const amount = Math.max(1, Math.floor(this.capPercentHp(e.maxHp * (burst.maxHpPct || 0) / 100 * this.percentHpMul(e), hitDamage, srcId)));
            this.hitAsEffect(e, amount, 'burst_' + def.id, def.name + ' burst (x' + (burst.stacks || def.maxStacks || 1) + ')', srcId);
        }
        return 'landed';
    }

    /** Damage dealt by an effect on its own (Bleed burst, stun-immune hit): shown as a red number, counted for that effect. */
    private hitAsEffect(e: Enemy, amount: number, key: string, name: string, towerId: string, big = true) {
        const prevTower = this.ctxTower, prevEffect = this.ctxEffect;
        this.ctxTower = towerId || prevTower;
        this.ctxEffect = { key, name };
        if (!this.demo && this.ctxTower) this.stats.trigger(key, name, this.ctxTower, true);
        this.applyDamage(e, { amount, crit: big, dodged: false });
        this.ctxTower = prevTower;
        this.ctxEffect = prevEffect;
    }

    /** Extra damage of a hit on an enemy whose mark from this tower is at full stacks (Hunter's Mark x5: 1% of current HP). */
    private markHpBonus(shot: ShotInfo, e: Enemy): number {
        const full = e.fullMark(shot.towerId);
        if (!full || !full.currentHpPct) return 0;
        return this.capPercentHp(e.hp * full.currentHpPct / 100 * this.percentHpMul(e), shot.damage * (1 + this.buff('damage', shot.towerId) / 100), shot.towerId);
    }

    /** Effects based on a share of the HP (Heavy Impact, Bleed burst, Hunter's Mark x5, stun-immune hit) are weaker on bosses (effects.json "bossPercentHpMul"). */
    /**
     * Damage based on a share of the HP is limited to effects.json "percentHpCapHitMul" times the damage of
     * the hit that caused it ("percentHpCapByTower" overrides it per tower) (before defense), so enemy HP keeps mattering in the late waves.
     */
    private capPercentHp(amount: number, hitDamage: number, towerId = ''): number {
        const byTower = ConfigMgr.effects.percentHpCapByTower || {};
        const k = byTower[towerId] > 0 ? byTower[towerId] : ConfigMgr.effects.percentHpCapHitMul;
        return k > 0 && hitDamage > 0 ? Math.min(amount, hitDamage * k) : amount;
    }

    private percentHpMul(e: Enemy): number {
        const m = ConfigMgr.effects.bossPercentHpMul;
        return e.boss && m > 0 ? m : 1;
    }

    private towerByUid(uid: number): TowerUnit | null {
        for (const t of this.towers) if (t.uid === uid) return t;
        return null;
    }

    // ------------------------------------------------------------------ wall
    /** Called once per enemy when it touches the wall. */
    onEnemyReachedWall(e: Enemy) {
        this.wallHit(e.wallDamage(), e.def.damageType, e.y);
    }

    /**
     * A hit on the wall: an enemy touching it (it dies), or the projectile of a ranged enemy.
     * `raw`: damage before the wall defense; `y`: where it lands (texts, Barrier Block).
     */
    wallHit(raw: number, damageType: string, y: number) {
        if (this.demo) {
            // Immortal wall: only the hit number is shown.
            this.float('-' + Math.floor(raw), this.wallRightX - 20, y + 20, '#ff6b6b', 18, true);
            return;
        }
        if (this.barrierCharges > 0) {
            // Barrier Block: the hit is stopped where it touches the wall.
            this.barrierCharges--;
            this.skills.barrierHit(y);
            this.float('BLOCK', this.wallRightX + 10, y + 20, '#9fe8ff', 16, true);
            return;
        }
        const type: DamageType = damageType === 'magic' ? 'magic' : 'physic';
        // Bulwark: the wall defense is multiplied while it lasts (at most 90).
        const def = this.bulwarkTime > 0 ? Math.min(90, this.rm.wallDef(type) * (passiveParams('p_bulwark').mul || 3)) : this.rm.wallDef(type);
        const amount = Math.max(0, Math.floor(raw * (1 - def / 100)));
        // Last Stand: the wall stays at 1 HP for a while instead of falling.
        if (this.rm.data.wallHp - amount < 1 && this.lastStandTime <= 0 && this.passiveReady('p_last_stand')) {
            this.lastStandTime = passiveParams('p_last_stand').time || 20;
            this.startPassiveCooldown('p_last_stand');
            this.float('LAST STAND', this.wallRightX + 10, 360, '#ffe08a', 22, true);
        }
        const destroyed = this.lastStandTime > 0
            ? (this.rm.data.wallHp = Math.max(1, this.rm.data.wallHp - amount), false)
            : this.rm.damageWall(amount);
        const bw = passiveParams('p_bulwark');
        if (!destroyed && this.bulwarkTime <= 0 && this.rm.data.wallHp < this.rm.wallMaxHp() * (bw.hpPct || 50) / 100 && this.passiveReady('p_bulwark')) {
            this.bulwarkTime = bw.time || 30;
            this.startPassiveCooldown('p_bulwark');
            this.float('BULWARK', this.wallRightX + 10, 330, '#9fe8ff', 22, true);
        }
        this.float('-' + amount, this.wallRightX - 20, y + 20, '#ff6b6b', 18, true);
        G.main.playSfx('wall_hit', 'hit');
        this.events.onWallChanged();
        if (destroyed && !this.gameOver) {
            this.gameOver = true;
            this.active = false;
            this.skills.clear();
            this.events.onGameOver(this.wave);
        }
    }

    // ------------------------------------------------------------------ visual feedback
    float(str: string, x: number, y: number, color: string, size: number, important = false, icon?: string) {
        if (!important && this.floats.length >= MAX_FLOAT_TEXTS) return; // keep big fights readable
        const t = this.textPool.pop() || new CombatText(this.textLayer);
        t.show(str, x, y, color, size, 0.8, icon);
        this.floats.push(t);
    }

    /**
     * Text on an enemy: stacked in rows above the status label, at most TEXT_ROWS rows
     * (a new text pushes the others up; the oldest one disappears).
     */
    enemyFloat(e: Enemy, str: string, color: string, size: number, outline = 2) {
        if (!Display.damageNumbers || this.floats.length >= MAX_FLOAT_TEXTS) return;
        let st = this.stacks.get(e);
        if (!st) { st = []; this.stacks.set(e, st); }
        if (st.length >= TEXT_ROWS) { const old = st.shift()!; old.row = TEXT_ROWS; old.stack = null; old.expire(); }
        const t = this.textPool.pop() || new CombatText(this.textLayer);
        t.showOn(e, 0, e.radius + 36, TEXT_ROW_H, str, color, size, 0.8, outline);
        t.stack = st;
        st.push(t);
        for (let i = 0; i < st.length; i++) st[i].row = st.length - 1 - i;
        this.floats.push(t);
    }

    /** The enemy is going back to the pool: its texts stop following it. */
    private dropTexts(e: Enemy) {
        const st = this.stacks.get(e);
        if (!st) return;
        for (const t of st) t.detach();
        this.stacks.delete(e);
    }

    /** A pooled effect node of one kind (created the first time). */
    private takeFx(kind: 'impact' | 'ground' | 'ring' | 'line'): Fx {
        const f = this.fxPool[kind].pop();
        if (f) { f.node.active = true; return f; }
        if (kind === 'impact' || kind === 'ground') {
            const sp = sprite(kind === 'ground' ? this.groundFxLayer : this.fxLayer, null, 1, 1);
            if (kind === 'ground') sp.color = new Color(255, 255, 255, 200);   // a bit see-through on the ground
            return { kind, node: sp.node, anim: new SpriteAnim(sp), life: 0, total: 1 };
        }
        const n = mk(kind === 'ring' ? 'Ring' : 'Line', this.fxLayer);
        return { kind, node: n, g: n.addComponent(Graphics), op: n.addComponent(UIOpacity), life: 0, total: 1 };
    }

    private impactFx(shot: ShotInfo, x: number, y: number) {
        if (!Display.effects) return;
        const im = (shot as any).impact;
        if (im) {
            const frames = Assets.pick(im.path, im.cellW, im.cellH, im.frames);
            if (frames.length > 0) {
                // "scaleToExplosion" (Catapult): the blast grows with the explosion (its width is a third of the
                // explosion circle, see the ring) and is drawn under the enemies, so it never hides them.
                const big = !!im.scaleToExplosion && shot.explosionRange > 0;
                const k = big ? Math.max(1, (shot.explosionRange * 2 / 3) / im.cellW) : 1;
                const f = this.takeFx(big ? 'ground' : 'impact');
                const ui = f.node.getComponent(UITransform)!;
                ui.setContentSize(im.cellW * k, im.cellH * k);
                ui.setAnchorPoint(0.5, im.anchorY === undefined ? 0.5 : im.anchorY);
                f.node.setPosition(x, y, 0);
                f.anim!.play(frames, im.frameTime, false);
                this.fx.push(f);
            }
        }
        if (shot.explosionRange >= 30) {
            // Ring that shows the real explosion radius.
            const f = this.takeFx('ring');
            const g = f.g!;
            const c = shot.damageTypes.length > 1 ? '#c8ff7a' : shot.damageTypes[0] === 'magic' ? '#9fe8ff' : '#ffffff';
            g.clear();
            // Almost no fill: many explosions at once must not hide the enemies behind them.
            g.fillColor = hex(c, 8);
            g.circle(0, 0, shot.explosionRange);
            g.fill();
            g.lineWidth = 1.5;
            g.strokeColor = hex(c, 220);
            g.circle(0, 0, shot.explosionRange);
            g.stroke();
            f.node.setPosition(x, y, 0);
            f.life = f.total = 0.28;
            f.op!.opacity = 255;
            this.fx.push(f);
        }
    }

    // ------------------------------------------------------------------ ranged enemies
    /** A ranged enemy releases its projectile (enemy.json "ranged.projectile"): it flies straight to the wall. */
    enemyShoot(e: Enemy) {
        const rg = e.def.ranged;
        const pc = rg && rg.projectile;
        if (!pc) { this.wallHit(e.wallDamage(), e.def.damageType, e.y); return; }
        const f = this.takeFx('impact');
        const ui = f.node.getComponent(UITransform)!;
        ui.setContentSize(pc.cellW, pc.cellH);
        ui.setAnchorPoint(0.5, 0.5);
        const x = e.x + (pc.offsetX || 0) * e.scale, y = e.y + (pc.offsetY || 0) * e.scale;
        f.node.setPosition(x, y, 0);
        f.anim!.play(Assets.frames(pc.path, pc.cellW, pc.cellH).slice(0, pc.frames || 99), pc.frameTime || 0.06, true);
        this.enemyShots.push({ f, x, y, tx: this.wallRightX + 6, tipX: pc.tipX || 0, speed: pc.speed || 300, damage: e.wallDamage(), type: e.def.damageType, impact: rg.impact, boss: e.boss });
        if (!this.demo) G.main.playSfx('shoot_' + e.def.id, e.def.sfx && e.def.sfx.shoot);
    }

    // ------------------------------------------------------------------ Halo Spire
    /** Halos in flight: ring sprite, centre, radius from r0 to r1 over `dur` s, ring radius now / last frame. */
    private halos: Array<{ f: Fx; x: number; y: number; t: number; dur: number; r0: number; r1: number; k: number; alpha: number; r: number; prev: number; left: number }> = [];

    haloActive(): boolean { return this.active && this.enemies.some(e => e.alive); }

    /**
     * A Halo Spire activates: one thin ring grows from just outside the tower ("startRadius") to the halo
     * radius (the level's fixed "attackRange") in "growTime" s and fades out. Every activation counts for the
     * wall mending (research "Mending Halo"): every "mendEvery" activations it restores "mendPct" % of the
     * missing wall HP. Several spires mend one after the other (each one from the wall HP left by the previous one).
     */
    emitHalo(t: TowerUnit) {
        const h = t.lv.sprite.halo;
        if (h) {
            const size = h.size || 256;
            const frames = Assets.frames(h.path, size, size).slice(0, 1);
            const f = this.takeFx('impact');
            f.node.getComponent(UITransform)!.setAnchorPoint(0.5, 0.5);
            f.node.setPosition(t.cx, t.cy, 0);
            f.node.active = frames.length > 0 && Display.effects;
            f.anim!.play(frames, 999, false);
            const r1 = t.stats().range;
            this.halos.push({
                f, x: t.cx, y: t.cy, t: 0, dur: Math.max(0.05, h.growTime || 0.9),
                r0: Math.min(r1, h.startRadius || 0), r1, k: size / 2 / (h.ringRadius || size / 2),
                alpha: h.opacity === undefined ? 255 : h.opacity, r: 0, prev: 0, left: this.haloBlocks(t),
            });
            const nh = this.halos[this.halos.length - 1];
            this.placeHalo(nh);
            nh.prev = nh.r;
        }
        if (this.demo) return;
        t.haloCount++;
        const every = t.lv.mendEvery || 0;
        if (every > 0 && this.buff('haloMend') > 0 && t.haloCount % every === 0) {
            const max = this.rm.wallMaxHp();
            const lost = max - this.rm.data.wallHp;
            const heal = lost * (t.lv.mendPct || 0) / 100;
            if (heal > 0) {
                this.rm.data.wallHp = Math.min(max, this.rm.data.wallHp + heal);
                this.rm.notify();
                this.float('+' + Math.max(1, Math.round(heal)), this.wallRightX + 6, t.cy, '#6ad66a', 16, true);
            }
        }
    }

    /** Ring size and fade for its time: grows fast then slower (ease out), fades in quickly and out at the end. */
    private placeHalo(h: { f: Fx; t: number; dur: number; r0: number; r1: number; k: number; alpha: number; r: number; prev: number; left: number }) {
        const p = Math.min(1, h.t / h.dur);
        const r = h.r0 + (h.r1 - h.r0) * (1 - (1 - p) * (1 - p));
        h.r = r;
        const d = 2 * r * h.k;
        h.f.node.getComponent(UITransform)!.setContentSize(d, d);
        const fade = Math.min(1, p / 0.12, (1 - p) / 0.35);
        const sp = h.f.node.getComponent(Sprite);
        // A halo that has blocked all it can goes on, dimmed.
        if (sp) sp.color = new Color(255, 255, 255, Math.round(h.alpha * Math.max(0, fade) * (h.left > 0 ? 1 : 0.35)));
    }

    /** Projectiles one halo can block: "blockCount" of the level x (1 + Warding Halo level). */
    haloBlocks(t: TowerUnit): number {
        return (t.lv.blockCount || 1) * (1 + (this.demo ? 0 : this.buff('haloBlock')));
    }

    /**
     * Halo rings: an enemy projectile the ring touches vanishes, i.e. one in the band the ring crossed this frame
     * (from its last radius to the new one, plus HALO_EDGE px on each side for the line and the projectile).
     * Projectiles inside the ring, or arriving after it passed, keep flying. Each halo blocks at most
     * haloBlocks() projectiles; boss projectiles are never blocked.
     */
    private updateHalos(dt: number) {
        for (let i = this.halos.length - 1; i >= 0; i--) {
            const h = this.halos[i];
            h.t += dt;
            h.prev = h.r;
            this.placeHalo(h);
            const lo = Math.max(0, h.prev - HALO_EDGE), hi = h.r + HALO_EDGE;
            for (let j = this.enemyShots.length - 1; j >= 0 && h.left > 0; j--) {
                const s = this.enemyShots[j];
                if (s.boss) continue;
                const tipX = s.x + s.tipX;
                const d2 = (tipX - h.x) * (tipX - h.x) + (s.y - h.y) * (s.y - h.y);
                if (d2 < lo * lo || d2 > hi * hi) continue;
                this.enemyShots.splice(j, 1);
                h.left--;
                s.f.node.active = false;
                this.fxPool.impact.push(s.f);
                if (!this.demo) this.stats.trigger('halo_block', 'Halo: enemy projectiles blocked', 'halo');
            }
            if (h.t < h.dur) continue;
            this.halos.splice(i, 1);
            h.f.node.active = false;
            const sp = h.f.node.getComponent(Sprite);
            if (sp) sp.color = Color.WHITE;
            this.fxPool.impact.push(h.f);
        }
    }

    /**
     * Halo Spire buffs (research "Empowering Halo", "haloAura" levels): each spire buffs its "buffTargets"
     * closest other towers (not spires) with "aura" % of their base damage / attack speed per level.
     * A tower buffed by several spires keeps the strongest.
     */
    assignHalos() {
        for (const t of this.towers) { t.halo.damagePct = 0; t.halo.attackSpeedPct = 0; t.halo.from = 0; }
        const level = this.buff('haloAura');
        if (level <= 0) return;
        const others = this.towers.filter(t => !t.isHalo);
        for (const h of this.towers) {
            if (!h.isHalo) continue;
            const a = h.def.aura || {};
            const dmg = (a.damagePctPerLevel || 0) * level, spd = (a.attackSpeedPctPerLevel || 0) * level;
            const near = others.slice().sort((p, q) =>
                ((p.save.x - h.save.x) ** 2 + (p.save.y - h.save.y) ** 2) - ((q.save.x - h.save.x) ** 2 + (q.save.y - h.save.y) ** 2));
            for (const t of near.slice(0, h.lv.buffTargets || 0)) {
                if (dmg + spd <= t.halo.damagePct + t.halo.attackSpeedPct) continue;
                t.halo.damagePct = dmg; t.halo.attackSpeedPct = spd; t.halo.from = h.uid;
            }
        }
    }

    // ------------------------------------------------------------------ boss spells
    /** Minions waiting for their summoning circle (spawn a moment after the cast). */
    private summons: Array<{ t: number; x: number; y: number; spell: any }> = [];

    /**
     * A boss spell takes effect (enemy.json "spells", at the cast frame of its animation):
     *  - "shield": a shield that absorbs "hpPct" % of the boss max HP for "duration" s;
     *  - "summon": "count" minions around the boss ("enemyIds", stats of the current wave), and every enemy
     *    within "haste.radius" gets "haste.speedPct" % more speed for "haste.duration" s.
     * The spell's "vfx" plays at the boss's feet.
     */
    bossSpell(e: Enemy, sp: any) {
        this.groundFx(e, sp.vfx);
        if (sp.type === 'shield' && sp.shield) {
            const sh = sp.shield;
            e.raiseShield(e.maxHp * (sh.hpPct || 20) / 100, sh.duration || 10, sh.loop, sh.collapse);
            this.enemyFloat(e, 'SHIELD', '#8fd8ff', 16);
        }
        if (sp.type === 'summon') {
            const feet = this.feet(e);
            this.summons.push({ t: sp.spawnDelay || 0, x: feet.x, y: e.y, spell: sp });
            const h = sp.haste;
            if (h) {
                const r2 = (h.radius || 250) * (h.radius || 250);
                for (const o of this.enemies) {
                    if (o === e || !o.alive) continue;
                    if ((o.x - e.x) * (o.x - e.x) + (o.y - e.y) * (o.y - e.y) > r2) continue;
                    o.hastePct = Math.max(o.hastePct, h.speedPct || 30);
                    o.hasteTime = Math.max(o.hasteTime, h.duration || 5);
                }
                this.enemyFloat(e, 'HASTE', '#ffe08a', 16);
            }
        }
        if (!this.demo && sp.sfx) G.main.playSfx(sp.sfx);
    }

    private updateSummons(dt: number) {
        for (let i = this.summons.length - 1; i >= 0; i--) {
            const m = this.summons[i];
            m.t -= dt;
            if (m.t > 0) continue;
            this.summons.splice(i, 1);
            const sm = m.spell.summon || {};
            const ids: string[] = (sm.enemyIds || []).filter((id: string) => ConfigMgr.enemyDef(id));
            if (ids.length === 0) continue;
            // Stats of a normal enemy of this wave (the first normal entry of the wave plan).
            const tpl = (this.plan && this.plan.entries.find(x => !x.boss)) || { hpMul: 1, damageMul: 1, speedMul: 1, goldMul: 1, defAdd: 0 } as any;
            const bf = ConfigMgr.tower.battlefield;
            const r = sm.radius || 80;
            for (let k = 0; k < (sm.count || 3); k++) {
                const id = ids[Math.floor(Math.random() * ids.length)];
                const x = Math.min(bf.spawnX, m.x + 20 + Math.random() * r);
                const y = Math.max(bf.enemyLaneY[0], Math.min(bf.enemyLaneY[1], m.y + (Math.random() * 2 - 1) * r));
                this.spawn(Object.assign({}, tpl, { time: 0, enemyId: id, boss: false, scale: 1, goldMul: tpl.goldMul * (sm.goldMul === undefined ? 1 : sm.goldMul) }), { x, y });
                const n = this.enemies[this.enemies.length - 1];
                if (m.spell.haste) { n.hastePct = m.spell.haste.speedPct || 30; n.hasteTime = m.spell.haste.duration || 5; }
            }
        }
    }

    /** Ground point under an enemy (enemy.json "feetY": px below the enemy position, x scale). */
    private feet(e: Enemy): { x: number; y: number } {
        const k = e.scale;
        return { x: e.x, y: e.y - (e.def.feetY || 0) * k };
    }

    /** An effect at the feet of an enemy (boss spells): "anchor" = the point of the cell on the ground. */
    private groundFx(e: Enemy, v: any) {
        if (!v || !Display.effects) return;
        const frames = Assets.frames(v.path, v.cellW, v.cellH).slice(0, v.frames || 99);
        if (frames.length === 0) return;
        const f = this.takeFx('impact');
        const k = (v.scale || 1) * e.scale;
        const ui = f.node.getComponent(UITransform)!;
        ui.setContentSize(v.cellW * k, v.cellH * k);
        const a = v.anchor || [0.5, 0.5];
        ui.setAnchorPoint(a[0], a[1]);
        const p = this.feet(e);
        f.node.setPosition(p.x + (v.offsetX || 0) * e.scale, p.y + (v.offsetY || 0) * e.scale, 0);
        f.anim!.play(frames, v.frameTime || 0.07, false);
        this.fx.push(f);
    }

    private updateEnemyShots(dt: number) {
        for (let i = this.enemyShots.length - 1; i >= 0; i--) {
            const s = this.enemyShots[i];
            s.x -= s.speed * dt;
            s.f.anim!.update(dt);
            // "tipX": the front of the fireball, from the node centre (negative = ahead, to the left).
            if (s.x + s.tipX > s.tx) { s.f.node.setPosition(s.x, s.y, 0); continue; }
            this.enemyShots.splice(i, 1);
            s.f.node.active = false;
            this.fxPool.impact.push(s.f);
            this.enemyImpactFx(s.tx, s.y, s.impact);
            // Between waves (wall fight over) a late fireball still lands but does no damage.
            if (this.active || this.demo) this.wallHit(s.damage, s.type, s.y);
        }
    }

    private enemyImpactFx(x: number, y: number, im: any) {
        if (!im || !Display.effects) return;
        const frames = Assets.frames(im.path, im.cellW, im.cellH).slice(0, im.frames || 99);
        if (frames.length === 0) return;
        const f = this.takeFx('impact');
        const k = im.scale || 1;
        const ui = f.node.getComponent(UITransform)!;
        ui.setContentSize(im.cellW * k, im.cellH * k);
        ui.setAnchorPoint(0.5, 0.5);
        f.node.setPosition(x, y, 0);
        f.anim!.play(frames, im.frameTime || 0.05, false);
        this.fx.push(f);
    }

    /** A fading circle (Arcane Rupture). */
    private ringFxAt(x: number, y: number, r: number, color: string) {
        if (!Display.effects) return;
        const f = this.takeFx('ring');
        const g = f.g!;
        g.clear();
        g.fillColor = hex(color, 40);
        g.circle(0, 0, r);
        g.fill();
        g.lineWidth = 2;
        g.strokeColor = hex(color, 230);
        g.circle(0, 0, r);
        g.stroke();
        f.node.setPosition(x, y, 0);
        f.life = f.total = 0.35;
        f.op!.opacity = 255;
        this.fx.push(f);
    }

    private lineFx(x1: number, y1: number, x2: number, y2: number, color: string) {
        if (!Display.effects) return;
        const f = this.takeFx('line');
        const g = f.g!;
        g.clear();
        g.lineWidth = 3;
        g.strokeColor = hex(color);
        g.moveTo(x1, y1);
        g.lineTo(x2, y2);
        g.stroke();
        f.node.setPosition(0, 0, 0);
        f.life = f.total = 0.2;
        f.op!.opacity = 255;
        this.fx.push(f);
    }

    /** Returns false when the effect is over (it then goes back to its pool). */
    private updateFx(f: Fx, dt: number): boolean {
        if (f.anim) return !(f.anim.update(dt) || f.anim.finished);
        f.life -= dt;
        if (f.life <= 0) return false;
        if (f.op) f.op.opacity = Math.round(255 * f.life / (f.total || 1));
        return true;
    }
}
