import { ConfigMgr } from '../ConfigMgr';
import { BuildingSave, Cost } from '../GameTypes';
import type { ResourceMgr } from '../ResourceMgr';
import { Placement } from '../state/Placement';

/** Buildings inside the castle: limits, production, build / upgrade / move / destroy. */
export class BuildingService {
    constructor(private rm: ResourceMgr) {}

    private get list(): BuildingSave[] { return this.rm.data.buildings; }

    building(uid: number): BuildingSave | null {
        for (const b of this.list) if (b.uid === uid) return b;
        return null;
    }

    get baseLevel(): number {
        for (const b of this.list) if (b.id === 'base') return b.level;
        return 1;
    }

    count(id: string): number { return this.list.filter(b => b.id === id).length; }

    maxCount(id: string): number {
        const def = ConfigMgr.buildingDef(id);
        if (!def || !def.buildable) return 0;
        return (def.maxCountBase || 0) + (def.maxCountPerBaseLevel || 0) * this.baseLevel;
    }

    canPlace(id: string, x: number, y: number, ignoreUid = 0): boolean {
        return !!ConfigMgr.buildingDef(id) && Placement.placementOk(this.list, id, x, y, ignoreUid);
    }

    /** Production of one building per wave, buffs included. */
    production(b: BuildingSave): Cost {
        const lv = ConfigMgr.buildingLevel(b.id, b.level);
        const out: Cost = {};
        if (lv && lv.production) {
            for (const r in lv.production) out[r] = Math.floor((lv.production[r] + this.rm.buff(r + 'ProductionFlat')) * (1 + this.rm.buff(r + 'Production') / 100));
        }
        return out;
    }

    upgradeCost(b: BuildingSave): Cost | null {
        const next = ConfigMgr.buildingLevel(b.id, b.level + 1);
        return next ? next.cost : null;
    }

    /** Part of a cost given back when something is destroyed. */
    refund(cost: Cost): Cost {
        const rate = ConfigMgr.building.destroyRefundRate;
        const out: Cost = {};
        for (const k in cost) out[k] = Math.floor(cost[k] * rate);
        return out;
    }

    /** Each mutating operation returns null on success or a reason string. */
    build(id: string, x: number, y: number): string | null {
        const rm = this.rm;
        const def = ConfigMgr.buildingDef(id);
        if (!rm.isPreparation) return 'Cannot build during combat';
        if (!def || !def.buildable) return 'This building cannot be built';
        if (this.count(id) >= this.maxCount(id)) return `Limit reached for ${def.name} (upgrade the Base)`;
        if (!this.canPlace(id, x, y)) return 'Invalid position';
        const cost = def.levels[0].cost;
        if (!rm.canAfford(cost)) return 'Not enough resources';
        this.list.push({ uid: rm.nextUid(), id, level: 1, x: Math.round(x), y: Math.round(y) });
        rm.spend(cost);
        return null;
    }

    upgrade(uid: number): string | null {
        const rm = this.rm;
        const b = this.building(uid);
        if (!rm.isPreparation) return 'Cannot upgrade during combat';
        if (!b) return 'Building not found';
        const cost = this.upgradeCost(b);
        if (!cost) return 'Already at max level';
        if (b.id !== 'base' && b.level >= this.baseLevel) return 'Upgrade the Base first';
        if (!rm.canAfford(cost)) return 'Not enough resources';
        b.level++;
        rm.spend(cost);
        return null;
    }

    move(uid: number, x: number, y: number): string | null {
        const b = this.building(uid);
        if (!this.rm.isPreparation) return 'Cannot move during combat';
        if (!b) return 'Building not found';
        if (ConfigMgr.buildingDef(b.id).fixed) return 'This building cannot be moved';
        if (!this.canPlace(b.id, x, y, uid)) return 'Invalid position';
        b.x = Math.round(x); b.y = Math.round(y);
        this.rm.notify();
        return null;
    }

    destroy(uid: number): string | null {
        const b = this.building(uid);
        if (!this.rm.isPreparation) return 'Cannot destroy during combat';
        if (!b) return 'Building not found';
        const def = ConfigMgr.buildingDef(b.id);
        if (def.fixed) return 'This building cannot be destroyed';
        this.list.splice(this.list.indexOf(b), 1);
        this.rm.add(this.refund(def.levels[0].cost)); // only the construction cost is refunded
        return null;
    }
}
