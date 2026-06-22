import { IS_STATIC_DEMO } from "./config";
import { getCredentials, getDeploymentMode } from "./credentials";

/** True when the client should call a live API instead of static demo JSON.
 *
 * Rules:
 * 1. Local dev / self-hosted → always live (IS_STATIC_DEMO is false).
 * 2. Static deploy (Vercel/Pages) with VITE_API_URL configured → live, no
 *    credentials required (the server-side key handles auth).
 * 3. Static deploy with credentials + VITE_API_URL → also live (power-user
 *    override).
 * 4. Static deploy, no VITE_API_URL → read-only demo mode.
 */
export function canUseLiveApi(): boolean {
  if (!IS_STATIC_DEMO) return true;
  // A configured backend URL is enough — no browser-stored key required.
  if (import.meta.env.VITE_API_URL) return true;
  // Legacy: user manually pasted a key in Settings.
  return getDeploymentMode() === "cloud" && Boolean(getCredentials());
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
