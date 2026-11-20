import { ConfigMgr } from './ConfigMgr';
import { BuffEntry, BuildingSave, Cost, DamageType, RESOURCE_KEYS, SAVE_VERSION, SaveData, TowerSave } from './GameTypes';

/**
 * Singleton that owns every piece of player progress: resources, buildings
 * (inside and outside the castle), wave progress, heroes and research.
 * Everything stored in `data` is what gets written to a save file.
 * All resource / building operations are validated here before being applied.
 */
export class ResourceMgr {
    private static _inst: ResourceMgr | null = null;
    static get inst(): ResourceMgr {
        if (!ResourceMgr._inst) ResourceMgr._inst = new ResourceMgr();
        return ResourceMgr._inst;
    }

    data: SaveData = null as any;
    private listeners: Array<() => void> = [];
    private buffCache: { [key: string]: number } | null = null;

    // ------------------------------------------------------------------ events
    /** Register a callback fired whenever progress data changes. Returns an unsubscribe function. */
    onChange(fn: () => void): () => void {
        this.listeners.push(fn);
        return () => { const i = this.listeners.indexOf(fn); if (i >= 0) this.listeners.splice(i, 1); };
    }
    notify() {
        this.buffCache = null;
        for (const fn of this.listeners.slice()) fn();
    }

    // ------------------------------------------------------------------ new game / save / load
    newGame() {
        const cfg = ConfigMgr.building;
        const center = ResourceMgr.castleCenter();
        this.data = {
            saveVersion: SAVE_VERSION,
            configVersion: ConfigMgr.version,
            savedAt: 0,
            state: 'Preparation',
            resources: { food: cfg.startResources.food || 0, material: cfg.startResources.material || 0, gold: cfg.startResources.gold || 0 },
            currentWave: 1,
            highestWave: 0,
            lastRewardedWave: 0,
            wallHp: 0,
            nextUid: 2,
            buildings: [{ uid: 1, id: 'base', level: 1, x: center.x, y: center.y }],
            towers: [],
            heroes: [],
            heroRolls: this.rollAllHeroes(),
            research: {},
        };
        this.buffCache = null;
        this.data.wallHp = this.wallMaxHp();
        this.notify();
    }

    /** Plain object ready for JSON.stringify. */
    serialize(): SaveData {
        this.data.savedAt = Date.now();
        this.data.saveVersion = SAVE_VERSION;
        this.data.configVersion = ConfigMgr.version;
        return JSON.parse(JSON.stringify(this.data));
    }

    /**
     * Validate a raw save object. Never touches the current data, so a failed
     * load cannot damage the running game. Missing / outdated fields get defaults.
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
            resources: { food: n(res.food, start.food || 0), material: n(res.material, start.material || 0), gold: n(res.gold, start.gold || 0) },
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
        };
        let maxUid = 1;
        const center = ResourceMgr.castleCenter();
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
                const ok = typeof b.x === 'number' && typeof b.y === 'number' && ResourceMgr.placementOk(d.buildings, b.id, b.x, b.y, 0);
                const spot = ok ? { x: b.x, y: b.y } : ResourceMgr.freeSpot(d.buildings, b.id);
                if (!spot) continue;
                x = spot.x; y = spot.y;
            }
            if (b.id === 'base') d.buildings.unshift({ uid, id: b.id, level, x, y });
            else d.buildings.push({ uid, id: b.id, level, x, y });
        }
        if (!d.buildings.some(b => b.id === 'base')) return { error: 'Save file has no base building' };
        const modes: string[] = ConfigMgr.tower.targetModes;
        for (const t of (Array.isArray(raw.towers) ? raw.towers : [])) {
            const def = t && ConfigMgr.towerDef(t.id);
            if (!def) continue;
            const uid = Math.floor(n(t.uid, d.nextUid++));
            maxUid = Math.max(maxUid, uid);
            // Saves made with a different defense area: the tower moves to the closest valid spot.
            let tx = n(t.x, 0), ty = n(t.y, 0);
            if (!ResourceMgr.towerSpotOk(d.towers, tx, ty, 0)) {
                const spot = ResourceMgr.nearestTowerSpot(d.towers, tx, ty);
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
        for (const raw_id of (Array.isArray(raw.heroes) ? raw.heroes : [])) { const id = String(raw_id); if (ConfigMgr.heroDef(id) && d.heroes.indexOf(id) < 0) d.heroes.push(id); }
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

    /** Replace current progress with validated save data. */
    apply(d: SaveData) {
        this.data = d;
        this.buffCache = null;
        // Heroes added to the config after the save was written still need buff rolls.
        const fresh = this.rollAllHeroes();
        for (const id in fresh) if (!d.heroRolls[id]) d.heroRolls[id] = fresh[id];
        const max = this.wallMaxHp();
        if (d.wallHp <= 0 || d.wallHp > max) d.wallHp = max;
        this.notify();
    }

    private uid(): number { return this.data.nextUid++; }

    // ------------------------------------------------------------------ resources
    get(resource: string): number { return (this.data.resources as any)[resource] || 0; }

    canAfford(cost: Cost): boolean {
        for (const k in cost) if (this.get(k) < cost[k]) return false;
        return true;
    }

    /** Spend resources. Returns false (and changes nothing) when not affordable. */
    spend(cost: Cost): boolean {
        if (!this.canAfford(cost)) return false;
        for (const k in cost) (this.data.resources as any)[k] = Math.max(0, this.get(k) - cost[k]);
        this.notify();
        return true;
    }

    add(gain: Cost) {
        for (const k in gain) {
            if (RESOURCE_KEYS.indexOf(k) < 0) continue;
            (this.data.resources as any)[k] = Math.max(0, this.get(k) + gain[k]);
        }
        this.notify();
    }

    static costText(cost: Cost): string {
        const parts: string[] = [];
        for (const k of RESOURCE_KEYS) if (cost && cost[k]) parts.push(`${cost[k]} ${k}`);
        return parts.length ? parts.join(', ') : 'free';
    }

    get isPreparation(): boolean { return this.data.state === 'Preparation'; }

    // ------------------------------------------------------------------ buffs (research + heroes)
    /**
     * Total buff for a key. All buffs are additive percentage points (or flat
     * points for defense values). `towerId` adds tower specific hero passives.
     */
    buff(key: string, towerId?: string): number {
        if (!this.buffCache) this.buffCache = this.buildBuffCache();
        let v = this.buffCache[key] || 0;
        if (towerId) v += this.buffCache[key + '@' + towerId] || 0;
        return v;
    }

    private buildBuffCache(): { [key: string]: number } {
        const out: { [key: string]: number } = {};
        const add = (e: BuffEntry) => {
            const k = e.towerId ? e.key + '@' + e.towerId : e.key;
            out[k] = (out[k] || 0) + e.value;
        };
        for (const t of ConfigMgr.research.techs) {
            const lv = this.data.research[t.id] || 0;
            if (lv > 0) add({ key: t.buffKey, value: t.valuePerLevel * lv, towerId: t.towerId });
        }
        for (const id of this.data.heroes) for (const e of this.heroBuffs(id)) add(e);
        return out;
    }

    /** Rolled buffs + configured passive buffs of one hero. */
    heroBuffs(heroId: string): BuffEntry[] {
        const def = ConfigMgr.heroDef(heroId);
        const list: BuffEntry[] = (this.data.heroRolls[heroId] || []).slice();
        if (def && def.passive) for (const b of def.passive.buffs) list.push(b);
        return list;
    }

    /** Human readable list of every active buff (for the Base info panel). */
    activeBuffLines(fromHeroesOnly: boolean): string[] {
        const totals: { [k: string]: number } = {};
        const add = (e: BuffEntry) => {
            const k = e.towerId ? e.key + '@' + e.towerId : e.key;
            totals[k] = (totals[k] || 0) + e.value;
        };
        if (!fromHeroesOnly) {
            for (const t of ConfigMgr.research.techs) {
                const lv = this.data.research[t.id] || 0;
                if (lv > 0) add({ key: t.buffKey, value: t.valuePerLevel * lv });
            }
        }
        for (const id of this.data.heroes) for (const e of this.heroBuffs(id)) add(e);
        const lines: string[] = [];
        for (const k in totals) {
            const parts = k.split('@');
            const info = ConfigMgr.buffInfo(parts[0]);
            lines.push(`${info.name}${parts[1] ? ' (' + parts[1] + ')' : ''}: +${totals[k]}${info.unit}`);
        }
        return lines;
    }

    private rollAllHeroes(): { [id: string]: BuffEntry[] } {
        const out: { [id: string]: BuffEntry[] } = {};
        for (const h of ConfigMgr.heroes.heroes) {
            const pool: any[] = ConfigMgr.herobuff.buffs.slice();
            const picks: BuffEntry[] = [];
            for (let i = 0; i < h.stars && pool.length > 0; i++) {
                const b = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
                picks.push({ key: b.key, value: b.min + Math.floor(Math.random() * (b.max - b.min + 1)) });
            }
            out[h.id] = picks;
        }
        return out;
    }

    // ------------------------------------------------------------------ castle buildings
    building(uid: number): BuildingSave | null {
        for (const b of this.data.buildings) if (b.uid === uid) return b;
        return null;
    }
    get baseLevel(): number {
        for (const b of this.data.buildings) if (b.id === 'base') return b.level;
        return 1;
    }
    countBuildings(id: string): number { return this.data.buildings.filter(b => b.id === id).length; }
    maxBuildingCount(id: string): number {
        const def = ConfigMgr.buildingDef(id);
        if (!def || !def.buildable) return 0;
        return (def.maxCountBase || 0) + (def.maxCountPerBaseLevel || 0) * this.baseLevel;
    }

    // ---- free placement inside the castle (same idea as tower placement outside)
    /** Build area in castle-world pixels (map pixels * map scale). */
    static castleArea(): { x: number; y: number; width: number; height: number } {
        const m = ConfigMgr.building.map;
        const a = m.buildArea, s = m.scale || 1;
        return { x: a.x * s, y: a.y * s, width: a.width * s, height: a.height * s };
    }
    static castleCenter(): { x: number; y: number } {
        const a = ResourceMgr.castleArea();
        return { x: Math.round(a.x + a.width / 2), y: Math.round(a.y + a.height / 2) };
    }
    /** Side of the square footprint of a building in castle-world pixels. */
    static buildingSize(id: string): number {
        const def = ConfigMgr.buildingDef(id);
        return ((def && def.footprint) || 128) * (ConfigMgr.building.map.buildingScale || 1);
    }

    /** True when the footprint centered on (x,y) is inside the build area and touches no other building. */
    static placementOk(list: BuildingSave[], id: string, x: number, y: number, ignoreUid: number): boolean {
        const a = ResourceMgr.castleArea();
        const half = ResourceMgr.buildingSize(id) / 2;
        if (x - half < a.x || x + half > a.x + a.width || y - half < a.y || y + half > a.y + a.height) return false;
        const gap = ConfigMgr.building.map.minGap || 0;
        for (const b of list) {
            if (b.uid === ignoreUid) continue;
            const reach = half + ResourceMgr.buildingSize(b.id) / 2 + gap;
            if (Math.abs(b.x - x) < reach && Math.abs(b.y - y) < reach) return false;
        }
        return true;
    }

    /** First free position on rings around the base (used when a saved position is not valid). */
    static freeSpot(list: BuildingSave[], id: string): { x: number; y: number } | null {
        const c = ResourceMgr.castleCenter();
        const step = ResourceMgr.buildingSize(id) + (ConfigMgr.building.map.minGap || 0) + 16;
        for (let ring = 1; ring < 12; ring++) {
            for (let iy = -ring; iy <= ring; iy++) {
                for (let ix = -ring; ix <= ring; ix++) {
                    if (Math.max(Math.abs(ix), Math.abs(iy)) !== ring) continue;
                    const x = c.x + ix * step, y = c.y + iy * step;
                    if (ResourceMgr.placementOk(list, id, x, y, 0)) return { x, y };
                }
            }
        }
        return null;
    }

    canPlaceBuilding(id: string, x: number, y: number, ignoreUid = 0): boolean {
        return !!ConfigMgr.buildingDef(id) && ResourceMgr.placementOk(this.data.buildings, id, x, y, ignoreUid);
    }

    /** Production of one building per wave, buffs included. */
    production(b: BuildingSave): Cost {
        const lv = ConfigMgr.buildingLevel(b.id, b.level);
        const out: Cost = {};
        if (lv && lv.production) {
            for (const r in lv.production) out[r] = Math.floor(lv.production[r] * (1 + this.buff(r + 'Production') / 100));
        }
        return out;
    }

    buildingUpgradeCost(b: BuildingSave): Cost | null {
        const next = ConfigMgr.buildingLevel(b.id, b.level + 1);
        return next ? next.cost : null;
    }

    /** Each mutating operation returns null on success or a reason string. */
    buildBuilding(id: string, x: number, y: number): string | null {
        const def = ConfigMgr.buildingDef(id);
        if (!this.isPreparation) return 'Cannot build during combat';
        if (!def || !def.buildable) return 'This building cannot be built';
        if (this.countBuildings(id) >= this.maxBuildingCount(id)) return `Limit reached for ${def.name} (upgrade the Base)`;
        if (!this.canPlaceBuilding(id, x, y)) return 'Invalid position';
        const cost = def.levels[0].cost;
        if (!this.canAfford(cost)) return 'Not enough resources';
        this.data.buildings.push({ uid: this.uid(), id, level: 1, x: Math.round(x), y: Math.round(y) });
        this.spend(cost);
        return null;
    }

    upgradeBuilding(uid: number): string | null {
        const b = this.building(uid);
        if (!this.isPreparation) return 'Cannot upgrade during combat';
        if (!b) return 'Building not found';
        const cost = this.buildingUpgradeCost(b);
        if (!cost) return 'Already at max level';
        if (b.id !== 'base' && b.level >= this.baseLevel) return 'Upgrade the Base first';
        if (!this.canAfford(cost)) return 'Not enough resources';
        b.level++;
        this.spend(cost);
        return null;
    }

    moveBuilding(uid: number, x: number, y: number): string | null {
        const b = this.building(uid);
        if (!this.isPreparation) return 'Cannot move during combat';
        if (!b) return 'Building not found';
        if (ConfigMgr.buildingDef(b.id).fixed) return 'This building cannot be moved';
        if (!this.canPlaceBuilding(b.id, x, y, uid)) return 'Invalid position';
        b.x = Math.round(x); b.y = Math.round(y);
        this.notify();
        return null;
    }

    destroyBuilding(uid: number): string | null {
        const b = this.building(uid);
        if (!this.isPreparation) return 'Cannot destroy during combat';
        if (!b) return 'Building not found';
        const def = ConfigMgr.buildingDef(b.id);
        if (def.fixed) return 'This building cannot be destroyed';
        this.data.buildings.splice(this.data.buildings.indexOf(b), 1);
        this.add(this.refund(def.levels[0].cost)); // only the construction cost is refunded
        return null;
    }

    refund(cost: Cost): Cost {
        const rate = ConfigMgr.building.destroyRefundRate;
        const out: Cost = {};
        for (const k in cost) out[k] = Math.floor(cost[k] * rate);
        return out;
    }

    // ------------------------------------------------------------------ defense towers
    tower(uid: number): TowerSave | null {
        for (const t of this.data.towers) if (t.uid === uid) return t;
        return null;
    }
    get towerLimit(): number { return ConfigMgr.buildingLevel('base', this.baseLevel).towerLimit || 0; }

    /** Validate a tower foot position inside the construction area. */
    canPlaceTower(x: number, y: number, ignoreUid = 0): boolean {
        return ResourceMgr.towerSpotOk(this.data.towers, x, y, ignoreUid);
    }

    /** True when (x,y) is inside the defense area, clear of the wall and of every other tower. */
    static towerSpotOk(list: TowerSave[], x: number, y: number, ignoreUid: number): boolean {
        const bf = ConfigMgr.tower.battlefield;
        const a = bf.constructionArea;
        if (x < a.x || x > a.x + a.width || y < a.y || y > a.y + a.height) return false;
        if (x + bf.towerMinSpacing / 2 > bf.wall.x) return false; // must not touch the wall
        for (const t of list) {
            if (t.uid === ignoreUid) continue;
            const dx = t.x - x, dy = t.y - y;
            if (dx * dx + dy * dy < bf.towerMinSpacing * bf.towerMinSpacing) return false;
        }
        return true;
    }

    /** Valid position closest to (x,y); used when a saved tower no longer fits the defense area. */
    static nearestTowerSpot(list: TowerSave[], x: number, y: number): { x: number; y: number } | null {
        const bf = ConfigMgr.tower.battlefield;
        const a = bf.constructionArea;
        const step = Math.max(4, Math.round(bf.towerMinSpacing / 4));
        let best: { x: number; y: number } | null = null;
        let bestD = Infinity;
        for (let py = a.y; py <= a.y + a.height; py += step) {
            for (let px = a.x; px <= a.x + a.width; px += step) {
                const d = (px - x) * (px - x) + (py - y) * (py - y);
                if (d < bestD && ResourceMgr.towerSpotOk(list, px, py, 0)) { bestD = d; best = { x: px, y: py }; }
            }
        }
        return best;
    }

    towerUpgradeCost(t: TowerSave): Cost | null {
        const next = ConfigMgr.towerLevel(t.id, t.level + 1);
        return next ? next.upgradeCost : null;
    }

    /** Why the next upgrade of a tower is not possible yet (cost aside), or null. */
    towerUpgradeBlock(t: TowerSave): string | null {
        if (!this.towerUpgradeCost(t)) return 'Already at max level';
        if (t.level >= this.baseLevel) return 'Upgrade the Base first';
        return null;
    }

    buildTower(id: string, x: number, y: number): string | null {
        const def = ConfigMgr.towerDef(id);
        if (!this.isPreparation) return 'Cannot build during combat';
        if (!def) return 'Unknown tower';
        if (this.data.towers.length >= this.towerLimit) return `Tower limit reached (${this.towerLimit}). Upgrade the Base`;
        if (!this.canPlaceTower(x, y)) return 'Invalid position';
        if (!this.canAfford(def.buildCost)) return 'Not enough resources';
        this.data.towers.push({ uid: this.uid(), id, level: 1, x: Math.round(x), y: Math.round(y), targetMode: ConfigMgr.tower.defaults.targetMode });
        this.spend(def.buildCost);
        return null;
    }

    upgradeTower(uid: number): string | null {
        const t = this.tower(uid);
        if (!this.isPreparation) return 'Cannot upgrade during combat';
        if (!t) return 'Tower not found';
        const block = this.towerUpgradeBlock(t);
        if (block) return block;
        const cost = this.towerUpgradeCost(t)!;
        if (!this.canAfford(cost)) return 'Not enough resources';
        t.level++;
        this.spend(cost);
        return null;
    }

    moveTower(uid: number, x: number, y: number): string | null {
        const t = this.tower(uid);
        if (!this.isPreparation) return 'Cannot move during combat';
        if (!t) return 'Tower not found';
        if (!this.canPlaceTower(x, y, uid)) return 'Invalid position';
        t.x = Math.round(x); t.y = Math.round(y);
        this.notify();
        return null;
    }

    destroyTower(uid: number): string | null {
        const t = this.tower(uid);
        if (!this.isPreparation) return 'Cannot destroy during combat';
        if (!t) return 'Tower not found';
        this.data.towers.splice(this.data.towers.indexOf(t), 1);
        this.add(this.refund(ConfigMgr.towerDef(t.id).buildCost));
        return null;
    }

    cycleTargetMode(uid: number): string {
        const t = this.tower(uid);
        const modes: string[] = ConfigMgr.tower.targetModes;
        if (!t) return modes[0];
        t.targetMode = modes[(modes.indexOf(t.targetMode) + 1) % modes.length];
        this.notify();
        return t.targetMode;
    }

    // ------------------------------------------------------------------ castle wall
    wallMaxHp(): number {
        return Math.floor(ConfigMgr.building.wall.hp * (1 + this.buff('wallHp') / 100));
    }
    wallDef(type: DamageType): number {
        const w = ConfigMgr.building.wall;
        const base = type === 'physic' ? w.physicDef : w.magicDef;
        return Math.min(w.maxDef, base + this.buff('wallDef'));
    }
    /** Apply damage to the wall. Returns true when the wall is destroyed. */
    damageWall(amount: number): boolean {
        this.data.wallHp = Math.max(0, this.data.wallHp - amount);
        return this.data.wallHp <= 0;
    }
    wallRepairCost(): Cost {
        const missing = this.wallMaxHp() - this.data.wallHp;
        const wall = ConfigMgr.building.wall;
        const per = wall.repairCostPerHp || {};
        // Repairs get more expensive with every Base level (wall.repairCostMul, one value per level).
        const muls: number[] = wall.repairCostMul || [];
        const mul = muls.length ? muls[Math.min(muls.length, this.baseLevel) - 1] : 1;
        const out: Cost = {};
        for (const k in per) out[k] = Math.ceil(missing * per[k] * mul);
        return out;
    }
    repairWall(): string | null {
        if (!this.isPreparation) return 'Cannot repair during combat';
        if (this.data.wallHp >= this.wallMaxHp()) return 'Wall is already at full HP';
        const cost = this.wallRepairCost();
        if (!this.canAfford(cost)) return 'Not enough resources';
        this.data.wallHp = this.wallMaxHp();
        this.spend(cost);
        return null;
    }

    // ------------------------------------------------------------------ research
    techLevel(id: string): number { return this.data.research[id] || 0; }

    /** Highest technology level allowed by the research buildings (0 = no lab). */
    get maxTechLevel(): number {
        let max = 0;
        for (const b of this.data.buildings) {
            const lv = ConfigMgr.buildingLevel(b.id, b.level);
            if (lv && lv.maxTechLevel) max = Math.max(max, lv.maxTechLevel);
        }
        return max;
    }

    /** Level of the Research Lab (0 = none built). */
    get labLevel(): number {
        let lv = 0;
        for (const b of this.data.buildings) if (b.id === 'research') lv = Math.max(lv, b.level);
        return lv;
    }

    /** Endless technologies have maxLevel 0. */
    static isEndless(t: any): boolean { return !t.maxLevel; }

    /** Why a technology cannot be researched at all yet (missing lab level / prerequisites), or null. */
    techLock(id: string): string | null {
        const t = ConfigMgr.techDef(id);
        const req = t && t.requires;
        if (!req) return null;
        if (req.labLevel && this.labLevel < req.labLevel) return `Needs Research Lab Lv ${req.labLevel}`;
        for (const rid of (req.techsMaxed || [])) {
            const r = ConfigMgr.techDef(rid);
            if (r && this.techLevel(rid) < r.maxLevel) return `Needs ${r.name} at max level`;
        }
        return null;
    }

    /**
     * Cost of the next level of a technology, research discount included.
     * `growthKeys` (optional) limits the cost growth to some resources; the others stay at the base cost.
     */
    techCost(id: string): Cost {
        const t = ConfigMgr.techDef(id);
        const lv = this.techLevel(id);
        const discount = Math.min(90, this.buff('researchCostReduce'));
        const keys: string[] | null = Array.isArray(t.growthKeys) ? t.growthKeys : null;
        const out: Cost = {};
        for (const k in t.baseCost) {
            const growth = !keys || keys.indexOf(k) >= 0 ? Math.pow(t.costGrowth, lv) : 1;
            out[k] = Math.ceil(t.baseCost[k] * growth * (1 - discount / 100));
        }
        return out;
    }

    /** Why the next level of a technology cannot be researched (cost aside), or null. */
    techBlock(id: string): string | null {
        const t = ConfigMgr.techDef(id);
        if (!t) return 'Unknown technology';
        const lock = this.techLock(id);
        if (lock) return lock;
        const lv = this.techLevel(id);
        if (ResourceMgr.isEndless(t)) return null;
        if (lv >= t.maxLevel) return 'Already at max level';
        if (lv >= this.maxTechLevel) return this.maxTechLevel === 0 ? 'Build a Research Lab first' : 'Upgrade the Research Lab first';
        return null;
    }

    doResearch(id: string): string | null {
        if (!this.isPreparation) return 'Cannot research during combat';
        const block = this.techBlock(id);
        if (block) return block;
        const lv = this.techLevel(id);
        const cost = this.techCost(id);
        if (!this.canAfford(cost)) return 'Not enough resources';
        const wallBefore = this.wallMaxHp();
        this.data.research[id] = lv + 1;
        this.buffCache = null;
        // A bigger wall keeps the HP it gained.
        this.data.wallHp += Math.max(0, this.wallMaxHp() - wallBefore);
        this.spend(cost);
        return null;
    }

    // ------------------------------------------------------------------ heroes
    ownsHero(id: string): boolean { return this.data.heroes.indexOf(id) >= 0; }

    /** Heroes that can be owned at the current Base level. */
    get heroLimit(): number {
        const lv = ConfigMgr.buildingLevel('base', this.baseLevel);
        return lv && typeof lv.heroLimit === 'number' ? lv.heroLimit : ConfigMgr.heroes.heroes.length;
    }

    /** Price of the next recruit: base cost plus a bit more for every hero already owned. */
    recruitCost(): Cost {
        const cfg = ConfigMgr.building;
        const base: Cost = cfg.recruitCost || {};
        const per: Cost = cfg.recruitCostPerHero || {};
        const n = this.data.heroes.length;
        const out: Cost = {};
        for (const k in base) out[k] = Math.round(base[k] + (per[k] || 0) * n);
        for (const k in per) if (!(k in out)) out[k] = Math.round(per[k] * n);
        return out;
    }

    /** Gacha: pay the recruit cost and get a random hero not owned yet. */
    recruitHero(): { heroId?: string; error?: string } {
        if (!this.isPreparation) return { error: 'Cannot recruit during combat' };
        const pool: any[] = ConfigMgr.heroes.heroes.filter((h: any) => !this.ownsHero(h.id));
        if (pool.length === 0) return { error: 'All heroes are already recruited' };
        if (this.data.heroes.length >= this.heroLimit) return { error: `Hero limit reached (${this.heroLimit}). Upgrade the Base` };
        const cost = this.recruitCost();
        if (!this.canAfford(cost)) return { error: 'Not enough resources' };
        const weights = ConfigMgr.heroes.starWeights || {};
        let total = 0;
        for (const h of pool) total += weights[String(h.stars)] || 1;
        let roll = Math.random() * total;
        let picked = pool[pool.length - 1];
        for (const h of pool) {
            roll -= weights[String(h.stars)] || 1;
            if (roll <= 0) { picked = h; break; }
        }
        const wallBefore = this.wallMaxHp();
        this.data.heroes.push(picked.id);
        this.buffCache = null;
        this.data.wallHp += Math.max(0, this.wallMaxHp() - wallBefore);
        this.spend(cost);
        return { heroId: picked.id };
    }

    // ------------------------------------------------------------------ waves
    beginCombat() { this.data.state = 'Combat'; this.notify(); }

    /** Gold for one defeated enemy, kill-gold buff included. */
    killGold(base: number): number { return Math.floor(base * (1 + this.buff('killGold') / 100)); }

    /**
     * Finish a wave: pay building production exactly once, advance the wave
     * counter and return to Preparation. Returns the production that was paid.
     */
    completeWave(wave: number): Cost {
        const gained: Cost = {};
        if (wave > this.data.lastRewardedWave) {
            this.data.lastRewardedWave = wave;
            for (const b of this.data.buildings) {
                const p = this.production(b);
                for (const r in p) gained[r] = (gained[r] || 0) + p[r];
            }
        }
        this.data.highestWave = Math.max(this.data.highestWave, wave);
        this.data.currentWave = wave + 1;
        this.data.state = 'Preparation';
        this.add(gained);
        return gained;
    }
}
