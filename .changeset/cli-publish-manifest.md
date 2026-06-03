---
"@megasaver/cli": patch
---

Packaging polish for `@megasaver/cli` ahead of npm publish.

- The displayed version now comes from a build-time `__MEGA_CLI_VERSION__`
  define in the standalone bundle and from `package.json` in the unbundled
  build. No environment variable is consulted, so a stray `MEGA_CLI_VERSION`
  no longer overrides the reported version.
- The published tarball no longer carries the build-only `devDependencies`
  (the 8 private `@megasaver/*` workspace packages plus citty and zod). A
  `prepack`/`postpack` step strips them from the packed manifest while leaving
  the source `package.json` untouched, so the self-contained bundle ships with
  zero dependencies and SCA tooling sees no references to unpublished packages.
