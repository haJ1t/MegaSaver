---
feature: diff-on-reread
date: 2026-06-25
risk: HIGH
spec: docs/superpowers/specs/2026-06-25-diff-on-reread-design.md
branch: feat/diff-on-reread
status: ready-to-execute
---

# diff-on-reread (unchanged-suppression) — Implementation Plan

TDD plan derived from the approved design spec. v1 = **suppression only**
(no diff hunks). When a file is re-read unchanged in the same session,
return a tiny `unchanged: { priorChunkSetId }` marker with `excerpts: []`
and skip `filterOutput` + chunk-set persist. Lossless: the agent recovers
the full prior content via `proxy_expand_chunk(priorChunkSetId)`.

## Ground-truth seam facts (verified against current code)

- `packages/output-filter/src/types.ts:75` — `FilterOutputResult` (object,
  not a discriminated union). `packages/output-filter/src/tokens.ts:8` —
  `export type FilterDecision = "passthrough" | "light" | "compressed";`.
  Both re-exported from `packages/output-filter/src/index.ts`.
- `packages/context-gate/src/read.ts:146` — `readAndFilter` (readFile utf8
  → `filterOutput`). Re-exported from `index.ts:23`. **External caller:**
  `packages/core/src/context-gate.ts:16` → keep the wrapper.
- `packages/context-gate/src/run.ts` — `runOutputPipeline` (registry,
  L47) and `runOverlayOutputPipeline` (overlay, L150). Each calls
  `readAndFilter`, then persists keyed by `(projectId, sessionId)` /
  `(workspaceKey, liveSessionId)`, then appends an event.
- `packages/content-store/src/atomic-write.ts:20` — `atomicWriteFile`
  (tmp + fsync + rename + Windows-safe). **Not** on the public surface
  (`packages/content-store/src/index.ts` exports only store/chunk-set/
  errors). C1b adds the export.
- `packages/content-store/src/store.ts:115-127` — `listChunkSets` loops
  every `*.json` and calls `parseExistingFile` which **throws**
  `store_corrupt` on non-`ChunkSet` JSON. `read-index.json` is exactly
  such a file → recall breaks after the first suppressed-read write. C1a
  fixes via a `READ_INDEX_FILENAME` skip. `pruneOlderThan` (L239-247)
  already tolerates it via its `catch { continue }`; C1a routes its skip
  through the same constant.
- Session dir on disk (both pipelines):
  `<storeRoot>/content/<projectId|workspaceKey>/<sessionId|liveSessionId>/`.
  Matches `chunkSetPath` / `overlayChunkSetPath` in `paths.ts`.
- Daemon `readRegistryHandler` (`handlers-registry.ts:169`) returns
  `{ status: 200, json: { ...result.result } }`; its request schema is
  `.strict()` on the **input** only. mcp-bridge `handleReadFile`
  (`read-file.ts:25`) `.strict()`-validates **args** only and returns the
  `FilterOutputResult` verbatim. So the new optional field passes through
  with zero daemon/bridge code change — confirmed by T11.

## TS / repo conventions (apply to every task)

- strict + `exactOptionalPropertyTypes`: never assign `undefined` to an
  optional prop; use conditional spread `...(x !== undefined ? { k: x } : {})`.
- `noPropertyAccessFromIndexSignature`: bracket-access `Record` index sigs
  and add `// biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature`
  on the line (the codebase does this for `Record` lookups).
- ESM `.js` import specifiers, NodeNext.
- Per-package test: `pnpm --filter @megasaver/<pkg> test`.
- **Git: stage explicit paths only. NEVER `git add -A` / `git add .`** —
  the working tree has ~14 pre-existing untracked cruft files. Commit on
  `feat/diff-on-reread`; do not switch branches.

## Task order (each: failing test → minimal impl → commit)

C1b → C1a are first (content-store) because C1's `read-index` import of
`atomicWriteFile` does not compile until C1b, and the first read-index
write breaks `listChunkSets` until C1a. Then C2 (type marker), C3 (read
split), C1 (read-index module), C4/C5 registry wiring, C4/C5 overlay
wiring, T11 daemon passthrough, changeset.

---

## Task 1 — C1b: export `atomicWriteFile` from content-store

**Why first:** the read-index module (Task 6) imports it; the import does
not compile until it is on the public surface.

**Test** (`packages/content-store/test/atomic-write-export.test.ts`):
imports `atomicWriteFile` from the package public entry and round-trips a
write.

**Impl** — add to `packages/content-store/src/index.ts`:
```ts
export { atomicWriteFile } from "./atomic-write.js";
```

**Verify:** `pnpm --filter @megasaver/content-store test`.

---

## Task 2 — C1a: `listChunkSets` skips the reserved `read-index.json`

**Why second:** the first read-index write (Task 7) lands in the session
dir; the very next recall calls `listChunkSets`, which throws today. This
is the recall-breakage guard (T13/T14).

**Test** (`packages/content-store/test/read-index-skip.test.ts`): T13 —
a valid ChunkSet + a `read-index.json` in the same session dir →
`listChunkSets` returns the one chunk-set, does NOT throw. T14 — a
non-ChunkSet `*.json` that is NOT the reserved name → `listChunkSets`
still throws `store_corrupt` (skip-by-filename must not become
swallow-all).

**Impl** — `packages/content-store/src/store.ts`:
- Add the shared constant near the top:
  `export const READ_INDEX_FILENAME = "read-index.json";`
- In `listChunkSets`, inside the loop after the `.json` guard:
  `if (name === READ_INDEX_FILENAME) continue;`
- In `pruneOlderThan`, route its skip through the same constant
  (`if (name === READ_INDEX_FILENAME) continue;`) — single source of
  truth; behavior unchanged (it already skipped via `catch`).
- Re-export `READ_INDEX_FILENAME` from `index.ts`.

**Verify:** `pnpm --filter @megasaver/content-store test`.

---

## Task 3 — C2: `FilterOutputResult.unchanged` marker + `FilterDecision` value

**Test** (`packages/output-filter/test/unchanged-marker.test-d.ts` for
the type + a runtime helper test if a helper lives here — see decision
below). Type test asserts (a) `unchanged?` is optional, (b)
`"unchanged-marker"` is assignable to `FilterDecision`.

**Impl:**
- `packages/output-filter/src/tokens.ts:8`:
  `export type FilterDecision = "passthrough" | "light" | "compressed" | "unchanged-marker";`
- `packages/output-filter/src/types.ts` — add ONE field to
  `FilterOutputResult` (after `warnings?`):
  `unchanged?: { priorChunkSetId: string };`
- **Helper location decision (ponytail):** `unchangedResult` is built in
  the pipeline (`run.ts`) from data only the pipeline has (`raw`,
  `priorChunkSetId`). It is NOT exported from output-filter — keeping it
  in `run.ts` avoids a new module and a new public surface. output-filter
  only owns the *type* change. (The runtime shape is tested via the
  pipeline tests T7/T9.)

**Verify:** `pnpm --filter @megasaver/output-filter test`.

---

## Task 4 — C3: split `readRaw` / `filterRaw`, keep `readAndFilter` wrapper

**Test** (`packages/context-gate/test/read-split.test.ts`): `readRaw` on
a real temp file returns `{ ok: true, raw }`; on a missing path returns
`{ ok: false, message }`. `filterRaw` on raw text returns a
`FilterOutputResult` with `excerpts` and `summary`. `readAndFilter`
(wrapper) still returns `{ ok: true, raw, result }` (regression).

**Impl** — `packages/context-gate/src/read.ts` (replace L146-169):
```ts
export async function readRaw(
  absolute: string,
): Promise<{ ok: true; raw: string } | { ok: false; message: string }> {
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

export async function readAndFilter(input: {
  absolute: string;
  path: string;
  intent: string;
  mode: TokenSaverMode;
  maxReturnedBytes: number | undefined;
}): Promise<
  { ok: true; raw: string; result: FilterOutputResult } | { ok: false; message: string }
> {
  const r = await readRaw(input.absolute);
  if (!r.ok) return r;
  return {
    ok: true,
    raw: r.raw,
    result: filterRaw({
      raw: r.raw,
      path: input.path,
      intent: input.intent,
      mode: input.mode,
      maxReturnedBytes: input.maxReturnedBytes,
    }),
  };
}
```
Export `readRaw` and `filterRaw` from
`packages/context-gate/src/index.ts` (add to the existing `./read.js`
export block).

**Verify:** `pnpm --filter @megasaver/context-gate test`.

---

## Task 5 — C1: read-index module (hash, load, record)

**Why now:** Tasks 1+2 unblock it (compiles + recall-safe). Pure
functions over the on-disk index; no class.

**Test** (`packages/context-gate/test/read-index.test.ts`): T1
`hashContent` identical→equal, one byte→differs. T2 `hashPath` stable hex,
differs per path, raw path absent from index file on disk. T3
`loadReadIndex` on missing dir → `{}`. T4 corrupt `read-index.json` →
`{}` (no throw). T5 `recordRead` then `loadReadIndex` round-trips; tmp
file gone; file is well-formed JSON.

**Impl** — new file `packages/context-gate/src/read-index.ts`:
```ts
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFile } from "@megasaver/content-store";

export type ReadIndexEntry = { contentHash: string; chunkSetId: string };
type ReadIndex = Record<string, ReadIndexEntry>;

export function hashContent(raw: string | Buffer): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function hashPath(absolutePath: string): string {
  return createHash("sha256").update(absolutePath).digest("hex");
}

export function readIndexPath(sessionDir: string): string {
  return join(sessionDir, "read-index.json");
}

export function loadReadIndex(sessionDir: string): ReadIndex {
  let raw: string;
  try {
    raw = readFileSync(readIndexPath(sessionDir), "utf8");
  } catch {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as ReadIndex;
  } catch {
    return {};
  }
}

export function recordRead(sessionDir: string, pathHash: string, entry: ReadIndexEntry): void {
  const index = loadReadIndex(sessionDir);
  index[pathHash] = entry; // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  try {
    atomicWriteFile(readIndexPath(sessionDir), `${JSON.stringify(index, null, 2)}\n`);
  } catch {
    // best-effort: a failed record just means the next read is a miss.
  }
}
```
Export `hashContent`, `hashPath`, `readIndexPath`, `loadReadIndex`,
`recordRead`, and `type ReadIndexEntry` from
`packages/context-gate/src/index.ts`.

**Verify:** `pnpm --filter @megasaver/context-gate test`.

---

## Task 6 — C4/C5: short-circuit `runOutputPipeline` (registry)

**Test** (extend `packages/context-gate/test/run.test.ts`): T6 first read
→ result has NO `unchanged` key (`"unchanged" in outcome.result === false`),
chunk-set persisted, index now has the entry. T7 second read of unchanged
file → `excerpts: []`, `unchanged.priorChunkSetId === firstChunkSetId`,
`summary` matches marker text, and **no second chunk-set** written (assert
the content session dir still holds exactly one `*.json` besides
`read-index.json`). T8 mutate file bytes between reads → miss again, no
`unchanged` key, index updated. T10 `exactOptionalPropertyTypes`:
changed-content result has no `unchanged` key at all. T12
`storeRawOutput=false` → no index file written; next read is a normal
miss.

**Impl** — `packages/context-gate/src/run.ts`:
- Imports: add `hashContent, hashPath, loadReadIndex, recordRead` from
  `./read-index.js`; add `readRaw, filterRaw` from `./read.js`; add
  `join` from `node:path`.
- Add a private `unchangedResult` helper (top of file):
```ts
function unchangedResult(priorChunkSetId: string, raw: string): FilterOutputResult {
  const rawBytes = Buffer.byteLength(raw, "utf8");
  return {
    summary:
      "File unchanged since last read this session — expand priorChunkSetId to view.",
    excerpts: [],
    classification: { category: "unknown", confidence: 1 },
    decision: "unchanged-marker",
    compressor: "none",
    rawBytes,
    returnedBytes: 0,
    rawTokens: 0,
    returnedTokens: 0,
    bytesSaved: rawBytes,
    savingRatio: 1,
    unchanged: { priorChunkSetId },
  };
}
```
  (Confirm `Classification` shape + `CompressorName` "none" literal
  during impl; match the real union values from output-filter — adjust
  the `classification`/`compressor` literals to whatever the types
  require. The load-bearing fields are `summary`, `excerpts: []`,
  `decision: "unchanged-marker"`, `unchanged`.)
- In `runOutputPipeline`, replace the `readAndFilter` block (L70-77) with:
```ts
  const now = input.now ?? defaultNow;
  const newId = input.newId ?? defaultNewId;
  const sessionDir = join(input.storeRoot, "content", settings.projectId, input.sessionId);

  const read = await readRaw(gate.absolute);
  if (!read.ok) return { ok: false, reason: "file_read_failed", detail: read.message };

  const newHash = hashContent(read.raw);
  const pathHash = hashPath(gate.absolute);
  const prior = loadReadIndex(sessionDir)[pathHash]; // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  if (prior !== undefined && prior.contentHash === newHash) {
    return { ok: true, result: unchangedResult(prior.chunkSetId, read.raw) };
  }

  const filteredResult = filterRaw({
    raw: read.raw,
    path: input.path,
    intent: input.intent,
    mode: settings.mode,
    maxReturnedBytes: settings.maxReturnedBytes,
  });
```
- Replace every later use of `filtered.result` with `filteredResult`, and
  `result` (the spread copy) with `const result = { ...filteredResult };`.
- After the chunk-set persist succeeds (inside the `if
  (settings.storeRawOutput)` block, after `result.chunkSetId =
  chunkSetId;`), record:
```ts
    recordRead(sessionDir, pathHash, { contentHash: newHash, chunkSetId });
```
  (Record ONLY when `storeRawOutput` is true and persist succeeded — the
  priorChunkSetId must point at a chunk-set that exists. C5 ordering.)

**Verify:** `pnpm --filter @megasaver/context-gate test`.

---

## Task 7 — C4/C5: short-circuit `runOverlayOutputPipeline` (overlay)

**Test** (extend `packages/context-gate/test/run-overlay.test.ts`):
T6/T7/T8/T10/T12 mirrored for the overlay pipeline, session dir
`content/<WK>/<LSID>`.

**Impl** — `packages/context-gate/src/run.ts`, `runOverlayOutputPipeline`,
identical pattern with the overlay session dir:
```ts
  const sessionDir = join(input.storeRoot, "content", input.workspaceKey, input.liveSessionId);
```
Replace its `readAndFilter` block (L172-179) with the same read → hash →
loadReadIndex → branch → `filterRaw` flow, reuse the shared
`unchangedResult`, and add `recordRead(sessionDir, pathHash, {
contentHash: newHash, chunkSetId })` after the overlay persist succeeds.

**Verify:** `pnpm --filter @megasaver/context-gate test`.

---

## Task 8 — T11: daemon passthrough proof (zero daemon code change)

**Test** (extend `packages/daemon/test/handlers-registry.test.ts`,
`readRegistryHandler` describe): seed a registry + project, write a file
inside `projectRoot`, call `readRegistryHandler` twice with the same
`{ sessionId, path, intent }`. Assert the first `res.json` has no
`unchanged` key; the second `res.json.unchanged.priorChunkSetId` is the
first response's `chunkSetId`, `res.json.excerpts` is `[]`, and
`res.json.summary` matches the marker text. This proves the optional
field survives `{ ...result.result }` with no daemon change.

**Impl:** none (assertion-only; guards Locked Decision 2 / "zero daemon
change"). If RED reveals stripping, STOP and surface — do not silently
edit the daemon.

**Verify:** `pnpm --filter @megasaver/daemon test`.

---

## Task 9 — changeset + full verify

**Impl** — `.changeset/diff-on-reread.md`:
```md
---
"@megasaver/output-filter": minor
"@megasaver/context-gate": minor
"@megasaver/content-store": minor
---

diff-on-reread (suppression-only): re-reading an unchanged file in the
same session returns an `unchanged: { priorChunkSetId }` marker with
empty excerpts and skips re-filtering + re-persisting. Lossless — the
prior chunk-set is recoverable via expand. Adds `FilterOutputResult.
unchanged` + `unchanged-marker` decision (output-filter); `readRaw` /
`filterRaw` / read-index exports (context-gate); exports
`atomicWriteFile` + read-index-tolerant `listChunkSets` /
`READ_INDEX_FILENAME` (content-store).
```

**Verify:** `pnpm verify` (lint + typecheck + test) green across touched
packages. Smoke evidence (DoD step 5): `proxy_read_file` the same file
twice, show the second response carrying `unchanged` + `excerpts: []`,
then `proxy_expand_chunk(priorChunkSetId)` recovering full content.

---

## Reviewers (HIGH risk)

`code-reviewer` AND `critic` separate passes before merge. Author ≠
reviewer context.
