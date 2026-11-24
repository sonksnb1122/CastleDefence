import { Node, Graphics, UIOpacity, UITransform, isValid, Color } from 'cc';
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

/** A short visual effect. `kind` says which pool it goes back to. */
interface Fx { kind: 'impact' | 'ground' | 'ring' | 'line'; node: Node; anim?: SpriteAnim; g?: Graphics; life: number; total: number; op?: UIOpacity; }

export interface CombatEvents {
    onWallChanged(): void;
    onWaveCleared(wave: number, goldFromKills: number): void;
    onGameOver(wave: number): void;
}

const MAX_FLOAT_TEXTS = 70;
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
    /** Statistics of the running (or last) wave, see WaveStats. */
    stats = new WaveStats();
    /** Active skills (skills.json). */
    skills: SkillManager;
    /** Hits on the wall still blocked by Barrier Block (this wave only). */
    barrierCharges = 0;

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
        this.gameOver = false;
        this.active = true;
        this.barrierCharges = 0;
        this.stats.reset(wave, this.towers.map(t => ({ id: t.save.id, name: (t.def && t.def.name) || t.save.id })));
    }


    /** Demo mode: spawn one enemy right away (the menu background keeps calling this). */
    spawnDemo(enemyId: string, hpMul: number, speedMul: number) {
        this.spawn({ time: 0, enemyId, hpMul, damageMul: 1, speedMul, goldMul: 1, scale: 1, boss: false, defAdd: 0 });
    }

    private spawn(entry: SpawnEntry) {
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
        const y = bf.enemyLaneY[0] + Math.random() * (bf.enemyLaneY[1] - bf.enemyLaneY[0]);
        const e = this.enemyPool.pop() || new Enemy(this.enemyLayer);
        e.spawn(def, stats, bf.spawnX, y);
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
        for (const t of this.towers) t.update(dt, host);

        if (this.active) {
            this.elapsed += dt;
            this.stats.time += dt;
            while (this.queue.length > 0 && this.queue[0].time <= this.elapsed) this.spawn(this.queue.shift()!);
        }

        for (const e of this.enemies) e.update(dt, this);

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
            return Math.max(0.01, m) * tower.lv.damage * (1 + this.buff('damage', tower.save.id) / 100);
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
                if (!o.alive) continue;
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
        for (const type of shot.damageTypes) {
            let d = base * this.defenseMultiplier(e, type);
            const mark = e.markBonus(shot.towerId, type) / 100;
            d *= 1 + mark;
            if (type === 'physic') d *= 1 - e.abilityValue('physicDamageReduction') / 100;
            if (d > normal) { normal = d; amp = mark > 0 ? d - d / (1 + mark) : 0; ampType = type; }
        }
        if (shot.isAoe) { const k = 1 - e.abilityValue('aoeReduction') / 100; normal *= k; amp *= k; }
        normal += flatBonus;
        const critRate = Math.max(0, Math.min(100, shot.critRate + this.buff('critRate', shot.towerId)));
        const critDamage = shot.critDamage + this.buff('critDamage', shot.towerId);
        const crit = Math.random() * 100 < critRate;
        const mul = crit ? critDamage / 100 : 1;
        const final = normal * mul;
        return { amount: Math.max(1, Math.floor(final)), crit, dodged: false, flat: Math.max(0, flatBonus * mul), amp: Math.max(0, amp * mul), ampType };
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
        const died = e.takeDamage(res.amount);
        // Crits: red, bigger, with a thick outline so they look bold.
        if (res.crit) this.enemyFloat(e, res.amount + '!', '#ff3030', 19, 3);
        else this.enemyFloat(e, String(res.amount), '#ffffff', 15);
        if (died) this.onEnemyKilled(e);
    }

    // ------------------------------------------------------------------ skills (ISkillHost)
    /** Skill damage: true damage (no defense, no crit), counted under "Skills" in the wave statistics. */
    skillHit(e: Enemy, amount: number, skill: any) {
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
        const gold = this.demo ? e.goldReward : this.rm.killGold(e.goldReward);
        this.float('+' + gold, e.x + 8, e.y - 6, '#f2c14e', 15, true, 'gold');
        if (this.demo) return;
        this.goldFromKills += gold;
        this.rm.add({ gold });
        G.main.playSfx('die_' + e.def.id);
        G.main.playSfx('coin');
    }

    /** Damage over time from Bleed / Burn. Goes through defense but never crits. */
    applyDot(e: Enemy, rawDamage: number, type: DamageType, statusType: string, sourceUid = 0, statusId = '') {
        if (!e.alive) return;
        const buff = this.buff(statusType === 'bleed' ? 'bleedDamage' : 'burnDamage');
        const amount = Math.max(1, Math.floor(rawDamage * (1 + buff / 100) * this.defenseMultiplier(e, type)));
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
        for (const e of this.enemies) {
            if (!e.alive) continue;
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
        const chance = (ef: any) => ef.chance > 0 ? Math.min(100, Math.min(ef.maxChance || 100, ef.chance) + extra) : 0;
        const ready = (ef: any) => !tower || !(tower.effectCooldowns[ef.id] > 0);
        const used = (ef: any) => { if (tower && ef.cooldown > 0) tower.effectCooldowns[ef.id] = ef.cooldown; };
        const statusCount: { [id: string]: number } = {};

        for (const e of hit) {
            // Pre-damage effects (extra damage based on max HP).
            let bonus = 0;
            this.ctxFlat.length = 0;
            for (const ef of shot.effects) {
                if (ef.kind === 'bonusMaxHp' && ready(ef) && Math.random() * 100 < chance(ef)) {
                    const b = Math.min(ef.capHitMul ? shot.damage * ef.capHitMul : (ef.cap || Infinity), e.maxHp * ef.value / 100 * this.percentHpMul(e));
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
            for (const ef of shot.effects) {
                if (ef.kind !== 'status' || !ready(ef)) continue;
                if ((statusCount[ef.id] || 0) >= (ef.maxTargets || 1)) continue;
                if (Math.random() * 100 >= chance(ef)) continue;
                const landed = this.applyStatusFromTower(e, ef.statusId, shot.towerUid, shot.damage * (1 + this.buff('damage', shot.towerId) / 100));
                if (st) { if (landed === 'landed') st.trigger(ef.id, ef.name, shot.towerId); else if (landed === 'resisted') st.resist(ef.id, ef.name, shot.towerId); }
                if (!statusCount[ef.id] && !this.demo) this.effectSfx(ef.statusId);
                statusCount[ef.id] = (statusCount[ef.id] || 0) + 1;
            }
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
            this.ctxEffect = { key: ef.id, name: ef.name };
            let fromX = x, fromY = y;
            for (let n = 0; n < (ef.maxTargets || 1); n++) {
                let next: Enemy | null = null;
                let best = ef.range * ef.range;
                for (const e of this.enemies) {
                    if (!e.alive || hit.indexOf(e) >= 0) continue;
                    const d = (e.x - fromX) * (e.x - fromX) + (e.y - fromY) * (e.y - fromY);
                    if (d <= best) { best = d; next = e; }
                }
                if (!next) break;
                hit.push(next);
                this.lineFx(fromX, fromY, next.x, next.y, shot.damageTypes[0] === 'magic' ? '#9fe8ff' : '#ffffff');
                fromX = next.x; fromY = next.y;
                jumped = true;
                this.applyDamage(next, this.computeDamage(shot, next, ef.value / 100, this.markHpBonus(shot, next)));
            }
            this.ctxEffect = null;
            if (st && jumped) st.trigger(ef.id, ef.name, shot.towerId, true);
        }
        this.ctxTower = '';
        if (!this.demo) {
            // Catapult stones crash down (explode), the other towers have their own hit sound.
            if (shot.towerId === 'catapult') G.main.playSfx('explode');
            else G.main.playSfx('hit_' + shot.towerId, shot.isAoe ? 'explode' : 'hit');
        }
    }

    /** Sound of a status effect landing (Frost slow, Bleed, Shockwave stun). */
    private effectSfx(statusId: string) {
        const def = ConfigMgr.statusDef(statusId);
        if (!def) return;
        if (def.type === 'slow') G.main.playSfx('fx_frost');
        else if (def.type === 'bleed') G.main.playSfx('fx_bleed');
        else if (def.type === 'stun') G.main.playSfx('wall_hit');
    }

    /** `hitDamage`: damage of the shot before defense; statuses with "percentOfHit" scale their value with it. */
    /** 'landed', 'resisted', or 'immune' (blocked by the immunity; may have dealt the stun-immune hit instead). */
    private applyStatusFromTower(e: Enemy, statusId: string, sourceUid: number, hitDamage = 0): 'landed' | 'resisted' | 'immune' {
        const def = ConfigMgr.statusDef(statusId);
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
        if (def.percentOfHit) valueMul = Math.max(0.01, hitDamage / 100);
        if (def.type === 'slow') { durationMul += this.buff('slowDuration') / 100; valueMul += this.buff('slowEffect') / 100; }
        if (def.type === 'stun') durationMul += this.buff('stunDuration') / 100;
        if (!e.applyStatus(def, sourceUid, durationMul, valueMul)) {
            // Marks and Bleed land many times per second: no "RESIST" text for them (it would cover the field).
            if (def.type !== 'mark' && def.type !== 'bleed') this.enemyFloat(e, 'RESIST', '#aaaaaa', 12);
            return 'resisted';
        }
        // Burst at full stacks (Bleed x5): the stacks are removed and the enemy loses a share of its max HP.
        const burst = def.burstAtMaxStacks;
        if (burst && e.stacksOf(def.id) >= Math.max(1, def.maxStacks || 1)) {
            e.clearStatus(def.id);
            const amount = Math.max(1, Math.floor(this.capPercentHp(e.maxHp * (burst.maxHpPct || 0) / 100 * this.percentHpMul(e), hitDamage, srcId)));
            this.hitAsEffect(e, amount, 'burst_' + def.id, def.name + ' burst (x' + (def.maxStacks || 1) + ')', srcId);
        }
        return 'landed';
    }

    /** Damage dealt by an effect on its own (Bleed burst, stun-immune hit): shown as a red number, counted for that effect. */
    private hitAsEffect(e: Enemy, amount: number, key: string, name: string, towerId: string) {
        const prevTower = this.ctxTower, prevEffect = this.ctxEffect;
        this.ctxTower = towerId || prevTower;
        this.ctxEffect = { key, name };
        if (!this.demo && this.ctxTower) this.stats.trigger(key, name, this.ctxTower, true);
        this.applyDamage(e, { amount, crit: true, dodged: false });
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
        if (this.demo) {
            // Immortal wall: only the hit number is shown.
            this.float('-' + Math.floor(e.wallDamage()), this.wallRightX - 20, e.y + 20, '#ff6b6b', 18, true);
            return;
        }
        if (this.barrierCharges > 0) {
            // Barrier Block: the hit is stopped where the enemy touches the wall.
            this.barrierCharges--;
            this.skills.barrierHit(e.y);
            this.float('BLOCK', this.wallRightX + 10, e.y + 20, '#9fe8ff', 16, true);
            return;
        }
        const type: DamageType = e.def.damageType === 'magic' ? 'magic' : 'physic';
        const amount = Math.max(0, Math.floor(e.wallDamage() * (1 - this.rm.wallDef(type) / 100)));
        const destroyed = this.rm.damageWall(amount);
        this.float('-' + amount, this.wallRightX - 20, e.y + 20, '#ff6b6b', 18, true);
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
