import { _decorator, Component, Node, Label } from 'cc';
const { ccclass, property } = _decorator;

/** prefabs/screens/Loading: title, progress bar and current step. */
@ccclass('LoadingView')
export class LoadingView extends Component {
    @property(Node) bar: Node | null = null;
    @property(Label) percent: Label | null = null;
    @property(Label) step: Label | null = null;
    @property(Label) error: Label | null = null;
}
