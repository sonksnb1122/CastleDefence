import { _decorator, Node } from 'cc';
import { PopupView } from './PopupView';
const { ccclass, property } = _decorator;

/** prefabs/popups/SaveLoad: list of save slots (rows are items/SaveSlot). */
@ccclass('SaveLoadView')
export class SaveLoadView extends PopupView {
    @property(Node) rows: Node | null = null;
    @property(Node) backButton: Node | null = null;
}
