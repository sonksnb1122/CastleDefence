import { _decorator, Component, Node, Label } from 'cc';
const { ccclass, property } = _decorator;

/** prefabs/items/TutorialFrame: dim around the framed part (four boxes) and its red border (views/Tutorial.ts sizes them). */
@ccclass('TutorialFrameView')
export class TutorialFrameView extends Component {
    @property(Node) dimTop: Node | null = null;
    @property(Node) dimBottom: Node | null = null;
    @property(Node) dimLeft: Node | null = null;
    @property(Node) dimRight: Node | null = null;
    @property(Node) borderTop: Node | null = null;
    @property(Node) borderBottom: Node | null = null;
    @property(Node) borderLeft: Node | null = null;
    @property(Node) borderRight: Node | null = null;
}
