import { Node, Label } from 'cc';
import { LoadingView } from './screens/LoadingView';
import { FillBar, PrefabUi } from './common/PrefabUi';
import { COLORS, hex } from './common/UIKit';

/** First thing shown when the game starts (prefabs/screens/Loading): title, progress bar and current loading step. */
export class LoadingScreen {
    root: Node;
    private bar: FillBar;
    private label: Label;
    private percent: Label;
    private error: Label;

    constructor(parent: Node) {
        const v = PrefabUi.view('screens/Loading', parent, LoadingView);
        this.root = v.node;
        this.bar = new FillBar(v.bar, COLORS.accent);
        this.percent = v.percent!;
        this.label = v.step!;
        this.error = v.error!;
        this.error.string = '';
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
        this.error.string = 'CONFIG ERROR\n' + lines.slice(0, 18).join('\n');
    }

    destroy() { this.root.destroy(); }
}
