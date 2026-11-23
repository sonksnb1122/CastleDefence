import { BuffEntry, BuildingSave, Cost, DamageType, RESOURCE_KEYS, SaveData, TowerSave } from './GameTypes';
import { BuffService } from './services/BuffService';
import { BuildingService } from './services/BuildingService';
import { HeroService } from './services/HeroService';
import { ResearchService } from './services/ResearchService';
import { TowerService } from './services/TowerService';
import { TradeService } from './services/TradeService';
import { WallService } from './services/WallService';
import { Placement } from './state/Placement';
import { SaveCodec } from './state/SaveCodec';

/**
 * Singleton that owns the player progress (`data`, which is what gets saved),
 * the resource wallet and the change events. The rules live in small services:
 *   buildings, towers, wall, research, heroes, buffs, trade  (core/services)
 *   placement geometry and save validation           (core/state)
 * The methods below keep the old API by forwarding to those services.
 */
export class ResourceMgr {
    private static _inst: ResourceMgr | null = null;
    static get inst(): ResourceMgr {
        if (!ResourceMgr._inst) ResourceMgr._inst = new ResourceMgr();
        return ResourceMgr._inst;
    }

    data: SaveData = null as any;
    private listeners: Array<() => void> = [];

    readonly buffs = new BuffService(this);
    readonly buildings = new BuildingService(this);
    readonly towers = new TowerService(this);
    readonly wall = new WallService(this);
    readonly research = new ResearchService(this);
    readonly heroes = new HeroService(this);
    readonly trade = new TradeService(this);

    // ------------------------------------------------------------------ events
    /** Register a callback fired whenever progress data changes. Returns an unsubscribe function. */
    onChange(fn: () => void): () => void {
        this.listeners.push(fn);
        return () => { const i = this.listeners.indexOf(fn); if (i >= 0) this.listeners.splice(i, 1); };
    }
    notify() {
        this.buffs.invalidate();
        for (const fn of this.listeners.slice()) fn();
    }

    // ------------------------------------------------------------------ new game / save / load
    newGame() {
        this.data = SaveCodec.newGame(BuffService.rollAllHeroes());
        this.buffs.invalidate();
        this.data.wallHp = this.wallMaxHp();
        this.notify();
    }

    /** Plain object ready for JSON.stringify. */
    serialize(): SaveData { return SaveCodec.serialize(this.data); }

    /** Validate a raw save object (never touches the current data). */
    static parse(raw: any): { data?: SaveData; error?: string } { return SaveCodec.parse(raw); }

    /** Replace current progress with validated save data. */
    apply(d: SaveData) {
        this.data = d;
        this.buffs.invalidate();
        // Heroes added to the config after the save was written still need buff rolls.
        const fresh = BuffService.rollAllHeroes();
        for (const id in fresh) if (!d.heroRolls[id]) d.heroRolls[id] = fresh[id];
        const max = this.wallMaxHp();
        if (d.wallHp <= 0 || d.wallHp > max) d.wallHp = max;
        this.notify();
    }

    /** Next unique id for a building or tower. */
    nextUid(): number { return this.data.nextUid++; }

    // ------------------------------------------------------------------ resources (wallet)
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

    // ------------------------------------------------------------------ forwarding (old API)
    // buffs
    buff(key: string, towerId?: string): number { return this.buffs.buff(key, towerId); }
    heroBuffs(heroId: string): BuffEntry[] { return this.buffs.heroBuffs(heroId); }
    activeBuffLines(fromHeroesOnly: boolean): string[] { return this.buffs.activeBuffLines(fromHeroesOnly); }

    // placement geometry
    static castleArea() { return Placement.castleArea(); }
    static castleCenter() { return Placement.castleCenter(); }
    static buildingSize(id: string) { return Placement.buildingSize(id); }
    static placementOk(list: BuildingSave[], id: string, x: number, y: number, ignoreUid: number) { return Placement.placementOk(list, id, x, y, ignoreUid); }
    static freeSpot(list: BuildingSave[], id: string) { return Placement.freeSpot(list, id); }
    static towerSpotOk(list: TowerSave[], x: number, y: number, ignoreUid: number) { return Placement.towerSpotOk(list, x, y, ignoreUid); }
    static nearestTowerSpot(list: TowerSave[], x: number, y: number) { return Placement.nearestTowerSpot(list, x, y); }

    // castle buildings
    building(uid: number) { return this.buildings.building(uid); }
    get baseLevel(): number { return this.buildings.baseLevel; }
    countBuildings(id: string) { return this.buildings.count(id); }
    maxBuildingCount(id: string) { return this.buildings.maxCount(id); }
    canPlaceBuilding(id: string, x: number, y: number, ignoreUid = 0) { return this.buildings.canPlace(id, x, y, ignoreUid); }
    production(b: BuildingSave) { return this.buildings.production(b); }
    buildingUpgradeCost(b: BuildingSave) { return this.buildings.upgradeCost(b); }
    buildBuilding(id: string, x: number, y: number) { return this.buildings.build(id, x, y); }
    upgradeBuilding(uid: number) { return this.buildings.upgrade(uid); }
    moveBuilding(uid: number, x: number, y: number) { return this.buildings.move(uid, x, y); }
    destroyBuilding(uid: number) { return this.buildings.destroy(uid); }
    refund(cost: Cost) { return this.buildings.refund(cost); }

    // defense towers
    tower(uid: number) { return this.towers.tower(uid); }
    get towerLimit(): number { return this.towers.limit; }
    canPlaceTower(x: number, y: number, ignoreUid = 0) { return this.towers.canPlace(x, y, ignoreUid); }
    towerUpgradeCost(t: TowerSave) { return this.towers.upgradeCost(t); }
    towerUpgradeBlock(t: TowerSave) { return this.towers.upgradeBlock(t); }
    buildTower(id: string, x: number, y: number) { return this.towers.build(id, x, y); }
    upgradeTower(uid: number) { return this.towers.upgrade(uid); }
    moveTower(uid: number, x: number, y: number) { return this.towers.move(uid, x, y); }
    destroyTower(uid: number) { return this.towers.destroy(uid); }
    get hasSmartTarget(): boolean { return this.towers.hasSmartTarget; }
    targetModes() { return this.towers.targetModes(); }
    cycleTargetMode(uid: number) { return this.towers.cycleTargetMode(uid); }

    // castle wall
    wallMaxHp() { return this.wall.maxHp(); }
    wallDef(type: DamageType) { return this.wall.def(type); }
    damageWall(amount: number) { return this.wall.damage(amount); }
    wallRepairCost() { return this.wall.repairCost(); }
    repairWall() { return this.wall.repair(); }

    // research
    techLevel(id: string) { return this.research.level(id); }
    get maxTechLevel(): number { return this.research.maxTechLevel; }
    get labLevel(): number { return this.research.labLevel; }
    static isEndless(t: any) { return ResearchService.isEndless(t); }
    techLock(id: string) { return this.research.lock(id); }
    techCost(id: string) { return this.research.cost(id); }
    techBlock(id: string) { return this.research.block(id); }
    doResearch(id: string) { return this.research.research(id); }

    // heroes
    ownsHero(id: string) { return this.heroes.owns(id); }
    get heroLimit(): number { return this.heroes.limit; }
    recruitCost() { return this.heroes.recruitCost(); }
    recruitHero() { return this.heroes.recruit(); }
}
