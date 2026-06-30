---
title: CLI bundle externalizes the transformers/onnxruntime native chain
tags: [decision, packaging, cli, embeddings, bundle]
sources:
  - apps/cli/tsup.bundle.config.ts
  - apps/cli/test/bundle-smoke.test.ts
  - packages/embeddings/src/embed.ts
status: active
created: 2026-07-01
updated: 2026-07-01
---

# Bundle externalizes the embeddings native chain

**Decision.** The standalone `mega.mjs` bundle externalizes
`@huggingface/transformers` + `onnxruntime-node` — the ONE exception to
`noExternal:[/.*/]` — and `@megasaver/cli` declares transformers an
`optionalDependency` (PR #209, v1.2.1). The TypeScript compiler stays inlined.

## Why

`noExternal:[/.*/]` inlined transformers, and esbuild copied six
`onnxruntime_binding-*.node` natives (built for one CI OS) into the tarball:
v1.2.0 shipped at 15.7MB, the natives dead weight off that OS. Externalized, the
guarded dynamic `import("@huggingface/transformers")` in `embed.ts` resolves from
`node_modules` at runtime: npm pulls the host-platform native via the optionalDep
(or skips it), and every `embed()` call site already degrades on failure
(see [[decisions/lazy-load-heavy-deps]]). Result: 3 files, **0 natives**, 1.9MB
tarball, embeddings work on the host platform.

## Why typescript stays inlined (the asymmetry)

`typescript` is a *static* `import` in `indexer/extract-ts.ts` with no graceful
fallback, so it must stay inlined for `mega index` to run from a bare
`node mega.mjs` download (no `node_modules`). transformers is safe to externalize
*only because* embeddings degrade. The trade-off: the bare GitHub-Release
`mega.mjs` has no semantic index (BM25 fallback); npm installs get embeddings.

## Mechanism

tsup's `noExternal` beats esbuild's `external`, so a blanket `/.*/` would
re-inline the chain. The rule is a negative lookahead
(`/^(?!@huggingface\/transformers|onnxruntime-node).*/`) that excludes the chain
while inlining everything else. The `optionalDependencies` survives the
publish-manifest strip (it drops only `devDependencies`).

## Guard

`apps/cli/test/bundle-smoke.test.ts`: asserts the built bundle ships no `.node`
files, does not inline `onnxruntime_binding`, and keeps `mega.mjs` < 12MB.
Live in CI (ci.yml builds the bundle pre-test).
