---
title: Post-v1.1 Roadmap — Remaining Work
tags: [roadmap, backlog, mvp]
sources: [index.md, decisions/bootstrap-matrix.md, syntheses/mega-saver-product.md, sources/fikri-original.md, log.md]
status: active
created: 2026-06-10
updated: 2026-06-11
---

# Post-v1.1 Roadmap — Remaining Work

State as of 2026-06-11: v1.1.0 shipped (2026-06-04); since then PRs #102–#110
merged (main @ `e5ee21c`), CI green on **both** `ubuntu-latest` and
`windows-latest`. The v0.1 headless MVP and the v1.0 Context Gate epic are
complete; full Windows support is now shipped (source: [[concepts/windows-support]]).

## Resolved (post-v1.1 arc, 2026-06-10/11)

- ~~**#3 Stats wiring**~~ — PR #102. `runOutputPipeline` records a
  `TokenSaverEvent`; `mega session saver stats` reads the real store (BB6 stub
  retired). See [[entities/stats]].
- ~~**#2 skill-packs real implementation**~~ — PR #103. Real loader, discovery,
  atomic installer, `mega pack` CLI; symlink + path-escape guards (critic found
  + fixed a `removePack` traversal CRITICAL). See [[entities/skill-packs]].
- ~~**#4 Windows port remainder**~~ — PRs #104–#108. win32 store path
  (%LOCALAPPDATA%, HOME→USERPROFILE), CRLF mixed-EOL drift fix, lowercase id
  contract, atomic-write `r+` Windows fsync fix, `.gitattributes` LF, and a
  `windows-latest` CI matrix leg that proves the port. The case-insensitive
  "collision" was found theoretical (lowercase UUIDs). See [[concepts/windows-support]].
- ~~**mcp HOME→USERPROFILE**~~ (follow-up) — PR #109. `resolveHomeDir` helper;
  `mega mcp {status,install,uninstall}` resolve agent-config paths correctly on
  Windows.
- ~~**test-typecheck no-op**~~ (follow-up) — PR #110. `tsconfig.test.json`
  silently excluded `test/` from typecheck; enabling it surfaced + fixed 113
  pre-existing type errors and a cross-package e2e import leak.

## Remaining, by priority

1. **Verify npm publish** — `@megasaver/cli` was NEVER published (registry
   E404). The release workflow's npm-publish job is skipped because the
   `NPM_TOKEN` repo secret is unset. **Needs the maintainer** (not automatable
   here): create an npm automation token for the `@megasaver` scope,
   `gh secret set NPM_TOKEN`, then re-tag / re-run `release.yml`. This is the
   one real MVP→installable-product gap.
2. **conventions:sync → CLAUDE.md tagged blocks** — `pnpm conventions:sync`
   manages `AGENTS.md` + 3 `.mdc` only; `CLAUDE.md` is still hand-maintained.
   Extend the tagged-block sync to CLAUDE.md sections. Small, self-contained,
   high dogfood value. (source: index.md v0.3 backlog)
3. **GUI native packaging** — Tauri/Electron, deferred to v1.1+. Design phase
   (skill-routing §5b). (source: index.md v0.3 backlog note)
4. **i18n `tr`** — product strings English-only since v0.1; add `tr` via
   `packages/shared/i18n`. (source: decisions/bootstrap-matrix.md #8)
5. **Feature backlog (fikri §16 top-30)** — not yet built: Token Audit, Repo
   Scanner, Ignore Generator, Instruction Optimizer, Context Packer,
   Conversation Compactor, Memory Vault. Already covered by Context Gate: Tool
   Output Compressor (output-filter), Smart Retrieval (retrieval BM25),
   Evidence-Preserving Compression (pipeline). (source: syntheses/mega-saver-product.md)

## Deferred follow-ups (tracked, non-blocking)

- True 2-OS-process Windows lock-contention test (single-process lock suite
  passes on the Windows leg).
- e2e typecheck gap — `test/e2e/v1-closeout-flow.test.ts` is excluded from the
  CLI per-package typecheck (cross-package source import); a multi-package
  `tsconfig` with both apps in `rootDirs` would restore static coverage
  (runtime-covered today).

## Wiki/housekeeping

- Pending entity page: `conventions-sync` (skill-packs page now exists).
- syntheses/mega-saver-product.md status line still says "plan execution
  pending" — stale, predates v1.0 ship.
- v0.3 backlog item "connector aider sync end-to-end" appears stale (aider
  target shipped PR #21) — verify, then strike.
