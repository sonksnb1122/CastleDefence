import { Node, Sprite, UITransform } from 'cc';
import { Assets } from '../core/Assets';
import { ShotInfo } from '../core/GameTypes';
import { sprite } from '../views/common/UIKit';
import { Enemy } from './Enemy';
import { SpriteAnim } from './SpriteAnim';

const RAD2DEG = 180 / Math.PI;

/**
 * A projectile that homes on its target (or on the target's last position
 * when it dies first). Catapult shots add a visual arc on top of the path.
 * Projectiles are pooled: launch() reuses the node of a finished one.
 */
export class Projectile {
    node: Node;
    done = false;
    shot: ShotInfo = null as any;
    cfg: any = null;
    target: Enemy | null = null;
    /** Ground position (the arc is only visual). */
    x = 0;
    y = 0;
    tx = 0;
    ty = 0;
    private anim: SpriteAnim;
    private sp: Sprite;
    private startDist = 1;
    private reach = 4;
    private speed = 0;

    constructor(parent: Node) {
        this.sp = sprite(parent, null, 1, 1);
        this.node = this.sp.node;
        this.anim = new SpriteAnim(this.sp);
        this.node.active = false;
    }

    launch(shot: ShotInfo, cfg: any, target: Enemy | null, x: number, y: number, angleDeg: number, speed: number, scale = 1) {
        this.shot = shot; this.cfg = cfg; this.target = target; this.speed = speed;
        this.done = false;
        this.x = x; this.y = y;
        this.tx = target ? target.x : x;
        this.ty = target ? target.y : y;
        this.node.getComponent(UITransform)!.setContentSize(cfg.cellW, cfg.cellH);
        this.node.setPosition(x, y, 0);
        this.node.setScale(scale, scale, 1);
        this.reach = (cfg.tip || 0) * scale + 4;
        this.node.angle = angleDeg - cfg.faceOffset;
        this.anim.play(Assets.frames(cfg.path, cfg.cellW, cfg.cellH), cfg.frameTime, true);
        this.startDist = Math.max(1, Math.hypot(this.tx - x, this.ty - y));
        this.node.active = true;
    }

    /** Hide the node so the projectile can wait in the pool. */
    release() { this.node.active = false; this.target = null; }

    /** Returns true on the frame the projectile reaches its destination. */
    update(dt: number): boolean {
        if (this.done) return false;
        this.anim.update(dt);
        if (this.target && this.target.alive) { this.tx = this.target.x; this.ty = this.target.y; }
        else this.target = null;
        const dx = this.tx - this.x, dy = this.ty - this.y;
        const dist = Math.hypot(dx, dy);
        const reach = this.reach;
        const step = this.speed * dt;
        if (dist <= reach + step) {
            this.done = true;
            return true;
        }
        this.x += (dx / dist) * step;
        this.y += (dy / dist) * step;
        let lift = 0;
        if (this.cfg.arc) {
            const progress = Math.max(0, Math.min(1, 1 - (dist - step) / this.startDist));
            lift = this.cfg.arc * Math.sin(Math.PI * progress);
        } else {
            this.node.angle = Math.atan2(dy, dx) * RAD2DEG - this.cfg.faceOffset;
        }
        this.node.setPosition(this.x, this.y + lift, 0);
        return false;
    }
}
