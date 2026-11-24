import { Node, Label, UITransform, Color } from 'cc';
import { Assets } from '../core/Assets';
import { ConfigMgr } from '../core/ConfigMgr';
import { Cost } from '../core/GameTypes';
import { ResourceMgr } from '../core/ResourceMgr';
import { HeroSkillService } from '../core/services/HeroSkillService';
import { HeroCardView } from './items/HeroCardView';
import { PrefabButton, PrefabUi } from './common/PrefabUi';
import { COLORS, costRow, hex, sprite, text } from './common/UIKit';

/** Picture of a skill: the frame of its VFX where the effect lands, fitted in w x h. Passives get a label. */
export function skillArt(holder: Node, skillId: string, w: number, h: number): Node {
    const def = ConfigMgr.skillDef(skillId);
    const v = def && def.vfx;
    if (v) {
        const frames = Assets.frames(v.path, v.cellW, v.cellH);
        const f = frames[Math.min(frames.length - 1, Math.max(0, v.iconFrame !== undefined ? v.iconFrame : (v.hitFrame || 0) + 1))];
        if (f) {
            const k = Math.min(w / v.cellW, h / v.cellH);
            return sprite(holder, f, v.cellW * k, v.cellH * k).node;
        }
    }
    return text(holder, HeroSkillService.isPassive(skillId) ? 'PASSIVE' : 'SKILL', 13, 0, 0, { bold: true, color: COLORS.accent }).node;
}

/** "Active skill - recharges in 5 waves" / "Passive skill". */
export function skillTypeLine(skillId: string): string {
    if (HeroSkillService.isPassive(skillId)) return 'Passive skill';
    return `Active skill - once every ${ResourceMgr.inst.skills.cooldownWaves} waves`;
}

export function skillName(skillId: string): string { const d = ConfigMgr.anySkillDef(skillId); return d ? d.name : skillId; }
export function skillDescription(skillId: string): string { const d = ConfigMgr.anySkillDef(skillId); return d ? d.description || '' : ''; }

export interface BookCardOpts {
    /** Books owned (shown after the name). */
    count?: number;
    /** Price and Buy button (Market offers), or the cost of the action button. */
    price?: Cost;
    bought?: boolean;
    onBuy?: () => void;
    /** Text of the action button (default "Buy"). */
    buttonText?: string;
    /** Action allowed (default: price affordable during preparation). */
    enabled?: boolean;
}

/**
 * Skill book card: the hero card prefab (prefabs/items/HeroCard) with the skill picture,
 * its name, its type and its description in place of the hero buffs.
 */
export function bookCard(parent: Node, skillId: string, x: number, y: number, cw: number, ch: number, o: BookCardOpts = {}): HeroCardView {
    const v = PrefabUi.view('items/HeroCard', parent, HeroCardView);
    v.node.setPosition(x, y, 0);
    PrefabUi.setSize(v.node, cw, ch);
    if (v.frame) { const k = v.frame.node.scale.x || 1; PrefabUi.setSize(v.frame.node, cw / k, ch / k); }
    PrefabUi.align(v.node);
    const holder = v.art!;
    if (v.placeholder) v.placeholder.node.active = false;
    const a = PrefabUi.size(holder);
    skillArt(holder, skillId, a.width - 6, a.height - 6);
    v.heroName!.string = skillName(skillId) + (o.count && o.count > 1 ? `  x${o.count}` : '');
    v.passive!.node.active = true;
    v.passive!.string = skillTypeLine(skillId);
    v.passive!.color = hex(HeroSkillService.isPassive(skillId) ? '#9fe8ff' : COLORS.accent);
    // Description in place of the buffs, wrapped to the card width.
    const b = v.buffs!;
    const tx = b.node.position.x;
    const width = cw / 2 - tx - 16;
    b.overflow = Label.Overflow.RESIZE_HEIGHT;
    b.enableWrapText = true;
    b.node.getComponent(UITransform)!.setContentSize(width, b.lineHeight);
    b.node.setPosition(tx, v.passive!.node.position.y - 16, 0);
    b.string = skillDescription(skillId);
    b.color = hex('#e6e0f0');
    if (o.price) {
        // Price + Buy button at the bottom right of the card.
        const node = PrefabUi.create('items/TowerButton', v.node);
        node.setPosition(cw / 2 - 98, -ch / 2 + 34, 0);
        const btn = new PrefabButton(node, () => { if (o.onBuy) o.onBuy(); });
        if (o.bought) {
            btn.setText('Bought');
            btn.setEnabled(false);
        } else {
            btn.setText(o.buttonText || 'Buy');
            costRow(node.getChildByName('Cost'), o.price, 0, 0, { align: 'center', size: 16, fontSize: 12, bold: true });
            btn.setEnabled(o.enabled !== undefined ? o.enabled : ResourceMgr.inst.canAfford(o.price) && ResourceMgr.inst.isPreparation);
        }
        if (o.bought && v.frame) v.frame.color = new Color(150, 150, 165, 255);
    }
    return v;
}
