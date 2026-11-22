import { _decorator, Node, Label } from 'cc';
import { PopupView } from './PopupView';
const { ccclass, property } = _decorator;

/** prefabs/popups/Message: text with a Close button. */
@ccclass('MessageView')
export class MessageView extends PopupView {
    @property(Label) body: Label | null = null;
    @property(Node) closeButton: Node | null = null;
}
