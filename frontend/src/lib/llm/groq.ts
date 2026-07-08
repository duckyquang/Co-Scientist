/** Direct browser → Groq client.
 *
 * Groq's API sends `Access-Control-Allow-Origin: *` and accepts the
 * `authorization` header, so we can call it straight from the browser with a
 * key baked in at build time (VITE_GROQ_API_KEY). This is what makes the live
 * site actually read the user's prompt — no backend required.
 *
 * SECURITY NOTE: a key shipped in a static bundle is publicly visible. Use a
 * FREE, rotatable Groq key for this — never a paid/privileged one.
 */

import { extractJsonObject, messageText } from "./parse";

export const GROQ_MODEL = "llama-3.3-70b-versatile";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

/** The build-time Groq key, or null if none was configured. */
export function groqKey(): string | null {
  const k = import.meta.env.VITE_GROQ_API_KEY;
  return typeof k === "string" && k.trim() ? k.trim() : null;
}

export function hasGroqKey(): boolean {
  return groqKey() !== null;
}

/** Call Groq for a single JSON completion. Throws with a readable message. */
export async function groqJson<T>(opts: {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}): Promise<T> {
  const key = groqKey();
  if (!key) throw new Error("No Groq API key configured");

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    signal: opts.signal,
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: opts.temperature ?? 0.8,
      max_tokens: opts.maxTokens ?? 6000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
    }),
  });

  if (!res.ok) {
    let detail = `Groq request failed (${res.status})`;
    try {
      const e = await res.json();
      detail = e?.error?.message || detail;
    } catch { /* non-JSON error body */ }
    if (res.status === 401) detail = "Groq rejected the API key (401). Check VITE_GROQ_API_KEY.";
    if (res.status === 429) detail = "Groq rate limit reached (429). Try again in a moment.";
    throw new Error(detail);
  }

  const data = await res.json();
  const text = messageText(data);
  if (!text) throw new Error("Groq returned an empty response");
  return extractJsonObject<T>(text);
}
