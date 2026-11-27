import { Node, Sprite, Graphics, Label, Color, UITransform } from 'cc';
import { Assets } from '../core/Assets';
import { ConfigMgr } from '../core/ConfigMgr';
import { DamageType } from '../core/GameTypes';
import { hex, mk, sprite, text } from '../views/common/UIKit';
import { HpBar } from './HpBar';
import { Display } from '../core/Display';
import { SpriteAnim } from './SpriteAnim';
import { WaveMgr } from './WaveMgr';

/** Size (px) of the status icons above an enemy (sprites/status, drawn 1:1). */
const STATUS_ICON = 16;

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
    /** A ranged enemy (enemy.json "ranged") releases its projectile at the wall. */
    enemyShoot(e: Enemy): void;
    /** A boss spell (enemy.json "spells") takes effect (its cast frame): shield, summon + haste. */
    bossSpell(e: Enemy, spell: any): void;
    applyDot(e: Enemy, rawDamage: number, type: DamageType, statusType: string, sourceUid?: number, statusId?: string, currentHpPct?: number): void;
}

export interface EnemyStats { hp: number; damage: number; moveSpeed: number; goldReward: number; scale: number; boss: boolean; physicDef: number; magicDef: number;
    /** Extra resistance (%) to the listed status types (late waves, see WaveMgr.statusResist). */
    statusResist?: { types: string[]; value: number };
    /** Final damage taken reduction (%) (see WaveMgr.finalReduce); hero skills ignore it. */
    finalReduce?: number;
    /** Mutant type (waves.json "mutants"): bigger, tinted, with its own multipliers. */
    mutant?: string; }

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
    /** A tower hit effect is playing on this enemy (one at a time: CombatManager.impactFx). */
    hitFx = false;
    statuses: StatusInstance[] = [];
    /** Expected damage of the projectiles already flying at this enemy (used to avoid overkill). */
    pendingDamage = 0;
    /** Extra status resistance of this wave (see EnemyStats). */
    private waveResist: { types: string[]; value: number } = { types: [], value: 0 };
    /** Final damage taken reduction (%): every damage but the hero skills (true damage) is cut by it. */
    finalReduce = 0;
    /** Mutant type id ('' for a normal enemy) and the sprite color when no status tints it. */
    mutant = '';
    private baseColor: Color = Color.WHITE;
    /** Seconds left during which a status type cannot be applied again (status "immunityAfter"). */
    private immune: { [type: string]: number } = {};
    /** Wave boss (bigger, tougher). */
    boss = false;
    /** Statuses the enemy had when it died (passive "Prey" moves its marks on). */
    deathStatuses: StatusInstance[] = [];
    /** Passive "Deep Freeze": Frost hits taken while already slowed. */
    frostHits = 0;
    /** Passive "Aftershock": seconds left of the extra damage taken after a Shockwave stun. */
    aftershock = 0;
    /** Seconds left of the Exposed passive (+crit damage after an Armor Break). */
    exposed = 0;
    /** Flies (enemy.json "flying"): towers with "hitsFlying": false (Catapult) cannot hit it. */
    flying = false;
    /** Ranged enemy (enemy.json "ranged"): distance in front of the wall where it stops to attack. */
    private stopDist = 0;
    private attackTimer = 0;
    /**
     * What the enemy is doing instead of moving: a ranged attack, a spell or a teleport (one at a time,
     * with its animation). `fired`: the attack / spell already took effect (at its frame).
     */
    private action: { kind: 'attack' | 'spell' | 'tpOut' | 'tpIn'; spell?: any; fired: boolean } | null = null;
    /** Seconds before each spell of enemy.json "spells" can be cast again. */
    private spellTimers: number[] = [];
    /** Spells with "hpBelowPct" are cast once, the first time the HP falls below that share. */
    private spellsUsed: boolean[] = [];
    /** Size factor of the sprite (enemy.json "scale" x spawn scale, e.g. bosses). */
    get scale(): number { return this.spriteComp.node.scale.x; }
    /** Spell shield (boss): damage it still absorbs, seconds left, and its picture. */
    shieldHp = 0;
    shieldMax = 0;
    shieldTime = 0;
    private shieldSprite: Sprite | null = null;
    private shieldAnim: SpriteAnim | null = null;
    private shieldCollapsing = false;
    /** Haste from a boss spell: % more speed for `hasteTime` s. */
    hastePct = 0;
    hasteTime = 0;
    /** At its attack position (stopped in front of the wall). */
    inPosition = false;
    /** Number given at each spawn: tells a pooled enemy apart from its previous life. */
    serial = 0;

    private anim: SpriteAnim;
    private spriteComp: Sprite;
    private hpBar: HpBar;
    /** Created on the first status effect only (labels are expensive to draw). */
    private statusLabel: Label | null = null;
    /** Row of status icons above the HP bar (effects.json visual.icon); created on demand. */
    private statusIcons: Node | null = null;
    private iconSprites: Sprite[] = [];
    /** Stack count on each status icon (statuses that stack). */
    private iconCounts: Label[] = [];
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
        this.alive = true; this.removed = false; this.reachedWall = false; this.rewarded = false; this.pushTime = 0; this.hitFx = false;
        this.statuses.length = 0;
        this.pendingDamage = 0;
        this.waveResist = stats.statusResist || { types: [], value: 0 };
        this.finalReduce = stats.finalReduce || 0;
        this.mutant = stats.mutant || '';
        const mt = this.mutant ? WaveMgr.mutantDef(this.mutant) : null;
        this.baseColor = mt && mt.tint ? hex(mt.tint) : Color.WHITE;
        this.immune = {};
        this.flash = 0; this.sprintTimer = 0; this.sprintLeft = 0;
        this.frostHits = 0; this.aftershock = 0; this.exposed = 0; this.deathStatuses = [];
        this.flying = !!def.flying;
        const rg = def.ranged;
        this.stopDist = rg && !rg.anyRange ? Math.max(0, (rg.range || 200) + (Math.random() * 2 - 1) * (rg.rangeSpread || 0)) : 0;
        this.attackTimer = rg ? (rg.firstAttackDelay || 0) : 0;
        this.action = null; this.inPosition = false;
        this.spellTimers = (def.spells || []).map((sp: any) => sp.firstDelay || 0);
        this.spellsUsed = (def.spells || []).map(() => false);
        this.shieldHp = 0; this.shieldMax = 0; this.shieldTime = 0; this.shieldCollapsing = false;
        if (this.shieldSprite) this.shieldSprite.node.active = false;
        this.hastePct = 0; this.hasteTime = 0;
        const scale = (def.scale || 1) * stats.scale;
        this.radius = (def.radius || 22) * scale;
        this.abilities = (def.specialAbilities || []).filter((a: any) => a.enabled);

        this.node.name = 'Enemy_' + def.id;
        this.node.setPosition(x, y, 0);
        this.spriteComp.node.setScale(scale, scale, 1);
        this.spriteComp.color = this.baseColor;
        const ok = this.playAnim(def.animationPaths.move, true);
        this.spriteComp.node.active = ok;
        if (!ok) this.showPlaceholder(def);
        if (this.placeholder) this.placeholder.active = !ok;
        this.hpBar.node.active = Display.hpBars;
        this.hpBar.resize(stats.boss ? 70 : 36, stats.boss ? 6 : 4);
        this.hpBar.node.setPosition(0, this.radius + 12, 0);
        this.hpBar.set(1, '#6ad66a');
        if (this.statusLabel) { this.statusLabel.string = ''; this.statusLabel.node.setPosition(0, this.radius + 24, 0); }
        if (this.statusIcons) { this.statusIcons.active = false; this.statusIcons.setPosition(0, this.radius + 21, 0); }
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
    /** Rolls the status resistance (own + wave resistance, at most 95%). True = resisted. */
    resists(def: any): boolean {
        let resist = (this.def.statusEffectResistance && this.def.statusEffectResistance[def.type]) || 0;
        if (this.waveResist.types.indexOf(def.type) >= 0) resist += this.waveResist.value;
        return Math.random() * 100 < Math.min(95, resist);
    }

    applyStatus(def: any, sourceUid: number, durationMul = 1, valueMul = 1): boolean {
        if (!this.alive) return false;
        // "resistFirstStackOnly" (Bleed): only the first stack can be resisted; an enemy that already bleeds takes every new stack.
        const has = def.resistFirstStackOnly && this.statuses.some(s => s.def.id === def.id);
        if (!has && this.resists(def)) return false;
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
    get slowed(): boolean { return this.statuses.some(s => s.def.type === 'slow'); }
    get armorBroken(): boolean { return this.statuses.some(s => s.def.type === 'armorBreak'); }
    /** The status instance of an effect id (its def is the resolved copy that was applied), or null. */
    statusOf(id: string): StatusInstance | null { return this.statuses.find(s => s.def.id === id) || null; }

    /** Points removed from effective defense by Armor Break effects. */
    defReduction(type: DamageType): number {
        let v = 0;
        for (const s of this.statuses) {
            if (s.def.type === 'armorBreak' && (!s.def.damageTypes || s.def.damageTypes.indexOf(type) >= 0)) v += s.value * s.stacks;
        }
        return v;
    }

    /** Extra damage % taken from this tower / damage type because of Mark effects. */
    /** Mark of this tower at its maximum stacks (Hunter's Mark x5), or null. */
    fullMark(towerId: string): any {
        for (const s of this.statuses) {
            if (s.def.type !== 'mark' || !s.def.atMaxStacks) continue;
            if (s.def.towerIds && s.def.towerIds.indexOf(towerId) >= 0 && s.stacks >= Math.max(1, s.def.maxStacks || 1)) return s.def.atMaxStacks;
        }
        return null;
    }

    /** Removes every instance of a status (Bleed burst). */
    clearStatus(id: string) {
        const n = this.statuses.length;
        this.statuses = this.statuses.filter(s => s.def.id !== id);
        if (this.statuses.length !== n) this.refreshStatusLabel();
    }

    /** Stacks of a status (0 when absent). */
    stacksOf(id: string): number {
        let n = 0;
        for (const s of this.statuses) if (s.def.id === id) n = Math.max(n, s.stacks);
        return n;
    }

    /** `otherTowerShare`: passive "Open Season", the share of a tower mark that also works for the other towers. */
    markBonus(towerId: string, type: DamageType, otherTowerShare = 0): number {
        let v = 0;
        for (const s of this.statuses) {
            if (s.def.type !== 'mark') continue;
            const byTower = s.def.towerIds && s.def.towerIds.indexOf(towerId) >= 0;
            const byType = s.def.damageTypes && s.def.damageTypes.indexOf(type) >= 0;
            if (byTower || byType) v += s.value * s.stacks;
            else if (otherTowerShare > 0 && s.def.towerIds) v += s.value * s.stacks * otherTowerShare;
        }
        return v;
    }

    // Push from a skill (Air Burst knock-back): velocity in px/s for pushTime seconds, even while stunned.
    private pushVX = 0;
    private pushVY = 0;
    private pushTime = 0;

    /** Moves the enemy by (dx, dy) over `time` seconds (skills). */
    push(dx: number, dy: number, time: number) {
        if (!this.alive) return;
        const t = Math.max(0.01, time);
        this.pushVX = dx / t; this.pushVY = dy / t; this.pushTime = t;
    }

    /**
     * Stun from a skill (Crater Impact): ignores resistance and stun immunity, and the duration is
     * fixed. Tower stuns cannot shorten it (the immunity covers it).
     */
    forceStun(def: any, seconds: number) {
        if (!this.alive || !def) return;
        this.statuses = this.statuses.filter(s => s.def.type !== 'stun');
        this.statuses.push({ def, remaining: seconds, value: def.value || 0, stacks: 1, tick: 0, sourceUid: 0 });
        this.immune[def.type] = seconds + (def.immunityAfter || 0);
        this.refreshStatusLabel();
    }

    /** Display.effects when the status icons were last drawn (redrawn when the setting changes). */
    private shownEffects = true;

    private refreshStatusLabel() {
        this.shownEffects = Display.effects;
        // One icon per status type (effects.json "visual.icon"); statuses without an icon (Burn) are shown as text.
        const icons: string[] = [];
        const stacks: number[] = [];
        const labels: string[] = [];
        let color = '#ffffff';
        // Settings > Effects off: no status icons, labels or tint.
        for (const s of (Display.effects ? this.statuses : [])) {
            const v = s.def.visual || {};
            if (v.icon) {
                const k = icons.indexOf(v.icon);
                const n = (s.def.maxStacks || 1) > 1 ? s.stacks : 0; // count only for statuses that stack
                if (k < 0) { icons.push(v.icon); stacks.push(n); } else stacks[k] = Math.max(stacks[k], n);
            }
            else {
                const l = v.label || s.def.name;
                if (labels.indexOf(l) < 0) labels.push(l);
            }
            color = v.color || color;
        }
        this.showStatusIcons(icons, stacks);
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
            // Text goes above the icons when both are shown.
            this.statusLabel.node.setPosition(0, this.radius + (icons.length > 0 ? 36 : 24), 0);
        }
        // Tint the sprite with the most recent effect color so effects stay readable in a crowd.
        const any = icons.length + labels.length > 0;
        if (this.flash <= 0) this.spriteComp.color = any ? this.tint(color) : this.baseColor;
    }

    /** Status icons in a centered row (pictures come from the combat atlas). */
    private showStatusIcons(paths: string[], stacks: number[] = []) {
        if (paths.length === 0) { if (this.statusIcons) this.statusIcons.active = false; return; }
        if (!this.statusIcons) {
            this.statusIcons = mk('StatusIcons', this.node, 0, this.radius + 21);
        }
        this.statusIcons.active = true;
        const step = STATUS_ICON + 2, x0 = -((paths.length - 1) * step) / 2;
        for (let i = 0; i < paths.length; i++) {
            let sp = this.iconSprites[i];
            if (!sp) { sp = sprite(this.statusIcons, null, STATUS_ICON, STATUS_ICON); this.iconSprites.push(sp); }
            const frames = Assets.frames(paths[i], STATUS_ICON, STATUS_ICON);
            sp.spriteFrame = frames.length > 0 ? frames[0] : null;
            sp.node.active = true;
            sp.node.setPosition(x0 + i * step, 0, 0);
            // Stack count (Hunter's Mark, Bleed) in the icon's lower right corner.
            // Stacking statuses show "x1".."x5" small and white in the lower right quarter of the icon.
            const n = stacks[i] || 0;
            let lb = this.iconCounts[i];
            if (n > 0 && !lb) {
                lb = text(sp.node, '', 8, STATUS_ICON / 4 + 1, -STATUS_ICON / 4 + 1, { bold: true });
                // CHAR cache: the count changes often (every stack); one shared glyph texture instead of a new
                // texture for every change. The outline makes it look bold (CHAR cannot draw bold glyphs).
                lb.cacheMode = Label.CacheMode.CHAR;
                lb.enableOutline = true;
                lb.outlineColor = new Color(20, 14, 28, 255);
                lb.outlineWidth = 1;
                this.iconCounts[i] = lb;
            }
            if (lb) { lb.node.active = n > 0; if (n > 0) lb.string = 'x' + n; }
        }
        for (let i = paths.length; i < this.iconSprites.length; i++) this.iconSprites[i].node.active = false;
    }

    private tint(c: string): Color {
        const k = hex(c);
        return new Color(Math.round((k.r + 255) / 2), Math.round((k.g + 255) / 2), Math.round((k.b + 255) / 2), 255);
    }

    // ------------------------------------------------------------------ damage
    /** Subtract HP (never below 0). Returns true when this hit killed the enemy. */
    takeDamage(amount: number): boolean {
        if (!this.alive) return false;
        // Spell shield: absorbs the damage first.
        if (this.shieldHp > 0) {
            const a = Math.min(this.shieldHp, amount);
            this.shieldHp -= a; amount -= a;
            if (this.shieldHp <= 0) this.breakShield();
        }
        this.hp = Math.max(0, this.hp - amount);
        this.refreshHpBar();
        this.flash = 0.08;
        this.spriteComp.color = new Color(255, 120, 120, 255);
        if (this.hp <= 0) { this.kill(); return true; }
        return false;
    }

    private refreshHpBar() {
        const f = this.hp / this.maxHp;
        this.hpBar.set(f, this.shieldHp > 0 ? '#8fd8ff' : f < 0.35 ? '#e05252' : '#6ad66a');
    }

    /**
     * Plays an animation of enemy.json "animationPaths" (cell size, frames, frame time, and "anchor": the point
     * of the cell at the enemy position, for sheets whose cells are not centred). False when the sheet is missing.
     */
    private playAnim(cfg: any, loop: boolean): boolean {
        if (!cfg) return false;
        const frames = Assets.frames(cfg.path, cfg.cellW, cfg.cellH).slice(0, cfg.frames);
        if (frames.length === 0) return false;
        const ui = this.spriteComp.node.getComponent(UITransform)!;
        ui.setContentSize(cfg.cellW, cfg.cellH);
        const a = cfg.anchor || [0.5, 0.5];
        ui.setAnchorPoint(a[0], a[1]);
        this.anim.play(frames, cfg.frameTime, loop);
        return true;
    }

    private playMove() { this.playAnim(this.def.animationPaths.move, true); }

    /** Stop point of a ranged enemy (x), or -Infinity. */
    private stopX(host: IEnemyHost): number {
        const rg = this.def.ranged;
        // "anyRange": shoots from anywhere on the field, never stops (it walks on to the wall).
        return rg && !rg.anyRange ? host.wallRightX + this.radius + this.stopDist : -Infinity;
    }

    /**
     * Actions instead of moving (one at a time, each with its animation; a stun pauses them):
     *  - ranged attack (enemy.json "ranged"): at its position, every "attackInterval" s; the projectile leaves
     *    at the attack animation's "hitFrame";
     *  - spells (enemy.json "spells"), each on its own cooldown: "shield" / "summon" take effect at "castFrame"
     *    (CombatManager.bossSpell); "teleport" jumps "distance" px forward (never past the stop point).
     * Returns true while an action is playing (the enemy does not move).
     */
    private updateActions(dt: number, host: IEnemyHost): boolean {
        if (this.stunned) return this.action !== null;
        const anims = this.def.animationPaths;
        // Spell cooldowns run all the time (also while another action plays).
        const spells: any[] = this.def.spells || [];
        for (let i = 0; i < spells.length; i++) if (this.spellTimers[i] > 0) this.spellTimers[i] -= dt;
        // The attack timer of a ranged enemy that shoots from anywhere runs all the time too (an attack
        // then starts as soon as the current action ends).
        const rgAny = this.def.ranged && this.def.ranged.anyRange;
        if (rgAny && this.attackTimer > 0) this.attackTimer -= dt;
        const a = this.action;
        if (a) {
            const ended = this.anim.update(dt) || this.anim.finished;
            if (a.kind === 'attack' && !a.fired && (this.anim.index >= (anims.attack.hitFrame || 0) || ended)) { a.fired = true; host.enemyShoot(this); }
            if (a.kind === 'spell' && !a.fired && (this.anim.index >= (a.spell.castFrame || 0) || ended)) { a.fired = true; host.bossSpell(this, a.spell); }
            if (!ended) return true;
            if (a.kind === 'tpOut') {
                // Gone: reappear `distance` px closer to the wall (not past the stop point of a ranged enemy).
                const sp = a.spell;
                this.x = Math.max(this.stopX(host), host.wallRightX + this.radius + 10, this.x - (sp.distance || 120));
                this.node.setPosition(this.x, this.y, 0);
                this.action = { kind: 'tpIn', spell: sp, fired: true };
                if (!this.playAnim(anims.teleportIn, false)) { this.action = null; this.playMove(); }
                return true;
            }
            this.action = null;
            this.playMove();
            return false;
        }
        // Spells, then the ranged attack.
        for (let i = 0; i < spells.length; i++) {
            const sp = spells[i];
            if (sp.hpBelowPct !== undefined) {
                // Once, when the HP falls below the share.
                if (this.spellsUsed[i] || this.hpPercent >= sp.hpBelowPct) continue;
                this.spellsUsed[i] = true;
            } else if (this.spellTimers[i] > 0) continue;
            if (sp.type === 'shield' && this.shieldHp > 0 && sp.hpBelowPct === undefined) continue;
            if (sp.type === 'teleport' && (this.inPosition || this.x - this.stopX(host) < (sp.distance || 120) * 0.5)) continue;
            this.spellTimers[i] = sp.cooldown || 10;
            if (sp.type === 'teleport') {
                this.action = { kind: 'tpOut', spell: sp, fired: false };
                if (!this.playAnim(anims.teleportOut, false)) { this.action = { kind: 'tpOut', spell: sp, fired: false }; this.anim.finished = true; }
            } else {
                this.action = { kind: 'spell', spell: sp, fired: false };
                if (!this.playAnim(anims[sp.anim] || anims.attack, false)) { host.bossSpell(this, sp); this.action = null; continue; }
            }
            return true;
        }
        const rg = this.def.ranged;
        if (!rg) return false;
        if (rg.anyRange) {
            // From anywhere on the field (the projectile always reaches the wall).
            if (this.x > ConfigMgr.tower.battlefield.worldWidth) return false;
        } else if (!this.inPosition) return false;
        if (!rg.anyRange) this.attackTimer -= dt;
        if (this.attackTimer > 0) return false;
        this.attackTimer = rg.attackInterval || 2;
        if (!this.playAnim(anims.attack, false)) { host.enemyShoot(this); return false; }   // no attack sheet: shoot at once
        this.action = { kind: 'attack', fired: false };
        return true;
    }

    /** A spell shield (CombatManager.bossSpell): absorbs `hp` damage for `time` s. */
    raiseShield(hp: number, time: number, loop: any, collapse: any) {
        this.shieldHp = this.shieldMax = Math.max(1, Math.round(hp));
        this.shieldTime = time;
        this.shieldCollapsing = false;
        this.shieldCfg = { loop, collapse };
        if (loop) {
            const s = this.ensureShieldSprite();
            const frames = Assets.frames(loop.path, loop.cellW, loop.cellH).slice(0, loop.frames);
            s.node.active = frames.length > 0;
            s.node.getComponent(UITransform)!.setContentSize(loop.cellW, loop.cellH);
            s.node.setPosition(0, loop.offsetY || 0, 0);
            const k = this.spriteComp.node.scale.x;
            s.node.setScale(k, k, 1);
            this.shieldAnim!.play(frames, loop.frameTime || 0.08, true);
        }
        this.refreshHpBar();
    }
    private shieldCfg: { loop: any; collapse: any } | null = null;

    private ensureShieldSprite(): Sprite {
        if (!this.shieldSprite) {
            const n = new Node('Shield');
            n.layer = this.node.layer;
            n.addComponent(UITransform);
            this.node.addChild(n);
            this.shieldSprite = n.addComponent(Sprite);
            this.shieldSprite.sizeMode = Sprite.SizeMode.CUSTOM;
            this.shieldAnim = new SpriteAnim(this.shieldSprite);
            // above the body, below the HP bar and texts
            n.setSiblingIndex(this.node.children.indexOf(this.spriteComp.node) + 1);
        }
        return this.shieldSprite;
    }

    /** The shield breaks (no more absorb, or its time ran out): collapse animation, then hidden. */
    private breakShield() {
        this.shieldHp = 0; this.shieldTime = 0;
        this.refreshHpBar();
        if (!this.shieldSprite || !this.shieldSprite.node.active) return;
        const c = this.shieldCfg && this.shieldCfg.collapse;
        const frames = c ? Assets.frames(c.path, c.cellW, c.cellH).slice(0, c.frames) : [];
        if (frames.length === 0) { this.shieldSprite.node.active = false; return; }
        this.shieldCollapsing = true;
        this.shieldAnim!.play(frames, c.frameTime || 0.07, false);
    }

    private updateShield(dt: number) {
        if (this.shieldTime > 0) { this.shieldTime -= dt; if (this.shieldTime <= 0 && this.shieldHp > 0) this.breakShield(); }
        if (!this.shieldSprite || !this.shieldSprite.node.active) return;
        const ended = this.shieldAnim!.update(dt);
        if (this.shieldCollapsing && (ended || this.shieldAnim!.finished)) { this.shieldSprite.node.active = false; this.shieldCollapsing = false; }
    }

    /** Stop moving, drop every status effect and play the death animation. */
    kill() {
        if (!this.alive) return;
        this.alive = false;
        this.deathStatuses = this.statuses.slice();
        this.statuses.length = 0;
        if (this.statusLabel) this.statusLabel.string = '';
        if (this.statusIcons) this.statusIcons.active = false;
        this.hpBar.node.active = false;
        this.spriteComp.color = this.baseColor;
        this.action = null;
        if (this.shieldHp > 0) this.breakShield();
        if (!this.playAnim(this.def.animationPaths.dead, false)) this.removed = true;
    }

    // ------------------------------------------------------------------ update
    update(dt: number, host: IEnemyHost) {
        if (!this.alive) {
            this.updateShield(dt);
            if (!this.removed && (this.anim.update(dt) || this.anim.finished)) this.removed = true;
            return;
        }
        this.updateShield(dt);
        if (this.hasteTime > 0) { this.hasteTime -= dt; if (this.hasteTime <= 0) this.hastePct = 0; }
        if (this.flash > 0) {
            this.flash -= dt;
            if (this.flash <= 0) this.refreshStatusLabel();
        }
        // Display settings changed during the battle.
        if (this.hpBar.node.active !== Display.hpBars) this.hpBar.node.active = Display.hpBars;
        if (this.shownEffects !== Display.effects) this.refreshStatusLabel();

        // Status effects: damage over time and expiry.
        for (const k in this.immune) if (this.immune[k] > 0) this.immune[k] -= dt;
        if (this.aftershock > 0) this.aftershock -= dt;
        if (this.exposed > 0) this.exposed -= dt;
        let changed = false;
        for (let i = this.statuses.length - 1; i >= 0; i--) {
            const s = this.statuses[i];
            if ((s.def.type === 'bleed' || s.def.type === 'burn') && s.def.tickInterval > 0) {
                s.tick -= dt;
                while (s.tick <= 0 && this.alive) {
                    s.tick += s.def.tickInterval;
                    host.applyDot(this, s.value * s.stacks, s.def.damageType || (s.def.type === 'bleed' ? 'physic' : 'magic'), s.def.type, s.sourceUid, s.def.id, (s.def.currentHpPctPerTick || 0) * s.stacks);
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
        if (this.hasteTime > 0) speed *= 1 + this.hastePct / 100;
        speed *= 1 - this.slowPercent() / 100;
        if (this.stunned) speed = 0;
        // Attacking, casting or teleporting: no walking.
        const acting = this.action !== null;
        if (acting) speed = 0;
        speed = Math.max(0, speed);
        // Ranged enemies stop in front of the wall and attack from there.
        const rg = this.def.ranged;
        const stopX = this.stopX(host);
        if (rg && this.x - speed * dt <= stopX) { this.x = Math.min(this.x, stopX); speed = 0; this.inPosition = this.x <= stopX + 0.5; }
        else { this.x -= speed * dt; this.inPosition = false; }
        if (this.pushTime > 0) {
            const t = Math.min(dt, this.pushTime);
            this.pushTime -= t;
            const bf = ConfigMgr.tower.battlefield;
            this.x = Math.min(bf.spawnX, this.x + this.pushVX * t);
            this.y = Math.max(bf.enemyLaneY[0], Math.min(bf.enemyLaneY[1], this.y + this.pushVY * t));
        }
        this.node.setPosition(this.x, this.y, 0);
        const busy = (rg || this.def.spells) ? this.updateActions(dt, host) : false;
        if (!this.alive) return;
        // Flying / floating / ranged enemies keep their move animation while they stand still.
        if (!busy && !acting && (speed > 0 || this.flying || rg || this.def.spells) && !this.stunned) this.anim.update(dt);

        // Contact with the wall: handled exactly once.
        if (!this.reachedWall && this.x - this.radius <= host.wallRightX) {
            this.reachedWall = true;
            host.onEnemyReachedWall(this);
            this.kill();
        }
    }
}
