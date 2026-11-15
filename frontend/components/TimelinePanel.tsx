
"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
    title: string;
    hint?: string;
    duration: number;
    currentTime: number;
    onSeek: (t: number) => void;
    height: number;
    draw: (
        ctx: CanvasRenderingContext2D,
        w: number,
        h: number
    ) => void;
};

export default function TimelinePanel({
    title,
    hint,
    duration,
    currentTime,
    onSeek,
    height,
    draw,
}: Props) {
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    const [width, setWidth] = useState(0);

    useEffect(() => {
        const el = wrapRef.current;
        if (!el) return;

        const ro = new ResizeObserver(() => {
            setWidth(el.clientWidth);
        });

        ro.observe(el);
        setWidth(el.clientWidth);

        return () => ro.disconnect();
    }, []);

    useEffect(() => {
        const canvas = canvasRef.current;

        if (!canvas || width === 0) return;

        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);

        draw(ctx, width, height);
    }, [draw, width, height]);

    const pct =
        duration > 0
            ? Math.min(100, (currentTime / duration) * 100)
            : 0;

    function handleClick(e: React.MouseEvent<HTMLDivElement>) {
        const rect = e.currentTarget.getBoundingClientRect();
        const frac = (e.clientX - rect.left) / rect.width;

        onSeek(Math.max(0, Math.min(1, frac)) * duration);
    }

    return (
        <section className="space-y-3">
            <div>
                <h3 className="font-semibold">{title}</h3>

                {hint && (
                    <p className="text-sm text-gray-500">{hint}</p>
                )}
            </div>

            <div
                ref={wrapRef}
                className="relative w-full cursor-pointer overflow-hidden rounded-lg"
                style={{ height }}
                onClick={handleClick}
            >
                <canvas
                    ref={canvasRef}
                    className="block h-full w-full"
                    style={{ height }}
                />

                <div
                    className="pointer-events-none absolute bottom-0 left-0 top-0 border-r-2 border-white/80"
                    style={{ left: `${pct}%` }}
                />
            </div>
        </section>
    );
}
