import { _decorator, Node, Label } from 'cc';
import { PopupView } from './PopupView';
const { ccclass, property } = _decorator;

/**
 * prefabs/popups/PopupTemplate: template of the simple popups (see common/PopupTemplate.ts). Title, a text (body),
 * a free area for content made in code (content: the whole box) and the button bar (buttons: items/ButtonTemplate).
 */
@ccclass('PopupTemplateView')
export class PopupTemplateView extends PopupView {
    @property(Node) veil: Node | null = null;
    @property(Label) body: Label | null = null;
    @property(Node) content: Node | null = null;
    @property(Node) buttonBar: Node | null = null;
}
