# Saver Recovery Wave 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hook-compressed output is stored as uniform 40-line chunks (fetch only the slice you need) and the content store self-cleans: 30-day retention, throttled hook trigger, `mega output gc`.

**Architecture:** (C12) `record-output.ts` splits the full redacted raw via the existing `chunkByLines(text, 40)`; footer becomes N-aware with a line→id formula. (C14) `pruneOlderThan` learns the overlay schema + empties dead dirs; a new `apps/cli/src/hooks/gc.ts` runs it best-effort once/day from the saver hook; `mega output gc` runs it manually.

**Tech Stack:** TypeScript strict ESM, Vitest, Zod 3, citty.

**Spec:** `docs/superpowers/specs/2026-07-09-saver-recovery-design.md` (HIGH risk). Worktree `feat/saver-recovery`, STACKED on `feat/saver-coverage` — never main.

**Grounded facts:** overlay/registry schemas both carry `createdAt`; `chunkByLines` lives at `packages/output-filter/src/chunk.ts` (16 lines; check it is exported from the package index — if not, add the re-export and include `@megasaver/output-filter` patch in the changeset); evidence `returnedChunkRefs: z.array(returnedChunkRefSchema)` is uncapped (`{chunkSetId, chunkId}` strict); CLI devDeps already include `@megasaver/content-store`; the GC marker `content/.last-gc` is a FILE at the top of `content/` — the pruner walk MUST gain `isDirectory()` guards or it crashes on it.

---

### Task 0: Baseline

- [ ] **Step 1:** From `/Users/halitozger/Desktop/MegaSaver/.claude/worktrees/saver-recovery`: `pnpm install && pnpm --filter @megasaver/gui build && pnpm build`.
- [ ] **Step 2:** Baseline green: `pnpm --filter @megasaver/content-store test && pnpm --filter @megasaver/context-gate test && pnpm --filter @megasaver/cli exec vitest run test/hooks/ test/output/`.

---

### Task 1: Overlay-aware pruner + dir cleanup (`packages/content-store`)

**Files:**
- Modify: `packages/content-store/src/store.ts` (`pruneOlderThan`, ~L225-263)
- Test: `packages/content-store/test/prune-overlay.test.ts` (new)

- [ ] **Step 1: Write failing test** — create `packages/content-store/test/prune-overlay.test.ts`:

```ts
import { mkdirSync, mkdtempSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pruneOlderThan, saveOverlayChunkSet } from "../src/store.js";

const WK = "7da3a87ecc581dd6";
const LIVE = "11111111-1111-4111-8111-111111111111";
const OLD = "2026-01-01T00:00:00.000Z";
const YOUNG = "2026-07-09T00:00:00.000Z";
const CUTOFF = new Date("2026-06-01T00:00:00.000Z");

let store: string;
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "megasaver-prune-ovl-"));
});
afterEach(() => rmSync(store, { recursive: true, force: true }));

async function seedOverlay(chunkSetId: string, createdAt: string): Promise<string> {
  await saveOverlayChunkSet({
    storeRoot: store,
    chunkSet: {
      chunkSetId,
      workspaceKey: WK,
      liveSessionId: LIVE,
      createdAt,
      source: { kind: "command", command: "x", args: [] },
      rawBytes: 1,
      redacted: false,
      chunks: [{ id: "0", startLine: 1, endLine: 1, bytes: 1, text: "x" }],
    },
  });
  return join(store, "content", WK, LIVE, `${chunkSetId}.json`);
}

describe("pruneOlderThan — overlay layout (C14)", () => {
  it("deletes an old overlay set and keeps a young one", async () => {
    const oldPath = await seedOverlay("aaaaaaaa-0000-4000-8000-000000000001", OLD);
    const youngPath = await seedOverlay("aaaaaaaa-0000-4000-8000-000000000002", YOUNG);
    const { removed } = await pruneOlderThan({ storeRoot: store, olderThan: CUTOFF });
    expect(removed).toBe(1);
    expect(existsSync(oldPath)).toBe(false);
    expect(existsSync(youngPath)).toBe(true);
  });

  it("removes emptied session and workspace dirs but never content/ itself", async () => {
    await seedOverlay("aaaaaaaa-0000-4000-8000-000000000001", OLD);
    await pruneOlderThan({ storeRoot: store, olderThan: CUTOFF });
    expect(existsSync(join(store, "content", WK, LIVE))).toBe(false);
    expect(existsSync(join(store, "content", WK))).toBe(false);
    expect(existsSync(join(store, "content"))).toBe(true);
  });

  it("survives the .last-gc marker file and stray non-dirs at both levels", async () => {
    const oldPath = await seedOverlay("aaaaaaaa-0000-4000-8000-000000000001", OLD);
    writeFileSync(join(store, "content", ".last-gc"), "");
    writeFileSync(join(store, "content", WK, ".DS_Store"), "junk");
    const { removed } = await pruneOlderThan({ storeRoot: store, olderThan: CUTOFF });
    expect(removed).toBe(1);
    expect(existsSync(oldPath)).toBe(false);
    expect(existsSync(join(store, "content", ".last-gc"))).toBe(true);
  });

  it("leaves an unknown/corrupt json untouched and keeps a dir holding read-index.json", async () => {
    await seedOverlay("aaaaaaaa-0000-4000-8000-000000000001", OLD);
    writeFileSync(join(store, "content", WK, LIVE, "read-index.json"), "{}");
    writeFileSync(join(store, "content", WK, LIVE, "junk.json"), "not json");
    const { removed } = await pruneOlderThan({ storeRoot: store, olderThan: CUTOFF });
    expect(removed).toBe(1);
    expect(existsSync(join(store, "content", WK, LIVE, "read-index.json"))).toBe(true);
    expect(existsSync(join(store, "content", WK, LIVE, "junk.json"))).toBe(true);
    expect(existsSync(join(store, "content", WK, LIVE))).toBe(true); // not emptied
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — `pnpm --filter @megasaver/content-store exec vitest run test/prune-overlay.test.ts`. First test fails: `removed` is 0 (overlay files fail the strict registry parse → `continue`).

- [ ] **Step 3: Implement.** In `packages/content-store/src/store.ts`, replace the body of `pruneOlderThan` and add a helper (keep the existing signature; add `rmdirSync`, `statSync` to the `node:fs` import; `overlayChunkSetSchema` is already imported for save/load — verify):

```ts
// Reads createdAt from either layout; null = not a chunk set (leave the file alone).
function readChunkSetCreatedAt(path: string): string | null {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  const registry = chunkSetSchema.safeParse(json);
  if (registry.success) return registry.data.createdAt;
  const overlay = overlayChunkSetSchema.safeParse(json);
  if (overlay.success) return overlay.data.createdAt;
  return null;
}

export async function pruneOlderThan(input: {
  storeRoot: string;
  olderThan: Date;
}): Promise<{ removed: number }> {
  const contentRoot = join(input.storeRoot, "content");

  let topDirs: string[];
  try {
    topDirs = readdirSync(contentRoot);
  } catch (error) {
    if (isErrno(error) && error.code === "ENOENT") return { removed: 0 };
    throw error;
  }

  let removed = 0;
  for (const topDir of topDirs) {
    const topPath = join(contentRoot, topDir);
    if (!statSync(topPath).isDirectory()) continue; // .last-gc marker, .DS_Store
    for (const sessionDirName of readdirSync(topPath)) {
      const sessionPath = join(topPath, sessionDirName);
      if (!statSync(sessionPath).isDirectory()) continue;
      for (const name of readdirSync(sessionPath)) {
        if (!name.endsWith(".json")) continue;
        if (name === READ_INDEX_FILENAME) continue; // sibling index, not a chunk-set
        if (name === SHOWN_INDEX_FILENAME) continue; // sibling index, not a chunk-set
        const path = join(sessionPath, name);
        const createdAt = readChunkSetCreatedAt(path);
        if (createdAt === null) continue;
        if (new Date(createdAt) < input.olderThan) {
          rmSync(path, { force: true });
          removed += 1;
        }
      }
      // Housekeeping: drop dirs the prune emptied. rmdir refuses non-empty
      // dirs (read-index survivors, young sets), which is exactly the guard.
      try {
        rmdirSync(sessionPath);
      } catch {
        /* not empty */
      }
    }
    try {
      rmdirSync(topPath);
    } catch {
      /* not empty */
    }
  }
  return { removed };
}
```

- [ ] **Step 4: Run, verify PASS** — the 4 new tests + `pnpm --filter @megasaver/content-store test` (existing prune tests must still pass — registry behavior unchanged) + `pnpm --filter @megasaver/content-store typecheck`. `biome check` on changed files.
- [ ] **Step 5: Commit**

```bash
git add packages/content-store/src/store.ts packages/content-store/test/prune-overlay.test.ts
git commit -m "fix(content-store): prune overlay chunk sets and emptied dirs"
```

---

### Task 2: Multi-chunk write (`packages/context-gate/src/record-output.ts`)

**Files:**
- Modify: `packages/context-gate/src/record-output.ts`
- Possibly modify: `packages/output-filter/src/index.ts` (export `chunkByLines` if not already)
- Test: extend the existing record-output test file (find it: `ls packages/context-gate/test/ | grep record`)

- [ ] **Step 1: Recon** — `grep -n "chunkByLines" packages/output-filter/src/index.ts`; if absent, add `export { chunkByLines } from "./chunk.js";` (note it for the changeset). Read the current single-chunk block (record-output.ts ~L114-151) and the evidence block (~L177-205) raw.

- [ ] **Step 2: Write failing tests** — in the context-gate record-output test file add (adapt imports/harness to the existing file's style; it already exercises `recordAndFilterOverlayOutput` against a tmpdir):

```ts
describe("multi-chunk overlay write (C12)", () => {
  it("splits a large raw into 40-line chunks with contiguous ranges and real ids", async () => {
    const raw = Array.from({ length: 200 }, (_, i) => `line ${i + 1} content`).join("\n");
    const result = await recordAndFilterOverlayOutput({
      storeRoot: store,
      workspaceKey: WK,
      liveSessionId: LIVE,
      raw,
      sourceKind: "command",
      label: "pnpm verify",
      mode: "aggressive",
      storeRawOutput: true,
    });
    expect(result.decision).toBe("compressed");
    expect(result.chunkCount).toBe(5);
    const set = await loadOverlayChunkSet({
      storeRoot: store,
      workspaceKey: WK,
      liveSessionId: LIVE,
      chunkSetId: result.chunkSetId as string,
    });
    expect(set.chunks).toHaveLength(5);
    expect(set.chunks.map((c) => c.id)).toEqual(["0", "1", "2", "3", "4"]);
    expect(set.chunks[0]).toMatchObject({ startLine: 1, endLine: 40 });
    expect(set.chunks[4]).toMatchObject({ startLine: 161, endLine: 200 });
    expect(set.chunks[2]?.text).toContain("line 81 content");
    expect(set.chunks[2]?.text).toContain("line 120 content");
  });

  it("keeps a <=40-line raw as the single chunk 0 (regression)", async () => {
    const raw = `${"x".repeat(6000)}\n${"y".repeat(6000)}`; // 2 lines, big bytes
    const result = await recordAndFilterOverlayOutput({
      storeRoot: store, workspaceKey: WK, liveSessionId: LIVE, raw,
      sourceKind: "command", label: "l", mode: "aggressive", storeRawOutput: true,
    });
    expect(result.chunkCount).toBe(1);
    const set = await loadOverlayChunkSet({
      storeRoot: store, workspaceKey: WK, liveSessionId: LIVE,
      chunkSetId: result.chunkSetId as string,
    });
    expect(set.chunks.map((c) => c.id)).toEqual(["0"]);
  });
});
```

(Use the file's existing `store`/`WK`/`LIVE` fixtures; `loadOverlayChunkSet` from `@megasaver/content-store`. If the existing tests construct raws differently, follow their idiom — assertions stay.)

- [ ] **Step 3: Run, verify FAIL** (`chunkCount` undefined; single chunk).

- [ ] **Step 4: Implement** in `record-output.ts`:

Add near the top: `import { chunkByLines } from "@megasaver/output-filter";` and
`export const OVERLAY_CHUNK_LINES = 40;` (with a one-line comment: matches the generic chunker default; the footer formula depends on it).

Replace the single-chunk construction inside `if (input.storeRawOutput) {`:

```ts
    chunkSetId = newId();
    const pieces =
      redactedText === ""
        ? [{ text: "", startLine: 1, endLine: 1 }]
        : chunkByLines(redactedText, OVERLAY_CHUNK_LINES);
    const chunks = pieces.map((piece, i) => ({
      id: String(i),
      startLine: piece.startLine,
      endLine: piece.endLine,
      bytes: Buffer.byteLength(piece.text, "utf8"),
      text: piece.text,
    }));
    const chunkSet: OverlayChunkSet = {
      chunkSetId,
      workspaceKey: input.workspaceKey,
      liveSessionId: input.liveSessionId,
      createdAt,
      source: chunkSetSource(input.sourceKind, redactedLabel),
      rawBytes: filtered.rawBytes,
      redacted: secretCount > 0,
      chunks,
    };
    // Store the full redacted output (not just the kept excerpts) so the agent
    // can recover EVERYTHING via expand — split into fixed 40-line chunks so an
    // expansion fetches only the needed slice (C12), not the whole raw again.
    await saveOverlayChunkSet({ storeRoot: input.storeRoot, chunkSet });
    chunksStored = chunks.length;
```

Hoist a `let chunkRefs: Array<{ chunkSetId: string; chunkId: string }> = [];` next to `chunkSetId`/`chunksStored` and set `chunkRefs = chunks.map((c) => ({ chunkSetId: chunkSetId as string, chunkId: c.id }));` inside the block. In the evidence write, replace `returnedChunkRefs: [{ chunkSetId, chunkId: "0" }]` with `returnedChunkRefs: chunkRefs`.

Extend `RecordOverlayOutputResult` with `chunkCount?: number;` and the final return with
`...(chunkSetId !== undefined ? { chunkSetId, chunkCount: chunksStored } : {})`.

- [ ] **Step 5: Run, verify PASS** — new tests + `pnpm --filter @megasaver/context-gate test` (existing record-output/evidence tests must pass — if one pinned `returnedChunkRefs` to `[{...,"0"}]` for a small raw it still passes: a ≤40-line raw yields exactly that; a pinned MULTI-line fixture may need its expectation updated to the real refs — update expectations, never weaken assertions) + typecheck + biome.
- [ ] **Step 6: Commit**

```bash
git add packages/context-gate/src/record-output.ts packages/context-gate/test packages/output-filter/src/index.ts
git commit -m "feat(context-gate): store overlay raw as uniform 40-line chunks"
```

---

### Task 3: N-aware footer (`apps/cli/src/hooks/saver.ts`)

**Files:**
- Modify: `apps/cli/src/hooks/saver.ts` (footer block only)
- Test: `apps/cli/test/hooks/saver.test.ts`

- [ ] **Step 1: Write failing tests** (the `RECORDED` fixture gains `chunkCount`; add a multi-chunk variant):

```ts
describe("N-aware recovery footer (C12)", () => {
  it("single chunk keeps today's wording (regression)", async () => {
    const d = deps(); // RECORDED has chunkCount: 1 — add it to the fixture
    const out = await buildSaverDecision(bigBash("X".repeat(50_000)), d);
    const u = (out as { updatedToolOutput: { stdout: string } }).updatedToolOutput;
    expect(u.stdout).toContain('run: mega output chunk "cs-1" "0"');
    expect(u.stdout).not.toContain("chunks of 40 lines");
  });

  it("multi chunk advertises N and the line formula", async () => {
    const d = deps({
      record: vi.fn().mockResolvedValue({ ...RECORDED, chunkCount: 5 }),
    });
    const out = await buildSaverDecision(bigBash("X".repeat(50_000)), d);
    const u = (out as { updatedToolOutput: { stdout: string } }).updatedToolOutput;
    expect(u.stdout).toContain("in 5 chunks of 40 lines");
    expect(u.stdout).toContain("chunk i covers lines 40*i+1..40*i+40");
    expect(u.stdout).toContain('run: mega output chunk "cs-1" "<i>"');
  });
});
```

Add `chunkCount: 1` to the existing `RECORDED` fixture (top of file) so every pre-existing footer test keeps the single-chunk wording.

- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement** — replace the footer block:

```ts
    const n = recorded.chunkCount ?? 1;
    const expandCmd =
      n > 1
        ? `in ${n} chunks of 40 lines (chunk i covers lines 40*i+1..40*i+40) — run: mega output chunk "${recorded.chunkSetId}" "<i>"`
        : `— run: mega output chunk "${recorded.chunkSetId}" "0"`;
    const recovery = looksPreTruncated(shape.raw)
      ? `NOTE: upstream output appears truncated, recovered chunks are PARTIAL, not complete ${expandCmd} (or MCP proxy_expand_chunk if connected)`
      : `Full output recoverable ${expandCmd} (or MCP proxy_expand_chunk if connected)`;
```

CAREFUL: the single-chunk wording must remain byte-identical to wave 1's footer (existing tests assert `run: mega output chunk "cs-1" "0"` and the `Full output recoverable —` prefix). Check the exact current strings first and keep the em-dash spacing identical; if the PARTIAL variant's old text said "recovered chunk is PARTIAL" (singular), keep singular for n===1 and use plural only for n>1 — simplest: build the PARTIAL noun as `n > 1 ? "recovered chunks are" : "recovered chunk is"`.

- [ ] **Step 4: Run, verify PASS** — whole `saver.test.ts` + typecheck + biome.
- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/hooks/saver.ts apps/cli/test/hooks/saver.test.ts
git commit -m "feat(cli): N-aware recovery footer with line formula"
```

---

### Task 4: Throttled hook GC trigger (`apps/cli/src/hooks/gc.ts`)

**Files:**
- Create: `apps/cli/src/hooks/gc.ts`
- Modify: `apps/cli/src/hooks/saver-run.ts` (one call in `runSaverHookFromProcess`)
- Test: `apps/cli/test/hooks/gc.test.ts` (new)

- [ ] **Step 1: Write failing test** — `apps/cli/test/hooks/gc.test.ts`:

```ts
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GC_INTERVAL_MS, OVERLAY_RETENTION_MS, maybeRunOverlayGc } from "../../src/hooks/gc.js";

const NOW = Date.UTC(2026, 6, 15, 12, 0, 0);

let store: string;
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "megasaver-gc-"));
  mkdirSync(join(store, "content"), { recursive: true });
});
afterEach(() => rmSync(store, { recursive: true, force: true }));

describe("maybeRunOverlayGc", () => {
  it("runs on first call, creates the marker, prunes with the 30-day cutoff", async () => {
    const prune = vi.fn(async () => ({ removed: 3 }));
    const ran = await maybeRunOverlayGc(store, { now: () => NOW, prune });
    expect(ran).toBe(true);
    expect(prune).toHaveBeenCalledWith({
      storeRoot: store,
      olderThan: new Date(NOW - OVERLAY_RETENTION_MS),
    });
    expect(existsSync(join(store, "content", ".last-gc"))).toBe(true);
  });

  it("throttles a second call inside the interval", async () => {
    const prune = vi.fn(async () => ({ removed: 0 }));
    await maybeRunOverlayGc(store, { now: () => NOW, prune });
    const ran = await maybeRunOverlayGc(store, { now: () => NOW + 60_000, prune });
    expect(ran).toBe(false);
    expect(prune).toHaveBeenCalledTimes(1);
  });

  it("runs again after the interval elapses", async () => {
    const prune = vi.fn(async () => ({ removed: 0 }));
    await maybeRunOverlayGc(store, { now: () => NOW, prune });
    const ran = await maybeRunOverlayGc(store, { now: () => NOW + GC_INTERVAL_MS + 1, prune });
    expect(ran).toBe(true);
    expect(prune).toHaveBeenCalledTimes(2);
  });

  it("touches the marker BEFORE pruning (stampede guard) and swallows a prune throw", async () => {
    let markerMtimeAtPrune = 0;
    const prune = vi.fn(async () => {
      markerMtimeAtPrune = statSync(join(store, "content", ".last-gc")).mtimeMs;
      throw new Error("boom");
    });
    const ran = await maybeRunOverlayGc(store, { now: () => NOW, prune });
    expect(ran).toBe(false); // failed run reports false
    expect(markerMtimeAtPrune).toBeGreaterThan(0); // marker existed before prune ran
  });

  it("returns false without throwing when content/ does not exist", async () => {
    const bare = mkdtempSync(join(tmpdir(), "megasaver-gc-bare-"));
    const prune = vi.fn(async () => ({ removed: 0 }));
    const ran = await maybeRunOverlayGc(bare, { now: () => NOW, prune });
    expect(ran).toBe(false);
    expect(prune).not.toHaveBeenCalled();
    rmSync(bare, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run, verify FAIL** (module not found).
- [ ] **Step 3: Implement `apps/cli/src/hooks/gc.ts`:**

```ts
import { statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pruneOlderThan } from "@megasaver/content-store";

export const OVERLAY_RETENTION_MS = 30 * 86_400_000;
export const GC_INTERVAL_MS = 86_400_000;

export type GcDeps = {
  now?: () => number;
  prune?: typeof pruneOlderThan;
};

// Throttled, best-effort content-store GC (C14). The marker is touched BEFORE
// pruning so concurrent hook processes cannot stampede the content/ walk.
// Every failure path returns false without throwing — housekeeping, not
// correctness (pruneTraceSessions precedent). Returns true only when a prune
// actually ran to completion.
export async function maybeRunOverlayGc(storeRoot: string, deps: GcDeps = {}): Promise<boolean> {
  const now = deps.now ?? Date.now;
  const prune = deps.prune ?? pruneOlderThan;
  const marker = join(storeRoot, "content", ".last-gc");
  try {
    const mtime = statSync(marker).mtimeMs;
    if (now() - mtime < GC_INTERVAL_MS) return false;
    const stamp = new Date(now());
    utimesSync(marker, stamp, stamp);
  } catch {
    // Marker absent: claim it. If content/ itself is absent this write throws
    // and there is nothing to prune anyway.
    try {
      writeFileSync(marker, "");
    } catch {
      return false;
    }
  }
  try {
    await prune({ storeRoot, olderThan: new Date(now() - OVERLAY_RETENTION_MS) });
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Wire into `saver-run.ts`** — in `runSaverHookFromProcess`, after `const decision = await buildSaverDecision(payload, deps);` add:

```ts
    // C14: opportunistic store GC, at most once/day. Awaited (the hook process
    // would wait for the pending promise at exit anyway); adds ≤~100ms once a
    // day on the compression path only. ponytail: detached spawn if this ever
    // measures slow on giant stores.
    if ("updatedToolOutput" in decision) await maybeRunOverlayGc(storeRoot);
```

with `import { maybeRunOverlayGc } from "./gc.js";`.

- [ ] **Step 5: Run, verify PASS** — gc.test.ts (5) + `pnpm --filter @megasaver/cli exec vitest run test/hooks/` (saver-run tests unaffected: GC fires only on compression and swallows everything; if a saver-run test exercises the full process path with a real store, confirm it still passes) + typecheck + biome.
- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/hooks/gc.ts apps/cli/src/hooks/saver-run.ts apps/cli/test/hooks/gc.test.ts
git commit -m "feat(cli): throttled daily overlay GC from the saver hook"
```

---

### Task 5: `mega output gc` command

**Files:**
- Create: `apps/cli/src/commands/output/gc.ts`
- Modify: `apps/cli/src/commands/output/index.ts` (register + re-export)
- Test: `apps/cli/test/output/gc.test.ts` (new; follow the harness style of the existing `apps/cli/test/output/` tests — injectable run-fn, stdout/stderr arrays)

- [ ] **Step 1: Write failing test** — `apps/cli/test/output/gc.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { runOutputGc } from "../../src/commands/output/gc.js";

const NOW = Date.UTC(2026, 6, 15, 12, 0, 0);

function run(over: { days?: string; json?: boolean; removed?: number } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const prune = vi.fn(async () => ({ removed: over.removed ?? 2 }));
  const code = runOutputGc({
    storeRoot: "/store",
    now: () => NOW,
    ...(over.days === undefined ? {} : { days: over.days }),
    json: over.json ?? false,
    prune,
    stdout: (l) => out.push(l),
    stderr: (l) => err.push(l),
  });
  return { code, out, err, prune };
}

describe("runOutputGc", () => {
  it("defaults to 30 days and reports the removed count", async () => {
    const { code, out, prune } = run();
    expect(await code).toBe(0);
    expect(prune).toHaveBeenCalledWith({
      storeRoot: "/store",
      olderThan: new Date(NOW - 30 * 86_400_000),
    });
    expect(out.join("\n")).toContain("removed 2 chunk set(s)");
  });

  it("honors --days override", async () => {
    const { code, prune } = run({ days: "7" });
    expect(await code).toBe(0);
    expect(prune).toHaveBeenCalledWith({
      storeRoot: "/store",
      olderThan: new Date(NOW - 7 * 86_400_000),
    });
  });

  it("--json emits the stable shape", async () => {
    const { code, out } = run({ json: true, removed: 5 });
    expect(await code).toBe(0);
    expect(JSON.parse(out[0] as string)).toEqual({ removed: 5 });
  });

  it("rejects bad --days with exit 1", async () => {
    for (const days of ["0", "-1", "abc", "3651", "1.5"]) {
      const { code, err, prune } = run({ days });
      expect(await code).toBe(1);
      expect(err.join("\n")).toContain("Invalid --days");
      expect(prune).not.toHaveBeenCalled();
    }
  });

  it("surfaces a prune failure as exit 1", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = runOutputGc({
      storeRoot: "/store",
      now: () => NOW,
      json: false,
      prune: vi.fn(async () => {
        throw new Error("disk gone");
      }),
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
    });
    expect(await code).toBe(1);
    expect(err.join("\n")).toContain("error:");
  });
});
```

- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement `apps/cli/src/commands/output/gc.ts`:**

```ts
import { pruneOlderThan } from "@megasaver/content-store";
import { defineCommand } from "citty";
import { readStoreEnv, resolveStorePath } from "../../store.js";

const DAY_MS = 86_400_000;
const DEFAULT_DAYS = 30;

function parseDays(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 3650 ? n : null;
}

export type RunOutputGcInput = {
  storeRoot: string;
  now: () => number;
  days?: string;
  json: boolean;
  /** Override for tests; defaults to content-store pruneOlderThan. */
  prune?: typeof pruneOlderThan;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runOutputGc(input: RunOutputGcInput): Promise<0 | 1> {
  const prune = input.prune ?? pruneOlderThan;
  let days = DEFAULT_DAYS;
  if (input.days !== undefined) {
    const parsed = parseDays(input.days);
    if (parsed === null) {
      input.stderr("error: Invalid --days (integer 1-3650)");
      return 1;
    }
    days = parsed;
  }
  try {
    const { removed } = await prune({
      storeRoot: input.storeRoot,
      olderThan: new Date(input.now() - days * DAY_MS),
    });
    if (input.json) {
      input.stdout(JSON.stringify({ removed }));
    } else {
      input.stdout(`removed ${removed} chunk set(s)`);
    }
    return 0;
  } catch (error) {
    input.stderr(`error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

export const outputGcCommand = defineCommand({
  meta: {
    name: "gc",
    description: "Delete stored chunk sets older than the retention window (default 30 days).",
  },
  args: {
    days: { type: "string", description: "Retention in days (default 30)." },
    json: { type: "boolean", default: false, description: "Emit {removed} as JSON." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const storeRoot = resolveStorePath(readStoreEnv(typeof args.store === "string" ? args.store : undefined));
    const code = await runOutputGc({
      storeRoot,
      now: () => Date.now(),
      ...(typeof args.days === "string" ? { days: args.days } : {}),
      json: !!args.json,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

- [ ] **Step 4: Register** in `apps/cli/src/commands/output/index.ts`: import + `gc: outputGcCommand` in `subCommands` + re-export `{ type RunOutputGcInput, runOutputGc, outputGcCommand }`.
- [ ] **Step 5: Run, verify PASS** — gc tests + `pnpm --filter @megasaver/cli exec vitest run test/output/` + typecheck + biome. Smoke: `pnpm --filter @megasaver/cli build && node apps/cli/dist/cli.js output gc --help`.
- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/commands/output/gc.ts apps/cli/src/commands/output/index.ts apps/cli/test/output/gc.test.ts
git commit -m "feat(cli): mega output gc — manual retention sweep"
```

---

### Task 6: Integration, changeset, verify, smoke, wiki

**Files:**
- Test: extend `apps/cli/test/hooks/saver-roundtrip.test.ts`
- Create: `.changeset/saver-recovery-wave2.md`
- Modify: `wiki/log.md`

- [ ] **Step 1: Integration test** — add to `saver-roundtrip.test.ts` (uses its existing store fixture):

```ts
  it("C12+C14 end-to-end: multi-chunk fetch then gc removes the set", async () => {
    const raw = Array.from({ length: 200 }, (_, i) => `line ${i + 1}: build output`).join("\n");
    const recorded = await recordAndFilterOverlayOutput({
      storeRoot: store,
      workspaceKey: encodeWorkspaceKey("/Users/x/proj"),
      liveSessionId: "11111111-1111-4111-8111-111111111111",
      raw,
      sourceKind: "command",
      label: "pnpm verify",
      mode: "aggressive",
      storeRawOutput: true,
    });
    expect(recorded.chunkCount).toBe(5);
    const slice = await fetchChunk({
      storeRoot: store,
      chunkSetId: recorded.chunkSetId as string,
      chunkId: "3",
    });
    expect(slice.ok).toBe(true);
    if (slice.ok) {
      expect(slice.chunk.startLine).toBe(121);
      expect(slice.chunk.endLine).toBe(160);
      expect(slice.chunk.text).toContain("line 121: build output");
      expect(slice.chunk.text).not.toContain("line 161");
    }
    const { removed } = await pruneOlderThan({ storeRoot: store, olderThan: new Date(Date.now() + 1000) });
    expect(removed).toBeGreaterThanOrEqual(1);
    const gone = await fetchChunk({
      storeRoot: store,
      chunkSetId: recorded.chunkSetId as string,
      chunkId: "0",
    });
    expect(gone).toEqual({ ok: false, reason: "chunk_set_not_found" });
  });
```

(`pruneOlderThan` import from `@megasaver/content-store`.)

- [ ] **Step 2:** REBUILD DEPENDENCY CHAIN FIRST (the wave-1 stale-dist lesson): `pnpm --filter @megasaver/output-filter build && pnpm --filter @megasaver/content-store build && pnpm --filter @megasaver/context-gate build && pnpm --filter @megasaver/core build`, then run the roundtrip file. Then `pnpm verify > /tmp/verify-w2.log 2>&1; echo EXIT=$?` — must print `EXIT=0` (no pipe masking).
- [ ] **Step 3: Changeset** — `.changeset/saver-recovery-wave2.md`:

```md
---
"@megasaver/context-gate": minor
"@megasaver/content-store": patch
"@megasaver/cli": minor
---

Saver recovery wave 2: hook-compressed output is now stored as uniform
40-line chunks — the recovery footer advertises `N chunks` with a line→id
formula so an agent expands only the slice it needs instead of re-paying
for the whole raw. The content store self-cleans: `pruneOlderThan` now
recognizes overlay chunk sets (they previously leaked forever), removes
emptied directories, runs best-effort from the saver hook at most once a
day (30-day retention), and is available manually as `mega output gc
[--days N]`.
```

(If Task 2 added the `chunkByLines` re-export, add `"@megasaver/output-filter": patch`.)

- [ ] **Step 4: Smoke (capture)** — on the built CLI with a temp store: seed via a real compression (or reuse the roundtrip), then `node apps/cli/dist/cli.js output gc --days 0 --store <tmp>` → `removed N chunk set(s)`; `output gc --help` shows the command; fetch a middle chunk of a real multi-chunk set and show it returns only 40 lines.
- [ ] **Step 5: Wiki** — append a timestamped `wiki/log.md` entry: C12+C14 FIXED (wave 2, feat/saver-recovery, stacked on wave 1), evidence lines (verify EXIT=0, roundtrip, smoke), note that `wiki/syntheses/saver-savings-gaps.md` gets its C12/C14 FIXED marks on merge (page lives in main's working tree).
- [ ] **Step 6: Commit**

```bash
git add apps/cli/test/hooks/saver-roundtrip.test.ts .changeset/saver-recovery-wave2.md wiki/log.md
git commit -m "chore(release): saver recovery wave 2 changeset + wiki log"
```

---

### Task 7: Review gates (HIGH risk — both reviewers)

- [ ] **Step 1:** `code-reviewer` agent (fresh context) over `git diff 5b60b35c..HEAD`. Focus: deletion safety (can the pruner EVER remove a young set, an index file, the marker, or anything outside `content/`?), chunk-range contiguity (no line lost between chunks: chunk i endLine + 1 === chunk i+1 startLine), footer formula correctness vs `OVERLAY_CHUNK_LINES`, throttle race behavior.
- [ ] **Step 2:** `critic` agent (separate fresh context), adversarial: craft a store layout that tricks the pruner into deleting the wrong file; a raw whose chunking loses/duplicates a line (trailing newline! `"a\n"` → lines `["a",""]` — is the empty last line preserved in the final chunk and does the roundtrip reproduce the exact raw byte-for-byte when concatenating all chunks with `"\n"`?); clock skew vs the marker; two hooks racing the marker.
- [ ] **Step 3:** Fix findings RED-first; re-run `pnpm verify` (EXIT capture).
- [ ] **Step 4:** `superpowers:finishing-a-development-branch` — PR with base `feat/saver-coverage` (stacked; re-target to main after #276 merges, or merge in order).

---

## Self-review notes (plan time)

- Spec coverage: §1→Task 2; §2→Task 3; §3→Task 1; §4→Tasks 4+5; §5 edges→tests in Tasks 1/4/5; §6→every task + Task 6; non-goals untouched.
- Soft spots to verify on first touch: exact name/harness of the context-gate record-output test file; whether `chunkByLines` is exported from output-filter's index; the exact wave-1 footer strings (single-chunk wording must stay byte-identical); whether any existing evidence test pins `returnedChunkRefs`.
- Type consistency: `chunkCount?: number` optional everywhere (absent when `storeRawOutput: false`); `GcDeps.prune?: typeof pruneOlderThan` matches `RunOutputGcInput.prune?`; `OVERLAY_CHUNK_LINES = 40` is the single constant the footer formula text mirrors (a mismatch is a spec bug — Task 3's formula string hardcodes 40; add a comment in both places pointing at each other).
- Critic hint pre-answered: `chunkByLines` splits on `"\n"` and rejoins slices with `"\n"`; concatenating all chunk texts with `"\n"` reproduces the exact input (including a trailing empty line becoming the last line of the final chunk) — Task 7's critic should still verify byte-exactness empirically.
