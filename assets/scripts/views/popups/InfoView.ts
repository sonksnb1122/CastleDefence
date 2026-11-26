import { _decorator, Node } from 'cc';
import { PopupView } from './PopupView';
const { ccclass, property } = _decorator;

/** prefabs/popups/Info: list of info lines (filled in code) with a Close button. */
@ccclass('InfoView')
export class InfoView extends PopupView {
    @property(Node) content: Node | null = null;
    @property(Node) closeButton: Node | null = null;
    /** Optional action next to Close (hidden when the window has none). */
    @property(Node) actionButton: Node | null = null;
}
