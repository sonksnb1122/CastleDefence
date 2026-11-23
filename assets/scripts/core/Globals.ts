/**
 * Tiny service locator. Screens talk to Main through this object so that
 * screen files never import Main (avoids circular imports).
 */
export interface IMain {
    W: number;
    H: number;
    goto(screen: string, arg?: any): void;
    openOverlay(name: string, arg?: any): void;
    closeOverlay(): void;
    newGame(): void;
    saveToSlot(slot: number): boolean;
    loadFromSlot(slot: number): string | null;
    autoSave(): void;
    slotInfo(slot: number): { exists: boolean; wave: number; savedAt: number; valid: boolean };
    deleteSlot(slot: number): void;
    quitGame(): void;
    musicVolume: number;
    sfxVolume: number;
    setVolumes(music: number, sfx: number): void;
    /** Sound effect by name (random variant, rate limited); `fallback` is used when `name` has no clip. */
    playSfx(name: string, fallback?: string): void;
    /** Background music track (bgm_castle / bgm_battle / bgm_boss). */
    playMusic(key: string): void;
    after(seconds: number, fn: () => void): void;
}

export const G: { main: IMain } = { main: null as any };
