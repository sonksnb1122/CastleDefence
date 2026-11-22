import { Node, Graphics } from 'cc';
import { Assets } from '../core/Assets';
import { ConfigMgr } from '../core/ConfigMgr';
import { hex, mk, sprite } from './common/UIKit';

/**
 * Ground, defense area and castle wall of the battlefield (tower.json "battlefield").
 * Used by the battlefield screen and by the main menu background.
 */
export class BattlefieldGround {
    private bf = ConfigMgr.tower.battlefield;
    private groundG: Graphics;
    private groundLayer: Node;
    private areaG: Graphics;
    private wallLayer: Node;

    /** Adds its layers to `world` (call before adding towers / enemies so they stay behind). */
    constructor(world: Node, H: number) {
        this.groundG = world.getComponent(Graphics) || world.addComponent(Graphics);
        this.groundLayer = mk('Ground', world);
        this.areaG = mk('Area', world).addComponent(Graphics);
        this.wallLayer = mk('Wall', world);
        this.draw(H);
    }

    /** (Re)draw for a screen height (the wall always covers the full height). */
    draw(H: number) { this.drawGround(this.groundG, H); }

    private drawGround(g: Graphics, H: number) {
        const bf = this.bf, a = bf.constructionArea;
        // The wall always runs over the full screen height, whatever the resolution.
        const w = { x: bf.wall.x, width: bf.wall.width, y: 0, height: H };
        g.clear();
        const laneY = bf.enemyLaneY[0] - 34, laneH = bf.enemyLaneY[1] - bf.enemyLaneY[0] + 68;
        const textured = this.buildGroundSprites(w.x + w.width / 2, laneY, laneH, H);
        if (!textured) {
            // Fallback colors when the ground textures are missing.
            g.fillColor = hex('#5d8a45'); g.rect(0, 0, bf.worldWidth, H); g.fill();
            g.fillColor = hex('#6f7f6a'); g.rect(0, 0, w.x, H); g.fill();
            g.fillColor = hex('#c9a66b'); g.rect(w.x + w.width, laneY, bf.worldWidth, laneH); g.fill();
        }
        // Defense area: light tint and outline above the ground.
        const ag = this.areaG;
        ag.clear();
        ag.fillColor = hex('#ffffff', 34); ag.rect(a.x, a.y, a.width, a.height); ag.fill();
        ag.lineWidth = 3; ag.strokeColor = hex('#f4fbe8', 210); ag.rect(a.x, a.y, a.width, a.height); ag.stroke();
        // Wall: tiles cut from the castle map so it matches the wall seen inside the castle.
        if (this.buildWallSprites(w.x, w.width, H)) return;
        // Fallback when the wall texture is missing: wall with battlements drawn in code.
        g.fillColor = hex('#8c8f99'); g.rect(w.x, w.y, w.width, w.height); g.fill();
        g.fillColor = hex('#a9adb8');
        for (let y = w.y + 6; y < w.y + w.height; y += 34) g.rect(w.x + 5, y, w.width - 10, 22);
        g.fill();
        g.fillColor = hex('#6b6e78');
        for (let y = w.y; y < w.y + w.height; y += 34) g.rect(w.x + w.width - 6, y, 10, 18);
        g.fill();
        g.lineWidth = 3; g.strokeColor = hex('#2d2a33'); g.rect(w.x, w.y, w.width, w.height); g.stroke();
    }

    /**
     * Ground made of tiles cut from the castle map: grass everywhere, a sand
     * lane for the enemies from the wall to the right end, and tufted edge
     * strips where grass and sand meet. Returns false without art.
     */
    private buildGroundSprites(laneX: number, laneY: number, laneH: number, H: number): boolean {
        this.groundLayer.destroyAllChildren();
        const gc = this.bf.ground;
        if (!gc) return false;
        const k = gc.scale || 1;
        const get = (c: any) => (c && c.path ? Assets.frames(c.path, c.width, c.height) : []);
        const grass = get(gc.grass), sand = get(gc.sand), top = get(gc.edgeTop), bottom = get(gc.edgeBottom);
        if (grass.length === 0 || sand.length === 0) return false;
        const worldW = this.bf.worldWidth, laneTop = laneY + laneH;
        const tile = (f: any, c: any, x: number, y: number) => sprite(this.groundLayer, f, c.width * k + 0.5, c.height * k + 0.5, x, y, 0, 0);
        const gw = gc.grass.width * k, gh = gc.grass.height * k;
        const sw = gc.sand.width * k, sh = gc.sand.height * k;
        // The grass grid is aligned on the top of the lane so the grass drawn over the sand below lines up with it.
        const grassY0 = (laneTop % gh) - gh;
        const grassRows = (fromY: number) => {
            for (let y = fromY; y < H; y += gh) for (let x = 0; x < worldW; x += gw) tile(grass[0], gc.grass, x, y);
        };
        grassRows(grassY0);                                                    // 1. grass everywhere
        for (let y = laneY; y < laneTop; y += sh) for (let x = laneX; x < worldW; x += sw) tile(sand[0], gc.sand, x, y);   // 2. sand lane
        grassRows(laneTop);                                                    // 3. grass again above the lane hides the sand overflow
        // 4. tufted edges centered on both borders of the lane
        if (top.length > 0) for (let x = laneX; x < worldW; x += gc.edgeTop.width * k) sprite(this.groundLayer, top[0], gc.edgeTop.width * k + 0.5, gc.edgeTop.height * k, x, laneTop - gc.edgeTop.height * k / 2, 0, 0);
        if (bottom.length > 0) for (let x = laneX; x < worldW; x += gc.edgeBottom.width * k) sprite(this.groundLayer, bottom[0], gc.edgeBottom.width * k + 0.5, gc.edgeBottom.height * k, x, laneY - gc.edgeBottom.height * k / 2, 0, 0);
        return true;
    }

    /** Stack the seamless wall tile from the bottom to the top of the screen. Returns false without art. */
    private buildWallSprites(x: number, width: number, H: number): boolean {
        this.wallLayer.destroyAllChildren();
        const sp = this.bf.wall.sprite;
        const frames = sp && sp.path ? Assets.frames(sp.path, sp.width, sp.height) : [];
        if (frames.length === 0) return false;
        // The stone body of the tile is scaled to the configured wall width; its shadow hangs over the field side.
        const k = width / (sp.bodyWidth || sp.width);
        const tw = sp.width * k, th = sp.height * k;
        for (let y = 0; y < H; y += th - 0.5) sprite(this.wallLayer, frames[0], tw, th, x, y, 0, 0);
        return true;
    }
}
