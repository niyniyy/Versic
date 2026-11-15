
"""versic backend: upload audio -> STFT spectrogram, notes, key, tempo."""

import base64
import io
import os

import librosa
import numpy as np
import soundfile as sf

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from scipy.ndimage import median_filter
from scipy.signal import find_peaks


VERSION = "0.2.0"

# ---------- settings you can tune ----------

SR = 22050                 # Analysis sample rate (Hz)
N_FFT = 4096               # STFT window
HOP = 512                  # STFT hop
MAX_SECONDS = 30           # Longer files are trimmed
MAX_BYTES = 15 * 1024 * 1024  # Upload limit
FMAX_DISPLAY = 2000        # Spectrogram display frequency limit
MAX_COLS = 600             # Maximum spectrogram columns
DB_RANGE = 80              # Dynamic range (dB)

MIDI_LO, MIDI_HI = 40, 96  # Note search range: E2 .. C7

MIN_NOTE_S = 0.08
HARMONIC_WEIGHTS = (1.0, 0.8, 0.6, 0.4)

# -------------------------------------------

NOTE_NAMES = [
    "C", "C#", "D", "D#", "E", "F",
    "F#", "G", "G#", "A", "A#", "B"
]

MAJOR_PROFILE = np.array([
    6.35, 2.23, 3.48, 2.33, 4.38, 4.09,
    2.52, 5.19, 2.39, 3.66, 2.29, 2.88
])

MINOR_PROFILE = np.array([
    6.33, 2.68, 3.52, 5.38, 2.60, 3.53,
    2.54, 4.75, 3.98, 2.69, 3.34, 3.17
])


# ---------- FastAPI application ----------

app = FastAPI(
    title="versic API",
    description="Hear deeper. Understand music.",
    version=VERSION,
)

ALLOWED_ORIGINS = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in ALLOWED_ORIGINS],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- Helper functions ----------

def midi_name(m: int) -> str:
    return f"{NOTE_NAMES[m % 12]}{m // 12 - 1}"


def waveform_peaks(y: np.ndarray, n: int = 800) -> dict:
    """Min/max per bucket, so the browser can draw the waveform cheaply."""

    n = min(n, len(y))

    edges = np.linspace(0, len(y), n + 1).astype(int)

    lo = [
        round(float(y[a:b].min()), 4)
        for a, b in zip(edges[:-1], edges[1:])
    ]

    hi = [
        round(float(y[a:b].max()), 4)
        for a, b in zip(edges[:-1], edges[1:])
    ]

    return {"min": lo, "max": hi}


def spectrogram_image(S: np.ndarray, freqs: np.ndarray) -> dict:
    """Crop to 0..FMAX_DISPLAY, max-pool in time, quantise to 0..255, base64."""

    k = int(np.searchsorted(freqs, FMAX_DISPLAY))

    db = librosa.amplitude_to_db(
        S[:k],
        ref=float(np.max(S)),
        top_db=DB_RANGE
    )

    t = db.shape[1]

    pool = max(1, int(np.ceil(t / MAX_COLS)))

    if pool > 1:
        cols = t // pool

        db = db[:, :cols * pool].reshape(
            k, cols, pool
        ).max(axis=2)

    q = np.clip(
        (db + DB_RANGE) / DB_RANGE * 255.0,
        0,
        255
    ).astype(np.uint8)

    q = np.ascontiguousarray(q)

    return {
        "rows": int(q.shape[0]),
        "cols": int(q.shape[1]),
        "fmax_hz": float(freqs[k - 1]),
        "hop_s": HOP * pool / SR,
        "db_floor": -DB_RANGE,
        "data_b64": base64.b64encode(
            q.tobytes()
        ).decode("ascii"),
    }


# ---------- Note detection ----------

def detect_notes(S: np.ndarray) -> list:
    """
    Monophonic baseline: harmonic-sum salience on the STFT magnitude.

    For every candidate MIDI pitch, add up the STFT energy at its
    fundamental and first harmonics. The pitch with the highest sum
    wins the frame.
    """

    bin_hz = SR / N_FFT

    n_bins, n_frames = S.shape

    midis = np.arange(MIDI_LO, MIDI_HI + 1)

    f0 = librosa.midi_to_hz(midis)

    sal = np.zeros(
        (len(midis), n_frames),
        dtype=np.float32
    )

    for h, w in enumerate(HARMONIC_WEIGHTS, start=1):
        idx = np.round(f0 * h / bin_hz).astype(int)

        ok = idx < n_bins

        sal[ok] += w * S[idx[ok]]

    peak = sal.max(axis=0)

    best = sal.argmax(axis=0)

    ref = float(np.percentile(peak, 95))

    if ref <= 0:
        return []

    voiced = peak > 0.2 * ref

    track = np.where(voiced, midis[best], -1)

    track = median_filter(
        track,
        size=5,
        mode="nearest"
    )

    times = librosa.frames_to_time(
        np.arange(n_frames),
        sr=SR,
        hop_length=HOP
    )

    events = []

    start = 0

    for i in range(1, n_frames + 1):

        if i == n_frames or track[i] != track[start]:

            m = int(track[start])

            if m >= 0:

                t0 = float(times[start])

                t1 = (
                    float(times[i])
                    if i < n_frames
                    else float(times[-1] + HOP / SR)
                )

                if t1 - t0 >= MIN_NOTE_S:

                    strength = float(
                        np.clip(
                            peak[start:i].mean() / peak.max(),
                            0,
                            1
                        )
                    )

                    events.append({
                        "id": f"n{len(events)}",
                        "pitch_midi": m,
                        "name": midi_name(m),
                        "start_s": round(t0, 3),
                        "end_s": round(t1, 3),
                        "confidence": round(strength, 3),
                    })

            start = i

    return events


# ---------- Key estimation ----------

def estimate_key(notes: list) -> list:
    """Krumhansl-Schmuckler: correlate duration-weighted pitch-class histogram with key profiles."""

    hist = np.zeros(12)

    for n in notes:
        hist[n["pitch_midi"] % 12] += (
            n["end_s"] - n["start_s"]
        )

    if hist.sum() == 0 or np.std(hist) == 0:
        return []

    cands = []

    for tonic in range(12):

        for mode, prof in (
            ("major", MAJOR_PROFILE),
            ("minor", MINOR_PROFILE)
        ):

            r = np.corrcoef(
                hist,
                np.roll(prof, tonic)
            )[0, 1]

            cands.append({
                "tonic": NOTE_NAMES[tonic],
                "mode": mode,
                "score": round(float(r), 3)
            })

    cands.sort(
        key=lambda c: c["score"],
        reverse=True
    )

    return cands[:3]


# ---------- Tempo estimation ----------

def estimate_tempo(y: np.ndarray) -> dict:

    try:

        env = librosa.onset.onset_strength(
            y=y,
            sr=SR,
            hop_length=HOP
        )

        try:
            from librosa.feature.rhythm import tempo as tempo_fn

        except ImportError:
            tempo_fn = librosa.beat.tempo

        bpm = float(
            np.atleast_1d(
                tempo_fn(
                    onset_envelope=env,
                    sr=SR,
                    hop_length=HOP
                )
            )[0]
        )

        return {
            "bpm": round(bpm, 1),
            "alternatives": [
                round(bpm / 2, 1),
                round(bpm * 2, 1)
            ]
        }

    except Exception:

        return {
            "bpm": None,
            "alternatives": []
        }


# ---------- Dominant frequencies ----------

def dominant_frequencies(
    S: np.ndarray,
    freqs: np.ndarray,
    n: int = 5
) -> list:

    sel = np.where(
        (freqs >= 50) & (freqs <= 4000)
    )[0]

    spec = S.mean(axis=1)[sel]

    if spec.max() <= 0:
        return []

    peaks, _ = find_peaks(
        spec,
        height=spec.max() * 0.05,
        distance=3
    )

    order = peaks[
        np.argsort(spec[peaks])[::-1]
    ][:n]

    out = []

    for p in order:

        hz = float(freqs[sel[p]])

        out.append({
            "hz": round(hz, 1),
            "name": midi_name(
                int(round(float(librosa.hz_to_midi(hz))))
            )
        })

    return out


# ---------- API routes ----------

@app.get("/")
def root():

    return {
        "name": "versic API",
        "version": VERSION,
        "docs": "/docs",
        "health": "/health"
    }


@app.get("/health")
def health():

    return {
        "status": "ok",
        "version": VERSION
    }


@app.post("/analyze")
def analyze(file: UploadFile = File(...)):

    data = file.file.read(MAX_BYTES + 1)

    if len(data) == 0:
        raise HTTPException(
            status_code=400,
            detail="The uploaded file is empty."
        )

    if len(data) > MAX_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Limit is {MAX_BYTES // (1024 * 1024)} MB."
        )

    info = None

    try:
        info = sf.info(io.BytesIO(data))

    except Exception:
        pass

    try:
        y, _ = librosa.load(
            io.BytesIO(data),
            sr=SR,
            mono=True,
            duration=MAX_SECONDS
        )

    except Exception:
        raise HTTPException(
            status_code=400,
            detail="Could not decode this file. Please upload a WAV, MP3, FLAC or OGG recording."
        )

    if y.size < N_FFT or not np.isfinite(y).all():
        raise HTTPException(
            status_code=400,
            detail="Audio is too short (under 0.2 s) or invalid."
        )

    peak_amp = float(np.max(np.abs(y)))

    if peak_amp < 1e-4:
        raise HTTPException(
            status_code=400,
            detail="The recording appears to be silent."
        )

    analysed_s = len(y) / SR

    total_s = float(info.duration) if info else analysed_s

    warnings = []

    if total_s > MAX_SECONDS + 0.05:
        warnings.append(
            f"Only the first {MAX_SECONDS} seconds were analysed."
        )

    S = np.abs(
        librosa.stft(
            y,
            n_fft=N_FFT,
            hop_length=HOP
        )
    )

    freqs = librosa.fft_frequencies(
        sr=SR,
        n_fft=N_FFT
    )

    notes = detect_notes(S)

    if not notes:

        warnings.append(
            "No confident notes detected. This baseline works best on one clear melody line."
        )

    else:

        warnings.append(
            "Notes come from a classical DSP baseline. Chords, distortion and full mixes will be wrong."
        )

    return {
        "schema_version": "0.2",
        "filename": file.filename,
        "duration_s": round(total_s, 3),
        "analysed_duration_s": round(analysed_s, 3),
        "truncated": total_s > MAX_SECONDS + 0.05,
        "sample_rate_hz": SR,
        "original_sample_rate_hz": int(info.samplerate) if info else None,
        "channels": int(info.channels) if info else None,
        "rms": round(float(np.sqrt(np.mean(y ** 2))), 5),
        "peak": round(peak_amp, 5),
        "waveform": waveform_peaks(y),
        "spectrogram": {
            **spectrogram_image(S, freqs),
            "duration_s": round(analysed_s, 3)
        },
        "notes": notes,
        "key_candidates": estimate_key(notes),
        "tempo": estimate_tempo(y),
        "dominant_frequencies": dominant_frequencies(S, freqs),
        "warnings": warnings
    }
