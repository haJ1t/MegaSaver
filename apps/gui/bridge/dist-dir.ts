import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve the built GUI dist the CLI ships. `mega gui` inlines this function
// into dist-bundle/mega.mjs, so it passes its OWN import.meta.url: the shipped
// dist sits beside the bundle at dist-bundle/gui (copied there by the CLI's
// prepack). Running from a source checkout (dev), that path is absent, so fall
// back to the workspace build output apps/gui/dist.
//
// callerUrl is required (not defaulted to this module's import.meta.url):
// after bundling, only the caller's url points at the real on-disk bundle.
export function resolveShippedGuiDistDir(callerUrl: string): string {
  const here = dirname(fileURLToPath(callerUrl));
  const shipped = resolve(here, "gui");
  if (existsSync(resolve(shipped, "index.html"))) return shipped;

  // Dev fallback: this module lives at apps/gui/bridge/, so the sibling dist is
  // ../dist relative to THIS file (import.meta.url is stable in dev/tsx).
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist");
}
