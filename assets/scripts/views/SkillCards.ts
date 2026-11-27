import { Node, Label, UITransform, Sprite, SpriteFrame, isValid } from 'cc';
import { SpriteAnim } from '../combat/SpriteAnim';
import { Assets } from '../core/Assets';
import { ConfigMgr } from '../core/ConfigMgr';
import { Cost } from '../core/GameTypes';
import { ResourceMgr } from '../core/ResourceMgr';
import { HeroSkillService } from '../core/services/HeroSkillService';
import { HeroCardView } from './items/HeroCardView';
import { PrefabButton, PrefabUi } from './common/PrefabUi';
import { COLORS, costRow, hex, sprite, text } from './common/UIKit';

/** Skill pictures playing their VFX (updated by the screens that show them, see updateSkillArts). */
const playing: Array<{ node: Node; sprite: Sprite; anim: SpriteAnim; frames: SpriteFrame[]; frameTime: number; wait: number }> = [];
/** Pause between two plays of a skill VFX on a card (seconds). */
const LOOP_PAUSE = 1;

/** Advance the VFX of the skill cards on screen (call from the screen's update). */
export function updateSkillArts(dt: number) {
    for (let i = playing.length - 1; i >= 0; i--) {
        const p = playing[i];
        if (!isValid(p.node)) { playing.splice(i, 1); continue; }
        if (p.wait > 0) {
            // Hidden for a moment after each play, then it starts again.
            p.wait -= dt;
            if (p.wait <= 0) { p.sprite.enabled = true; p.anim.play(p.frames, p.frameTime, false); }
            continue;
        }
        if (p.anim.update(dt) || p.anim.finished) { p.wait = LOOP_PAUSE; p.sprite.enabled = false; }
    }
}

/** Picture of a skill: its VFX played again and again (with a short pause), fitted in w x h. Passives get a label. */
export function skillArt(holder: Node, skillId: string, w: number, h: number): Node {
    const def = ConfigMgr.skillDef(skillId);
    const v = def && def.vfx;
    if (v) {
        const frames = Assets.frames(v.path, v.cellW, v.cellH).slice(0, v.frames || 9999);
        if (frames.length > 0) {
            const k = Math.min(w / v.cellW, h / v.cellH);
            const sp = sprite(holder, frames[0], v.cellW * k, v.cellH * k);
            const anim = new SpriteAnim(sp);
            const frameTime = v.frameTime || 0.06;
            anim.play(frames, frameTime, false);
            playing.push({ node: sp.node, sprite: sp, anim, frames, frameTime, wait: 0 });
            return sp.node;
        }
    }
    return text(holder, HeroSkillService.isPassive(skillId) ? 'PASSIVE' : 'SKILL', 13, 0, 0, { bold: true, color: COLORS.accent }).node;
}

/** "Active skill - recharges in 5 waves" / "Passive skill". */
export function skillTypeLine(skillId: string): string {
    if (HeroSkillService.isPassive(skillId)) {
        // Passives that trigger (Last Stand, Bulwark): recharge time, and the waves left while recharging.
        const cd = HeroSkillService.passiveCooldown(skillId);
        if (cd <= 0) return 'Passive skill';
        const rm = ResourceMgr.inst;
        const left = rm.skills.passiveReadyWave(skillId) - rm.data.currentWave;
        return left > 0 ? `Passive skill - recharging: ${left} wave${left > 1 ? 's' : ''} left` : `Passive skill - ready (recharges in ${cd} waves)`;
    }
    return `Active skill - once every ${ResourceMgr.inst.skills.cooldownWaves} waves`;
}

export function skillName(skillId: string): string { const d = ConfigMgr.anySkillDef(skillId); return d ? d.name : skillId; }
/** Note of the damage skills: their damage ignores enemy defense and the late-wave damage reduction. */
export const TRUE_DAMAGE_NOTE = 'True damage: ignores every defense and damage reduction.';
export function skillDescription(skillId: string): string {
    const d = ConfigMgr.anySkillDef(skillId);
    if (!d) return '';
    const dmg = !!(d.effect && d.effect.damagePct);
    return (d.description || '') + (dmg ? ' ' + TRUE_DAMAGE_NOTE : '');
}

export interface BookCardOpts {
    /** Books owned (shown after the name). */
    count?: number;
    /** Price button (Market offers: only the price), or the cost of the action button. */
    price?: Cost;
    onBuy?: () => void;
    /** Text of the action button (none: the button only shows the price). */
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
    // Texts a little lower than on the hero cards, clear of the top of the frame.
    for (const l of [v.heroName!, v.passive!]) l.node.setPosition(l.node.position.x, l.node.position.y - 10, 0);
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
        // Small button at the bottom right of the card: the price only (or a text above the cost).
        const node = PrefabUi.create('items/TowerButton', v.node);
        node.setScale(0.78, 0.78, 1);
        node.setPosition(cw / 2 - 86, -ch / 2 + 30, 0);
        const btn = new PrefabButton(node, () => { if (o.onBuy) o.onBuy(); });
        btn.setText(o.buttonText || '');
        const cost = node.getChildByName('Cost');
        if (cost && !o.buttonText) cost.setPosition(0, 0, 0);
        costRow(cost, o.price, 0, 0, { align: 'center', size: o.buttonText ? 16 : 20, fontSize: o.buttonText ? 12 : 16, bold: true });
        btn.setEnabled(o.enabled !== undefined ? o.enabled : ResourceMgr.inst.canAfford(o.price) && ResourceMgr.inst.isPreparation);
    }
    return v;
}
