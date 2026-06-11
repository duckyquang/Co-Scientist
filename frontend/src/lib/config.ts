/** True when built for GitHub Pages (no live API backend). */
export const IS_STATIC_DEMO = import.meta.env.VITE_STATIC_DEMO === "true";

/** Base path for API or bundled demo JSON. */
export const API_ROOT = IS_STATIC_DEMO
  ? `${import.meta.env.BASE_URL}demo`
  : "/api";
