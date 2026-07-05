// Copy the built GUI frontend into the CLI's shipped bundle so `mega gui` can
// serve it offline. The bridge itself is inlined into dist-bundle/mega.mjs by
// tsup (it resolves @megasaver/gui/bridge); this script handles the static
// assets, which tsup does not bundle. Runs at prepack, after the GUI build.
//
// Source: apps/gui/dist (vite output: index.html + assets/). Destination:
// apps/cli/dist-bundle/gui — the path resolveShippedGuiDistDir points at,
// relative to the bundle. dist-bundle is in the published `files`.

import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CLI_DIR = dirname(SCRIPT_DIR);
const GUI_DIST = join(CLI_DIR, "..", "gui", "dist");
const DEST = join(CLI_DIR, "dist-bundle", "gui");

if (!existsSync(join(GUI_DIST, "index.html"))) {
  console.error(
    `copy-gui-dist: GUI dist not found at ${GUI_DIST}. Run \`pnpm --filter @megasaver/gui build\` first.`,
  );
  process.exit(1);
}

rmSync(DEST, { recursive: true, force: true });
cpSync(GUI_DIST, DEST, { recursive: true });
console.log(`copy-gui-dist: copied ${GUI_DIST} -> ${DEST}`);
