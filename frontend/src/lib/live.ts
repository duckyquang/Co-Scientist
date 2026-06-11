import { IS_STATIC_DEMO } from "./config";
import { getCredentials, getDeploymentMode } from "./credentials";

/** True when the client should call a live API instead of static demo JSON. */
export function canUseLiveApi(): boolean {
  if (!IS_STATIC_DEMO) return true;
  return (
    getDeploymentMode() === "cloud" &&
    Boolean(getCredentials()) &&
    Boolean(import.meta.env.VITE_API_URL)
  );
}
