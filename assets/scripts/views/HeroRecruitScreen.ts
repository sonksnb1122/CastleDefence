import { Node, Texture2D, SpriteFrame, Label, Color, isValid } from 'cc';
import { SpriteAnim } from '../combat/SpriteAnim';
import { Assets } from '../core/Assets';
import { ConfigMgr } from '../core/ConfigMgr';
import { G } from '../core/Globals';
import { ResourceMgr } from '../core/ResourceMgr';
import { TopBar } from './common/TopBar';
import { HeroCardView } from './items/HeroCardView';
import { NewHeroView } from './popups/NewHeroView';
import { HeroRecruitView } from './screens/HeroRecruitView';
import { toast } from './common/Popups';
import { InfoView } from './popups/InfoView';
import { bookCard, skillName, updateSkillArts } from './SkillCards';
import { HeroSkillService } from '../core/services/HeroSkillService';
import { PrefabButton, PrefabUi } from './common/PrefabUi';
import { COLORS, ScrollList, costRow, hex, sprite, text } from './common/UIKit';

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
        this.cards.push({ art: new CardArt(holder, hero.imagePath, art.width + 8, art.height + 8), list, top });
        v.heroName!.string = hero.name;
        v.heroName!.color = hex(owned ? COLORS.text : COLORS.textDim);
        v.passive!.node.active = !!hero.passive;
        if (hero.passive) v.passive!.string = `[${hero.passive.name}]`;
        // Buffs start right under the passive (or under the name when there is none).
        const b = v.buffs!;
        b.node.setPosition(b.node.position.x, v.heroName!.node.position.y - (hero.passive ? 36 : 22) + 8, 0);
        b.string = this.buffLines(hero.id).slice(0, 8).join('\n');
        b.color = hex(owned ? '#bfe8b0' : COLORS.textDim);
        // "+": learn a skill from a skill book (owned heroes with a free skill slot).
        if (v.learnButton) {
            v.learnButton.active = owned && this.rm.skills.canLearnMore(String(hero.id));
            if (v.learnButton.active) new PrefabButton(v.learnButton, () => this.openLearn(String(hero.id)));
        }
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
        const rule = (hero.stars || 0) >= 5 ? '5-star hero: 1 active + 1 passive skill.' : 'Can learn 1 skill (active or passive).';
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
        updateSkillArts(dt);
    }

    destroy() {
        for (const c of this.cards) c.art.free();
        this.cards.length = 0;
        if (this.popupArt) { this.popupArt.free(); this.popupArt = null; }
        this.topBar.destroy();
        this.root.destroy();
    }
}
