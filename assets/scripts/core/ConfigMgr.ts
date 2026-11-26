import { Assets } from './Assets';

/**
 * Loads and validates every gameplay JSON file in assets/resources/config.
 * All balancing values live in those files, never in code.
 */
export class ConfigMgr {
    static building: any = null;
    static tower: any = null;
    static enemy: any = null;
    static waves: any = null;
    static heroes: any = null;
    static herobuff: any = null;
    static research: any = null;
    static effects: any = null;
    /** Active skills (skills.json). */
    static skills: any = null;

    /** Fatal problems found while loading / validating. */
    static errors: string[] = [];
    /** Non fatal problems (missing art, ...). */
    static warnings: string[] = [];

    private static readonly FILES = ['building', 'tower', 'enemy', 'waves', 'heroes', 'herobuff', 'research', 'effects', 'skills'];

    static load(done: () => void) {
        let remaining = ConfigMgr.FILES.length;
        for (const name of ConfigMgr.FILES) {
            Assets.loadJson('config/' + name, (err, data) => {
                if (err) ConfigMgr.errors.push(err);
                else (ConfigMgr as any)[name] = data;
                if (--remaining === 0) {
                    if (ConfigMgr.errors.length === 0) {
                        // Hero ids may be written as numbers in heroes.json; the game always uses strings.
                        for (const h of ((ConfigMgr.heroes && ConfigMgr.heroes.heroes) || [])) if (h && h.id !== undefined) h.id = String(h.id);
                        ConfigMgr.validate();
                    }
                    done();
                }
            });
        }
    }

    /** Sum of all "version" fields; stored in saves to detect config changes. */
    static get version(): number {
        let v = 0;
        for (const name of ConfigMgr.FILES) v += ((ConfigMgr as any)[name] && (ConfigMgr as any)[name].version) || 0;
        return v;
    }

    // ------------------------------------------------------------------ lookups
    static towerDef(id: string): any { return ConfigMgr.find(ConfigMgr.tower.towers, id); }
    static towerLevel(id: string, level: number): any { const t = ConfigMgr.towerDef(id); return t ? t.levels[level - 1] : null; }
    static enemyDef(id: string): any { return ConfigMgr.find(ConfigMgr.enemy.enemies, id); }
    static buildingDef(id: string): any { return ConfigMgr.find(ConfigMgr.building.buildings, id); }
    static buildingLevel(id: string, level: number): any { const b = ConfigMgr.buildingDef(id); return b ? b.levels[level - 1] : null; }
    static heroDef(id: string): any { return ConfigMgr.find(ConfigMgr.heroes.heroes, String(id)); }
    static techDef(id: string): any { return ConfigMgr.find(ConfigMgr.research.techs, id); }
    static statusDef(id: string): any { return ConfigMgr.find(ConfigMgr.effects.statusEffects, id); }
    static towerEffectDef(id: string): any { return ConfigMgr.find(ConfigMgr.effects.towerEffects, id); }
    static skillDef(id: string): any { return ConfigMgr.find((ConfigMgr.skills && ConfigMgr.skills.skills) || [], id); }
    /** Passive hero skill (skills.json "passives"). */
    static passiveDef(id: string): any { return ConfigMgr.find((ConfigMgr.skills && ConfigMgr.skills.passives) || [], id); }
    /** Active skill or passive. */
    static anySkillDef(id: string): any { return ConfigMgr.skillDef(id) || ConfigMgr.passiveDef(id); }
    /** Animated card sheet layout shared by every hero (heroes.json "card"). */
    static get heroCard(): { cellW: number; cellH: number; frames: number; frameTime: number } {
        return ConfigMgr.heroes.card || { cellW: 576, cellH: 816, frames: 1, frameTime: 0.1 };
    }

    /** Display info of a buff key (name + unit). */
    static buffInfo(key: string): { name: string; unit: string } {
        const all = (ConfigMgr.herobuff.buffs as any[]).concat(ConfigMgr.herobuff.extraBuffKeys || []);
        for (const b of all) if (b.key === key) return { name: b.name, unit: b.unit || '' };
        return { name: key, unit: '' };
    }

    private static find(list: any[], id: string): any {
        if (!list) return null;
        for (const item of list) if (item.id === id) return item;
        return null;
    }

    // ------------------------------------------------------------------ assets
    /** Every texture path referenced by the configs. */
    static texturePaths(): string[] {
        const out: string[] = [];
        for (const t of ConfigMgr.tower.towers) {
            out.push(t.base.path);
            for (const lv of t.levels) out.push(lv.sprite.weapon.path, lv.sprite.projectile.path, lv.sprite.impact.path);
        }
        for (const e of ConfigMgr.enemy.enemies) {
            // Every animation (move, dead, attack, boss spells...), projectiles, spell effects and shields.
            for (const k in e.animationPaths) if (e.animationPaths[k] && e.animationPaths[k].path) out.push(e.animationPaths[k].path);
            if (e.ranged && e.ranged.projectile) out.push(e.ranged.projectile.path);
            if (e.ranged && e.ranged.impact) out.push(e.ranged.impact.path);
            for (const sp of (e.spells || [])) {
                if (sp.vfx) out.push(sp.vfx.path);
                if (sp.shield && sp.shield.loop) out.push(sp.shield.loop.path);
                if (sp.shield && sp.shield.collapse) out.push(sp.shield.collapse.path);
            }
        }
        for (const b of ConfigMgr.building.buildings) for (const lv of b.levels) if (lv.sprite) out.push(lv.sprite.path);
        if (ConfigMgr.building.map.path) out.push(ConfigMgr.building.map.path);
        const wall = ConfigMgr.tower.battlefield.wall.sprite;
        if (wall && wall.path) out.push(wall.path);
        for (const p of ConfigMgr.groundTexturePaths()) out.push(p);
        const ui = ConfigMgr.heroes.ui || {};
        for (const k in ui) if (ui[k] && ui[k].path) out.push(ui[k].path);
        for (const p of ConfigMgr.resourceIconPaths()) out.push(p);
        const icons = ConfigMgr.building.uiIcons || {};
        for (const k in icons) if (typeof icons[k] === 'string') out.push(icons[k]);
        for (const p of ConfigMgr.uiStylePaths()) out.push(p);
        for (const s of ConfigMgr.effects.statusEffects) if (s.visual && s.visual.icon) out.push(s.visual.icon);
        for (const s of ((ConfigMgr.skills && ConfigMgr.skills.skills) || [])) if (s.vfx && s.vfx.path) out.push(s.vfx.path);
        for (const t of ((ConfigMgr.research && ConfigMgr.research.techs) || [])) if (t.icon) out.push(t.icon);
        return out;
    }

    /** Frame art of a button style ('menu' | 'game') from building.json "uiStyle.buttons", or null. */
    static buttonStyle(name: string): any {
        const st = ConfigMgr.building.uiStyle;
        return st && st.buttons && st.buttons[name] ? st.buttons[name] : null;
    }

    /** Top bar frame from building.json "uiStyle.topBar", or null. */
    static topBarStyle(): any {
        const st = ConfigMgr.building.uiStyle;
        return st && st.topBar ? st.topBar : null;
    }

    static uiStylePaths(): string[] {
        const out: string[] = [];
        const st = ConfigMgr.building.uiStyle || {};
        for (const k in (st.buttons || {})) { const b = st.buttons[k]; if (b.frame) out.push(b.frame); if (b.fill) out.push(b.fill); }
        if (st.topBar) { if (st.topBar.path) out.push(st.topBar.path); if (st.topBar.center && st.topBar.center.path) out.push(st.topBar.center.path); }
        return out;
    }

    /** Picture of an icon button (building.json "uiIcons": pause, play): texture path and cell size, or null. */
    static uiIcon(name: string): { path: string; size: number } | null {
        const cfg = ConfigMgr.building.uiIcons;
        return cfg && typeof cfg[name] === 'string' ? { path: cfg[name], size: cfg.size || 96 } : null;
    }

    /** Icon of a resource (building.json "resourceIcons"): texture path and cell size, or null. */
    static resourceIcon(key: string): { path: string; size: number } | null {
        const cfg = ConfigMgr.building.resourceIcons;
        return cfg && cfg[key] ? { path: cfg[key], size: cfg.size || 64 } : null;
    }

    static resourceIconPaths(): string[] {
        const cfg = ConfigMgr.building.resourceIcons || {};
        return ['food', 'material', 'gold', 'core'].filter(k => !!cfg[k]).map(k => cfg[k]);
    }

    /** 9-slice frame config from heroes.json "ui" (cardFrame, popupBg, popupHeader), or null. */
    static uiFrame(name: string): any {
        const ui = ConfigMgr.heroes.ui;
        return ui && ui[name] ? ui[name] : null;
    }

    /** Battlefield ground tiles (tower.json battlefield.ground). */
    static groundTexturePaths(): string[] {
        const g = ConfigMgr.tower.battlefield.ground;
        const out: string[] = [];
        if (g) for (const k of ['grass', 'sand', 'edgeTop', 'edgeBottom']) if (g[k] && g[k].path) out.push(g[k].path);
        return out;
    }

    /** Textures that are smooth art, not pixel art: they keep linear filtering. */
    static linearTexturePaths(): string[] {
        const out: string[] = [];
        if (ConfigMgr.building.map.path) out.push(ConfigMgr.building.map.path);
        const wall = ConfigMgr.tower.battlefield.wall.sprite;
        if (wall && wall.path) out.push(wall.path);
        for (const p of ConfigMgr.groundTexturePaths()) out.push(p);
        for (const p of ConfigMgr.resourceIconPaths()) out.push(p);
        const icons = ConfigMgr.building.uiIcons || {};
        for (const k in icons) if (typeof icons[k] === 'string') out.push(icons[k]);
        return out;
    }

    static checkAssets() {
        for (const p of ConfigMgr.texturePaths()) {
            if (!Assets.has(p) && ConfigMgr.warnings.indexOf('Missing texture: ' + p) < 0) ConfigMgr.warnings.push('Missing texture: ' + p);
        }
    }

    // ------------------------------------------------------------------ validation
    private static validate() {
        const E = ConfigMgr.errors;
        const num = (file: string, obj: any, field: string, where: string, min = 0) => {
            const v = obj ? obj[field] : undefined;
            if (typeof v !== 'number' || isNaN(v)) E.push(`${file}: "${field}" of ${where} must be a number`);
            else if (v < min) E.push(`${file}: "${field}" of ${where} must be >= ${min} (got ${v})`);
        };
        const str = (file: string, obj: any, field: string, where: string) => {
            if (!obj || typeof obj[field] !== 'string' || obj[field].length === 0) E.push(`${file}: "${field}" of ${where} must be a non-empty string`);
        };
        const uniqueIds = (file: string, list: any, what: string, idField = 'id'): boolean => {
            if (!Array.isArray(list)) { E.push(`${file}: "${what}" must be an array`); return false; }
            const seen: { [k: string]: boolean } = {};
            list.forEach((item: any, i: number) => {
                const id = item ? item[idField] : undefined;
                if (typeof id !== 'string' || !id) E.push(`${file}: ${what}[${i}] has no "${idField}"`);
                else if (seen[id]) E.push(`${file}: duplicate ${idField} "${id}" in ${what}`);
                else seen[id] = true;
            });
            return true;
        };
        const cost = (file: string, c: any, where: string) => {
            if (!c || typeof c !== 'object') { E.push(`${file}: cost of ${where} is missing`); return; }
            for (const k in c) if (typeof c[k] !== 'number' || c[k] < 0) E.push(`${file}: cost "${k}" of ${where} must be a number >= 0`);
        };
        const levels = (file: string, list: any, where: string): boolean => {
            if (!Array.isArray(list) || list.length === 0) { E.push(`${file}: ${where} needs a non-empty "levels" array`); return false; }
            list.forEach((lv: any, i: number) => { if (!lv || lv.level !== i + 1) E.push(`${file}: ${where} level entry ${i} must have "level": ${i + 1}`); });
            return true;
        };

        // effects.json
        const fx = ConfigMgr.effects;
        const stackings = ['RefreshDuration', 'StackValue', 'IndependentInstances', 'ReplaceStronger'];
        const statusTypes = ['slow', 'stun', 'bleed', 'burn', 'armorBreak', 'mark'];
        if (uniqueIds('effects.json', fx.statusEffects, 'statusEffects')) {
            for (const s of fx.statusEffects) {
                num('effects.json', s, 'duration', s.id); num('effects.json', s, 'value', s.id);
                if (statusTypes.indexOf(s.type) < 0) E.push(`effects.json: status "${s.id}" has unknown type "${s.type}"`);
                if (stackings.indexOf(s.stacking) < 0) E.push(`effects.json: status "${s.id}" has unknown stacking "${s.stacking}"`);
            }
        }
        if (uniqueIds('effects.json', fx.towerEffects, 'towerEffects')) {
            for (const t of fx.towerEffects) {
                num('effects.json', t, 'chance', t.id);
                if (['status', 'chain', 'bonusMaxHp'].indexOf(t.kind) < 0) E.push(`effects.json: tower effect "${t.id}" has unknown kind "${t.kind}"`);
                if (t.kind === 'status' && !ConfigMgr.statusDef(t.statusId)) E.push(`effects.json: tower effect "${t.id}" references unknown status "${t.statusId}"`);
                const sc = t.scaling;
                if (sc && sc.mastery && !Array.isArray(sc.mastery)) E.push(`effects.json: tower effect "${t.id}" scaling.mastery must be a list`);
                for (const k of ['flat', 'value']) if (sc && sc[k] && !(Array.isArray(sc[k]) && sc[k].length === 2)) E.push(`effects.json: tower effect "${t.id}" scaling.${k} must be [level 1, level 10]`);
            }
        }

        // tower.json
        const tw = ConfigMgr.tower;
        if (!tw.battlefield || !tw.battlefield.constructionArea || !tw.battlefield.wall) E.push('tower.json: "battlefield" with "constructionArea" and "wall" is required');
        if (uniqueIds('tower.json', tw.towers, 'towers')) {
            for (const t of tw.towers) {
                str('tower.json', t, 'name', t.id);
                cost('tower.json', t.buildCost, t.id);
                if (!Array.isArray(t.damageTypes) || t.damageTypes.length === 0) E.push(`tower.json: "${t.id}" needs "damageTypes"`);
                else for (const d of t.damageTypes) if (d !== 'physic' && d !== 'magic') E.push(`tower.json: "${t.id}" has invalid damage type "${d}"`);
                if (!levels('tower.json', t.levels, t.id)) continue;
                for (const lv of t.levels) {
                    const where = `${t.id} L${lv.level}`;
                    num('tower.json', lv, 'damage', where); num('tower.json', lv, 'attackSpeed', where, 0.0001);
                    num('tower.json', lv, 'attackRange', where); num('tower.json', lv, 'explosionRange', where);
                    num('tower.json', lv, 'critRate', where); num('tower.json', lv, 'critDamage', where);
                    cost('tower.json', lv.upgradeCost, where);
                    if (!lv.sprite || !lv.sprite.weapon || !lv.sprite.projectile || !lv.sprite.impact) E.push(`tower.json: ${where} needs "sprite" with weapon/projectile/impact`);
                    for (const ef of (lv.effects || [])) if (!ConfigMgr.towerEffectDef(ef.id)) E.push(`tower.json: ${where} references unknown effect "${ef.id}"`);
                }
            }
        }

        // enemy.json
        if (uniqueIds('enemy.json', ConfigMgr.enemy.enemies, 'enemies')) {
            for (const e of ConfigMgr.enemy.enemies) {
                str('enemy.json', e, 'name', e.id);
                num('enemy.json', e, 'hp', e.id, 1); num('enemy.json', e, 'damage', e.id); num('enemy.json', e, 'moveSpeed', e.id);
                num('enemy.json', e, 'physicDef', e.id); num('enemy.json', e, 'magicDef', e.id);
                num('enemy.json', e, 'goldReward', e.id); num('enemy.json', e, 'spawnWeight', e.id);
                if (!e.animationPaths || !e.animationPaths.move || !e.animationPaths.dead) E.push(`enemy.json: "${e.id}" needs animationPaths.move and animationPaths.dead`);
                for (const sp of (e.spells || [])) {
                    if (['shield', 'summon', 'teleport'].indexOf(sp.type) < 0) E.push(`enemy.json: "${e.id}" spell type "${sp.type}" is unknown (shield, summon, teleport)`);
                    if (sp.anim && !e.animationPaths[sp.anim]) E.push(`enemy.json: "${e.id}" spell "${sp.type}" uses missing animation "${sp.anim}"`);
                    if (sp.type === 'teleport' && (!e.animationPaths.teleportOut || !e.animationPaths.teleportIn)) E.push(`enemy.json: "${e.id}" teleport needs animationPaths.teleportOut and teleportIn`);
                    for (const id of ((sp.summon && sp.summon.enemyIds) || [])) if (!ConfigMgr.enemyDef(id)) E.push(`enemy.json: "${e.id}" summons unknown enemy "${id}"`);
                }
                if (e.ranged) {
                    if (!e.ranged.anyRange) num('enemy.json', e.ranged, 'range', e.id + '.ranged', 0);
                    num('enemy.json', e.ranged, 'attackInterval', e.id + '.ranged', 0.1);
                    if (!e.ranged.projectile) E.push(`enemy.json: "${e.id}" ranged needs a projectile`);
                    if (!e.animationPaths || !e.animationPaths.attack) E.push(`enemy.json: "${e.id}" ranged needs animationPaths.attack`);
                }
            }
        }

        // waves.json
        const wv = ConfigMgr.waves;
        num('waves.json', wv, 'enemyCountBase', 'root', 1); num('waves.json', wv, 'enemyCountPerWave', 'root'); num('waves.json', wv, 'spawnInterval', 'root', 0.01);
        const checkEnemy = (id: string, where: string) => { if (!ConfigMgr.enemyDef(id)) E.push(`waves.json: ${where} references unknown enemy "${id}"`); };
        if (!Array.isArray(wv.tiers) || wv.tiers.length === 0) E.push('waves.json: "tiers" must be a non-empty array');
        else for (const t of wv.tiers) for (const id in t.weights) checkEnemy(id, `tier ${t.fromWave}-${t.toWave}`);
        for (const o of (wv.overrides || [])) for (const g of (o.groups || [])) checkEnemy(g.enemyId, `override wave ${o.wave}`);
        if (wv.bossRule) {
            checkEnemy(wv.bossRule.enemyId, 'bossRule');
            for (const b of (wv.bossRule.byWave || [])) checkEnemy(b.enemyId, 'bossRule.byWave');
        }

        // building.json
        const bd = ConfigMgr.building;
        if (!bd.map || !bd.wall || !bd.startResources) E.push('building.json: "map", "wall" and "startResources" are required');
        else {
            num('building.json', bd.map, 'width', 'map', 1); num('building.json', bd.map, 'height', 'map', 1);
            const ba = bd.map.buildArea;
            if (!ba) E.push('building.json: map.buildArea is required');
            else { num('building.json', ba, 'x', 'map.buildArea'); num('building.json', ba, 'y', 'map.buildArea'); num('building.json', ba, 'width', 'map.buildArea', 1); num('building.json', ba, 'height', 'map.buildArea', 1); }
        }
        if (uniqueIds('building.json', bd.buildings, 'buildings')) {
            if (!ConfigMgr.buildingDef('base')) E.push('building.json: a building with id "base" is required');
            for (const b of bd.buildings) {
                str('building.json', b, 'name', b.id);
                if (!levels('building.json', b.levels, b.id)) continue;
                for (const lv of b.levels) cost('building.json', lv.cost, `${b.id} L${lv.level}`);
            }
        }

        // herobuff.json / heroes.json / research.json
        const buffKeys: { [k: string]: boolean } = {};
        if (uniqueIds('herobuff.json', ConfigMgr.herobuff.buffs, 'buffs', 'key')) {
            for (const b of ConfigMgr.herobuff.buffs) {
                buffKeys[b.key] = true;
                num('herobuff.json', b, 'min', b.key); num('herobuff.json', b, 'max', b.key);
                if (b.max < b.min) E.push(`herobuff.json: buff "${b.key}" has max < min`);
            }
        }
        for (const b of (ConfigMgr.herobuff.extraBuffKeys || [])) buffKeys[b.key] = true;
        if (uniqueIds('heroes.json', ConfigMgr.heroes.heroes, 'heroes')) {
            for (const h of ConfigMgr.heroes.heroes) {
                str('heroes.json', h, 'name', h.id);
                if (typeof h.stars !== 'number' || h.stars < 1 || h.stars > ConfigMgr.herobuff.buffs.length) E.push(`heroes.json: hero "${h.id}" has invalid "stars"`);
                for (const pb of ((h.passive && h.passive.buffs) || [])) if (!buffKeys[pb.key]) E.push(`heroes.json: hero "${h.id}" passive uses unknown buff key "${pb.key}"`);
            }
        }
        for (const p of ((ConfigMgr.skills && ConfigMgr.skills.passives) || [])) {
            if (p.requiresEffect && !ConfigMgr.towerEffectDef(p.requiresEffect)) E.push(`skills.json: passive "${p.id}" requires unknown tower effect "${p.requiresEffect}"`);
            for (const pb of (p.buffs || [])) if (!buffKeys[pb.key]) E.push(`skills.json: passive "${p.id}" uses unknown buff key "${pb.key}"`);
        }
        if (uniqueIds('research.json', ConfigMgr.research.techs, 'techs')) {
            for (const t of ConfigMgr.research.techs) {
                // maxLevel 0 = endless technology. Research tree: branch, tier (1-3, 4 = endless row) and parent node.
                num('research.json', t, 'valuePerLevel', t.id); num('research.json', t, 'maxLevel', t.id, 0); num('research.json', t, 'costGrowth', t.id, 1);
                cost('research.json', t.baseCost, t.id);
                const branches: any[] = ConfigMgr.research.branches || [];
                if (!branches.some(b => b.id === t.branch)) E.push(`research.json: tech "${t.id}" has unknown branch "${t.branch}"`);
                if (!(t.tier >= 1 && t.tier <= 4)) E.push(`research.json: tech "${t.id}" needs "tier" 1 to 4`);
                if (t.parent) {
                    const p = ConfigMgr.techDef(t.parent);
                    if (!p || !p.maxLevel) E.push(`research.json: tech "${t.id}" has an unknown or endless parent "${t.parent}"`);
                    else if (p.branch !== t.branch || p.tier > t.tier) E.push(`research.json: tech "${t.id}": parent "${t.parent}" must be in the same branch and not in a lower tier`);
                }
                if (!buffKeys[t.buffKey]) E.push(`research.json: tech "${t.id}" uses unknown buff key "${t.buffKey}"`);
            }
        }
    }
}
