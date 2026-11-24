/**
 * Display options of the battle (Settings popup), saved with the audio settings.
 *  - damageNumbers: damage / MISS / RESIST texts on the enemies
 *  - hpBars: health bars above the enemies
 *  - effects: hit and explosion animations, explosion rings, lightning lines and status icons on the enemies
 */
export const Display = {
    damageNumbers: true,
    hpBars: true,
    effects: true,
};

export type DisplayKey = keyof typeof Display;
