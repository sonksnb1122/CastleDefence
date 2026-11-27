import { _decorator, Component, Node, Label } from 'cc';
const { ccclass, property } = _decorator;

/** prefabs/items/GuideButton: the castle Guide button ("i"), with its red dot. */
@ccclass('GuideButtonView')
export class GuideButtonView extends Component {
    @property(Node) dot: Node | null = null;
}
