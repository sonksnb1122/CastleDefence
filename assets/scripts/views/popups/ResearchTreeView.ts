import { _decorator, Node, Label } from 'cc';
import { PopupView } from './PopupView';
const { ccclass, property } = _decorator;

/**
 * prefabs/popups/ResearchTree: window of the research tree (views/ResearchTree.ts draws the tree in
 * treeArea). tabs: one button per branch ("Tab_<branch id>"), jumps to that branch.
 */
@ccclass('ResearchTreeView')
export class ResearchTreeView extends PopupView {
    @property(Label) capLabel: Label | null = null;
    @property(Node) tabs: Node | null = null;
    @property(Node) treeArea: Node | null = null;
    @property(Node) closeButton: Node | null = null;
    @property(Node) zoomInButton: Node | null = null;
    @property(Node) zoomOutButton: Node | null = null;
}
