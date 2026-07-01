/** Provider selection for LLM inference.
 *
 * Real inference needs ONE baked credential (browsers can't call these providers
 * anonymously — Groq needs a key, Pollinations gates browser origins behind a
 * Turnstile bot-check unless a registered token is present):
 *   1. Groq          — when VITE_GROQ_API_KEY is baked in (fast, best).
 *   2. Pollinations  — when VITE_POLLINATIONS_TOKEN is baked in (keyless-style).
 * With NEITHER, `hasRealProvider()` is false and the caller (sim/generate →
 * engine) uses the deterministic, prompt-aware template instead — which still
 * reflects the actual prompt, just without a live model's reasoning.
 */

import { hasGroqKey, groqJson } from "./groq";
import { hasPollinationsToken, pollinationsJson } from "./pollinations";

export type LlmProvider = "groq" | "keyless";

export interface ChatResult<T> { data: T; provider: LlmProvider }

/** Is any real LLM provider configured for this build? */
export function hasRealProvider(): boolean {
  return hasGroqKey() || hasPollinationsToken();
}

/** Which provider will answer (or "none" → prompt-aware template). */
export function activeProvider(): LlmProvider | "none" {
  if (hasGroqKey()) return "groq";
  if (hasPollinationsToken()) return "keyless";
  return "none";
}

/** Short human label for the active provider (for honest UI copy). */
export function activeProviderLabel(): string {
  if (hasGroqKey()) return "Groq · Llama 3.3 70B";
  if (hasPollinationsToken()) return "a free keyless model (Pollinations)";
  return "a prompt-aware in-browser simulation";
}

/** Run one JSON completion on the configured provider; reports which answered.
 *  Throws if no provider is configured (caller degrades to the template). */
export async function chatJson<T>(opts: {
  system: string;
  user: string;
  temperature?: number;
  signal?: AbortSignal;
}): Promise<ChatResult<T>> {
  if (hasGroqKey()) {
    return { data: await groqJson<T>(opts), provider: "groq" };
  }
  if (hasPollinationsToken()) {
    return { data: await pollinationsJson<T>(opts), provider: "keyless" };
  }
  throw new Error("No inference provider configured");
}

export { hasGroqKey } from "./groq";
