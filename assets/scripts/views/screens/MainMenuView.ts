import { _decorator, Component, Node, Label } from 'cc';
const { ccclass, property } = _decorator;

/** prefabs/screens/MainMenu: title and menu buttons (drawn over the demo battle). */
@ccclass('MainMenuView')
export class MainMenuView extends Component {
    @property(Node) newGameButton: Node | null = null;
    @property(Node) loadButton: Node | null = null;
    @property(Node) settingsButton: Node | null = null;
    @property(Node) quitButton: Node | null = null;
    @property(Label) warnings: Label | null = null;
}
