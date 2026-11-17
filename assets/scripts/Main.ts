import {
    _decorator, Component, Node, Layers, UITransform, view, ResolutionPolicy, sys, game, Game, macro,
    resources, AudioClip, AudioSource,
} from 'cc';
import { Assets } from './core/Assets';
import { ConfigMgr } from './core/ConfigMgr';
import { G, IMain } from './core/Globals';
import { ResourceMgr } from './core/ResourceMgr';
import { HeroRecruitScreen } from './screens/HeroRecruitScreen';
import { InCastleScreen } from './screens/InCastleScreen';
import { LoadingScreen } from './screens/LoadingScreen';
import { MainMenuScreen } from './screens/MainMenuScreen';
import { OutCastleScreen } from './screens/OutCastleScreen';
import { IOverlay, PauseOverlay, ResearchOverlay, SaveLoadOverlay, SettingsOverlay } from './screens/Overlays';

const { ccclass } = _decorator;

const DESIGN_W = 1024;
const DESIGN_H = 576;
const SAVE_KEY = 'castle_defense_save_';
const SETTINGS_KEY = 'castle_defense_settings';

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
    private screen: IScreen | null = null;
    private screenName = '';
    private overlays: IOverlay[] = [];
    private clips: { [name: string]: AudioClip } = {};
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
        this.music = this.makeLayer('Music').addComponent(AudioSource);
        this.sfx = this.makeLayer('Sfx').addComponent(AudioSource);
        this.loadSettings();
        // Shown from the very first frame so the player never looks at an empty screen.
        this.loading = new LoadingScreen(this.screenLayer);
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
        n.addComponent(UITransform);
        this.node.addChild(n);
        return n;
    }

    start() {
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
            Assets.loadTextures(paths, () => {
                ConfigMgr.checkAssets();
                loading.set(0.9, 'Loading audio...');
                this.loadAudio(() => {
                    loading.set(1, 'Ready');
                    // Leave the full bar visible for a moment, then open the main menu.
                    this.after(0.15, () => {
                        loading.destroy();
                        this.loading = null;
                        this.goto('menu');
                    });
                });
            }, (loaded, total) => loading.set(0.1 + 0.8 * loaded / total, `Loading sprites... ${loaded}/${total}`));
        });
    }

    // ------------------------------------------------------------------ screens & overlays
    goto(name: string, _arg?: any) {
        this.refreshSize();
        while (this.overlays.length > 0) this.overlays.pop()!.destroy();
        if (this.screen) { this.screen.destroy(); this.screen = null; }
        this.screenName = name;
        switch (name) {
            case 'inCastle': this.screen = new InCastleScreen(this.screenLayer); break;
            case 'outCastle': this.screen = new OutCastleScreen(this.screenLayer); break;
            case 'heroes': this.screen = new HeroRecruitScreen(this.screenLayer); break;
            default: this.screenName = 'menu'; this.screen = new MainMenuScreen(this.screenLayer);
        }
    }

    openOverlay(name: string, _arg?: any) {
        let o: IOverlay | null = null;
        switch (name) {
            case 'pause': o = new PauseOverlay(this.overlayLayer); break;
            case 'settings': o = new SettingsOverlay(this.overlayLayer); break;
            case 'load': o = new SaveLoadOverlay(this.overlayLayer, 'load'); break;
            case 'save': o = new SaveLoadOverlay(this.overlayLayer, 'save'); break;
            case 'research': o = new ResearchOverlay(this.overlayLayer); break;
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
        if (this.screen && this.overlays.length === 0) this.screen.update(dt);
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
        } catch (e) { /* keep defaults */ }
        this.music.volume = this.musicVolume;
    }

    setVolumes(music: number, sfx: number) {
        this.musicVolume = Math.max(0, Math.min(1, music));
        this.sfxVolume = Math.max(0, Math.min(1, sfx));
        this.music.volume = this.musicVolume;
        try { sys.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ musicVolume: this.musicVolume, sfxVolume: this.sfxVolume })); } catch (e) { /* ignore */ }
    }

    /** Loads every clip in resources/audio (optional). "bgm" becomes the looping music. */
    private loadAudio(done: () => void) {
        resources.loadDir('audio', AudioClip, (err: any, clips: AudioClip[]) => {
            if (!err && clips) {
                for (const c of clips) this.clips[c.name] = c;
                if (this.clips['bgm']) {
                    this.music.clip = this.clips['bgm'];
                    this.music.loop = true;
                    this.music.volume = this.musicVolume;
                    this.music.play();
                }
            }
            done();
        });
    }

    /** Plays a sound effect by clip name; silently ignored when the clip does not exist. */
    playSfx(name: string) {
        const clip = this.clips[name];
        if (clip && this.sfxVolume > 0) this.sfx.playOneShot(clip, this.sfxVolume);
    }

    onDestroy() {
        game.off(Game.EVENT_HIDE, this.onHide, this);
        view.off('canvas-resize', this.onResize, this);
    }
}
