/** Shared plain types used across the game. No engine dependency. */

export type Cost = { [resource: string]: number };
export type DamageType = 'physic' | 'magic';
export type GameState = 'Preparation' | 'Combat';

export const RESOURCE_KEYS = ['food', 'material', 'gold'];
export const SAVE_VERSION = 3;

export interface BuffEntry { key: string; value: number; towerId?: string; }

/** A castle building. x / y are the center of its footprint in castle-world pixels. */
export interface BuildingSave { uid: number; id: string; level: number; x: number; y: number; }
export interface TowerSave { uid: number; id: string; level: number; x: number; y: number; targetMode: string; }

/** Everything that is written into a save file. */
export interface SaveData {
    saveVersion: number;
    configVersion: number;
    savedAt: number;
    state: GameState;
    resources: { food: number; material: number; gold: number };
    /** Wave number that will be played next (1-based). */
    currentWave: number;
    highestWave: number;
    /** Last wave whose rewards were already paid (prevents double rewards). */
    lastRewardedWave: number;
    wallHp: number;
    nextUid: number;
    buildings: BuildingSave[];
    towers: TowerSave[];
    heroes: string[];
    heroRolls: { [heroId: string]: BuffEntry[] };
    research: { [techId: string]: number };
    /** Seed of the Market price changes (one random number per game). */
    marketSeed?: number;
}

/** Result of one damage calculation (see CombatManager). */
export interface DamageResult { amount: number; crit: boolean; dodged: boolean; }

/** Snapshot of a tower's effective stats at the moment it fires. */
export interface ShotInfo {
    towerUid: number;
    towerId: string;
    level: number;
    damage: number;
    damageTypes: DamageType[];
    explosionRange: number;
    critRate: number;
    critDamage: number;
    effects: any[];
    /** True for towers whose explosion counts as area damage. */
    isAoe: boolean;
}
