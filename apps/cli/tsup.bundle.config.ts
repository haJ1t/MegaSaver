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
  // Provide the CommonJS module globals that inlined CJS deps expect but ESM
  // does not define:
  //   - `require`  — yaml's `require("process")` (via context-gate's
  //     loadProjectPermissions) would otherwise throw "Dynamic require of
  //     process is not supported".
  //   - `__filename` / `__dirname` — the bundled TypeScript compiler (via
  //     @megasaver/indexer) reads `__filename` at load
  //     (isFileSystemCaseSensitive) and throws "__filename is not defined in
  //     ES module scope" without this shim.
  // All three become module-scoped bindings the concatenated CJS code resolves.
  banner: {
    js: [
      "#!/usr/bin/env node",
      'import { createRequire as __cr } from "node:module";',
      'import { fileURLToPath as __fileURLToPath } from "node:url";',
      'import { dirname as __pathDirname } from "node:path";',
      "const require = __cr(import.meta.url);",
      "const __filename = __fileURLToPath(import.meta.url);",
      "const __dirname = __pathDirname(__filename);",
    ].join("\n"),
  },
  splitting: false,
  treeshake: true,
  // Define the version as a string literal that exists ONLY in this bundle, so
  // main.ts's `typeof __MEGA_CLI_VERSION__ !== "undefined"` collapses to the
  // literal and esbuild eliminates the createRequire branch. The unbundled
  // dist/cli.js has no such define, so it falls back to reading package.json.
  define: { __MEGA_CLI_VERSION__: JSON.stringify(version) },
  // The ONE chain we refuse to inline. @megasaver/embeddings reaches
  // @huggingface/transformers through a guarded dynamic import (embed.ts), and
  // transformers drags in onnxruntime-node's platform-specific *.node binaries
  // (plus sharp). Inlining it copied 6 CI-built (single-OS) natives into the
  // tarball — dead weight on every other platform, +12MB. Externalized, the
  // dynamic import resolves from node_modules at runtime: present (the CLI's
  // optionalDependency, installed for the host platform) → embeddings work;
  // absent (unsupported platform, or a bare `node mega.mjs` download) → embed()
  // rejects and every call site already degrades gracefully.
  // @aws-sdk/client-s3 joins the externalized set: @megasaver/brain-sync reaches
  // it through a guarded dynamic import (transport.ts createTransport), and
  // inlining it added ~1.2MB (tree-shaken to S3Client + 3 commands + smithy
  // runtime), pushing mega.mjs past the 12MB bundle-smoke guard. Externalized,
  // the dynamic import resolves from node_modules at runtime: present (the CLI's
  // optionalDependency, installed by npm) → sync works; absent (a bare
  // `node mega.mjs` download) → createTransport throws a friendly transport_error.
  external: ["@huggingface/transformers", "onnxruntime-node", "@aws-sdk/client-s3"],
  // Inline everything else resolvable, including the TypeScript compiler pulled
  // in via @megasaver/indexer — the banner's __filename/__dirname shim lets it
  // run inlined, so the single file stays self-contained for every command,
  // `mega index` included (it statically imports typescript with no graceful
  // fallback, so it MUST stay inlined). esbuild keeps Node builtins (fs, path,
  // node:os, …) external automatically under platform:"node".
  //
  // Why a negative lookahead instead of /.*/: tsup's `noExternal` wins over
  // esbuild's `external`, so a blanket /.*/ would re-inline the chain above and
  // silently undo it. Excluding those two specifiers here lets `external` apply.
  noExternal: [/^(?!@huggingface\/transformers|onnxruntime-node|@aws-sdk\/client-s3).*/],
});
