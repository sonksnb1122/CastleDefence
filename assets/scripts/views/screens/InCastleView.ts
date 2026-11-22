import { _decorator, Component, Node } from 'cc';
const { ccclass, property } = _decorator;

/** prefabs/screens/InCastle: HUD of the castle screen (the map is built in code inside worldHolder). */
@ccclass('InCastleView')
export class InCastleView extends Component {
    @property(Node) worldHolder: Node | null = null;
    @property(Node) topBarSlot: Node | null = null;
    @property(Node) defTabSlot: Node | null = null;
    @property(Node) outsideButton: Node | null = null;
    @property(Node) pauseButton: Node | null = null;
    @property(Node) baseButton: Node | null = null;
    @property(Node) buildButton: Node | null = null;
    @property(Node) cancelButton: Node | null = null;
}
