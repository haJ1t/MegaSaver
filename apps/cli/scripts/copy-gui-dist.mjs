// Copy the built GUI frontend into the CLI's shipped bundle so `mega gui` can
// serve it offline. The bridge itself is inlined into dist-bundle/mega.mjs by
// tsup (it resolves @megasaver/gui/bridge); this script handles the static
// assets, which tsup does not bundle. Runs at prepack, after the GUI build.
//
// MUST run AFTER the tsup bundle (`pnpm run bundle`): tsup's bundle config has
// clean:true on outDir dist-bundle, so it wipes dist-bundle/gui. The prepack
// chain orders bundle-then-copy for exactly this reason; never move the copy
// before the bundle.
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
// Exclude build artifacts (TypeScript's incremental *.tsbuildinfo, stray
// *.map) — only real runtime assets (index.html + hashed JS/CSS/fonts) ship.
cpSync(GUI_DIST, DEST, {
  recursive: true,
  filter: (src) => !src.endsWith(".tsbuildinfo") && !src.endsWith(".map"),
});
console.log(`copy-gui-dist: copied ${GUI_DIST} -> ${DEST}`);
