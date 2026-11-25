import { Node, Texture2D, Sprite, SpriteFrame, Label, Color, isValid, EventTouch, BlockInputEvents } from 'cc';
import { SpriteAnim } from '../combat/SpriteAnim';
import { Assets } from '../core/Assets';
import { ConfigMgr } from '../core/ConfigMgr';
import { G } from '../core/Globals';
import { ResourceMgr } from '../core/ResourceMgr';
import { TopBar } from './common/TopBar';
import { HeroCardView } from './items/HeroCardView';
import { NewHeroView } from './popups/NewHeroView';
import { HeroInfoView } from './popups/HeroInfoView';
import { HeroRecruitView } from './screens/HeroRecruitView';
import { confirm, toast } from './common/Popups';
import { InfoView } from './popups/InfoView';
import { bookCard, skillDescription, skillName, updateSkillArts } from './SkillCards';
import { HeroSkillService } from '../core/services/HeroSkillService';
import { PrefabButton, PrefabUi } from './common/PrefabUi';
import { COLORS, ScrollList, costRow, hex, mk, sprite, text } from './common/UIKit';

const CARD_H = 190;

/**
 * Animated hero card image. The sheets are very large, so a card only holds
 * its texture while it is visible and gives the memory back as soon as it is
 * scrolled away or the screen closes.
 */
export class CardArt {
    private tex: Texture2D | null = null;
    private frames: SpriteFrame[] = [];
    private anim: SpriteAnim | null = null;
    private spriteNode: Node | null = null;
    private state: 'idle' | 'loading' | 'ready' = 'idle';
    private wanted = false;

    /** Stars to show on the card's star bar when they differ from the printed ones (promoted heroes), or 0. */
    stars = 0;

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
        this.drawStarTab(s.node);
    }

    /**
     * Promoted hero: the star bar of the card (heroes.json "starTab", in card cell pixels) is covered by
     * the 5-star bar (heroes.json ui "starTab5"; promotions always go to 5 stars).
     */
    private drawStarTab(card: Node) {
        if (!this.stars) return;
        const ui = (ConfigMgr.heroes.ui || {})['starTab' + this.stars];
        const box = ConfigMgr.heroes.starTab;
        if (!ui || !box) return;
        const frames = Assets.frames(ui.path, ui.width, ui.height);
        if (!frames.length) return;
        const c = ConfigMgr.heroCard, kx = this.w / c.cellW, ky = this.h / c.cellH;
        const x = (box.x + box.width / 2 - c.cellW / 2) * kx, y = (c.cellH / 2 - box.y - box.height / 2) * ky;
        sprite(card, frames[0], box.width * kx, box.height * ky, x, y).node.name = 'StarTab';
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
 * Hero recruitment (prefabs/screens/HeroRecruit): owned heroes on the left, heroes
 * not recruited yet on the right. Each hero is a card (prefabs/items/HeroCard):
 * animated card image on the left (the stars are part of the image), buffs listed
 * vertically on the right.
 */
export class HeroRecruitScreen {
    root: Node;
    private rm = ResourceMgr.inst;
    private topBar: TopBar;
    private owned: ScrollList;
    private locked: ScrollList;
    private ownedTitle: Label;
    private lockedTitle: Label;
    private recruitBtn: PrefabButton;
    private costNode: Node;
    private listW: number;
    private cards: CardEntry[] = [];
    private popupArt: CardArt | null = null;
    /** Hero window opened by tapping a card (see openHero). */
    private heroWin: { v: HeroInfoView; art: CardArt; heroId: string } | null = null;

    constructor(parent: Node) {
        const W = G.main.W;
        const v = PrefabUi.view('screens/HeroRecruit', parent, HeroRecruitView);
        this.root = v.node;
        this.topBar = new TopBar(v.topBarSlot!);
        // The two lists are as wide as the screen allows; their framed areas come from the prefab.
        this.listW = Math.min(470, W / 2 - 42);
        this.owned = this.makeList(v.ownedArea!);
        this.locked = this.makeList(v.lockedArea!);
        this.ownedTitle = v.ownedTitle!;
        this.lockedTitle = v.lockedTitle!;
        new PrefabButton(v.backButton, () => G.main.goto('inCastle'));
        this.recruitBtn = new PrefabButton(v.recruitButton, () => this.recruit());
        this.costNode = v.recruitCost!;
        this.rebuild();
    }

    /** Scroll list filling a list area of the prefab (the area keeps its height, its width follows the screen). */
    private makeList(area: Node): ScrollList {
        const h = PrefabUi.size(area).height;
        PrefabUi.setSize(area, this.listW, h);
        const frame = area.getChildByName('Frame');
        if (frame) { const k = frame.scale.x || 1; PrefabUi.setSize(frame, (this.listW + 36) / k, (h + 36) / k); }
        return new ScrollList(area, 0, 0, this.listW, h, false);
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

    /** Stars to draw on the card of a promoted hero (0 = keep the printed stars). */
    private promotedStars(heroId: string): number {
        const s = this.rm.heroes.stars(heroId);
        return s !== ConfigMgr.heroDef(heroId).stars ? s : 0;
    }

    private buffLines(heroId: string): string[] {
        // Learned skills first, then the buffs (passive skill buffs are part of them).
        const skills = this.rm.skills.learned(heroId).map(id => `Skill: ${skillName(id)} (${HeroSkillService.isPassive(id) ? 'passive' : 'active'})`);
        return skills.concat(this.rm.heroBuffs(heroId).map(b => {
            const info = ConfigMgr.buffInfo(b.key);
            return `${info.name}${b.towerId ? ' (' + b.towerId + ')' : ''} +${b.value}${info.unit}`;
        }));
    }

    /** One hero card (prefabs/items/HeroCard): animated image on the left, buffs listed vertically on the right. */
    private card(list: ScrollList, hero: any, index: number, owned: boolean) {
        const top = 4 + index * CARD_H;
        const v = PrefabUi.view('items/HeroCard', list.content, HeroCardView);
        v.node.setPosition(0, -top - CARD_H / 2 + 4, 0);
        // Cards are as wide as the list (narrow screens have narrower lists).
        const cw = this.listW - 22, ch = CARD_H - 8;
        PrefabUi.setSize(v.node, cw, ch);
        if (v.frame) { const k = v.frame.node.scale.x || 1; PrefabUi.setSize(v.frame.node, cw / k, ch / k); }
        PrefabUi.align(v.node);
        // Heroes not recruited yet are dimmed.
        if (!owned && v.frame) v.frame.color = new Color(150, 150, 165, 255);
        const holder = v.art!;
        if (v.placeholder) v.placeholder.string = hero.name.split(' ')[0];
        const art = PrefabUi.size(holder);
        const cardArt = new CardArt(holder, hero.imagePath, art.width + 8, art.height + 8);
        cardArt.stars = this.promotedStars(String(hero.id));
        this.cards.push({ art: cardArt, list, top });
        v.heroName!.string = hero.name;
        v.heroName!.color = hex(owned ? COLORS.text : COLORS.textDim);
        v.passive!.node.active = !!hero.passive;
        if (hero.passive) v.passive!.string = `[${hero.passive.name}]`;
        // Buffs start right under the passive (or under the name when there is none).
        const b = v.buffs!;
        b.node.setPosition(b.node.position.x, v.heroName!.node.position.y - (hero.passive ? 36 : 22) + 8, 0);
        b.string = this.buffLines(hero.id).slice(0, 8).join('\n');
        b.color = hex(owned ? '#bfe8b0' : COLORS.textDim);
        // No "+" on the card: skills are learned from the hero window (tap the card).
        if (v.learnButton) v.learnButton.active = false;
        // Tap the card (without scrolling the list): the hero window.
        let moved = 0;
        v.node.on(Node.EventType.TOUCH_START, () => { moved = 0; }, this);
        v.node.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => { const d = e.getUIDelta(); moved += Math.abs(d.x) + Math.abs(d.y); }, this);
        v.node.on(Node.EventType.TOUCH_END, () => { if (moved < 10) this.openHero(String(hero.id)); }, this);
    }

    /**
     * Hero window (prefabs/popups/NewHero without its Close button): animated card, stars, buffs and
     * skills with their description. Icon buttons: learn a skill, promote (straight to 5 stars). A tap outside
     * the window closes it.
     */
    openHero(heroId: string) {
        this.closeHero();
        const hero = ConfigMgr.heroDef(heroId);
        const owned = this.rm.ownsHero(heroId);
        const v = PrefabUi.view('popups/HeroInfo', this.root, HeroInfoView);
        const pw = PrefabUi.size(v.node);
        if (pw.width > G.main.W - 40 || pw.height > G.main.H - 30) {
            v.resize(Math.min(pw.width, G.main.W - 40), Math.min(pw.height, G.main.H - 30));
            PrefabUi.align(v.node);
        }
        v.setTitle(hero.name);
        // The window keeps its taps; a tap on the dark veil around it closes it.
        if (v.backing) v.backing.addComponent(BlockInputEvents);
        const veil = v.node.getChildByName('Veil');
        if (veil) veil.on(Node.EventType.TOUCH_END, () => this.closeHero(), this);

        // Card on the left (the prefab "Art" panel).
        const a = PrefabUi.size(v.art!);
        const ca = new CardArt(v.art!, hero.imagePath, a.width + 8, a.height + 8);
        ca.stars = this.promotedStars(heroId);
        ca.setWanted(true);

        // Texts in the prefab "InfoArea", stacked from the top in a scroll list (long skill lists scroll).
        const area = PrefabUi.size(v.infoArea!);
        const list = new ScrollList(v.infoArea!, 0, 0, area.width, area.height, false);
        const tw = area.width - 16, left = -tw / 2;
        let y = -4;
        const put = (str: string, size: number, color: string, bold = false, gap = 4) => {
            const l = text(list.content, str, size, left, y, { ax: 0, ay: 1, width: tw, color, bold });
            y -= PrefabUi.labelHeight(l) + gap;
            return l;
        };
        put(owned ? 'Recruited' : 'Not recruited yet', 13, owned ? COLORS.good : COLORS.textDim, false, 8);
        if (hero.passive) put(`[${hero.passive.name}]`, 15, COLORS.accent, true, 4);
        // Rolled buffs (one per star) and the card passive; passive skills are listed with the skills.
        const buffs = (this.rm.data.heroRolls[heroId] || []).concat(hero.passive ? hero.passive.buffs : []);
        put(buffs.map(b => { const i = ConfigMgr.buffInfo(b.key); return `${i.name}${b.towerId ? ' (' + b.towerId + ')' : ''} +${b.value}${i.unit}`; }).join('\n') || 'No buff', 14, '#bfe8b0', false, 14);
        const learned = this.rm.skills.learned(heroId);
        put('Skills', 16, COLORS.text, true, 6);
        if (learned.length === 0) put('No skill learned yet.', 13, COLORS.textDim);
        for (const id of learned) {
            put(`${skillName(id)}  (${HeroSkillService.isPassive(id) ? 'passive' : 'active'})`, 14, HeroSkillService.isPassive(id) ? '#9fe8ff' : COLORS.accent, true, 2);
            put(skillDescription(id), 13, '#e6e0f0', false, 10);
        }
        list.setContentHeight(-y + 4);

        // Icon buttons pinned under the texts (prefab "LearnButton" / "PromoteButton").
        const sk = this.rm.skills, hs = this.rm.heroes;
        v.learnButton!.active = v.promoteButton!.active = owned;
        if (owned) {
            const learnWhy = !sk.learnUnlocked ? 'Research "Hero Scholarship" first (Research Lab Lv 2)'
                : !sk.canLearnMore(heroId) ? 'No free skill slot' : !this.rm.isPreparation ? 'Cannot learn skills during combat' : null;
            this.iconButton(v.learnButton!, 'learn_skill', learnWhy, () => this.openLearn(heroId));
            const promoteWhy = hs.promoteBlock(heroId) || (!this.rm.isPreparation ? 'Cannot promote during combat' : null);
            this.iconButton(v.promoteButton!, 'star_up', promoteWhy, () => this.promote(heroId));
            if (hs.stars(heroId) >= 5) v.promoteButtonCaption!.string = 'Max stars';
            if (learnWhy) v.learnButtonCaption!.color = hex(COLORS.textDim);
            if (promoteWhy) v.promoteButtonCaption!.color = hex(COLORS.textDim);
        }
        this.heroWin = { v, art: ca, heroId };
    }

    /**
     * Icon button of the hero window: picture from building.json "uiIcons" on the prefab "Icon" sprite.
     * A disabled one is greyed out and tells why when tapped.
     */
    private iconButton(n: Node, icon: string, why: string | null, onTap: () => void) {
        const cfg = ConfigMgr.uiIcon(icon);
        const frames = cfg ? Assets.frames(cfg.path, cfg.size, cfg.size) : [];
        const sp = n.getChildByName('Icon') ? n.getChildByName('Icon')!.getComponent(Sprite) : null;
        if (sp && frames.length) {
            sp.sizeMode = Sprite.SizeMode.CUSTOM;
            sp.spriteFrame = frames[0];
            sp.color = why ? new Color(110, 110, 120, 200) : Color.WHITE;
        }
        n.addComponent(BlockInputEvents);
        n.on(Node.EventType.TOUCH_END, () => {
            if (why) { toast(this.root, why); return; }
            G.main.playSfx('click');
            onTap();
        }, this);
    }

    private promote(heroId: string) {
        const hs = this.rm.heroes;
        const hero = ConfigMgr.heroDef(heroId);
        const s = hs.stars(heroId);
        const gain = 5 - s;
        confirm(this.root, 'Promote Hero', `Promote ${hero.name} from ${s} to 5 stars?\nThe hero gets ${gain} more random buff${gain > 1 ? 's' : ''}.`, () => {
            const res = hs.promote(heroId);
            if (res.error) { toast(this.root, res.error); return; }
            const names = res.buffs!.map(b => { const i = ConfigMgr.buffInfo(b.key); return `${i.name} +${b.value}${i.unit}`; });
            G.main.playSfx('upgrade');
            toast(this.root, `${hero.name}: 5 stars! New buff${names.length > 1 ? 's' : ''}: ${names.join(', ')}`, true);
            this.rebuild();
            this.openHero(heroId);
        }, 'Promote', 'Cancel', { label: 'Cost:', cost: hs.promoteCost(heroId)! });
    }

    private closeHero() {
        if (!this.heroWin) return;
        this.heroWin.art.free();
        this.heroWin.v.close();
        this.heroWin = null;
    }

    /** Popup (prefabs/popups/Info) listing the skill books this hero can learn. */
    private openLearn(heroId: string) {
        const hero = ConfigMgr.heroDef(heroId);
        const sk = this.rm.skills;
        const W = Math.min(760, G.main.W - 60), H = G.main.H - 50;
        const v = PrefabUi.view('popups/Info', this.root, InfoView);
        v.setTitle('Learn a skill');
        v.resize(W, H);
        const list = new ScrollList(v.content!, 0, 4, W - 40, H - 128, false);
        const host = list.content;
        const slots = sk.freeSlots(heroId);
        const rule = this.rm.heroes.stars(heroId) >= 5 ? '5-star hero: 1 active + 1 passive skill.' : 'Can learn 1 skill (active or passive).';
        const open = slots.length === 2 ? 'active or passive' : slots[0] || '-';
        text(host, `${hero.name} - ${rule} Free slot: ${open}.`, 15, 0, -14, { width: W - 70 });
        costRow(host, sk.learnCost, -(W - 70) / 2, -40, { label: 'Learning cost:', size: 18, fontSize: 14 });
        const books = sk.learnableBooks(heroId);
        const cw = W - 70, ch = 162, top = 60;
        books.forEach((id, i) => bookCard(host, id, 0, -top - i * (ch + 8) - ch / 2, cw, ch, {
            count: sk.bookCount(id), price: sk.learnCost,
            onBuy: () => {
                const err = sk.learn(heroId, id);
                if (err) { toast(this.root, err); return; }
                G.main.playSfx('upgrade');
                toast(this.root, `${hero.name} learned ${skillName(id)}`, true);
                v.close();
                this.rebuild();
                if (this.heroWin && this.heroWin.heroId === heroId) this.openHero(heroId);
            },
        }));
        if (books.length === 0) text(host, 'No skill book this hero can learn.\nBuy skill books in the Market of the Base (Skill Books tab).', 15, 0, -top - 40, { color: COLORS.textDim });
        list.setContentHeight(top + Math.max(1, books.length) * (ch + 8) + 10);
        new PrefabButton(v.closeButton, () => v.close());
    }

    private recruit() {
        const res = this.rm.recruitHero();
        if (res.error) { toast(this.root, res.error); return; }
        const hero = ConfigMgr.heroDef(res.heroId!);
        this.rebuild();
        G.main.playSfx('win');
        // Reveal window (prefabs/popups/NewHero) with the animated card.
        const v = PrefabUi.view('popups/NewHero', this.root, NewHeroView);
        const art = PrefabUi.size(v.art!);
        this.popupArt = new CardArt(v.art!, hero.imagePath, art.width + 8, art.height + 8);
        this.popupArt.setWanted(true);
        v.heroName!.string = hero.name;
        v.passive!.node.active = !!hero.passive;
        if (hero.passive) v.passive!.string = `[${hero.passive.name}]`;
        v.buffs!.string = this.buffLines(hero.id).join('\n');
        new PrefabButton(v.closeButton, () => {
            if (this.popupArt) { this.popupArt.free(); this.popupArt = null; }
            v.close();
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
        if (this.heroWin) this.heroWin.art.update(dt);
        updateSkillArts(dt);
    }

    destroy() {
        for (const c of this.cards) c.art.free();
        this.cards.length = 0;
        if (this.popupArt) { this.popupArt.free(); this.popupArt = null; }
        this.closeHero();
        this.topBar.destroy();
        this.root.destroy();
    }
}
