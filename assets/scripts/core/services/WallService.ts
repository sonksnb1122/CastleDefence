import { ConfigMgr } from '../ConfigMgr';
import { Cost, DamageType } from '../GameTypes';
import type { ResourceMgr } from '../ResourceMgr';

/** The castle wall: max HP and defense (buffs included), damage and repairs. */
export class WallService {
    constructor(private rm: ResourceMgr) {}

    maxHp(): number {
        return Math.floor(ConfigMgr.building.wall.hp * (1 + this.rm.buff('wallHp') / 100));
    }

    def(type: DamageType): number {
        const w = ConfigMgr.building.wall;
        const base = type === 'physic' ? w.physicDef : w.magicDef;
        return Math.min(w.maxDef, base + this.rm.buff('wallDef'));
    }

    /** Apply damage to the wall. Returns true when the wall is destroyed. */
    damage(amount: number): boolean {
        const d = this.rm.data;
        d.wallHp = Math.max(0, d.wallHp - amount);
        return d.wallHp <= 0;
    }

    repairCost(): Cost {
        const missing = this.maxHp() - this.rm.data.wallHp;
        const wall = ConfigMgr.building.wall;
        const per = wall.repairCostPerHp || {};
        // Repairs get more expensive with every Base level (wall.repairCostMul, one value per level).
        const muls: number[] = wall.repairCostMul || [];
        const mul = muls.length ? muls[Math.min(muls.length, this.rm.baseLevel) - 1] : 1;
        const out: Cost = {};
        for (const k in per) out[k] = Math.ceil(missing * per[k] * mul);
        return out;
    }

    repair(): string | null {
        const rm = this.rm;
        if (!rm.isPreparation) return 'Cannot repair during combat';
        if (rm.data.wallHp >= this.maxHp()) return 'Wall is already at full HP';
        const cost = this.repairCost();
        if (!rm.canAfford(cost)) return 'Not enough resources';
        rm.data.wallHp = this.maxHp();
        rm.spend(cost);
        return null;
    }

    /**
     * Run a change that may raise the max HP (research, heroes) so the wall
     * keeps the HP it gained.
     */
    keepGain(change: () => void) {
        const before = this.maxHp();
        change();
        this.rm.data.wallHp += Math.max(0, this.maxHp() - before);
    }
}
