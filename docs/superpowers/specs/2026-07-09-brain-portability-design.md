---
title: Brain Portability (E5) — signed .megabrain export/import — design
status: approved
risk: HIGH
created: 2026-07-09
approved: 2026-07-09 (user, this session)
sources:
  - wiki/syntheses/pro-differentiation-portfolio.md (E5 row, 2.0 program)
  - wiki/log.md 2026-07-09 entries
---

# Brain Portability (E5) — design

## TL;DR

`mega brain export` writes a project's knowledge layer (approved memories,
project rules, failed-attempt lessons) to a single integrity-hashed
`.megabrain` file; `mega brain import` merges it into another project with
every imported memory entering the Phase-10 approval gate as `suggested`.
Anti-lock-in flagship of the 2.0 release. Pro-gated. Merge-only — import
never deletes or overwrites existing data.

## Locked decisions (user, 2026-07-09)

1. **Bundle contents = knowledge layer only**: memory entries + project
   rules + failed attempts. No sessions, no stats, no task plans, no
   embeddings (re-embedded lazily on demand post-import).
2. **"Signed" = integrity-only**: SHA-256 over the raw payload bytes,
   recorded in the manifest. No keypairs, no authenticity claims in 2.0.
3. **Import = merge + `approval="suggested"`**: reuses the Phase-10 gate;
   imported knowledge never reaches agents until `mega memory approve`.
4. **Export redacts + Pro-gated**: every content field passes
   `redactWithFindings` (@megasaver/policy — already a core dependency);
   redaction failure aborts the export (fail-closed). Both subcommands
   Pro-gated, gate checked before any store read.

## Architecture (approach A — approved)

Core-owned module, thin CLI. Core already owns all three stores through
the registry, so export is read-side composition and import is calls to
the existing create APIs.

New files:
- `packages/core/src/brain-bundle.ts` — Zod schemas: manifest, payload,
  bundle; serialize/parse + hash helpers.
- `packages/core/src/brain-export.ts` — assemble payload from registry
  (approved memories, all rules, all failures), redact, produce bundle.
- `packages/core/src/brain-import.ts` — verify, parse, merge via
  existing core create APIs.
- `apps/cli/src/commands/brain/{export,import,index}.ts` — gate-first
  handlers, `--json` variants, registered in `main.ts`.

Public core surface (`index.ts`) gains: `exportBrain`, `importBrain`,
`brainBundleSchema` (+ types). No new package. No connector changes.

## §1 Bundle format

Single UTF-8 file, two-line NDJSON:

```
{manifest JSON}\n
{payload JSON}
```

- `payloadSha256` = SHA-256 hex of the raw bytes of line 2. Import splits
  on the first newline, hashes the raw remainder, compares, then parses.
  No canonical-JSON machinery needed.
- manifest: `{ schemaVersion: "1" (const), kind: "megabrain" (const),
  sourceProject: { id, name }, createdAt (ISO), counts: { memories,
  rules, failures }, payloadSha256, redactionFindings }`.
- payload: `{ memories: [], rules: [], failures: [] }` with memory
  metadata (source, timestamp, confidence, scope, expires) intact per
  the §13 metadata rule.
- Default filename: `<projectName>-<YYYYMMDD>.megabrain`.

## §2 Export — `mega brain export <projectName> [--out <file>] [--json]`

1. Pro gate FIRST (1.13 pattern: checkEntitlement → upsell exit 0 →
   lazy import of everything else). Entitlement key: `brain-portability`
   (new `ProFeature` union member in @megasaver/entitlement).
2. Project resolved by NAME (codebase convention — no cwd→project
   mapping exists); unknown → exit 1 `projectNotFoundMessage`.
3. Collect: memories with `approval === "approved"` AND
   `scope === "project"` ONLY (session-scoped entries reference
   sessions that do not exist in the target store); all rules; all
   failures.
4. `redactWithFindings` over every content field; any redaction error
   aborts (fail-closed). Findings count → manifest + stdout.
5. Atomic write (tmp + rename). Output: path, counts, redaction summary.

## §3 Import — `mega brain import <projectName> <file> [--json]`

1. Pro gate first, then resolve target project by name (as export).
2. Read file (size cap 100 MB → exit 1 above it), split on first
   newline, hash-verify raw payload bytes. Mismatch → exit 1
   "bundle corrupted or tampered".
3. Zod-parse manifest and payload at the boundary (§8).
   `schemaVersion !== "1"` → exit 1 with upgrade hint.
4. Merge-only, never delete/overwrite:
   - memory → `createMemoryEntry` with `approval: "suggested"`, NEW id,
     target projectId, `sessionId: null`. Original `source` enum value
     is PRESERVED (knowledge fidelity — `memorySourceSchema` is a
     closed enum); provenance recorded by appending
     `"brain-import:<sourceProject.name>"` to `evidence[]`.
     `supersedesId` dropped (would dangle in the target store).
   - rules/failures → existing core create APIs, NEW ids.
   - Dedupe v1, exact-match per type: memories on content+scope; rules
     on rule text; failures on their identity fields (exact fields
     pinned in the plan from the failed-attempt schema). Match in
     target → skip, counted. Semantic dedupe deferred.
5. Report imported/skipped per type + hint: run `mega memory approve`
   to activate. Entity graph is NOT in the bundle — it is derived;
   `buildGraph` (@megasaver/memory-graph) reflects imports on next build.

## §4 Error handling

Exit 1 with a specific message for: unregistered project, unreadable/
oversized file, hash mismatch, unknown schemaVersion, unwritable --out,
redaction failure (export). No silent fallbacks (§13).

## §5 Testing (TDD, red first)

Unit (core): bundle serialize→parse roundtrip; tampered payload byte →
hash reject; planted secret in memory content → masked in bundle +
findings counted; import creates `suggested` entries with new ids and
brain-import source; exact-dupe skipped and counted; unknown
schemaVersion rejected; oversized file rejected.
Integration: export from temp project A → import into temp project B
through the public core surface (DoD #5).
CLI: gate-first spy tests — no store read/compute before entitlement
(1.13 precedent); upsell exit 0; `--json` shapes.
Evidence: `pnpm verify` green + captured smoke run (export → import →
`mega memory list` showing suggested entries).

## Non-goals (explicitly out of 2.0)

Embeddings in bundle; sessions/stats/task plans; Ed25519 authenticity;
semantic dedupe on import; graph serialization; remote/Team sharing
(N6, post-2.0); `--replace` mode; i18n.

## Risk & process

HIGH (§12: memory schema surface, user files): isolated worktree (no
main edits), architect design pass, code-reviewer AND critic in separate
fresh contexts, evidence-preserving only. Changeset required (public
core API + new CLI command).
