---
"@megasaver/cli": patch
---

fix(cli): externalize the transformers/onnxruntime chain from the standalone bundle

The v1.2.0 tarball shipped at 15.7MB because `tsup.bundle.config.ts` used
`noExternal: [/.*/]`, which inlined `@huggingface/transformers` and copied six
`onnxruntime_binding-*.node` native binaries into `dist-bundle/`. Those natives
are built for a single CI OS, so they are dead weight on every other platform
and bloat every install.

The embeddings package already loads transformers through a guarded dynamic
`import()` (lazy, first `embed()` call only) and every call site degrades on
failure, so the chain is safe to resolve at runtime. The bundle now externalizes
`@huggingface/transformers` + `onnxruntime-node`, and the CLI declares
`@huggingface/transformers` as an optionalDependency so npm installs the correct
platform binary on supported platforms (or skips it, leaving embeddings cleanly
disabled) instead of every user carrying six wrong-platform `.node` files.

Result: `mega.mjs` drops from 13.2MB to 11.2MB, the tarball loses all six native
binaries, and semantic features work via the host-platform native. The inlined
TypeScript compiler stays put so `mega index` still runs from a bare
`node mega.mjs` download.
