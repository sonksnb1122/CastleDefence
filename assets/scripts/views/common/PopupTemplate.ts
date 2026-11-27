import { Node, Label } from 'cc';
import { PopupTemplateView } from '../popups/PopupTemplateView';
import { templateButton } from './ButtonTemplate';
import { PrefabButton, PrefabUi } from './PrefabUi';

/** A button of a popup. Without `onClick` it only closes the popup; `keepOpen`: the popup stays open. */
export interface PopupButton { text: string; color?: string; width?: number; onClick?: () => void; keepOpen?: boolean; }

export interface PopupOptions {
    title: string;
    /** Text under the title (none: the text label is hidden). */
    body?: string;
    bodyAlign?: 'left' | 'center';
    /** Size of the window (default: the prefab size, 460 x 300). */
    width?: number;
    height?: number;
    /** false: no dark veil behind the window (tutorial notes). */
    veil?: boolean;
    buttons?: PopupButton[];
}

export interface Popup { view: PopupTemplateView; node: Node; content: Node; buttons: PrefabButton[]; close(): void; }

const GAP = 40;

/**
 * Opens prefabs/popups/PopupTemplate: the template of every simple popup (confirm, message, info, build menus,
 * tutorial notes, Guide). Fill `content` in code for anything other than the text; the buttons
 * (prefabs/items/ButtonTemplate) are laid out side by side, centered, in the bar at the bottom.
 */
export function openPopup(parent: Node, o: PopupOptions): Popup {
    const v = PrefabUi.view('popups/PopupTemplate', parent, PopupTemplateView);
    const size = PrefabUi.size(v.node);
    v.resize(o.width || size.width, o.height || size.height);
    v.setTitle(o.title);
    if (v.veil) v.veil.active = o.veil !== false;
    if (v.body) {
        v.body.node.active = !!o.body;
        v.body.string = o.body || '';
        v.body.horizontalAlign = o.bodyAlign === 'center' ? Label.HorizontalAlign.CENTER : Label.HorizontalAlign.LEFT;
    }
    const close = () => v.close();
    const defs = o.buttons || [];
    const widths = defs.map(b => b.width || 150);
    const total = widths.reduce((a, w) => a + w, 0) + GAP * Math.max(0, defs.length - 1);
    let x = -total / 2;
    const buttons = defs.map((b, i) => {
        const btn = templateButton(v.buttonBar!, b.text, {
            width: widths[i], color: b.color, onClick: () => { if (!b.keepOpen) close(); if (b.onClick) b.onClick(); },
        });
        btn.node.setPosition(x + widths[i] / 2, 0, 0);
        x += widths[i] + GAP;
        return btn;
    });
    return { view: v, node: v.node, content: v.content!, buttons, close };
}
