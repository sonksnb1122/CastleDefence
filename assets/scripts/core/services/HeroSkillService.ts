import { ConfigMgr } from '../ConfigMgr';
import { BuffEntry, Cost } from '../GameTypes';
import type { ResourceMgr } from '../ResourceMgr';

/** One skill book offer of the Market this wave. */
export interface BookOffer { index: number; skillId: string; price: Cost; }

/**
 * Hero skills (skills.json "heroSkills", "passives", "bookShop"):
 *  - skill books are bought in the Market (a new random choice every wave, gold price +/- a few %);
 *    a skill that was bought is never offered again;
 *  - a hero learns a skill from a book for "learnCost" (1 Energy Core). 5-star heroes learn
 *    1 active + 1 passive skill, the others 1 skill of any type;
 *  - an active skill is cast from the hero card during a wave, then recharges for "cooldownWaves"
 *    waves (research "Battle Tactics" lowers it, "Twin Cast" allows one more use before it recharges);
 *  - a passive skill gives its buffs while the hero owns it (see BuffService.heroBuffs).
 */
export class HeroSkillService {
    constructor(private rm: ResourceMgr) {}

    private get cfg(): any { return (ConfigMgr.skills && ConfigMgr.skills.heroSkills) || {}; }
    private get shopCfg(): any { return (ConfigMgr.skills && ConfigMgr.skills.bookShop) || {}; }

    static isPassive(id: string): boolean { return !ConfigMgr.skillDef(id) && !!ConfigMgr.passiveDef(id); }

    /** Every skill a book can teach: active skills, then passives. */
    static allIds(): string[] {
        const s = ConfigMgr.skills || {};
        return ((s.skills || []) as any[]).map(x => x.id).concat(((s.passives || []) as any[]).map(x => x.id));
    }

    // ------------------------------------------------------------------ learned skills
    learned(heroId: string): string[] { return (this.rm.data.heroSkills && this.rm.data.heroSkills[heroId]) || []; }

    activeOf(heroId: string): string | null { return this.learned(heroId).find(id => !HeroSkillService.isPassive(id)) || null; }

    /** Kinds of skill the hero can still learn: 'active' / 'passive' (both for "any"). */
    freeSlots(heroId: string): Array<'active' | 'passive'> {
        const hero = ConfigMgr.heroDef(heroId);
        if (!hero) return [];
        const mine = this.learned(heroId);
        const hasActive = mine.some(id => !HeroSkillService.isPassive(id));
        const hasPassive = mine.some(id => HeroSkillService.isPassive(id));
        if (this.rm.heroes.stars(heroId) >= 5) {
            const out: Array<'active' | 'passive'> = [];
            if (!hasActive) out.push('active');
            if (!hasPassive) out.push('passive');
            return out;
        }
        return mine.length === 0 ? ['active', 'passive'] : [];
    }

    /** Research "Hero Scholarship" (tier 2) lets heroes learn skills. */
    get learnUnlocked(): boolean { return this.rm.buff('heroSkillUnlock') > 0; }

    canLearnMore(heroId: string): boolean { return this.rm.ownsHero(heroId) && this.freeSlots(heroId).length > 0; }

    /** Books owned that this hero could learn now (whatever the cost). */
    learnableBooks(heroId: string): string[] {
        const slots = this.freeSlots(heroId);
        const mine = this.learned(heroId);
        return this.ownedBooks().filter(id => mine.indexOf(id) < 0 && slots.indexOf(HeroSkillService.isPassive(id) ? 'passive' : 'active') >= 0);
    }

    get learnCost(): Cost { return Object.assign({}, this.cfg.learnCost || { core: 1 }); }

    /** Learn a skill from a book. Returns an error message, or null when done. */
    learn(heroId: string, skillId: string): string | null {
        const rm = this.rm;
        if (!rm.isPreparation) return 'Cannot learn skills during combat';
        if (!rm.ownsHero(heroId)) return 'Hero not recruited';
        if (!this.learnUnlocked) return 'Research "Hero Scholarship" first (Research Lab Lv 2)';
        if (this.bookCount(skillId) <= 0) return 'No skill book';
        if (this.learnableBooks(heroId).indexOf(skillId) < 0) return 'This hero cannot learn that skill';
        if (!rm.spend(this.learnCost)) return 'Not enough Energy Cores';
        const d = rm.data;
        if (!d.heroSkills) d.heroSkills = {};
        d.heroSkills[heroId] = this.learned(heroId).concat([skillId]);
        d.books![skillId] = this.bookCount(skillId) - 1;
        if (d.books![skillId] <= 0) delete d.books![skillId];
        rm.notify();
        return null;
    }

    /** Buffs of the passive skills a hero learned. */
    passiveBuffs(heroId: string): BuffEntry[] {
        const out: BuffEntry[] = [];
        for (const id of this.learned(heroId)) {
            const p = ConfigMgr.passiveDef(id);
            if (p && Array.isArray(p.buffs)) for (const b of p.buffs) out.push({ key: b.key, value: b.value, towerId: b.towerId });
        }
        return out;
    }

    // ------------------------------------------------------------------ passives that recharge
    /** Waves a passive needs to recharge after it triggered (skills.json "cooldownWaves"), 0 = never. */
    static passiveCooldown(id: string): number { const p = ConfigMgr.passiveDef(id); return (p && p.cooldownWaves) || 0; }

    /** Wave from which a recharging passive works again (0 = ready). */
    passiveReadyWave(id: string): number { return (this.rm.data.passiveReady && this.rm.data.passiveReady[id]) || 0; }

    passiveReady(id: string): boolean { return this.rm.data.currentWave >= this.passiveReadyWave(id); }

    /** The passive triggered: it works again "cooldownWaves" waves later. */
    startPassiveCooldown(id: string) {
        const d = this.rm.data;
        if (!d.passiveReady) d.passiveReady = {};
        d.passiveReady[id] = d.currentWave + HeroSkillService.passiveCooldown(id);
        this.rm.notify();
    }

    /** Time Warp: a random hero skill that is recharging needs `waves` less (called once per cleared wave). */
    timeWarp(waves: number) {
        const d = this.rm.data;
        const list = this.castable().filter(c => this.readyWave(c.heroId) > d.currentWave);
        if (list.length === 0) return;
        const pick = list[Math.floor(Math.random() * list.length)];
        d.skillReady![pick.heroId] = Math.max(d.currentWave, this.readyWave(pick.heroId) - waves);
    }

    /** A passive book is only sold once its tower effect is unlocked (skills.json "requiresEffect"). */
    private sellable(id: string): boolean {
        const p = ConfigMgr.passiveDef(id);
        return !p || !p.requiresEffect || this.rm.buff('effectUnlock:' + p.requiresEffect) > 0;
    }

    // ------------------------------------------------------------------ casting (active skills)
    /** Waves an active hero skill needs to recharge (research lowers it, at least 1). */
    get cooldownWaves(): number { return Math.max(1, (this.cfg.cooldownWaves || 5) - this.rm.buff('skillCooldown')); }

    /** Uses before the skill recharges (research "Twin Cast" adds one). */
    get charges(): number { return 1 + Math.max(0, Math.floor(this.rm.buff('skillCharges'))); }

    readyWave(heroId: string): number { return (this.rm.data.skillReady && this.rm.data.skillReady[heroId]) || 0; }

    isReady(heroId: string): boolean { return this.rm.data.currentWave >= this.readyWave(heroId); }

    usesLeft(heroId: string): number {
        if (!this.isReady(heroId)) return 0;
        return Math.max(0, this.charges - ((this.rm.data.skillUses && this.rm.data.skillUses[heroId]) || 0));
    }

    /** Heroes owned with a learned active skill, in the order of heroes.json. */
    castable(): Array<{ heroId: string; skillId: string }> {
        const out: Array<{ heroId: string; skillId: string }> = [];
        for (const h of ConfigMgr.heroes.heroes) {
            const id = String(h.id);
            if (!this.rm.ownsHero(id)) continue;
            const s = this.activeOf(id);
            if (s) out.push({ heroId: id, skillId: s });
        }
        return out;
    }

    /** A hero cast its skill: count the use, start the recharge when no use is left. */
    use(heroId: string) {
        const d = this.rm.data;
        if (!d.skillUses) d.skillUses = {};
        if (!d.skillReady) d.skillReady = {};
        const used = (d.skillUses[heroId] || 0) + 1;
        if (used >= this.charges) {
            d.skillReady[heroId] = d.currentWave + this.cooldownWaves;
            d.skillUses[heroId] = 0;
        } else d.skillUses[heroId] = used;
        this.rm.notify();
    }

    // ------------------------------------------------------------------ skill books
    bookCount(id: string): number { return (this.rm.data.books && this.rm.data.books[id]) || 0; }

    ownedBooks(): string[] {
        const b = this.rm.data.books || {};
        return HeroSkillService.allIds().filter(id => (b[id] || 0) > 0);
    }

    /** Deterministic [0, 1) from the game's market seed, the wave and a salt. */
    private rand(salt: number): number {
        let h = ((this.rm.data.marketSeed || 0) ^ Math.imul(this.rm.data.currentWave + 7919, 2246822519) ^ Math.imul(salt + 1, 3266489917)) >>> 0;
        h = Math.imul(h ^ (h >>> 15), 2654435761) >>> 0;
        h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
        return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    }

    /** Gold price of a book this wave (before the random change). */
    basePrice(id: string): number {
        const c = this.shopCfg;
        const def = ConfigMgr.anySkillDef(id) || {};
        return (c.priceBase || 2000) * (1 + this.rm.data.currentWave * (c.pricePerWave || 0)) * (def.bookPriceMul || 1);
    }

    /** Wave in which a skill book was bought, or 0. */
    boughtWave(id: string): number { return (this.rm.data.boughtBooks && this.rm.data.boughtBooks[id]) || 0; }

    /**
     * This wave's book offers (the same every time the Market is opened during the wave). Skills bought
     * in an earlier wave are left out of the draw; the ones bought this wave just disappear from the list.
     */
    offers(): BookOffer[] {
        const c = this.shopCfg;
        const wave = this.rm.data.currentWave;
        const pool = HeroSkillService.allIds().filter(id => { const w = this.boughtWave(id); return (!w || w >= wave) && this.sellable(id); });
        const min = c.offersMin || 4, max = Math.max(min, c.offersMax || 6);
        const count = Math.min(pool.length, min + Math.floor(this.rand(1) * (max - min + 1)));
        const out: BookOffer[] = [];
        const left = pool.slice();
        for (let i = 0; i < count; i++) {
            const id = left.splice(Math.floor(this.rand(10 + i) * left.length), 1)[0];
            const f = (c.fluctuation || 0) / 100;
            const gold = Math.round(this.basePrice(id) * (1 + f * (2 * this.rand(100 + i) - 1)) / 10) * 10;
            if (!this.boughtWave(id)) out.push({ index: i, skillId: id, price: { gold } });
        }
        return out;
    }

    /** Buy one book offer of this wave. Returns an error message, or null when done. */
    buyBook(index: number): string | null {
        const rm = this.rm;
        if (!rm.isPreparation) return 'Cannot buy during combat';
        const o = this.offers().find(x => x.index === index);
        if (!o) return 'Offer not found';
        if (!rm.spend(o.price)) return 'Not enough gold';
        const d = rm.data;
        if (!d.boughtBooks) d.boughtBooks = {};
        d.boughtBooks[o.skillId] = d.currentWave;
        if (!d.books) d.books = {};
        d.books[o.skillId] = this.bookCount(o.skillId) + 1;
        rm.notify();
        return null;
    }
}
