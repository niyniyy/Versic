
"use client";

import { useCallback } from "react";
import type { Analysis } from "@/lib/types";
import TimelinePanel from "./TimelinePanel";

type ViewProps = {
    analysis: Analysis;
    currentTime: number;
    onSeek: (t: number) => void;
};

const FONT = "11px ui-sans-serif, system-ui, sans-serif";

/* ---------- waveform ---------- */

export function WaveformPanel({
    analysis,
    currentTime,
    onSeek,
}: ViewProps) {
    const draw = useCallback(
        (ctx: CanvasRenderingContext2D, w: number, h: number) => {
            const { min, max } = analysis.waveform;
            const n = min.length;
            const mid = h / 2;
            const scale = ((h / 2) * 0.92) / (analysis.peak || 1);

            ctx.fillStyle = "rgba(255,255,255,0.15)";
            ctx.fillRect(0, mid, w, 1);

            ctx.fillStyle = "#34d399";

            for (let x = 0; x < w; x++) {
                const i = Math.min(
                    n - 1,
                    Math.floor((x / w) * n)
                );

                const y1 = mid - max[i] * scale;
                const y2 = mid - min[i] * scale;

                ctx.fillRect(
                    x,
                    y1,
                    1,
                    Math.max(1, y2 - y1)
                );
            }
        },
        [analysis]
    );

    return (
        <TimelinePanel
            title="Waveform"
            hint="click to seek"
            duration={analysis.analysed_duration_s}
            currentTime={currentTime}
            onSeek={onSeek}
            height={120}
            draw={draw}
        />
    );
}

/* ---------- spectrogram (STFT) ---------- */

const STOPS: [number, number, number, number][] = [
    [0, 6, 6, 24],
    [0.3, 70, 20, 120],
    [0.6, 220, 80, 60],
    [1, 255, 240, 170],
];

function colormap(v: number): [number, number, number] {
    const t = v / 255;

    for (let i = 1; i < STOPS.length; i++) {
        if (t <= STOPS[i][0]) {
            const [t0, r0, g0, b0] = STOPS[i - 1];
            const [t1, r1, g1, b1] = STOPS[i];

            const f = (t - t0) / (t1 - t0);

            return [
                r0 + (r1 - r0) * f,
                g0 + (g1 - g0) * f,
                b0 + (b1 - b0) * f,
            ];
        }
    }

    return [255, 240, 170];
}

const LUT = Array.from({ length: 256 }, (_, v) => colormap(v));

function decodeBase64(b64: string): Uint8Array {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);

    for (let i = 0; i < bin.length; i++) {
        out[i] = bin.charCodeAt(i);
    }

    return out;
}

export function SpectrogramPanel({
    analysis,
    currentTime,
    onSeek,
}: ViewProps) {
    const draw = useCallback(
        (ctx: CanvasRenderingContext2D, w: number, h: number) => {
            const {
                rows,
                cols,
                data_b64,
                fmax_hz,
            } = analysis.spectrogram;

            const data = decodeBase64(data_b64);

            const off = document.createElement("canvas");
            off.width = cols;
            off.height = rows;

            const octx = off.getContext("2d");
            if (!octx) return;

            const img = octx.createImageData(cols, rows);

            for (let r = 0; r < rows; r++) {
                const y = rows - 1 - r;

                // Row 0 is the lowest frequency, so flip vertically.
                for (let c = 0; c < cols; c++) {
                    const [R, G, B] = LUT[data[r * cols + c]];
                    const o = (y * cols + c) * 4;

                    img.data[o] = R;
                    img.data[o + 1] = G;
                    img.data[o + 2] = B;
                    img.data[o + 3] = 255;
                }
            }

            octx.putImageData(img, 0, 0);

            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(off, 0, 0, w, h);

            ctx.font = FONT;
            ctx.textBaseline = "middle";
            ctx.textAlign = "left";
            ctx.strokeStyle = "rgba(255,255,255,0.18)";
            ctx.fillStyle = "rgba(255,255,255,0.85)";

            for (const f of [250, 500, 1000, 1500, 2000]) {
                if (f > fmax_hz) continue;

                const y = h * (1 - f / fmax_hz);

                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(w, y);
                ctx.stroke();

                ctx.fillText(
                    `${f} Hz`,
                    6,
                    Math.min(h - 8, Math.max(8, y - 7))
                );
            }
        },
        [analysis]
    );

    return (
        <TimelinePanel
            title="Spectrogram (STFT)"
            hint="0 to 2000 Hz, brighter means louder"
            duration={analysis.analysed_duration_s}
            currentTime={currentTime}
            onSeek={onSeek}
            height={260}
            draw={draw}
        />
    );
}

/* ---------- piano roll ---------- */

const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);

export function PianoRollPanel({
    analysis,
    currentTime,
    onSeek,
}: ViewProps) {
    const draw = useCallback(
        (ctx: CanvasRenderingContext2D, w: number, h: number) => {
            const notes = analysis.notes;

            ctx.textBaseline = "middle";

            if (notes.length === 0) {
                ctx.fillStyle = "rgba(255,255,255,0.6)";
                ctx.font = "14px ui-sans-serif, system-ui, sans-serif";
                ctx.textAlign = "center";

                ctx.fillText(
                    "No confident notes detected",
                    w / 2,
                    h / 2
                );

                return;
            }

            let lo =
                Math.min(...notes.map((n) => n.pitch_midi)) - 2;

            let hi =
                Math.max(...notes.map((n) => n.pitch_midi)) + 2;

            while (hi - lo + 1 < 13) {
                hi += 1;

                if (hi - lo + 1 < 13) {
                    lo -= 1;
                }
            }

            const rows = hi - lo + 1;
            const rowH = h / rows;
            const dur = analysis.analysed_duration_s || 1;

            // Draw piano key backgrounds.
            for (let p = lo; p <= hi; p++) {
                const y = h - (p - lo + 1) * rowH;

                if (BLACK_KEYS.has(p % 12)) {
                    ctx.fillStyle = "rgba(255,255,255,0.05)";
                    ctx.fillRect(0, y, w, rowH);
                }

                if (p % 12 === 0) {
                    ctx.fillStyle = "rgba(255,255,255,0.12)";
                    ctx.fillRect(0, y + rowH - 1, w, 1);
                }
            }

            // Draw detected notes.
            ctx.font = FONT;
            ctx.textAlign = "left";

            for (const n of notes) {
                const x = (n.start_s / dur) * w;

                const nw = Math.max(
                    2,
                    ((n.end_s - n.start_s) / dur) * w
                );

                const y =
                    h - (n.pitch_midi - lo + 1) * rowH;

                ctx.fillStyle = `rgba(52, 211, 153, ${
                    0.35 + 0.65 * n.confidence
                })`;

                ctx.fillRect(
                    x,
                    y + 1,
                    nw,
                    Math.max(2, rowH - 2)
                );

                if (nw > 28 && rowH > 11) {
                    ctx.fillStyle = "#04130d";
                    ctx.fillText(
                        n.name,
                        x + 4,
                        y + rowH / 2
                    );
                }
            }

            // Label C notes with their octave.
            ctx.fillStyle = "rgba(255,255,255,0.5)";

            for (let p = lo; p <= hi; p++) {
                if (p % 12 === 0) {
                    const y =
                        h - (p - lo + 1) * rowH;

                    ctx.fillText(
                        `C${Math.floor(p / 12) - 1}`,
                        4,
                        y + rowH / 2
                    );
                }
            }
        },
        [analysis]
    );

    return (
        <TimelinePanel
            title="Piano roll"
            hint="brighter notes have stronger evidence"
            duration={analysis.analysed_duration_s}
            currentTime={currentTime}
            onSeek={onSeek}
            height={220}
            draw={draw}
        />
    );
}
