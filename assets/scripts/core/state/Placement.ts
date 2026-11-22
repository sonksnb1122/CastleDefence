import { ConfigMgr } from '../ConfigMgr';
import { BuildingSave, TowerSave } from '../GameTypes';

/**
 * Geometry rules for placing buildings inside the castle and towers in the
 * defense area. Pure functions on save data (no state of their own).
 */
export class Placement {
    // ------------------------------------------------------------------ castle buildings
    /** Build area in castle-world pixels (map pixels * map scale). */
    static castleArea(): { x: number; y: number; width: number; height: number } {
        const m = ConfigMgr.building.map;
        const a = m.buildArea, s = m.scale || 1;
        return { x: a.x * s, y: a.y * s, width: a.width * s, height: a.height * s };
    }

    static castleCenter(): { x: number; y: number } {
        const a = Placement.castleArea();
        return { x: Math.round(a.x + a.width / 2), y: Math.round(a.y + a.height / 2) };
    }

    /** Side of the square footprint of a building in castle-world pixels. */
    static buildingSize(id: string): number {
        const def = ConfigMgr.buildingDef(id);
        return ((def && def.footprint) || 128) * (ConfigMgr.building.map.buildingScale || 1);
    }

    /** True when the footprint centered on (x,y) is inside the build area and touches no other building. */
    static placementOk(list: BuildingSave[], id: string, x: number, y: number, ignoreUid: number): boolean {
        const a = Placement.castleArea();
        const half = Placement.buildingSize(id) / 2;
        if (x - half < a.x || x + half > a.x + a.width || y - half < a.y || y + half > a.y + a.height) return false;
        const gap = ConfigMgr.building.map.minGap || 0;
        for (const b of list) {
            if (b.uid === ignoreUid) continue;
            const reach = half + Placement.buildingSize(b.id) / 2 + gap;
            if (Math.abs(b.x - x) < reach && Math.abs(b.y - y) < reach) return false;
        }
        return true;
    }

    /** First free position on rings around the base (used when a saved position is not valid). */
    static freeSpot(list: BuildingSave[], id: string): { x: number; y: number } | null {
        const c = Placement.castleCenter();
        const step = Placement.buildingSize(id) + (ConfigMgr.building.map.minGap || 0) + 16;
        for (let ring = 1; ring < 12; ring++) {
            for (let iy = -ring; iy <= ring; iy++) {
                for (let ix = -ring; ix <= ring; ix++) {
                    if (Math.max(Math.abs(ix), Math.abs(iy)) !== ring) continue;
                    const x = c.x + ix * step, y = c.y + iy * step;
                    if (Placement.placementOk(list, id, x, y, 0)) return { x, y };
                }
            }
        }
        return null;
    }

    // ------------------------------------------------------------------ defense towers
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
                if (d < bestD && Placement.towerSpotOk(list, px, py, 0)) { bestD = d; best = { x: px, y: py }; }
            }
        }
        return best;
    }
}
