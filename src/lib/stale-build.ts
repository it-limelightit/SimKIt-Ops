/**
 * After a new deployment, a tab still running the previous build asks for code
 * chunks (e.g. /assets/manager-XXXX.js) that no longer exist, so the page fails
 * with "Failed to fetch dynamically imported module" / 404 / React error #422.
 * Recover by reloading once to pick up the new build. A short guard prevents
 * reload loops if the failure is something else (e.g. offline).
 */
const RELOAD_KEY = "simkit.staleBuildReloadAt";
const GUARD_MS = 20_000;

const CHUNK_ERROR =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|Loading (CSS )?chunk [\w-]+ failed/i;

export function isStaleBuildError(error: unknown) {
  const message =
    error instanceof Error ? `${error.message} ${String(error.cause ?? "")}` : String(error ?? "");
  return CHUNK_ERROR.test(message);
}

/** Reload once to load the latest deployment. Returns false if a reload just happened. */
export function reloadForNewBuild() {
  if (typeof window === "undefined") return false;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  let last = 0;
  try {
    last = Number(window.sessionStorage.getItem(RELOAD_KEY) ?? 0);
  } catch {
    /* storage unavailable */
  }
  if (Date.now() - last < GUARD_MS) return false;
  try {
    window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    /* storage unavailable */
  }
  window.location.reload();
  return true;
}

let installed = false;
/** Install global listeners once (client only). */
export function installStaleBuildRecovery() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  // Vite fires this when a dynamic import / preload of a chunk fails.
  window.addEventListener("vite:preloadError", (event) => {
    if (reloadForNewBuild()) event.preventDefault();
  });
  window.addEventListener("unhandledrejection", (event) => {
    if (isStaleBuildError(event.reason)) reloadForNewBuild();
  });
  window.addEventListener("error", (event) => {
    if (isStaleBuildError(event.error ?? event.message)) reloadForNewBuild();
  });
}
