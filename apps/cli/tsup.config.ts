import { defineConfig } from "tsup";

export default defineConfig({
  // The ordinary dist CLI resolves this sibling from its Worker URL. The
  // published .mjs keeps one entry and dispatches itself by isMainThread.
  entry: {
    cli: "src/cli.ts",
    "task-kickoff-worker": "src/hooks/task-kickoff-worker.ts",
  },
  format: ["esm"],
  target: "es2023",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  dts: false,
  // The TypeScript compiler (pulled in via @megasaver/indexer for AST block
  // extraction) is a large CJS module that references __filename at load and
  // cannot be inlined into an ESM bundle. Keep it external — resolved from
  // node_modules at runtime (declared in package.json `dependencies`).
  external: ["typescript"],
  // A bundled CJS dep that `require()`s a bare Node builtin — e.g. yaml's
  // `require("process")`, pulled in transitively via context-gate's
  // loadProjectPermissions — otherwise hits esbuild's `__require` shim in the
  // ESM output and throws "Dynamic require of process is not supported" at
  // runtime. Re-point that shim at a real createRequire so builtin requires work.
  banner: {
    js: [
      "#!/usr/bin/env node",
      'import { createRequire as __cr } from "node:module";',
      "const require = __cr(import.meta.url);",
    ].join("\n"),
  },
  splitting: false,
  treeshake: true,
});
