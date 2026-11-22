import { _decorator, Component, Node, Label } from 'cc';
const { ccclass, property } = _decorator;

/** prefabs/screens/HeroRecruit: owned / not recruited lists (filled in code) and the Recruit button. */
@ccclass('HeroRecruitView')
export class HeroRecruitView extends Component {
    @property(Node) topBarSlot: Node | null = null;
    @property(Node) ownedArea: Node | null = null;
    @property(Node) lockedArea: Node | null = null;
    @property(Label) ownedTitle: Label | null = null;
    @property(Label) lockedTitle: Label | null = null;
    @property(Node) backButton: Node | null = null;
    @property(Node) recruitButton: Node | null = null;
    @property(Node) recruitCost: Node | null = null;
}
