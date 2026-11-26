import { ConfigMgr } from '../ConfigMgr';
import { Cost, TowerSave } from '../GameTypes';
import type { ResourceMgr } from '../ResourceMgr';
import { Placement } from '../state/Placement';

/** Defense towers outside the wall: limits, build / upgrade / move / destroy, target modes. */
export class TowerService {
    constructor(private rm: ResourceMgr) {}

    private get list(): TowerSave[] { return this.rm.data.towers; }

    tower(uid: number): TowerSave | null {
        for (const t of this.list) if (t.uid === uid) return t;
        return null;
    }

    get limit(): number { return ConfigMgr.buildingLevel('base', this.rm.baseLevel).towerLimit || 0; }

    /** Validate a tower foot position inside the construction area. */
    canPlace(x: number, y: number, ignoreUid = 0): boolean {
        return Placement.towerSpotOk(this.list, x, y, ignoreUid);
    }

    upgradeCost(t: TowerSave): Cost | null {
        const next = ConfigMgr.towerLevel(t.id, t.level + 1);
        return next ? next.upgradeCost : null;
    }

    /** Why the next upgrade of a tower is not possible yet (cost aside), or null. */
    upgradeBlock(t: TowerSave): string | null {
        if (!this.upgradeCost(t)) return 'Already at max level';
        if (t.level >= this.rm.baseLevel) return 'Upgrade the Base first';
        return null;
    }

    /** A tower that needs research first (tower.json "unlockKey" / "unlockTech"): why it cannot be built yet. */
    buildLock(id: string): string | null {
        const def = ConfigMgr.towerDef(id);
        if (!def || !def.unlockKey || this.rm.buff(def.unlockKey) > 0) return null;
        const t = def.unlockTech ? ConfigMgr.techDef(def.unlockTech) : null;
        return `Research "${t ? t.name : def.name}" first`;
    }

    build(id: string, x: number, y: number): string | null {
        const rm = this.rm;
        const def = ConfigMgr.towerDef(id);
        if (!rm.isPreparation) return 'Cannot build during combat';
        if (!def) return 'Unknown tower';
        const lock = this.buildLock(id);
        if (lock) return lock;
        if (this.list.length >= this.limit) return `Tower limit reached (${this.limit}). Upgrade the Base`;
        if (!this.canPlace(x, y)) return 'Invalid position';
        if (!rm.canAfford(def.buildCost)) return 'Not enough resources';
        this.list.push({ uid: rm.nextUid(), id, level: 1, x: Math.round(x), y: Math.round(y), targetMode: this.hasSmartTarget ? 'Smart' : ConfigMgr.tower.defaults.targetMode });
        rm.spend(def.buildCost);
        return null;
    }

    upgrade(uid: number): string | null {
        const rm = this.rm;
        const t = this.tower(uid);
        if (!rm.isPreparation) return 'Cannot upgrade during combat';
        if (!t) return 'Tower not found';
        const block = this.upgradeBlock(t);
        if (block) return block;
        const cost = this.upgradeCost(t)!;
        if (!rm.canAfford(cost)) return 'Not enough resources';
        t.level++;
        rm.spend(cost);
        return null;
    }

    move(uid: number, x: number, y: number): string | null {
        const t = this.tower(uid);
        if (!this.rm.isPreparation) return 'Cannot move during combat';
        if (!t) return 'Tower not found';
        if (!this.canPlace(x, y, uid)) return 'Invalid position';
        t.x = Math.round(x); t.y = Math.round(y);
        this.rm.notify();
        return null;
    }

    destroy(uid: number): string | null {
        const t = this.tower(uid);
        if (!this.rm.isPreparation) return 'Cannot destroy during combat';
        if (!t) return 'Tower not found';
        this.list.splice(this.list.indexOf(t), 1);
        this.rm.add(this.rm.refund(ConfigMgr.towerDef(t.id).buildCost));
        return null;
    }

    /** Smart Targeting research (Lab Lv 3). */
    get hasSmartTarget(): boolean { return this.rm.buff('smartTarget') > 0; }

    /** Target modes a tower can cycle through ("Smart" first once researched). */
    targetModes(): string[] {
        const base: string[] = ConfigMgr.tower.targetModes;
        return this.hasSmartTarget ? ['Smart'].concat(base) : base;
    }

    cycleTargetMode(uid: number): string {
        const t = this.tower(uid);
        const modes = this.targetModes();
        if (!t) return modes[0];
        t.targetMode = modes[(modes.indexOf(t.targetMode) + 1) % modes.length];
        this.rm.notify();
        return t.targetMode;
    }
}
