import { _decorator, Component, Node, Label } from 'cc';
const { ccclass, property } = _decorator;

/** prefabs/items/GuideStage: stage title of the Guide list ("Before wave 30: ..."), goals reached, underline. */
@ccclass('GuideStageView')
export class GuideStageView extends Component {
    @property(Node) line: Node | null = null;
    @property(Label) title: Label | null = null;
    @property(Label) count: Label | null = null;
}
