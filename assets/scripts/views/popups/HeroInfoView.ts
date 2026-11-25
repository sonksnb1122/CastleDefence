import { _decorator, Node, Label } from 'cc';
import { PopupView } from './PopupView';
const { ccclass, property } = _decorator;

/**
 * prefabs/popups/HeroInfo: hero window (tap a hero card). art: animated card; infoArea: texts stacked
 * by HeroRecruitScreen in a scroll list; learnButton / promoteButton: icon ("Icon") + "Caption".
 * No Close button: a tap on the veil closes it.
 */
@ccclass('HeroInfoView')
export class HeroInfoView extends PopupView {
    @property(Node) art: Node | null = null;
    @property(Node) infoArea: Node | null = null;
    @property(Node) learnButton: Node | null = null;
    @property(Label) learnButtonCaption: Label | null = null;
    @property(Node) promoteButton: Node | null = null;
    @property(Label) promoteButtonCaption: Label | null = null;
}
