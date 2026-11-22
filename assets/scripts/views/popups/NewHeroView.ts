import { _decorator, Node, Label } from 'cc';
import { PopupView } from './PopupView';
const { ccclass, property } = _decorator;

/** prefabs/popups/NewHero: the hero just recruited, with its animated card. */
@ccclass('NewHeroView')
export class NewHeroView extends PopupView {
    @property(Node) art: Node | null = null;
    @property(Label) heroName: Label | null = null;
    @property(Label) passive: Label | null = null;
    @property(Label) buffs: Label | null = null;
    @property(Node) closeButton: Node | null = null;
}
