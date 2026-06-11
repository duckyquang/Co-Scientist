/** True when built for GitHub Pages static snapshot (no live API). */
export const IS_STATIC_DEMO = import.meta.env.VITE_STATIC_DEMO === "true";

/** Remote API base URL for cloud mode (hosted backend). */
export const API_BASE_URL = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");

/** GitHub README anchor for local setup instructions. */
export const README_LOCAL_URL =
  import.meta.env.VITE_README_LOCAL_URL ||
  "https://github.com/duckyquang/Co-Scientist#option-1-run-locally";

export const IS_LOCAL_HOST =
  typeof window !== "undefined" &&
  (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

/** Base path for bundled static demo JSON. */
export const STATIC_DEMO_ROOT = `${import.meta.env.BASE_URL}demo`;

/** Resolved API prefix for live requests. */
export function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (IS_STATIC_DEMO) return `${STATIC_DEMO_ROOT}${p.replace(/^\/api/, "")}`;
  const base = API_BASE_URL;
  return base ? `${base}${p}` : p;
}
