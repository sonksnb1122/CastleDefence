import {
    _decorator, Component, Node, Layers, UITransform, view, ResolutionPolicy, sys, game, Game, macro,
    resources, AudioClip, AudioSource,
} from 'cc';
import { Assets } from './core/Assets';
import { ConfigMgr } from './core/ConfigMgr';
import { G, IMain } from './core/Globals';
import { ResourceMgr } from './core/ResourceMgr';
import { HeroRecruitScreen } from './views/HeroRecruitScreen';
import { TradeScreen } from './views/TradeScreen';
import { InCastleScreen } from './views/InCastleScreen';
import { LoadingScreen } from './views/LoadingScreen';
import { MainMenuScreen } from './views/MainMenuScreen';
import { OutCastleScreen } from './views/OutCastleScreen';
import { Display, DisplayKey } from './core/Display';
import { IOverlay, PauseOverlay, SaveLoadOverlay, SettingsOverlay } from './views/Overlays';
import { ResearchOverlay } from './views/ResearchTree';
import { Tutorial, TutorialsOverlay } from './views/Tutorial';
import { GuideOverlay } from './views/Guide';

const { ccclass } = _decorator;

const DESIGN_W = 1024;
const DESIGN_H = 576;
/** Music is mixed this much quieter than the volume slider, so it stays in the background of the sound effects. */
const MUSIC_GAIN = 0.7;

/** Shortest time (s) between two plays of the same sound: frequent combat sounds are limited the most. */
function sfxGap(name: string): number {
    if (name.indexOf('shoot_') === 0) return 0.07;
    if (name.indexOf('hit_') === 0 || name === 'coin') return 0.06;
    if (name.indexOf('die_') === 0 || name === 'explode' || name === 'wall_hit') return 0.08;
    if (name.indexOf('fx_') === 0) return 0.12;
    return 0.03;
}

/** Prefabs of assets/prefabs preloaded at start (every screen, popup and list item of the game). */
const PREFABS = [
    'screens/Loading', 'screens/MainMenu', 'screens/InCastle', 'screens/OutCastle', 'screens/HeroRecruit', 'screens/Trade',
    'popups/Pause', 'popups/Settings', 'popups/SaveLoad', 'popups/ResearchTree', 'popups/HeroInfo', 'popups/PopupTemplate', 'items/ButtonTemplate',
    'popups/NewHero',
    'items/TopBar', 'items/DefTab', 'items/SaveSlot', 'items/BuildRow', 'items/HeroCard',
    'items/LevelTag', 'items/ArcButton', 'items/Toast', 'items/SkillCard',
    'items/TutorialFrame', 'popups/Tutorials', 'items/GuideStage', 'items/GuideRow', 'items/GuideButton',
];
const SAVE_KEY = 'castle_defense_save_';
const SETTINGS_KEY = 'castle_defense_settings';
/**
 * Test saves made by the progression bot (tools/harness/prog.js, "full" variant: all research, heroes and Market
 * trades), listed in Load Game (they cannot be deleted): seed 1 (assets/resources/presets/wave_<n>.json, falls at
 * wave 130) and seed 3 (seed3_wave_<n>.json, a weaker run that falls at wave 90).
 * Temporary, for testing: set to [] to hide them.
 */
const TEST_SAVES: Array<{ file: string; wave: number; seed: number }> = [
    ...[10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(wave => ({ file: 'wave_' + wave, wave, seed: 1 })),
    ...[10, 20, 30, 40, 50, 60, 70, 80, 90].map(wave => ({ file: 'seed3_wave_' + wave, wave, seed: 3 })),
];

interface IScreen { root: Node; update(dt: number): void; destroy(): void; }

/**
 * Entry point and singleton of the game (the only Component in the project).
 * - boots the game: resolution, configs, textures, audio
 * - switches between screens (main menu, in castle, out castle, heroes) and overlays
 * - owns save / load of save slots and the audio options
 */
@ccclass('Main')
export class Main extends Component implements IMain {
    static inst: Main = null as any;

    W = DESIGN_W;
    H = DESIGN_H;
    musicVolume = 0.6;
    sfxVolume = 0.8;

    private screenLayer: Node = null as any;
    private overlayLayer: Node = null as any;
    /** Above the overlays: tutorials (views/Tutorial.ts). */
    topLayer: Node = null as any;
    private screen: IScreen | null = null;
    private screenName = '';
    private overlays: IOverlay[] = [];
    private clips: { [name: string]: AudioClip } = {};
    /** Variants of a sound ("explode_v1", "explode_v2"... are all played as "explode"). */
    private variants: { [name: string]: AudioClip[] } = {};
    /** Last time (ms) each sound was played, to limit how often it can be heard. */
    private lastSfx: { [name: string]: number } = {};
    private musicKey = '';
    private sfxSeed = (Date.now() & 0x7fffffff) || 1;
    private lastVariant: { [name: string]: number } = {};
    private music: AudioSource = null as any;
    private sfx: AudioSource = null as any;
    private loading: LoadingScreen | null = null;

    onLoad() {
        Main.inst = this;
        G.main = this;
        this.setupResolution();
        this.node.layer = Layers.Enum.UI_2D;
        if (!this.node.getComponent(UITransform)) this.node.addComponent(UITransform);
        this.screenLayer = this.makeLayer('Screens');
        this.overlayLayer = this.makeLayer('Overlays');
        this.topLayer = this.makeLayer('Top');
        this.music = this.makeLayer('Music').addComponent(AudioSource);
        this.sfx = this.makeLayer('Sfx').addComponent(AudioSource);
        this.loadSettings();
        // Save when the player leaves the game (tab hidden / app sent to background).
        game.on(Game.EVENT_HIDE, this.onHide, this);
    }

    /** Landscape only. Windows / desktop use 1024x576; mobile keeps the height and widens to the screen. */
    private setupResolution() {
        view.setOrientation(macro.ORIENTATION_LANDSCAPE);
        // FIXED_HEIGHT: the design height always fills the screen, the width follows the window.
        view.setDesignResolutionSize(DESIGN_W, DESIGN_H, ResolutionPolicy.FIXED_HEIGHT);
        this.refreshSize();
        view.on('canvas-resize', this.onResize, this);
    }

    /** Read the real visible size. Every screen lays itself out from W / H, never from constants. */
    private refreshSize(): boolean {
        const size = view.getVisibleSize();
        const w = Math.round(size.width), h = Math.round(size.height);
        if (w <= 0 || h <= 0 || (w === this.W && h === this.H)) return false;
        this.W = w;
        this.H = h;
        // Screen / popup prefabs stretch to the layers with Widgets, so the layers are as big as the screen.
        for (const l of [this.screenLayer, this.overlayLayer, this.topLayer]) if (l) l.getComponent(UITransform)!.setContentSize(w, h);
        return true;
    }

    private resizePending = false;

    /** Window / orientation changed: rebuild the current screen for the new size. */
    private onResize() {
        if (!this.refreshSize() && !this.resizePending) return;
        if (!this.screen) return;
        if (this.overlays.length > 0) { this.resizePending = true; return; } // applied when the overlay closes
        this.resizePending = false;
        const s: any = this.screen;
        // A running battle cannot be rebuilt, so the battlefield only re-lays out in place.
        if (typeof s.onResize === 'function' && !ResourceMgr.inst.isPreparation) s.onResize();
        else this.goto(this.screenName);
    }

    private makeLayer(name: string): Node {
        const n = new Node(name);
        n.layer = Layers.Enum.UI_2D;
        n.addComponent(UITransform).setContentSize(this.W, this.H);
        this.node.addChild(n);
        return n;
    }

    start() {
        // The loading screen is a prefab too: load it first (it is small), then everything else.
        Assets.loadPrefabs(['screens/Loading'], () => {
            if (!Assets.prefab('screens/Loading')) return;
            this.loading = new LoadingScreen(this.screenLayer);
            this.boot();
        });
    }

    private boot() {
        const loading = this.loading!;
        loading.set(0.05, 'Loading configuration...');
        ConfigMgr.load(() => {
            if (ConfigMgr.errors.length > 0) {
                console.error('[Main] configuration errors:\n' + ConfigMgr.errors.join('\n'));
                loading.showError(ConfigMgr.errors);
                return;
            }
            // Hero cards are huge and are loaded on demand by the recruit screen, not here.
            const paths = ConfigMgr.texturePaths();
            for (const p of ConfigMgr.linearTexturePaths()) Assets.linear.add(p);
            loading.set(0.1, 'Loading sprites...');
            // Combat sheets, boss sheets and research icons come from packed atlases (one file each, fewer draw calls);
            // everything else is loaded one by one.
            Assets.loadAtlas('sprites/atlas/combat', () => Assets.loadAtlas('sprites/atlas/halo', () => Assets.loadAtlas('sprites/atlas/boss', () => Assets.loadAtlas('sprites/atlas/research', () => Assets.loadPrefabs(PREFABS, () => Assets.loadTextures(paths, () => {
                ConfigMgr.checkAssets();
                loading.set(0.9, 'Loading audio...');
                this.loadTestSaves(() => this.loadAudio(() => {
                    loading.set(1, 'Ready');
                    // Leave the full bar visible for a moment, then open the main menu.
                    this.after(0.15, () => {
                        loading.destroy();
                        this.loading = null;
                        this.goto('menu');
                    });
                }));
            }, (loaded, total) => loading.set(0.1 + 0.8 * loaded / total, `Loading sprites... ${loaded}/${total}`)))))));
        });
    }

    // ------------------------------------------------------------------ screens & overlays
    goto(name: string, _arg?: any) {
        this.refreshSize();
        Tutorial.close();
        while (this.overlays.length > 0) this.overlays.pop()!.destroy();
        if (this.screen) { this.screen.destroy(); this.screen = null; }
        this.screenName = name;
        switch (name) {
            case 'inCastle': this.screen = new InCastleScreen(this.screenLayer); break;
            case 'outCastle': this.screen = new OutCastleScreen(this.screenLayer); break;
            case 'heroes': this.screen = new HeroRecruitScreen(this.screenLayer); break;
            case 'trade': this.screen = new TradeScreen(this.screenLayer); break;
            default: this.screenName = 'menu'; this.screen = new MainMenuScreen(this.screenLayer);
        }
        // Calm music in the menu and inside the castle, battle music on the battlefield.
        this.playMusic(this.screenName === 'outCastle' ? 'bgm_battle' : 'bgm_castle');
    }

    openOverlay(name: string, _arg?: any) {
        let o: IOverlay | null = null;
        switch (name) {
            case 'pause': o = new PauseOverlay(this.overlayLayer); break;
            case 'settings': o = new SettingsOverlay(this.overlayLayer); break;
            case 'load': o = new SaveLoadOverlay(this.overlayLayer, 'load'); break;
            case 'save': o = new SaveLoadOverlay(this.overlayLayer, 'save'); break;
            case 'research': o = new ResearchOverlay(this.overlayLayer); break;
            case 'tutorials': o = new TutorialsOverlay(this.overlayLayer); break;
            case 'guide': o = new GuideOverlay(this.overlayLayer); break;
        }
        if (o) this.overlays.push(o);
    }

    closeOverlay() {
        const o = this.overlays.pop();
        if (o) o.destroy();
        if (this.overlays.length === 0 && this.resizePending) this.onResize();
    }

    /** The game is paused while any overlay (pause menu, settings, ...) is open. */
    update(dt: number) {
        // A tutorial step on screen pauses the game too.
        if (this.screen && this.overlays.length === 0 && !Tutorial.active) this.screen.update(dt);
    }

    after(seconds: number, fn: () => void) { this.scheduleOnce(fn, seconds); }

    private get inGame(): boolean { return this.screenName !== '' && this.screenName !== 'menu'; }

    // ------------------------------------------------------------------ save / load
    newGame() {
        ResourceMgr.inst.newGame();
        this.goto('inCastle');
    }

    /** Slot 0 is the autosave, slots 1..3 are manual saves. */
    saveToSlot(slot: number): boolean {
        const rm = ResourceMgr.inst;
        if (!rm.data || !rm.isPreparation) return false; // progress is only saved between waves
        try {
            sys.localStorage.setItem(SAVE_KEY + slot, JSON.stringify(rm.serialize()));
            return true;
        } catch (e) {
            console.error('[Main] save failed', e);
            return false;
        }
    }

    autoSave() { this.saveToSlot(0); }

    private readSlot(slot: number): { raw: any; error: string | null } {
        let str: string | null = null;
        try { str = sys.localStorage.getItem(SAVE_KEY + slot); } catch (e) { return { raw: null, error: 'Storage is not available' }; }
        if (!str) return { raw: null, error: 'Empty slot' };
        try { return { raw: JSON.parse(str), error: null }; } catch (e) { return { raw: null, error: 'Save file is corrupted' }; }
    }

    /**
     * Load a slot. The save is validated first; when anything is wrong the
     * current game and the save file are left untouched and a reason is returned.
     */
    loadFromSlot(slot: number): string | null {
        const r = this.readSlot(slot);
        if (r.error) return r.error;
        const parsed = ResourceMgr.parse(r.raw);
        if (parsed.error || !parsed.data) return parsed.error || 'Invalid save file';
        ResourceMgr.inst.apply(parsed.data);
        this.goto('inCastle');
        return null;
    }

    slotInfo(slot: number): { exists: boolean; wave: number; savedAt: number; valid: boolean } {
        const r = this.readSlot(slot);
        if (r.error === 'Empty slot' || r.error === 'Storage is not available') return { exists: false, wave: 0, savedAt: 0, valid: false };
        if (r.error) return { exists: true, wave: 0, savedAt: 0, valid: false };
        const parsed = ResourceMgr.parse(r.raw);
        if (!parsed.data) return { exists: true, wave: 0, savedAt: 0, valid: false };
        return { exists: true, wave: parsed.data.currentWave, savedAt: parsed.data.savedAt, valid: true };
    }

    testSaves: Array<{ wave: number; seed: number; data: any }> = [];

    /** Read the bot test saves; a missing file is skipped. */
    private loadTestSaves(done: () => void) {
        let left = TEST_SAVES.length;
        if (left === 0) { done(); return; }
        const found: Array<{ wave: number; seed: number; data: any }> = [];
        for (const t of TEST_SAVES) {
            Assets.loadJson('presets/' + t.file, (err, data) => {
                if (err) console.warn('[Main] test save missing: ' + err);
                else found.push({ wave: t.wave, seed: t.seed, data });
                if (--left === 0) {
                    this.testSaves = found.sort((a, b) => a.seed - b.seed || a.wave - b.wave);
                    done();
                }
            });
        }
    }

    /** Start from a test save. The file itself is never changed. */
    loadTestSave(index: number): string | null {
        const t = this.testSaves[index];
        if (!t) return 'Test save not found';
        const parsed = ResourceMgr.parse(JSON.parse(JSON.stringify(t.data)));
        if (parsed.error || !parsed.data) return parsed.error || 'Invalid save file';
        ResourceMgr.inst.apply(parsed.data);
        this.goto('inCastle');
        return null;
    }

    deleteSlot(slot: number) {
        try { sys.localStorage.removeItem(SAVE_KEY + slot); } catch (e) { /* ignore */ }
    }

    private onHide() {
        if (this.inGame) this.autoSave();
    }

    quitGame() {
        if (this.inGame) this.autoSave();
        game.end();
    }

    // ------------------------------------------------------------------ audio options
    private loadSettings() {
        try {
            const s = JSON.parse(sys.localStorage.getItem(SETTINGS_KEY) || '{}');
            if (typeof s.musicVolume === 'number') this.musicVolume = Math.max(0, Math.min(1, s.musicVolume));
            if (typeof s.sfxVolume === 'number') this.sfxVolume = Math.max(0, Math.min(1, s.sfxVolume));
            const d = s.display || {};
            for (const k of Object.keys(Display) as DisplayKey[]) if (typeof d[k] === 'boolean') Display[k] = d[k];
        } catch (e) { /* keep defaults */ }
        this.music.volume = this.musicVolume * MUSIC_GAIN;
    }

    setVolumes(music: number, sfx: number) {
        this.musicVolume = Math.max(0, Math.min(1, music));
        this.sfxVolume = Math.max(0, Math.min(1, sfx));
        this.music.volume = this.musicVolume * MUSIC_GAIN;
        this.saveSettings();
    }

    /** Battle display options (Settings popup): damage numbers, health bars, effects. */
    setDisplay(key: DisplayKey, on: boolean) {
        Display[key] = on;
        this.saveSettings();
    }

    private saveSettings() {
        try {
            sys.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ musicVolume: this.musicVolume, sfxVolume: this.sfxVolume, display: Display }));
        } catch (e) { /* ignore */ }
    }

    /**
     * Loads every clip in resources/audio (all optional, see tools/audio).
     * Clips named "<name>_v1", "<name>_v2"... are variants of "<name>": one is picked at random.
     */
    private loadAudio(done: () => void) {
        resources.loadDir('audio', AudioClip, (err: any, clips: AudioClip[]) => {
            if (!err && clips) {
                for (const c of clips) {
                    this.clips[c.name] = c;
                    const base = c.name.replace(/_v\d+$/, '');
                    (this.variants[base] = this.variants[base] || []).push(c);
                }
            }
            done();
        });
    }

    /**
     * Background music: "bgm_castle" (main menu, castle, heroes), "bgm_battle" (battlefield),
     * "bgm_boss" (boss waves). Falls back to "bgm" when a track is missing. Playing the
     * track that is already on does nothing, so the music never restarts between screens.
     */
    playMusic(key: string) {
        const name = this.clips[key] ? key : (key === 'bgm_boss' && this.clips['bgm_battle'] ? 'bgm_battle' : 'bgm');
        if (name === this.musicKey) return;
        const clip = this.clips[name];
        if (!clip) return;
        this.musicKey = name;
        this.music.stop();
        this.music.clip = clip;
        this.music.loop = true;
        this.music.volume = this.musicVolume * MUSIC_GAIN;
        this.music.play();
    }

    /**
     * Plays a sound effect by name (or a random variant of it). Silently ignored when the
     * clip does not exist. The same sound is not repeated faster than SFX_GAP, so a big
     * battle does not stack dozens of identical sounds.
     */
    playSfx(name: string, fallback?: string) {
        if (this.sfxVolume <= 0) return;
        let list = this.variants[name];
        if (!list && fallback) { name = fallback; list = this.variants[name]; }
        if (!list || list.length === 0) return;
        const now = game.totalTime;
        const gap = sfxGap(name) * 1000;
        if (now - (this.lastSfx[name] || -1e9) < gap) return;
        this.lastSfx[name] = now;
        this.sfx.playOneShot(list[this.pickVariant(name, list.length)], this.sfxVolume);
    }

    /**
     * Random variant, never the same one twice in a row. Uses its own random generator
     * so sounds never change the game's random numbers (battles stay reproducible).
     */
    private pickVariant(name: string, count: number): number {
        if (count <= 1) return 0;
        this.sfxSeed = (this.sfxSeed * 1103515245 + 12345) & 0x7fffffff;
        const r = this.sfxSeed >>> 16;   // high bits: the low bits of this generator repeat quickly
        let i = r % count;
        if (i === this.lastVariant[name]) i = (i + 1 + (r >>> 4) % (count - 1)) % count;
        this.lastVariant[name] = i;
        return i;
    }

    onDestroy() {
        game.off(Game.EVENT_HIDE, this.onHide, this);
        view.off('canvas-resize', this.onResize, this);
    }
}
