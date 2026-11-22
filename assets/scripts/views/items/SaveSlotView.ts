import { _decorator, Component, Node, Label } from 'cc';
const { ccclass, property } = _decorator;

/** prefabs/items/SaveSlot: one save slot row. */
@ccclass('SaveSlotView')
export class SaveSlotView extends Component {
    @property(Label) slotName: Label | null = null;
    @property(Label) desc: Label | null = null;
    @property(Node) actionButton: Node | null = null;
    @property(Node) deleteButton: Node | null = null;
}
