---
title: Phase 2 — Semantic Repo Index — design
risk: HIGH
status: draft
created: 2026-06-11
updated: 2026-06-11
related:
  - docs/superpowers/specs/2026-05-10-aa1-context-gate-epic.md
  - docs/superpowers/specs/2026-05-10-bb4-content-store-design.md
  - wiki/concepts/semantic-repo-index.md
  - wiki/syntheses/contextops-roadmap.md
  - wiki/entities/retrieval.md
  - wiki/entities/content-store.md
---

# Phase 2 — Semantic Repo Index — design

## §0 TL;DR

A new `@megasaver/indexer` package that parses a repo into typed
`CodeBlock`s (function/class/component/route/test/config/schema/docs),
plus `mega scan` and `mega index build/status/search/show`. The index
is the block-granular substrate that lets Phase 3 return "6–8 relevant
blocks" instead of "40 files."

Extraction is **AST-based for TS/JS** (use the TypeScript compiler API,
already a dep) and **structural for Markdown/JSON** (heading sections /
top-level keys). Python/Go are explicit later additions. Each block
carries a `contentHash` so re-indexing only re-parses changed blocks.
Storage reuses the JSON-directory pattern; ranking reuses
`@megasaver/retrieval` BM25.

## §1 Motivation

A file is the wrong unit of context. Agents reason about functions,
routes, tests, config stanzas. Today Mega Saver has BM25 ranking
(`@megasaver/retrieval`) and chunk storage (`@megasaver/content-store`)
but nothing that understands code *structure* — verified gap
(wiki/syntheses/contextops-roadmap.md Phase 2). Without a block index,
task-aware pruning (Phase 3) and the `get_relevant_code_blocks` MCP
tool (Phase 4) cannot exist.

## §2 Non-goals

- **No semantic embeddings.** Blocks are indexed by structure +
  keywords + BM25, not vectors.
- **No call-graph resolution across files in v1.** `calls`/`calledBy`
  are populated best-effort from same-file + import references; full
  cross-file symbol resolution is deferred.
- **No watch mode.** `mega index build` is run on demand; incremental
  rebuild via `contentHash` is the perf story, not a daemon.
- **No write/refactor.** Index is read-only analysis; it never mutates
  user source.
- **Python/Go parsers** ship after TS/JS/Markdown/JSON prove the model.

## §3 `CodeBlock` schema (`packages/indexer/src/code-block.ts`)

```
blockType: function | class | component | route | test | config
         | schema | docs
```

| Field | Type | Notes |
|-------|------|-------|
| `id` | `CodeBlockId` | new branded UUID in `@megasaver/shared/ids` |
| `projectId` | `ProjectId` | |
| `filePath` | string | repo-relative, POSIX-normalized |
| `startLine` / `endLine` | int | 1-based inclusive |
| `blockType` | enum above | |
| `name` | string? | symbol/section name |
| `contentHash` | string | sha256 of block text |
| `summary` | string? | first doc line / signature (no LLM) |
| `imports` / `exports` / `calls` / `calledBy` | string[] | best-effort |
| `keywords` | string[] | identifiers + path tokens, lowercased |
| `lastModifiedAt` | datetime? | from git or fs mtime |

## §4 Extraction (`packages/indexer/src/extract/`)

- **`extract-ts.ts`** — TypeScript compiler API (`typescript` package).
  Walk the AST: top-level + exported `FunctionDeclaration`,
  `ClassDeclaration`, `InterfaceDeclaration`/`TypeAlias` (→ `schema`),
  arrow/const components (heuristic: returns JSX / PascalCase) →
  `component`. Collect `imports` from import decls, `exports` from the
  export table, `calls` from `CallExpression` identifiers in scope.
  Tests detected by file glob (`*.test.ts`, `*.spec.ts`) → `test`.
- **`extract-md.ts`** — split on `#`/`##` headings → `docs` blocks
  (name = heading text).
- **`extract-json.ts`** — top-level keys; `package.json` `scripts.*`
  → `config` blocks named `script:<name>`.
- A `blockType` for routes: detected from framework conventions
  (file under `routes/`/`api/`, or decorator/`app.<verb>(` call) —
  best-effort, falls back to `function`.

Each extractor returns `Omit<CodeBlock,"id"|"projectId">[]`; the
indexer assigns ids + hashes.

## §5 Scan & ignore

`mega scan` walks the project root honoring `.gitignore` +
`node_modules`/`dist`/`.git` always-ignore + an optional
`.megaignore`. Reuses the path-safety posture of `@megasaver/policy`
(no traversal outside root). Emits a file inventory (path, size,
language, mtime); binary files and files over a size cap (default
1 MB, `--max-file-size` to override) skipped with a reason. `scan` is
read-only and idempotent.

## §6 CLI surface (`apps/cli/src/commands/`)

- `mega scan <project>` — inventory + counts; `--json`.
- `mega index build <project>` — extract blocks, persist; incremental
  by `contentHash` (re-parse only changed files); prints
  added/updated/removed/unchanged counts.
- `mega index status <project>` — block totals by type, last build,
  staleness (files changed since last build).
- `mega index search <project> "<query>"` — BM25 over block docs;
  `--type`, `--limit`; prints `score  type  file:line  name`.
- `mega index show <block-id>` — full block metadata + the source
  slice (`--json` for raw).

## §7 Storage (`packages/indexer/src/store.ts`)

JSON-directory under `<store>/projects/<projectId>/index/`:
`blocks.jsonl` (one `CodeBlock` per line) + `manifest.json`
(per-file `contentHash` + block ids for incremental diffing). Atomic
writes via the existing `atomicWriteFile`. No new DB. Block search
loads `blocks.jsonl` and ranks in memory (fine to thousands of blocks;
revisit if a repo exceeds that).

## §8 Reconciliation

Reuses, does not duplicate: `@megasaver/retrieval` `rankBm25` for
search; `@megasaver/shared` ids/title patterns; the JSON-directory
store conventions from `@megasaver/core`. `@megasaver/content-store`
(ChunkSet) stays the *output-pipeline* store; the index is a separate
concern (code structure, not tool-output chunks) — do not fold them.

## §9 Risk

**HIGH** — "anything touching user files at scale" (CLAUDE.md §12).
The scanner reads the entire repo; path-traversal safety, ignore
correctness (never index secrets/`.env`/`node_modules`), and not
following symlinks out of root are the critical surfaces. Mandatory:
full chain + `architect` + `critic` + worktree. Reuse the redaction
posture so an indexed block never persists a detected secret.

## §10 Testing

- Extractors: fixture files (a TS module with fn/class/interface/
  component, a Markdown doc, a `package.json`) → expected block sets;
  golden `contentHash` stability.
- Incremental: build, touch one file, rebuild → only that file's blocks
  change; unchanged files report `unchanged`.
- Scan: ignore rules (`.gitignore` + `.megaignore` + always-ignore);
  no traversal outside root; symlink-escape rejected.
- Search: BM25 ordering deterministic; `--type` filter; `file:line`
  formatting.
- Security: a fixture `.env` / secret-bearing file is never indexed;
  detected-secret content never written to `blocks.jsonl`.

## §11 Decisions / open questions

1. **Parser for TS** → TypeScript compiler API (already a workspace
   dep) over tree-sitter (no native build, ESM-friendly).
2. **`calledBy` in v1** → derived only within indexed set after a full
   build (second pass over `calls`); cross-file is approximate.
3. **Route detection** → best-effort heuristic; reviewer may scope to
   a single framework first.
4. Open: store the source slice in the index, or re-read from disk on
   `show`? Recommend re-read (keeps index small, source is source of
   truth) — index holds offsets + hash only.

## §12 Out of scope

- Embeddings / vector index.
- Python/Go/other-language parsers (later).
- File watching / daemon mode.
- Full cross-file call-graph resolution.
- Any source mutation.
