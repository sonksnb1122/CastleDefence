import { _decorator, Component, Node, Label, isValid } from 'cc';
import { PrefabUi } from '../common/PrefabUi';
const { ccclass, property } = _decorator;

/**
 * Frame shared by every popup prefab: dark veil, solid backing, ornate frame
 * (popup_bg, 9-slice) and the title scroll (popup_header). Popups whose size
 * depends on their content (info, message, build) call resize().
 */
@ccclass('PopupView')
export class PopupView extends Component {
    @property(Node) backing: Node | null = null;
    @property(Node) frame: Node | null = null;
    @property(Node) box: Node | null = null;
    @property(Node) header: Node | null = null;
    @property(Label) title: Label | null = null;

    get width(): number { return this.box ? PrefabUi.size(this.box).width : 0; }
    get height(): number { return this.box ? PrefabUi.size(this.box).height : 0; }

    setTitle(s: string) {
        if (this.title) this.title.string = s;
        this.fitHeader();
    }

    /** Change the popup size; the frame, backing and title scroll follow. */
    resize(w: number, h: number) {
        PrefabUi.setSize(this.node, w, h);
        if (this.box) PrefabUi.setSize(this.box, w, h);
        if (this.backing) PrefabUi.setSize(this.backing, w - 28, h - 36);
        if (this.frame) { const k = this.frame.scale.x || 1; PrefabUi.setSize(this.frame, w / k, h / k); }
        const hy = h / 2 - 8;
        if (this.header) this.header.setPosition(0, hy, 0);
        if (this.title) this.title.node.setPosition(0, hy, 0);
        this.fitHeader();
        // Content placed with Widgets (close button at the bottom, lists...) follows the new size.
        if (this.box) PrefabUi.align(this.box);
    }

    /** The title scroll grows with the title (like the old code-built popups). */
    private fitHeader() {
        if (!this.header || !this.title) return;
        const k = this.header.scale.x || 1;
        const hw = Math.max(220, Math.min(this.width - 60, this.title.string.length * 16 + 120));
        PrefabUi.setSize(this.header, hw / k, PrefabUi.size(this.header).height);
    }

    close() { if (isValid(this.node)) this.node.destroy(); }
}
