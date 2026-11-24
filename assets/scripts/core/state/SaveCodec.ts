import { ConfigMgr } from '../ConfigMgr';
import { BuffEntry, SAVE_VERSION, SaveData } from '../GameTypes';
import { Placement } from './Placement';

/**
 * Left edge of the defense area (tower.json constructionArea.x) used by older save versions.
 * The battlefield has been moved (more castle ground on the left for the tower menus), so towers of
 * an older save move by the same amount as the area. Versions not listed used the current layout.
 */
const AREA_X_OF_VERSION: { [version: number]: number } = { 1: 40, 2: 40, 3: 180 };

/**
 * Creating, validating and copying save data. Never touches the running game:
 * a broken save is rejected without damaging the current progress.
 */
export class SaveCodec {
    /** Fresh progress for a new game (heroRolls come from the caller). */
    static newGame(heroRolls: { [id: string]: BuffEntry[] }): SaveData {
        const cfg = ConfigMgr.building;
        const center = Placement.castleCenter();
        return {
            saveVersion: SAVE_VERSION,
            configVersion: ConfigMgr.version,
            savedAt: 0,
            state: 'Preparation',
            resources: { food: cfg.startResources.food || 0, material: cfg.startResources.material || 0, gold: cfg.startResources.gold || 0, core: cfg.startResources.core || 0 },
            currentWave: 1,
            highestWave: 0,
            lastRewardedWave: 0,
            wallHp: 0,
            nextUid: 2,
            buildings: [{ uid: 1, id: 'base', level: 1, x: center.x, y: center.y }],
            towers: [],
            heroes: [],
            heroRolls,
            research: {},
            marketSeed: Math.floor(Math.random() * 1e9),
        };
    }

    /** Plain copy ready for JSON.stringify (stamps the time and versions). */
    static serialize(data: SaveData): SaveData {
        data.savedAt = Date.now();
        data.saveVersion = SAVE_VERSION;
        data.configVersion = ConfigMgr.version;
        return JSON.parse(JSON.stringify(data));
    }

    /**
     * Validate a raw save object. Missing / outdated fields get defaults;
     * buildings, towers, heroes and techs removed from the config are dropped.
     */
    static parse(raw: any): { data?: SaveData; error?: string } {
        if (!raw || typeof raw !== 'object') return { error: 'Save file is empty or not an object' };
        if (typeof raw.saveVersion !== 'number') return { error: 'Save file has no saveVersion' };
        if (raw.saveVersion > SAVE_VERSION) return { error: `Save version ${raw.saveVersion} is newer than this game (${SAVE_VERSION})` };
        const n = (v: any, def: number, min = 0) => (typeof v === 'number' && !isNaN(v) ? Math.max(min, v) : def);
        const start = ConfigMgr.building.startResources;
        const res = raw.resources || {};
        const d: SaveData = {
            saveVersion: SAVE_VERSION,
            configVersion: n(raw.configVersion, 0),
            savedAt: n(raw.savedAt, 0),
            state: 'Preparation', // saves are only written between waves
            resources: { food: n(res.food, start.food || 0), material: n(res.material, start.material || 0), gold: n(res.gold, start.gold || 0), core: Math.floor(n(res.core, start.core || 0)) },
            currentWave: Math.floor(n(raw.currentWave, 1, 1)),
            highestWave: Math.floor(n(raw.highestWave, 0)),
            lastRewardedWave: Math.floor(n(raw.lastRewardedWave, 0)),
            wallHp: n(raw.wallHp, -1, -1),
            nextUid: Math.floor(n(raw.nextUid, 2, 2)),
            buildings: [],
            towers: [],
            heroes: [],
            heroRolls: {},
            research: {},
            marketSeed: Math.floor(n(raw.marketSeed, Math.floor(Math.random() * 1e9))),
            skillReady: {},
            heroSkills: {},
            books: {},
            skillUses: {},
            bookShop: { wave: 0, bought: [] },
        };
        // Skill cooldowns: only skills that still exist in skills.json.
        const ready = raw.skillReady && typeof raw.skillReady === 'object' ? raw.skillReady : {};
        for (const id in ready) if (ConfigMgr.skillDef(id) || ConfigMgr.heroDef(id)) d.skillReady![id] = Math.floor(n(ready[id], 0));
        // Hero skills, skill books, skill uses and the book offers bought this wave.
        const known = (id: any) => typeof id === 'string' && !!ConfigMgr.anySkillDef(id);
        const hs = raw.heroSkills && typeof raw.heroSkills === 'object' ? raw.heroSkills : {};
        for (const h in hs) if (ConfigMgr.heroDef(h) && Array.isArray(hs[h])) d.heroSkills![h] = hs[h].filter(known);
        const books = raw.books && typeof raw.books === 'object' ? raw.books : {};
        for (const id in books) if (known(id) && n(books[id], 0) > 0) d.books![id] = Math.floor(n(books[id], 0));
        const uses = raw.skillUses && typeof raw.skillUses === 'object' ? raw.skillUses : {};
        for (const h in uses) if (ConfigMgr.heroDef(h)) d.skillUses![h] = Math.floor(n(uses[h], 0));
        const shop = raw.bookShop || {};
        d.bookShop = { wave: Math.floor(n(shop.wave, 0)), bought: Array.isArray(shop.bought) ? shop.bought.filter((x: any) => typeof x === 'number') : [] };
        let maxUid = 1;
        const center = Placement.castleCenter();
        for (const b of (Array.isArray(raw.buildings) ? raw.buildings : [])) {
            const def = b && ConfigMgr.buildingDef(b.id);
            if (!def) continue; // building removed from config
            const level = Math.min(def.levels.length, Math.max(1, Math.floor(n(b.level, 1))));
            const uid = Math.floor(n(b.uid, d.nextUid++));
            maxUid = Math.max(maxUid, uid);
            // The base never moves. Other buildings keep their position when it is still valid;
            // old grid saves (col / row) and invalid positions get a free spot near the base.
            let x = center.x, y = center.y;
            if (b.id !== 'base') {
                const ok = typeof b.x === 'number' && typeof b.y === 'number' && Placement.placementOk(d.buildings, b.id, b.x, b.y, 0);
                const spot = ok ? { x: b.x, y: b.y } : Placement.freeSpot(d.buildings, b.id);
                if (!spot) continue;
                x = spot.x; y = spot.y;
            }
            if (b.id === 'base') d.buildings.unshift({ uid, id: b.id, level, x, y });
            else d.buildings.push({ uid, id: b.id, level, x, y });
        }
        if (!d.buildings.some(b => b.id === 'base')) return { error: 'Save file has no base building' };
        const modes: string[] = ConfigMgr.tower.targetModes.concat(['Smart']);
        for (const t of (Array.isArray(raw.towers) ? raw.towers : [])) {
            const def = t && ConfigMgr.towerDef(t.id);
            if (!def) continue;
            const uid = Math.floor(n(t.uid, d.nextUid++));
            maxUid = Math.max(maxUid, uid);
            const oldX = AREA_X_OF_VERSION[raw.saveVersion];
            const shift = oldX === undefined ? 0 : ConfigMgr.tower.battlefield.constructionArea.x - oldX;
            let tx = n(t.x, 0) + shift, ty = n(t.y, 0);
            // Saves made with a different defense area: the tower moves to the closest valid spot.
            if (!Placement.towerSpotOk(d.towers, tx, ty, 0)) {
                const spot = Placement.nearestTowerSpot(d.towers, tx, ty);
                if (!spot) continue; // no room left at all
                tx = spot.x; ty = spot.y;
            }
            d.towers.push({
                uid, id: t.id,
                level: Math.min(def.levels.length, Math.max(1, Math.floor(n(t.level, 1)))),
                x: tx, y: ty,
                targetMode: modes.indexOf(t.targetMode) >= 0 ? t.targetMode : ConfigMgr.tower.defaults.targetMode,
            });
        }
        d.nextUid = Math.max(d.nextUid, maxUid + 1);
        for (const rawId of (Array.isArray(raw.heroes) ? raw.heroes : [])) { const id = String(rawId); if (ConfigMgr.heroDef(id) && d.heroes.indexOf(id) < 0) d.heroes.push(id); }
        const rolls = raw.heroRolls || {};
        for (const h of ConfigMgr.heroes.heroes) {
            const r = rolls[h.id];
            if (Array.isArray(r) && r.every((e: any) => e && typeof e.key === 'string' && typeof e.value === 'number')) d.heroRolls[h.id] = r;
        }
        const research = raw.research || {};
        for (const t of ConfigMgr.research.techs) {
            const lv = research[t.id];
            if (typeof lv === 'number' && lv > 0) d.research[t.id] = t.maxLevel ? Math.min(t.maxLevel, Math.floor(lv)) : Math.floor(lv);
        }
        return { data: d };
    }
}
