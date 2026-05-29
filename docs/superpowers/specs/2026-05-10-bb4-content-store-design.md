---
title: BB4 — @megasaver/content-store package design
status: proposed
risk: HIGH
created: 2026-05-10
parent: aa1-context-gate-epic
sub-pr: BB4
---

# BB4 — `@megasaver/content-store` package design

> Child spec of [`2026-05-10-aa1-context-gate-epic.md`](./2026-05-10-aa1-context-gate-epic.md).
> The epic is the authority. This spec locks the public surface, Zod
> schemas, closed enums, error codes, on-disk layout, atomic-write
> behaviour, retention, and the §3c dependency allow-list for BB4.
> Read epic §10 (content store), §3 (workspace layout / dep graph /
> cycle guardrails), and §17 (closed-enum tuple pins) in full before
> implementing.

---

## 1. Goal & scope

Add the entire new `@megasaver/content-store` package. It persists
`ChunkSet`s — the filtered, optionally-redacted output excerpts the
context-gate pipeline produces — under a JSON-per-chunkSet on-disk
layout, with atomic writes, retention pruning, and a closed error
enum. It is consumed by the context-gate orchestrator inside
`@megasaver/core` (BB7a) and indirectly by `mega output` (BB7a/BB7b)
and the MCP bridge (BB8).

**In scope (BB4):**

- New package scaffold mirroring `packages/shared/` exactly.
- Public API per §10b: `saveChunkSet`, `loadChunkSet`,
  `listChunkSets`, `deleteChunkSet`, `pruneOlderThan`.
- `ChunkSet` / `Chunk` Zod schemas (§10d), including the `redacted`
  invariant flag.
- `ContentStoreError` + `ContentStoreErrorCode` closed enum (§17,
  alphabetic, AA3-pinned).
- Atomic write implemented in-package (POSIX dir-fsync; Windows-aware),
  behaviourally parity-tested against `@megasaver/core`'s
  implementation (§10c).
- Injected clock for retention (`pruneOlderThan({ olderThan: Date })`).
- §3c dependency-graph cycle-guard test.

**Out of scope (BB4 — owned elsewhere):**

- The context-gate orchestrator that calls `saveChunkSet`
  (`packages/core/src/context-gate/run.ts`) — BB7a.
- Enforcing the redaction invariant at write time (the orchestrator
  runs `policy.redact()` and sets the flag) — BB5 ships the
  integration test; BB4 only ships the roundtrip-preservation test.
- The daily-prune lockfile wiring at CLI startup — BB4 ships the
  `pruneOlderThan` primitive (the "stub"); v0.8 GUI polish wires the
  user-visible control.
- Any export change to `@megasaver/core` — see §6 (atomic-write parity)
  for why BB4 does NOT modify core.

**Risk: HIGH.** The epic §14 classifies BB4 as MEDIUM, but this child
spec is authored at HIGH per the BB4 directive: content-store handles
the `redacted` flag whose correctness is a secret-leakage concern, and
the atomic-write path is data-durability code. HIGH chain applies
(architect design + critic review). Reviewer may upgrade, never
silently downgrade (CLAUDE.md §12).

---

## 2. Dependency allow-list (§3c — LOCKED)

Per epic §3c, `@megasaver/content-store` runtime `dependencies` are a
**subset of**:

| Allowed runtime dependency        | Why                                                  |
|-----------------------------------|------------------------------------------------------|
| `@megasaver/shared`               | `projectIdSchema`, `sessionIdSchema`, `ProjectId`, `SessionId` |
| `@megasaver/output-filter`        | `OutputSourceKind` type + `outputSourceKindSchema` (source discriminator, §10d) |
| `zod`                             | schema validation at boundaries                       |

**MUST NOT depend on:** `@megasaver/core` (cycle guardrail — core
depends on content-store), `@megasaver/policy`, `@megasaver/retrieval`,
`@megasaver/stats`, `@megasaver/mcp-bridge`, any app.

**Sequencing note (resolved).** Epic §14-bis describes a placeholder
path for `OutputSourceKind` when BB5 lands after BB4. In *this
worktree*, `@megasaver/output-filter` is already present and exports
`outputSourceKindSchema` / `OutputSourceKind` from its barrel
(`packages/output-filter/src/index.ts`). Therefore BB4 imports the
canonical enum directly from `@megasaver/output-filter` — no local
placeholder, no §14-bis dedupe step needed. The allow-list above
reflects this final state and matches the BB4 directive's allow-list
exactly.

**devDependencies** (not checked by the dep-graph test, which inspects
`dependencies` only): `@types/node ^22.19.17`, `fast-check ^3.23.2`,
and a workspace link to `@megasaver/core` used **only** as a
test-fixture import for the atomic-write behavioural-parity test (§6).
Importing core from a *test* is permitted because the runtime package
graph (the thing that can deadlock builds / form cycles) is unaffected;
the dep-graph test asserts `dependencies` excludes core, and that holds.

---

## 3. On-disk layout (§10a — LOCKED)

```
<storeRoot>/content/<projectId>/<sessionId>/<chunkSetId>.json
```

- `<storeRoot>` is the already-resolved store root path **passed in by
  the caller**. content-store does NOT call `resolveStorePaths`
  (that lives in core; importing it is a banned cycle). Callers
  (core orchestrator, BB7a) resolve the root and hand it over.
- `<projectId>` and `<sessionId>` are branded UUID strings
  (`packages/shared/src/ids.ts`: `z.string().uuid().brand<…>()`). They
  are safe path segments (UUID charset has no separators / `..`).
- `<chunkSetId>` is a non-empty string (`chunkSchema`/`chunkSetSchema`
  require `.min(1)`). It is used as a filename; it is validated to be a
  single path segment (no `/`, no `\`, not `.`/`..`) at the boundary —
  see §5 path-safety.
- One JSON file per chunkSet. The file content is the
  `chunkSetSchema`-validated JSON.

---

## 4. Public surface (§10b / §10d — LOCKED)

`src/index.ts` re-exports ONLY the following. Everything else is
package-private.

### 4a. Schemas & types

```ts
// src/chunk-set.ts
export const chunkSchema = z.object({
  id: z.string().min(1),
  startLine: z.number().int().nonnegative(),
  endLine: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  text: z.string(),
}).strict();
export type Chunk = z.infer<typeof chunkSchema>;

export const chunkSetSchema = z.object({
  chunkSetId: z.string().min(1),
  sessionId: sessionIdSchema,   // from @megasaver/shared
  projectId: projectIdSchema,   // from @megasaver/shared
  createdAt: z.string().datetime({ offset: true }),
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("command"), command: z.string(), args: z.array(z.string()).readonly() }),
    z.object({ kind: z.literal("file"),    path: z.string() }),
    z.object({ kind: z.literal("grep"),    query: z.string() }),
    z.object({ kind: z.literal("fetch"),   url: z.string().url() }),
  ]),
  rawBytes: z.number().int().nonnegative(),
  redacted: z.boolean(),
  chunks: z.array(chunkSchema).readonly(),
}).strict();
export type ChunkSet = z.infer<typeof chunkSetSchema>;
```

`ChunkSchema` / `ChunkSetSchema` type aliases (per §10b naming) are
exported as the inferred types above. The discriminator literals
(`command | fetch | file | grep`) are exactly the members of
`OutputSourceKind` (§17). A type-level test (§7) asserts the
discriminator key set equals `outputSourceKindSchema.options` so the
two enums cannot drift.

`ChunkSetSummary` (returned by `listChunkSets`) is the metadata
projection used to enumerate without loading full chunk text:

```ts
export type ChunkSetSummary = {
  chunkSetId: string;
  createdAt: string;
  source: ChunkSet["source"];
  rawBytes: number;
  redacted: boolean;
  chunkCount: number;
};
```

### 4b. Functions

```ts
export function saveChunkSet(input: {
  storeRoot: string;
  chunkSet: ChunkSet;
}): Promise<void>;

export function loadChunkSet(input: {
  storeRoot: string;
  projectId: ProjectId;
  sessionId: SessionId;
  chunkSetId: string;
}): Promise<ChunkSet>;            // throws ContentStoreError("not_found") on miss

export function listChunkSets(input: {
  storeRoot: string;
  projectId: ProjectId;
  sessionId: SessionId;
}): Promise<readonly ChunkSetSummary[]>;

export function deleteChunkSet(input: {
  storeRoot: string;
  projectId: ProjectId;
  sessionId: SessionId;
  chunkSetId: string;
}): Promise<void>;

export function pruneOlderThan(input: {
  storeRoot: string;
  olderThan: Date;                // caller passes an explicit clock; no Date.now() inside
}): Promise<{ removed: number }>;
```

### 4c. Error surface

```ts
// src/errors.ts
export const contentStoreErrorCodeSchema = z.enum([
  "not_found",
  "schema_invalid",
  "store_corrupt",
  "write_failed",
]);
export type ContentStoreErrorCode = z.infer<typeof contentStoreErrorCodeSchema>;

export class ContentStoreError extends Error {
  readonly code: ContentStoreErrorCode;
  constructor(code: ContentStoreErrorCode, message?: string, options?: { cause?: unknown });
}
```

`ContentStoreErrorCode` is a **closed enum** (§17). Members are
**alphabetic** and pinned by an AA3 tuple-ordering `*.test-d.ts`
(mirroring `packages/shared/test/token-saver-mode.test-d.ts`).

---

## 5. Behaviour contracts (LOCKED)

### 5a. `saveChunkSet`

1. Validate `input.chunkSet` with `chunkSetSchema`. On failure throw
   `ContentStoreError("schema_invalid", …, { cause })`.
2. Compute path: `<storeRoot>/content/<projectId>/<sessionId>/<chunkSetId>.json`,
   using the validated `chunkSet.projectId` / `.sessionId` / `.chunkSetId`.
   Reject a `chunkSetId` that is not a single safe path segment
   (contains `/`, `\`, or equals `.`/`..`) with
   `ContentStoreError("write_failed", …)`.
3. `JSON.stringify` the validated object (2-space indent, matching
   core's writer style for diff-friendliness) and atomic-write it
   (§6). Any fs failure → `ContentStoreError("write_failed", …, { cause })`.
4. `redacted` is persisted verbatim from the caller — content-store
   does NOT redact. (The orchestrator sets it; BB5 enforces the
   invariant.) BB4 ships a roundtrip test proving the flag survives.

### 5b. `loadChunkSet`

1. Read the file at the computed path. `ENOENT` →
   `ContentStoreError("not_found", …)`.
2. `JSON.parse`. Parse failure → `ContentStoreError("store_corrupt", …, { cause })`.
3. `chunkSetSchema.parse`. Schema failure on an existing file →
   `ContentStoreError("store_corrupt", …, { cause })` (the file is on
   disk but malformed — distinct from `schema_invalid`, which is a
   bad *input* to `saveChunkSet`).
4. Return the validated `ChunkSet`.

### 5c. `listChunkSets`

1. Enumerate `<storeRoot>/content/<projectId>/<sessionId>/*.json`.
   Missing directory → return `[]` (an empty session is not an error).
2. For each file, load + validate, project to `ChunkSetSummary`
   (`chunkCount = chunks.length`). A single corrupt file →
   `ContentStoreError("store_corrupt", …)` naming the offending file.
3. Order is unspecified by the API contract; the test fixture sorts by
   `createdAt` for determinism in assertions but the function need not
   guarantee order. (Locked: callers must not rely on order.)

### 5d. `deleteChunkSet`

1. Remove the file at the computed path. Missing file is **idempotent**
   (no throw — delete-of-absent is success). fs failure other than
   ENOENT → `ContentStoreError("write_failed", …, { cause })`.

### 5e. `pruneOlderThan`

1. Walk `<storeRoot>/content/**/<chunkSetId>.json`. Missing `content/`
   root → `{ removed: 0 }`.
2. For each chunkSet, parse `createdAt`; if `createdAt < olderThan`,
   delete the file and increment `removed`.
3. A file that fails to parse during prune is treated as corrupt and
   **skipped** (not deleted, not counted) — pruning must never silently
   destroy unreadable data; it returns `removed` for the cleanly-aged
   files only. (Locked: no `store_corrupt` throw mid-prune; prune is
   best-effort over the well-formed set.)
4. `olderThan` is the injected clock boundary. content-store never reads
   the wall clock itself.

### 5f. Path safety (boundary)

- `projectId` / `sessionId` are branded UUIDs — schema-guaranteed safe
  segments when they arrive via a validated `ChunkSet` (save) or are
  re-validated with `projectIdSchema` / `sessionIdSchema` at the
  `load`/`list`/`delete` boundary. Invalid id → `ContentStoreError`
  (`not_found` for load/delete miss semantics is wrong here; an invalid
  *id shape* is `schema_invalid`).
- `chunkSetId` is validated to be a single safe path segment before use
  in any path (§5a step 2). This is the only free-form segment.

---

## 6. Atomic write — behavioural parity (§10c — LOCKED)

Atomic write is implemented **inside** content-store
(`src/atomic-write.ts`), mirroring
`packages/core/src/json-directory-store.ts:235–286`:

- temp file `.${randomUUID()}.tmp` in the parent dir;
- reject a symlinked parent dir before writing;
- `mkdirSync(parentDir, { recursive: true })`;
- `writeFileSync(temp)`; `fsync` the temp fd; `renameSync(temp, final)`;
- POSIX-only parent-dir fsync, gated on `IS_WIN32 = process.platform === "win32"`
  captured at module load (Windows: dir-fsync is a documented no-op and
  `openSync(dir, "r")` throws EISDIR, so it is skipped);
- on any failure: best-effort `rmSync(temp, { force: true })` then
  throw (here: `ContentStoreError("write_failed", …, { cause })`).

The ≈50 LOC duplication is **bounded and intentional** (epic §10c,
§19j): content-store MUST NOT import core (cycle). Revision 1's
source-byte-hash parity test is rejected (§19j — brittle). Instead a
**behavioural parity test** (`test/atomic-write-behavior.test.ts`) runs
both implementations against the same write sequences and asserts
identical observable outcomes:

1. success path — file present with exact bytes, no leftover `*.tmp`;
2. crash-during-rename — original (if any) intact, no partial final,
   temp cleaned;
3. crash-after-rename — final present and complete;
4. dir-symlink-attack — both refuse to write through a symlinked parent;
5. parent-doesn't-exist — both create it (recursive mkdir) then write.

The test imports core's `atomicWriteFile` as a **test fixture**. core
currently does NOT export it. **BB4 does not modify core.** Resolution:
the parity test imports core's `json-directory-store.ts` via a deep
test-only path and exercises atomic-write through core's *public*
write surface (e.g. a project/session save against a temp store), OR —
if no public path reaches all five scenarios — the test imports the
unexported function via `@megasaver/core/src/json-directory-store.js`
deep specifier guarded as a test fixture. Adding an
`atomicWriteFile` export to core is explicitly **deferred** to BB5/BB7a
(which already touch core) to keep BB4's diff inside its package. (Open
question OQ-1.)

---

## 7. Test-d tuple pins (§17 — LOCKED)

- `test/error-code.test-d.ts` — AA3 pin for `ContentStoreErrorCode`.
  Mirrors `packages/shared/test/token-saver-mode.test-d.ts`: each member
  assignable; non-member literal `@ts-expect-error`; `.options` spreads
  into `ContentStoreErrorCode[]`; `.options` equals the exact alphabetic
  readonly tuple `["not_found", "schema_invalid", "store_corrupt", "write_failed"]`.
- `test/source-discriminator.test-d.ts` — asserts the `chunkSetSchema`
  `source.kind` literal union equals `OutputSourceKind`
  (`outputSourceKindSchema.options`), so the discriminator cannot drift
  from the shared enum.

---

## 8. File map (locked — see plan for task ordering)

```
packages/content-store/
  package.json                          scaffold (mirror shared; deps per §2)
  tsconfig.json                         mirror shared
  tsconfig.test.json                    mirror shared
  tsconfig.test-d.json                  mirror shared
  tsup.config.ts                        mirror shared
  vitest.config.ts                      mirror shared
  src/
    index.ts                            barrel — public surface ONLY
    chunk-set.ts                        chunkSchema, chunkSetSchema, types, ChunkSetSummary
    errors.ts                           ContentStoreError + contentStoreErrorCodeSchema
    atomic-write.ts                     in-package atomic write (≈50 LOC)
    paths.ts                            path computation + chunkSetId segment-safety
    store.ts                            save/load/list/delete/pruneOlderThan
  test/
    dependency-graph.test.ts            §3c cycle guard
    chunk-set.test.ts                   schema validation + redacted invariant roundtrip
    store.test.ts                       save/load/list/delete/prune acceptance
    atomic-write-behavior.test.ts       §10c behavioural parity vs core
    error-code.test-d.ts                AA3 pin for ContentStoreErrorCode
    source-discriminator.test-d.ts      discriminator == OutputSourceKind
```

---

## 9. Acceptance criteria (§14 BB4 — LOCKED)

1. Roundtrip: `saveChunkSet` → `loadChunkSet` returns a deep-equal
   `ChunkSet`; `deleteChunkSet` removes it; subsequent `loadChunkSet`
   throws `ContentStoreError("not_found")`.
2. `loadChunkSet` of a never-written id throws `not_found`.
3. `loadChunkSet` of a corrupt on-disk file throws `store_corrupt`;
   `saveChunkSet` of a schema-invalid input throws `schema_invalid`.
4. `pruneOlderThan({ olderThan })` removes only chunkSets with
   `createdAt < olderThan` and returns the correct `removed` count;
   clock is injected, never read internally.
5. **Redaction flag preserved (F-MAJ-3):** save with `redacted: true`
   then load yields `redacted: true`; same for `false`. (BB4 does not
   enforce the invariant; it preserves the flag.)
6. Atomic-write behavioural parity vs core across all five scenarios (§6).
7. `dependency-graph.test.ts` passes: `dependencies` is a subset of the
   §2 allow-list and excludes `@megasaver/core`.
8. AA3 pin (`error-code.test-d.ts`) + discriminator pin
   (`source-discriminator.test-d.ts`) pass under `vitest typecheck`.
9. `pnpm verify` green at the worktree root (lint + typecheck + test +
   conventions:check) after `pnpm install` re-links the new workspace
   package.

---

## 10. RALPLAN-DR consensus summary (for Architect/Critic review)

**Mode:** SHORT (HIGH risk; no `--deliberate` flag given).

### Principles

1. Cycle guardrail is inviolable — content-store never imports core at
   runtime; the store root is injected.
2. Validate at the boundary (Zod), trust internals (CLAUDE.md §8).
3. Injected clock for retention — no hidden wall-clock reads (testability
   + determinism).
4. Bounded, intentional duplication of atomic-write beats a forbidden
   import; parity is proven behaviourally, not by byte-hash.
5. Mirror `packages/shared/` scaffold exactly — zero scaffold novelty.

### Decision drivers (top 3)

1. Secret-leakage / durability risk → HIGH chain, redaction-flag
   roundtrip + atomic-write parity are gating tests.
2. Dependency-cycle prevention → structural dep-graph test is
   non-optional (epic §3c, F-MIN-1).
3. Closed-enum discipline → AA3 pin + discriminator-equality pin prevent
   silent enum drift across packages.

### Options considered

- **O1 (chosen): in-package atomic write + behavioural parity test.**
  Pros: no core import (cycle-safe), test is refactor-robust. Cons:
  ≈50 LOC duplication; parity test must reach 5 scenarios through
  core's surface or a guarded deep test import.
- **O2: export `atomicWriteFile` from core and import it at runtime.**
  Pros: zero duplication. Cons: **forbidden** — content-store importing
  core is the exact cycle §3c bans. INVALIDATED.
- **O3: source-byte-hash parity test (Revision 1).** Pros: trivial.
  Cons: brittle — any whitespace/refactor in either file falsely fails
  CI (epic §19j). INVALIDATED by the epic.

Two options remain viable in principle (O1 vs a future "add core export
for *tests only*"); O1 is chosen for the smallest BB4 diff. O2/O3 carry
explicit invalidation rationale above.

### ADR

- **Decision:** Ship content-store with an in-package atomic-write
  implementation and a behavioural-parity test against core; import
  `OutputSourceKind` directly from the already-present
  `@megasaver/output-filter`.
- **Drivers:** cycle safety, durability/secret risk, enum discipline.
- **Alternatives considered:** runtime core import (O2, forbidden);
  byte-hash parity (O3, brittle); local `OutputSourceKind` placeholder
  (epic §14-bis path — unnecessary here because output-filter exists).
- **Why chosen:** smallest cycle-safe diff that satisfies all §10
  invariants and the §3c guardrail.
- **Consequences:** ≈50 LOC duplicated atomic-write; a core
  dev-dependency used only as a test fixture; a deferred core
  `atomicWriteFile` export (OQ-1).
- **Follow-ups:** BB5/BB7a may add `atomicWriteFile` to core's barrel
  and simplify BB4's parity fixture; BB5 ships the orchestrator
  redaction-invariant integration test; v0.8 wires the daily-prune
  lockfile + GUI control.

---

## 11. Open questions (deferred)

- **OQ-1:** Should the atomic-write parity test exercise core through
  its public write surface, or import the unexported `atomicWriteFile`
  via a deep test-only specifier? Decide during implementation based on
  whether the public surface can reach all five §6 scenarios. Either way
  BB4 does not add a core export.
- **OQ-2:** `listChunkSets` ordering is left unspecified by contract.
  If BB7a/BB8 need a guaranteed order, add it in that PR (do not
  speculatively add now — CLAUDE.md §13 no premature abstraction).
