---
feature: already-in-context-dedup
date: 2026-06-26
risk: HIGH
status: ready-to-execute
spec: docs/superpowers/specs/2026-06-26-already-in-context-dedup-design.md
branch: feat/already-in-context-dedup
---

# Already-in-Context Dedup — TDD Plan

Per-session, cross-source, per-excerpt dedup. When MegaSaver is about to
return an excerpt whose exact text (sha256 of `excerpt.text`) was already
returned to the model earlier in the same session, suppress that excerpt
from the returned set and reference the prior chunk-set so the model is
not billed twice. Generalizes the shipped whole-file diff-on-reread to
per-excerpt, cross-source granularity. Diff-on-reread (`read-index.json`)
is left untouched; this is a NEW sibling index `shown-index.json`.

## Ground-truth seam facts (verified against branch code, post-PR-185)

- `packages/output-filter/src/types.ts`
  - `OutputExcerpt = { text; startLine; endLine; score; features; engine? }` (L66-73).
  - `FilterOutputResult.excerpts` is `readonly OutputExcerpt[]` (L77).
  - Add `deduped?: { suppressed: number; priorChunkSetIds: string[] }`
    after `unchanged?` (L90).
- `packages/content-store/src/store.ts`
  - `READ_INDEX_FILENAME = "read-index.json"` (L20), exported from
    `index.ts` (L12). `atomicWriteFile` exported from `index.ts` (L29).
  - `listChunkSets` iterates `*.json`, skips `READ_INDEX_FILENAME` at
    L119, then `parseExistingFile` (L121) THROWS
    `ContentStoreError("store_corrupt")` on any non-chunk-set JSON
    (L60-75).
  - `pruneOlderThan` skips `READ_INDEX_FILENAME` at L244 then `continue`s
    on parse failure (L249-250) — it already tolerates non-chunk-set
    JSON; the skip line is added for symmetry/clarity.
- `packages/context-gate/src/read-index.ts`
  - Exports `hashContent(raw)->sha256hex`, `hashPath`, `readIndexPath`,
    `loadReadIndex`, `recordRead`. Pattern to MIRROR (not mutate).
- `packages/context-gate/src/run.ts`
  - `runOutputPipeline` (registry): `sessionDir = join(storeRoot,
    "content", settings.projectId, sessionId)` (L95). `const result =
    { ...filteredResult }` (L115); persists via `persistChunkSet`; sets
    `result.chunkSetId = chunkSetId` (L131); `recordRead` (L132). Stats
    event appended L135-158; `return { ok: true, result }` L163.
  - `runOverlayOutputPipeline` (overlay): `sessionDir = join(storeRoot,
    "content", workspaceKey, liveSessionId)` (L208); `const result`
    (L228); `result.chunkSetId` (L244); `recordRead` (L245); return L276.
  - Diff-on-reread short-circuit fires BEFORE filter/persist (L103,
    L216) — `unchangedResult` returns early, so the dedup step is never
    reached on an unchanged whole-file re-read. The two mechanisms
    compose and never both fire on one call.
- `packages/context-gate/src/run-command.ts`
  - TWO exec functions:
    `runOutputExecCommand` (registry, L184-316) and
    `runOverlayOutputExecCommand` (overlay, L340-461).
  - Each: `filterOutput(...)` (L228 / L376) → builds `const result:
    ExecResult = { ...filtered, ... }` (L256 / L401) → on
    `storeRawOutput` builds a ChunkSet, `saveChunkSet`/`saveOverlayChunkSet`
    (L282 / L427), sets `result.chunkSetId = chunkSetId` (L286 / L431) →
    appends event (L289-313 / L434-458) → `return { ok: true, result }`
    (L315 / L460).
  - `ExecResult = FilterOutputResult & { childExitCode; terminated? }`
    (L66-69) → `result.excerpts` is ALSO `readonly`.
  - This file does NOT import `join` from `node:path` nor read/shown
    index — both imports must be added.

## Two facts that diverge from the spec snippets (handle exactly)

1. **`result` is `const`, not `let`.** The spec's reconstruct snippet
   writes `result = dd.suppressed > 0 ? {...} : {...}`. In all FOUR call
   sites `result` is declared `const`. Two equally-valid options; this
   plan uses **option A everywhere** for uniformity:
   - **A (chosen):** change `const result` → `let result` at each site
     and reassign with the spread reconstruct (matches the spec snippet
     verbatim). One-token diff per site.
   - B: keep `const result`, build a `const next = {...result, excerpts:
     ...}` and `return { ok: true, result: next }`. (Not used — would
     also require touching the event block which reads `result.chunkSetId`.)
   Because the event block reads `result.chunkSetId` AFTER the dedup
   step in the exec paths, and `result.chunkSetId` is set BEFORE dedup,
   the reassigned object must carry `chunkSetId` forward — the spread
   `{ ...result, ... }` does this automatically.

2. **Readonly `excerpts` → TS2540 on in-place assign.** Never do
   `result.excerpts = dd.excerpts`. Always reconstruct via spread so the
   property is freshly typed mutable. `dedupShownExcerpts` accepts
   `readonly OutputExcerpt[]` and returns a fresh `OutputExcerpt[]`.

## Ordering invariant (evidence-preserving, §1)

Dedup MUST run AFTER the chunk-set is persisted and `result.chunkSetId`
is set, and the index write (`recordShown`) MUST run AFTER persist too.
This guarantees any `chunkSetId` recorded into `shown-index` already
points at a persisted, expandable chunk-set. Suppression only fires when
the matched index row has a present, non-empty `chunkSetId`. When
`storeRawOutput` is false there is no chunk-set → the whole dedup step is
skipped (no reference could resolve).

The persisted chunk-set keeps ALL first-occurrence excerpts (built from
the pre-dedup `filtered.excerpts`); only the in-memory returned
`excerpts` is trimmed. Expand stays lossless. The stats event continues
to report pre-dedup `filtered.*` byte/token figures and
`chunksStored: filtered.excerpts.length` — unchanged.

## Test-design constraint (read path vs diff-on-reread)

A second read of the SAME path with unchanged content short-circuits via
diff-on-reread BEFORE the dedup step. To exercise per-excerpt dedup
through the read path, integration tests read TWO DIFFERENT files (two
distinct `pathHash` values → diff-on-reread misses both) whose content is
byte-identical (so the produced excerpt text — and thus its sha256 — is
identical). For cross-source coverage, an exec (grep) records an excerpt,
then a read of the same text in the SAME session suppresses it. Tiny
files/outputs land in the `passthrough` band → exactly one excerpt whose
`.text` is the normalized whole content, so the hash is predictable.

---

## Task sequence (each: failing test → minimal impl → commit)

Dependencies: T1 (content-store constant) → T2 (shown-index module,
imports the constant) → T3 (`deduped` field + pure `dedupShownExcerpts`)
→ T4 (registry read wire) → T5 (overlay read wire) → T6 (registry exec
wire) → T7 (overlay exec wire) → T8 (changeset). T4-T7 each depend on
T2+T3; they are listed sequentially but T5/T6/T7 only repeat the T4
pattern at a different call site.

---

### T1 — content-store: `SHOWN_INDEX_FILENAME` constant + skip lines

**Why first:** `shown-index.json` lands in the same session dir as
chunk-sets; without the skip, `listChunkSets` throws `store_corrupt` and
breaks `mega_recall`. The constant is owned by content-store (single
definition) and imported by context-gate so the writer and the skip list
can never drift.

**Files:** `packages/content-store/src/store.ts`,
`packages/content-store/src/index.ts`,
`packages/content-store/test/shown-index-skip.test.ts` (new).

**Failing test (`shown-index-skip.test.ts`):**

```ts
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectIdSchema, sessionIdSchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChunkSet } from "../src/chunk-set.js";
import { SHOWN_INDEX_FILENAME } from "../src/index.js";
import { listChunkSets, pruneOlderThan, saveChunkSet } from "../src/store.js";

let storeRoot: string;
const projectId = projectIdSchema.parse(randomUUID());
const sessionId = sessionIdSchema.parse(randomUUID());

function makeChunkSet(): ChunkSet {
  return {
    chunkSetId: "cs-1",
    sessionId,
    projectId,
    createdAt: "2026-05-10T12:00:00.000Z",
    source: { kind: "file", path: "/tmp/x.txt" },
    rawBytes: 64,
    redacted: false,
    chunks: [{ id: "c1", startLine: 1, endLine: 2, bytes: 16, text: "hello" }],
  } as ChunkSet;
}

function sessionDir(): string {
  return join(storeRoot, "content", projectId, sessionId);
}

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "cs-shown-index-skip-"));
});
afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

describe("SHOWN_INDEX_FILENAME constant", () => {
  it("is the expected reserved filename", () => {
    expect(SHOWN_INDEX_FILENAME).toBe("shown-index.json");
  });
});

describe("listChunkSets tolerates shown-index.json", () => {
  it("returns the chunk-set and does NOT throw on a sibling shown-index.json", async () => {
    await saveChunkSet({ storeRoot, chunkSet: makeChunkSet() });
    mkdirSync(sessionDir(), { recursive: true });
    writeFileSync(
      join(sessionDir(), SHOWN_INDEX_FILENAME),
      '{"abc123":{"chunkSetId":"cs-1"}}\n',
    );

    const summaries = await listChunkSets({ storeRoot, projectId, sessionId });
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.chunkSetId).toBe("cs-1");
  });
});

describe("pruneOlderThan tolerates shown-index.json", () => {
  it("does not delete shown-index.json and does not throw", async () => {
    await saveChunkSet({ storeRoot, chunkSet: makeChunkSet() });
    mkdirSync(sessionDir(), { recursive: true });
    const shownPath = join(sessionDir(), SHOWN_INDEX_FILENAME);
    writeFileSync(shownPath, '{"abc123":{"chunkSetId":"cs-1"}}\n');

    // olderThan in the past → the cs-1 chunk-set (2026-05-10) is removed,
    // but the sibling shown-index file must survive untouched.
    const res = await pruneOlderThan({ storeRoot, olderThan: new Date("2026-06-01T00:00:00.000Z") });
    expect(res.removed).toBe(1);
    expect(existsSync(shownPath)).toBe(true);
  });
});
```

**Minimal impl:**

`store.ts` — add the constant beside `READ_INDEX_FILENAME` (after L20):

```ts
export const READ_INDEX_FILENAME = "read-index.json";
export const SHOWN_INDEX_FILENAME = "shown-index.json";
```

`store.ts` — `listChunkSets` loop, after the read-index skip (after L119):

```ts
    if (name === READ_INDEX_FILENAME) continue; // sibling index, not a chunk-set
    if (name === SHOWN_INDEX_FILENAME) continue; // sibling index, not a chunk-set
```

`store.ts` — `pruneOlderThan` loop, after the read-index skip (after L244):

```ts
        if (name === READ_INDEX_FILENAME) continue; // sibling index, not a chunk-set
        if (name === SHOWN_INDEX_FILENAME) continue; // sibling index, not a chunk-set
```

`index.ts` — add to the existing export block that names
`READ_INDEX_FILENAME` (around L12):

```ts
  READ_INDEX_FILENAME,
  SHOWN_INDEX_FILENAME,
```

**Run:** `pnpm --filter @megasaver/content-store test`
**Commit:** `feat(content-store): reserve shown-index.json in enumeration`

---

### T2 — context-gate: `shown-index.ts` module

**Depends on:** T1 (imports `SHOWN_INDEX_FILENAME` + `atomicWriteFile`
from `@megasaver/content-store`, `hashContent` from `./read-index.js`).

**Files:** `packages/context-gate/src/shown-index.ts` (new),
`packages/context-gate/test/shown-index.test.ts` (new).

Mirrors `read-index.ts` exactly: best-effort, atomic, never-throw; load
returns `{}` on missing/corrupt; bracket-index the Record with the
biome-ignore for `noPropertyAccessFromIndexSignature`. `recordShown` is
first-writer-wins (never overwrite an existing first-occurrence
`chunkSetId`). The known `ponytail:` ceiling (last-writer-wins under
parallel same-session calls, fail-open) is documented in a comment.

**Failing test (`shown-index.test.ts`):**

```ts
import { mkdtemp, readFile, readdir, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashContent } from "../src/read-index.js";
import { loadShownIndex, recordShown, shownIndexPath } from "../src/shown-index.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "cg-shown-index-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("loadShownIndex", () => {
  it("missing dir -> {}", () => {
    expect(loadShownIndex(join(dir, "does-not-exist"))).toEqual({});
  });
  it("corrupt json -> {} (no throw)", async () => {
    await writeFile(shownIndexPath(dir), "not json{{{");
    expect(loadShownIndex(dir)).toEqual({});
  });
  it("non-object json (array) -> {} (no throw)", async () => {
    await writeFile(shownIndexPath(dir), "[1,2,3]");
    expect(loadShownIndex(dir)).toEqual({});
  });
});

describe("recordShown + reload", () => {
  it("round-trips entries, leaves no tmp file, writes well-formed JSON", async () => {
    const h = hashContent("hello world");
    recordShown(dir, [{ textHash: h, chunkSetId: "cs-1" }]);
    const index = loadShownIndex(dir);
    expect(index[h]).toEqual({ chunkSetId: "cs-1" });

    const names = await readdir(dir);
    expect(names.filter((n) => n.endsWith(".tmp"))).toHaveLength(0);
    const onDisk = await readFile(shownIndexPath(dir), "utf8");
    expect(() => JSON.parse(onDisk)).not.toThrow();
  });

  it("records multiple entries in one call", () => {
    const h1 = hashContent("a");
    const h2 = hashContent("b");
    recordShown(dir, [{ textHash: h1, chunkSetId: "cs-1" }, { textHash: h2, chunkSetId: "cs-2" }]);
    const index = loadShownIndex(dir);
    expect(index[h1]).toEqual({ chunkSetId: "cs-1" });
    expect(index[h2]).toEqual({ chunkSetId: "cs-2" });
  });

  it("is first-writer-wins: re-recording an existing textHash keeps the original chunkSetId", () => {
    const h = hashContent("dup");
    recordShown(dir, [{ textHash: h, chunkSetId: "cs-first" }]);
    recordShown(dir, [{ textHash: h, chunkSetId: "cs-second" }]);
    expect(loadShownIndex(dir)[h]).toEqual({ chunkSetId: "cs-first" });
  });

  it("swallows a write error (unwritable session dir) and does not throw", async () => {
    // Make the dir read-only so atomicWriteFile's write fails.
    await chmod(dir, 0o500);
    expect(() => recordShown(dir, [{ textHash: hashContent("x"), chunkSetId: "cs-1" }])).not.toThrow();
    await chmod(dir, 0o700);
  });

  it("empty entries is a no-op", () => {
    expect(() => recordShown(dir, [])).not.toThrow();
  });
});
```

**Minimal impl (`shown-index.ts`):**

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SHOWN_INDEX_FILENAME, atomicWriteFile } from "@megasaver/content-store";

export type ShownIndexEntry = { chunkSetId: string };
type ShownIndex = Record<string, ShownIndexEntry>;

export function shownIndexPath(sessionDir: string): string {
  return join(sessionDir, SHOWN_INDEX_FILENAME);
}

export function loadShownIndex(sessionDir: string): ShownIndex {
  let raw: string;
  try {
    raw = readFileSync(shownIndexPath(sessionDir), "utf8");
  } catch {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as ShownIndex;
  } catch {
    return {};
  }
}

// ponytail: load-modify-write with no cross-process lock. atomicWriteFile is
// per-write atomic but gives no read-modify-write isolation, so concurrent
// same-session pipeline calls can interleave and last-writer-wins drops a row.
// FAIL-OPEN: a dropped row only costs a later dedup miss, never a false
// suppression or evidence loss. Upgrade to merge-on-reload if parallel-call
// overlap proves to cost real savings.
export function recordShown(
  sessionDir: string,
  entries: ReadonlyArray<{ textHash: string; chunkSetId: string }>,
): void {
  if (entries.length === 0) return;
  const index = loadShownIndex(sessionDir);
  for (const { textHash, chunkSetId } of entries) {
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    if (index[textHash] === undefined) index[textHash] = { chunkSetId };
  }
  try {
    atomicWriteFile(shownIndexPath(sessionDir), `${JSON.stringify(index, null, 2)}\n`);
  } catch {
    // best-effort: a failed record just means the next occurrence is a miss.
  }
}
```

**Run:** `pnpm --filter @megasaver/context-gate test shown-index`
**Commit:** `feat(context-gate): add per-session shown-index module`

---

### T3 — output-filter `deduped` field + pure `dedupShownExcerpts`

**Depends on:** T2 (the helper imports `hashContent`, `loadShownIndex`).
**Files:** `packages/output-filter/src/types.ts` (add field),
`packages/context-gate/src/shown-index.ts` (add `dedupShownExcerpts`),
`packages/context-gate/test/dedup-shown-excerpts.test.ts` (new).

The helper lives in `shown-index.ts` (same module, fs-reading load is
already there) but its core is pure: it loads the index once, then
decides per excerpt. To keep it unit-testable without fs it takes the
loaded index map via `loadShownIndex(sessionDir)` internally — tests
seed the index by calling `recordShown` first (real fs, temp dir),
matching the existing read-index test style. (No separate pure/impure
split is warranted — YAGNI.)

**`types.ts` change** — add after `unchanged?` (L90):

```ts
  unchanged?: { priorChunkSetId: string };
  deduped?: { suppressed: number; priorChunkSetIds: string[] };
};
```

**Failing test (`dedup-shown-excerpts.test.ts`):**

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OutputExcerpt } from "@megasaver/output-filter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashContent } from "../src/read-index.js";
import { dedupShownExcerpts } from "../src/shown-index.js";
import { recordShown } from "../src/shown-index.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "cg-dedup-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function excerpt(text: string): OutputExcerpt {
  return { text, startLine: 1, endLine: 1, score: 1, features: {} as OutputExcerpt["features"] };
}

describe("dedupShownExcerpts", () => {
  it("empty index: keeps all excerpts, suppressed 0, queues all to record", () => {
    const ex = [excerpt("alpha"), excerpt("beta")];
    const dd = dedupShownExcerpts({ sessionDir: dir, currentChunkSetId: "cs-now", excerpts: ex });
    expect(dd.excerpts.map((e) => e.text)).toEqual(["alpha", "beta"]);
    expect(dd.suppressed).toBe(0);
    expect(dd.priorChunkSetIds).toEqual([]);
    expect(dd.recordEntries).toEqual([
      { textHash: hashContent("alpha"), chunkSetId: "cs-now" },
      { textHash: hashContent("beta"), chunkSetId: "cs-now" },
    ]);
  });

  it("exact prior hit: suppressed and references the prior chunk-set id", () => {
    recordShown(dir, [{ textHash: hashContent("alpha"), chunkSetId: "cs-A" }]);
    const ex = [excerpt("alpha"), excerpt("beta")];
    const dd = dedupShownExcerpts({ sessionDir: dir, currentChunkSetId: "cs-now", excerpts: ex });
    expect(dd.excerpts.map((e) => e.text)).toEqual(["beta"]);
    expect(dd.suppressed).toBe(1);
    expect(dd.priorChunkSetIds).toEqual(["cs-A"]);
    // only the surviving first-occurrence is queued
    expect(dd.recordEntries).toEqual([{ textHash: hashContent("beta"), chunkSetId: "cs-now" }]);
  });

  it("distinct priorChunkSetIds, first-seen order, no dupes", () => {
    recordShown(dir, [
      { textHash: hashContent("a"), chunkSetId: "cs-A" },
      { textHash: hashContent("b"), chunkSetId: "cs-A" },
      { textHash: hashContent("c"), chunkSetId: "cs-B" },
    ]);
    const dd = dedupShownExcerpts({
      sessionDir: dir,
      currentChunkSetId: "cs-now",
      excerpts: [excerpt("a"), excerpt("b"), excerpt("c"), excerpt("d")],
    });
    expect(dd.excerpts.map((e) => e.text)).toEqual(["d"]);
    expect(dd.suppressed).toBe(3);
    expect(dd.priorChunkSetIds).toEqual(["cs-A", "cs-B"]);
  });

  it("in-batch duplicate: first kept+queued, second suppressed vs current chunk-set", () => {
    const dd = dedupShownExcerpts({
      sessionDir: dir,
      currentChunkSetId: "cs-now",
      excerpts: [excerpt("same"), excerpt("same")],
    });
    expect(dd.excerpts.map((e) => e.text)).toEqual(["same"]);
    expect(dd.suppressed).toBe(1);
    expect(dd.priorChunkSetIds).toEqual(["cs-now"]);
    expect(dd.recordEntries).toEqual([{ textHash: hashContent("same"), chunkSetId: "cs-now" }]);
  });

  it("does NOT suppress when the matched row has an empty chunkSetId (corrupt row)", () => {
    // hand-seed a corrupt row via recordShown then nullify is not possible
    // (first-writer-wins keeps cs-X); seed directly with an empty chunkSetId.
    recordShown(dir, [{ textHash: hashContent("alpha"), chunkSetId: "" }]);
    const dd = dedupShownExcerpts({
      sessionDir: dir,
      currentChunkSetId: "cs-now",
      excerpts: [excerpt("alpha")],
    });
    expect(dd.excerpts.map((e) => e.text)).toEqual(["alpha"]);
    expect(dd.suppressed).toBe(0);
  });
});
```

**Minimal impl — append to `shown-index.ts`:**

```ts
import type { OutputExcerpt } from "@megasaver/output-filter";
import { hashContent } from "./read-index.js";

export function dedupShownExcerpts(input: {
  sessionDir: string;
  currentChunkSetId: string;
  excerpts: readonly OutputExcerpt[];
}): {
  excerpts: OutputExcerpt[];
  suppressed: number;
  priorChunkSetIds: string[];
  recordEntries: { textHash: string; chunkSetId: string }[];
} {
  const shown = loadShownIndex(input.sessionDir);
  const seenThisBatch = new Set<string>();
  const kept: OutputExcerpt[] = [];
  const priorChunkSetIds: string[] = [];
  const recordEntries: { textHash: string; chunkSetId: string }[] = [];
  let suppressed = 0;

  for (const excerpt of input.excerpts) {
    const h = hashContent(excerpt.text);
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    const prior = shown[h];
    const priorId =
      prior !== undefined && typeof prior.chunkSetId === "string" && prior.chunkSetId.length > 0
        ? prior.chunkSetId
        : undefined;
    if (priorId !== undefined) {
      suppressed += 1;
      if (!priorChunkSetIds.includes(priorId)) priorChunkSetIds.push(priorId);
      continue;
    }
    if (seenThisBatch.has(h)) {
      // in-batch duplicate: it is persisted in THIS chunk-set, so reference it.
      suppressed += 1;
      if (!priorChunkSetIds.includes(input.currentChunkSetId)) {
        priorChunkSetIds.push(input.currentChunkSetId);
      }
      continue;
    }
    seenThisBatch.add(h);
    kept.push(excerpt);
    recordEntries.push({ textHash: h, chunkSetId: input.currentChunkSetId });
  }
  return { excerpts: kept, suppressed, priorChunkSetIds, recordEntries };
}
```

> Note: `dedupShownExcerpts` importing `OutputExcerpt` (type-only) from
> `@megasaver/output-filter` is allowed — context-gate already depends on
> output-filter (run.ts imports `FilterOutputResult`). Pure type import,
> no new runtime edge.

**Run:** `pnpm --filter @megasaver/output-filter test` (field compiles) +
`pnpm --filter @megasaver/context-gate test dedup-shown-excerpts`
**Commit:** `feat(output-filter): add deduped field + dedup helper`

---

### T4 — wire dedup into `runOutputPipeline` (registry read)

**Depends on:** T2, T3.
**Files:** `packages/context-gate/src/run.ts`,
`packages/context-gate/test/run.test.ts` (append a describe block).

**Failing test — append to `run.test.ts`:**

```ts
import { loadShownIndex } from "../src/shown-index.js";
import { hashContent as hc } from "../src/read-index.js";

describe("runOutputPipeline — already-in-context dedup (registry)", () => {
  let store: string;
  let projectRoot: string;
  let fileA: string;
  let fileB: string;
  let idCounter: number;

  const BODY = "line one\nerror: boom\nline three\n";

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "cg-dedup-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "cg-dedup-root-"));
    // two DISTINCT paths with byte-identical content -> diff-on-reread misses
    // both, but the produced excerpt text (and its hash) is identical.
    fileA = join(projectRoot, "a.txt");
    fileB = join(projectRoot, "b.txt");
    await writeFile(fileA, BODY);
    await writeFile(fileB, BODY);
    idCounter = 0;
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  function run(path: string, opts: { storeRawOutput?: boolean } = {}) {
    return runOutputPipeline({
      registry: registry(projectRoot, opts),
      storeRoot: store,
      sessionId: SESSION_ID,
      path,
      intent: "find the error",
      now: () => NOW,
      newId: () => `cs-${idCounter++}`,
      loadPermissions: () => null,
    });
  }

  function sessionContentDir() {
    return join(store, "content", PROJECT_ID, SESSION_ID);
  }

  it("first read returns excerpts, no deduped field, records shown-index", async () => {
    const r1 = await run(fileA);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.result.excerpts.length).toBeGreaterThan(0);
    expect("deduped" in r1.result).toBe(false);

    const idx = loadShownIndex(sessionContentDir());
    expect(idx[hc(r1.result.excerpts[0]!.text)]).toEqual({ chunkSetId: r1.result.chunkSetId });
  });

  it("second read of identical content (different path) suppresses + references prior", async () => {
    const r1 = await run(fileA);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const firstChunkSetId = r1.result.chunkSetId!;

    const r2 = await run(fileB);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    // identical body -> the matching excerpt is dropped
    expect(r2.result.deduped?.suppressed).toBeGreaterThanOrEqual(1);
    expect(r2.result.deduped?.priorChunkSetIds).toContain(firstChunkSetId);
    expect(r2.result.summary).toContain("already shown earlier this session");
    expect(r2.result.summary).toContain(firstChunkSetId);
    // suppressed excerpt text is NOT in the returned set
    const returnedTexts = r2.result.excerpts.map((e) => e.text);
    expect(returnedTexts).not.toContain(r1.result.excerpts[0]!.text);

    // EVIDENCE: the first chunk-set on disk still contains the full text.
    const firstRaw = await readFile(join(sessionContentDir(), `${firstChunkSetId}.json`), "utf8");
    expect(firstRaw).toContain("error: boom");
  });

  it("no prior hit -> nothing suppressed (distinct content)", async () => {
    await writeFile(fileA, "totally unique alpha content\n");
    await writeFile(fileB, "totally unique beta content\n");
    await run(fileA);
    const r2 = await run(fileB);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect("deduped" in r2.result).toBe(false);
  });

  it("storeRawOutput=false -> dedup skipped, no shown-index.json", async () => {
    await run(fileA, { storeRawOutput: false });
    const r2 = await run(fileB, { storeRawOutput: false });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect("deduped" in r2.result).toBe(false);
    await expect(readFile(join(sessionContentDir(), "shown-index.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("diff-on-reread still wins for an unchanged same-path re-read", async () => {
    await run(fileA);
    const r2 = await run(fileA); // same path, unchanged
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.result.decision).toBe("unchanged-marker");
    expect("deduped" in r2.result).toBe(false);
  });
});
```

**Minimal impl in `run.ts` (`runOutputPipeline`):**

1. Add imports:
```ts
import { dedupShownExcerpts, recordShown } from "./shown-index.js";
```
2. Change `const result = { ...filteredResult };` (L115) → `let result`.
3. Inside the `if (settings.storeRawOutput)` block, AFTER
   `result.chunkSetId = chunkSetId;` and `recordRead(...)` (after L132),
   add the dedup step:

```ts
    result.chunkSetId = chunkSetId;
    recordRead(sessionDir, pathHash, { contentHash: newHash, chunkSetId });

    const dd = dedupShownExcerpts({
      sessionDir,
      currentChunkSetId: chunkSetId,
      excerpts: filteredResult.excerpts,
    });
    result =
      dd.suppressed > 0
        ? {
            ...result,
            excerpts: dd.excerpts,
            summary: `${result.summary} (${dd.suppressed} chunk(s) already shown earlier this session — expand ${dd.priorChunkSetIds.join(", ")} to view)`,
            deduped: { suppressed: dd.suppressed, priorChunkSetIds: dd.priorChunkSetIds },
          }
        : { ...result, excerpts: dd.excerpts };
    recordShown(sessionDir, dd.recordEntries);
```

Note: the stats event block (L135-158) reads `filteredResult.*` and
`result.chunkSetId` — both still correct after the reassign (`chunkSetId`
carried by the spread). `chunksStored: filteredResult.excerpts.length`
unchanged (counts the PERSISTED set, not the trimmed one).

**Run:** `pnpm --filter @megasaver/context-gate test run.test`
**Commit:** `feat(context-gate): dedup shown excerpts in registry read`

---

### T5 — wire dedup into `runOverlayOutputPipeline` (overlay read)

**Depends on:** T2, T3. Identical pattern at the overlay site.
**Files:** `packages/context-gate/src/run.ts`,
`packages/context-gate/test/run-overlay.test.ts` (append a describe block).

**Failing test — append to `run-overlay.test.ts`:**

```ts
import { loadShownIndex } from "../src/shown-index.js";
import { hashContent as hc } from "../src/read-index.js";

describe("runOverlayOutputPipeline — already-in-context dedup (overlay)", () => {
  let store: string;
  let cwd: string;
  let fileA: string;
  let fileB: string;
  let idCounter: number;
  const BODY = "line one\nerror: boom\nline three\n";

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "cg-ov-dedup-store-"));
    cwd = await mkdtemp(join(tmpdir(), "cg-ov-dedup-cwd-"));
    fileA = join(cwd, "a.txt");
    fileB = join(cwd, "b.txt");
    await writeFile(fileA, BODY);
    await writeFile(fileB, BODY);
    idCounter = 0;
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  });

  function run(path: string, opts: { storeRawOutput?: boolean } = {}) {
    return runOverlayOutputPipeline({
      storeRoot: store,
      workspaceKey: WK,
      liveSessionId: LSID,
      cwd,
      path,
      intent: "find the error",
      mode: "balanced",
      maxReturnedBytes: 12_000,
      storeRawOutput: opts.storeRawOutput ?? true,
      permissions: null,
      now: () => NOW,
      newId: () => `cs-${idCounter++}`,
    });
  }
  function sessionContentDir() {
    return join(store, "content", WK, LSID);
  }

  it("suppresses identical content under overlay keys + evidence preserved", async () => {
    const r1 = await run(fileA);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const firstChunkSetId = r1.result.chunkSetId!;

    const r2 = await run(fileB);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.result.deduped?.priorChunkSetIds).toContain(firstChunkSetId);
    expect(r2.result.summary).toContain("already shown earlier this session");

    const idx = loadShownIndex(sessionContentDir());
    expect(idx[hc(r1.result.excerpts[0]!.text)]).toEqual({ chunkSetId: firstChunkSetId });
    const firstRaw = await readFile(join(sessionContentDir(), `${firstChunkSetId}.json`), "utf8");
    expect(firstRaw).toContain("error: boom");
  });

  it("no prior hit -> nothing suppressed", async () => {
    await writeFile(fileA, "unique alpha\n");
    await writeFile(fileB, "unique beta\n");
    await run(fileA);
    const r2 = await run(fileB);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect("deduped" in r2.result).toBe(false);
  });
});
```

**Minimal impl in `run.ts` (`runOverlayOutputPipeline`):** same three
edits at the overlay site — `let result` (L228), and after
`recordRead(...)` (after L245):

```ts
    result.chunkSetId = chunkSetId;
    recordRead(sessionDir, pathHash, { contentHash: newHash, chunkSetId });

    const dd = dedupShownExcerpts({
      sessionDir,
      currentChunkSetId: chunkSetId,
      excerpts: filteredResult.excerpts,
    });
    result =
      dd.suppressed > 0
        ? {
            ...result,
            excerpts: dd.excerpts,
            summary: `${result.summary} (${dd.suppressed} chunk(s) already shown earlier this session — expand ${dd.priorChunkSetIds.join(", ")} to view)`,
            deduped: { suppressed: dd.suppressed, priorChunkSetIds: dd.priorChunkSetIds },
          }
        : { ...result, excerpts: dd.excerpts };
    recordShown(sessionDir, dd.recordEntries);
```

(The `dedupShownExcerpts`/`recordShown` imports were added in T4.)

**Run:** `pnpm --filter @megasaver/context-gate test run-overlay`
**Commit:** `feat(context-gate): dedup shown excerpts in overlay read`

---

### T6 — wire dedup into `runOutputExecCommand` (registry exec)

**Depends on:** T2, T3. Proves grep-then-read cross-source dedup via the
ONE shared per-session `shown-index`.
**Files:** `packages/context-gate/src/run-command.ts`,
`packages/context-gate/test/run-command-dedup.test.ts` (new — exec needs
the spawn mock harness; keep it in its own file to avoid bloating
run.test.ts).

**Failing test (`run-command-dedup.test.ts`):**

```ts
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrchestratorRegistry } from "../src/registry-port.js";
import { runOutputExecCommand } from "../src/run-command.js";
import type { RunCommandSpawn } from "../src/run-command.js";
import { runOutputPipeline } from "../src/run.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const SESSION_ID = "22222222-2222-4222-8222-222222222222" as SessionId;
const NOW = "2026-06-10T12:00:00.000Z";
const ROOT_PID = String(process.pid);
const BODY = "line one\nerror: boom\nline three\n";

type FakeChild = EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: ReturnType<typeof vi.fn>; killed: boolean };
function makeChild(): FakeChild {
  const c = new EventEmitter() as FakeChild;
  c.stdout = new EventEmitter();
  c.stderr = new EventEmitter();
  c.killed = false;
  c.kill = vi.fn(() => { c.killed = true; return true; });
  return c;
}
function spawnMock(child: FakeChild): RunCommandSpawn {
  return ((_c: string, _a: readonly string[], _o: Record<string, unknown>) => child) as unknown as RunCommandSpawn;
}
function registry(projectRoot: string): OrchestratorRegistry {
  return {
    getSession: (id) => id === SESSION_ID
      ? { projectId: PROJECT_ID, tokenSaver: { mode: "balanced", maxReturnedBytes: 12_000, storeRawOutput: true } }
      : null,
    getProject: (id) => (id === PROJECT_ID ? { rootPath: projectRoot } : null),
  };
}

describe("runOutputExecCommand — grep-then-read dedup (shared session index)", () => {
  let store: string;
  let projectRoot: string;
  let idCounter: number;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "cg-exec-dedup-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "cg-exec-dedup-root-"));
    idCounter = 0;
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("exec records an excerpt; a later read of the same text is suppressed", async () => {
    const child = makeChild();
    const execPromise = runOutputExecCommand({
      registry: registry(projectRoot),
      storeRoot: store,
      sessionId: SESSION_ID,
      command: "rg",
      args: ["error"],
      intent: "find the error",
      originPid: ROOT_PID,
      timeoutMs: 300_000,
      maxBytes: 20_000_000,
      now: () => NOW,
      newId: () => `cs-${idCounter++}`,
      loadPermissions: () => null,
      spawn: spawnMock(child),
    });
    child.stdout.emit("data", Buffer.from(BODY));
    child.emit("close", 0);
    const execOutcome = await execPromise;
    expect(execOutcome.ok).toBe(true);
    if (!execOutcome.ok) return;
    const grepChunkSetId = execOutcome.result.chunkSetId!;
    const grepText = execOutcome.result.excerpts[0]!.text;

    // Now read a file whose content yields the SAME excerpt text.
    const filePath = join(projectRoot, "f.txt");
    await writeFile(filePath, BODY);
    const readOutcome = await runOutputPipeline({
      registry: registry(projectRoot),
      storeRoot: store,
      sessionId: SESSION_ID,
      path: filePath,
      intent: "find the error",
      now: () => NOW,
      newId: () => `cs-${idCounter++}`,
      loadPermissions: () => null,
    });
    expect(readOutcome.ok).toBe(true);
    if (!readOutcome.ok) return;
    // The read's excerpt that matches the grep text is suppressed and
    // references the grep chunk-set id — proves ONE shared session index.
    expect(readOutcome.result.deduped?.priorChunkSetIds).toContain(grepChunkSetId);
    expect(readOutcome.result.excerpts.map((e) => e.text)).not.toContain(grepText);

    // EVIDENCE: grep chunk-set on disk still has the text.
    const grepRaw = await readFile(join(store, "content", PROJECT_ID, SESSION_ID, `${grepChunkSetId}.json`), "utf8");
    expect(grepRaw).toContain("error: boom");
  });

  it("fresh exec with no prior hit suppresses nothing", async () => {
    const child = makeChild();
    const p = runOutputExecCommand({
      registry: registry(projectRoot),
      storeRoot: store,
      sessionId: SESSION_ID,
      command: "rg",
      args: ["x"],
      intent: "x",
      originPid: ROOT_PID,
      timeoutMs: 300_000,
      maxBytes: 20_000_000,
      now: () => NOW,
      newId: () => `cs-${idCounter++}`,
      loadPermissions: () => null,
      spawn: spawnMock(child),
    });
    child.stdout.emit("data", Buffer.from("unique exec output\n"));
    child.emit("close", 0);
    const o = await p;
    expect(o.ok).toBe(true);
    if (!o.ok) return;
    expect("deduped" in o.result).toBe(false);
  });
});
```

**Minimal impl in `run-command.ts` (`runOutputExecCommand`):**

1. Add imports (file currently has neither):
```ts
import { join } from "node:path";
import { dedupShownExcerpts, recordShown } from "./shown-index.js";
```
2. Change `const result: ExecResult = {` (L256) → `let result: ExecResult = {`.
3. Inside `if (settings.storeRawOutput)`, AFTER `result.chunkSetId =
   chunkSetId;` (after L286), add:

```ts
    result.chunkSetId = chunkSetId;

    const sessionDir = join(input.storeRoot, "content", settings.projectId, input.sessionId);
    const dd = dedupShownExcerpts({ sessionDir, currentChunkSetId: chunkSetId, excerpts: filtered.excerpts });
    result =
      dd.suppressed > 0
        ? {
            ...result,
            excerpts: dd.excerpts,
            summary: `${result.summary} (${dd.suppressed} chunk(s) already shown earlier this session — expand ${dd.priorChunkSetIds.join(", ")} to view)`,
            deduped: { suppressed: dd.suppressed, priorChunkSetIds: dd.priorChunkSetIds },
          }
        : { ...result, excerpts: dd.excerpts };
    recordShown(sessionDir, dd.recordEntries);
```

Note: the spread `{ ...result, ... }` preserves the `childExitCode` /
`terminated?` fields already on `result`. The event block (L289-313)
reads `filtered.*` and `result.chunkSetId` — both still correct.
`chunksStored: filtered.excerpts.length` unchanged.

**Run:** `pnpm --filter @megasaver/context-gate test run-command-dedup`
**Commit:** `feat(context-gate): dedup shown excerpts in registry exec`

---

### T7 — wire dedup into `runOverlayOutputExecCommand` (overlay exec)

**Depends on:** T2, T3. Same pattern, overlay keys.
**Files:** `packages/context-gate/src/run-command.ts`,
`packages/context-gate/test/run-command-dedup.test.ts` (append a describe
block; reuse the spawn-mock helpers — extract them to module scope in
this file if not already).

**Failing test — append to `run-command-dedup.test.ts`:**

```ts
import { runOverlayOutputExecCommand } from "../src/run-command.js";
import { runOverlayOutputPipeline } from "../src/run.js";

const WK = "0123456789abcdef";
const LSID = "33333333-3333-4333-8333-333333333333";

describe("runOverlayOutputExecCommand — grep-then-read dedup (overlay)", () => {
  let store: string;
  let cwd: string;
  let idCounter: number;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "cg-ov-exec-dedup-store-"));
    cwd = await mkdtemp(join(tmpdir(), "cg-ov-exec-dedup-cwd-"));
    idCounter = 0;
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  });

  it("overlay exec records; later overlay read of same text is suppressed", async () => {
    const child = makeChild();
    const execPromise = runOverlayOutputExecCommand({
      storeRoot: store,
      workspaceKey: WK,
      liveSessionId: LSID,
      cwd,
      command: "rg",
      args: ["error"],
      intent: "find the error",
      originPid: ROOT_PID,
      timeoutMs: 300_000,
      maxBytes: 20_000_000,
      mode: "balanced",
      maxReturnedBytes: 12_000,
      storeRawOutput: true,
      permissions: null,
      now: () => NOW,
      newId: () => `cs-${idCounter++}`,
      spawn: spawnMock(child),
    });
    child.stdout.emit("data", Buffer.from(BODY));
    child.emit("close", 0);
    const execOutcome = await execPromise;
    expect(execOutcome.ok).toBe(true);
    if (!execOutcome.ok) return;
    const grepChunkSetId = execOutcome.result.chunkSetId!;

    const filePath = join(cwd, "f.txt");
    await writeFile(filePath, BODY);
    const readOutcome = await runOverlayOutputPipeline({
      storeRoot: store,
      workspaceKey: WK,
      liveSessionId: LSID,
      cwd,
      path: filePath,
      intent: "find the error",
      mode: "balanced",
      maxReturnedBytes: 12_000,
      storeRawOutput: true,
      permissions: null,
      now: () => NOW,
      newId: () => `cs-${idCounter++}`,
    });
    expect(readOutcome.ok).toBe(true);
    if (!readOutcome.ok) return;
    expect(readOutcome.result.deduped?.priorChunkSetIds).toContain(grepChunkSetId);

    const grepRaw = await readFile(join(store, "content", WK, LSID, `${grepChunkSetId}.json`), "utf8");
    expect(grepRaw).toContain("error: boom");
  });
});
```

**Minimal impl in `run-command.ts` (`runOverlayOutputExecCommand`):** same
three edits at the overlay site — `let result: ExecResult` (L401), and
after `result.chunkSetId = chunkSetId;` (after L431):

```ts
    result.chunkSetId = chunkSetId;

    const sessionDir = join(input.storeRoot, "content", input.workspaceKey, input.liveSessionId);
    const dd = dedupShownExcerpts({ sessionDir, currentChunkSetId: chunkSetId, excerpts: filtered.excerpts });
    result =
      dd.suppressed > 0
        ? {
            ...result,
            excerpts: dd.excerpts,
            summary: `${result.summary} (${dd.suppressed} chunk(s) already shown earlier this session — expand ${dd.priorChunkSetIds.join(", ")} to view)`,
            deduped: { suppressed: dd.suppressed, priorChunkSetIds: dd.priorChunkSetIds },
          }
        : { ...result, excerpts: dd.excerpts };
    recordShown(sessionDir, dd.recordEntries);
```

(Imports `join` / `dedupShownExcerpts` / `recordShown` added in T6.)

**Run:** `pnpm --filter @megasaver/context-gate test run-command-dedup`
**Commit:** `feat(context-gate): dedup shown excerpts in overlay exec`

---

### T8 — changeset + full verify + smoke evidence

**Files:** `.changeset/already-in-context-dedup.md` (new).

**Content:**

```md
---
"@megasaver/content-store": minor
"@megasaver/output-filter": minor
"@megasaver/context-gate": minor
---

feat: per-session already-in-context dedup

Suppress an excerpt whose exact text was already returned to the model
earlier in the same session (from any read, command, or grep) and
reference the prior chunk-set instead, so identical text is not billed
twice. New per-session `shown-index.json` sibling index; evidence stays
recoverable via the referenced chunk-set (lossless expand).
```

**Verify (must all be green, capture output as evidence):**

```bash
pnpm exec biome check \
  packages/content-store/src/store.ts \
  packages/content-store/src/index.ts \
  packages/content-store/test/shown-index-skip.test.ts \
  packages/context-gate/src/shown-index.ts \
  packages/context-gate/src/run.ts \
  packages/context-gate/src/run-command.ts \
  packages/context-gate/test/shown-index.test.ts \
  packages/context-gate/test/dedup-shown-excerpts.test.ts \
  packages/context-gate/test/run.test.ts \
  packages/context-gate/test/run-overlay.test.ts \
  packages/context-gate/test/run-command-dedup.test.ts \
  packages/output-filter/src/types.ts \
  .changeset/already-in-context-dedup.md
pnpm verify   # lint + typecheck + test + conventions:check
```

**Compliance:** `apps/cli/test/readme-proxy-mode.test.ts` must stay green
(no README change in this feature).

**Smoke evidence (Component 7 honesty):** a captured session showing
grep-then-read overlap deduped (`deduped.suppressed >= 1`, summary note
present) AND a resolvable `proxy_expand_chunk(<priorChunkSetId>)` that
returns the original text — demonstrating lossless expand.

**Commit:** `chore: changeset for already-in-context dedup`

---

## Known coverage gap (documented, not a bug)

`recordAndFilterOverlayOutput` (`record-output.ts:89`, the PostToolUse
hook path) persists ONE whole-output chunk (`id:"0"`) and returns
`returnedText`, not `OutputExcerpt[]`. It is OUT of dedup coverage in
this feature (no per-excerpt granularity to suppress). It still writes
into the shared session dir, so it remains a valid future reference
target. Success criterion #6 is the FOUR per-excerpt pipelines only.

## DoD checklist

- [ ] Spec + this plan committed.
- [ ] T1-T7 tests written first (red) then made green.
- [ ] `pnpm verify` green (lint + typecheck + test + conventions:check).
- [ ] `pnpm exec biome check <changed files>` before each commit.
- [ ] Smoke evidence captured (grep-then-read dedup + expand resolves).
- [ ] Changeset added (content-store + output-filter + context-gate, minor).
- [ ] code-reviewer AND critic passes (HIGH risk, §12), fresh context.
- [ ] verifier pass.
- [ ] No `CLAUDE.md`/`AGENTS.md`/`.cursor/rules` change (no convention change).
- [ ] Stage explicit paths only — never `git add -A` (untracked cruft).
```
