import { ConfigMgr } from '../ConfigMgr';
import { TRADE_KEYS as RESOURCE_KEYS } from '../GameTypes';
import type { ResourceMgr } from '../ResourceMgr';

/**
 * Market of the Base: trade one resource for another (building.json "trade").
 *   price(r)  = values[r] * (1 +/- fluctuation %), a new random change every wave
 *   received  = floor(amount * price(from) / price(to) * (1 - fee / 100))
 * The fee gets lower with the Base level ("feeByBaseLevel", in %). The price changes come
 * from the game's market seed and the wave number, so reopening the Market never re-rolls them.
 */
export class TradeService {
    constructor(private rm: ResourceMgr) {}

    private get cfg(): any { return ConfigMgr.building.trade || {}; }

    /** Fee in % at the current Base level. */
    get fee(): number {
        const fees: number[] = this.cfg.feeByBaseLevel || [30];
        return fees[Math.min(fees.length, Math.max(1, this.rm.baseLevel)) - 1];
    }

    /** This wave's price change of a resource: 1 = normal, 1.2 = +20%. */
    priceChange(r: string): number {
        const f = (this.cfg.fluctuation || 0) / 100;
        if (f <= 0) return 1;
        const k = RESOURCE_KEYS.indexOf(r) + 1;
        // Small integer hash of (seed, wave, resource) -> [0, 1).
        let h = ((this.rm.data.marketSeed || 0) ^ (this.rm.data.currentWave * 374761393) ^ (k * 668265263)) >>> 0;
        h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
        h = (h ^ (h >>> 16)) >>> 0;
        return 1 + f * (2 * (h / 4294967296) - 1);
    }

    /** Value of one unit of a resource this wave. */
    price(r: string): number { return ((this.cfg.values || {})[r] || 1) * this.priceChange(r); }

    /** How much of `to` one unit of `from` buys (fee included). */
    rate(from: string, to: string): number {
        return (this.price(from) / this.price(to)) * (1 - this.fee / 100);
    }

    /** Amount received for `amount` of `from`. */
    quote(from: string, to: string, amount: number): number {
        if (from === to || amount <= 0) return 0;
        return Math.floor(amount * this.rate(from, to) + 1e-9);
    }

    /** Trade `amount` of `from` for `to`. Returns an error message, or null when done. */
    trade(from: string, to: string, amount: number): string | null {
        const rm = this.rm;
        if (!rm.isPreparation) return 'Cannot trade during combat';
        if (RESOURCE_KEYS.indexOf(from) < 0 || RESOURCE_KEYS.indexOf(to) < 0 || from === to) return 'Choose two different resources';
        amount = Math.floor(amount);
        if (amount <= 0) return 'Choose an amount';
        const got = this.quote(from, to, amount);
        if (got <= 0) return 'Amount too small';
        if (!rm.spend({ [from]: amount })) return 'Not enough ' + from;
        rm.add({ [to]: got });
        return null;
    }
}
