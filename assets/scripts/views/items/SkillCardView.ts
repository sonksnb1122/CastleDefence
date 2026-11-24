import { _decorator, Component, Node, Label, Sprite } from 'cc';
const { ccclass, property } = _decorator;

/** prefabs/items/SkillCard: small hero card of the battle HUD (hero picture, skill name, recharge, highlight). */
@ccclass('SkillCardView')
export class SkillCardView extends Component {
    @property(Node) glow: Node | null = null;
    @property(Sprite) frame: Sprite | null = null;
    @property(Node) art: Node | null = null;
    @property(Label) placeholder: Label | null = null;
    @property(Label) skillName: Label | null = null;
    @property(Node) shade: Node | null = null;
    @property(Label) status: Label | null = null;
}
