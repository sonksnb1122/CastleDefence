import { resources, assetManager, AssetManager, Texture2D, SpriteFrame, Rect, Size, Vec2, JsonAsset, Prefab } from 'cc';

/**
 * Loads textures from assets/resources and slices sprite sheets into
 * SpriteFrames at runtime. Missing textures are tolerated: callers get an
 * empty frame list and fall back to placeholder labels.
 */
export class Assets {
    private static textures = new Map<string, Texture2D>();
    private static frameCache = new Map<string, SpriteFrame[]>();
    static missing: string[] = [];
    /**
     * Sheets packed into an atlas texture (tools/atlas/pack_atlas.py): path -> region of the atlas.
     * Every frame of those sheets shares one texture, so the battle draws in a few batches.
     */
    private static regions = new Map<string, { tex: Texture2D; x: number; y: number; w: number; h: number }>();
    private static white: SpriteFrame | null = null;
    /** Paths that must keep smooth (linear) filtering instead of the pixel-art default. */
    static linear = new Set<string>();

    /**
     * Load an atlas made by tools/atlas/pack_atlas.py (manifest JSON + image). Sheets found in it are
     * served from the atlas; loadTextures() then skips them. A missing atlas is not an error.
     */
    static loadAtlas(manifestPath: string, done: () => void) {
        resources.load(manifestPath, JsonAsset, (err: any, asset: JsonAsset) => {
            const m = !err && asset ? asset.json : null;
            if (!m || !m.image || !m.regions || !resources.getInfoWithPath(m.image + '/texture', Texture2D)) { done(); return; }
            resources.load(m.image + '/texture', Texture2D, (e2: any, tex: Texture2D) => {
                if (!e2 && tex) {
                    // "linear": smooth art (the research icons); otherwise pixel art keeps hard edges.
                    const f = m.linear ? Texture2D.Filter.LINEAR : Texture2D.Filter.NEAREST;
                    tex.setFilters(f, f);
                    tex.setMipFilter(Texture2D.Filter.NONE);
                    for (const k in m.regions) {
                        const r = m.regions[k];
                        Assets.regions.set(k, { tex, x: r[0], y: r[1], w: r[2], h: r[3] });
                    }
                }
                done();
            });
        });
    }

    static loadTextures(paths: string[], done: () => void, onProgress?: (loaded: number, total: number) => void) {
        const list = Array.from(new Set(paths)).filter(p => !Assets.regions.has(p));
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

    // ------------------------------------------------------------------ prefabs
    private static prefabs = new Map<string, Prefab>();

    /**
     * Preload prefabs of the "prefabs" bundle (assets/prefabs), e.g. "popups/Pause".
     * Every screen and popup is a prefab, so a missing one is reported as an error.
     */
    static loadPrefabs(names: string[], done: () => void) {
        Assets.bundleFor('prefabs:', bundle => {
            const todo = names.filter(n => !Assets.prefabs.has(n));
            let left = todo.length;
            if (!bundle) console.error('[Assets] the "prefabs" bundle (assets/prefabs) could not be loaded');
            if (!bundle || left === 0) { done(); return; }
            for (const name of todo) {
                bundle.load(name, Prefab, (err: any, p: Prefab) => {
                    if (!err && p) Assets.prefabs.set(name, p);
                    else console.error('[Assets] prefab not loaded: ' + name + (err ? ' (' + err.message + ')' : ''));
                    if (--left === 0) done();
                });
            }
        });
    }

    /** A preloaded prefab, or null when it is missing. */
    static prefab(name: string): Prefab | null { return Assets.prefabs.get(name) || null; }

    static has(path: string): boolean { return Assets.textures.has(path) || Assets.regions.has(path); }

    /** Texture and rectangle of a sheet (the whole texture, or its region of an atlas). */
    private static area(path: string): { tex: Texture2D; x: number; y: number; w: number; h: number } | null {
        const r = Assets.regions.get(path);
        if (r) return r;
        const tex = Assets.textures.get(path);
        return tex ? { tex, x: 0, y: 0, w: tex.width, h: tex.height } : null;
    }

    /**
     * Plain white frame for health bars and flat shapes. Taken from the combat atlas when there is one
     * (so bars batch with the enemy sprites), otherwise from a tiny texture made at runtime.
     */
    static whiteFrame(): SpriteFrame {
        if (Assets.white) return Assets.white;
        const r = Assets.regions.get('white');
        const sf = new SpriteFrame();
        if (r) {
            // Use the middle of the block so filtering never reaches its transparent border.
            sf.reset({ texture: r.tex, rect: new Rect(r.x + 2, r.y + 2, r.w - 4, r.h - 4), originalSize: new Size(r.w - 4, r.h - 4), offset: new Vec2(0, 0) } as any);
        } else {
            const tex = new Texture2D();
            tex.reset({ width: 4, height: 4, format: Texture2D.PixelFormat.RGBA8888 });
            tex.uploadData(new Uint8Array(4 * 4 * 4).fill(255));
            sf.reset({ texture: tex, rect: new Rect(0, 0, 4, 4), originalSize: new Size(4, 4), offset: new Vec2(0, 0) } as any);
        }
        sf.packable = false;
        Assets.white = sf;
        return sf;
    }
    static texture(path: string): Texture2D | null { return Assets.textures.get(path) || null; }

    /**
     * Load one big texture on demand (hero cards). It is NOT kept in the cache:
     * the caller owns it and must hand it back with releaseTexture().
     */
    static loadTextureOnDemand(path: string, done: (tex: Texture2D | null) => void) {
        Assets.bundleFor(path, (bundle, inner) => {
            if (!bundle || !bundle.getInfoWithPath(inner + '/texture', Texture2D)) { done(null); return; }
            bundle.load(inner + '/texture', Texture2D, (err: any, tex: Texture2D) => {
                if (err || !tex) { done(null); return; }
                tex.setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR);
                // The engine hands out the SAME texture object to everyone who loads this path
                // (e.g. a card in the list and the same card in a popup), so users are counted.
                Assets.onDemandRefs.set(tex, (Assets.onDemandRefs.get(tex) || 0) + 1);
                done(tex);
            });
        });
    }

    /**
     * "bundle:path" loads from an asset bundle (e.g. "heroes:1_card_sheet" from assets/bundles/heroes),
     * a plain path loads from assets/resources. Bundles are loaded once and kept.
     */
    static bundleFor(path: string, done: (bundle: AssetManager.Bundle | null, inner: string) => void) {
        const i = path.indexOf(':');
        if (i < 0) { done(resources, path); return; }
        const name = path.substring(0, i), inner = path.substring(i + 1);
        const loaded = assetManager.getBundle(name);
        if (loaded) { done(loaded, inner); return; }
        assetManager.loadBundle(name, (err: any, bundle: AssetManager.Bundle) => done(err ? null : bundle, inner));
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
    /**
     * A part of a picture as a 9-sliced frame (cached by path and rect), for example only the bottom strip of a
     * frame. rect is in pixels from the top-left corner of the picture.
     */
    static slicedPart(path: string, rect: { x: number; y: number; w: number; h: number }, insets: { left: number; right: number; top: number; bottom: number }): SpriteFrame | null {
        const key = `${path}#${rect.x},${rect.y},${rect.w},${rect.h}`;
        const cached = Assets.slicedCache.get(key);
        if (cached) return cached;
        const tex = Assets.textures.get(path);
        if (!tex) return null;
        const sf = new SpriteFrame();
        sf.reset({
            texture: tex, rect: new Rect(rect.x, rect.y, rect.w, rect.h), originalSize: new Size(rect.w, rect.h), offset: new Vec2(0, 0),
            borderLeft: insets.left, borderRight: insets.right, borderTop: insets.top, borderBottom: insets.bottom,
        } as any);
        sf.insetLeft = insets.left; sf.insetRight = insets.right; sf.insetTop = insets.top; sf.insetBottom = insets.bottom;
        sf.packable = false;
        Assets.slicedCache.set(key, sf);
        return sf;
    }

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
        const a = Assets.area(path);
        const list: SpriteFrame[] = [];
        if (a) {
            const cols = Math.floor(a.w / cellW);
            const rows = Math.floor(a.h / cellH);
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    const sf = new SpriteFrame();
                    sf.reset({
                        texture: a.tex,
                        rect: new Rect(a.x + c * cellW, a.y + r * cellH, cellW, cellH),
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
        const a = Assets.area(path);
        return a ? Math.max(1, Math.floor(a.w / cellW)) : 1;
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
