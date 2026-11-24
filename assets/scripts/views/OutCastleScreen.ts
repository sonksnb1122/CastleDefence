import { waveStatsWindow } from './WaveStatsWindow';
import { Node, Graphics, EventTouch, EventMouse, Vec3, Label, UITransform } from 'cc';
import { CombatEvents, CombatManager } from '../combat/CombatManager';
import { TowerUnit } from '../combat/TowerUnit';
import { SkillManager } from '../combat/SkillManager';
import { CardArt } from './HeroRecruitScreen';
import { SkillCardView } from './items/SkillCardView';
import { skillDescription, skillName } from './SkillCards';
import { WaveMgr } from '../combat/WaveMgr';
import { ConfigMgr } from '../core/ConfigMgr';
import { G } from '../core/Globals';
import { ResourceMgr } from '../core/ResourceMgr';
import { DefTab } from './common/DefTab';
import { TopBar, arcMenu } from './common/TopBar';
import { OutCastleView } from './screens/OutCastleView';
import { InfoLine, confirm, infoWindow, message, toast } from './common/Popups';
import { FillBar, PrefabButton, PrefabUi } from './common/PrefabUi';
import { COLORS, costRow, hex, mk, text, toLocal } from './common/UIKit';
import { BattlefieldGround } from './BattlefieldGround';



/**
 * Radius of the tower menu. The castle ground left of the defense area (tower.json constructionArea.x)
 * is just wide enough for the left-most button of a tower at the left edge:
 * radius * ARC_X * cos(20 deg) + half a button (20) + a small margin.
 */
const TOWER_MENU_RADIUS = 66;
/** Game speeds of the speed button. */
const SPEEDS = [1, 2, 3, 5, 10];
/** Longest simulation step at x5 / x10 (seconds). */
const MAX_STEP = 1 / 60;
/**
 * Outside the castle: the defense construction area, the wall and the field
 * where waves of enemies arrive from the right. The view scrolls horizontally.
 * The HUD is prefabs/screens/OutCastle; the battlefield is built in code inside its WorldHolder.
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

    private enterBtn: PrefabButton;
    private startBtn: PrefabButton;
    private speedBtn: PrefabButton;
    private cancelBtn: PrefabButton;
    private repairBtn: PrefabButton;
    private buildBar: Node;
    private buildBtns: Array<{ id: string; btn: PrefabButton }> = [];
    private wallBar: FillBar;
    private defTab: DefTab;
    private wallLabel: Label;
    private waveInfo: Label;
    private unsubscribe: () => void;
    private ground: BattlefieldGround;
    // Temporary skill test: casts the skills of skills.json one after another (cooldowns ignored).
    private skillBtn: PrefabButton;
    private skillSkipBtn: PrefabButton;
    private skillBackBtn: PrefabButton;
    private skillIndex = 0;
    /** Targeted skill waiting for a tap on the battlefield. */
    private skillAiming: any = null;
    // Hero skill cards of the battle (prefabs/items/SkillCard in the HeroSkillBar).
    private view: OutCastleView;
    private heroCards: Array<{ heroId: string; skillId: string; v: SkillCardView; art: CardArt; x: number; y: number }> = [];
    private selectedHero = '';

    constructor(parent: Node) {
        const W = G.main.W, H = G.main.H;
        const bf = this.bf;
        const v = PrefabUi.view('screens/OutCastle', parent, OutCastleView);
        this.view = v;
        this.root = v.node;

        // ---- scrolling world (origin = bottom-left corner of the battlefield)
        this.world = mk('World', v.worldHolder, -W / 2, -H / 2, bf.worldWidth, H, 0, 0);
        this.ground = new BattlefieldGround(this.world, H);
        text(this.world, 'DEFENSE AREA', 14, bf.constructionArea.x + bf.constructionArea.width / 2, bf.constructionArea.y - 12, { color: '#1f3d14', bold: true });
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

        // ---- HUD (prefab, fixed on screen)
        this.topBar = new TopBar(v.topBarSlot!, true);   // shows the tower count
        this.wallBar = new FillBar(v.wallBar, '#6ad66a');
        this.wallLabel = v.wallLabel!;
        this.defTab = new DefTab(v.defTabSlot!, -W / 2 + 6, H / 2 - 76);
        this.repairBtn = new PrefabButton(v.repairButton, () => this.repairWall());
        this.enterBtn = new PrefabButton(v.enterButton, () => G.main.goto('inCastle'));
        this.startBtn = new PrefabButton(v.startButton, () => this.startWave());
        this.waveInfo = v.waveInfo!;
        new PrefabButton(v.pauseButton, () => G.main.openOverlay('pause'));
        this.speedBtn = new PrefabButton(v.speedButton, () => this.cycleSpeed());
        this.cancelBtn = new PrefabButton(v.cancelButton, () => this.stopPlacing());
        this.cancelBtn.setVisible(false);
        this.skillBtn = new PrefabButton(v.skillTestButton, () => this.testSkill());
        this.skillSkipBtn = new PrefabButton(v.skillSkipButton, () => { this.skillIndex++; this.stopAiming(); });
        this.skillBackBtn = new PrefabButton(v.skillBackButton, () => {
            const n = Math.max(1, SkillManager.list.length);
            this.skillIndex = (this.skillIndex % n + n - 1) % n;
            this.stopAiming();
        });

        // Tower build buttons (prefabs/items/TowerButton, one per tower of tower.json).
        this.buildBar = v.buildBar!;
        const towers: any[] = ConfigMgr.tower.towers;
        towers.forEach((t, i) => {
            const node = PrefabUi.create('items/TowerButton', this.buildBar);
            node.setPosition((i - (towers.length - 1) / 2) * 172, 0, 0);
            const btn = new PrefabButton(node, () => this.startPlacing(t.id, 0));
            // Tower name on top, build cost with resource icons below.
            btn.setText(t.name);
            costRow(node.getChildByName('Cost'), t.buildCost, 0, 0, { align: 'center', size: 16, fontSize: 12, bold: true });
            this.buildBtns.push({ id: t.id, btn });
        });

        this.rebuildTowers();
        this.unsubscribe = this.rm.onChange(() => this.refreshHud());
        this.refreshHud();
        this.setCamera(0);
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
            { label: 'Upgrade', icon: 'upgrade', color: COLORS.buttonOk, onClick: () => this.upgradeTower(uid), enabled: prep },
            { label: 'Move', icon: 'move', onClick: () => this.startPlacing(unit.save.id, uid), enabled: prep },
            { label: 'Target', icon: 'target', color: COLORS.button, onClick: () => { const m = this.rm.cycleTargetMode(uid); toast(this.root, 'Target mode: ' + m, true); unit.target = null; } },
            { label: 'Info', icon: 'info', onClick: () => this.towerInfoWindow(unit) },
            { label: 'Destroy', icon: 'destroy', color: COLORS.buttonDanger, onClick: () => this.destroyTower(uid), enabled: prep },
        ];
        // No level label: the tower art already shows its level.
        const below = unit.save.y > 170;
        arcMenu(this.menuLayer, unit.save.x, below ? unit.save.y + 6 : unit.cy + 30, items, below, TOWER_MENU_RADIUS);
    }

    private upgradeTower(uid: number) {
        const t = this.rm.tower(uid);
        if (!t) return;
        const def = ConfigMgr.towerDef(t.id);
        const block = this.rm.towerUpgradeBlock(t);
        if (block) { toast(this.root, block === 'Upgrade the Base first' ? `Tower level is limited by the Base level (${this.rm.baseLevel})` : block); return; }
        const cost = this.rm.towerUpgradeCost(t)!;
        const next = ConfigMgr.towerLevel(t.id, t.level + 1);
        const body = `Upgrade to level ${t.level + 1}?\nDamage ${next.damage}, ${next.attackSpeed}/s, range ${next.attackRange}`;
        confirm(this.root, `Upgrade ${def.name}`, body, () => {
            const err = this.rm.upgradeTower(uid);
            toast(this.root, err || `${def.name} upgraded`, !err);
            if (!err) { G.main.playSfx('upgrade'); this.rebuildTowers(); }
        }, 'Confirm', 'Cancel', { label: 'Cost:', cost });
    }

    private destroyTower(uid: number) {
        const t = this.rm.tower(uid);
        if (!t) return;
        const def = ConfigMgr.towerDef(t.id);
        confirm(this.root, `Destroy ${def.name}`, 'Destroy this tower?\n(upgrade costs are not refunded)', () => {
            const err = this.rm.destroyTower(uid);
            if (err) toast(this.root, err);
            else this.rebuildTowers();
        }, 'Destroy', 'Cancel', { label: 'Refund:', cost: this.rm.refund(def.buildCost) });
    }

    private towerInfoWindow(unit: TowerUnit) {
        const s = unit.stats();
        const def = unit.def;
        const r1 = (v: number) => Math.round(v * 100) / 100;
        const lines: InfoLine[] = [
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
        // Special effects: chance (from research at Lab Lv 3) and what each one does.
        const effects = unit.effectInfo();
        if (effects.length) {
            lines.push('', 'Special effects:');
            for (const e of effects) {
                const state = e.chance > 0 ? `${e.chance}% chance` : 'locked - research it at Research Lab Lv 3';
                lines.push(`- ${e.name} (${state}): ${e.description}`);
            }
        }
        const cost = this.rm.towerUpgradeCost(unit.save);
        lines.push(cost ? { label: 'Upgrade cost:', cost } : 'Max level reached');
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
        this.buildBar.active = false;
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
        G.main.playSfx(p.uid ? 'click' : 'upgrade');
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
        if (this.skillAiming) { toLocal(this.world, uiX, uiY, this.tmp); this.drawSkillZone(this.tmp.x, this.tmp.y); return; }
        if (!this.placing) return;
        toLocal(this.world, uiX, uiY, this.tmp);
        this.drawGhost(this.tmp.x, this.tmp.y);
    }

    private onTap(uiX: number, uiY: number) {
        toLocal(this.world, uiX, uiY, this.tmp);
        const x = this.tmp.x, y = this.tmp.y;
        if (this.skillAiming) { this.castAimed(x, y); return; }
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
        this.buildBar.active = showBuild;
        for (const b of this.buildBtns) b.btn.setEnabled(rm.canAfford(ConfigMgr.towerDef(b.id).buildCost) && rm.data.towers.length < rm.towerLimit);
        this.topBar.refresh();
        if (prep) this.waveInfo.string = 'Next: ' + WaveMgr.summary(rm.data.currentWave);
    }

    private repairWall() {
        const cost = this.rm.wallRepairCost();
        confirm(this.root, 'Repair Wall', 'Restore the wall to full HP?', () => {
            const err = this.rm.repairWall();
            toast(this.root, err || 'Wall repaired', !err);
            if (!err) G.main.playSfx('upgrade');
        }, 'Confirm', 'Cancel', { label: 'Cost:', cost });
    }

    private cycleSpeed() {
        const i = SPEEDS.indexOf(this.speed);
        this.speed = SPEEDS[(i + 1) % SPEEDS.length];
        this.speedBtn.setText('x' + this.speed);
    }

    // ------------------------------------------------------------------ waves
    // ------------------------------------------------------------------ skill test (temporary)
    private get testSkillDef(): any {
        const list = SkillManager.list;
        return list.length > 0 ? list[this.skillIndex % list.length] : null;
    }

    /** Casts the next skill; a targeted one waits for a tap on the battlefield (tap the button again to cancel). */
    private testSkill() {
        const def = this.testSkillDef;
        if (!def || !this.combat.active) return;
        if (this.skillAiming) { this.stopAiming(); return; }
        if (def.target === 'area') {
            this.skillAiming = def;
            this.refreshSkillButton();
            return;
        }
        this.combat.skills.cast(def);
        this.skillIndex++;
        this.refreshSkillButton();
    }

    private castAimed(x: number, y: number) {
        const def = this.skillAiming;
        const bf = this.bf;
        // Only on the enemy path (right of the wall); the zone center stays inside the lane.
        if (x < this.combat.wallRightX + 10) { toast(this.root, 'Choose a spot on the enemy path', false); return; }
        const cy = Math.max(bf.enemyLaneY[0], Math.min(bf.enemyLaneY[1], y));
        this.combat.skills.cast(def, x, cy);
        this.skillIndex++;
        this.stopAiming();
    }

    private stopAiming() {
        this.skillAiming = null;
        if (!this.placing) { this.ghostG.clear(); this.ghost.active = false; }
        this.refreshSkillButton();
    }

    /** Preview of the zone of the skill being aimed. */
    private drawSkillZone(x: number, y: number) {
        const r = SkillManager.areaDiameter(this.skillAiming) / 2;
        this.ghost.active = true;
        const g = this.ghostG;
        g.clear();
        g.fillColor = hex('#ffe9a8', 40);
        g.circle(x, Math.max(this.bf.enemyLaneY[0], Math.min(this.bf.enemyLaneY[1], y)), r);
        g.fill();
        g.lineWidth = 2;
        g.strokeColor = hex('#ffe9a8', 220);
        g.circle(x, Math.max(this.bf.enemyLaneY[0], Math.min(this.bf.enemyLaneY[1], y)), r);
        g.stroke();
    }

    private refreshSkillButton() {
        const show = this.combat.active && !this.finished;
        this.skillBtn.setVisible(show);
        this.skillSkipBtn.setVisible(show);
        this.skillBackBtn.setVisible(show);
        if (!show) return;
        const def = this.testSkillDef;
        const n = SkillManager.list.length;
        if (!def) { this.skillBtn.setText('No skills'); return; }
        const i = (this.skillIndex % n) + 1;
        this.skillBtn.setText(this.skillAiming ? 'Tap the field: ' + def.name : `${i}/${n} ${def.name}`);
    }

    // ------------------------------------------------------------------ hero skill cards (battle)
    /**
     * During a wave the build buttons are replaced by small cards of the heroes that learned an active
     * skill. Tap a card: it lights up and its skill is described on the right. Drag it up out of the
     * card bar: the skill is cast (targeted skills land where the card is released).
     */
    private showHeroCards() {
        this.hideHeroCards();
        const bar = this.view.heroSkillBar!;
        const list = this.rm.skills.castable();
        bar.active = list.length > 0;
        const step = 84;
        list.forEach((c, i) => {
            const v = PrefabUi.view('items/SkillCard', bar, SkillCardView);
            const x = (i - (list.length - 1) / 2) * step, y = 0;
            v.node.setPosition(x, y, 0);
            const hero = ConfigMgr.heroDef(c.heroId);
            if (v.placeholder) v.placeholder.string = hero.name.split(' ')[0];
            const a = PrefabUi.size(v.art!);
            const art = new CardArt(v.art!, hero.imagePath, a.width + 4, a.height + 4);
            art.setWanted(true);
            v.skillName!.string = skillName(c.skillId);
            const card = { heroId: c.heroId, skillId: c.skillId, v, art, x, y };
            this.heroCards.push(card);
            this.bindCard(card);
        });
        this.refreshHeroCards();
    }

    private hideHeroCards() {
        for (const c of this.heroCards) { c.art.free(); c.v.node.destroy(); }
        this.heroCards.length = 0;
        this.selectedHero = '';
        if (this.view.heroSkillBar) this.view.heroSkillBar.active = false;
        if (this.view.skillInfo) this.view.skillInfo.active = false;
    }

    private refreshHeroCards() {
        const sk = this.rm.skills;
        for (const c of this.heroCards) {
            const ready = sk.isReady(c.heroId), uses = sk.usesLeft(c.heroId);
            c.v.shade!.active = !ready || uses <= 0;
            c.v.status!.string = !ready ? `Ready on\nwave ${sk.readyWave(c.heroId)}` : uses > 1 ? `x${uses}` : '';
            c.v.glow!.active = c.heroId === this.selectedHero;
        }
    }

    private selectHeroCard(heroId: string) {
        this.selectedHero = heroId;
        const c = this.heroCards.find(x => x.heroId === heroId);
        const v = this.view;
        if (c && v.skillInfo) {
            const hero = ConfigMgr.heroDef(heroId), sk = this.rm.skills;
            v.skillInfo.active = true;
            v.skillInfoTitle!.string = skillName(c.skillId);
            v.skillInfoType!.string = `${hero.name} - active skill`;
            const when = sk.isReady(heroId) ? 'Drag the card up to cast it.' : `Ready again on wave ${sk.readyWave(heroId)}.`;
            v.skillInfoText!.string = `${skillDescription(c.skillId)}\n\n${when}`;
        }
        this.refreshHeroCards();
    }

    private bindCard(card: { heroId: string; skillId: string; v: SkillCardView; x: number; y: number }) {
        const n = card.v.node;
        let startY = 0, lifted = false;
        const canCast = () => this.combat.active && !this.finished && this.rm.skills.usesLeft(card.heroId) > 0;
        n.on(Node.EventType.TOUCH_START, (e: EventTouch) => {
            e.propagationStopped = true;
            startY = e.getUILocation().y;
            lifted = false;
            this.selectHeroCard(card.heroId);
        }, this);
        n.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => {
            e.propagationStopped = true;
            if (!canCast()) return;
            const p = e.getUILocation();
            const dy = p.y - startY;
            // The card follows the finger; past its own height it is "out of the bar" and will cast.
            n.setPosition(card.x + e.getUIDelta().x + (n.position.x - card.x), card.y + Math.max(0, dy), 0);
            lifted = dy > 110;
            n.setScale(lifted ? 1.12 : 1, lifted ? 1.12 : 1, 1);
            const def = ConfigMgr.skillDef(card.skillId);
            if (lifted && def && def.target === 'area') {
                this.skillAiming = def;
                toLocal(this.world, p.x, p.y, this.tmp);
                this.drawSkillZone(this.tmp.x, this.tmp.y);
            } else if (this.skillAiming === def) { this.skillAiming = null; this.ghostG.clear(); this.ghost.active = false; }
        }, this);
        const release = (e: EventTouch) => {
            e.propagationStopped = true;
            n.setPosition(card.x, card.y, 0);
            n.setScale(1, 1, 1);
            const def = ConfigMgr.skillDef(card.skillId);
            if (this.skillAiming === def) { this.skillAiming = null; this.ghostG.clear(); this.ghost.active = false; this.refreshSkillButton(); }
            if (!lifted || !canCast() || !def) return;
            lifted = false;
            const p = e.getUILocation();
            this.castHeroSkill(card.heroId, def, p.x, p.y);
        };
        n.on(Node.EventType.TOUCH_END, release, this);
        n.on(Node.EventType.TOUCH_CANCEL, release, this);
    }

    /** Cast a hero skill (released at UI point uiX, uiY for targeted skills). */
    castHeroSkill(heroId: string, def: any, uiX: number, uiY: number) {
        let x = 0, y = 0;
        if (def.target === 'area') {
            toLocal(this.world, uiX, uiY, this.tmp);
            if (this.tmp.x < this.combat.wallRightX + 10) { toast(this.root, 'Release the card over the enemy path', false); return; }
            x = this.tmp.x;
            y = Math.max(this.bf.enemyLaneY[0], Math.min(this.bf.enemyLaneY[1], this.tmp.y));
        }
        this.combat.skills.cast(def, x, y);
        this.rm.skills.use(heroId);
        toast(this.root, `${ConfigMgr.heroDef(heroId).name}: ${def.name}!`, true);
        this.selectHeroCard(heroId);
    }

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
        this.refreshSkillButton();
        this.showHeroCards();
        toast(this.root, this.combat.plan!.name, true);
        G.main.playSfx('wave_start');
        // Boss waves have their own music until the wave is over.
        if (WaveMgr.defense(this.rm.data.currentWave).hasBoss) G.main.playMusic('bgm_boss');
    }

    onWallChanged() { this.refreshHud(); }

    onWaveCleared(wave: number, goldFromKills: number) {
        this.skillAiming = null;
        this.refreshSkillButton();
        this.hideHeroCards();
        const gained = this.rm.completeWave(wave);
        G.main.autoSave();
        G.main.playSfx('win');
        G.main.playMusic('bgm_battle');
        this.showMenu();
        // Rewards and the statistics of the wave (damage per tower, hit rate, effects).
        const rewards: InfoLine[] = [{ label: 'Gold from kills:', cost: { gold: goldFromKills } }];
        if (this.combat.coresFromKills > 0) rewards.push({ label: 'Energy Cores from bosses:', cost: { core: this.combat.coresFromKills } });
        rewards.push(Object.keys(gained).length > 0 ? { label: 'Production:', cost: gained } : 'Production: nothing');
        rewards.push('Progress saved automatically.');
        waveStatsWindow(this.root, `Wave ${wave} cleared!`, rewards, this.combat.stats);
    }

    onGameOver(wave: number) {
        this.finished = true;
        this.skillAiming = null;
        this.refreshSkillButton();
        this.hideHeroCards();
        G.main.playSfx('lose');
        message(this.root, 'GAME OVER', `The castle wall was destroyed on wave ${wave}.\n\nHighest wave cleared: ${this.rm.data.highestWave}`, () => G.main.goto('menu'), 440, 260);
    }

    /** Called by Main when the window is resized during a battle. */
    onResize() {
        PrefabUi.align(this.root);   // HUD widgets follow the new screen size
        this.ground.draw(G.main.H);
        this.world.getComponent(UITransform)!.setContentSize(this.bf.worldWidth, G.main.H);
        this.topBar.layout();
        this.defTab.setTopLeft(-G.main.W / 2 + 6, G.main.H / 2 - 76);
        this.setCamera(this.camX);
    }

    update(dt: number) {
        if (this.finished) return;
        const frame = Math.min(dt, 0.05);
        // Higher game speeds run several steps per frame so fast projectiles stay accurate.
        // x2 / x3: one step per speed level. x5 / x10: steps of up to MAX_STEP, so x10 costs
        // about 5 steps per frame at 60 fps instead of 10 (never more than 10).
        let steps = this.speed, step = frame;
        if (this.speed > 3) {
            const total = frame * this.speed;
            steps = Math.min(10, Math.ceil(total / MAX_STEP - 1e-6));
            step = total / steps;
        }
        for (let i = 0; i < steps; i++) {
            this.combat.update(step);
            if (this.finished) break;
        }
        if (this.combat.active) this.waveInfo.string = `Enemies left: ${this.combat.enemiesLeft}`;
        for (const c of this.heroCards) c.art.update(dt);
    }

    destroy() {
        this.hideHeroCards();
        this.unsubscribe();
        this.topBar.destroy();
        this.defTab.destroy();
        this.combat.clear();
        this.root.destroy();
    }
}
