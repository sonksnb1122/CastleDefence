import { Node, Sprite, UITransform, Color } from 'cc';
import { Assets } from '../core/Assets';
import { hex, mk } from '../views/common/UIKit';

/**
 * Health bar made of two sprites using the white frame of the combat atlas.
 * Unlike a Graphics bar it batches with the enemy sprites (same texture),
 * so hundreds of enemies do not cost hundreds of draw calls.
 */
export class HpBar {
    node: Node;
    private fill: Sprite;
    private fillUi: UITransform;
    private ratio = -1;
    private colorKey = '';

    constructor(parent: Node, private w: number, private h: number) {
        this.node = mk('HpBar', parent);
        const white = Assets.whiteFrame();
        const bg = this.node.addComponent(Sprite);
        bg.sizeMode = Sprite.SizeMode.CUSTOM;
        bg.spriteFrame = white;
        bg.color = hex('#11101a');
        const fillNode = mk('Fill', this.node, 0, 0, 0, 0, 0, 0.5);
        this.fill = fillNode.addComponent(Sprite);
        this.fill.sizeMode = Sprite.SizeMode.CUSTOM;
        this.fill.spriteFrame = white;
        this.fillUi = fillNode.getComponent(UITransform)!;
        this.resize(w, h);
    }

    /** Change the size (bosses have a bigger bar). */
    resize(w: number, h: number) {
        this.w = w; this.h = h;
        this.node.getComponent(UITransform)!.setContentSize(w + 2, h + 2);
        this.fill.node.setPosition(-w / 2, 0, 0);
        this.ratio = -1;
    }

    set(ratio: number, color: string) {
        const r = Math.max(0, Math.min(1, ratio));
        if (r !== this.ratio) {
            this.ratio = r;
            this.fillUi.setContentSize(this.w * r, this.h);
        }
        if (color !== this.colorKey) {
            this.colorKey = color;
            this.fill.color = hex(color);
        }
    }

    /** Fill color as a Color (kept for callers that tint other parts). */
    get color(): Color { return this.fill.color; }
}
