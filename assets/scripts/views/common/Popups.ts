import { Node, Label, Sprite, isValid } from 'cc';
import { Cost } from '../../core/GameTypes';
import { G } from '../../core/Globals';
import { ConfirmView } from '../popups/ConfirmView';
import { InfoView } from '../popups/InfoView';
import { MessageView } from '../popups/MessageView';
import { PrefabButton, PrefabUi } from './PrefabUi';
import { COLORS, ScrollList, costRow, hex, text } from './UIKit';

/** Small popups used by every screen. The layouts are the prefabs in assets/prefabs. */

/** Yes / No confirmation popup (prefabs/popups/Confirm). */
export function confirm(parent: Node, title: string, body: string, onOk: () => void, okText = 'Confirm', cancelText = 'Cancel', price?: { label: string; cost: Cost }) {
    const v = PrefabUi.view('popups/Confirm', parent, ConfirmView);
    v.setTitle(title);
    v.body!.string = body;
    // Cost / refund line with resource icons, just above the buttons.
    if (price) costRow(v.price, price.cost, 0, 0, { align: 'center', label: price.label, size: 24, fontSize: 18, bold: true });
    new PrefabButton(v.okButton, () => { v.close(); onOk(); }).setText(okText);
    new PrefabButton(v.cancelButton, () => v.close()).setText(cancelText);
}

/** Information popup with a single Close button (prefabs/popups/Message). */
export function message(parent: Node, title: string, body: string, onClose?: () => void, w = 460, h = 300): Node {
    const v = PrefabUi.view('popups/Message', parent, MessageView);
    v.setTitle(title);
    v.resize(w, h);
    v.body!.string = body;
    new PrefabButton(v.closeButton, () => { v.close(); if (onClose) onClose(); });
    return v.node;
}

/** Short message that fades away near the top of the screen (prefabs/items/Toast). */
export function toast(parent: Node, msg: string, good = false) {
    const old = parent.getChildByName('Toast');
    if (old) old.destroy();
    const n = PrefabUi.create('items/Toast', parent);
    n.name = 'Toast';
    n.setPosition(0, G.main.H / 2 - 90, 0);
    const bg = n.getChildByName('Bg');
    if (bg) {
        PrefabUi.setSize(bg, Math.max(220, msg.length * 10 + 40), PrefabUi.size(bg).height);
        PrefabUi.align(bg);
        const fill = PrefabUi.child(bg, 'Fill', Sprite);
        if (fill) fill.color = hex(good ? '#274a33' : '#4a2730');
    }
    const label = PrefabUi.child(n, 'Label', Label);
    if (label) { label.string = msg; label.color = hex(good ? COLORS.good : '#ffd0d0'); }
    G.main.after(1.8, () => { if (isValid(n)) n.destroy(); });
}

/** A line of an info window: plain text, or a label followed by a cost / amount with resource icons. */
export type InfoLine = string | { label: string; cost: Cost };

/** Info window listing lines (prefabs/popups/Info). Long lists become scrollable. */
export function infoWindow(parent: Node, title: string, lines: InfoLine[]) {
    const W = 500, LINE = 22;
    // Estimate wrapped height (about 52 characters fit on one line).
    const rowsOf = (l: InfoLine) => (typeof l === 'string' ? Math.max(1, Math.ceil(l.length / 52)) : 1);
    let rows = 0;
    for (const l of lines) rows += rowsOf(l);
    const maxH = G.main.H - 60;
    const wanted = 146 + rows * LINE;   // room for the header scroll and the frame border
    const scroll = wanted > maxH;
    const H = scroll ? maxH : wanted;
    const v = PrefabUi.view('popups/Info', parent, InfoView);
    v.setTitle(title);
    v.resize(W, H);
    let host: Node = v.content!, left = -W / 2 + 32, y = H / 2 - 62;
    if (scroll) {
        const list = new ScrollList(host, 0, 8, W - 30, maxH - 130);
        list.setContentHeight(rows * LINE + 20);
        host = list.content; left = -(W - 60) / 2; y = -8;
    }
    // Consecutive text lines share one wrapped label; cost lines are drawn with icons.
    let pending: string[] = [];
    const flush = () => {
        if (pending.length === 0) return;
        let n = 0;
        for (const p of pending) n += rowsOf(p);
        text(host, pending.join('\n'), 17, left, y, { width: W - 60, ax: 0, ay: 1, align: 'left' });
        y -= n * LINE;
        pending = [];
    };
    for (const l of lines) {
        if (typeof l === 'string') { pending.push(l); continue; }
        flush();
        costRow(host, l.cost, left, y - LINE / 2, { label: l.label, size: 20, fontSize: 17 });
        y -= LINE;
    }
    flush();
    new PrefabButton(v.closeButton, () => v.close());
}
