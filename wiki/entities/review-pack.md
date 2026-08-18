---
title: '@megasaver/review-pack'
tags: [entity, package, review-pack, diff, context, receipts, wave-2]
sources:
  - docs/superpowers/specs/2026-08-06-review-packs-design.md
  - docs/superpowers/plans/2026-08-06-review-packs.md
status: active
created: 2026-08-18
updated: 2026-08-18
---

# `@megasaver/review-pack`

Evidence-preserving, secret-redacted review pack builder. Compiles git commit ranges into expandable overlay chunk sets containing semantic diff chunks, enclosing-declaration context extents, test receipts, and claims manifest.

## Key Capabilities

- **Fail-Closed Git Gate:** Resolves ranges (`<base>..<head>` or default branch merge-base) and enforces clean working tree (`dirty_worktree` / `git_unavailable` / `bad_range` / `empty_diff`).
- **Semantic Diff & Context Extents:** Uses `chunkBySemantic` / `chunkByLines` for diff chunks and lazily loads `@megasaver/indexer` extractors (`extractTs`, `extractMd`, `extractJson`) for full enclosing declarations around modified lines.
- **Receipts & Claims Matching:** Reads in-window test execution events from overlay and registry stores, maps exit codes, attributes receipts to touched package scopes (`packages/<n>`, `apps/<n>`, `repo`), and identifies gaps.
- **Secret Redaction:** Redacts secrets via `policy.redact` across all diff chunks, context extents, manifest JSON, and final stdout digest.
- **ChunkSet Persistence:** Stores three atomic `OverlayChunkSet`s (`<packId>-diff`, `<packId>-context`, `<packId>-manifest`) under `review-<packId>` live session ID, expandable via `mega output chunk` or `mega_fetch_chunk`.

## Public Surface (`src/index.ts`)

- `buildReviewPack(input: BuildReviewPackInput): Promise<ReviewPack>` — primary builder orchestrator.
- `renderDigest(pack: ReviewPack): string` — formatted review pack summary.
- `persistPack(...)` — atomic chunk set persistence with rollback.
- `ReviewPackError`, `reviewPackErrorCodeSchema` — structured error codes.
- `readReceiptEvents`, `receiptCandidatesFromEvents`, `buildClaimsManifest`.

## Consumers

- `mega review pack [<range>] [--json]` (`apps/cli/src/commands/review/pack.ts`).
- MCP tool `review_pack` (`packages/mcp-bridge/src/tools/review-pack.ts`).
