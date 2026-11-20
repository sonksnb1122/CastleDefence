import { Node, Graphics, Texture2D, SpriteFrame, Label, Color, EventTouch, isValid } from 'cc';
import { SpriteAnim } from '../combat/SpriteAnim';
import { Assets } from '../core/Assets';
import { ConfigMgr } from '../core/ConfigMgr';
import { G } from '../core/Globals';
import { ResourceMgr } from '../core/ResourceMgr';
import { TopBar } from '../ui/TopBar';
import { COLORS, ScrollList, UIButton, blocker, button, costRow, fancyModal, hex, mk, modal, panel, sliced, sprite, text, toast } from '../ui/UIKit';

const CARD_H = 190;

/**
 * Animated hero card image. The sheets are very large, so a card only holds
 * its texture while it is visible and gives the memory back as soon as it is
 * scrolled away or the screen closes.
 */
class CardArt {
    private tex: Texture2D | null = null;
    private frames: SpriteFrame[] = [];
    private anim: SpriteAnim | null = null;
    private spriteNode: Node | null = null;
    private state: 'idle' | 'loading' | 'ready' = 'idle';
    private wanted = false;

    constructor(private holder: Node, private path: string, private w: number, private h: number) {}

    /** Ask for the art to be shown (true) or freed (false). Safe to call every frame. */
    setWanted(v: boolean) {
        this.wanted = v;
        if (v && this.state === 'idle') {
            this.state = 'loading';
            Assets.loadTextureOnDemand(this.path, tex => this.onLoaded(tex));
        } else if (!v && this.state === 'ready') {
            this.free();
        }
    }

    private onLoaded(tex: Texture2D | null) {
        if (!tex) { this.state = 'ready'; return; }            // missing art: keep the placeholder
        if (!this.wanted || !isValid(this.holder)) {            // scrolled away while loading
            Assets.releaseTexture(tex);
            this.state = 'idle';
            return;
        }
        const c = ConfigMgr.heroCard;
        this.tex = tex;
        this.frames = Assets.slice(tex, c.cellW, c.cellH, c.frames);
        const s = sprite(this.holder, null, this.w, this.h);
        this.spriteNode = s.node;
        this.anim = new SpriteAnim(s);
        this.anim.play(this.frames, c.frameTime, true);
        this.state = 'ready';
    }

    update(dt: number) { if (this.anim) this.anim.update(dt); }

    /** Drop the sprite and release the texture. */
    free() {
        if (this.spriteNode && isValid(this.spriteNode)) this.spriteNode.destroy();
        this.spriteNode = null;
        this.anim = null;
        for (const f of this.frames) f.destroy();
        this.frames = [];
        Assets.releaseTexture(this.tex);
        this.tex = null;
        this.wanted = false;
        if (this.state !== 'loading') this.state = 'idle';
    }
}

interface CardEntry { art: CardArt; list: ScrollList; top: number; }

/**
 * Hero recruitment: owned heroes on the left, heroes not recruited yet on the
 * right. Each hero is a card: animated card image on the left (the stars are
 * part of the image), buffs listed vertically on the right.
 */
export class HeroRecruitScreen {
    root: Node;
    private rm = ResourceMgr.inst;
    private topBar: TopBar;
    private owned: ScrollList;
    private locked: ScrollList;
    private ownedTitle: Label;
    private lockedTitle: Label;
    private recruitBtn: UIButton;
    private costNode: Node;
    private listW: number;
    private cards: CardEntry[] = [];
    private popupArt: CardArt | null = null;

    constructor(parent: Node) {
        const W = G.main.W, H = G.main.H;
        this.root = mk('HeroRecruit', parent);
        const g = this.root.addComponent(Graphics);
        g.fillColor = hex('#241d33');
        g.rect(-W / 2 - 200, -H / 2 - 200, W + 400, H + 400);
        g.fill();
        this.topBar = new TopBar(this.root);

        this.listW = Math.min(470, W / 2 - 42);
        // Lists sit between the title scrolls (below the top bar ornaments) and the bottom buttons.
        const listTop = H / 2 - 126, listBottom = -H / 2 + 72;
        const listH = listTop - listBottom, listY = (listTop + listBottom) / 2;
        const cx = W / 4;
        // Ornate background behind each list; without the art the lists keep their plain panel.
        const bgCfg = ConfigMgr.uiFrame('listBg');
        const framed = !!bgCfg && Assets.has(bgCfg.path);
        if (framed) for (const sx of [-cx, cx]) sliced(this.root, bgCfg, sx, listY, this.listW + 36, listH + 36);
        this.ownedTitle = this.titleScroll(-cx, H / 2 - 84);
        this.lockedTitle = this.titleScroll(cx, H / 2 - 84);
        this.owned = new ScrollList(this.root, -cx, listY, this.listW, listH, !framed);
        this.locked = new ScrollList(this.root, cx, listY, this.listW, listH, !framed);

        button(this.root, '< Back', -W / 2 + 70, -H / 2 + 30, 120, 40, () => G.main.goto('inCastle'), COLORS.buttonAlt, 17);
        this.recruitBtn = button(this.root, 'Recruit', 0, -H / 2 + 30, 360, 42, () => this.recruit(), COLORS.buttonOk, 17);
        // Price with resource icons inside the button.
        this.recruitBtn.label.node.setPosition(-110, 0, 0);
        this.costNode = mk('Cost', this.recruitBtn.node, 50, 0);
        this.rebuild();
    }

    private rebuild() {
        for (const c of this.cards) c.art.free();
        this.cards.length = 0;
        const heroes: any[] = ConfigMgr.heroes.heroes;
        const mine = heroes.filter(h => this.rm.ownsHero(h.id));
        const others = heroes.filter(h => !this.rm.ownsHero(h.id));
        const limit = this.rm.heroLimit;
        this.ownedTitle.string = `Owned heroes (${mine.length}/${limit})`;
        this.lockedTitle.string = `Not recruited (${others.length})`;
        this.fill(this.owned, mine, true);
        this.fill(this.locked, others, false);
        // The price grows with every hero owned; the Base level limits how many heroes can be owned.
        this.costNode.destroyAllChildren();
        const full = mine.length >= limit;
        if (others.length > 0 && !full) costRow(this.costNode, this.rm.recruitCost(), 0, 0, { align: 'center', size: 24, fontSize: 17, bold: true });
        else text(this.costNode, others.length === 0 ? 'All recruited' : 'Upgrade the Base', 15, 0, 0, { bold: true });
        this.recruitBtn.setEnabled(others.length > 0 && !full);
    }

    private fill(list: ScrollList, heroes: any[], owned: boolean) {
        list.clear();
        heroes.forEach((h, i) => this.card(list, h, i, owned));
        list.setContentHeight(heroes.length * CARD_H + 8);
    }

    private buffLines(heroId: string): string[] {
        return this.rm.heroBuffs(heroId).map(b => {
            const info = ConfigMgr.buffInfo(b.key);
            return `${info.name}${b.towerId ? ' (' + b.towerId + ')' : ''} +${b.value}${info.unit}`;
        });
    }

    /** One hero card: animated image on the left, buffs listed vertically on the right. */
    private card(list: ScrollList, hero: any, index: number, owned: boolean) {
        const w = this.listW - 22, h = CARD_H - 8;
        const top = 4 + index * CARD_H;
        const cy = -top - CARD_H / 2 + 4;
        // Ornate frame around the hero info; falls back to a plain panel without the art.
        const frame = sliced(list.content, ConfigMgr.uiFrame('cardFrame'), 0, cy, w, h);
        if (frame && !owned) frame.color = new Color(150, 150, 165, 255);     // heroes not recruited yet are dimmed
        const framed = !!frame;
        const card = framed ? mk('Card', list.content, 0, cy, w, h) : panel(list.content, 0, cy, w, h, owned ? COLORS.panelLight : '#2c2836');
        const c = ConfigMgr.heroCard;
        // Keep the picture clear of the frame's corner ornaments.
        const padX = framed ? 34 : 5, padY = framed ? 18 : 5;
        const imgH = h - padY * 2, imgW = Math.round(imgH * c.cellW / c.cellH);
        const left = -w / 2 + padX + imgW / 2;
        // Placeholder shown until the card sheet is loaded (or when it does not exist).
        const holder = panel(card, left, 0, imgW - 8, imgH - 8, '#1c1826');
        text(holder, hero.name.split(' ')[0], 13, 0, 0, { color: COLORS.textDim });
        this.cards.push({ art: new CardArt(holder, hero.imagePath, imgW, imgH), list, top });
        const dx = -w / 2 + padX + imgW + 6;
        if (!framed) {
            // Divider (plain panel only; the frame has its own ornaments).
            const dg = card.getComponent(Graphics)!;
            dg.fillColor = hex('#11101a');
            dg.rect(dx, -h / 2 + 8, 3, h - 16);
            dg.fill();
        }
        // Name + buffs.
        const tx = dx + 12;
        const ty = h / 2 - (framed ? 26 : 18);
        text(card, hero.name, 16, tx, ty, { ax: 0, bold: true, color: owned ? COLORS.text : COLORS.textDim });
        if (hero.passive) text(card, `[${hero.passive.name}]`, 12, tx, ty - 18, { ax: 0, color: COLORS.accent });
        const y0 = ty - (hero.passive ? 36 : 22);
        this.buffLines(hero.id).slice(0, 8).forEach((l, i) => text(card, l, 12, tx, y0 - i * 16, { ax: 0, color: owned ? '#bfe8b0' : COLORS.textDim }));
    }

    private recruit() {
        const res = this.rm.recruitHero();
        if (res.error) { toast(this.root, res.error); return; }
        const hero = ConfigMgr.heroDef(res.heroId!);
        this.rebuild();
        G.main.playSfx('win');
        // Reveal window with the animated card.
        const c = ConfigMgr.heroCard;
        const m = fancyModal(this.root, 'New Hero!', 560, 440);
        const imgH = 320, imgW = Math.round(imgH * c.cellW / c.cellH);
        const holder = panel(m.box, -150, -24, imgW - 8, imgH - 8, '#1c1826');
        this.popupArt = new CardArt(holder, hero.imagePath, imgW, imgH);
        this.popupArt.setWanted(true);
        text(m.box, hero.name, 20, 0, 126, { ax: 0, bold: true });
        if (hero.passive) text(m.box, `[${hero.passive.name}]`, 13, 0, 102, { ax: 0, color: COLORS.accent });
        this.buffLines(hero.id).forEach((l, i) => text(m.box, l, 14, 0, 76 - i * 22, { ax: 0, color: '#bfe8b0' }));
        button(m.box, 'Close', 130, -162, 150, 42, () => {
            if (this.popupArt) { this.popupArt.free(); this.popupArt = null; }
            m.close();
        });
    }

    /** List title on the parchment scroll used by the popup headers. */
    private titleScroll(x: number, y: number): Label {
        const cfg = ConfigMgr.uiFrame('popupHeader');
        const scrolled = !!cfg && !!sliced(this.root, Object.assign({}, cfg, { scale: 1.5 }), x, y, 280, 48);
        if (!scrolled) panel(this.root, x, y, 280, 40, COLORS.panelLight);
        return text(this.root, '', 18, x, y, { bold: true, color: scrolled ? '#5a2a1a' : COLORS.accent });
    }

    update(dt: number) {
        // Only the cards inside (or just next to) the visible part of a list keep their texture.
        for (const c of this.cards) {
            const from = c.list.scroll - CARD_H * 0.5, to = c.list.scroll + c.list.viewHeight + CARD_H * 0.5;
            c.art.setWanted(c.top + CARD_H > from && c.top < to);
            c.art.update(dt);
        }
        if (this.popupArt) this.popupArt.update(dt);
    }

    destroy() {
        for (const c of this.cards) c.art.free();
        this.cards.length = 0;
        if (this.popupArt) { this.popupArt.free(); this.popupArt = null; }
        this.topBar.destroy();
        this.root.destroy();
    }
}
