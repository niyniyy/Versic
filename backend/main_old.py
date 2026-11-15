import io
import wave
import librosa


import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile

app = FastAPI(
    title="versic",
    description="Evidence-based music audio analysis API",
    version="0.1.0",
)


@app.get("/")
def home():
    return {
        "project": "versic",
        "status": "running",
        "message": "Welcome to the versic audio analysis API",
    }


@app.post("/analyze")
async def analyze_audio(file: UploadFile = File(...)):
    # First MVP: uncompressed PCM WAV files
    if not file.filename.lower().endswith(".wav"):
        raise HTTPException(
            status_code=400,
            detail="For this MVP, please upload a WAV file.",
        )

    audio_bytes = await file.read()

    if len(audio_bytes) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large. Maximum: 20 MB.")

    try:
        with wave.open(io.BytesIO(audio_bytes), "rb") as wav:
            channels = wav.getnchannels()
            sample_rate = wav.getframerate()
            sample_width = wav.getsampwidth()
            frame_count = wav.getnframes()
            compression = wav.getcomptype()

            if compression != "NONE":
                raise HTTPException(status_code=400, detail="Only uncompressed PCM WAV is supported.")

            if sample_width not in (1, 2, 3, 4):
                raise HTTPException(status_code=400, detail="Unsupported WAV bit depth.")

            raw = wav.readframes(frame_count)

    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="Could not read this WAV file.")

    # Convert PCM samples to floating-point values between approximately -1 and 1.
    if sample_width == 1:
        samples = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128) / 128
    elif sample_width == 2:
        samples = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768
    elif sample_width == 3:
        bytes_3 = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3)
        integers = (
            bytes_3[:, 0].astype(np.int32)
            | (bytes_3[:, 1].astype(np.int32) << 8)
            | (bytes_3[:, 2].astype(np.int32) << 16)
        )
        integers = np.where(integers & 0x800000, integers - 0x1000000, integers)
        samples = integers.astype(np.float32) / 8388608
    else:
        samples = np.frombuffer(raw, dtype="<i4").astype(np.float32) / 2147483648

    if channels > 1:
        samples = samples.reshape(-1, channels).mean(axis=1)

    if len(samples) == 0:
        raise HTTPException(status_code=400, detail="The audio file is empty.")

    duration = len(samples) / sample_rate

    if duration > 30:
        raise HTTPException(status_code=400, detail="Please upload a clip of 30 seconds or less.")

    # DSP FEATURE 1: Root Mean Square (RMS) amplitude
    rms = float(np.sqrt(np.mean(samples ** 2)))

    # DSP FEATURE 2: Peak amplitude
    peak_amplitude = float(np.max(np.abs(samples)))

    # DSP FEATURE 3: Zero-crossing rate
    zero_crossings = np.sum(np.diff(np.signbit(samples)))
    zero_crossing_rate = float(zero_crossings / len(samples))

    # DSP FEATURE 4: Frame-wise RMS, using 100 ms frames
    frame_size = max(1, int(sample_rate * 0.1))
    frame_rms = []

    for start in range(0, len(samples), frame_size):
        frame = samples[start:start + frame_size]
        frame_rms.append(float(np.sqrt(np.mean(frame ** 2))))

    # DSP FEATURE 5: Dominant frequencies from the FFT
    windowed = samples * np.hanning(len(samples))
    spectrum = np.abs(np.fft.rfft(windowed))
    frequencies = np.fft.rfftfreq(len(samples), d=1 / sample_rate)

    if len(spectrum) > 1:
        spectrum[0] = 0  # Ignore the DC component
        peak_indices = np.argsort(spectrum)[-5:][::-1]
        dominant_frequencies = [
            {
                "frequency_hz": round(float(frequencies[i]), 2),
                "magnitude": round(float(spectrum[i]), 4),
            }
            for i in peak_indices
            if spectrum[i] > 0
        ]
    else:
        dominant_frequencies = []

    return {
        "filename": file.filename,
        "audio_properties": {
            "duration_seconds": round(duration, 3),
            "sample_rate_hz": sample_rate,
            "channels": channels,
            "bit_depth": sample_width * 8,
        },
        "dsp_features": {
            "rms_amplitude": round(rms, 5),
            "peak_amplitude": round(peak_amplitude, 5),
            "zero_crossing_rate": round(zero_crossing_rate, 5),
            "frame_rms": [round(value, 5) for value in frame_rms],
            "frame_duration_ms": 100,
            "dominant_frequencies": dominant_frequencies,
        },
        "analysis_status": "success",
    }


@app.post("/spectrogram")
async def generate_spectrogram(file: UploadFile = File(...)):

    # Accept WAV files for now
    if not file.filename.lower().endswith(".wav"):
        raise HTTPException(
            status_code=400,
            detail="Please upload a WAV file."
        )

    audio_bytes = await file.read()

    try:
        with wave.open(io.BytesIO(audio_bytes), "rb") as wav:
            sample_rate = wav.getframerate()
            channels = wav.getnchannels()
            sample_width = wav.getsampwidth()
            frame_count = wav.getnframes()
            raw = wav.readframes(frame_count)

        # Convert PCM audio into floating-point samples
        if sample_width == 1:
            samples = (
                np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128
            ) / 128

        elif sample_width == 2:
            samples = (
                np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768
            )

        elif sample_width == 3:
            bytes_3 = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3)
            integers = (
                bytes_3[:, 0].astype(np.int32)
                | (bytes_3[:, 1].astype(np.int32) << 8)
                | (bytes_3[:, 2].astype(np.int32) << 16)
            )
            integers = np.where(
                integers & 0x800000,
                integers - 0x1000000,
                integers
            )
            samples = integers.astype(np.float32) / 8388608

        elif sample_width == 4:
            samples = (
                np.frombuffer(raw, dtype="<i4").astype(np.float32)
                / 2147483648
            )

        else:
            raise HTTPException(
                status_code=400,
                detail="Unsupported WAV bit depth."
            )

        # Convert stereo audio into mono
        if channels > 1:
            samples = samples.reshape(-1, channels).mean(axis=1)

        if len(samples) == 0:
            raise HTTPException(status_code=400, detail="Empty audio file.")

        duration = len(samples) / sample_rate

        if duration > 30:
            raise HTTPException(
                status_code=400,
                detail="Audio must be 30 seconds or less."
            )

        # STFT PARAMETERS
        n_fft = 2048
        hop_length = 512

        # Calculate Short-Time Fourier Transform
        stft = librosa.stft(
            samples,
            n_fft=n_fft,
            hop_length=hop_length
        )

        # Convert complex STFT values into magnitudes
        magnitude = np.abs(stft)

        # Convert magnitudes into decibels
        spectrogram_db = librosa.amplitude_to_db(
            magnitude,
            ref=np.max
        )

        # Generate frequency and time axes
        frequencies = librosa.fft_frequencies(
            sr=sample_rate,
            n_fft=n_fft
        )

        times = librosa.frames_to_time(
            np.arange(spectrogram_db.shape[1]),
            sr=sample_rate,
            hop_length=hop_length
        )

        return {
            "filename": file.filename,
            "duration_seconds": round(duration, 3),
            "sample_rate_hz": sample_rate,
            "stft_parameters": {
                "n_fft": n_fft,
                "hop_length": hop_length
            },
            "frequencies_hz": frequencies.tolist(),
            "times_seconds": times.tolist(),
            "spectrogram_db": spectrogram_db.tolist(),
            "analysis_status": "success"
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=400,
            detail=f"Spectrogram analysis failed: {str(error)}"
        )
