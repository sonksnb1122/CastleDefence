import { _decorator, Node, Label } from 'cc';
import { PopupView } from './PopupView';
const { ccclass, property } = _decorator;

/** prefabs/popups/Tutorials: topic list (left), notes of the chosen topic (right), Show again, Close. */
@ccclass('TutorialsView')
export class TutorialsView extends PopupView {
    @property(Node) topicList: Node | null = null;
    @property(Node) pageArea: Node | null = null;
    @property(Node) resetButton: Node | null = null;
    @property(Node) closeButton: Node | null = null;
}
