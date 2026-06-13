import { createRequire } from "node:module";
import { defineConfig } from "tsup";

// Read the CLI's own version at build time. main.ts reads it from the
// __MEGA_CLI_VERSION__ define (injected below), because a single-file bundle
// has no sibling package.json to require at runtime.
const { version } = createRequire(import.meta.url)("./package.json") as { version: string };

// Standalone distribution build for the `mega` CLI.
//
// Both this and tsup.config.ts inline the full workspace dependency graph:
// tsup leaves external only what package.json lists under `dependencies`/
// `peerDependencies`, and the CLI keeps all @megasaver/* workspace packages
// plus their transitive npm deps (citty, zod, @modelcontextprotocol/sdk, yaml)
// in `devDependencies` — so both builds bundle them rather than externalize.
// The difference: this config forces `noExternal: [/.*/]` (inline EVERYTHING
// resolvable, regardless of dependency classification), injects the version
// literal, emits an explicit `.mjs`, and adds the createRequire banner —
// yielding a single self-contained ESM file that runs with bare
// `node mega.mjs` from any directory, no node_modules present. Only Node
// builtins stay external. It is the artifact shipped to GitHub Releases and
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
  // Re-point esbuild's `__require` shim at a real createRequire so an inlined
  // CJS dep that `require()`s a bare Node builtin — e.g. yaml's
  // `require("process")`, pulled in transitively via context-gate's
  // loadProjectPermissions — works at runtime instead of throwing
  // "Dynamic require of process is not supported".
  banner: {
    js: [
      "#!/usr/bin/env node",
      'import { createRequire as __cr } from "node:module";',
      "const require = __cr(import.meta.url);",
    ].join("\n"),
  },
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
  // …except the TypeScript compiler (via @megasaver/indexer): it references
  // __filename at load and cannot run inlined in an ESM bundle. It stays a
  // runtime dependency, so `mega index` requires `typescript` to be installed
  // alongside the bundle (the rest of the CLI remains self-contained).
  external: ["typescript"],
});
