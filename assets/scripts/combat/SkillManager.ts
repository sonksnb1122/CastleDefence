import { Node, UITransform, Graphics, UIOpacity, isValid } from 'cc';
import { Assets } from '../core/Assets';
import { ConfigMgr } from '../core/ConfigMgr';
import { Display } from '../core/Display';
import { ResourceMgr } from '../core/ResourceMgr';
import { hex, mk, sprite } from '../views/common/UIKit';
import { Enemy } from './Enemy';
import { SpriteAnim } from './SpriteAnim';
import { TowerUnit } from './TowerUnit';

/** What the skills need from the battle (CombatManager). */
export interface ISkillHost {
    enemies: Enemy[];
    towers: TowerUnit[];
    wallRightX: number;
    demo: boolean;
    /** Damage dealt by a skill (true damage, counted in the wave statistics under "Skills"). */
    skillHit(e: Enemy, amount: number, skill: any): void;
    /** A skill was cast (wave statistics). */
    skillCast(skill: any): void;
    healWall(): void;
    float(str: string, x: number, y: number, color: string, size: number, important?: boolean): void;
    /** Hits on the wall that are still blocked (Barrier Block). */
    barrierCharges: number;
}

/** One VFX sprite of a skill. */
interface SkillFx { node: Node; anim: SpriteAnim; delay: number; until: number; loop: boolean; }

/** A skill effect that lands later (at the hit frame of its animation). */
interface Pending { time: number; run: () => void; }

/** A running pull (Gravity Well). */
interface Pull { x: number; y: number; r: number; speed: number; time: number; }

/** A running tower buff (Angel Feather, Buff Arrow). */
interface Buff { stat: 'damage' | 'attackSpeed'; mul: number; time: number; fx: SkillFx[]; }

/**
 * Active skills (skills.json): casting, VFX placement, damage, knock-back, pull, stun,
 * tower buffs, wall heal and barrier. Driven by CombatManager.update (game speed included).
 */
export class SkillManager {
    private fx: SkillFx[] = [];
    private pending: Pending[] = [];
    private pulls: Pull[] = [];
    private buffs: Buff[] = [];
    private rings: Array<{ node: Node; op: UIOpacity; life: number; total: number }> = [];
    private time = 0;

    constructor(private host: ISkillHost, private topLayer: Node, private groundLayer: Node) {}

    static get list(): any[] { return (ConfigMgr.skills && ConfigMgr.skills.skills) || []; }

    /** Diameter of the skill circle: the height of the enemy lane. */
    static get circle(): number {
        const lane = ConfigMgr.tower.battlefield.enemyLaneY;
        return lane[1] - lane[0];
    }

    /** Diameter of the zone of a targeted skill. */
    static areaDiameter(def: any): number { return SkillManager.circle * (def.areaScale || 1); }

    // ------------------------------------------------------------------ cooldowns (in waves, kept in the save)
    /** First wave in which the skill can be cast again. */
    static readyWave(def: any): number {
        const r = ResourceMgr.inst.data.skillReady || {};
        return r[def.id] || 0;
    }

    static isReady(def: any): boolean { return ResourceMgr.inst.data.currentWave >= SkillManager.readyWave(def); }

    /** Starts the cooldown: the skill is ready again "cooldownWaves" waves later. */
    static startCooldown(def: any) {
        const d = ResourceMgr.inst.data;
        if (!d.skillReady) d.skillReady = {};
        d.skillReady[def.id] = d.currentWave + Math.max(0, def.cooldownWaves || 0);
    }

    // ------------------------------------------------------------------ casting
    /** Cast a skill. Targeted skills ("target": "area") need the world point (x, y). */
    cast(def: any, x = 0, y = 0) {
        const ef = def.effect || {};
        const v = def.vfx || {};
        const hitAt = (v.hitFrame || 0) * (v.frameTime || 0.06);
        this.host.skillCast(def);
        switch (ef.type) {
            case 'knockback':
                this.placeFx(def, x, y);
                this.later(hitAt, () => { for (const e of this.alive()) e.push(ef.distance || 200, 0, ef.time || 0.4); });
                break;
            case 'stunAll': {
                this.placeFx(def, x, y);
                const stun = ConfigMgr.statusDef('stun');
                this.later(hitAt, () => {
                    for (const e of this.alive()) {
                        e.forceStun(stun, ef.duration || 5);
                        this.damage(e, def, ef.damagePct);
                    }
                });
                break;
            }
            case 'globalDamage':
                this.placeFx(def, x, y);
                this.later(hitAt, () => { for (const e of this.alive()) this.damage(e, def, ef.damagePct); });
                break;
            case 'areaDamage': {
                const r = SkillManager.areaDiameter(def) / 2;
                this.ring(x, y, r, def);
                this.placeFx(def, x, y);
                this.later(hitAt, () => { for (const e of this.inside(x, y, r)) this.damage(e, def, ef.damagePct); });
                break;
            }
            case 'gravity': {
                const r = SkillManager.areaDiameter(def) / 2;
                const pullTime = ef.pullTime || 1.4;
                this.ring(x, y, r, def);
                this.placeFx(def, x, y, pullTime);
                this.pulls.push({ x, y, r, speed: ef.pullSpeed || 200, time: pullTime });
                this.later(pullTime, () => { for (const e of this.inside(x, y, r * 1.1)) this.damage(e, def, ef.damagePct); });
                break;
            }
            case 'towerBuff': {
                const stat = ef.stat === 'attackSpeed' ? 'attackSpeed' : 'damage';
                // A new cast of the same buff replaces the old one (the time restarts).
                for (const b of this.buffs.filter(b => b.stat === stat)) this.endBuff(b);
                this.buffs = this.buffs.filter(b => b.stat !== stat);
                const fx = this.placeFx(def, x, y, ef.duration || 15);
                this.buffs.push({ stat, mul: ef.mul || 2, time: ef.duration || 15, fx });
                this.applyBuffs();
                this.host.float(def.name + '!', this.host.wallRightX - 120, 470, '#ffe27a', 18, true);
                break;
            }
            case 'healWall':
                this.placeFx(def, x, y);
                this.later(hitAt, () => this.host.healWall());
                break;
            case 'barrier':
                this.host.barrierCharges = ef.charges || 20;
                this.host.float(def.name + ' x' + this.host.barrierCharges, this.host.wallRightX + 60, 470, '#9fe8ff', 18, true);
                break;
        }
    }

    /** Barrier Block stopped a hit on the wall at height y: VFX at the contact point. */
    barrierHit(y: number) {
        const def = SkillManager.list.find(s => s.effect && s.effect.type === 'barrier');
        if (def) this.sprite(def, this.host.wallRightX + 6, y, 0, def.vfx.size || 48);
    }

    // ------------------------------------------------------------------ update
    update(dt: number) {
        this.time += dt;
        // Effects that land now.
        for (let i = this.pending.length - 1; i >= 0; i--) {
            const p = this.pending[i];
            if ((p.time -= dt) <= 0) { this.pending.splice(i, 1); p.run(); }
        }
        // Gravity Well: enemies of the zone slide to its center.
        for (let i = this.pulls.length - 1; i >= 0; i--) {
            const p = this.pulls[i];
            p.time -= dt;
            for (const e of this.inside(p.x, p.y, p.r * 1.1)) {
                const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy);
                if (d < 4) continue;
                const step = Math.min(d - 2, p.speed * dt);
                e.x += dx / d * step;
                e.y += dy / d * step;
            }
            if (p.time <= 0) this.pulls.splice(i, 1);
        }
        // Tower buffs.
        let changed = false;
        for (let i = this.buffs.length - 1; i >= 0; i--) {
            const b = this.buffs[i];
            if ((b.time -= dt) <= 0) { this.endBuff(b); this.buffs.splice(i, 1); changed = true; }
        }
        if (changed) this.applyBuffs();
        // VFX.
        for (let i = this.fx.length - 1; i >= 0; i--) {
            const f = this.fx[i];
            if (f.delay > 0) {
                f.delay -= dt;
                if (f.delay <= 0) f.node.active = true;
                continue;
            }
            const done = f.anim.update(dt) || f.anim.finished;
            if ((f.loop && this.time >= f.until) || (!f.loop && done)) { this.fx.splice(i, 1); if (isValid(f.node)) f.node.destroy(); }
        }
        for (let i = this.rings.length - 1; i >= 0; i--) {
            const r = this.rings[i];
            r.life -= dt;
            if (r.life <= 0) { this.rings.splice(i, 1); if (isValid(r.node)) r.node.destroy(); continue; }
            r.op.opacity = Math.round(255 * Math.min(1, r.life / (r.total * 0.5)));
        }
    }

    /** End of the wave or of the battle: buffs and barrier stop, effects are removed. */
    clear() {
        for (const b of this.buffs) this.endBuff(b);
        this.buffs.length = 0;
        this.applyBuffs();
        for (const f of this.fx) if (isValid(f.node)) f.node.destroy();
        for (const r of this.rings) if (isValid(r.node)) r.node.destroy();
        this.fx.length = 0; this.rings.length = 0; this.pending.length = 0; this.pulls.length = 0;
        this.host.barrierCharges = 0;
    }

    // ------------------------------------------------------------------ helpers
    private alive(): Enemy[] { return this.host.enemies.filter(e => e.alive); }

    private inside(x: number, y: number, r: number): Enemy[] {
        return this.host.enemies.filter(e => e.alive && Math.hypot(e.x - x, e.y - y) <= r + e.radius * 0.5);
    }

    private later(t: number, run: () => void) {
        if (t <= 0) run(); else this.pending.push({ time: t, run });
    }

    /** Damage = share of the max HP; bosses take skills.json "bossDamageMul" of it. */
    private damage(e: Enemy, def: any, pct: number) {
        if (!e.alive || !(pct > 0)) return;
        const bossMul = e.boss ? (ConfigMgr.skills.bossDamageMul || 0.5) : 1;
        this.host.skillHit(e, Math.max(1, Math.floor(e.maxHp * pct / 100 * bossMul)), def);
    }

    private applyBuffs() {
        const m = { damage: 1, attackSpeed: 1 };
        for (const b of this.buffs) m[b.stat] *= b.mul;
        TowerUnit.skillMul.damage = m.damage;
        TowerUnit.skillMul.attackSpeed = m.attackSpeed;
    }

    private endBuff(b: Buff) {
        for (const f of b.fx) f.until = 0;
    }

    /** Thin circle that shows the zone of a targeted skill for a moment. */
    private ring(x: number, y: number, r: number, def: any) {
        if (!Display.effects) return;
        const n = mk('SkillRing', this.groundLayer, x, y);
        const g = n.addComponent(Graphics);
        g.fillColor = hex('#ffffff', 14);
        g.circle(0, 0, r);
        g.fill();
        g.lineWidth = 2;
        g.strokeColor = hex('#ffe9a8', 220);
        g.circle(0, 0, r);
        g.stroke();
        const op = n.addComponent(UIOpacity);
        const v = def.vfx || {};
        const total = Math.max(0.6, (v.frames || 10) * (v.frameTime || 0.06));
        this.rings.push({ node: n, op, life: total, total });
    }

    /**
     * Places the VFX sprites of a skill (vfx.placement):
     *  wall       - a column along the wall
     *  path       - staggered rows covering the enemy path, from the wall to the right edge
     *  area       - in the zone of a targeted skill (count sprites, scaled to the zone)
     *  towers     - on every tower; towerFront - in front of every tower
     *  contact    - nothing now (Barrier Block shows its VFX where an enemy hits the wall)
     * `hold` keeps looping sprites (and the gravity well) for that many seconds.
     */
    private placeFx(def: any, tx: number, ty: number, hold = 0): SkillFx[] {
        const v = def.vfx;
        if (!v) return [];
        const out: SkillFx[] = [];
        const bf = ConfigMgr.tower.battlefield;
        const lane = bf.enemyLaneY;
        const size = v.size || v.cellW;
        const h = size * v.cellH / v.cellW;
        const add = (x: number, y: number, delay: number, w = size) => { const f = this.sprite(def, x, y, delay, w, hold); if (f) out.push(f); };
        switch (v.placement) {
            case 'wall': {
                const step = h * (v.spacing || 0.8);
                const x = this.host.wallRightX + size * 0.35;
                for (let y = lane[0] - 20, i = 0; y <= lane[1] + 40; y += step, i++) add(x, y, i * 0.04);
                break;
            }
            case 'path': {
                const x0 = this.host.wallRightX + size * 0.6, x1 = bf.worldWidth - size * 0.3;
                const rows = Math.max(2, Math.round((lane[1] - lane[0]) / (h * 0.75)));
                const dy = (lane[1] - lane[0]) / rows;
                let col = 0;
                for (let x = x0; x <= x1; x += size * 0.85, col++) {
                    for (let r = 0; r < rows + (col % 2 === 0 ? 0 : 1); r++) {
                        // Odd columns sit half a row lower: the sprites are staggered and cover the path.
                        const y = lane[0] + dy * (r + (col % 2 === 0 ? 0.5 : 0));
                        add(x + (Math.random() - 0.5) * size * 0.15, y, col * 0.035 + Math.random() * 0.12);
                    }
                }
                break;
            }
            case 'area': {
                const d = SkillManager.areaDiameter(def);
                const w = d * (v.size || 1);
                const n = Math.max(1, v.count || 1);
                // "extra": more sprites at [dx, dy] x zone diameter from the center (bottom of the zone...).
                for (const [ex, ey] of (v.extra || [])) add(tx + ex * d, ty + ey * d, 0.08 + Math.random() * 0.1, w);
                if (n === 1) add(tx, ty, 0, w);
                else {
                    // One in the middle, the others around it inside the zone, a little later each.
                    const spread = (v.spread || 0.3) * d;
                    add(tx, ty, 0, w);
                    for (let i = 1; i < n; i++) {
                        const a = (i / (n - 1)) * Math.PI * 2 + Math.random() * 0.5;
                        add(tx + Math.cos(a) * spread, ty + Math.sin(a) * spread * 0.8, 0.06 * i + Math.random() * 0.08, w);
                    }
                }
                break;
            }
            case 'towers':
            case 'towerFront':
                for (const t of this.host.towers) {
                    const x = t.save.x + (v.placement === 'towerFront' ? 34 : 0);
                    const y = t.save.y + (v.placement === 'towerFront' ? 0 : 26);
                    add(x, y, Math.random() * 0.15);
                }
                break;
        }
        return out;
    }

    /** One VFX sprite: plays the sheet once (or loops for `hold` seconds when vfx.loop / hold is set). */
    private sprite(def: any, x: number, y: number, delay: number, width: number, hold = 0): SkillFx | null {
        if (!Display.effects) return null;
        const v = def.vfx;
        const frames = Assets.frames(v.path, v.cellW, v.cellH).slice(0, v.frames || 9999);
        if (frames.length === 0) return null;
        const layer = v.layer === 'ground' ? this.groundLayer : this.topLayer;
        const k = width / v.cellW;
        const sp = sprite(layer, null, v.cellW * k, v.cellH * k);
        const ui = sp.node.getComponent(UITransform)!;
        ui.setAnchorPoint(v.anchorX === undefined ? 0.5 : v.anchorX, v.anchorY === undefined ? 0.5 : v.anchorY);
        sp.node.setPosition(x, y, 0);
        const anim = new SpriteAnim(sp);
        const loop = hold > 0;
        anim.play(frames, v.frameTime || 0.06, loop);
        sp.node.active = delay <= 0;
        const f: SkillFx = { node: sp.node, anim, delay, until: this.time + delay + hold, loop };
        this.fx.push(f);
        return f;
    }
}
