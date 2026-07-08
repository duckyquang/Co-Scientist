/** LLM via Pollinations (OpenAI-compatible).
 *
 * IMPORTANT: Pollinations gates browser-origin requests behind a Cloudflare
 * Turnstile bot-check (403 "Missing Turnstile token") UNLESS the request carries
 * a registered `token`/`referrer`. So this is NOT truly keyless from a browser —
 * it's an OPT-IN provider: bake a `VITE_POLLINATIONS_TOKEN` (register a referrer
 * at pollinations.ai) to enable it, same idea as baking a Groq key. Without a
 * token we don't call it (it would just 403), and the app uses the prompt-aware
 * template instead.
 *
 * PRIVACY: when enabled, prompts are sent to a third-party service. Disclosed in the UI.
 */

import { extractJsonObject, messageText } from "./parse";

const POLLINATIONS_URL = "https://text.pollinations.ai/openai";
const DEFAULT_TIMEOUT_MS = 45_000;

/** Registered Pollinations token (enables browser use), or null. */
export function pollinationsToken(): string | null {
  const t = import.meta.env.VITE_POLLINATIONS_TOKEN;
  return typeof t === "string" && t.trim() ? t.trim() : null;
}

export function hasPollinationsToken(): boolean {
  return pollinationsToken() !== null;
}

async function once<T>(opts: {
  system: string;
  user: string;
  model: string;
  temperature: number;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  const onAbort = () => ctrl.abort();
  opts.signal?.addEventListener("abort", onAbort);
  try {
    const res = await fetch(POLLINATIONS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: opts.model,
        temperature: opts.temperature,
        // Registered token/referrer — required to pass the browser Turnstile gate.
        token: pollinationsToken() ?? undefined,
        referrer: pollinationsToken() ?? "co-scientist",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Keyless AI request failed (${res.status})`);
    const data = await res.json();
    const text = messageText(data);
    if (!text) throw new Error("Keyless AI returned an empty response");
    return extractJsonObject<T>(text);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

/** Call the keyless model for a JSON object. One retry on transient failure. */
export async function pollinationsJson<T>(opts: {
  system: string;
  user: string;
  temperature?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<T> {
  const base = {
    system: opts.system,
    user: opts.user,
    temperature: opts.temperature ?? 0.8,
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    signal: opts.signal,
  };
  try {
    return await once<T>({ ...base, model: "openai" });
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    // Retry once — a second attempt (and the faster model) often succeeds.
    return await once<T>({ ...base, model: "openai-fast" });
  }
}
