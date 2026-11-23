import { _decorator, Component, Node, Label } from 'cc';
const { ccclass, property } = _decorator;

/** prefabs/screens/Trade: the Market of the Base (trade one resource for another). */
@ccclass('TradeView')
export class TradeView extends Component {
    @property(Node) topBarSlot: Node | null = null;
    @property(Node) giveGold: Node | null = null;
    @property(Node) giveMaterial: Node | null = null;
    @property(Node) giveFood: Node | null = null;
    @property(Node) getGold: Node | null = null;
    @property(Node) getMaterial: Node | null = null;
    @property(Node) getFood: Node | null = null;
    @property(Node) amountIcon: Node | null = null;
    @property(Label) amountLabel: Label | null = null;
    @property(Node) minus1000Button: Node | null = null;
    @property(Node) minus100Button: Node | null = null;
    @property(Node) plus100Button: Node | null = null;
    @property(Node) plus1000Button: Node | null = null;
    @property(Node) plus10000Button: Node | null = null;
    @property(Node) maxButton: Node | null = null;
    @property(Node) resultIcon: Node | null = null;
    @property(Label) resultLabel: Label | null = null;
    @property(Label) rateLabel: Label | null = null;
    @property(Node) backButton: Node | null = null;
    @property(Node) tradeButton: Node | null = null;
}
