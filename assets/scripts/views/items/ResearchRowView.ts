import { _decorator, Component, Node, Label } from 'cc';
const { ccclass, property } = _decorator;

/** prefabs/items/ResearchRow: one technology row. */
@ccclass('ResearchRowView')
export class ResearchRowView extends Component {
    @property(Label) techName: Label | null = null;
    @property(Label) desc: Label | null = null;
    @property(Label) level: Label | null = null;
    @property(Node) cost: Node | null = null;
    @property(Node) researchButton: Node | null = null;
}
