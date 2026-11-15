
import type { Analysis } from "./types";

export const API_URL =
    process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

export async function analyzeFile(file: File): Promise<Analysis> {
    const form = new FormData();
    form.append("file", file);

    let res: Response;

    try {
        res = await fetch(`${API_URL}/analyze`, {
            method: "POST",
            body: form,
        });
    } catch {
        throw new Error(
            "Cannot reach the versic backend. Is it running on port 8000?"
        );
    }

    if (!res.ok) {
        let detail = `Request failed (${res.status})`;

        try {
            const body = await res.json();

            if (body?.detail) {
                detail =
                    typeof body.detail === "string"
                        ? body.detail
                        : JSON.stringify(body.detail);
            }
        } catch {
            // Response was not JSON; keep the generic message.
        }

        throw new Error(detail);
    }

    return res.json();
}
