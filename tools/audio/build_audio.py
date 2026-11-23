"""Builds the game's audio files (assets/resources/audio) from the downloaded sound packs.

Usage: python build_audio.py <packs dir> <synth dir> <out dir>
  <packs dir>  folder with the unzipped packs (see SOURCES below)
  <synth dir>  output of rock_sfx.py (stone sounds made by code)
  <out dir>    assets/resources/audio

What it does to keep the build small:
  - music: only one loop of each track is kept (Knights chamber: its loop part 0:38.275-1:48.620,
    the battle tracks already loop as whole files), 44.1 kHz stereo MP3 at 112 kbps
    (about 1/20 of the original 24-bit WAV files);
  - sound effects: silence at both ends is cut, long tails are shortened with a fade,
    everything is mono 44.1 kHz MP3 at 80 kbps and peak-normalised per sound
    (frequent combat sounds are quieter than UI / event sounds).
Needs ffmpeg in PATH, numpy.
"""
import os, sys, subprocess
import numpy as np

SR = 44100

# key: (source file relative to the packs dir, max seconds, peak dB)
SFX = {
    # UI and events
    # buttons: 4 short clicks (click + click_v2..v4 are variants), one is picked at random each time
    'click':          ('RPG_Essentials_Free/10_UI_Menu_SFX/001_Hover_01.wav', 0.3, -4),
    'click_v2':       ('RPG_Essentials_Free/10_UI_Menu_SFX/092_Pause_04.wav', 0.3, -5),
    'click_v3':       ('RPG_Essentials_Free/10_UI_Menu_SFX/070_Equip_10.wav', 0.35, -5),
    'click_v4':       ('Fantasy_Audio_Starter_Pack/pre-game sounds/UI2.wav', 0.2, -5),
    'denied':         ('RPG_Essentials_Free/10_UI_Menu_SFX/033_Denied_03.wav', 0.6, -4),
    'coin':           ('RPG_Essentials_Free/10_UI_Menu_SFX/079_Buy_sell_01.wav', 0.6, -12),
    'upgrade':        ('RPG_Essentials_Free/8_Buffs_Heals_SFX/17_Def_buff_01.wav', 1.6, -4),
    'wave_start':     ('RPG_Essentials_Free/10_Battle_SFX/55_Encounter_02.wav', 2.5, -3),
    'win':            ('RPG_Essentials_Free/8_Buffs_Heals_SFX/16_Atk_buff_04.wav', 2.5, -3),
    'lose':           ('RPG_Essentials_Free/8_Buffs_Heals_SFX/21_Debuff_01.wav', 3.0, -3),
    'boss':           ('Classic_Monster_Sounds/Monster Sounds/Behemoth/Behemoth_Emerge.wav', 2.5, -2),
    # towers firing
    'shoot_crossbow': ('Fantasy_Audio_Starter_Pack/pre-game sounds/bowShooting.wav', 0.45, -14),
    'shoot_crystal':  ('RPG_Essentials_Free/8_Atk_Magic_SFX/45_Charge_05.wav', 0.6, -14),
    'shoot_catapult': ('Fantasy_Audio_Starter_Pack/pre-game sounds/flaskThrow.wav', 0.6, -9),
    # projectile hits
    'hit_crossbow':   ('RPG_Essentials_Free/10_Battle_SFX/15_Impact_flesh_02.wav', 0.35, -13),
    'hit_crystal':    ('Basic_Spell_Impacts/Ice Spell Impacts/Ice Spell Impact 1.wav', 0.8, -12),
    # special effects
    'fx_frost':       ('Basic_Spell_Impacts/Ice Spell Impacts/Ice Spell Impact 3.wav', 1.0, -10),
    'fx_lightning':   ('Basic_Spell_Impacts/Lightning Spell Impacts/Lightning Spell Impact 2.wav', 1.0, -9),
    'fx_bleed':       ('Fantasy_Audio_Starter_Pack/pre-game sounds/sliceFlesh.wav', 0.5, -12),
    # enemies dying (one per enemy id of enemy.json)
    'die_berserker':  ('Classic_Monster_Sounds/Monster Sounds/Spider/Spider_Death.wav', 1.0, -11),
    'die_runner':     ('Classic_Monster_Sounds/Monster Sounds/Hornet/Hornet_Death.wav', 1.0, -12),
    'die_tank':       ('RPG_Essentials_Free/10_Battle_SFX/69_Enemy_death_01.wav', 1.0, -11),
    'die_juggernaut': ('Classic_Monster_Sounds/Monster Sounds/Behemoth/Behemoth_Death.wav', 1.4, -8),
}

# Stone sounds made by rock_sfx.py: (file in synth dir, max seconds, peak dB)
SYNTH = {
    'wall_hit_v1': ('wall_hit_v1.wav', 0.9, -4), 'wall_hit_v2': ('wall_hit_v2.wav', 0.9, -4), 'wall_hit_v3': ('wall_hit_v3.wav', 0.9, -4),
    'explode_v1': ('explode_v1.wav', 1.8, -5), 'explode_v2': ('explode_v2.wav', 1.8, -5), 'explode_v3': ('explode_v3.wav', 1.8, -5),
}

# key: (source, loop start s, loop end s or None = end of file)
MUSIC = {
    'bgm_castle': ('Village_Medieval_MP_-_Knights_chamber/Knights chamber 96kHz.wav', 38.275, 108.620),
    'bgm_battle': ('Battle_Medieval_MP/Fate_of_battle_48kHz.wav', 0, None),
    'bgm_boss':   ('Battle_Medieval_MP/First_Battle_48kHz.wav', 0, None),
}


def decode(path, channels):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', str(channels), '-ar', str(SR), '-f', 'f32le', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, channels).copy()


def encode(x, path, kbps):
    ch = x.shape[1]
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', str(ch), '-i', '-',
                    '-c:a', 'libmp3lame', '-b:a', f'{kbps}k', path], input=x.astype(np.float32).tobytes(), check=True)


def trim_silence(x, thr_db=-50):
    level = np.max(np.abs(x), axis=1)
    loud = np.where(level > 10 ** (thr_db / 20))[0]
    if len(loud) == 0: return x
    return x[max(0, loud[0] - int(0.002 * SR)): loud[-1] + 1]


def sfx(src, out, max_s, peak_db):
    x = trim_silence(decode(src, 1))
    n = int(max_s * SR)
    if len(x) > n:
        x = x[:n]
        f = min(len(x), int(0.08 * SR))
        x[-f:] *= np.linspace(1, 0, f)[:, None]
    f = min(len(x), int(0.01 * SR))
    x[-f:] *= np.linspace(1, 0, f)[:, None]
    x *= 10 ** (peak_db / 20) / (np.max(np.abs(x)) + 1e-9)
    encode(x, out, 80)


def music(src, out, start, end):
    x = decode(src, 2)
    a = int(round(start * SR))
    b = len(x) if end is None else min(len(x), int(round(end * SR)))
    x = x[a:b]
    encode(x, out, 112)


if __name__ == '__main__':
    packs, synth, out = sys.argv[1:4]
    os.makedirs(out, exist_ok=True)
    for k, (src, mx, pk) in SFX.items(): sfx(os.path.join(packs, src), os.path.join(out, k + '.mp3'), mx, pk)
    for k, (src, mx, pk) in SYNTH.items(): sfx(os.path.join(synth, src), os.path.join(out, k + '.mp3'), mx, pk)
    for k, (src, a, b) in MUSIC.items(): music(os.path.join(packs, src), os.path.join(out, k + '.mp3'), a, b)
    total = sum(os.path.getsize(os.path.join(out, f)) for f in os.listdir(out) if f.endswith('.mp3'))
    print('wrote', len(SFX) + len(SYNTH) + len(MUSIC), 'files,', round(total / 1024), 'KB')
