import { _decorator, Component, Node, Label } from 'cc';
const { ccclass, property } = _decorator;

/** prefabs/screens/OutCastle: HUD of the battlefield (the battlefield is built in code inside worldHolder). */
@ccclass('OutCastleView')
export class OutCastleView extends Component {
    @property(Node) worldHolder: Node | null = null;
    @property(Node) topBarSlot: Node | null = null;
    @property(Node) defTabSlot: Node | null = null;
    @property(Node) wallBar: Node | null = null;
    @property(Label) wallLabel: Label | null = null;
    @property(Node) repairButton: Node | null = null;
    @property(Node) enterButton: Node | null = null;
    @property(Node) startButton: Node | null = null;
    @property(Label) waveInfo: Label | null = null;
    @property(Node) pauseButton: Node | null = null;
    @property(Node) speedButton: Node | null = null;
    @property(Node) cancelButton: Node | null = null;
    /** Battle: hero skill cards (in place of the build buttons) and the description of the selected one. */
    @property(Node) heroSkillBar: Node | null = null;
    @property(Node) skillInfo: Node | null = null;
    @property(Label) skillInfoTitle: Label | null = null;
    @property(Label) skillInfoType: Label | null = null;
    @property(Label) skillInfoText: Label | null = null;
    /** Temporary skill test buttons (previous skill / cast the skill / next skill). */
    @property(Node) skillBackButton: Node | null = null;
    @property(Node) skillTestButton: Node | null = null;
    @property(Node) skillSkipButton: Node | null = null;
    @property(Node) buildBar: Node | null = null;
}
