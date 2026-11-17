import { resources, assetManager, Texture2D, SpriteFrame, Rect, Size, Vec2, JsonAsset } from 'cc';

/**
 * Loads textures from assets/resources and slices sprite sheets into
 * SpriteFrames at runtime. Missing textures are tolerated: callers get an
 * empty frame list and fall back to placeholder labels.
 */
export class Assets {
    private static textures = new Map<string, Texture2D>();
    private static frameCache = new Map<string, SpriteFrame[]>();
    static missing: string[] = [];
    /** Paths that must keep smooth (linear) filtering instead of the pixel-art default. */
    static linear = new Set<string>();

    static loadTextures(paths: string[], done: () => void, onProgress?: (loaded: number, total: number) => void) {
        const list = Array.from(new Set(paths));
        let remaining = list.length;
        if (remaining === 0) { done(); return; }
        const step = () => { if (onProgress) onProgress(list.length - remaining, list.length); };
        for (const path of list) {
            // Ask the bundle first so optional art that does not exist never logs a load error.
            if (!resources.getInfoWithPath(path + '/texture', Texture2D)) {
                Assets.missing.push(path);
                --remaining; step();
                if (remaining === 0) done();
                continue;
            }
            resources.load(path + '/texture', Texture2D, (err: any, tex: Texture2D) => {
                if (err || !tex) {
                    Assets.missing.push(path);
                } else {
                    // Pixel art keeps hard edges when scaled; smooth art stays linear.
                    const f = Assets.linear.has(path) ? Texture2D.Filter.LINEAR : Texture2D.Filter.NEAREST;
                    tex.setFilters(f, f);
                    tex.setMipFilter(Texture2D.Filter.NONE);
                    Assets.textures.set(path, tex);
                }
                --remaining; step();
                if (remaining === 0) done();
            });
        }
    }

    static loadJson(path: string, done: (err: string | null, data: any) => void) {
        resources.load(path, JsonAsset, (err: any, asset: JsonAsset) => {
            if (err || !asset) done(`Cannot load "${path}": ${err ? err.message : 'not found'}`, null);
            else done(null, asset.json);
        });
    }

    static has(path: string): boolean { return Assets.textures.has(path); }
    static texture(path: string): Texture2D | null { return Assets.textures.get(path) || null; }

    /**
     * Load one big texture on demand (hero cards). It is NOT kept in the cache:
     * the caller owns it and must hand it back with releaseTexture().
     */
    static loadTextureOnDemand(path: string, done: (tex: Texture2D | null) => void) {
        if (!resources.getInfoWithPath(path + '/texture', Texture2D)) { done(null); return; }
        resources.load(path + '/texture', Texture2D, (err: any, tex: Texture2D) => {
            if (err || !tex) { done(null); return; }
            tex.setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR);
            // The engine hands out the SAME texture object to everyone who loads this path
            // (e.g. a card in the list and the same card in a popup), so users are counted.
            Assets.onDemandRefs.set(tex, (Assets.onDemandRefs.get(tex) || 0) + 1);
            done(tex);
        });
    }

    /** How many users currently hold each on-demand texture. */
    private static onDemandRefs = new Map<Texture2D, number>();

    /**
     * Give back a texture obtained from loadTextureOnDemand(). The GPU memory is
     * only freed when the last user has released it.
     */
    static releaseTexture(tex: Texture2D | null) {
        if (!tex) return;
        const left = (Assets.onDemandRefs.get(tex) || 1) - 1;
        if (left > 0) { Assets.onDemandRefs.set(tex, left); return; }
        Assets.onDemandRefs.delete(tex);
        assetManager.releaseAsset(tex);
    }

    /** Slice the first `count` cells of a texture, row by row. The frames are not cached. */
    static slice(tex: Texture2D, cellW: number, cellH: number, count: number): SpriteFrame[] {
        const cols = Math.max(1, Math.floor(tex.width / cellW));
        const out: SpriteFrame[] = [];
        for (let i = 0; i < count; i++) {
            const c = i % cols, r = Math.floor(i / cols);
            if ((r + 1) * cellH > tex.height) break;
            const sf = new SpriteFrame();
            sf.reset({ texture: tex, rect: new Rect(c * cellW, r * cellH, cellW, cellH), originalSize: new Size(cellW, cellH), offset: new Vec2(0, 0) } as any);
            sf.packable = false;
            out.push(sf);
        }
        return out;
    }

    private static slicedCache = new Map<string, SpriteFrame>();

    /**
     * Whole texture as one 9-slice frame: the four borders keep their size, the
     * middle stretches. Returns null if the texture is missing.
     */
    static slicedFrame(path: string, width: number, height: number, insets: { left: number; right: number; top: number; bottom: number }): SpriteFrame | null {
        const cached = Assets.slicedCache.get(path);
        if (cached) return cached;
        const tex = Assets.textures.get(path);
        if (!tex) return null;
        const sf = new SpriteFrame();
        sf.reset({
            texture: tex, rect: new Rect(0, 0, width, height), originalSize: new Size(width, height), offset: new Vec2(0, 0),
            borderLeft: insets.left, borderRight: insets.right, borderTop: insets.top, borderBottom: insets.bottom,
        } as any);
        sf.insetLeft = insets.left; sf.insetRight = insets.right; sf.insetTop = insets.top; sf.insetBottom = insets.bottom;
        sf.packable = false;
        Assets.slicedCache.set(path, sf);
        return sf;
    }

    /** Slice a sheet into cellW x cellH frames, row by row. Returns [] if the texture is missing. */
    static frames(path: string, cellW: number, cellH: number): SpriteFrame[] {
        const key = `${path}|${cellW}x${cellH}`;
        const cached = Assets.frameCache.get(key);
        if (cached) return cached;
        const tex = Assets.textures.get(path);
        const list: SpriteFrame[] = [];
        if (tex) {
            const cols = Math.floor(tex.width / cellW);
            const rows = Math.floor(tex.height / cellH);
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    const sf = new SpriteFrame();
                    sf.reset({
                        texture: tex,
                        rect: new Rect(c * cellW, r * cellH, cellW, cellH),
                        originalSize: new Size(cellW, cellH),
                        offset: new Vec2(0, 0),
                    } as any);
                    // Keep frames out of the dynamic atlas: it would filter the pixel art.
                    sf.packable = false;
                    list.push(sf);
                }
            }
        }
        Assets.frameCache.set(key, list);
        return list;
    }

    static cols(path: string, cellW: number): number {
        const tex = Assets.textures.get(path);
        return tex ? Math.max(1, Math.floor(tex.width / cellW)) : 1;
    }

    /** Frames of an animation range {row, start, count}. */
    static range(path: string, cellW: number, cellH: number, r: { row: number; start: number; count: number }): SpriteFrame[] {
        const all = Assets.frames(path, cellW, cellH);
        if (all.length === 0) return [];
        const cols = Assets.cols(path, cellW);
        const out: SpriteFrame[] = [];
        for (let i = 0; i < r.count; i++) {
            const f = all[r.row * cols + r.start + i];
            if (f) out.push(f);
        }
        return out;
    }

    /** Pick frames by index list (skips blank frames of a sheet). */
    static pick(path: string, cellW: number, cellH: number, indices?: number[]): SpriteFrame[] {
        const all = Assets.frames(path, cellW, cellH);
        if (!indices) return all;
        return indices.map(i => all[i]).filter(f => !!f);
    }
}
