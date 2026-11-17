import { Node, Graphics, Label } from 'cc';
import { G } from '../core/Globals';
import { Bar, COLORS, hex, mk, text } from '../ui/UIKit';

/** First thing shown when the game starts: title, progress bar and current loading step. */
export class LoadingScreen {
    root: Node;
    private bar: Bar;
    private label: Label;
    private percent: Label;

    constructor(parent: Node) {
        const W = G.main.W, H = G.main.H;
        this.root = mk('Loading', parent);
        const g = this.root.addComponent(Graphics);
        g.fillColor = hex('#1b1626');
        g.rect(-W / 2 - 400, -H / 2 - 400, W + 800, H + 800);
        g.fill();
        text(this.root, 'CASTLE DEFENSE', 52, 0, 90, { bold: true, color: COLORS.accent });
        this.bar = new Bar(this.root, 0, -40, 420, 18, COLORS.accent);
        this.percent = text(this.root, '0%', 16, 0, -40, { bold: true, color: '#1b1626' });
        this.label = text(this.root, 'Loading...', 16, 0, -76, { color: COLORS.textDim });
        this.set(0, 'Loading...');
    }

    /** progress is 0..1 */
    set(progress: number, step: string) {
        const p = Math.max(0, Math.min(1, progress));
        this.bar.set(p);
        this.percent.string = Math.round(p * 100) + '%';
        this.percent.color = hex(p > 0.5 ? '#1b1626' : COLORS.text);
        this.label.string = step;
    }

    /** Replace the progress with a list of fatal errors (kept on screen). */
    showError(lines: string[]) {
        this.bar.node.active = false;
        this.percent.string = '';
        this.label.string = '';
        text(this.root, 'CONFIG ERROR\n' + lines.slice(0, 18).join('\n'), 13, 0, 30, { color: '#ff8a8a', width: G.main.W - 80, ay: 1, align: 'left' });
    }

    destroy() { this.root.destroy(); }
}
