import { _decorator, Node, Label } from 'cc';
import { PopupView } from './PopupView';
const { ccclass, property } = _decorator;

/** prefabs/popups/Research: technologies of the Research Lab (rows are items/ResearchRow). */
@ccclass('ResearchView')
export class ResearchView extends PopupView {
    @property(Label) capLabel: Label | null = null;
    @property(Node) listArea: Node | null = null;
    @property(Node) closeButton: Node | null = null;
}
