// "default" = the free path (in-browser sim / server default, no key needed).
// "byok"    = bring your own API key.
export type DeploymentMode = "default" | "byok";

export interface UserCredentials {
  provider: string;
  apiKey: string;
}

const MODE_KEY = "co_scientist_mode";
const CREDS_KEY = "co_scientist_credentials";
const ONBOARDING_KEY = "co_scientist_onboarding_done";

/** The stored deployment mode, defaulting to the free path. Migrates the legacy
 *  values ("cloud" → "byok", "local" → "default"). */
export function getDeploymentMode(): DeploymentMode {
  const v = localStorage.getItem(MODE_KEY);
  if (v === "byok" || v === "cloud") return "byok";
  return "default"; // "local", unset, or anything else → free path
}

export function setDeploymentMode(mode: DeploymentMode) {
  localStorage.setItem(MODE_KEY, mode);
  localStorage.setItem(ONBOARDING_KEY, "1");
}

export function isOnboardingDone(): boolean {
  return localStorage.getItem(ONBOARDING_KEY) === "1";
}

export function getCredentials(): UserCredentials | null {
  try {
    const raw = localStorage.getItem(CREDS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.provider || !parsed?.apiKey) return null;
    return { provider: parsed.provider, apiKey: parsed.apiKey };
  } catch {
    return null;
  }
}

export function setCredentials(creds: UserCredentials) {
  localStorage.setItem(CREDS_KEY, JSON.stringify(creds));
}

export function clearCredentials() {
  localStorage.removeItem(CREDS_KEY);
}

export function authHeaders(): Record<string, string> {
  if (getDeploymentMode() !== "byok") return {};
  const creds = getCredentials();
  if (!creds) return {};
  return {
    "X-LLM-Provider": creds.provider,
    "X-API-Key": creds.apiKey,
  };
}
