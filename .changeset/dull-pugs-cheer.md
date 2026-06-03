---
"@megasaver/cli": patch
---

Make `@megasaver/cli` publishable as a self-contained package.

The `mega` CLI is now distributed two ways: a standalone `mega.mjs` bundle
attached to GitHub Releases, and (when a maintainer supplies `NPM_TOKEN`) the
`@megasaver/cli` npm package. The published package ships only the inlined
bundle — every `@megasaver/*` workspace dependency and npm dependency (citty,
zod, the MCP SDK) is bundled in, so the package has no runtime dependencies and
the 13 internal `@megasaver/*` packages stay private. `bin.mega` points at the
bundle and `publishConfig.access` is `public`.
