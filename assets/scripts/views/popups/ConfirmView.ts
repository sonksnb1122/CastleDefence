import { _decorator, Node, Label } from 'cc';
import { PopupView } from './PopupView';
const { ccclass, property } = _decorator;

/** prefabs/popups/Confirm: yes / no question with an optional cost line. */
@ccclass('ConfirmView')
export class ConfirmView extends PopupView {
    @property(Label) body: Label | null = null;
    @property(Node) price: Node | null = null;
    @property(Node) okButton: Node | null = null;
    @property(Node) cancelButton: Node | null = null;
}
