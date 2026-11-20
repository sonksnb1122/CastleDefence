import { Node, Sprite, Graphics, Label, Color } from 'cc';
import { Assets } from '../core/Assets';
import { DamageType } from '../core/GameTypes';
import { Bar, hex, mk, sprite, text } from '../ui/UIKit';
import { SpriteAnim } from './SpriteAnim';

/** One active status effect on an enemy. */
export interface StatusInstance {
    def: any;
    remaining: number;
    value: number;
    stacks: number;
    tick: number;
    sourceUid: number;
}

/** Callbacks the enemy needs from the battle (implemented by CombatManager). */
export interface IEnemyHost {
    wallRightX: number;
    onEnemyReachedWall(e: Enemy): void;
    applyDot(e: Enemy, rawDamage: number, type: DamageType, statusType: string): void;
}

export interface EnemyStats { hp: number; damage: number; moveSpeed: number; goldReward: number; scale: number; boss: boolean; physicDef: number; magicDef: number; }

/** A monster walking from right to left toward the castle wall. */
export class Enemy {
    node: Node;
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    damage: number;
    baseSpeed: number;
    goldReward: number;
    radius: number;
    physicDef: number;
    magicDef: number;
    /** False as soon as the enemy is killed or has hit the wall. */
    alive = true;
    /** True when the death animation is over and the node can be destroyed. */
    removed = false;
    reachedWall = false;
    rewarded = false;
    statuses: StatusInstance[] = [];
    /** Expected damage of the projectiles already flying at this enemy (Smart targeting avoids overkill). */
    pendingDamage = 0;

    private anim: SpriteAnim;
    private spriteComp: Sprite;
    private hpBar: Bar;
    private statusLabel: Label;
    private flash = 0;
    private sprintTimer = 0;
    private sprintLeft = 0;
    private abilities: any[];

    constructor(parent: Node, public def: any, stats: EnemyStats, x: number, y: number) {
        this.x = x; this.y = y;
        this.maxHp = this.hp = stats.hp;
        this.damage = stats.damage;
        this.baseSpeed = stats.moveSpeed;
        this.goldReward = stats.goldReward;
        this.physicDef = stats.physicDef;
        this.magicDef = stats.magicDef;
        const scale = (def.scale || 1) * stats.scale;
        this.radius = (def.radius || 22) * scale;
        this.abilities = (def.specialAbilities || []).filter((a: any) => a.enabled);

        this.node = mk('Enemy_' + def.id, parent, x, y);
        const mv = def.animationPaths.move;
        const frames = Assets.frames(mv.path, mv.cellW, mv.cellH).slice(0, mv.frames);
        this.spriteComp = sprite(this.node, null, mv.cellW, mv.cellH);
        this.spriteComp.node.setScale(scale, scale, 1);
        this.anim = new SpriteAnim(this.spriteComp);
        if (frames.length > 0) {
            this.anim.play(frames, mv.frameTime, true);
        } else {
            // Placeholder when the sprite sheet is missing.
            const g = this.node.addComponent(Graphics);
            g.fillColor = hex('#a8443a');
            g.circle(0, 0, this.radius);
            g.fill();
            text(this.node, def.name, 11, 0, 0);
        }
        this.hpBar = new Bar(this.node, 0, this.radius + 12, stats.boss ? 70 : 36, stats.boss ? 6 : 4, '#6ad66a');
        this.statusLabel = text(this.node, '', 10, 0, this.radius + 24, { bold: true });
    }

    // ------------------------------------------------------------------ abilities
    private ability(type: string): any {
        for (const a of this.abilities) if (a.type === type) return a;
        return null;
    }
    /** Value of an always-on ability, or 0 when the enemy does not have it. */
    abilityValue(type: string): number {
        const a = this.ability(type);
        return a ? a.value : 0;
    }
    private get hpPercent(): number { return (this.hp / this.maxHp) * 100; }

    /** Damage dealt to the wall on contact (before wall defense). */
    wallDamage(): number {
        let d = this.damage;
        const last = this.ability('lowHpDamage');
        if (last && this.hpPercent <= last.hpThreshold) d *= 1 + last.value / 100;
        d *= 1 + this.abilityValue('wallDamageBonus') / 100;
        return d;
    }

    // ------------------------------------------------------------------ status effects
    /**
     * Apply a status effect following its stacking policy. `durationMul` and
     * `valueMul` carry research / hero bonuses. Returns false when resisted.
     */
    applyStatus(def: any, sourceUid: number, durationMul = 1, valueMul = 1): boolean {
        if (!this.alive) return false;
        const resist = (this.def.statusEffectResistance && this.def.statusEffectResistance[def.type]) || 0;
        if (Math.random() * 100 < resist) return false;
        const duration = def.duration * durationMul;
        let value = def.value * valueMul;
        if (def.type === 'slow') value = Math.min(90, value);
        const same = this.statuses.filter(s => s.def.id === def.id);
        const fresh = (): StatusInstance => ({ def, remaining: duration, value, stacks: 1, tick: def.tickInterval || 0, sourceUid });
        const maxStacks = Math.max(1, def.maxStacks || 1);
        switch (def.stacking) {
            case 'StackValue':
                if (same.length > 0) {
                    same[0].stacks = Math.min(maxStacks, same[0].stacks + 1);
                    same[0].remaining = duration;
                    same[0].value = Math.max(same[0].value, value);
                } else this.statuses.push(fresh());
                break;
            case 'IndependentInstances':
                if (same.length < maxStacks) this.statuses.push(fresh());
                else same.sort((a, b) => a.remaining - b.remaining)[0].remaining = duration;
                break;
            case 'ReplaceStronger':
                if (same.length === 0) this.statuses.push(fresh());
                else if (value > same[0].value || (value === same[0].value && duration > same[0].remaining)) {
                    same[0].value = value;
                    same[0].remaining = duration; // never added on top of the old duration
                    same[0].sourceUid = sourceUid;
                }
                break;
            default: // RefreshDuration
                if (same.length > 0) {
                    same[0].remaining = duration;
                    same[0].value = Math.max(same[0].value, value);
                } else this.statuses.push(fresh());
        }
        this.refreshStatusLabel();
        return true;
    }

    private slowPercent(): number {
        let v = 0;
        for (const s of this.statuses) if (s.def.type === 'slow') v = Math.max(v, s.value * s.stacks);
        return Math.min(100, v);
    }
    get stunned(): boolean { return this.statuses.some(s => s.def.type === 'stun'); }

    /** Points removed from effective defense by Armor Break effects. */
    defReduction(type: DamageType): number {
        let v = 0;
        for (const s of this.statuses) {
            if (s.def.type === 'armorBreak' && (!s.def.damageTypes || s.def.damageTypes.indexOf(type) >= 0)) v += s.value * s.stacks;
        }
        return v;
    }

    /** Extra damage % taken from this tower / damage type because of Mark effects. */
    markBonus(towerId: string, type: DamageType): number {
        let v = 0;
        for (const s of this.statuses) {
            if (s.def.type !== 'mark') continue;
            const byTower = s.def.towerIds && s.def.towerIds.indexOf(towerId) >= 0;
            const byType = s.def.damageTypes && s.def.damageTypes.indexOf(type) >= 0;
            if (byTower || byType) v += s.value * s.stacks;
        }
        return v;
    }

    private refreshStatusLabel() {
        const labels: string[] = [];
        let color = '#ffffff';
        for (const s of this.statuses) {
            const l = (s.def.visual && s.def.visual.label) || s.def.name;
            if (labels.indexOf(l) < 0) { labels.push(l); color = (s.def.visual && s.def.visual.color) || color; }
        }
        this.statusLabel.string = labels.join(' ');
        this.statusLabel.color = hex(color);
        // Tint the sprite with the most recent effect color so effects stay readable in a crowd.
        if (this.flash <= 0) this.spriteComp.color = labels.length > 0 ? this.tint(color) : Color.WHITE;
    }

    private tint(c: string): Color {
        const k = hex(c);
        return new Color(Math.round((k.r + 255) / 2), Math.round((k.g + 255) / 2), Math.round((k.b + 255) / 2), 255);
    }

    // ------------------------------------------------------------------ damage
    /** Subtract HP (never below 0). Returns true when this hit killed the enemy. */
    takeDamage(amount: number): boolean {
        if (!this.alive) return false;
        this.hp = Math.max(0, this.hp - amount);
        this.hpBar.set(this.hp / this.maxHp, this.hp / this.maxHp < 0.35 ? '#e05252' : '#6ad66a');
        this.flash = 0.08;
        this.spriteComp.color = new Color(255, 120, 120, 255);
        if (this.hp <= 0) { this.kill(); return true; }
        return false;
    }

    /** Stop moving, drop every status effect and play the death animation. */
    kill() {
        if (!this.alive) return;
        this.alive = false;
        this.statuses.length = 0;
        this.statusLabel.string = '';
        this.hpBar.node.active = false;
        this.spriteComp.color = Color.WHITE;
        const d = this.def.animationPaths.dead;
        const frames = Assets.frames(d.path, d.cellW, d.cellH).slice(0, d.frames);
        if (frames.length > 0) this.anim.play(frames, d.frameTime, false);
        else this.removed = true;
    }

    // ------------------------------------------------------------------ update
    update(dt: number, host: IEnemyHost) {
        if (!this.alive) {
            if (!this.removed && (this.anim.update(dt) || this.anim.finished)) this.removed = true;
            return;
        }
        if (this.flash > 0) {
            this.flash -= dt;
            if (this.flash <= 0) this.refreshStatusLabel();
        }

        // Status effects: damage over time and expiry.
        let changed = false;
        for (let i = this.statuses.length - 1; i >= 0; i--) {
            const s = this.statuses[i];
            if ((s.def.type === 'bleed' || s.def.type === 'burn') && s.def.tickInterval > 0) {
                s.tick -= dt;
                while (s.tick <= 0 && this.alive) {
                    s.tick += s.def.tickInterval;
                    host.applyDot(this, s.value * s.stacks, s.def.damageType || (s.def.type === 'bleed' ? 'physic' : 'magic'), s.def.type);
                }
                if (!this.alive) return;
            }
            s.remaining -= dt;
            if (s.remaining <= 0) { this.statuses.splice(i, 1); changed = true; }
        }
        if (changed) this.refreshStatusLabel();

        // Movement.
        let speed = this.baseSpeed;
        const rage = this.ability('lowHpSpeed');
        if (rage && this.hpPercent <= rage.hpThreshold) speed *= 1 + rage.value / 100;
        const sprint = this.ability('sprint');
        if (sprint) {
            if (this.sprintLeft > 0) { this.sprintLeft -= dt; speed *= 1 + sprint.value / 100; }
            else { this.sprintTimer += dt; if (this.sprintTimer >= sprint.interval) { this.sprintTimer = 0; this.sprintLeft = sprint.duration; } }
        }
        speed *= 1 - this.slowPercent() / 100;
        if (this.stunned) speed = 0;
        speed = Math.max(0, speed);
        this.x -= speed * dt;
        this.node.setPosition(this.x, this.y, 0);
        if (speed > 0) this.anim.update(dt);

        // Contact with the wall: handled exactly once.
        if (!this.reachedWall && this.x - this.radius <= host.wallRightX) {
            this.reachedWall = true;
            host.onEnemyReachedWall(this);
            this.kill();
        }
    }
}
