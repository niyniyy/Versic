"use client";

import { useEffect, useRef, useState } from "react";
import { analyzeFile } from "@/lib/api";
import type { Analysis } from "@/lib/types";
import {
  PianoRollPanel,
  SpectrogramPanel,
  WaveformPanel,
} from "@/components/Visuals";

const MAX_MB = 15;
const ALLOWED = [".wav", ".mp3", ".flac", ".ogg"];

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <div className="text-xs uppercase tracking-wider text-slate-400">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold text-slate-100">{value}</div>
    </div>
  );
}

function downloadJson(a: Analysis) {
  const slim = {
    ...a,
    spectrogram: { ...a.spectrogram, data_b64: "(omitted)" },
  };
  const blob = new Blob([JSON.stringify(slim, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${(a.filename || "analysis").replace(/\.[^.]+$/, "")}-versic.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function Home() {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [dragging, setDragging] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  // free the previous object URL when a new file is chosen
  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  // read the audio clock ~20 times a second to move the playhead lines
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      if (now - last > 50) {
        last = now;
        const a = audioRef.current;
        if (a) setTime(a.currentTime);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  async function handleFile(file: File) {
    const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (!ALLOWED.includes(ext)) {
      setError(`Unsupported file type. Please use WAV, MP3, FLAC or OGG.`);
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`That file is larger than ${MAX_MB} MB.`);
      return;
    }
    setError(null);
    setAnalysis(null);
    setTime(0);
    setFileName(file.name);
    setAudioUrl(URL.createObjectURL(file));
    setLoading(true);
    try {
      setAnalysis(await analyzeFile(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  function seek(t: number) {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = Math.max(0, t);
    setTime(a.currentTime);
  }

  const topKey = analysis?.key_candidates[0];

  return (
    <div className="min-h-screen bg-[#0b0d12] text-slate-100">
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        {/* header */}
        <header className="mb-8">
          <h1 className="text-4xl font-bold tracking-tight">
            versic<span className="text-emerald-400">.</span>
          </h1>
          <p className="mt-1 text-slate-400">Hear deeper. Understand music.</p>
        </header>

        {/* upload */}
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void handleFile(f);
          }}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition ${
            dragging
              ? "border-emerald-400 bg-emerald-400/10"
              : "border-white/15 bg-white/[0.02] hover:border-white/30"
          }`}
        >
          <span className="text-lg font-medium">
            Drop a recording here, or click to choose
          </span>
          <span className="mt-1 text-sm text-slate-400">
            WAV, MP3, FLAC or OGG. Up to {MAX_MB} MB. The first 30 seconds are
            analysed.
          </span>
          <input
            type="file"
            accept=".wav,.mp3,.flac,.ogg,audio/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              e.target.value = "";
            }}
          />
        </label>

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200"
          >
            {error}
          </div>
        )}

        {audioUrl && (
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-2 truncate text-sm text-slate-300">{fileName}</div>
            <audio ref={audioRef} src={audioUrl} controls className="w-full" />
          </div>
        )}

        {loading && (
          <div className="mt-6 flex items-center gap-3 text-slate-300">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
            Analysing. The first run can take up to a minute while the
            server warms up.
          </div>
        )}

        {analysis && (
          <div className="mt-8 space-y-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Duration" value={`${analysis.duration_s.toFixed(2)} s`} />
              <Stat
                label="Likely key"
                value={topKey ? `${topKey.tonic} ${topKey.mode}` : "unclear"}
              />
              <Stat
                label="Tempo"
                value={analysis.tempo.bpm ? `${analysis.tempo.bpm} BPM` : "n/a"}
              />
              <Stat label="Notes found" value={`${analysis.notes.length}`} />
            </div>

            {analysis.warnings.map((w) => (
              <div
                key={w}
                className="rounded-xl border border-amber-300/25 bg-amber-300/10 px-4 py-2 text-sm text-amber-100"
              >
                {w}
              </div>
            ))}

            <WaveformPanel analysis={analysis} currentTime={time} onSeek={seek} />
            <SpectrogramPanel analysis={analysis} currentTime={time} onSeek={seek} />
            <PianoRollPanel analysis={analysis} currentTime={time} onSeek={seek} />

            <div className="grid gap-5 md:grid-cols-2">
              <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <h3 className="mb-3 text-sm font-semibold text-slate-200">
                  Key candidates
                </h3>
                {analysis.key_candidates.length === 0 ? (
                  <p className="text-sm text-slate-400">Not enough notes to estimate a key.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {analysis.key_candidates.map((k) => (
                      <li key={`${k.tonic}${k.mode}`} className="flex justify-between">
                        <span>
                          {k.tonic} {k.mode}
                        </span>
                        <span className="text-slate-400">match {k.score.toFixed(2)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-3 text-xs text-slate-500">
                  These are candidates, not certainties. A short clip can fit
                  several keys, including a major key and its relative minor.
                </p>
              </section>

              <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <h3 className="mb-3 text-sm font-semibold text-slate-200">
                  Strongest frequencies
                </h3>
                <ul className="space-y-2 text-sm">
                  {analysis.dominant_frequencies.map((f) => (
                    <li key={f.hz} className="flex justify-between">
                      <span>{f.hz} Hz</span>
                      <span className="text-slate-400">about {f.name}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-slate-500">
                  Averaged over the whole clip. Harmonics can outrank the note
                  that was played.
                </p>
              </section>
            </div>

            <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-200">
                  Note events
                </h3>
                <button
                  onClick={() => downloadJson(analysis)}
                  className="rounded-lg border border-white/15 px-3 py-1 text-xs text-slate-200 hover:bg-white/10"
                >
                  Download JSON
                </button>
              </div>
              <div className="max-h-72 overflow-auto">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-[#10131a] text-xs uppercase text-slate-400">
                    <tr>
                      <th className="py-2 pr-4">Note</th>
                      <th className="py-2 pr-4">Start</th>
                      <th className="py-2 pr-4">End</th>
                      <th className="py-2">Strength</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.notes.slice(0, 300).map((n) => (
                      <tr
                        key={n.id}
                        onClick={() => seek(n.start_s)}
                        className="cursor-pointer border-t border-white/5 hover:bg-white/5"
                      >
                        <td className="py-1.5 pr-4 font-medium">{n.name}</td>
                        <td className="py-1.5 pr-4">{n.start_s.toFixed(2)} s</td>
                        <td className="py-1.5 pr-4">{n.end_s.toFixed(2)} s</td>
                        <td className="py-1.5">{n.confidence.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Click a row to jump to that note. Strength is relative, not a
                probability.
              </p>
            </section>
          </div>
        )}

        <footer className="mt-12 text-xs text-slate-600">
          versic MVP. Notes come from a DSP baseline and can be wrong.
        </footer>
      </main>
    </div>
  );
}