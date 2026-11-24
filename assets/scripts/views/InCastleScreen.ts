import { Node, Graphics, EventTouch, EventMouse, Vec3, Label } from 'cc';
import { SpriteAnim } from '../combat/SpriteAnim';
import { Assets } from '../core/Assets';
import { ConfigMgr } from '../core/ConfigMgr';
import { BuildingSave } from '../core/GameTypes';
import { G } from '../core/Globals';
import { ResourceMgr } from '../core/ResourceMgr';
import { DefTab } from './common/DefTab';
import { TopBar, arcMenu } from './common/TopBar';
import { BuildRowView } from './items/BuildRowView';
import { BuildView } from './popups/BuildView';
import { InCastleView } from './screens/InCastleView';
import { InfoLine, confirm, infoWindow, toast } from './common/Popups';
import { PrefabButton, PrefabUi } from './common/PrefabUi';
import { COLORS, costRow, hex, mk, panel, sprite, text, toLocal } from './common/UIKit';

/**
 * Inside the castle: a large scrolling map with the Base fixed in the middle.
 * The HUD is prefabs/screens/InCastle; the map is built in code inside its WorldHolder.
 * Buildings are placed freely inside the build area (no grid), exactly like
 * defense towers outside, and can be upgraded, moved and destroyed.
 */
export class InCastleScreen {
    root: Node;
    private rm = ResourceMgr.inst;
    private cfg = ConfigMgr.building.map;
    private topBar: TopBar;
    private defTab: DefTab;
    private world: Node;
    private areaNode: Node;
    private buildingLayer: Node;
    private menuLayer: Node;
    private ghost: Node;
    private ghostG: Graphics;
    private cancelBtn: PrefabButton;
    private buildBtn: PrefabButton;
    private anims: SpriteAnim[] = [];
    private selectedUid = 0;
    /** Placement mode: building a new one (id) or moving an existing one (uid). */
    private placing: { id: string; uid: number } | null = null;
    private unsubscribe: () => void;
    private tmp = new Vec3();
    private worldW: number;
    private worldH: number;
    private camX = 0;
    private camY = 0;
    private dragDist = 0;
    /** Camera zoom (building.json map.zoom): 0.5 shows twice as much of the castle. */
    private zoom = 1;

    constructor(parent: Node) {
        const W = G.main.W, H = G.main.H;
        const scale = this.cfg.scale || 1;
        this.worldW = this.cfg.width * scale;
        this.worldH = this.cfg.height * scale;
        this.zoom = this.cfg.zoom || 1;

        const v = PrefabUi.view('screens/InCastle', parent, InCastleView);
        this.root = v.node;

        // ---- scrolling world (origin = bottom-left corner of the map)
        this.world = mk('World', v.worldHolder, -W / 2, -H / 2, this.worldW, this.worldH, 0, 0);
        this.world.setScale(this.zoom, this.zoom, 1);
        const mapFrames = this.cfg.path ? Assets.frames(this.cfg.path, this.cfg.width, this.cfg.height) : [];
        if (mapFrames.length > 0) {
            // The map image is scaled up to become the background of the whole world.
            sprite(this.world, mapFrames[0], this.worldW, this.worldH, 0, 0, 0, 0);
        } else {
            const g = mk('Ground', this.world).addComponent(Graphics);
            g.fillColor = hex('#6f8f52');
            g.rect(0, 0, this.worldW, this.worldH);
            g.fill();
        }

        // Build area outline, only visible while placing a building.
        const a = ResourceMgr.castleArea();
        this.areaNode = mk('Area', this.world);
        const ag = this.areaNode.addComponent(Graphics);
        ag.fillColor = hex('#ffffff', 28);
        ag.rect(a.x, a.y, a.width, a.height);
        ag.fill();
        ag.lineWidth = 4;
        ag.strokeColor = hex('#ffffff', 190);
        ag.rect(a.x, a.y, a.width, a.height);
        ag.stroke();
        this.areaNode.active = false;

        this.buildingLayer = mk('Buildings', this.world);
        this.ghost = mk('Ghost', this.world);
        this.ghostG = this.ghost.addComponent(Graphics);
        this.ghost.active = false;
        this.menuLayer = mk('Menus', this.world);

        this.world.on(Node.EventType.TOUCH_START, () => { this.dragDist = 0; }, this);
        this.world.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => this.onDrag(e), this);
        this.world.on(Node.EventType.TOUCH_END, (e: EventTouch) => { if (this.dragDist < 10) this.onTap(e.getUILocation().x, e.getUILocation().y); }, this);
        this.world.on(Node.EventType.MOUSE_MOVE, (e: EventMouse) => this.onHover(e.getUILocation().x, e.getUILocation().y), this);

        // ---- HUD (prefab, fixed on screen)
        this.topBar = new TopBar(v.topBarSlot!);
        this.defTab = new DefTab(v.defTabSlot!, -W / 2 + 6, H / 2 - 50);
        new PrefabButton(v.outsideButton, () => G.main.goto('outCastle'));
        new PrefabButton(v.pauseButton, () => G.main.openOverlay('pause'));
        new PrefabButton(v.baseButton, () => this.centerOnBase());
        this.buildBtn = new PrefabButton(v.buildButton, () => this.openBuildMenu());
        this.cancelBtn = new PrefabButton(v.cancelButton, () => this.stopPlacing());
        this.cancelBtn.setVisible(false);

        this.unsubscribe = this.rm.onChange(() => this.rebuild());
        this.rebuild();
        this.centerOnBase();
    }

    // ------------------------------------------------------------------ camera
    private setCamera(x: number, y: number) {
        // The camera works in screen pixels of the zoomed world.
        const maxX = Math.max(0, this.worldW * this.zoom - G.main.W), maxY = Math.max(0, this.worldH * this.zoom - G.main.H);
        this.camX = Math.max(0, Math.min(maxX, x));
        this.camY = Math.max(0, Math.min(maxY, y));
        this.world.setPosition(-G.main.W / 2 - this.camX, -G.main.H / 2 - this.camY, 0);
    }

    private centerOnBase() {
        const c = ResourceMgr.castleCenter();
        this.setCamera(c.x * this.zoom - G.main.W / 2, c.y * this.zoom - G.main.H / 2);
    }

    private onDrag(e: EventTouch) {
        const d = e.getUIDelta();
        this.dragDist += Math.abs(d.x) + Math.abs(d.y);
        this.setCamera(this.camX - d.x, this.camY - d.y);
        if (this.placing) this.onHover(e.getUILocation().x, e.getUILocation().y);
    }

    // ------------------------------------------------------------------ drawing
    private buildingAt(x: number, y: number): BuildingSave | null {
        // Buildings lower on the screen are drawn in front, so they are tested first.
        const list = this.rm.data.buildings.slice().sort((p, q) => p.y - q.y);
        for (const b of list) {
            const half = ResourceMgr.buildingSize(b.id) / 2;
            if (Math.abs(x - b.x) <= half && Math.abs(y - b.y) <= half) return b;
        }
        return null;
    }

    private rebuild() {
        this.buildingLayer.destroyAllChildren();
        this.anims.length = 0;
        const list = this.rm.data.buildings.slice().sort((p, q) => q.y - p.y);
        for (const b of list) {
            const def = ConfigMgr.buildingDef(b.id);
            const lv = ConfigMgr.buildingLevel(b.id, b.level);
            const size = ResourceMgr.buildingSize(b.id);
            const n = mk('Building_' + b.id, this.buildingLayer, b.x, b.y, size, size);
            const sp = lv && lv.sprite;
            const frames = sp ? Assets.frames(sp.path, sp.cellW, sp.cellH).slice(0, sp.frames) : [];
            if (frames.length > 0) {
                const s = sprite(n, null, size, size);
                const anim = new SpriteAnim(s);
                anim.play(frames, sp.frameTime || 0.12, true);
                this.anims.push(anim);
            } else {
                // Placeholder block when the sprite sheet is missing.
                panel(n, 0, 0, size - 8, size - 8, def.color || '#888888');
                text(n, def.name, 16, 0, 6, { bold: true, color: '#1b1626', width: size - 16, align: 'center' });
            }
            if (b.uid === this.selectedUid) {
                const sg = mk('Sel', n).addComponent(Graphics);
                sg.lineWidth = 4 / this.zoom;
                sg.strokeColor = hex('#ffffff');
                sg.rect(-size / 2 - 3, -size / 2 - 3, size + 6, size + 6);
                sg.stroke();
                // Level label (prefabs/items/LevelTag): only while the building is selected, just below the white border.
                const tag = PrefabUi.create('items/LevelTag', n);
                tag.setPosition(0, -size / 2 - 3 - 21 / this.zoom, 0);
                tag.setScale(1 / this.zoom, 1 / this.zoom, 1); // keeps its on-screen size
                const tl = PrefabUi.child(tag, 'Label', Label);
                if (tl) tl.string = 'Lv ' + b.level;
            }
        }
        if (this.selectedUid && !this.rm.building(this.selectedUid)) this.selectedUid = 0;
        this.showMenu();
    }

    private showMenu() {
        this.menuLayer.destroyAllChildren();
        const b = this.rm.building(this.selectedUid);
        if (!b || this.placing) return;
        const def = ConfigMgr.buildingDef(b.id);
        const labels: { [k: string]: string } = { upgrade: 'Upgrade', move: 'Move', destroy: 'Destroy', info: 'Info', recruit: 'Recruit', trade: 'Market', research: 'Research' };
        const colors: { [k: string]: string } = { upgrade: COLORS.buttonOk, destroy: COLORS.buttonDanger };
        const items = (def.actions as string[]).map(a => ({ label: labels[a] || a, icon: a, color: colors[a], onClick: () => this.doAction(a, b.uid) }));
        // The arc opens below the building, or above when there is no room on the map.
        const half = ResourceMgr.buildingSize(b.id) / 2;
        const below = b.y - half - 110 / this.zoom > 0;
        const menu = arcMenu(this.menuLayer, b.x, below ? b.y - half + 14 : b.y + half - 14, items, below, 66);
        menu.setScale(1 / this.zoom, 1 / this.zoom, 1); // buttons keep their on-screen size
    }

    // ------------------------------------------------------------------ input
    private onTap(uiX: number, uiY: number) {
        toLocal(this.world, uiX, uiY, this.tmp);
        const x = this.tmp.x, y = this.tmp.y;
        if (this.placing) { this.tryPlace(x, y); return; }
        const b = this.buildingAt(x, y);
        this.selectedUid = b ? b.uid : 0;
        this.rebuild();
    }

    private onHover(uiX: number, uiY: number) {
        if (!this.placing) return;
        toLocal(this.world, uiX, uiY, this.tmp);
        this.drawGhost(this.tmp.x, this.tmp.y);
    }

    private drawGhost(x: number, y: number) {
        if (!this.placing) return;
        const ok = this.rm.canPlaceBuilding(this.placing.id, x, y, this.placing.uid);
        const size = ResourceMgr.buildingSize(this.placing.id);
        const g = this.ghostG;
        this.ghost.active = true;
        this.ghost.setPosition(x, y, 0);
        g.clear();
        g.fillColor = hex(ok ? '#58d26a' : '#e05252', 130);
        g.rect(-size / 2, -size / 2, size, size);
        g.fill();
        g.lineWidth = 3;
        g.strokeColor = hex('#11101a', 200);
        g.rect(-size / 2, -size / 2, size, size);
        g.stroke();
    }

    private startPlacing(id: string, uid: number) {
        this.placing = { id, uid };
        this.areaNode.active = true;
        this.buildBtn.setVisible(false);
        this.cancelBtn.setVisible(true);
        this.showMenu();
        toast(this.root, 'Tap inside the highlighted area to place the building', true);
    }

    private stopPlacing() {
        this.placing = null;
        this.ghost.active = false;
        this.areaNode.active = false;
        this.buildBtn.setVisible(true);
        this.cancelBtn.setVisible(false);
        this.showMenu();
    }

    private tryPlace(x: number, y: number) {
        const p = this.placing!;
        const err = p.uid ? this.rm.moveBuilding(p.uid, x, y) : this.rm.buildBuilding(p.id, x, y);
        if (err) { toast(this.root, err); this.drawGhost(x, y); return; }
        G.main.playSfx(p.uid ? 'click' : 'upgrade');
        this.stopPlacing();
    }

    // ------------------------------------------------------------------ actions
    private doAction(action: string, uid: number) {
        const b = this.rm.building(uid);
        if (!b) return;
        const def = ConfigMgr.buildingDef(b.id);
        switch (action) {
            case 'upgrade': {
                const cost = this.rm.buildingUpgradeCost(b);
                if (!cost) { toast(this.root, 'Already at max level'); return; }
                confirm(this.root, `Upgrade ${def.name}`, `Upgrade to level ${b.level + 1}?`, () => {
                    const err = this.rm.upgradeBuilding(uid);
                    toast(this.root, err || `${def.name} upgraded`, !err);
                    if (!err) G.main.playSfx('upgrade');
                }, 'Confirm', 'Cancel', { label: 'Cost:', cost });
                break;
            }
            case 'move': this.startPlacing(b.id, b.uid); break;
            case 'destroy': {
                const refund = this.rm.refund(def.levels[0].cost);
                confirm(this.root, `Destroy ${def.name}`, 'Destroy this building?\n(upgrade costs are not refunded)', () => {
                    const err = this.rm.destroyBuilding(uid);
                    if (err) toast(this.root, err);
                }, 'Destroy', 'Cancel', { label: 'Refund:', cost: refund });
                break;
            }
            case 'info': this.showInfo(b); break;
            case 'recruit': G.main.goto('heroes'); break;
            case 'trade': G.main.goto('trade'); break;
            case 'research': G.main.openOverlay('research'); break;
        }
    }

    private showInfo(b: BuildingSave) {
        const def = ConfigMgr.buildingDef(b.id);
        const lv = ConfigMgr.buildingLevel(b.id, b.level);
        const lines: InfoLine[] = [def.description, '', `Level: ${b.level} / ${def.levels.length}`];
        const prod = this.rm.production(b);
        if (Object.keys(prod).length > 0) lines.push({ label: 'Produces after each wave:', cost: prod });
        if (lv.towerLimit) lines.push(`Defense tower limit: ${lv.towerLimit}`);
        if (lv.heroLimit) lines.push(`Hero limit: ${lv.heroLimit}`);
        if (lv.maxTechLevel) lines.push(`Max technology level: ${lv.maxTechLevel}`);
        const cost = this.rm.buildingUpgradeCost(b);
        lines.push(cost ? { label: 'Upgrade cost:', cost } : 'Max level reached');
        if (b.id === 'base') {
            lines.push('', 'Hero buffs:');
            const buffs = this.rm.activeBuffLines(true);
            if (buffs.length === 0) lines.push('  (no hero recruited yet)');
            for (const l of buffs) lines.push('  ' + l);
        }
        infoWindow(this.root, def.name, lines);
    }

    /** Build popup (prefabs/popups/Build): one row (prefabs/items/BuildRow) per buildable building. */
    private openBuildMenu() {
        const defs: any[] = ConfigMgr.building.buildings.filter((d: any) => d.buildable);
        const h = 150 + defs.length * 70;
        const v = PrefabUi.view('popups/Build', this.root, BuildView);
        v.resize(PrefabUi.size(v.box!).width, h);
        const top = h / 2 - 62;
        defs.forEach((def, i) => {
            const count = this.rm.countBuildings(def.id), max = this.rm.maxBuildingCount(def.id);
            const cost = def.levels[0].cost;
            const r = PrefabUi.view('items/BuildRow', v.rows!, BuildRowView);
            r.node.setPosition(0, top - 30 - i * 70, 0);
            const sp = def.levels[0].sprite;
            const frames = sp ? Assets.frames(sp.path, sp.cellW, sp.cellH) : [];
            if (frames.length > 0) r.icon!.spriteFrame = frames[0];
            else r.icon!.color = hex(def.color || '#888888');
            r.title!.string = `${def.name}  (${count}/${max})`;
            costRow(r.cost, cost, 0, 0, { size: 18, fontSize: 13 });
            const btn = new PrefabButton(r.buildButton, () => { v.close(); this.selectedUid = 0; this.startPlacing(def.id, 0); });
            btn.setEnabled(count < max && this.rm.canAfford(cost));
        });
        new PrefabButton(v.closeButton, () => v.close());
    }

    update(dt: number) {
        for (const a of this.anims) a.update(dt);
    }

    destroy() {
        this.unsubscribe();
        this.topBar.destroy();
        this.defTab.destroy();
        this.root.destroy();
    }
}
