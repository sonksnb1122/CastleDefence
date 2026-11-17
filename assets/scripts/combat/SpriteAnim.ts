import { Sprite, SpriteFrame } from 'cc';

/** Minimal frame animation player for one Sprite (driven manually with update). */
export class SpriteAnim {
    frames: SpriteFrame[] = [];
    index = 0;
    finished = false;
    private t = 0;
    private frameTime = 0.1;
    private loop = true;

    constructor(private sprite: Sprite) {}

    play(frames: SpriteFrame[], frameTime: number, loop: boolean) {
        this.frames = frames;
        this.frameTime = Math.max(0.005, frameTime);
        this.loop = loop;
        this.index = 0;
        this.t = 0;
        this.finished = frames.length === 0;
        this.apply();
    }

    /** Returns true exactly once, when a non-looping animation ends. */
    update(dt: number): boolean {
        if (this.finished || this.frames.length === 0) return false;
        this.t += dt;
        while (this.t >= this.frameTime) {
            this.t -= this.frameTime;
            this.index++;
            if (this.index >= this.frames.length) {
                if (this.loop) {
                    this.index = 0;
                } else {
                    this.index = this.frames.length - 1;
                    this.finished = true;
                    this.apply();
                    return true;
                }
            }
        }
        this.apply();
        return false;
    }

    private apply() {
        if (this.frames.length > 0) this.sprite.spriteFrame = this.frames[this.index];
    }
}
