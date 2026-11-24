import { _decorator, Node, Label } from 'cc';
import { PopupView } from './PopupView';
const { ccclass, property } = _decorator;

/** prefabs/popups/Research: frame of the research tree (views/ResearchTree.ts draws the tree in listArea). */
@ccclass('ResearchView')
export class ResearchView extends PopupView {
    @property(Label) capLabel: Label | null = null;
    @property(Node) listArea: Node | null = null;
    @property(Node) closeButton: Node | null = null;
}
