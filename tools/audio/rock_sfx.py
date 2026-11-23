"""Procedural stone sounds for the game (no samples needed).

  wall_hit_v1..v3   heavy blow on the stone wall: deep boom, dull crack, grinding stone, chunks
  explode_v1..v3    catapult boulder landing: huge boom, ground shaking, a bounce, falling rocks
Usage: python rock_sfx.py <out dir>      (writes 44.1 kHz mono 16-bit wav)
"""
import sys, os, wave
import numpy as np
from scipy.signal import butter, sosfilt

SR = 44100

def noise(n, rng):
    return rng.standard_normal(n)

def band(x, lo, hi):
    sos = butter(4, [lo, hi], btype='band', fs=SR, output='sos')
    return sosfilt(sos, x)

def low(x, f):
    return sosfilt(butter(4, f, btype='low', fs=SR, output='sos'), x)

def env(n, attack, decay):
    t = np.arange(n) / SR
    e = np.exp(-t / decay)
    a = int(attack * SR)
    if a > 0: e[:a] *= np.linspace(0, 1, a)
    return e

def thud(dur, f0, f1, decay, rng):
    """Low body hit: sine sweeping down plus low-passed noise."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = f1 + (f0 - f1) * np.exp(-t / 0.05)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * env(n, 0.002, decay)
    rumble = low(noise(n, rng), 300) * env(n, 0.003, decay * 1.6) * 0.8
    return body + rumble

def crack(dur, rng, lo=1500, hi=7000):
    n = int(dur * SR)
    return band(noise(n, rng), lo, hi) * env(n, 0.0005, 0.012)

def grains(total, count, start, spread, rng, size=(0.006, 0.03), loud=(0.15, 0.5), freq=(800, 5000)):
    """Small stone chips / pebbles: short filtered noise bursts, denser at the start."""
    out = np.zeros(int(total * SR))
    for _ in range(count):
        at = start + rng.exponential(spread)
        if at >= total - 0.05: continue
        d = rng.uniform(*size)
        n = int(d * SR) + 64
        fc = rng.uniform(*freq)
        g = band(noise(n, rng), fc * 0.6, min(fc * 1.6, SR / 2 - 100)) * env(n, 0.0003, d / 3)
        g *= rng.uniform(*loud) * np.exp(-at / (spread * 3))
        i = int(at * SR)
        out[i:i + n] += g[: len(out) - i]
    return out

def finish(x, peak=0.89):
    x = x - np.mean(x)
    fade = int(0.02 * SR)
    x[-fade:] *= np.linspace(1, 0, fade)
    return x / (np.max(np.abs(x)) + 1e-9) * peak

def save(path, x):
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes())

def boom(total, f0, f1, decay, rng):
    """Very low impact: sub-bass sine sweep with a soft-clipped body, felt more than heard."""
    n = int(total * SR)
    t = np.arange(n) / SR
    f = f1 + (f0 - f1) * np.exp(-t / 0.08)
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, 0.003, decay)
    body = low(noise(n, rng), 220) * env(n, 0.004, decay * 0.9) * 1.4
    return np.tanh((sub + body) * 1.8)  # saturation makes it thicker / heavier


def wall_hit(seed):
    """A heavy blow on a thick stone wall: deep boom, dull crack, stones grinding, a few chunks."""
    rng = np.random.default_rng(seed)
    total = 0.9
    n = int(total * SR)
    x = boom(total, rng.uniform(75, 90), rng.uniform(30, 38), 0.16, rng) * 1.0
    x += thud(total, rng.uniform(150, 180), rng.uniform(60, 75), 0.06, rng)[:n] * 0.45   # the hit itself
    c = band(noise(int(0.06 * SR), rng), 400, 2500) * env(int(0.06 * SR), 0.0008, 0.02) * 0.6  # dull crack
    x[: len(c)] += c
    x += low(noise(n, rng), 120) * env(n, 0.02, 0.25) * 0.35                       # stone grinding / rumble
    x += grains(total, 12, 0.02, 0.08, rng, size=(0.015, 0.05), loud=(0.08, 0.25), freq=(250, 1500))
    return finish(x)


def rock_fall(seed):
    """A catapult boulder landing: huge boom, ground shaking, then rocks tumbling and settling."""
    rng = np.random.default_rng(seed)
    total = 1.8
    n = int(total * SR)
    x = boom(total, rng.uniform(65, 80), rng.uniform(24, 30), 0.3, rng) * 1.1
    x += thud(total, rng.uniform(120, 140), rng.uniform(45, 55), 0.09, rng)[:n] * 0.5
    c = band(noise(int(0.1 * SR), rng), 300, 3000) * env(int(0.1 * SR), 0.001, 0.03) * 0.6
    x[: len(c)] += c
    # Ground shaking: long low rumble.
    x += low(noise(n, rng), 90) * env(n, 0.03, 0.6) * 0.6
    # A second, smaller bounce of the boulder.
    at = int(rng.uniform(0.22, 0.3) * SR)
    b2 = boom(total, 70, 30, 0.12, rng)[: n - at] * 0.35
    x[at:] += b2
    # Heavy chunks then smaller stones falling back (mostly low-mid, little hiss).
    x += grains(total, 30, 0.05, 0.25, rng, size=(0.02, 0.07), loud=(0.1, 0.35), freq=(180, 1200))
    x += grains(total, 35, 0.15, 0.35, rng, size=(0.01, 0.04), loud=(0.05, 0.16), freq=(500, 2500))
    return finish(x)

if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    os.makedirs(out, exist_ok=True)
    for i in range(3):
        save(os.path.join(out, f'wall_hit_v{i + 1}.wav'), wall_hit(100 + i))
        save(os.path.join(out, f'explode_v{i + 1}.wav'), rock_fall(200 + i))
    print('ok')
