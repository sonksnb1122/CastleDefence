import { Node, Graphics, UIOpacity } from 'cc';
import { Assets } from '../core/Assets';
import { ConfigMgr } from '../core/ConfigMgr';
import { DamageResult, DamageType, ShotInfo } from '../core/GameTypes';
import { G } from '../core/Globals';
import { ResourceMgr } from '../core/ResourceMgr';
import { FloatText, hex, mk, sprite } from '../ui/UIKit';
import { Enemy, IEnemyHost } from './Enemy';
import { Projectile } from './Projectile';
import { SpriteAnim } from './SpriteAnim';
import { ITowerHost, TowerUnit } from './TowerUnit';
import { SpawnEntry, WaveMgr, WavePlan } from './WaveMgr';

interface Fx { node: Node; anim?: SpriteAnim; life?: number; total?: number; op?: UIOpacity; }

export interface CombatEvents {
    onWallChanged(): void;
    onWaveCleared(wave: number, goldFromKills: number): void;
    onGameOver(wave: number): void;
}

const MAX_FLOAT_TEXTS = 70;

/**
 * Runs one battle: spawning, targeting, projectiles, explosions and the single
 * damage pipeline every tower goes through.
 */
export class CombatManager implements IEnemyHost, ITowerHost {
    enemies: Enemy[] = [];
    towers: TowerUnit[] = [];
    projectiles: Projectile[] = [];
    wallRightX: number;
    active = false;
    wave = 0;
    plan: WavePlan | null = null;
    goldFromKills = 0;

    private queue: SpawnEntry[] = [];
    private elapsed = 0;
    private fx: Fx[] = [];
    private floats: FloatText[] = [];
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
        };
        const y = bf.enemyLaneY[0] + Math.random() * (bf.enemyLaneY[1] - bf.enemyLaneY[0]);
        this.enemies.push(new Enemy(this.enemyLayer, def, stats, bf.spawnX, y));
    }

    // ------------------------------------------------------------------ update
    update(dt: number) {
        // Visual effects keep running even between waves.
        for (let i = this.fx.length - 1; i >= 0; i--) if (!this.updateFx(this.fx[i], dt)) this.fx.splice(i, 1);
        for (let i = this.floats.length - 1; i >= 0; i--) if (!this.floats[i].update(dt)) this.floats.splice(i, 1);

        const host = this.active ? this : null;
        for (const t of this.towers) t.update(dt, host);

        if (this.active) {
            this.elapsed += dt;
            while (this.queue.length > 0 && this.queue[0].time <= this.elapsed) this.spawn(this.queue.shift()!);
        }

        for (const e of this.enemies) e.update(dt, this);

        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const p = this.projectiles[i];
            if (p.update(dt)) {
                if (p.target) p.target.pendingDamage = Math.max(0, p.target.pendingDamage - ((p.shot as any).pending || 0));
                this.explode(p.shot, p.tx, p.ty, p.target, p.cfg);
                p.node.destroy();
                this.projectiles.splice(i, 1);
            }
        }

        for (let i = this.enemies.length - 1; i >= 0; i--) {
            if (this.enemies[i].removed) { this.enemies[i].node.destroy(); this.enemies.splice(i, 1); }
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
            for (const p of this.projectiles) p.node.destroy();
            this.projectiles.length = 0;
            this.events.onWaveCleared(this.wave, this.goldFromKills);
        }
    }

    /** Remove everything that belongs to the running battle. */
    clear() {
        for (const e of this.enemies) e.node.destroy();
        for (const p of this.projectiles) p.node.destroy();
        for (const f of this.fx) f.node.destroy();
        for (const f of this.floats) f.node.destroy();
        this.enemies.length = 0; this.projectiles.length = 0; this.fx.length = 0; this.floats.length = 0;
        this.queue.length = 0;
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
            if (!this.isValidTarget(tower, e)) continue;
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
     *  - Crossbow / Crystal: highest damage after defense (lowest def) and the nearest enemies;
     *    marks are used (Hunter's Mark for Crossbow, Arcane Vulnerability for magic);
     *  - Catapult: the enemy at the center of the biggest group inside its explosion.
     */
    smartTarget(tower: TowerUnit): Enemy | null {
        let best: Enemy | null = null, bestScore = -Infinity;
        for (const e of this.enemies) {
            if (!this.isValidTarget(tower, e)) continue;
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
            for (const o of this.enemies) {
                if (!o.alive) continue;
                const dx = o.x - e.x, dy = o.y - e.y;
                if (dx * dx + dy * dy <= r2) {
                    const od = 1 + 2 * Math.max(0, Math.min(1, 1 - (o.x - this.wallRightX) / fieldW));
                    total += useful(o) * od;
                }
            }
            return total;
        }
        // Single target (Crossbow / Crystal): enemies close to the wall get a much higher priority
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
        // Expected damage (no crit) so Smart targeting does not overkill.
        const t0 = shot.damageTypes;
        let mul = -Infinity;
        for (const t of t0) mul = Math.max(mul, this.defenseMultiplier(target, t));
        (shot as any).pending = Math.max(1, shot.damage * (1 + this.buff('damage', shot.towerId) / 100) * mul);
        target.pendingDamage += (shot as any).pending;
        this.projectiles.push(new Projectile(this.fxLayer, shot, cfg, target, fromX, fromY, angleDeg, speed, tower.scale));
        if (!this.demo) G.main.playSfx('shoot');
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
        let normal = -Infinity;
        for (const type of shot.damageTypes) {
            let d = base * this.defenseMultiplier(e, type);
            d *= 1 + e.markBonus(shot.towerId, type) / 100;
            if (type === 'physic') d *= 1 - e.abilityValue('physicDamageReduction') / 100;
            if (d > normal) normal = d;
        }
        if (shot.isAoe) normal *= 1 - e.abilityValue('aoeReduction') / 100;
        normal += flatBonus;
        const critRate = Math.max(0, Math.min(100, shot.critRate + this.buff('critRate', shot.towerId)));
        const critDamage = shot.critDamage + this.buff('critDamage', shot.towerId);
        const crit = Math.random() * 100 < critRate;
        const final = crit ? normal * critDamage / 100 : normal;
        return { amount: Math.max(1, Math.floor(final)), crit, dodged: false };
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
        if (res.dodged) { this.float('MISS', e.x, e.y + e.radius + 14, '#cccccc', 13); return; }
        const died = e.takeDamage(res.amount);
        if (res.crit) this.float(res.amount + '!', e.x, e.y + e.radius + 18, '#ffd23f', 20);
        else this.float(String(res.amount), e.x, e.y + e.radius + 14, '#ffffff', 14);
        if (died) this.onEnemyKilled(e);
    }

    private onEnemyKilled(e: Enemy) {
        if (e.rewarded) return;
        e.rewarded = true;
        const gold = this.demo ? e.goldReward : this.rm.killGold(e.goldReward);
        this.float('+' + gold, e.x + 8, e.y - 6, '#f2c14e', 15, true, 'gold');
        if (this.demo) return;
        this.goldFromKills += gold;
        this.rm.add({ gold });
        G.main.playSfx('coin');
    }

    /** Damage over time from Bleed / Burn. Goes through defense but never crits. */
    applyDot(e: Enemy, rawDamage: number, type: DamageType, statusType: string) {
        if (!e.alive) return;
        const buff = this.buff(statusType === 'bleed' ? 'bleedDamage' : 'burnDamage');
        const amount = Math.max(1, Math.floor(rawDamage * (1 + buff / 100) * this.defenseMultiplier(e, type)));
        const died = e.takeDamage(amount);
        this.float(String(amount), e.x + 10, e.y + e.radius + 8, statusType === 'bleed' ? '#ff7a7a' : '#ffa64d', 12);
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
        const chance = (ef: any) => Math.min(ef.maxChance || 100, ef.chance * (1 + this.buff('effectChance', shot.towerId) / 100));
        const ready = (ef: any) => !tower || !(tower.effectCooldowns[ef.id] > 0);
        const used = (ef: any) => { if (tower && ef.cooldown > 0) tower.effectCooldowns[ef.id] = ef.cooldown; };
        const statusCount: { [id: string]: number } = {};

        for (const e of hit) {
            // Pre-damage effects (extra damage based on max HP).
            let bonus = 0;
            for (const ef of shot.effects) {
                if (ef.kind === 'bonusMaxHp' && ready(ef) && Math.random() * 100 < chance(ef)) {
                    bonus += Math.min(ef.capHitMul ? shot.damage * ef.capHitMul : (ef.cap || Infinity), e.maxHp * ef.value / 100);
                }
            }
            this.applyDamage(e, this.computeDamage(shot, e, 1, bonus));
            if (!e.alive) continue;
            // Post-damage effects: status effects on the enemies that were hit.
            for (const ef of shot.effects) {
                if (ef.kind !== 'status' || !ready(ef)) continue;
                if ((statusCount[ef.id] || 0) >= (ef.maxTargets || 1)) continue;
                if (Math.random() * 100 >= chance(ef)) continue;
                this.applyStatusFromTower(e, ef.statusId, shot.towerUid, shot.damage * (1 + this.buff('damage', shot.towerId) / 100));
                statusCount[ef.id] = (statusCount[ef.id] || 0) + 1;
            }
        }
        for (const ef of shot.effects) if (ef.kind === 'status' && statusCount[ef.id]) used(ef);

        // Chain / pierce: jumps from the impact point to enemies that were not hit yet.
        for (const ef of shot.effects) {
            if (ef.kind !== 'chain' || !ready(ef) || hit.length === 0) continue;
            if (Math.random() * 100 >= chance(ef)) continue;
            used(ef);
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
                this.applyDamage(next, this.computeDamage(shot, next, ef.value / 100));
            }
        }
        if (!this.demo) G.main.playSfx(shot.isAoe ? 'explode' : 'hit');
    }

    /** `hitDamage`: damage of the shot before defense; statuses with "percentOfHit" scale their value with it. */
    private applyStatusFromTower(e: Enemy, statusId: string, sourceUid: number, hitDamage = 0) {
        const def = ConfigMgr.statusDef(statusId);
        if (!def) return;
        let durationMul = 1, valueMul = 1;
        if (def.percentOfHit) valueMul = Math.max(0.01, hitDamage / 100);
        if (def.type === 'slow') { durationMul += this.buff('slowDuration') / 100; valueMul += this.buff('slowEffect') / 100; }
        if (def.type === 'stun') durationMul += this.buff('stunDuration') / 100;
        if (!e.applyStatus(def, sourceUid, durationMul, valueMul)) this.float('RESIST', e.x, e.y + e.radius + 26, '#aaaaaa', 11);
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
        const type: DamageType = e.def.damageType === 'magic' ? 'magic' : 'physic';
        const amount = Math.max(0, Math.floor(e.wallDamage() * (1 - this.rm.wallDef(type) / 100)));
        const destroyed = this.rm.damageWall(amount);
        this.float('-' + amount, this.wallRightX - 20, e.y + 20, '#ff6b6b', 18, true);
        G.main.playSfx('hit');
        this.events.onWallChanged();
        if (destroyed && !this.gameOver) {
            this.gameOver = true;
            this.active = false;
            this.events.onGameOver(this.wave);
        }
    }

    // ------------------------------------------------------------------ visual feedback
    float(str: string, x: number, y: number, color: string, size: number, important = false, icon?: string) {
        if (!important && this.floats.length >= MAX_FLOAT_TEXTS) return; // keep big fights readable
        this.floats.push(new FloatText(this.textLayer, str, x, y, color, size, 0.8, icon));
    }

    private impactFx(shot: ShotInfo, x: number, y: number) {
        const im = (shot as any).impact;
        if (im) {
            const frames = Assets.pick(im.path, im.cellW, im.cellH, im.frames);
            if (frames.length > 0) {
                const sp = sprite(this.fxLayer, null, im.cellW, im.cellH, x, y, 0.5, im.anchorY);
                const anim = new SpriteAnim(sp);
                anim.play(frames, im.frameTime, false);
                this.fx.push({ node: sp.node, anim });
            }
        }
        if (shot.explosionRange >= 30) {
            // Ring that shows the real explosion radius.
            const n = mk('Ring', this.fxLayer, x, y);
            const g = n.addComponent(Graphics);
            const c = shot.damageTypes.length > 1 ? '#c8ff7a' : shot.damageTypes[0] === 'magic' ? '#9fe8ff' : '#ffffff';
            g.fillColor = hex(c, 50);
            g.circle(0, 0, shot.explosionRange);
            g.fill();
            g.lineWidth = 2;
            g.strokeColor = hex(c, 220);
            g.circle(0, 0, shot.explosionRange);
            g.stroke();
            this.fx.push({ node: n, life: 0.28, total: 0.28, op: n.addComponent(UIOpacity) });
        }
    }

    private lineFx(x1: number, y1: number, x2: number, y2: number, color: string) {
        const n = mk('Line', this.fxLayer, 0, 0);
        const g = n.addComponent(Graphics);
        g.lineWidth = 3;
        g.strokeColor = hex(color);
        g.moveTo(x1, y1);
        g.lineTo(x2, y2);
        g.stroke();
        this.fx.push({ node: n, life: 0.2, total: 0.2, op: n.addComponent(UIOpacity) });
    }

    private updateFx(f: Fx, dt: number): boolean {
        if (f.anim) {
            if (f.anim.update(dt) || f.anim.finished) { f.node.destroy(); return false; }
            return true;
        }
        f.life = (f.life || 0) - dt;
        if (f.life <= 0) { f.node.destroy(); return false; }
        if (f.op) f.op.opacity = Math.round(255 * f.life / (f.total || 1));
        return true;
    }
}
