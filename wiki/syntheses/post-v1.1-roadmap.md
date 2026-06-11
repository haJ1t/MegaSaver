---
title: Post-v1.1 Roadmap — Remaining Work
tags: [roadmap, backlog, mvp]
sources: [index.md, decisions/bootstrap-matrix.md, syntheses/mega-saver-product.md, sources/fikri-original.md, log.md]
status: active
created: 2026-06-10
updated: 2026-06-10
---

# Post-v1.1 Roadmap — Remaining Work

State as of 2026-06-10: v1.1.0 shipped (2026-06-04, main @ `1644065`), no open PRs/issues, main green. The v0.1 headless MVP and the v1.0 Context Gate epic are both complete (source: index.md Status).

## Remaining, by priority

1. **Verify npm publish** — AUDITED 2026-06-10: `@megasaver/cli` was NEVER published (registry E404). The v1.1.0 release run succeeded but the npm-publish job was skipped — `NPM_TOKEN` repo secret is unset (`gh secret list` empty). Needs maintainer: create an npm automation token for the `@megasaver` scope, `gh secret set NPM_TOKEN`, re-run the release workflow for the tag.
2. ~~**skill-packs real implementation**~~ — RESOLVED 2026-06-10 (branch `feat/skill-packs-real`): real loader, discovery, atomic installer, `mega pack` CLI. See [[entities/skill-packs]].
3. ~~**Stats wiring verification**~~ — RESOLVED 2026-06-10 (branch `feat/stats-wiring-completion`): exec path had shipped in BB7b; the two real gaps (no event on `runOutputPipeline`, stale `mega session saver stats` stub) are implemented and tested. See [[entities/stats]].
4. ~~**Windows port remainder**~~ — RESOLVED 2026-06-11 (PRs #104–#108): win32 store path (%LOCALAPPDATA%), CRLF mixed-EOL drift fix, lowercase id contract, atomic-write `r+` Windows fsync fix, `.gitattributes` LF, and a `windows-latest` CI matrix leg that proves the port (both legs green). The case-insensitive "collision" was found theoretical (lowercase UUIDs). See [[concepts/windows-support]]. Deferred: 2-process lock test, tsconfig test-typecheck + mcp HOME follow-ups.
5. **conventions:sync → CLAUDE.md tagged blocks** — sync manages AGENTS.md + 3 `.mdc` only; CLAUDE.md still manual (source: index.md v0.3 backlog).
6. **GUI native packaging** — Tauri/Electron, deferred to v1.1+ (source: index.md v0.3 backlog note).
7. **i18n `tr`** — product strings English-only since v0.1 (source: decisions/bootstrap-matrix.md #8).
8. **Feature backlog (fikri §16 top-30)** — not yet built: Token Audit, Repo Scanner, Ignore Generator, Instruction Optimizer, Context Packer, Conversation Compactor, Memory Vault. Already covered by Context Gate: Tool Output Compressor (output-filter), Smart Retrieval (retrieval BM25), Evidence-Preserving Compression (pipeline) (source: syntheses/mega-saver-product.md).

## Wiki/housekeeping

- Pending entity pages: `skill-packs`, `conventions-sync` (source: index.md).
- syntheses/mega-saver-product.md status line still says "plan execution pending" — stale, predates v1.0 ship.
- v0.3 backlog item "connector aider sync end-to-end" appears stale (aider target shipped PR #21) — verify, then strike.
