import { Node, Sprite, SpriteFrame, UITransform, Graphics } from 'cc';
import { Assets } from '../core/Assets';
import { ConfigMgr } from '../core/ConfigMgr';
import { ShotInfo, TowerSave } from '../core/GameTypes';
import { ResourceMgr } from '../core/ResourceMgr';
import { hex, mk, sprite, text } from '../ui/UIKit';
import { Enemy } from './Enemy';
import { SpriteAnim } from './SpriteAnim';

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

function wrap180(a: number): number { return ((((a + 180) % 360) + 360) % 360) - 180; }

/** What a tower needs from the battle (implemented by CombatManager). */
export interface ITowerHost {
    selectTarget(tower: TowerUnit): Enemy | null;
    isValidTarget(tower: TowerUnit, e: Enemy | null): boolean;
    spawnProjectile(tower: TowerUnit, shot: ShotInfo, target: Enemy, fromX: number, fromY: number, angleDeg: number): void;
    /** Smart targeting: true when a clearly better target than the current one exists. */
    shouldRetarget(tower: TowerUnit): boolean;
}

/** Effective (buffed) stats of a tower. */
export interface TowerStats { damage: number; attackSpeed: number; interval: number; range: number; explosion: number; critRate: number; critDamage: number; }

/**
 * A defense tower on the battlefield: base sprite + rotating weapon.
 * The weapon turns toward its target and only fires once it is aligned.
 */
export class TowerUnit {
    node: Node;
    def: any;
    lv: any;
    target: Enemy | null = null;
    /** Remaining cooldown per special effect id. */
    effectCooldowns: { [id: string]: number } = {};
    /** Frames until Smart targeting looks for a better target again. */
    retargetTimer = 0;

    private baseSprite: Sprite;
    private weaponNode: Node;
    private weaponSprite: Sprite;
    private anim: SpriteAnim;
    private idleFrames: SpriteFrame[] = [];
    private attackFrames: SpriteFrame[] = [];
    private rangeNode: Node;
    private firing = false;
    private spawned = false;
    private cooldown = 0;
    private placeholder: Node | null = null;
    /** Visual scale of the whole tower (tower.json battlefield.towerScale). */
    readonly scale: number;
    private body: Node;

    /** `demo`: main menu background tower, ignores research / hero buffs. */
    constructor(parent: Node, public save: TowerSave, private demo = false) {
        this.def = ConfigMgr.towerDef(save.id);
        this.node = mk('Tower_' + save.id, parent, save.x, save.y);
        this.rangeNode = mk('Range', this.node);
        this.rangeNode.addComponent(Graphics);
        this.rangeNode.active = false;
        this.scale = ConfigMgr.tower.battlefield.towerScale || 1;
        // Base and weapon live in a scaled body; range circle and label stay unscaled.
        this.body = mk('Body', this.node);
        this.body.setScale(this.scale, this.scale, 1);
        this.baseSprite = sprite(this.body, null, this.def.base.cellW, this.def.base.cellH, 0, 0, 0.5, 0);
        this.weaponSprite = sprite(this.body, null, 8, 8);
        this.weaponNode = this.weaponSprite.node;
        this.anim = new SpriteAnim(this.weaponSprite);
        this.refresh();
    }

    get uid(): number { return this.save.uid; }
    /** Center of the weapon in world coordinates (origin of range and shots). */
    get cx(): number { return this.save.x; }
    get cy(): number { return this.save.y + this.lv.sprite.weaponY * this.scale; }

    /** Rebuild visuals from the saved level / position. */
    refresh() {
        this.lv = ConfigMgr.towerLevel(this.save.id, this.save.level);
        const sp = this.lv.sprite;
        this.node.setPosition(this.save.x, this.save.y, 0);
        const baseFrames = Assets.frames(this.def.base.path, this.def.base.cellW, this.def.base.cellH);
        this.baseSprite.spriteFrame = baseFrames[sp.baseFrame] || null;
        if (baseFrames.length === 0 && !this.placeholder) {
            // Placeholder when art is missing.
            this.placeholder = mk('Placeholder', this.body, 0, 40, 56, 80);
            const g = this.placeholder.addComponent(Graphics);
            g.fillColor = hex('#6b6f7a'); g.rect(-28, -40, 56, 80); g.fill();
            text(this.placeholder, this.def.name, 11, 0, 0);
        }
        const w = sp.weapon;
        this.weaponNode.getComponent(UITransform)!.setContentSize(w.cellW, w.cellH);
        this.weaponNode.setPosition(0, sp.weaponY, 0);
        this.idleFrames = Assets.range(w.path, w.cellW, w.cellH, w.idle);
        this.attackFrames = Assets.range(w.path, w.cellW, w.cellH, w.attack);
        this.firing = false;
        this.spawned = false;
        this.anim.play(this.idleFrames, w.idleFrameTime, true);
        this.rangeNode.setPosition(0, sp.weaponY * this.scale, 0);
        if (this.rangeNode.active) this.showRange(true);
    }

    /** Stats with research and hero buffs applied. */
    stats(): TowerStats {
        const id = this.save.id;
        const rm = { buff: (k: string, t?: string) => (this.demo ? 0 : ResourceMgr.inst.buff(k, t)) };
        const attackSpeed = this.lv.attackSpeed * (1 + rm.buff('attackSpeed', id) / 100);
        const explosionBuff = this.def.explosionBuffable ? rm.buff('explosionRange', id) : 0;
        return {
            damage: this.lv.damage * (1 + rm.buff('damage', id) / 100),
            attackSpeed,
            interval: 1 / attackSpeed,
            range: this.lv.attackRange * (1 + rm.buff('attackRange', id) / 100),
            explosion: this.lv.explosionRange * (1 + explosionBuff / 100),
            critRate: Math.max(0, Math.min(100, this.lv.critRate + rm.buff('critRate', id))),
            critDamage: this.lv.critDamage + rm.buff('critDamage', id),
        };
    }

    showRange(show: boolean) {
        this.rangeNode.active = show;
        if (!show) return;
        const g = this.rangeNode.getComponent(Graphics)!;
        const s = this.stats();
        g.clear();
        g.fillColor = hex('#ffffff', 26);
        g.circle(0, 0, s.range);
        g.fill();
        g.lineWidth = 2;
        g.strokeColor = hex('#ffffff', 150);
        g.circle(0, 0, s.range);
        g.stroke();
    }

    /** True when (x,y) in world space is on the tower (for selection). */
    contains(x: number, y: number): boolean {
        const top = (this.lv.sprite.weaponY + 44) * this.scale;
        return Math.abs(x - this.save.x) <= 32 * this.scale && y >= this.save.y - 6 && y <= this.save.y + top;
    }

    /** Snapshot used by the damage pipeline. Raw level values; buffs are applied in CombatManager. */
    private makeShot(): ShotInfo {
        const s = this.stats();
        const effects: any[] = [];
        for (const e of (this.lv.effects || [])) {
            const def = ConfigMgr.towerEffectDef(e.id);
            if (!def) continue;
            // Effect research (Lab Lv 3) turns an effect on with its own chance: +5% per level, max 50%.
            const researched = this.demo ? 0 : ResourceMgr.inst.buff('effect:' + e.id);
            if (researched > 0) effects.push(Object.assign({}, def, { chance: researched, maxChance: ConfigMgr.tower.defaults.maxEffectChance || 50 }));
            else if (e.enabled) effects.push(def);
        }
        return {
            towerUid: this.save.uid, towerId: this.save.id, level: this.save.level,
            damage: this.lv.damage, damageTypes: this.def.damageTypes,
            explosionRange: s.explosion, critRate: this.lv.critRate, critDamage: this.lv.critDamage,
            effects, isAoe: !!this.def.explosionBuffable,
        } as ShotInfo;
    }

    /** `host` is null during Preparation: the tower only plays its idle animation. */
    update(dt: number, host: ITowerHost | null) {
        const w = this.lv.sprite.weapon;
        this.cooldown -= dt;
        for (const id in this.effectCooldowns) if (this.effectCooldowns[id] > 0) this.effectCooldowns[id] -= dt;

        let aligned = false;
        if (host) {
            if (!host.isValidTarget(this, this.target) || host.shouldRetarget(this)) this.target = host.selectTarget(this);
            if (this.target) {
                // Turn the weapon toward the target, limited by the rotate speed.
                const cfg = ConfigMgr.tower.defaults;
                const want = Math.atan2(this.target.y - this.cy, this.target.x - this.cx) * RAD2DEG - w.faceOffset;
                const diff = wrap180(want - this.weaponNode.angle);
                const maxStep = cfg.rotateSpeed * dt;
                const step = Math.max(-maxStep, Math.min(maxStep, diff));
                this.weaponNode.angle += step;
                aligned = Math.abs(diff - step) <= cfg.alignTolerance;
            }
        } else {
            this.target = null;
        }

        if (!this.firing) {
            this.anim.update(dt);
            if (host && this.target && aligned && this.cooldown <= 0) {
                const interval = this.stats().interval;
                this.firing = true;
                this.spawned = false;
                this.cooldown = interval;
                // Fast towers compress the attack animation so it fits in the attack interval.
                const count = Math.max(1, this.attackFrames.length);
                this.anim.play(this.attackFrames, Math.min(w.attackFrameTime, (interval * 0.9) / count), false);
                if (this.attackFrames.length === 0) this.fire(host);
            }
        } else {
            const finished = this.anim.update(dt);
            if (!this.spawned && this.anim.index >= w.fireFrame) this.fire(host);
            if (finished || this.anim.finished) {
                if (!this.spawned) this.fire(host);
                this.firing = false;
                this.anim.play(this.idleFrames, w.idleFrameTime, true);
            }
        }
    }

    private fire(host: ITowerHost | null) {
        this.spawned = true;
        if (!host || !this.target || !this.target.alive) return;
        const sp = this.lv.sprite;
        const facing = (this.weaponNode.angle + sp.weapon.faceOffset) * DEG2RAD;
        const mx = this.cx + Math.cos(facing) * sp.projectile.muzzle * this.scale;
        const my = this.cy + Math.sin(facing) * sp.projectile.muzzle * this.scale;
        host.spawnProjectile(this, this.makeShot(), this.target, mx, my, facing * RAD2DEG);
    }
}
