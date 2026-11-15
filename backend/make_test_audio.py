
"""Creates tests/fixtures/c_major_scale.wav: C3..C4, 44.1 kHz stereo, no
extra libraries needed."""

from pathlib import Path

import numpy as np
from scipy.io import wavfile


SR = 44100

MIDI_NOTES = [
    48, 50, 52, 53, 55, 57, 59, 60
]  # C3 D3 E3 F3 G3 A3 B3 C4

NOTE_S = 0.6
GAP_S = 0.1

HARMONICS = [1.0, 0.5, 0.33, 0.25]


def tone(midi: int) -> np.ndarray:

    f0 = 440.0 * 2 ** ((midi - 69) / 12)

    t = np.arange(int(SR * NOTE_S)) / SR

    y = sum(
        a * np.sin(2 * np.pi * f0 * (k + 1) * t)
        for k, a in enumerate(HARMONICS)
    )

    fade = int(0.02 * SR)

    env = np.ones_like(t)

    env[:fade] = np.linspace(0, 1, fade)
    env[-fade:] = np.linspace(1, 0, fade)

    return y * env


def main() -> None:

    gap = np.zeros(int(SR * GAP_S))

    audio = np.concatenate([
        np.concatenate([tone(m), gap])
        for m in MIDI_NOTES
    ])

    audio = 0.5 * audio / np.max(np.abs(audio))

    stereo = np.stack([audio, audio], axis=1)

    out = (
        Path(__file__).resolve().parents[1]
        / "tests"
        / "fixtures"
        / "c_major_scale.wav"
    )

    out.parent.mkdir(parents=True, exist_ok=True)

    wavfile.write(
        str(out),
        SR,
        (stereo * 32767).astype(np.int16)
    )

    print(f"Wrote {out} ({len(audio) / SR:.2f} s)")


if __name__ == "__main__":
    main()
