import { _decorator, Component, Node, Label, Sprite } from 'cc';
const { ccclass, property } = _decorator;

/** prefabs/items/BuildRow: one building of the Build popup. */
@ccclass('BuildRowView')
export class BuildRowView extends Component {
    @property(Sprite) icon: Sprite | null = null;
    @property(Label) title: Label | null = null;
    @property(Node) cost: Node | null = null;
    @property(Node) buildButton: Node | null = null;
}
