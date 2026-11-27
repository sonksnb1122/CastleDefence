import { Tutorial } from './Tutorial';
import { Node, Label, UITransform } from 'cc';
import { ConfigMgr } from '../core/ConfigMgr';
import { G } from '../core/Globals';
import { ResourceMgr } from '../core/ResourceMgr';
import { TopBar } from './common/TopBar';
import { TradeView } from './screens/TradeView';
import { toast } from './common/Popups';
import { PrefabButton, PrefabUi } from './common/PrefabUi';
import { COLORS, ScrollList, hex, resIcon, text } from './common/UIKit';
import { bookCard, updateSkillArts } from './SkillCards';

const KEYS = ['gold', 'material', 'food'];
const NAMES: { [k: string]: string } = { gold: 'Gold', material: 'Material', food: 'Food' };

/** Big numbers with thousands separators (1,234,567). */
function fmt(n: number): string { return Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

/** Width of a label's text (measured by the engine when possible, else estimated). */
function textWidth(l: Label): number {
    const anyL = l as any;
    if (typeof anyL.updateRenderData === 'function') {
        anyL.updateRenderData(true);
        const w = l.node.getComponent(UITransform)!.width;
        if (w > 0) return w;
    }
    return l.string.length * l.fontSize * 0.58;
}

/** Place an icon and a left-anchored number side by side, the pair centered on x = 0. */
function centerGroup(icon: Node | null, label: Label, gap = 6) {
    const iw = icon ? icon.getComponent(UITransform)!.width : 0;
    const total = iw + (icon ? gap : 0) + textWidth(label);
    if (icon) icon.setPosition(-total / 2 + iw / 2, icon.position.y, 0);
    label.node.setPosition(-total / 2 + iw + (icon ? gap : 0), label.node.position.y, 0);
}

interface ResButton { btn: PrefabButton; icon: Node | null; amount: Label | null; }

const BOOK_H = 170;

/**
 * Market of the Base (prefabs/screens/Trade), opened like the hero recruitment.
 * Left, "Trade Amount": pick the resource to give; it shows the amount being traded
 * (the amounts owned are in the top bar).
 * Right, "Receive Amount": pick the resource to get; it shows the amount received.
 * Any resource can be traded for any other. The step buttons in the middle set the amount.
 * Rates, fee and price changes come from building.json "trade" (see TradeService).
 * Second tab, "Skill Books": books owned on the left, this wave's book offers on the right
 * (bought with gold, see HeroSkillService).
 */
export class TradeScreen {
    root: Node;
    private rm = ResourceMgr.inst;
    private topBar: TopBar;
    private view: TradeView;
    private give = 'gold';
    private get = 'material';
    private amount = 0;
    private giveBtns: { [k: string]: ResButton } = {};
    private getBtns: { [k: string]: ResButton } = {};
    private tradeBtn: PrefabButton;
    private unsubscribe: () => void;
    private tab: 'market' | 'books' = 'market';
    private marketTab: PrefabButton;
    private booksTab: PrefabButton;
    private ownedList: ScrollList | null = null;
    private shopList: ScrollList | null = null;
    private listW = 470;

    constructor(parent: Node) {
        const v = PrefabUi.view('screens/Trade', parent, TradeView);
        this.view = v;
        this.root = v.node;
        this.topBar = new TopBar(v.topBarSlot!);
        // The panel is 796 px wide with its frame: narrow screens shrink it.
        const panel = this.root.getChildByName('Panel');
        const k = Math.min(1, (G.main.W - 24) / 796);
        if (panel) panel.setScale(k, k, 1);
        const side = (nodes: { [k: string]: Node | null }, store: { [k: string]: ResButton }, pick: (k: string) => void) => {
            for (const key of KEYS) {
                const n = nodes[key];
                if (!n) continue;
                const icon = n.getChildByName('Icon');
                if (icon) resIcon(icon, key, 36);
                store[key] = { btn: new PrefabButton(n, () => pick(key)), icon, amount: PrefabUi.child(n, 'Amount', Label) };
            }
        };
        side({ gold: v.giveGold, material: v.giveMaterial, food: v.giveFood }, this.giveBtns, key => this.pickGive(key));
        side({ gold: v.getGold, material: v.getMaterial, food: v.getFood }, this.getBtns, key => this.pickGet(key));
        const step = (n: Node | null, d: number) => new PrefabButton(n, () => this.setAmount(this.amount + d));
        step(v.minus1000Button, -1000); step(v.minus100Button, -100);
        step(v.plus100Button, 100); step(v.plus1000Button, 1000); step(v.plus10000Button, 10000);
        new PrefabButton(v.maxButton, () => this.setAmount(this.rm.get(this.give)));
        new PrefabButton(v.backButton, () => G.main.goto('inCastle'));
        this.tradeBtn = new PrefabButton(v.tradeButton, () => this.doTrade());
        this.marketTab = new PrefabButton(v.marketTab, () => this.setTab('market'));
        this.booksTab = new PrefabButton(v.booksTab, () => this.setTab('books'));
        this.listW = Math.min(470, G.main.W / 2 - 42);
        this.unsubscribe = this.rm.onChange(() => { this.refresh(); if (this.tab === 'books') this.refreshBooks(); });
        this.setTab('market');
        Tutorial.show('trade', { market: () => v.marketPanel, rate: () => v.rateLabel ? v.rateLabel.node : null, tradeButton: () => v.tradeButton, booksTab: () => v.booksTab });
    }

    // ------------------------------------------------------------------ tabs
    private setTab(tab: 'market' | 'books') {
        this.tab = tab;
        const v = this.view, books = tab === 'books';
        for (const n of [v.header, v.marketPanel, v.tradeButton]) if (n) n.active = !books;
        for (const n of [v.ownedBooksArea, v.ownedBooksHeader, v.shopArea, v.shopHeader]) if (n) n.active = books;
        this.marketTab.setColor(books ? COLORS.button : COLORS.buttonOk);
        this.booksTab.setColor(books ? COLORS.buttonOk : COLORS.button);
        if (books) {
            if (!this.ownedList) this.ownedList = this.makeList(v.ownedBooksArea!);
            if (!this.shopList) this.shopList = this.makeList(v.shopArea!);
            this.refreshBooks();
            Tutorial.show('books', { shop: () => v.shopArea, owned: () => v.ownedBooksArea });
        } else this.refresh();
    }

    /** Scroll list filling a list area of the prefab (its width follows the screen), like the hero recruitment. */
    private makeList(area: Node): ScrollList {
        const h = PrefabUi.size(area).height;
        PrefabUi.setSize(area, this.listW, h);
        const frame = area.getChildByName('Frame');
        if (frame) { const k = frame.scale.x || 1; PrefabUi.setSize(frame, (this.listW + 36) / k, (h + 36) / k); }
        return new ScrollList(area, 0, 0, this.listW, h, false);
    }

    /** Skill Books tab: books owned (left) and this wave's offers (right). */
    private refreshBooks() {
        const v = this.view, sk = this.rm.skills;
        const cw = this.listW - 22, ch = BOOK_H - 8;
        const owned = sk.ownedBooks();
        let total = 0;
        for (const id of owned) total += sk.bookCount(id);
        v.ownedBooksTitle!.string = `Skill books (${total})`;
        const ol = this.ownedList!, sl = this.shopList!;
        // Rebuilt after every purchase: keep the scroll positions.
        const keepO = ol.scroll, keepS = sl.scroll;
        ol.clear();
        owned.forEach((id, i) => bookCard(ol.content, id, 0, -4 - i * BOOK_H - BOOK_H / 2 + 4, cw, ch, { count: sk.bookCount(id) }));
        if (owned.length === 0) text(ol.content, 'No skill book yet.\nBuy books on the right, then teach them\nto heroes in the hero recruitment (+).', 15, 0, -60, { color: COLORS.textDim });
        ol.setContentHeight(Math.max(1, owned.length) * BOOK_H + 8);
        ol.scrollBy(keepO);
        const offers = sk.offers();
        v.shopTitle!.string = `For sale - wave ${this.rm.data.currentWave}`;
        sl.clear();
        offers.forEach((o, i) => bookCard(sl.content, o.skillId, 0, -4 - i * BOOK_H - BOOK_H / 2 + 4, cw, ch, {
            price: o.price, onBuy: () => this.buyBook(o.index),
        }));
        if (offers.length === 0) text(sl.content, 'Every skill book has been bought.', 15, 0, -60, { color: COLORS.textDim });
        sl.setContentHeight(offers.length * BOOK_H + 8);
        sl.scrollBy(keepS);
    }

    private buyBook(index: number) {
        const err = this.rm.skills.buyBook(index);
        if (err) { toast(this.root, err); return; }
        G.main.playSfx('coin');
        toast(this.root, 'Skill book bought', true);
    }

    private pickGive(k: string) {
        if (k === this.get) this.get = this.give;   // same resource on both sides: swap them
        this.give = k;
        this.setAmount(this.amount);
    }

    private pickGet(k: string) {
        if (k === this.give) this.give = this.get;
        this.get = k;
        this.setAmount(this.amount);
    }

    private setAmount(a: number) {
        this.amount = Math.max(0, Math.min(Math.floor(a), this.rm.get(this.give)));
        this.refresh();
    }

    private refresh() {
        const v = this.view, tr = this.rm.trade;
        this.amount = Math.min(this.amount, this.rm.get(this.give));
        const got = tr.quote(this.give, this.get, this.amount);
        // Each button: icon + amount (traded / received on the selected one, 0 on the others).
        const show = (b: ResButton | undefined, key: string, on: boolean, value: number, prefix: string, color: string) => {
            if (!b) return;
            b.btn.setColor(on ? COLORS.buttonOk : '#3a3350');
            if (b.amount) {
                b.amount.string = on && value > 0 ? prefix + fmt(value) : '0';
                b.amount.color = hex(on ? color : COLORS.textDim);
                centerGroup(b.icon, b.amount);
            }
        };
        for (const key of KEYS) {
            show(this.giveBtns[key], key, key === this.give, this.amount, '-', COLORS.text);
            show(this.getBtns[key], key, key === this.get, got, '+', COLORS.good);
        }
        const rate = tr.rate(this.give, this.get);
        // This wave's rate against the usual one (no price change): better -> green, worse -> red.
        const vsUsual = tr.priceChange(this.give) / tr.priceChange(this.get) - 1;
        const d = Math.round(vsUsual * 100);
        v.rateLabel!.string = `1 ${NAMES[this.give]} = ${rate.toFixed(2)} ${NAMES[this.get]}` + (d !== 0 ? `  (${d > 0 ? '+' : ''}${d}%)` : '');
        v.rateLabel!.color = hex(d > 0 ? COLORS.good : d < 0 ? '#ff6b6b' : COLORS.text);
        const fees: number[] = (ConfigMgr.building.trade && ConfigMgr.building.trade.feeByBaseLevel) || [];
        const better = this.rm.baseLevel < fees.length ? '\nUpgrade the Base for a lower fee.' : '';
        const pct = (r: string) => { const x = Math.round((tr.priceChange(r) - 1) * 100); return (x >= 0 ? '+' : '') + x + '%'; };
        v.infoLabel!.string = `Market fee ${tr.fee}%${better}\n` +
            `This wave: ${NAMES[this.give]} ${pct(this.give)}, ${NAMES[this.get]} ${pct(this.get)}\n(prices change every wave)`;
        this.tradeBtn.setEnabled(got > 0 && this.rm.isPreparation);
    }

    private doTrade() {
        const got = this.rm.trade.quote(this.give, this.get, this.amount);
        const err = this.rm.trade.trade(this.give, this.get, this.amount);
        if (err) { toast(this.root, err); return; }
        G.main.playSfx('coin');
        toast(this.root, `Traded ${fmt(this.amount)} ${NAMES[this.give]} for ${fmt(got)} ${NAMES[this.get]}`, true);
        this.setAmount(this.amount);
    }

    update(dt: number) { updateSkillArts(dt); }

    destroy() {
        this.unsubscribe();
        this.topBar.destroy();
        this.root.destroy();
    }
}
