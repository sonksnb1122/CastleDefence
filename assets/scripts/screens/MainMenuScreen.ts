import { Node, Graphics } from 'cc';
import { ConfigMgr } from '../core/ConfigMgr';
import { G } from '../core/Globals';
import { COLORS, button, hex, mk, text } from '../ui/UIKit';

/** Title screen: New Game, Load Game, Setting, Quit Game. */
export class MainMenuScreen {
    root: Node;

    constructor(parent: Node) {
        const W = G.main.W, H = G.main.H;
        this.root = mk('MainMenu', parent);
        const g = this.root.addComponent(Graphics);
        g.fillColor = hex('#1b1626');
        g.rect(-W / 2 - 200, -H / 2 - 200, W + 400, H + 400);
        g.fill();
        // Simple pixel skyline so the menu is not an empty color.
        g.fillColor = hex('#2a2438');
        for (let i = 0; i < 16; i++) {
            const h = 70 + ((i * 37) % 90);
            g.rect(-W / 2 + i * 70, -H / 2, 60, h);
            g.rect(-W / 2 + i * 70 + 8, -H / 2 + h, 12, 14);
            g.rect(-W / 2 + i * 70 + 38, -H / 2 + h, 12, 14);
        }
        g.fill();

        text(this.root, 'CASTLE DEFENSE', 56, 0, 190, { bold: true, color: COLORS.accent });
        text(this.root, 'Hold the wall. Grow the castle.', 18, 0, 140, { color: COLORS.textDim });

        const items: Array<[string, () => void, string]> = [
            ['New Game', () => G.main.newGame(), COLORS.buttonOk],
            ['Load Game', () => G.main.openOverlay('load'), COLORS.button],
            ['Setting', () => G.main.openOverlay('settings'), COLORS.button],
            ['Quit Game', () => G.main.quitGame(), COLORS.buttonDanger],
        ];
        items.forEach((it, i) => button(this.root, it[0], 0, 60 - i * 62, 260, 50, it[1], it[2], 22));

        if (ConfigMgr.warnings.length > 0) {
            text(this.root, ConfigMgr.warnings.slice(0, 4).join('\n'), 12, -W / 2 + 10, -H / 2 + 10, { ax: 0, ay: 0, color: '#ffb36b' });
        }
    }

    update(_dt: number) { /* static screen */ }
    destroy() { this.root.destroy(); }
}
