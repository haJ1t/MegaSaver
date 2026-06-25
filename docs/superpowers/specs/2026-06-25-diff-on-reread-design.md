---
feature: diff-on-reread
date: 2026-06-25
risk: HIGH
status: approved-design
build-order: "2 of 3 (#2 done -> #1 -> #3)"
---

# diff-on-reread (unchanged-suppression) — Design Spec

## Problem

`proxy_read_file` re-reads, re-filters, re-persists, and re-returns a
file's filtered excerpts on **every** call, even when the agent reads
the same file twice in one session and the file has not changed. The
second read pays the full token cost of the first for zero new signal.
This is the most common waste pattern in an agent loop: read a file,
edit elsewhere, re-read the same file to "remember" it. Mega Saver's
whole premise is "less tokens, more signal" — re-emitting byte-identical
content is pure waste.

## Goal

When a file is read again in the same session and its content hash is
unchanged since the prior read, **suppress** the filtered output: return
a tiny "unchanged" marker that points at the recoverable prior
`chunkSetId`, and skip both `filterOutput` and chunk-set persistence.
The agent can `proxy_expand_chunk(priorChunkSetId, ...)` to recover the
full prior content — the suppression is **lossless**.

v1 ships **suppression only**. No diff hunks.

Success criteria (verifiable):
1. Second read of an unchanged file returns `unchanged: { priorChunkSetId }`,
   `excerpts: []`, and a marker `summary`.
2. On a suppressed read, `filterOutput` is NOT called and no new chunk-set
   is persisted (assert via spies).
3. First read (cache miss) behaves exactly as today: filter + persist +
   then record into the read-index.
4. A read after the file's bytes change is a cache miss (filter + persist
   + record), and the returned result has NO `unchanged` field.
5. Both pipeline variants (registry + overlay) exhibit 1–4.
6. `pnpm verify` green across touched packages.

## Non-Goals (YAGNI)

- **No diff hunks.** v1 says "unchanged" or "here's the fresh filtered
  output". Producing a line-level diff of a *changed* file is deferred —
  it is a separate feature with its own spec.
- **No mtime fast-path.** mtime is cross-platform unreliable (FAT
  resolution, network FS clock skew, editors that preserve mtime). The
  file IS read on every call (we need the bytes to hash); the win is
  skipping `filterOutput` + persist + re-emitting content, not skipping
  the `readFile`.
- **No in-memory cache.** The read-index is on-disk per-session JSON.
  No process-lifetime LRU, no shared cache across the daemon and the
  in-process fallback. Each pipeline reads its index file fresh.
- **No cross-session dedup.** The index is keyed per session
  (registry: per `(projectId, sessionId)`; overlay: per
  `(workspaceKey, liveSessionId)`). A read in session A never suppresses
  a read in session B.

## Locked Decisions (do not deviate)

These nine decisions are fixed. Implementation must follow them exactly.

1. **On-disk per-session read-index.** A JSON file recording, per
   session, which file paths were read and their content hash +
   `chunkSetId`.

2. **Response shape: optional `unchanged` field on `FilterOutputResult`.**
   Add `unchanged?: { priorChunkSetId: string }`. When set:
   `excerpts = []`, `decision` is the unchanged-marker, and `summary`
   reads like
   *"File unchanged since last read this session — expand priorChunkSetId to view."*
   This is **NOT** a discriminated union. Minimize blast radius: existing
   consumers read `summary`/`excerpts` and must not break — `excerpts`
   stays an array (empty), and all other numeric/string fields stay
   present.

3. **v1 = SUPPRESS ONLY.** No diff hunks. (diff deferred.)

4. **Content hash = sha256 of the raw file bytes via `node:crypto`.**
   mtime fast-path DEFERRED. The file IS read on every call (needed to
   hash); the win is skipping `filterOutput` + persist + re-returning
   content.

5. **read-index key = `sha256(absolutePath)` (hex).** Value =
   `{ contentHash: string; chunkSetId: string }`. Keying by path-hash
   avoids storing raw paths on disk (consistent with the codebase's
   path-redaction-at-sink posture — every persist sink already
   `redact()`s the path).

6. **Two pipeline variants both covered.** The registry path is keyed by
   `(projectId, sessionId)`; the overlay path is keyed by
   `(workspaceKey, liveSessionId)`. Each gets its own read-index file
   under the SAME per-session content dir the chunk-sets already use
   (`<storeRoot>/content/<projectId|workspaceKey>/<sessionId|liveSessionId>/`).

7. **Atomic write (tmp + rename) for the index**, mirroring existing
   atomic writers. Reuse `atomicWriteFile` from `@megasaver/content-store`
   (it already does tmp + fsync + rename + Windows-safe handling).
   (Implementation note: `atomicWriteFile` is internal today; honoring
   this decision requires exporting it from content-store — see C1b.)

8. **Short-circuit point in both `runOutputPipeline` AND
   `runOverlayOutputPipeline`** (`packages/context-gate/src/run.ts`),
   after settings + gates pass: READ raw content, compute sha256, look up
   the read-index by `sha256(absolute)`. If an entry exists AND its
   `contentHash === newHash` → return a `FilterOutputResult` carrying the
   unchanged marker (`priorChunkSetId`), and SKIP `filterOutput` + SKIP
   persist. Otherwise: filter (as today), persist the chunk-set (as
   today), THEN record `{ sha256(abs): { contentHash, chunkSetId } }`
   into the read-index.

9. **Split read from filter** to enable "hash before filter": refactor
   `packages/context-gate/src/read.ts` `readAndFilter` into
   `readRaw(absolute)` (returns raw or a typed read error) and
   `filterRaw({ raw, path, intent, mode, maxReturnedBytes })` (returns
   `FilterOutputResult`). Keep a thin `readAndFilter` wrapper — it has
   external callers (`@megasaver/core` `src/context-gate.ts` and the
   package `index.ts` re-export). Minimize blast radius.

## Components

### C1. read-index module — `packages/context-gate/src/read-index.ts`

New file. Pure functions over the on-disk index. No class.

```ts
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFile } from "@megasaver/content-store";
// ^ NOTE: `atomicWriteFile` is NOT currently on content-store's public
// surface. It lives in content-store/src/atomic-write.ts and is internal;
// content-store/src/index.ts exports only saveChunkSet / loadChunkSet /
// listChunkSets / pruneOlderThan / etc. The import above therefore does
// NOT compile as written. It is enabled by C1b below.

type ReadIndexEntry = { contentHash: string; chunkSetId: string };
type ReadIndex = Record<string, ReadIndexEntry>; // key = sha256(absolutePath)

export function hashContent(raw: string | Buffer): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function hashPath(absolutePath: string): string {
  return createHash("sha256").update(absolutePath).digest("hex");
}

// <sessionDir>/read-index.json — same dir as the session's chunk-sets.
export function readIndexPath(sessionDir: string): string {
  return join(sessionDir, "read-index.json");
}

// Best-effort: missing OR corrupt -> {} (treat as a cold cache, NEVER throw).
export function loadReadIndex(sessionDir: string): ReadIndex { ... }

export function recordRead(
  sessionDir: string,
  pathHash: string,
  entry: ReadIndexEntry,
): void { ... } // load -> set key -> atomicWriteFile; best-effort
```

Key decisions for this module:
- Hash the file via `node:crypto` `createHash("sha256")`. Hash on the
  raw bytes (a `Buffer`) — do not utf8-roundtrip just to hash. (See
  Data Flow on read-once vs hash-bytes.)
- `loadReadIndex`: `ENOENT` → `{}`. `JSON.parse` throw or non-object →
  `{}`. NEVER throw out of this function. A corrupt index degrades to a
  cache miss, never a broken read.
- `recordRead`: load the current index, set the one key, write the whole
  object atomically. A small JSON map per session; whole-file rewrite is
  fine (ponytail: per-key append-log only if a session ever accumulates
  thousands of distinct read paths — not v1).
- The index file lives next to chunk-sets in the per-session dir
  (Locked Decision 6 fixes this location). Two content-store readers
  iterate that dir and must tolerate the new `read-index.json`:
  - `pruneOlderThan` (store.ts) already tolerates it: it `readdirSync`s
    the session dir, tries to parse each `*.json` as a `ChunkSet`, and on
    failure hits the existing `continue` (store.ts L245) — `read-index.json`
    is skipped, not crashed. No prune change needed.
  - `listChunkSets` (store.ts L114-128) does **NOT** tolerate it. It
    iterates every `*.json` and calls `parseExistingFile`, which **throws**
    `ContentStoreError("store_corrupt")` on any non-`ChunkSet` JSON. After
    the first read writes `read-index.json` into the session dir, the next
    `listChunkSets` throws — and `listChunkSets` is the core of recall:
    both `recall` callers (daemon `recallRegistryHandler`,
    handlers-registry.ts L76; mcp-bridge `recall.ts` L47) would break. This
    is a HARD breakage, not a degradation. See **C1a** for the required
    `listChunkSets` change. (This is why the read-index must NOT be moved
    out of the session dir — Locked Decision 6 pins it inside, so the
    reader is fixed instead.)

### C1a. `listChunkSets` must skip the read-index — `packages/content-store/src/store.ts`

**Required, not optional.** Without this, the first suppressed-read write
breaks recall on the next call (see C1). `listChunkSets` (store.ts
L114-128) currently does:

```ts
for (const name of names) {
  if (!name.endsWith(".json")) continue;
  const path = join(dir, name);
  const chunkSet = parseExistingFile(path, readFileSync(path, "utf8")); // THROWS on non-ChunkSet
  summaries.push({ ... });
}
```

`parseExistingFile` throws `ContentStoreError("store_corrupt")` on any
JSON that is not a valid `ChunkSet`. `read-index.json` is exactly such a
file. Fix: skip the reserved read-index filename by name (cheapest, most
honest — it is a known sibling file, not a corrupt chunk-set). Add a
shared constant so C1 and C1a agree on the filename:

```ts
// store.ts (or a shared paths/const module imported by both)
export const READ_INDEX_FILENAME = "read-index.json";

// inside listChunkSets, before/with the .json guard:
for (const name of names) {
  if (!name.endsWith(".json")) continue;
  if (name === READ_INDEX_FILENAME) continue; // sibling index, not a chunk-set
  ...
}
```

Decision: skip by exact filename, NOT by swallowing parse errors.
`pruneOlderThan` swallows parse errors (its `continue` on a `catch`)
because prune is best-effort cleanup; but `listChunkSets` feeds recall
and must keep surfacing genuinely corrupt chunk-sets as `store_corrupt`
(silently hiding a corrupt chunk-set from recall would mask data loss).
Skipping one reserved filename keeps that signal intact.

`pruneOlderThan` is left as-is (its existing `continue` already skips the
read-index harmlessly), but it should reuse `READ_INDEX_FILENAME` for the
explicit `name === READ_INDEX_FILENAME` skip too, so the reserved name has
a single source of truth and is never accidentally parsed/pruned as a
chunk-set. (Pruning the index file itself is out of scope for v1; a stale
index degrades to cache misses, see Error Handling.)

This is a `@megasaver/content-store` change. It alters the package's
read-side behavior (a new reserved filename in the session dir) and so
requires a changeset for `@megasaver/content-store` (see
Definition-of-Done Deltas). No public-API signature change to
`listChunkSets` itself.

### C1b. Make `atomicWriteFile` reusable — `packages/content-store/src/index.ts`

**Required for C1 to compile.** Locked Decision 7 says reuse
`atomicWriteFile` from `@megasaver/content-store`, but it is currently
internal: defined in `content-store/src/atomic-write.ts` and absent from
`content-store/src/index.ts`'s `exports`. Every other consumer
(`@megasaver/stats`, `@megasaver/agent-office`, `@megasaver/evidence-ledger`,
and `core/src/json-directory-store.ts` + `core/src/overlay-store.ts`)
keeps its OWN private copy rather than importing one. So there are two
ways to honor Locked Decision 7, and the spec must pick one:

**Chosen: export `atomicWriteFile` from content-store's public surface.**
Add to `content-store/src/index.ts`:

```ts
export { atomicWriteFile } from "./atomic-write.js";
```

Rationale: content-store is the durable-storage package; the atomic
tmp+fsync+rename writer is its natural home, and the read-index is a
storage artifact living in content-store's own session dirs. Exporting
it lets context-gate reuse the exact same Windows-safe / fsync-correct
implementation instead of spawning a seventh private copy. This is a
**content-store public-API addition** and therefore requires a
`@megasaver/content-store` changeset (the original DoD omitted this — now
fixed in Definition-of-Done Deltas).

**Rejected alternative: a seventh private copy** in
`packages/context-gate/src/atomic-write.ts` (mirroring the existing six).
This needs no content-store changeset, but it duplicates a ~50-line
durability-critical writer a seventh time, and Locked Decision 7
explicitly says "from `@megasaver/content-store`" — a private copy would
violate the locked wording. If, during impl, the content-store
public-surface change is deemed too broad for this feature, fall back to
the private-copy pattern AND raise it as a deviation from Locked Decision
7 for sign-off (do not silently switch). Either way the import line in
C1 must change accordingly.

### C2. `FilterOutputResult.unchanged` marker — `packages/output-filter/src/types.ts`

Add ONE optional field to the existing type (Locked Decision 2):

```ts
export type FilterOutputResult = {
  summary: string;
  excerpts: readonly OutputExcerpt[];
  // ...all existing fields unchanged...
  unchanged?: { priorChunkSetId: string };
};
```

- Not a discriminated union. No change to `decision`/`classification`
  unions beyond adding the unchanged-marker `decision` value (see below).
- `decision`: add a marker value (e.g. `"unchanged-marker"`) to the
  `FilterDecision` union so the suppressed result carries a distinct,
  honest decision. Confirm the exact union location during impl; keep the
  addition minimal.
- Because the daemon `/read-registry` handler returns
  `{ ...result.result }` (handlers-registry.ts L206) and mcp-bridge only
  `.strict()`-validates the **input** args (read-file.ts L23, not the
  response), the new optional field flows to the agent with **zero**
  daemon or mcp-bridge code changes. Verify this assumption with a test
  (see Testing T7).

### C3. `readRaw` / `filterRaw` split — `packages/context-gate/src/read.ts`

Refactor `readAndFilter` (current L146-169) into two functions plus a
thin wrapper:

```ts
export async function readRaw(absolute: string): Promise<
  { ok: true; raw: string } | { ok: false; message: string }
> {
  try {
    return { ok: true, raw: await readFile(absolute, "utf8") };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "read failed" };
  }
}

export function filterRaw(input: {
  raw: string;
  path: string;
  intent: string;
  mode: TokenSaverMode;
  maxReturnedBytes: number | undefined;
}): FilterOutputResult {
  return filterOutput({
    raw: input.raw,
    intent: input.intent,
    mode: input.mode,
    ...(input.maxReturnedBytes !== undefined ? { maxReturnedBytes: input.maxReturnedBytes } : {}),
    source: { kind: "file", path: input.path },
  });
}

// Thin wrapper — preserves the existing external signature for
// @megasaver/core and the index.ts re-export.
export async function readAndFilter(input: {
  absolute: string; path: string; intent: string;
  mode: TokenSaverMode; maxReturnedBytes: number | undefined;
}): Promise<{ ok: true; raw: string; result: FilterOutputResult } | { ok: false; message: string }> {
  const r = await readRaw(input.absolute);
  if (!r.ok) return r;
  return { ok: true, raw: r.raw, result: filterRaw({ ...input, raw: r.raw }) };
}
```

Note: hashing on the utf8 string returned by `readRaw` keeps the split
single-read and is consistent across the two reads (same encoding both
times). This is acceptable — the hash only needs to be stable within a
session, not match an external `sha256sum`. (See Data Flow.)

Export `readRaw`, `filterRaw`, and the read-index functions from
`packages/context-gate/src/index.ts`.

### C4. Pipeline short-circuit — `packages/context-gate/src/run.ts`

In **both** `runOutputPipeline` and `runOverlayOutputPipeline`, replace
the single `readAndFilter` call with the read → hash → lookup → branch
flow. The session dir is built from the same keys the persist functions
use:
- registry: `<storeRoot>/content/<settings.projectId>/<sessionId>/`
- overlay:  `<storeRoot>/content/<workspaceKey>/<liveSessionId>/`

A shared helper keeps both call sites tiny. Sketch (registry variant):

```ts
const read = await readRaw(gate.absolute);
if (!read.ok) return { ok: false, reason: "file_read_failed", detail: read.message };

const newHash = hashContent(read.raw);
const pathHash = hashPath(gate.absolute);
const sessionDir = join(input.storeRoot, "content", settings.projectId, input.sessionId);
const prior = loadReadIndex(sessionDir)[pathHash]; // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature

if (prior !== undefined && prior.contentHash === newHash) {
  return { ok: true, result: unchangedResult(prior.chunkSetId, read.raw) };
}

const result0 = filterRaw({ raw: read.raw, path: input.path, intent: input.intent,
  mode: settings.mode, maxReturnedBytes: settings.maxReturnedBytes });
// ...existing persist + appendEvent flow, using result0 in place of filtered.result...
// after chunkSetId is known and persisted:
if (settings.storeRawOutput) recordRead(sessionDir, pathHash, { contentHash: newHash, chunkSetId });
```

`unchangedResult` builds a `FilterOutputResult` with `excerpts: []`,
`decision` = the marker, the marker `summary`, `rawBytes` from
`Buffer.byteLength(raw, "utf8")`, `returnedBytes: 0`, `bytesSaved =
rawBytes`, `savingRatio: 1` (or per the existing ratio convention),
`unchanged: { priorChunkSetId }`. Use conditional-spread for any
optional field — `exactOptionalPropertyTypes` forbids assigning
`undefined`.

### C5. Recording after persist (Locked Decision 8 ordering)

Record into the index ONLY after a successful chunk-set persist, and only
when `settings.storeRawOutput` is true (the priorChunkSetId must point at
a chunk-set that actually exists on disk — otherwise the lossless
recovery promise breaks). If `storeRawOutput` is false, do not record (a
later read of the same file is a normal miss; there is nothing to expand
to). `recordRead` failures are best-effort: log nothing fatal, never fail
the read — a failed record just means the next read is a miss.

## Data Flow

```
proxy_read_file(path, intent, sessionId)
        |
        v
runOutputPipeline / runOverlayOutputPipeline
  resolve settings ----(fail)---> typed error (unchanged)
  runTwoGates -------- (deny/unsafe) --> typed error (unchanged)
        |
  readRaw(gate.absolute)  --(read err)--> file_read_failed
        |
  newHash = sha256(raw)
  pathHash = sha256(absolute)
  prior = loadReadIndex(sessionDir)[pathHash]   (missing/corrupt -> miss)
        |
   prior?.contentHash === newHash ?
        |                          \
       YES (HIT)                    NO (MISS)
        |                            |
  return FilterOutputResult     filterRaw(raw,...)
  { excerpts: [], decision:     persistChunkSet/persistOverlayChunkSet
    marker, summary: "...",     (as today) -> chunkSetId
    unchanged:{priorChunkSetId} appendEvent/appendOverlayEvent (as today)
  }                             recordRead(sessionDir, pathHash,
  (SKIP filter, SKIP persist)     { contentHash:newHash, chunkSetId })
                                return { ...result, chunkSetId }
```

**Read-once invariant:** the file is read exactly once per pipeline call
(`readRaw`). The hash is computed from that single read. On a miss,
`filterRaw` reuses the same `raw` string — no second `readFile`.

## Error Handling

Best-effort, never break a read. The suppression layer is an
optimization; any failure in it degrades gracefully to today's behavior.

- **Index missing** (`ENOENT`): `loadReadIndex` → `{}` → cache miss →
  normal filter + persist + record.
- **Index corrupt** (`JSON.parse` throws, or parsed value is not an
  object): `loadReadIndex` → `{}` → cache miss. NEVER throw. (A future
  `recordRead` overwrites the corrupt file atomically.)
- **Record write fails:** swallow; the next read is a miss. Do NOT turn a
  successful read into `store_write_failed` because the index write
  failed — the chunk-set already persisted; the index is advisory.
- **Hash:** `createHash("sha256")` over the already-read content; no IO,
  cannot fail in practice.
- **Path building:** use `node:path` `join` (already used by
  content-store paths). The `chunkSetId` segments are still validated by
  `assertSafeSegment` inside the persist path; the read-index filename is
  a constant (`read-index.json`), no user input in the segment.
- **Atomic write:** reuse `content-store` `atomicWriteFile` (tmp +
  fsync + rename + Windows-safe). Do not hand-roll.
- **prune interaction:** `pruneOlderThan` parses each session-dir
  `*.json` as a `ChunkSet`; `read-index.json` fails that parse and hits
  the existing `continue` — skipped, not crashed. No behavioral prune
  change in v1 (it already tolerates the file). C1a only routes its skip
  through the shared `READ_INDEX_FILENAME` constant. (Stale index entries
  pointing at a pruned chunk-set are harmless: the agent's
  `proxy_expand_chunk` on a missing id surfaces the existing not-found
  path; and on the next content change the entry is overwritten.)
- **listChunkSets interaction (HARD breakage if unhandled):**
  `listChunkSets` (store.ts L114-128) does NOT tolerate non-`ChunkSet`
  JSON — `parseExistingFile` THROWS `store_corrupt`. Because
  `listChunkSets` backs recall (daemon handlers-registry.ts L76; mcp-bridge
  recall.ts L47), the first `read-index.json` write would break the next
  recall. C1a fixes this by skipping `READ_INDEX_FILENAME` in
  `listChunkSets`. This is a required change, not best-effort — covered by
  tests T13/T14 below.

## Evidence-preserving Note (HIGH risk requirement)

The unchanged marker is **lossless**: it carries `priorChunkSetId`, which
points at a chunk-set that was persisted on a prior read in this same
session. The agent recovers the full prior content with
`proxy_expand_chunk(priorChunkSetId, ...)`. We never strip evidence the
model needs — we replace a redundant re-emission with a recoverable
pointer. This satisfies §12 HIGH "evidence-preserving only; no aggressive
compression" and the §13 anti-pattern "we preserve evidence; never strip
what the model needs to decide."

The record-after-persist ordering (C5) guarantees the pointed-at
chunk-set exists before any future read can be suppressed against it.

## Testing Strategy (TDD — tests first, red → green)

Package: `@megasaver/context-gate` (most), `@megasaver/output-filter`
(type/marker), `@megasaver/content-store` (export `atomicWriteFile` per
C1b + `listChunkSets`/`pruneOlderThan` skip the read-index per C1a).
Run per-package: `pnpm --filter @megasaver/<pkg> test`.

Unit (`read-index.test.ts`):
- **T1 hashContent:** identical bytes → identical hex; one-byte change →
  different hex.
- **T2 hashPath:** stable, hex, differs per path; raw path never appears
  in the index file on disk.
- **T3 load missing:** `loadReadIndex` on a non-existent dir → `{}`.
- **T4 load corrupt:** write garbage to `read-index.json` →
  `loadReadIndex` → `{}` (no throw).
- **T5 record + reload atomic:** `recordRead` then `loadReadIndex`
  round-trips the entry; assert tmp file gone, file content well-formed
  JSON.

Pipeline (`run.ts` tests, both variants):
- **T6 miss filters + persists + records:** first read → spy confirms
  `filterRaw`/`filterOutput` called, chunk-set persisted, index now has
  the entry; result has NO `unchanged` field.
- **T7 hit suppresses + skips filter/persist:** second read of unchanged
  file → `filterOutput` spy NOT called, persist spy NOT called, result
  has `excerpts: []` and `unchanged.priorChunkSetId === firstChunkSetId`,
  `summary` matches the marker text.
- **T8 changed-content → miss:** mutate file bytes between reads → filter
  + persist + record again; result has NO `unchanged` field; index entry
  updated to the new hash + new chunkSetId.
- **T9 both variants:** T6–T8 run for `runOutputPipeline` AND
  `runOverlayOutputPipeline` (per Locked Decision 6).
- **T10 exactOptionalPropertyTypes:** the changed-content result object
  does not carry an `unchanged` key at all (not `unchanged: undefined`) —
  assert via `"unchanged" in result === false`.
- **T11 daemon/bridge passthrough (assumption check):** a result with
  `unchanged` set survives `{ ...result.result }` JSON round-trip and the
  mcp-bridge return path with the field intact (guards Locked Decision 2 /
  C2 "zero daemon change" claim).
- **T12 storeRawOutput=false → no record:** a read with
  `storeRawOutput` false does not write the index; a subsequent read is a
  normal miss (no suppression against a non-existent chunk-set).

Content-store regression (`@megasaver/content-store`, `store.test.ts`):
- **T13 listChunkSets ignores read-index (C1a):** write a valid
  `ChunkSet` plus a `read-index.json` into the same session dir; assert
  `listChunkSets` returns the one chunk-set and does NOT throw
  `store_corrupt`. RED before C1a (it throws today), GREEN after. This is
  the regression guard for the recall-breakage in Gap 1.
- **T14 listChunkSets still surfaces genuine corruption:** write a
  `*.json` that is neither a `ChunkSet` nor the reserved read-index name;
  assert `listChunkSets` still throws `store_corrupt` (skip-by-filename
  must not become swallow-all). pairs with T13 to pin the chosen fix.

Verification evidence (DoD step 5): a captured `proxy_read_file` smoke —
read a file twice, show the second response carrying `unchanged` +
`excerpts: []`, then `proxy_expand_chunk(priorChunkSetId)` recovering the
full content (lossless proof).

## Risk

**HIGH** (§12 — touches the read pipeline AND the session storage
format). Mandatory: full superpowers chain + `omc:architect` for design +
`omc:critic` adversarial review + worktree (already on
`feat/diff-on-reread`, not `main`). Reviewers: `code-reviewer` AND
`critic` (separate passes). Evidence-preserving only — satisfied by the
lossless `priorChunkSetId` marker.

## Definition-of-Done Deltas

Standard DoD (§9) applies. Feature-specific:
- **Changeset required** (§9.9), covering THREE packages:
  - `@megasaver/output-filter` — public API change (new optional
    `FilterOutputResult.unchanged` field + `FilterDecision` marker value).
  - `@megasaver/context-gate` — public API change (new exports `readRaw`,
    `filterRaw`, read-index functions).
  - `@megasaver/content-store` — public API change: export
    `atomicWriteFile` (C1b) and the read-index-tolerant `listChunkSets` /
    shared `READ_INDEX_FILENAME` (C1a). This was omitted in the original
    DoD and is REQUIRED — both C1a and C1b touch content-store's public
    surface and read-side behavior.

  Add `.changeset/<descriptor>.md`. No bump for `@megasaver/daemon` /
  `@megasaver/mcp-bridge` (no code change; passthrough only — confirm via
  T11 before claiming this; recall keeps working because C1a stops
  `listChunkSets` from throwing on the new sibling file).
- No `CLAUDE.md` / `AGENTS.md` / `.cursor/rules` change (no convention
  change).
- Both reviewer passes (HIGH) before merge.
