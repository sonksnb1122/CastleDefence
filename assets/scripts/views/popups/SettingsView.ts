import { _decorator, Node, Label } from 'cc';
import { PopupView } from './PopupView';
const { ccclass, property } = _decorator;

/** prefabs/popups/Settings: music and sound effect volume, battle display options. */
@ccclass('SettingsView')
export class SettingsView extends PopupView {
    @property(Node) musicBar: Node | null = null;
    @property(Label) musicValue: Label | null = null;
    @property(Node) musicMinus: Node | null = null;
    @property(Node) musicPlus: Node | null = null;
    @property(Node) sfxBar: Node | null = null;
    @property(Label) sfxValue: Label | null = null;
    @property(Node) sfxMinus: Node | null = null;
    @property(Node) sfxPlus: Node | null = null;
    @property(Node) damageToggle: Node | null = null;
    @property(Node) hpBarToggle: Node | null = null;
    @property(Node) effectsToggle: Node | null = null;
    @property(Node) closeButton: Node | null = null;
}
