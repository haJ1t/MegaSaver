import { createRequire } from "node:module";
import { defineConfig } from "tsup";

// Read the CLI's own version at build time. main.ts reads it from the
// __MEGA_CLI_VERSION__ define (injected below), because a single-file bundle
// has no sibling package.json to require at runtime.
const { version } = createRequire(import.meta.url)("./package.json") as { version: string };

// Standalone distribution build for the `mega` CLI.
//
// Unlike tsup.config.ts (which externalizes deps so dist/cli.js needs
// node_modules), this config INLINES every dependency — all @megasaver/*
// workspace packages plus npm deps (citty, zod, @modelcontextprotocol/sdk) —
// into a single self-contained ESM file. Only Node builtins stay external.
// The output runs with bare `node mega.mjs` from any directory, with no
// node_modules present. It is the artifact shipped to GitHub Releases and
// (optionally) published to npm.
export default defineConfig({
  entry: { mega: "src/cli.ts" },
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist-bundle",
  // tsup writes .js for esm by default; we want an explicit .mjs so the file
  // is unambiguously ESM regardless of the consumer's package.json "type".
  outExtension: () => ({ js: ".mjs" }),
  clean: true,
  sourcemap: false,
  dts: false,
  banner: { js: "#!/usr/bin/env node" },
  splitting: false,
  treeshake: true,
  // Define the version as a string literal that exists ONLY in this bundle, so
  // main.ts's `typeof __MEGA_CLI_VERSION__ !== "undefined"` collapses to the
  // literal and esbuild eliminates the createRequire branch. The unbundled
  // dist/cli.js has no such define, so it falls back to reading package.json.
  define: { __MEGA_CLI_VERSION__: JSON.stringify(version) },
  // Inline everything resolvable. esbuild keeps Node builtins (fs, path,
  // node:os, …) external automatically under platform:"node", so this safely
  // bundles all workspace + npm deps without trying to inline the runtime.
  noExternal: [/.*/],
});
