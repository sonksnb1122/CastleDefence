import { _decorator, Component, Node, Label } from 'cc';
const { ccclass, property } = _decorator;

/** prefabs/items/TopBar: resources, tower count, wave and state. */
@ccclass('TopBarView')
export class TopBarView extends Component {
    @property(Node) background: Node | null = null;
    @property(Node) frame: Node | null = null;
    @property(Label) food: Label | null = null;
    @property(Label) material: Label | null = null;
    @property(Label) gold: Label | null = null;
    /** Energy Core amount and its icon holder (the icon is set by TopBar at runtime). */
    @property(Label) core: Label | null = null;
    @property(Node) coreIcon: Node | null = null;
    @property(Label) towers: Label | null = null;
    @property(Label) wave: Label | null = null;
    @property(Label) state: Label | null = null;
}
