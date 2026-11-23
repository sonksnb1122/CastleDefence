import { Node, Label, UITransform } from 'cc';
import { ConfigMgr } from '../core/ConfigMgr';
import { G } from '../core/Globals';
import { ResourceMgr } from '../core/ResourceMgr';
import { TopBar } from './common/TopBar';
import { TradeView } from './screens/TradeView';
import { toast } from './common/Popups';
import { PrefabButton, PrefabUi } from './common/PrefabUi';
import { COLORS, resIcon } from './common/UIKit';

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

/**
 * Market of the Base (prefabs/screens/Trade), opened like the hero recruitment:
 * pick the resource to give (left) and the one to get (right), set the amount with
 * the step buttons, then Trade. Rates and fee come from building.json "trade".
 */
export class TradeScreen {
    root: Node;
    private rm = ResourceMgr.inst;
    private topBar: TopBar;
    private view: TradeView;
    private give = 'gold';
    private get = 'material';
    private amount = 0;
    private giveBtns: { [k: string]: { btn: PrefabButton; owned: Label | null; icon: Node | null } } = {};
    private getBtns: { [k: string]: { btn: PrefabButton; owned: Label | null; icon: Node | null } } = {};
    private tradeBtn: PrefabButton;
    private unsubscribe: () => void;

    constructor(parent: Node) {
        const v = PrefabUi.view('screens/Trade', parent, TradeView);
        this.view = v;
        this.root = v.node;
        this.topBar = new TopBar(v.topBarSlot!);
        // The panel is 796 px wide with its frame: narrow screens shrink it.
        const panel = this.root.getChildByName('Panel');
        const k = Math.min(1, (G.main.W - 24) / 796);
        if (panel) panel.setScale(k, k, 1);
        const side = (nodes: { [k: string]: Node | null }, store: TradeScreen['giveBtns'], pick: (k: string) => void) => {
            for (const k of KEYS) {
                const n = nodes[k];
                if (!n) continue;
                const icon = n.getChildByName('Icon');
                if (icon) resIcon(icon, k, 34);
                store[k] = { btn: new PrefabButton(n, () => pick(k)), owned: PrefabUi.child(n, 'Owned', Label), icon };
            }
        };
        side({ gold: v.giveGold, material: v.giveMaterial, food: v.giveFood }, this.giveBtns, k => this.pickGive(k));
        side({ gold: v.getGold, material: v.getMaterial, food: v.getFood }, this.getBtns, k => this.pickGet(k));
        const step = (n: Node | null, d: number) => new PrefabButton(n, () => this.setAmount(this.amount + d));
        step(v.minus1000Button, -1000); step(v.minus100Button, -100);
        step(v.plus100Button, 100); step(v.plus1000Button, 1000); step(v.plus10000Button, 10000);
        new PrefabButton(v.maxButton, () => this.setAmount(this.rm.get(this.give)));
        new PrefabButton(v.backButton, () => G.main.goto('inCastle'));
        this.tradeBtn = new PrefabButton(v.tradeButton, () => this.doTrade());
        this.unsubscribe = this.rm.onChange(() => this.refresh());
        this.refresh();
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
        for (const k of KEYS) {
            const g = this.giveBtns[k], r = this.getBtns[k];
            for (const [b, on] of [[g, k === this.give], [r, k === this.get]] as Array<[typeof g, boolean]>) {
                if (!b) continue;
                b.btn.setColor(on ? COLORS.buttonOk : '#3a3350');
                if (b.owned) { b.owned.string = fmt(this.rm.get(k)); centerGroup(b.icon, b.owned); }
            }
        }
        const icon = (holder: Node | null, k: string) => { if (!holder) return; holder.destroyAllChildren(); resIcon(holder, k, 32); };
        icon(v.amountIcon, this.give);
        icon(v.resultIcon, this.get);
        const got = tr.quote(this.give, this.get, this.amount);
        v.amountLabel!.string = fmt(this.amount);
        v.resultLabel!.string = fmt(got);
        centerGroup(v.amountIcon, v.amountLabel!, 10);
        centerGroup(v.resultIcon, v.resultLabel!, 10);
        const rate = tr.rate(this.give, this.get);
        const fees: number[] = (ConfigMgr.building.trade && ConfigMgr.building.trade.feeByBaseLevel) || [];
        const better = this.rm.baseLevel < fees.length ? '  -  upgrade the Base for a lower fee' : '';
        // Price change of this wave for both resources (+/- %), shown so the player can wait for a better wave.
        const pct = (r: string) => { const d = Math.round((tr.priceChange(r) - 1) * 100); return (d >= 0 ? '+' : '') + d + '%'; };
        v.rateLabel!.string = `1 ${NAMES[this.give]} = ${rate.toFixed(2)} ${NAMES[this.get]}   (market fee ${tr.fee}%${better})\n` +
            `This wave: ${NAMES[this.give]} ${pct(this.give)}, ${NAMES[this.get]} ${pct(this.get)} (prices change every wave)`;
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

    update(_dt: number) { }

    destroy() {
        this.unsubscribe();
        this.topBar.destroy();
        this.root.destroy();
    }
}
