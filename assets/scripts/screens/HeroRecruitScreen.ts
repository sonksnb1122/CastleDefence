import { Node, Graphics, Texture2D, SpriteFrame, Label, isValid } from 'cc';
import { SpriteAnim } from '../combat/SpriteAnim';
import { Assets } from '../core/Assets';
import { ConfigMgr } from '../core/ConfigMgr';
import { G } from '../core/Globals';
import { ResourceMgr } from '../core/ResourceMgr';
import { TopBar } from '../ui/TopBar';
import { COLORS, ScrollList, UIButton, button, hex, mk, modal, panel, sprite, text, toast } from '../ui/UIKit';

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

        this.listW = Math.min(490, W / 2 - 20);
        const listH = H - 150;
        const cx = W / 4;
        this.ownedTitle = text(this.root, '', 18, -cx, H / 2 - 58, { bold: true, color: COLORS.accent });
        this.lockedTitle = text(this.root, '', 18, cx, H / 2 - 58, { bold: true, color: COLORS.textDim });
        this.owned = new ScrollList(this.root, -cx, -10, this.listW, listH);
        this.locked = new ScrollList(this.root, cx, -10, this.listW, listH);

        const cost = ConfigMgr.building.recruitCost;
        button(this.root, '< Back', -W / 2 + 70, -H / 2 + 30, 120, 40, () => G.main.goto('inCastle'), COLORS.buttonAlt, 17);
        this.recruitBtn = button(this.root, `Recruit  (${ResourceMgr.costText(cost)})`, 0, -H / 2 + 30, 360, 42, () => this.recruit(), COLORS.buttonOk, 17);
        this.rebuild();
    }

    private rebuild() {
        for (const c of this.cards) c.art.free();
        this.cards.length = 0;
        const heroes: any[] = ConfigMgr.heroes.heroes;
        const mine = heroes.filter(h => this.rm.ownsHero(h.id));
        const others = heroes.filter(h => !this.rm.ownsHero(h.id));
        this.ownedTitle.string = `Owned heroes (${mine.length})`;
        this.lockedTitle.string = `Not recruited (${others.length})`;
        this.fill(this.owned, mine, true);
        this.fill(this.locked, others, false);
        this.recruitBtn.setEnabled(others.length > 0);
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
        const card = panel(list.content, 0, -top - CARD_H / 2 + 4, w, h, owned ? COLORS.panelLight : '#2c2836');
        const c = ConfigMgr.heroCard;
        const imgH = h - 10, imgW = Math.round(imgH * c.cellW / c.cellH);
        const left = -w / 2 + 8 + imgW / 2;
        // Placeholder shown until the card sheet is loaded (or when it does not exist).
        const holder = panel(card, left, 0, imgW - 8, imgH - 8, '#1c1826');
        text(holder, hero.name.split(' ')[0], 13, 0, 0, { color: COLORS.textDim });
        this.cards.push({ art: new CardArt(holder, hero.imagePath, imgW, imgH), list, top });
        // Divider.
        const dg = card.getComponent(Graphics)!;
        const dx = -w / 2 + imgW + 14;
        dg.fillColor = hex('#11101a');
        dg.rect(dx, -h / 2 + 8, 3, h - 16);
        dg.fill();
        // Name + buffs.
        const tx = dx + 12;
        text(card, hero.name, 16, tx, h / 2 - 18, { ax: 0, bold: true, color: owned ? COLORS.text : COLORS.textDim });
        if (hero.passive) text(card, `[${hero.passive.name}]`, 12, tx, h / 2 - 36, { ax: 0, color: COLORS.accent });
        const y0 = h / 2 - (hero.passive ? 54 : 40);
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
        const m = modal(this.root, 'New Hero!', 560, 420);
        const imgH = 320, imgW = Math.round(imgH * c.cellW / c.cellH);
        const holder = panel(m.box, -150, -16, imgW - 8, imgH - 8, '#1c1826');
        this.popupArt = new CardArt(holder, hero.imagePath, imgW, imgH);
        this.popupArt.setWanted(true);
        text(m.box, hero.name, 20, 0, 150, { ax: 0, bold: true });
        if (hero.passive) text(m.box, `[${hero.passive.name}]`, 13, 0, 126, { ax: 0, color: COLORS.accent });
        this.buffLines(hero.id).forEach((l, i) => text(m.box, l, 14, 0, 100 - i * 22, { ax: 0, color: '#bfe8b0' }));
        button(m.box, 'Close', 130, -170, 150, 42, () => {
            if (this.popupArt) { this.popupArt.free(); this.popupArt = null; }
            m.close();
        });
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
