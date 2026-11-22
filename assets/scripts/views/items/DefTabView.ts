import { _decorator, Component, Node, Label } from 'cc';
const { ccclass, property } = _decorator;

/** prefabs/items/DefTab: enemy armor compared with the player's defense reduction. */
@ccclass('DefTabView')
export class DefTabView extends Component {
    @property(Node) expanded: Node | null = null;
    @property(Node) collapsed: Node | null = null;
    @property(Label) title: Label | null = null;
    @property(Node) physicBar: Node | null = null;
    @property(Label) physicValue: Label | null = null;
    @property(Node) magicBar: Node | null = null;
    @property(Label) magicValue: Label | null = null;
    @property(Label) footer: Label | null = null;
    @property(Label) smallLabel: Label | null = null;
    @property(Node) toggle: Node | null = null;
    @property(Label) toggleLabel: Label | null = null;
}
