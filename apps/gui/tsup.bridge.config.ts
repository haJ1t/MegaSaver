import { defineConfig } from "tsup";

// Build ONLY the bridge public entry (startGuiBridge + resolveShippedGuiDistDir)
// into a self-contained node ESM module + .d.ts. The `mega gui` CLI consumes
// `@megasaver/gui/bridge`; emitting a real dist here (rather than exporting raw
// .ts) keeps the GUI's frontend source graph — auth.ts's `import.meta.env`, the
// React .tsx components reached via type-only imports — out of the CLI's tsc and
// bundle. Workspace @megasaver/* deps stay external: the CLI's own bundle config
// inlines them from source.
export default defineConfig({
  entry: { index: "bridge/public.ts" },
  outDir: "dist-bridge",
  format: ["esm"],
  target: "node22",
  platform: "node",
  dts: true,
  sourcemap: false,
  clean: true,
  splitting: false,
  // Only bundle this package's own bridge code; every dependency (workspace or
  // npm) stays external and resolves at the consumer's build/runtime.
  external: [/^@megasaver\//, /^node:/],
});
