import { _decorator, Component, Node, Label, Sprite } from 'cc';
const { ccclass, property } = _decorator;

/** prefabs/items/HeroCard: frame, card image holder, name, passive and buffs of a hero
 * (also used for skill books: image, name, type and description). */
@ccclass('HeroCardView')
export class HeroCardView extends Component {
    @property(Sprite) frame: Sprite | null = null;
    @property(Node) art: Node | null = null;
    @property(Label) placeholder: Label | null = null;
    @property(Label) heroName: Label | null = null;
    @property(Label) passive: Label | null = null;
    @property(Label) buffs: Label | null = null;
    /** "+": learn a skill from a skill book (owned heroes with a free skill slot). */
    @property(Node) learnButton: Node | null = null;
}
