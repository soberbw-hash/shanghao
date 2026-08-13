"""Generate ShangHao's compact, warm UI sound pack.

The files are deliberately synthesized in-repo so routine UI feedback has no
third-party licensing dependency. Animal calls are separate real recordings.
"""

from __future__ import annotations

import math
import wave
from pathlib import Path

import numpy as np


RATE = 48_000
ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "src" / "renderer" / "src" / "assets" / "sounds"
RNG = np.random.default_rng(2_608_13)


def envelope(length: int, attack: float = 0.012, release: float = 0.2) -> np.ndarray:
    result = np.ones(length, dtype=np.float64)
    attack_samples = min(length, max(1, int(attack * RATE)))
    release_samples = min(length, max(1, int(release * RATE)))
    result[:attack_samples] = np.sin(np.linspace(0, math.pi / 2, attack_samples)) ** 1.6
    result[-release_samples:] *= np.cos(np.linspace(0, math.pi / 2, release_samples)) ** 1.8
    return result


def add_tone(
    track: np.ndarray,
    start: float,
    duration: float,
    frequency: float,
    level: float,
    *,
    target: float | None = None,
    attack: float = 0.01,
    release: float = 0.16,
    harmonics: tuple[float, ...] = (1.0, 0.3, 0.12),
) -> None:
    begin = int(start * RATE)
    length = min(len(track) - begin, int(duration * RATE))
    if length <= 0:
        return
    t = np.arange(length, dtype=np.float64) / RATE
    end_frequency = target if target is not None else frequency
    frequencies = np.linspace(frequency, end_frequency, length)
    phase = 2 * math.pi * np.cumsum(frequencies) / RATE
    signal = np.zeros(length, dtype=np.float64)
    for index, harmonic_level in enumerate(harmonics, start=1):
        signal += harmonic_level * np.sin(phase * index)
    signal /= max(1.0, sum(abs(value) for value in harmonics))
    track[begin : begin + length] += signal * envelope(length, attack, release) * level


def add_soft_noise(track: np.ndarray, start: float, duration: float, level: float) -> None:
    begin = int(start * RATE)
    length = min(len(track) - begin, int(duration * RATE))
    if length <= 0:
        return
    raw = RNG.normal(0, 1, length + 12)
    smooth = np.convolve(raw, np.ones(9) / 9, mode="valid")[:length]
    track[begin : begin + length] += smooth * envelope(length, 0.002, duration * 0.72) * level


def add_room(track: np.ndarray, amount: float = 0.12) -> np.ndarray:
    result = track.copy()
    for delay, level in ((0.029, amount), (0.061, amount * 0.55), (0.103, amount * 0.28)):
        samples = int(delay * RATE)
        result[samples:] += track[:-samples] * level
    return result


def finish(track: np.ndarray, *, room: float = 0.1, peak: float = 0.88) -> np.ndarray:
    track = add_room(track, room)
    track -= np.mean(track)
    track = np.tanh(track * 1.55) / np.tanh(1.55)
    maximum = float(np.max(np.abs(track))) or 1.0
    return (track / maximum * peak).astype(np.float32)


def make(duration: float) -> np.ndarray:
    return np.zeros(int(duration * RATE), dtype=np.float64)


def chord(track: np.ndarray, start: float, notes: list[float], duration: float, level: float) -> None:
    for note in notes:
        add_tone(track, start, duration, note, level / len(notes), release=duration * 0.72)


def sound_pack() -> dict[str, np.ndarray]:
    sounds: dict[str, np.ndarray] = {}

    track = make(0.13)
    add_tone(track, 0, 0.09, 310, 0.62, target=250, release=0.065)
    add_tone(track, 0.012, 0.075, 920, 0.24, target=690, release=0.055)
    add_soft_noise(track, 0, 0.045, 0.16)
    sounds["button-click"] = finish(track, room=0.045, peak=0.72)

    track = make(0.72)
    for at, note in ((0, 261.63), (0.13, 329.63), (0.27, 392.0)):
        add_tone(track, at, 0.42, note, 0.38, release=0.3)
    chord(track, 0.3, [261.63, 329.63, 392.0], 0.38, 0.42)
    sounds["enter-room"] = finish(track, room=0.16)

    track = make(0.55)
    for at, note in ((0, 392.0), (0.12, 329.63), (0.24, 246.94)):
        add_tone(track, at, 0.3, note, 0.34, target=note * 0.94, release=0.24)
    sounds["leave-room"] = finish(track, room=0.12, peak=0.82)

    track = make(0.46)
    add_tone(track, 0, 0.36, 330, 0.46, target=440, release=0.25)
    add_tone(track, 0.1, 0.32, 660, 0.22, target=880, release=0.24)
    sounds["member-join"] = finish(track, room=0.13, peak=0.84)

    track = make(0.43)
    add_tone(track, 0, 0.36, 440, 0.42, target=277, release=0.25)
    add_tone(track, 0.02, 0.31, 660, 0.18, target=415, release=0.23)
    sounds["member-leave"] = finish(track, room=0.11, peak=0.8)

    track = make(0.9)
    add_tone(track, 0, 0.75, 523.25, 0.72, release=0.62, harmonics=(1, 0.48, 0.24, 0.1))
    add_tone(track, 0.014, 0.64, 1046.5, 0.32, release=0.56, harmonics=(1, 0.35, 0.16))
    add_tone(track, 0, 0.2, 174.61, 0.22, target=130.81, release=0.17)
    add_soft_noise(track, 0, 0.026, 0.2)
    sounds["knock-bell"] = finish(track, room=0.2, peak=0.94)

    track = make(0.31)
    add_tone(track, 0, 0.27, 350, 0.42, target=610, release=0.18)
    add_tone(track, 0.035, 0.23, 700, 0.2, target=1_220, release=0.17)
    sounds["popup-open"] = finish(track, room=0.11, peak=0.82)

    track = make(0.42)
    add_tone(track, 0, 0.27, 392, 0.4, release=0.2)
    add_tone(track, 0.13, 0.27, 659.25, 0.46, release=0.2)
    sounds["copy-success"] = finish(track, room=0.14, peak=0.86)

    track = make(0.39)
    add_tone(track, 0, 0.28, 246.94, 0.46, target=369.99, release=0.2)
    add_tone(track, 0.09, 0.26, 493.88, 0.26, target=739.99, release=0.2)
    sounds["device-switch"] = finish(track, room=0.1, peak=0.84)

    track = make(0.25)
    add_tone(track, 0, 0.21, 370, 0.47, target=740, release=0.14)
    add_tone(track, 0.018, 0.18, 185, 0.2, target=370, release=0.13)
    sounds["send-message"] = finish(track, room=0.08, peak=0.81)

    track = make(0.34)
    add_tone(track, 0, 0.29, 659.25, 0.38, target=493.88, release=0.21)
    add_tone(track, 0.04, 0.24, 329.63, 0.24, target=246.94, release=0.19)
    sounds["receive-message"] = finish(track, room=0.12, peak=0.82)

    track = make(0.66)
    chord(track, 0, [196, 246.94], 0.32, 0.44)
    chord(track, 0.22, [261.63, 329.63, 392], 0.42, 0.62)
    sounds["connection-restored"] = finish(track, room=0.15, peak=0.9)

    track = make(0.58)
    for at in (0, 0.22):
        add_tone(track, at, 0.22, 164.81, 0.52, target=116.54, release=0.16)
        add_soft_noise(track, at, 0.08, 0.12)
    sounds["connection-failed"] = finish(track, room=0.075, peak=0.9)

    track = make(0.48)
    for at, note in ((0, 233.08), (0.18, 207.65)):
        add_tone(track, at, 0.24, note, 0.54, target=note * 0.82, release=0.16)
        add_soft_noise(track, at, 0.055, 0.1)
    sounds["mic-error"] = finish(track, room=0.075, peak=0.88)

    track = make(0.5)
    add_tone(track, 0, 0.42, 220, 0.52, target=440, release=0.29)
    add_tone(track, 0.1, 0.33, 440, 0.28, target=880, release=0.25)
    sounds["record-start"] = finish(track, room=0.11, peak=0.88)

    track = make(0.44)
    add_tone(track, 0, 0.36, 440, 0.48, target=220, release=0.26)
    add_tone(track, 0.03, 0.3, 880, 0.2, target=440, release=0.23)
    sounds["record-stop"] = finish(track, room=0.1, peak=0.84)

    track = make(0.31)
    add_tone(track, 0, 0.27, 261.63, 0.48, target=523.25, release=0.18)
    sounds["mic-on"] = finish(track, room=0.09, peak=0.84)

    track = make(0.3)
    add_tone(track, 0, 0.26, 523.25, 0.48, target=220, release=0.18)
    sounds["mic-off"] = finish(track, room=0.08, peak=0.82)

    track = make(0.34)
    add_tone(track, 0, 0.28, 392, 0.46, target=174.61, release=0.2)
    add_soft_noise(track, 0.02, 0.07, 0.1)
    sounds["speaker-muted"] = finish(track, room=0.09, peak=0.82)

    track = make(0.38)
    add_tone(track, 0, 0.32, 196, 0.46, target=392, release=0.22)
    add_tone(track, 0.08, 0.25, 392, 0.2, target=784, release=0.19)
    sounds["speaker-unmuted"] = finish(track, room=0.11, peak=0.84)
    return sounds


def write_wav(path: Path, samples: np.ndarray) -> None:
    pcm = np.clip(samples * 32_767, -32_768, 32_767).astype("<i2")
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(RATE)
        handle.writeframes(pcm.tobytes())


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for name, samples in sound_pack().items():
        write_wav(OUTPUT / f"{name}.wav", samples)
        print(f"{name:22} {len(samples) / RATE:.2f}s")


if __name__ == "__main__":
    main()
