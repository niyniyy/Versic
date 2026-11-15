
export interface NoteEvent {
    id: string;
    pitch_midi: number;
    name: string;
    start_s: number;
    end_s: number;
    confidence: number; // Relative strength 0..1, not a probability
}

export interface KeyCandidate {
    tonic: string;
    mode: string;
    score: number;
}

export interface Analysis {
    schema_version: string;
    filename: string | null;
    duration_s: number;
    analysed_duration_s: number;
    truncated: boolean;
    sample_rate_hz: number;
    original_sample_rate_hz: number | null;
    channels: number | null;
    rms: number;
    peak: number;

    waveform: {
        min: number[];
        max: number[];
    };

    spectrogram: {
        rows: number;
        cols: number;
        fmax_hz: number;
        hop_s: number;
        duration_s: number;
        db_floor: number;
        data_b64: string;
    };

    notes: NoteEvent[];
    key_candidates: KeyCandidate[];

    tempo: {
        bpm: number | null;
        alternatives: number[];
    };

    dominant_frequencies: {
        hz: number;
        name: string;
    }[];

    warnings: string[];
}
