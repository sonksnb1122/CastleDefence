import { Node, Sprite } from 'cc';
import { WaveMgr } from '../combat/WaveMgr';
import { ConfigMgr } from '../core/ConfigMgr';
import { G } from '../core/Globals';
import { ResourceMgr } from '../core/ResourceMgr';
import { DefTab } from './common/DefTab';
import type { IOverlay } from './Overlays';
import { GuideRowView } from './items/GuideRowView';
import { GuideStageView } from './items/GuideStageView';
import { openPopup } from './common/PopupTemplate';
import { PrefabUi } from './common/PrefabUi';
import { COLORS, ScrollList, hex, text } from './common/UIKit';

/**
 * One goal of the guide: done (greyed, ticked), or to do; `ready` = it can be done right now (red dot);
 * `priority` 1-5 (stars, 5 = first); `late` = a goal of a past stage that is still not reached.
 */
export interface GuideItem { title: string; detail: string; done: boolean; ready: boolean; warn?: boolean; priority: number; late?: boolean; }

/** A stage of the guide (guide.json "stages"): its goals, and whether it is the current / a past stage. */
export interface GuideStage { title: string; until: number | null; current: boolean; past: boolean; items: GuideItem[]; }

type Goal = Omit<GuideItem, 'priority' | 'late'>;

/**
 * Guide (castle, button at the bottom right): the goals of a game by stage (before wave 30, 50, 70, 90, after),
 * in the order a good player reaches them, like the progression bot (tools/harness/prog.js). Stages, goals and
 * their priority (1-5 stars) are in guide.json "stages". Reached goals are greyed out with a tick; a red dot marks
 * the goals of the current (and past) stages that can be done right now, and the castle button gets a red dot
 * when there is at least one. The Enemy armor needed for the next wave (Armor / Spell Piercing) is a goal of
 * every wave.
 */
export class Guide {
    /** Every stage with its goals; unfinished goals of past stages are moved to the current stage (late). */
    static stages(): GuideStage[] {
        const rm = ResourceMgr.inst;
        const defs: any[] = (ConfigMgr.guide && ConfigMgr.guide.stages) || [];
        if (!rm.data) return [];
        const wave = rm.data.currentWave;
        // Current stage: the first one whose "until" wave is not passed yet (null: the last stage).
        let cur = defs.findIndex(s => s.until === null || (s.until > 0 && wave <= s.until));
        if (cur < 0) cur = defs.length - 1;
        const out: GuideStage[] = defs.map((s, i) => ({
            title: s.until === 0 ? s.title : s.until === null ? `After wave ${Guide.lastUntil(defs)}: ${s.title}` : `Before wave ${s.until}: ${s.title}`,
            until: s.until, current: i === cur, past: s.until !== 0 && i < cur,
            items: (s.goals || []).map((g: any) => {
                const it = Guide.goal(g) as GuideItem;
                it.priority = Math.max(1, Math.min(5, g.priority || 3));
                return it;
            }).filter((it: GuideItem) => !!it.title),
        }));
        // A stage whose goals are all reached early: the next stage is the current one.
        while (cur < out.length - 1 && out[cur].items.every(it => it.done)) cur++;
        out.forEach((s, i) => { s.current = i === cur; s.past = s.until !== 0 && i < cur; });
        // Late goals: from the past stages into the current one.
        for (const s of out) {
            if (!s.past) continue;
            const late = s.items.filter(it => !it.done);
            s.items = s.items.filter(it => it.done);
            for (const it of late) { it.late = true; it.warn = true; out[cur].items.push(it); }
        }
        // Future stages: no red dot (do the goals of the current stage first).
        for (const s of out) if (s.until !== 0 && !s.past && !s.current) for (const it of s.items) it.ready = false;
        // Order inside a stage: goals to do (higher priority first, those that can be done now first), then reached.
        for (const s of out) {
            s.items.sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0) || b.priority - a.priority || (b.ready ? 1 : 0) - (a.ready ? 1 : 0));
        }
        return out;
    }

    /** Every goal, all stages together. */
    static items(): GuideItem[] {
        return Guide.stages().reduce((a: GuideItem[], s) => a.concat(s.items), []);
    }

    /** True when at least one goal can be done right now (red dot of the castle button). */
    static hasReady(): boolean { return Guide.items().some(i => i.ready); }

    private static lastUntil(defs: any[]): number {
        return defs.reduce((m, s) => (s.until ? Math.max(m, s.until) : m), 0);
    }

    /** One goal of guide.json: title, progress, reached, can be done now. */
    private static goal(g: any): Goal {
        const rm = ResourceMgr.inst;
        const d = rm.data;
        const tech = (id: string) => rm.techLevel(id);
        const maxed = (id: string) => { const t = ConfigMgr.techDef(id); return !!t && rm.techLevel(id) >= t.maxLevel; };
        const canResearch = (id: string) => !!ConfigMgr.techDef(id) && !rm.techBlock(id) && rm.canAfford(rm.techCost(id));
        const make = (title: string, detail: string, done: boolean, ready: boolean, warn = false): Goal => ({ title, detail, done, ready: !done && ready, warn: !done && warn });
        const baseMax = ConfigMgr.buildingDef('base').levels.length;
        const towers = d.towers.length, limit = rm.towerLimit;
        // Most heroes a player can own (hero limit of the highest Base level).
        const allHeroes = ConfigMgr.buildingDef('base').levels.reduce((m: number, l: any) => Math.max(m, l.heroLimit || 0), 0) || ConfigMgr.heroes.heroes.length;
        const finite = () => ConfigMgr.research.techs.filter((t: any) => t.maxLevel > 0 && !t.afterAwakening && t.id !== 'r_awaken');
        switch (g.id) {
            case 'armor': {
                const wave = d.currentWave, def = WaveMgr.defense(wave);
                const have = [rm.buff('enemyPhysicDefReduce'), rm.buff('enemyMagicDefReduce')];
                const need = [DefTab.needed(def.physic), DefTab.needed(def.magic)];
                const short = have[0] < need[0] || have[1] < need[1];
                const pierce = ['r_pdef', 'r_pdef_2', 'r_pdef_3', 'r_mdef', 'r_mdef_2', 'r_mdef_3'];
                const next = WaveMgr.nextDefenseWave(wave);
                return make(`Enemy armor of wave ${wave}: Armor / Spell Piercing`,
                    `Physic ${have[0]} / ${need[0]}    Magic ${have[1]} / ${need[1]}` + (short && !pierce.some(id => !rm.techBlock(id)) ? '   (upgrade the Research Lab)' : next ? `   (DEF rises at wave ${next})` : ''),
                    !short, short && pierce.some(canResearch), short);
            }
            case 'wall': {
                const pct = Math.round(d.wallHp / rm.wallMaxHp() * 100);
                return make('Keep the wall above 70% (Repair, outside)', `Wall ${pct}%`, pct >= 70, pct < 70 && rm.canAfford(rm.wallRepairCost()), pct < 50);
            }
            case 'base': {
                const base = d.buildings.find(b => b.id === 'base');
                const bc = base ? rm.buildingUpgradeCost(base) : null;
                return make(rm.baseLevel >= baseMax ? `Base at max level (Lv ${baseMax})` : `Upgrade the Base to Lv ${baseMax}`,
                    `Lv ${rm.baseLevel} / ${baseMax}: higher buildings, more towers and heroes, a new research tier`, rm.baseLevel >= baseMax, !!bc && rm.canAfford(bc));
            }
            case 'farms': case 'workshops': case 'lab': {
                const id = g.id === 'farms' ? 'farm' : g.id === 'workshops' ? 'material' : 'research';
                const name = g.id === 'farms' ? 'Farms' : g.id === 'workshops' ? 'Workshops' : 'the Research Lab';
                const n = rm.countBuildings(id), m = rm.maxBuildingCount(id);
                return make(`Build ${name}`, `${n} / ${m}` + (rm.baseLevel < baseMax ? ' (more with every Base level)' : ''), n >= m, n < m && rm.canAfford(ConfigMgr.buildingDef(id).levels[0].cost));
            }
            case 'buildings': {
                const behind = d.buildings.filter(b => b.id !== 'base' && b.level < rm.baseLevel);
                return make(`Upgrade the buildings to Lv ${rm.baseLevel} (Base level)`, behind.length ? `${behind.length} building(s) to upgrade` : 'All done',
                    behind.length === 0 && rm.baseLevel >= baseMax, behind.some(b => { const c = rm.buildingUpgradeCost(b); return !!c && rm.canAfford(c); }));
            }
            case 'towers': {
                const cheapest = ['crossbow', 'crystal', 'catapult'].map(id => ConfigMgr.towerDef(id).buildCost).find(c => rm.canAfford(c));
                return make('Build towers outside the wall', `${towers} / ${limit} towers (more with every Base level)`, towers >= limit && rm.baseLevel >= baseMax, !!cheapest && towers < limit);
            }
            case 'towerLevel': {
                const tl = Math.min(3, rm.baseLevel);
                const low = d.towers.filter(t => t.level < tl);
                return make(`Upgrade every tower to Lv ${tl}`, low.length ? `${low.length} tower(s) below Lv ${tl}` : 'All done',
                    low.length === 0 && tl >= 3 && towers > 0, low.some(t => { const c = rm.towerUpgradeCost(t); return !rm.towerUpgradeBlock(t) && !!c && rm.canAfford(c); }));
            }
            case 'scholarship':
                return make('Research Hero Scholarship', 'Heroes can learn skills', tech('r_hero_skill') > 0, canResearch('r_hero_skill'));
            case 'smart':
                return make('Research Smart Targeting', 'Towers aim where their damage is most useful', tech('r_smart') > 0, canResearch('r_smart'));
            case 'research': case 'researchAll': {
                const f = finite(), left = f.filter((t: any) => !maxed(t.id));
                const target = g.id === 'researchAll' ? f.length : Math.min(f.length, g.target || f.length);
                const n = f.length - left.length;
                return make(g.id === 'researchAll' ? 'Research every technology above the Awakening line' : `Research ${target} technologies to their max level`,
                    `${n} / ${target} at max level`, n >= target, left.some((t: any) => canResearch(t.id)));
            }
            case 'heroes': {
                const n = d.heroes.length, target = Math.min(allHeroes, g.target || allHeroes);
                return make(`Recruit ${target} heroes (Base > Heroes)`, `${n} / ${target}` + (rm.heroLimit < target ? `   (${rm.heroLimit} with this Base level)` : ''),
                    n >= target, n < rm.heroLimit && rm.canAfford(rm.recruitCost()));
            }
            case 'skills': {
                if (tech('r_hero_skill') <= 0) return make(g.perHero === 'full' ? 'Fill every skill slot of your heroes' : 'Teach a skill to every hero', 'Research Hero Scholarship first', false, false);
                const learned = d.heroes.reduce((a, h) => a + rm.skills.learned(h).length, 0);
                const free = d.heroes.filter(h => rm.skills.canLearnMore(h));
                const canTeach = free.some(h => rm.skills.learnableBooks(h).length > 0) && rm.canAfford(rm.skills.learnCost);
                const books = `${rm.skills.ownedBooks().length} book(s) owned (Market > Skill Books)`;
                if (g.perHero === 'full') {
                    const five = d.heroes.filter(h => rm.heroes.stars(h) >= 5).length;
                    return make('Fill every skill slot (5-star heroes learn 2)', `${learned} skills learned, ${free.length} free slot(s), ${books}`,
                        free.length === 0 && d.heroes.length >= allHeroes && five >= d.heroes.length, canTeach);
                }
                const without = d.heroes.filter(h => rm.skills.learned(h).length === 0).length;
                return make('Teach a skill to every hero', `${d.heroes.length - without} / ${d.heroes.length} heroes with a skill, ${books}`,
                    without === 0 && d.heroes.length >= allHeroes, canTeach);
            }
            case 'halo': {
                const halos = d.towers.filter(t => t.id === 'halo').length;
                return make('Research Halo Spire, build 4 of them near the wall', tech('r_halo') > 0 ? `${halos} / 4 Halo Spires` : 'Research "Halo Spire" (Fortification)',
                    halos >= 4, tech('r_halo') > 0 ? towers < limit && rm.canAfford(ConfigMgr.towerDef('halo').buildCost) : canResearch('r_halo'));
            }
            case 'awaken':
                return make('Tower Awakening', 'Opens the Masteries (needs the tree above the line at max level)', tech('r_awaken') > 0, canResearch('r_awaken'));
            case 'masteries': {
                const mast = ConfigMgr.research.techs.filter((t: any) => /^r_fxm_/.test(t.id));
                const n = mast.filter((t: any) => maxed(t.id)).length;
                return make('Research the effect Masteries', tech('r_awaken') > 0 ? `${n} / ${mast.length} at max level` : 'After the Tower Awakening', n >= mast.length, mast.some((t: any) => canResearch(t.id)));
            }
            case 'treeRest': {
                const after = ConfigMgr.research.techs.filter((t: any) => t.maxLevel > 0 && t.afterAwakening && !/^r_fxm_/.test(t.id));
                const n = after.filter((t: any) => maxed(t.id)).length;
                return make('Research the rest of the tree', tech('r_awaken') > 0 ? `${n} / ${after.length} at max level` : 'After the Tower Awakening', n >= after.length, after.some((t: any) => canResearch(t.id)));
            }
            case 'promote': {
                const n = d.heroes.length, five = d.heroes.filter(h => rm.heroes.stars(h) >= 5).length;
                return make('Promote your heroes to 5 stars (research Ascension)', `${five} / ${n} heroes at 5 stars`, n >= allHeroes && five >= n,
                    d.heroes.some(h => !rm.heroes.promoteBlock(h) && !!rm.heroes.promoteCost(h) && rm.canAfford(rm.heroes.promoteCost(h)!)));
            }
            case 'endless': {
                const t = ConfigMgr.techDef(g.tech);
                if (!t) return make('', '', true, false);
                const lv = tech(g.tech), target = g.target || 1;
                return make(`Research ${t.name} to Lv ${target}`, `Lv ${lv} / ${target}   (endless technology, ${t.label || ''})`, lv >= target, canResearch(g.tech));
            }
        }
        return make('', '', true, false);
    }
}

/**
 * The guide window (PopupTemplate): the goals stage by stage (title: prefabs/items/GuideStage, goal:
 * prefabs/items/GuideRow). Every-wave goals first, then the current stage, the next ones and the stages already done.
 */
export class GuideOverlay implements IOverlay {
    root: Node;
    constructor(parent: Node) {
        const W = Math.min(720, G.main.W - 30), H = Math.min(536, G.main.H - 30);
        const d = openPopup(parent, { title: 'Guide', width: W, height: H, buttons: [{ text: 'Close', keepOpen: true, onClick: () => G.main.closeOverlay() }] });
        this.root = d.node;
        text(d.content, 'Goals by stage.  ★ = priority (5 = do it first).  Red dot: you can do it now.', 14, -W / 2 + 34, H / 2 - 66, { ax: 0, color: COLORS.textDim });
        // List between the hint and the Close button.
        const list = new ScrollList(d.content, 0, -2, W - 50, H - 164);
        const stages = Guide.stages();
        const order = stages.filter(s => s.until === 0).concat(stages.filter(s => s.current), stages.filter(s => s.until !== 0 && !s.past && !s.current), stages.filter(s => s.past));
        let y = -4;
        for (const s of order) {
            if (s.items.length === 0) continue;
            const head = PrefabUi.view('items/GuideStage', list.content, GuideStageView);
            const hh = PrefabUi.size(head.node).height;
            head.node.setPosition(0, y - hh / 2, 0);
            y -= hh + 2;
            const own = s.items.filter(i => !i.late);
            if (head.title) {
                head.title.string = s.title + (s.current ? '   (now)' : s.past ? '   (done)' : '');
                head.title.color = hex(s.current || s.until === 0 ? COLORS.accent : s.past ? '#77708a' : COLORS.text);
            }
            if (head.count) head.count.string = `${own.filter(i => i.done).length} / ${own.length} reached`;
            if (head.line) head.line.active = s.current || s.until === 0;
            for (const it of s.items) {
                const row = PrefabUi.view('items/GuideRow', list.content, GuideRowView);
                const rh = PrefabUi.size(row.node).height;
                row.node.setPosition(0, y - rh / 2, 0);
                y -= rh;
                if (row.title) {
                    row.title.string = it.title + (it.late ? '   (late)' : '');
                    row.title.color = hex(it.done ? '#77708a' : it.warn ? COLORS.bad : COLORS.text);
                    row.title.isBold = !it.done;
                }
                if (row.detail) { row.detail.string = it.detail; row.detail.color = hex(it.done ? '#5f5a6e' : it.warn ? '#ffb0b0' : COLORS.textDim); }
                if (row.stars) {
                    row.stars.string = '★'.repeat(it.priority) + '☆'.repeat(5 - it.priority);
                    row.stars.color = hex(it.done ? '#5f5a6e' : '#ffd35a');
                }
                if (row.tick) row.tick.active = it.done;
                if (row.dot) row.dot.active = it.ready;
                // Reached goals: darker panel.
                const fill = row.panel ? PrefabUi.child(row.panel, 'Fill', Sprite) : null;
                if (fill && it.done) fill.color = hex('#24212c');
            }
            y -= 8;
        }
        list.setContentHeight(-y + 4);
    }

    destroy() { this.root.destroy(); }
}
