import { Node } from 'cc';
import { PrefabButton, PrefabUi } from './PrefabUi';
import { COLORS, mk } from './UIKit';

/** Options of a ButtonTemplate button. Width / height: the prefab size (150 x 42) or the slot size. */
export interface TemplateButtonOptions {
    color?: string;
    width?: number;
    height?: number;
    fontSize?: number;
    onClick?: () => void;
    /** Node name (default: "Button_" + the text). */
    name?: string;
}

/**
 * prefabs/items/ButtonTemplate: the one text button of the items (popup buttons, save slots, build rows, the
 * Build Tower button, the skill book price buttons, the Tutorials topics). Only the text (and the color / size)
 * changes from one use to another.
 */
export function templateButton(parent: Node, text: string, o: TemplateButtonOptions = {}): PrefabButton {
    const n = PrefabUi.create('items/ButtonTemplate', parent);
    n.name = o.name || 'Button_' + text.replace(/\W+/g, '');
    const size = PrefabUi.size(n);
    const w = o.width || size.width, h = o.height || size.height;
    if (w !== size.width || h !== size.height) setButtonSize(n, w, h);
    const btn = new PrefabButton(n, o.onClick);
    btn.setText(text);
    btn.setColor(o.color || COLORS.button);
    if (o.fontSize && btn.label) {
        btn.label.fontSize = o.fontSize;
        btn.label.lineHeight = Math.round(o.fontSize * 1.25);
    }
    return btn;
}

/** A ButtonTemplate filling an empty slot node of an item prefab (same size as the slot). */
export function slotButton(slot: Node | null, text: string, o: TemplateButtonOptions = {}): PrefabButton {
    if (!slot) throw new Error('[ButtonTemplate] missing slot');
    const s = PrefabUi.size(slot);
    const btn = templateButton(slot, text, Object.assign({ width: s.width, height: s.height }, o));
    btn.node.setPosition(0, 0, 0);
    return btn;
}

/**
 * Button with a text above a cost (Build Tower, skill book prices): the label goes up and an empty "Cost" node
 * below it receives the cost row.
 */
export function costButton(parent: Node, text: string, o: TemplateButtonOptions = {}): { btn: PrefabButton; cost: Node } {
    const btn = templateButton(parent, text, Object.assign({ width: 164, height: 44, fontSize: 13 }, o));
    if (btn.label) btn.label.node.setPosition(0, 10, 0);
    const cost = mk('Cost', btn.node, 0, -9);
    return { btn, cost };
}

/** Width and height of a ButtonTemplate ("Fill" / "Frame" keep their scale). */
function setButtonSize(n: Node, w: number, h: number) {
    PrefabUi.setSize(n, w, h);
    for (const name of ['Fill', 'Frame']) {
        const c = n.getChildByName(name);
        if (c) PrefabUi.setSize(c, w / (c.scale.x || 1), h / (c.scale.y || 1));
    }
    PrefabUi.align(n);
}
