// Public entry for consumers that boot the bridge (the `mega gui` CLI command).
// Deliberately narrow: only the boot factory + shipped-dist resolver, never the
// React app or route internals.
export { type StartGuiBridgeOptions, type StartedGuiBridge, startGuiBridge } from "./start.js";
export { resolveShippedGuiDistDir } from "./dist-dir.js";
