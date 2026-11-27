import { _decorator, Component, Node, Label } from 'cc';
const { ccclass, property } = _decorator;

/** prefabs/items/GuideRow: one goal (check box with a tick, title, detail, priority stars, red dot). */
@ccclass('GuideRowView')
export class GuideRowView extends Component {
    @property(Node) panel: Node | null = null;
    @property(Node) tick: Node | null = null;
    @property(Label) title: Label | null = null;
    @property(Label) detail: Label | null = null;
    @property(Label) stars: Label | null = null;
    @property(Node) dot: Node | null = null;
}
