import { IS_STATIC_DEMO } from "./config";

/** True when the client should call a live API instead of static demo JSON.
 *
 * Rules:
 * 1. Local dev / self-hosted → always live (IS_STATIC_DEMO is false).
 * 2. Static deploy with VITE_API_URL configured → live (hosted backend).
 * 3. Static deploy, no VITE_API_URL → in-browser sim. A user-pasted key does
 *    NOT flip this: there is no server to receive it, and a browser Groq key
 *    runs through the in-browser LLM path instead (see lib/llm/groq.ts). Sending
 *    a live POST here would just hit a bundled static JSON file and fail.
 */
export function canUseLiveApi(): boolean {
  if (!IS_STATIC_DEMO) return true;
  if (import.meta.env.VITE_API_URL) return true;
  return false;
}

/** True when sessions run as an in-browser simulation (no backend, no key).
 *
 * This is the zero-config free path: a static deploy with no live backend.
 * In this mode `api.create()` starts a client-side simulated session instead
 * of calling a server, and the UI labels results as a simulation (not real
 * LLM output). The moment a backend is configured (VITE_API_URL), this turns
 * false and the app talks to the real Groq-backed engine. */
export function isSimulatedMode(): boolean {
  return IS_STATIC_DEMO && !canUseLiveApi();
}
