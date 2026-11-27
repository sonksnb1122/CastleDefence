import { ConfigMgr } from '../core/ConfigMgr';
import { ResourceMgr } from '../core/ResourceMgr';
import { EffectScaling } from '../combat/EffectScaling';

/**
 * Texts that explain the tower effects in full: the research tree node windows (what a technology changes,
 * now and after the next level) and the tower Info window (what each effect does on this tower).
 */
const rm = () => ResourceMgr.inst;
const has = (p: string) => rm().buff('passive:' + p) > 0;

/** The tower that has this effect (tower.json levels[].effects). */
export function towerOfEffect(effectId: string): any {
    for (const t of ConfigMgr.tower.towers) for (const lv of t.levels) if ((lv.effects || []).some((e: any) => e.id === effectId)) return t;
    return null;
}

/** Effect id of a research technology of the Tower Effects branch ("effectUnlock:x", "effect:x", "effectMastery:x"), or ''. */
export function effectOfTech(t: any): { id: string; kind: 'unlock' | 'chance' | 'mastery' | 'plus' } | null {
    const m = /^(effectUnlock|effect|effectMastery|effectPlus):(.+)$/.exec(String(t && t.buffKey));
    if (!m) return null;
    return { id: m[2], kind: m[1] === 'effectUnlock' ? 'unlock' : m[1] === 'effect' ? 'chance' : m[1] === 'effectPlus' ? 'plus' : 'mastery' };
}

function resolve(id: string, level: number, mastery: number, towerLevel = 1, plus = rm().buff('effectPlus:' + id)): any {
    return EffectScaling.resolve(ConfigMgr.towerEffectDef(id), { level, mastery, plus, towerLevel, has });
}

/** Chance of an effect on a tower level: chance research (cap 50%) + effect-chance bonuses (Arcane Mastery, Attunement, heroes), 100% at most. */
export function effectChance(id: string, researchedPct: number, tower: any, towerLevel: number): { total: number; text: string } {
    const lv = tower ? tower.levels[Math.max(0, Math.min(tower.levels.length - 1, towerLevel - 1))] : null;
    const mul = (lv && lv.effectChanceMul) || 1;
    const cap = (ConfigMgr.tower.defaults.maxEffectChance || 50) * mul;
    const bonus = tower ? rm().buff('effectChance', tower.id) : rm().buff('effectChance');
    const base = Math.min(cap, researchedPct * mul);
    const total = Math.min(100, Math.round(base + bonus));
    // Where the chance comes from: the effect's two chance technologies (max 50%), then on top of that
    // Arcane Mastery (all towers), the tower's Attunement and hero buffs; 100% at most.
    const techPts = (id: string) => { const t = ConfigMgr.techDef(id); return t ? rm().techLevel(id) * (t.valuePerLevel || 0) : 0; };
    const arcane = techPts('r_effect'), attune = tower ? techPts('r_chance_' + tower.id) : 0;
    const heroes = Math.max(0, bonus - arcane - attune);
    const parts = [`effect research ${Math.round(base)}%${mul !== 1 ? ' (x' + mul + ' at tower Lv ' + towerLevel + ')' : ''} of ${cap}%`];
    if (arcane > 0) parts.push(`Arcane Mastery +${Math.round(arcane)}%`);
    if (attune > 0) parts.push(`${tower.name} Attunement +${Math.round(attune)}%`);
    if (heroes > 0) parts.push(`heroes +${Math.round(heroes)}%`);
    return { total, text: parts.join(', ') + '; 100% at most' };
}

/** Owned passives that change this effect. */
function passivesOf(id: string): string[] {
    const list: any[] = (ConfigMgr.skills && ConfigMgr.skills.passives) || [];
    return list.filter(p => p.requiresEffect === id && has(p.id)).map(p => p.name);
}

/** What damage numbers mean, shown under the effect texts. */
const FLAT_NOTE = 'Flat damage is x1.5 on level 2 towers and x2 on level 3 towers; it goes through defense and never crits.';

/**
 * Extra lines of a research node window for the Tower Effects technologies: the effect now and after
 * the next level (numbers for a level 1 tower).
 */
export function techEffectLines(t: any): string[] {
    const fx = effectOfTech(t);
    if (!fx) return [];
    const def = ConfigMgr.towerEffectDef(fx.id);
    if (!def) return [];
    const tower = towerOfEffect(fx.id);
    const towerName = tower ? tower.name : 'Tower';
    const unlocked = rm().buff('effectUnlock:' + fx.id) > 0;
    const level = Math.min(EffectScaling.maxLevel, rm().buff('lvl:effect:' + fx.id));
    const mastery = rm().buff('effectMastery:' + fx.id);
    const pct = rm().buff('effect:' + fx.id);
    const lv = rm().techLevel(t.id);
    const maxed = t.maxLevel > 0 && lv >= t.maxLevel;
    const out: string[] = ['', `${def.name} (${towerName} towers): ${def.description}`];
    const show = (label: string, L: number, M: number, chancePct: number) => {
        if (L <= 0) { out.push(`${label} (chance ${Math.round(chancePct)}%): no effect yet (effect level 0).`); return; }
        out.push(`${label} (chance ${Math.round(chancePct)}%): ${EffectScaling.describe(resolve(fx.id, L, M))}`);
    };
    if (fx.kind === 'unlock') {
        out.push(unlocked ? 'Unlocked.' : `Unlocking it does not trigger it yet: its chance and effect level come from the next two technologies (+5% chance and +1 effect level per level).`);
        show('At effect level 1', 1, 0, 5);
        show('At effect level 10', EffectScaling.maxLevel, 0, 50);
        out.push(`Its Mastery technology (under Tower Awakening) then adds: ${masterySummary(fx.id)}`);
    } else if (fx.kind === 'chance') {
        out.push(`Effect level ${level}/${EffectScaling.maxLevel} (levels of both chance technologies), Mastery ${mastery}/3.`);
        show('Now', level, mastery, pct);
        if (!maxed) show('After this level', level + 1, mastery, pct + t.valuePerLevel);
    } else if (fx.kind === 'plus') {
        const pl = rm().buff('effectPlus:' + fx.id);
        out.push(`Effect level ${level}/${EffectScaling.maxLevel}, Mastery ${mastery}/3, ${t.name} ${pl}/${t.maxLevel}.`);
        out.push(`Now (chance ${Math.round(pct)}%): ${EffectScaling.describe(resolve(fx.id, Math.max(level, 1), mastery, 1, pl))}`);
        if (!maxed) out.push(`At ${t.name} ${pl + 1} (chance ${Math.round(pct)}%): ${EffectScaling.describe(resolve(fx.id, Math.max(level, 1), Math.max(mastery, 3), 1, pl + 1))}`);
    } else {
        out.push(`Effect level ${level}/${EffectScaling.maxLevel}, Mastery ${mastery}/3.`);
        show('Now', level, mastery, pct);
        if (!maxed) show(`With Mastery ${mastery + 1}`, Math.max(level, 1), mastery + 1, pct);
    }
    const ps = passivesOf(fx.id);
    if (ps.length) out.push(`Hero passives on this effect: ${ps.join(', ')} (included above).`);
    out.push(`Numbers for a level 1 ${towerName}. ${FLAT_NOTE}`);
    out.push('Arcane Mastery, the tower Attunement and hero effect-chance buffs add their chance on top of the 50% from these technologies (100% at most).');
    return out;
}

/** The three Mastery levels in one sentence. */
function masterySummary(id: string): string {
    const t = (ConfigMgr.research.techs as any[]).find(x => x.buffKey === 'effectMastery:' + id);
    if (!t) return '-';
    const d: string = t.description || '';
    const i = d.indexOf('Lv 1');
    return i >= 0 ? d.substring(i) : d;
}

/**
 * Lines of the tower Info window for its special effects: chance (and where it comes from), effect level
 * and Mastery, what the effect does on this tower, how to make it stronger, and the hero passives on it.
 */
export function towerEffectLines(towerId: string, towerLevel: number, unlockedFn: (id: string) => boolean): string[] {
    const tower = ConfigMgr.towerDef(towerId);
    if (!tower) return [];
    const lv = tower.levels[Math.max(0, Math.min(tower.levels.length - 1, towerLevel - 1))];
    const out: string[] = [];
    for (const e of (lv.effects || [])) {
        const def = ConfigMgr.towerEffectDef(e.id);
        if (!def) continue;
        out.push('');
        const techs = (ConfigMgr.research.techs as any[]).filter(t => { const f = effectOfTech(t); return f && f.id === e.id; });
        const unlockTech = techs.find(t => effectOfTech(t)!.kind === 'unlock');
        if (!unlockedFn(e.id)) {
            out.push(`${def.name}: LOCKED`);
            out.push(`  ${def.description}`);
            out.push(`  Unlock it with "${unlockTech ? unlockTech.name : def.name}" in the research tree (Tower Effects branch, Research Lab Lv 2).`);
            out.push(`  At effect level 1 on this tower: ${EffectScaling.describe(resolve(e.id, 1, 0, towerLevel))}`);
            continue;
        }
        const level = Math.min(EffectScaling.maxLevel, rm().buff('lvl:effect:' + e.id));
        const mastery = rm().buff('effectMastery:' + e.id);
        const ch = effectChance(e.id, rm().buff('effect:' + e.id), tower, towerLevel);
        out.push(`${def.name}: ${ch.total}% chance per hit (${ch.text})`);
        out.push(`  Effect level ${level}/${EffectScaling.maxLevel}, Mastery ${mastery}/3.`);
        out.push(level > 0 ? `  ${EffectScaling.describe(resolve(e.id, level, mastery, towerLevel))}` : '  Effect level 0: research its chance technology to make it work.');
        // What to research next for this effect.
        const next = techs.filter(t => effectOfTech(t)!.kind !== 'unlock').find(t => rm().techLevel(t.id) < t.maxLevel);
        if (next) out.push(`  Next: "${next.name}" (Lv ${rm().techLevel(next.id)}/${next.maxLevel}) in the research tree.`);
        else out.push('  Fully researched.');
        const ps = passivesOf(e.id);
        if (ps.length) out.push(`  Hero passives: ${ps.join(', ')}.`);
    }
    if (out.length) out.push('', FLAT_NOTE);
    return out;
}
