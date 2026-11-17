import { Node } from 'cc';
import { Assets } from '../core/Assets';
import { ShotInfo } from '../core/GameTypes';
import { sprite } from '../ui/UIKit';
import { Enemy } from './Enemy';
import { SpriteAnim } from './SpriteAnim';

const RAD2DEG = 180 / Math.PI;

/**
 * A projectile that homes on its target (or on the target's last position
 * when it dies first). Catapult shots add a visual arc on top of the path.
 */
export class Projectile {
    node: Node;
    done = false;
    /** Ground position (the arc is only visual). */
    x: number;
    y: number;
    tx: number;
    ty: number;
    private anim: SpriteAnim;
    private startDist: number;
    private reach: number;

    constructor(parent: Node, public shot: ShotInfo, public cfg: any, public target: Enemy | null,
                x: number, y: number, angleDeg: number, private speed: number, scale = 1) {
        this.x = x; this.y = y;
        this.tx = target ? target.x : x;
        this.ty = target ? target.y : y;
        const sp = sprite(parent, null, cfg.cellW, cfg.cellH, x, y);
        this.node = sp.node;
        this.node.setScale(scale, scale, 1);
        this.reach = (cfg.tip || 0) * scale + 4;
        this.node.angle = angleDeg - cfg.faceOffset;
        this.anim = new SpriteAnim(sp);
        this.anim.play(Assets.frames(cfg.path, cfg.cellW, cfg.cellH), cfg.frameTime, true);
        this.startDist = Math.max(1, Math.hypot(this.tx - x, this.ty - y));
    }

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
