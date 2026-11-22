import { _decorator, Node } from 'cc';
import { PopupView } from './PopupView';
const { ccclass, property } = _decorator;

/** prefabs/popups/Build: buildings that can be built (rows are items/BuildRow). */
@ccclass('BuildView')
export class BuildView extends PopupView {
    @property(Node) rows: Node | null = null;
    @property(Node) closeButton: Node | null = null;
}
