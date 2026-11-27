import { Node } from 'cc';
import { Cost } from '../core/GameTypes';
import { G } from '../core/Globals';
import { WaveStats } from '../combat/WaveStats';
import { InfoView } from './popups/InfoView';
import { PrefabButton, PrefabUi } from './common/PrefabUi';
import { COLORS, ScrollList, costRow, panel, text } from './common/UIKit';

/** Tower order of the tables. */
const ORDER = ['crossbow', 'crystal', 'catapult', 'other'];
const ROW = 22;
const FONT = 15;

/** 1234 -> "1,234", 12345 -> "12.3K", 1234567 -> "1.23M". */
export function fmtNumber(n: number): string {
    n = Math.round(n);
    const a = Math.abs(n);
    if (a < 10000) return n.toLocaleString('en-US');
    if (a < 1e6) return (n / 1e3).toFixed(1) + 'K';
    if (a < 1e9) return (n / 1e6).toFixed(a < 1e8 ? 2 : 1) + 'M';
    return (n / 1e9).toFixed(2) + 'B';
}

const pct = (part: number, whole: number) => whole > 0 ? (part / whole * 100).toFixed(1) + '%' : '-';

interface Column { title: string; x: number; align: 'left' | 'right'; }

/**
 * "Wave N cleared!" window: rewards, then the wave statistics
 * (damage per tower type, shots that hit, effects triggered and the damage of each effect).
 */
export function waveStatsWindow(parent: Node, title: string, rewards: Array<{ label: string; cost: Cost } | string>, st: WaveStats) {
    const W = Math.min(820, G.main.W - 60), H = G.main.H - 50;
    const v = PrefabUi.view('popups/Info', parent, InfoView);
    v.setTitle(title);
    v.resize(W, H);
    const list = new ScrollList(v.content!, 0, 4, W - 40, H - 128, false);
    const host = list.content;
    const left = -(W - 40) / 2 + 14, right = (W - 40) / 2 - 14;
    let y = -6;

    // Rewards.
    for (const r of rewards) {
        if (typeof r === 'string') text(host, r, FONT, left, y - ROW / 2, { ax: 0, color: COLORS.textDim });
        else costRow(host, r.cost, left, y - ROW / 2, { label: r.label, size: 18, fontSize: FONT });
        y -= ROW;
    }
    y -= 4;
    text(host, `Time ${Math.round(st.time)} s    Kills ${st.kills}    Damage dealt ${fmtNumber(st.totalDamage)}`, FONT, left, y - ROW / 2, { ax: 0, color: COLORS.textDim });
    y -= ROW + 8;

    const table = (heading: string, cols: Column[], rows: string[][], colors?: string[]) => {
        text(host, heading, 17, left, y - ROW / 2, { ax: 0, bold: true, color: COLORS.accent });
        y -= ROW + 2;
        const row = (cells: string[], color: string, bold: boolean, shade: boolean) => {
            if (shade) panel(host, 0, y - ROW / 2, right - left + 16, ROW, '#ffffff', null, 14);
            cells.forEach((c, i) => {
                const col = cols[i];
                text(host, c, FONT, col.x, y - ROW / 2, { ax: col.align === 'left' ? 0 : 1, color, bold });
            });
            y -= ROW;
        };
        row(cols.map(c => c.title), COLORS.textDim, true, false);
        rows.forEach((r, i) => row(r, (colors && colors[i]) || COLORS.text, false, i % 2 === 0));
        if (rows.length === 0) { text(host, 'None', FONT, left, y - ROW / 2, { ax: 0, color: COLORS.textDim }); y -= ROW; }
        y -= 10;
    };

    // Towers.
    const span = right - left;
    const towers = st.towerList(ORDER);
    const total = st.totalDamage;
    table('Towers', [
        { title: 'Tower', x: left, align: 'left' },
        { title: 'Count', x: left + span * 0.30, align: 'right' },
        { title: 'Damage', x: left + span * 0.47, align: 'right' },
        { title: 'Share', x: left + span * 0.61, align: 'right' },
        { title: 'Shots', x: left + span * 0.76, align: 'right' },
        { title: 'Hit rate', x: right, align: 'right' },
    ], towers.map(t => [
        t.name, t.towers > 0 ? String(t.towers) : '-', fmtNumber(t.damage), pct(t.damage, total),
        t.shots > 0 ? fmtNumber(t.shots) : '-', t.shots > 0 ? pct(t.hits, t.shots) : '-',
    ]));

    // Effects.
    const effects = st.effectList(ORDER);
    const nameOf = (id: string) => (st.towers[id] && st.towers[id].name) || id;
    table('Effects', [
        { title: 'Effect', x: left, align: 'left' },
        { title: 'Tower', x: left + span * 0.47, align: 'right' },
        { title: 'Triggered', x: left + span * 0.62, align: 'right' },
        { title: 'Resisted', x: left + span * 0.75, align: 'right' },
        { title: 'Damage', x: left + span * 0.89, align: 'right' },
        { title: 'Share', x: right, align: 'right' },
    ], effects.map(e => [
        e.name, nameOf(e.towerId),
        e.triggers > 0 ? fmtNumber(e.triggers) : '-',
        e.resisted > 0 ? fmtNumber(e.resisted) : '-',
        e.dealsDamage ? fmtNumber(e.damage) : '-',
        !e.dealsDamage ? '-' : e.partOfHit ? '(' + pct(e.damage, total) + ')' : pct(e.damage, total),
    ]));
    text(host, 'Damage = HP removed (overkill not counted). The shares add up to 100%; (in brackets): mark bonus, part of the normal hits.', 13, left, y - ROW / 2, { ax: 0, color: COLORS.textDim });
    y -= ROW;

    list.setContentHeight(-y + 6);
    new PrefabButton(v.closeButton, () => v.close());
}
