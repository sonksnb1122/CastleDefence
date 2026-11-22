import { _decorator, Node, Label } from 'cc';
import { PopupView } from './PopupView';
const { ccclass, property } = _decorator;

/** prefabs/popups/Pause: Resume, Save, Load, Setting, Main Menu, Quit. */
@ccclass('PauseView')
export class PauseView extends PopupView {
    @property(Node) resumeButton: Node | null = null;
    @property(Node) saveButton: Node | null = null;
    @property(Node) loadButton: Node | null = null;
    @property(Node) settingsButton: Node | null = null;
    @property(Node) menuButton: Node | null = null;
    @property(Node) quitButton: Node | null = null;
    /** "Saving is disabled during combat". */
    @property(Label) saveHint: Label | null = null;
}
