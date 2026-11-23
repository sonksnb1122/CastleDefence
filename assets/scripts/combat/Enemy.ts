import { Node, Sprite, Graphics, Label, Color, UITransform } from 'cc';
import { Assets } from '../core/Assets';
import { DamageType } from '../core/GameTypes';
import { hex, mk, sprite, text } from '../views/common/UIKit';
import { HpBar } from './HpBar';
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

export interface EnemyStats { hp: number; damage: number; moveSpeed: number; goldReward: number; scale: number; boss: boolean; physicDef: number; magicDef: number;
    /** Extra resistance (%) to the listed status types (late waves, see WaveMgr.statusResist). */
    statusResist?: { types: string[]; value: number }; }

/**
 * A monster walking from right to left toward the castle wall.
 * Enemies are pooled: the CombatManager keeps finished ones (node hidden) and
 * calls spawn() again instead of creating new nodes for every monster.
 */
export class Enemy {
    node: Node;
    def: any = null;
    x = 0;
    y = 0;
    hp = 0;
    maxHp = 1;
    damage = 0;
    baseSpeed = 0;
    goldReward = 0;
    radius = 22;
    physicDef = 0;
    magicDef = 0;
    /** False as soon as the enemy is killed or has hit the wall. */
    alive = true;
    /** True when the death animation is over and the enemy can go back to the pool. */
    removed = false;
    reachedWall = false;
    rewarded = false;
    statuses: StatusInstance[] = [];
    /** Expected damage of the projectiles already flying at this enemy (used to avoid overkill). */
    pendingDamage = 0;
    /** Extra status resistance of this wave (see EnemyStats). */
    private waveResist: { types: string[]; value: number } = { types: [], value: 0 };
    /** Seconds left during which a status type cannot be applied again (status "immunityAfter"). */
    private immune: { [type: string]: number } = {};
    /** Wave boss (bigger, tougher). */
    boss = false;
    /** Number given at each spawn: tells a pooled enemy apart from its previous life. */
    serial = 0;

    private anim: SpriteAnim;
    private spriteComp: Sprite;
    private hpBar: HpBar;
    /** Created on the first status effect only (labels are expensive to draw). */
    private statusLabel: Label | null = null;
    private placeholder: Node | null = null;
    private flash = 0;
    private sprintTimer = 0;
    private sprintLeft = 0;
    private abilities: any[] = [];

    /** Build the reusable node tree (hidden until spawn()). */
    constructor(parent: Node) {
        this.node = mk('Enemy', parent);
        this.spriteComp = sprite(this.node, null, 1, 1);
        this.anim = new SpriteAnim(this.spriteComp);
        this.hpBar = new HpBar(this.node, 36, 4);
        this.node.active = false;
    }

    /** (Re)start this enemy with a definition and its wave stats. */
    spawn(def: any, stats: EnemyStats, x: number, y: number) {
        this.def = def;
        this.x = x; this.y = y;
        this.maxHp = this.hp = stats.hp;
        this.boss = !!stats.boss;
        this.damage = stats.damage;
        this.baseSpeed = stats.moveSpeed;
        this.goldReward = stats.goldReward;
        this.physicDef = stats.physicDef;
        this.magicDef = stats.magicDef;
        this.alive = true; this.removed = false; this.reachedWall = false; this.rewarded = false;
        this.statuses.length = 0;
        this.pendingDamage = 0;
        this.waveResist = stats.statusResist || { types: [], value: 0 };
        this.immune = {};
        this.flash = 0; this.sprintTimer = 0; this.sprintLeft = 0;
        const scale = (def.scale || 1) * stats.scale;
        this.radius = (def.radius || 22) * scale;
        this.abilities = (def.specialAbilities || []).filter((a: any) => a.enabled);

        this.node.name = 'Enemy_' + def.id;
        this.node.setPosition(x, y, 0);
        const mv = def.animationPaths.move;
        const frames = Assets.frames(mv.path, mv.cellW, mv.cellH).slice(0, mv.frames);
        const ui = this.spriteComp.node.getComponent(UITransform)!;
        ui.setContentSize(mv.cellW, mv.cellH);
        this.spriteComp.node.setScale(scale, scale, 1);
        this.spriteComp.color = Color.WHITE;
        this.spriteComp.node.active = frames.length > 0;
        if (frames.length > 0) this.anim.play(frames, mv.frameTime, true);
        else this.showPlaceholder(def);
        if (this.placeholder) this.placeholder.active = frames.length === 0;
        this.hpBar.node.active = true;
        this.hpBar.resize(stats.boss ? 70 : 36, stats.boss ? 6 : 4);
        this.hpBar.node.setPosition(0, this.radius + 12, 0);
        this.hpBar.set(1, '#6ad66a');
        if (this.statusLabel) { this.statusLabel.string = ''; this.statusLabel.node.setPosition(0, this.radius + 24, 0); }
        this.node.active = true;
    }

    /** Hide the node so the enemy can wait in the pool. */
    release() { this.node.active = false; }

    /** Circle + name, only used when the sprite sheet of this enemy is missing. */
    private showPlaceholder(def: any) {
        if (!this.placeholder) {
            this.placeholder = mk('Placeholder', this.node);
            this.placeholder.setSiblingIndex(0);
            this.placeholder.addComponent(Graphics);
            text(this.placeholder, '', 11, 0, 0);
        }
        const g = this.placeholder.getComponent(Graphics)!;
        g.clear();
        g.fillColor = hex('#a8443a');
        g.circle(0, 0, this.radius);
        g.fill();
        this.placeholder.children[0].getComponent(Label)!.string = def.name;
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
     * Call isImmune() first: an immune enemy simply ignores the effect (no "RESIST" text).
     */
    applyStatus(def: any, sourceUid: number, durationMul = 1, valueMul = 1): boolean {
        if (!this.alive) return false;
        let resist = (this.def.statusEffectResistance && this.def.statusEffectResistance[def.type]) || 0;
        if (this.waveResist.types.indexOf(def.type) >= 0) resist += this.waveResist.value;
        if (Math.random() * 100 < Math.min(95, resist)) return false;
        const duration = def.duration * durationMul;
        // Short immunity (e.g. Stun): the effect cannot be applied again while it lasts and for
        // "immunityAfter" seconds after it ends, so enemies are never stunned without a break.
        if (def.immunityAfter > 0) this.immune[def.type] = duration + def.immunityAfter;
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

    /** True while the enemy cannot get this status type again (see "immunityAfter"). */
    isImmune(type: string): boolean { return (this.immune[type] || 0) > 0; }

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
        if (labels.length > 0 && !this.statusLabel) {
            // Created on demand. Bold with a dark outline so it reads on sand, grass and other enemies.
            // BITMAP cache: the outline needs it, and the text only changes when a status starts or ends.
            this.statusLabel = text(this.node, '', 12, 0, this.radius + 24, { bold: true });
            this.statusLabel.cacheMode = Label.CacheMode.BITMAP;
            this.statusLabel.enableOutline = true;
            this.statusLabel.outlineColor = new Color(20, 14, 28, 255);
            this.statusLabel.outlineWidth = 2;
        }
        if (this.statusLabel) {
            this.statusLabel.string = labels.join(' ');
            this.statusLabel.color = hex(color);
        }
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
        if (this.statusLabel) this.statusLabel.string = '';
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
        for (const k in this.immune) if (this.immune[k] > 0) this.immune[k] -= dt;
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
