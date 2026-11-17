import { Node, Graphics, EventTouch, EventMouse, Vec3, Label, UITransform } from 'cc';
import { CombatEvents, CombatManager } from '../combat/CombatManager';
import { TowerUnit } from '../combat/TowerUnit';
import { WaveMgr } from '../combat/WaveMgr';
import { Assets } from '../core/Assets';
import { ConfigMgr } from '../core/ConfigMgr';
import { G } from '../core/Globals';
import { ResourceMgr } from '../core/ResourceMgr';
import { TopBar, arcMenu } from '../ui/TopBar';
import { Bar, COLORS, UIButton, button, confirm, hex, message, mk, panel, setVisible, sprite, text, toLocal, toast } from '../ui/UIKit';
import { infoWindow } from './Overlays';

/**
 * Outside the castle: the defense construction area, the wall and the field
 * where waves of enemies arrive from the right. The view scrolls horizontally.
 */
export class OutCastleScreen implements CombatEvents {
    root: Node;
    private rm = ResourceMgr.inst;
    private bf = ConfigMgr.tower.battlefield;
    private topBar: TopBar;
    private world: Node;
    private towerLayer: Node;
    private menuLayer: Node;
    private ghost: Node;
    private ghostG: Graphics;
    private combat: CombatManager;
    private camX = 0;
    private dragDist = 0;
    private selectedUid = 0;
    /** Placement mode: building a new tower (id) or moving one (uid). */
    private placing: { id: string; uid: number } | null = null;
    private speed = 1;
    private finished = false;
    private tmp = new Vec3();

    private enterBtn: UIButton;
    private startBtn: UIButton;
    private speedBtn: UIButton;
    private cancelBtn: UIButton;
    private repairBtn: UIButton;
    private buildBar: Node;
    private buildBtns: Array<{ id: string; btn: UIButton }> = [];
    private wallBar: Bar;
    private wallLabel: Label;
    private waveInfo: Label;
    private towerInfo: Label;
    private unsubscribe: () => void;
    private groundG: Graphics;
    private wallLayer: Node = null as any;
    private groundLayer: Node = null as any;
    private areaG: Graphics = null as any;

    constructor(parent: Node) {
        const W = G.main.W, H = G.main.H;
        const bf = this.bf;
        this.root = mk('OutCastle', parent);

        // ---- scrolling world (origin = bottom-left corner of the battlefield)
        this.world = mk('World', this.root, -W / 2, -H / 2, bf.worldWidth, H, 0, 0);
        this.groundG = this.world.addComponent(Graphics);
        this.groundLayer = mk('Ground', this.world);
        this.areaG = mk('Area', this.world).addComponent(Graphics);
        this.wallLayer = mk('Wall', this.world);
        this.drawGround(this.groundG, H);
        text(this.world, 'DEFENSE AREA', 14, bf.constructionArea.x + bf.constructionArea.width / 2, bf.constructionArea.y + bf.constructionArea.height + 12, { color: '#1f3d14', bold: true });
        text(this.world, 'ENEMIES COME FROM HERE  >>>', 13, bf.worldWidth - 150, bf.enemyLaneY[1] + 60, { color: '#1f3d14', bold: true });

        this.towerLayer = mk('Towers', this.world);
        const enemyLayer = mk('Enemies', this.world);
        const fxLayer = mk('Fx', this.world);
        const textLayer = mk('Texts', this.world);
        this.ghost = mk('Ghost', this.world);
        this.ghostG = this.ghost.addComponent(Graphics);
        this.ghost.active = false;
        this.menuLayer = mk('Menus', this.world);
        this.combat = new CombatManager(enemyLayer, fxLayer, textLayer, this);

        this.world.on(Node.EventType.TOUCH_START, () => { this.dragDist = 0; }, this);
        this.world.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => this.onDrag(e), this);
        this.world.on(Node.EventType.TOUCH_END, (e: EventTouch) => { if (this.dragDist < 10) this.onTap(e.getUILocation().x, e.getUILocation().y); }, this);
        this.world.on(Node.EventType.MOUSE_MOVE, (e: EventMouse) => this.onHover(e.getUILocation().x, e.getUILocation().y), this);

        // ---- HUD (fixed on screen)
        this.topBar = new TopBar(this.root);
        // Dark strip so the wall status stays readable on the bright grass.
        panel(this.root, -W / 2 + 264, H / 2 - 56, 540, 28, '#1b1626', null, 170);
        text(this.root, 'Wall', 14, -W / 2 + 14, H / 2 - 56, { ax: 0, bold: true });
        this.wallBar = new Bar(this.root, -W / 2 + 150, H / 2 - 56, 180, 12, '#6ad66a');
        this.wallLabel = text(this.root, '', 13, -W / 2 + 250, H / 2 - 56, { ax: 0 });
        this.repairBtn = button(this.root, 'Repair', -W / 2 + 470, H / 2 - 58, 86, 28, () => this.repairWall(), COLORS.button, 13);

        this.enterBtn = button(this.root, '< Enter Castle', W / 2 - 86, H / 2 - 66, 156, 40, () => G.main.goto('inCastle'), COLORS.buttonOk, 17);
        this.startBtn = button(this.root, 'Start Wave', W / 2 - 96, -H / 2 + 30, 176, 44, () => this.startWave(), COLORS.buttonDanger, 18);
        this.waveInfo = text(this.root, '', 14, W / 2 - 10, -H / 2 + 66, { ax: 1, color: '#1b1626', bold: true });
        button(this.root, 'Menu', -W / 2 + 56, -H / 2 + 30, 96, 40, () => G.main.openOverlay('pause'), COLORS.buttonAlt, 17);
        this.speedBtn = button(this.root, 'x1', -W / 2 + 140, -H / 2 + 30, 56, 40, () => this.cycleSpeed(), COLORS.button, 17);
        this.towerInfo = text(this.root, '', 14, -W / 2 + 180, -H / 2 + 66, { ax: 0, color: '#1b1626', bold: true });
        this.cancelBtn = button(this.root, 'Cancel placement', 0, -H / 2 + 30, 200, 40, () => this.stopPlacing(), COLORS.buttonDanger, 16);
        this.cancelBtn.setVisible(false);

        // Tower build buttons (data from tower.json).
        this.buildBar = mk('BuildBar', this.root, 20, -H / 2 + 30);
        const towers: any[] = ConfigMgr.tower.towers;
        towers.forEach((t, i) => {
            const x = (i - (towers.length - 1) / 2) * 172;
            const btn = button(this.buildBar, '', x, 0, 164, 44, () => this.startPlacing(t.id, 0), COLORS.button, 13);
            btn.setText(`${t.name}\n${ResourceMgr.costText(t.buildCost)}`);
            btn.label.lineHeight = 16;
            this.buildBtns.push({ id: t.id, btn });
        });

        this.rebuildTowers();
        this.unsubscribe = this.rm.onChange(() => this.refreshHud());
        this.refreshHud();
        this.setCamera(0);
    }

    // ------------------------------------------------------------------ ground art (placeholder, drawn in code)
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

    // ------------------------------------------------------------------ towers
    private rebuildTowers() {
        this.towerLayer.destroyAllChildren();
        this.combat.towers.length = 0;
        // Lower towers are drawn in front of higher ones.
        const saves = this.rm.data.towers.slice().sort((a, b) => b.y - a.y);
        for (const s of saves) this.combat.towers.push(new TowerUnit(this.towerLayer, s));
        if (this.selectedUid && !this.rm.tower(this.selectedUid)) this.selectedUid = 0;
        this.showMenu();
    }

    private towerUnit(uid: number): TowerUnit | null {
        for (const t of this.combat.towers) if (t.uid === uid) return t;
        return null;
    }

    private showMenu() {
        this.menuLayer.destroyAllChildren();
        for (const t of this.combat.towers) t.showRange(t.uid === this.selectedUid && !this.placing);
        const unit = this.towerUnit(this.selectedUid);
        if (!unit || this.placing) return;
        const uid = unit.uid;
        const prep = this.rm.isPreparation;
        const items = [
            { label: 'Upgrade', color: COLORS.buttonOk, onClick: () => this.upgradeTower(uid), enabled: prep },
            { label: 'Move', onClick: () => this.startPlacing(unit.save.id, uid), enabled: prep },
            { label: 'Target', color: COLORS.button, onClick: () => { const m = this.rm.cycleTargetMode(uid); toast(this.root, 'Target mode: ' + m, true); unit.target = null; } },
            { label: 'Info', onClick: () => this.towerInfoWindow(unit) },
            { label: 'Destroy', color: COLORS.buttonDanger, onClick: () => this.destroyTower(uid), enabled: prep },
        ];
        const below = unit.save.y > 170;
        arcMenu(this.menuLayer, unit.save.x, below ? unit.save.y + 6 : unit.cy + 30, items, below, 86);
    }

    private upgradeTower(uid: number) {
        const t = this.rm.tower(uid);
        if (!t) return;
        const def = ConfigMgr.towerDef(t.id);
        const cost = this.rm.towerUpgradeCost(t);
        if (!cost) { toast(this.root, 'Already at max level'); return; }
        const next = ConfigMgr.towerLevel(t.id, t.level + 1);
        const body = `Upgrade to level ${t.level + 1}?\nDamage ${next.damage}, ${next.attackSpeed}/s, range ${next.attackRange}\n\nCost: ${ResourceMgr.costText(cost)}`;
        confirm(this.root, `Upgrade ${def.name}`, body, () => {
            const err = this.rm.upgradeTower(uid);
            toast(this.root, err || `${def.name} upgraded`, !err);
            if (!err) this.rebuildTowers();
        });
    }

    private destroyTower(uid: number) {
        const t = this.rm.tower(uid);
        if (!t) return;
        const def = ConfigMgr.towerDef(t.id);
        confirm(this.root, `Destroy ${def.name}`, `Destroy this tower?\n\nRefund: ${ResourceMgr.costText(this.rm.refund(def.buildCost))}\n(upgrade costs are not refunded)`, () => {
            const err = this.rm.destroyTower(uid);
            if (err) toast(this.root, err);
            else this.rebuildTowers();
        }, 'Destroy');
    }

    private towerInfoWindow(unit: TowerUnit) {
        const s = unit.stats();
        const def = unit.def;
        const r1 = (v: number) => Math.round(v * 100) / 100;
        const lines = [
            def.description, '',
            `Level: ${unit.save.level} / ${def.levels.length}`,
            `Damage type: ${def.damageTypes.join(' + ')}`,
            `Damage: ${r1(s.damage)}   (base ${unit.lv.damage})`,
            `Attack speed: ${r1(s.attackSpeed)} / s`,
            `Attack range: ${Math.round(s.range)} px`,
            `Explosion range: ${Math.round(s.explosion)} px${def.explosionBuffable ? '' : ' (fixed)'}`,
            `Crit: ${r1(s.critRate)}%  x${r1(s.critDamage)}%`,
            `Target mode: ${unit.save.targetMode}`,
        ];
        const effects = (unit.lv.effects || []).map((e: any) => `${ConfigMgr.towerEffectDef(e.id).name} ${e.enabled ? '(on)' : '(off)'}`);
        if (effects.length) lines.push('Effects: ' + effects.join(', '));
        const cost = this.rm.towerUpgradeCost(unit.save);
        lines.push(cost ? `Upgrade cost: ${ResourceMgr.costText(cost)}` : 'Max level reached');
        infoWindow(this.root, def.name, lines);
    }

    // ------------------------------------------------------------------ placement
    private startPlacing(id: string, uid: number) {
        if (!this.rm.isPreparation) return;
        if (!uid) {
            if (this.rm.data.towers.length >= this.rm.towerLimit) { toast(this.root, `Tower limit reached (${this.rm.towerLimit}). Upgrade the Base`); return; }
            if (!this.rm.canAfford(ConfigMgr.towerDef(id).buildCost)) { toast(this.root, 'Not enough resources'); return; }
        }
        this.placing = { id, uid };
        setVisible(this.buildBar, false);
        this.cancelBtn.setVisible(true);
        this.setCamera(0);
        this.showMenu();
        toast(this.root, 'Tap inside the defense area to place the tower', true);
    }

    private stopPlacing() {
        this.placing = null;
        this.ghost.active = false;
        this.cancelBtn.setVisible(false);
        this.refreshHud();
        this.showMenu();
    }

    private drawGhost(x: number, y: number) {
        if (!this.placing) return;
        const ok = this.rm.canPlaceTower(x, y, this.placing.uid);
        const def = ConfigMgr.towerDef(this.placing.id);
        const g = this.ghostG;
        this.ghost.active = true;
        this.ghost.setPosition(x, y, 0);
        g.clear();
        g.fillColor = hex(ok ? '#58d26a' : '#e05252', 130);
        const s = this.bf.towerScale || 1;
        const lv = ConfigMgr.towerLevel(this.placing.id, this.placing.uid ? this.rm.tower(this.placing.uid)!.level : 1);
        g.rect(-28 * s, 0, 56 * s, 100 * s);
        g.fill();
        g.lineWidth = 2;
        g.strokeColor = hex('#ffffff', 140);
        g.circle(0, lv.sprite.weaponY * s, lv.attackRange);
        g.stroke();
    }

    private tryPlace(x: number, y: number) {
        const p = this.placing!;
        const err = p.uid ? this.rm.moveTower(p.uid, x, y) : this.rm.buildTower(p.id, x, y);
        if (err) { toast(this.root, err); this.drawGhost(x, y); return; }
        this.stopPlacing();
        this.rebuildTowers();
    }

    // ------------------------------------------------------------------ input
    private setCamera(x: number) {
        const max = Math.max(0, this.bf.worldWidth - G.main.W);
        this.camX = Math.max(0, Math.min(max, x));
        this.world.setPosition(-G.main.W / 2 - this.camX, -G.main.H / 2, 0);
    }

    private onDrag(e: EventTouch) {
        const d = e.getUIDelta();
        this.dragDist += Math.abs(d.x) + Math.abs(d.y);
        if (this.placing) { this.onHover(e.getUILocation().x, e.getUILocation().y); return; }
        this.setCamera(this.camX - d.x);
    }

    private onHover(uiX: number, uiY: number) {
        if (!this.placing) return;
        toLocal(this.world, uiX, uiY, this.tmp);
        this.drawGhost(this.tmp.x, this.tmp.y);
    }

    private onTap(uiX: number, uiY: number) {
        toLocal(this.world, uiX, uiY, this.tmp);
        const x = this.tmp.x, y = this.tmp.y;
        if (this.placing) { this.tryPlace(x, y); return; }
        let picked = 0;
        // Towers lower on the screen are in front, so test them first.
        const units = this.combat.towers.slice().sort((a, b) => a.save.y - b.save.y);
        for (const t of units) if (t.contains(x, y)) { picked = t.uid; break; }
        this.selectedUid = picked;
        this.showMenu();
    }

    // ------------------------------------------------------------------ HUD
    private refreshHud() {
        const rm = this.rm;
        const prep = rm.isPreparation;
        const max = rm.wallMaxHp();
        this.wallBar.set(rm.data.wallHp / max, rm.data.wallHp / max < 0.35 ? '#e05252' : '#6ad66a');
        this.wallLabel.string = `${Math.ceil(rm.data.wallHp)} / ${max}   DEF ${rm.wallDef('physic')}/${rm.wallDef('magic')}`;
        this.repairBtn.setVisible(prep && rm.data.wallHp < max);
        if (this.repairBtn.node.active) this.repairBtn.setEnabled(rm.canAfford(rm.wallRepairCost()));
        this.enterBtn.setVisible(prep && !this.placing);
        this.startBtn.setVisible(prep && !this.placing);
        this.startBtn.setText('Start Wave ' + rm.data.currentWave);
        const showBuild = prep && !this.placing;
        if (this.buildBar.active !== showBuild) setVisible(this.buildBar, showBuild);
        for (const b of this.buildBtns) b.btn.setEnabled(rm.canAfford(ConfigMgr.towerDef(b.id).buildCost) && rm.data.towers.length < rm.towerLimit);
        this.towerInfo.string = `Towers ${rm.data.towers.length}/${rm.towerLimit}`;
        if (prep) this.waveInfo.string = 'Next: ' + WaveMgr.summary(rm.data.currentWave);
    }

    private repairWall() {
        const cost = this.rm.wallRepairCost();
        confirm(this.root, 'Repair Wall', `Restore the wall to full HP?\n\nCost: ${ResourceMgr.costText(cost)}`, () => {
            const err = this.rm.repairWall();
            toast(this.root, err || 'Wall repaired', !err);
        });
    }

    private cycleSpeed() {
        this.speed = this.speed >= 3 ? 1 : this.speed + 1;
        this.speedBtn.setText('x' + this.speed);
    }

    // ------------------------------------------------------------------ waves
    private startWave() {
        if (!this.rm.isPreparation || this.placing) return;
        if (this.rm.data.towers.length === 0) {
            confirm(this.root, 'No towers', 'You have no defense tower.\nStart the wave anyway?', () => this.beginCombat());
            return;
        }
        this.beginCombat();
    }

    private beginCombat() {
        this.selectedUid = 0;
        this.rm.beginCombat();
        this.combat.startWave(this.rm.data.currentWave);
        this.showMenu();
        toast(this.root, this.combat.plan!.name, true);
    }

    onWallChanged() { this.refreshHud(); }

    onWaveCleared(wave: number, goldFromKills: number) {
        const gained = this.rm.completeWave(wave);
        G.main.autoSave();
        G.main.playSfx('win');
        this.showMenu();
        const lines = [`Gold from kills: ${goldFromKills}`, '', 'Production:'];
        const keys = Object.keys(gained);
        if (keys.length === 0) lines.push('  (nothing)');
        for (const k of keys) lines.push(`  +${gained[k]} ${k}`);
        lines.push('', 'Progress saved automatically.');
        message(this.root, `Wave ${wave} cleared!`, lines.join('\n'), undefined, 420, 300);
    }

    onGameOver(wave: number) {
        this.finished = true;
        G.main.playSfx('lose');
        message(this.root, 'GAME OVER', `The castle wall was destroyed on wave ${wave}.\n\nHighest wave cleared: ${this.rm.data.highestWave}`, () => G.main.goto('menu'), 440, 260);
    }

    /** Called by Main when the window is resized during a battle. */
    onResize() {
        this.drawGround(this.groundG, G.main.H);
        this.world.getComponent(UITransform)!.setContentSize(this.bf.worldWidth, G.main.H);
        this.topBar.layout();
        this.setCamera(this.camX);
    }

    update(dt: number) {
        if (this.finished) return;
        const step = Math.min(dt, 0.05);
        // Higher game speeds run several fixed steps so fast projectiles stay accurate.
        for (let i = 0; i < this.speed; i++) {
            this.combat.update(step);
            if (this.finished) break;
        }
        if (this.combat.active) this.waveInfo.string = `Enemies left: ${this.combat.enemiesLeft}`;
    }

    destroy() {
        this.unsubscribe();
        this.topBar.destroy();
        this.combat.clear();
        this.root.destroy();
    }
}
