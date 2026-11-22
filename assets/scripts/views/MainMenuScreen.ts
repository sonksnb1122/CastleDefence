import { Node } from 'cc';
import { CombatEvents, CombatManager } from '../combat/CombatManager';
import { TowerUnit } from '../combat/TowerUnit';
import { ConfigMgr } from '../core/ConfigMgr';
import { G } from '../core/Globals';
import { TopBar } from './common/TopBar';
import { MainMenuView } from './screens/MainMenuView';
import { PrefabButton, PrefabUi } from './common/PrefabUi';
import { mk } from './common/UIKit';
import { BattlefieldGround } from './BattlefieldGround';

/** Settings of the menu background battle (balanced so a few enemies always reach the wall). */
export const DEMO = {
    resources: 999999,
    towerLevel: 3,
    /** Columns from the wall to the left: 2 crossbow, 2 crystal, 2 catapult. */
    columns: ['crossbow', 'crossbow', 'crystal', 'crystal', 'catapult', 'catapult'],
    towersPerColumn: 4,
    /** Vertical offset of every other column so the rows look staggered. */
    stagger: 40,
    /** Seconds between spawns (randomised +-40%). */
    spawnInterval: 0.25,
    /** Enemy HP and speed multipliers: just above what 24 level 3 towers can hold, so some get through. */
    hpMul: 95,
    speedMul: 5,
    /** Seconds simulated before the menu shows, so the field is already busy. */
    prewarm: 14,
};

/**
 * Title screen: New Game, Load Game, Setting, Quit Game (prefabs/screens/MainMenu),
 * drawn over a fake battle (towers firing at an endless horde) covered by a dark veil.
 */
export class MainMenuScreen implements CombatEvents {
    root: Node;
    private combat: CombatManager | null = null;
    private topBar: TopBar | null = null;
    private spawnTimer = 0;
    private enemyIds: string[] = [];

    constructor(parent: Node) {
        const W = G.main.W, H = G.main.H;
        this.root = mk('MainMenu', parent, 0, 0, W, H);
        this.buildDemo(W, H);

        // Veil, title and buttons come from the prefab, on top of the demo battle.
        const v = PrefabUi.view('screens/MainMenu', this.root, MainMenuView);
        new PrefabButton(v.newGameButton, () => G.main.newGame());
        new PrefabButton(v.loadButton, () => G.main.openOverlay('load'));
        new PrefabButton(v.settingsButton, () => G.main.openOverlay('settings'));
        new PrefabButton(v.quitButton, () => G.main.quitGame());
        if (v.warnings) v.warnings.string = ConfigMgr.warnings.slice(0, 4).join('\n');
    }

    /** Battlefield with level 3 towers and an endless horde. Never touches the player's data. */
    private buildDemo(W: number, H: number) {
        const bf = ConfigMgr.tower.battlefield;
        const world = mk('DemoWorld', this.root, -W / 2, -H / 2, bf.worldWidth, H, 0, 0);
        new BattlefieldGround(world, H);
        const towerLayer = mk('Towers', world);
        const enemyLayer = mk('Enemies', world);
        const fxLayer = mk('Fx', world);
        const textLayer = mk('Texts', world);
        const combat = new CombatManager(enemyLayer, fxLayer, textLayer, this);
        combat.demo = true;
        combat.active = true;

        // Columns spread evenly over the defense area, closest to the wall first.
        const a = bf.constructionArea;
        const cols = DEMO.columns.length, rows = DEMO.towersPerColumn;
        const marginX = 24, marginY = 16;
        const stepX = (a.width - marginX * 2) / Math.max(1, cols - 1);
        const stepY = (a.height - marginY * 2 - DEMO.stagger) / Math.max(1, rows - 1);
        const saves: any[] = [];
        let uid = -1;
        DEMO.columns.forEach((id, c) => {
            if (!ConfigMgr.towerDef(id)) return;
            const level = Math.min(DEMO.towerLevel, ConfigMgr.towerDef(id).levels.length);
            const x = a.x + a.width - marginX - c * stepX;
            const off = c % 2 === 1 ? DEMO.stagger : 0;
            for (let r = 0; r < rows; r++) saves.push({ uid: uid--, id, level, x: Math.round(x), y: Math.round(a.y + marginY + off + r * stepY), targetMode: 'Smart' });
        });
        // Towers lower on the screen are drawn in front.
        saves.sort((p, q) => q.y - p.y);
        for (const s of saves) combat.towers.push(new TowerUnit(towerLayer, s, true));

        this.enemyIds = (ConfigMgr.enemy.enemies as any[]).map(e => e.id);
        this.combat = combat;
        this.topBar = new TopBar(this.root, false, DEMO.resources);
        for (let t = 0; t < DEMO.prewarm; t += 0.05) this.step(0.05);
    }

    // The demo battle never clears, never damages the wall and never ends.
    onWallChanged() { /* immortal wall */ }
    onWaveCleared(_wave: number, _gold: number) { /* endless */ }
    onGameOver(_wave: number) { /* immortal wall */ }

    update(dt: number) {
        if (!this.combat) return;
        this.step(Math.min(dt, 0.05));
    }

    private step(step: number) {
        if (!this.combat) return;
        this.spawnTimer -= step;
        while (this.spawnTimer <= 0 && this.enemyIds.length > 0) {
            this.spawnTimer += DEMO.spawnInterval * (0.6 + Math.random() * 0.8);
            const id = this.enemyIds[Math.floor(Math.random() * this.enemyIds.length)];
            this.combat.spawnDemo(id, DEMO.hpMul, DEMO.speedMul);
        }
        this.combat.update(step);
    }

    destroy() {
        if (this.combat) this.combat.clear();
        if (this.topBar) this.topBar.destroy();
        this.root.destroy();
    }
}
