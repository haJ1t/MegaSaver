# Code-Truth Verify (i6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Git-anchored memories that stale and heal — save-time file-blob + symbol-hash anchors, a deterministic verify engine that names the falsifying commit, contradiction → stale + validTo close (owned), heal on revert, surfaced through CLI verify/hook/sweep, MCP badges + Pro spot-check, and a savings ledger.

**Architecture:** New `packages/core/src/memory-anchor.ts` (schemas + async best-effort `captureCodeAnchor`) and `packages/core/src/code-truth.ts` (pure `verifyAnchors` planner + impure `runVerify` git runner, mirroring the `sweepMemoryTiers` pure/impure split). Symbol extraction reuses the output-filter polyglot dispatch (newly exported `extractBlocksForFile`); mutations flow through a new whole-batch `applyMemoryEntryPatches` registry operation. Contradiction = file deleted w/o rename ∨ cited symbol missing ∨ symbol contentHash changed — file-blob change alone NEVER contradicts. Heal reopens `validTo` only when `lastVerified.closedByCodeTruth` proves code-truth owns the close (architect B1). Spec: `docs/superpowers/specs/2026-07-13-code-truth-verify-design.md` (rev 2, architect pass applied).

**Tech Stack:** TypeScript strict ESM, Zod, Vitest, citty CLI, pnpm/Turborepo. Git via `execFile` (no shell), injectable `execGit` for tests.

**Base branch:** stacked on `feat/living-brain` (worktree `.claude/worktrees/living-brain`); retarget after PR #286 merges. Risk: HIGH (§12) — full gauntlet at the end (Task 18).

**Naming note (binding):** the registry interface in code is `CoreRegistry` (the spec/contract said "MemoryRegistry"; Task 5-7 define a `MemoryRegistry` Pick-alias in `code-truth.ts` for the runner's narrow dependency). `loadExtractors` is async — `captureCodeAnchor` and `extractBlocksForFile` are async throughout.

**Task map:** 1-4 core schemas/capture (Section A) · 5-7 verify engine + batch registry (Section B) · 8-13 CLI surfaces (Section C) · 14-17 MCP + stats/savings (Section D) · 18 release/evidence/gauntlet.

---
# Section A — Core anchor schemas, extraction export, ranking weight, capture (Tasks 1–4)

All commands run from the worktree root:
`/Users/halitozger/Desktop/MegaSaver/.claude/worktrees/living-brain`
(branch `feat/living-brain`).

**Environment hazards (apply to every task below):**

- Mega Saver MCP read-proxy SILENTLY TRUNCATES file reads (banner "N kept, M
  dropped" / "[Mega Saver: compressed...]") — read files via `sed -n 'A,Bp'`
  in <=60-line chunks, locate with `grep -n`. Never trust a proxied read.
- `pnpm build` BEFORE package tests (workspace deps resolve via `dist/`;
  output-filter's `no-eager-typescript.test.ts` imports `dist/index.js`
  directly).
- `pnpm --filter @megasaver/<pkg> test -- <pattern>` does NOT narrow — always
  run the whole package suite.
- Full `pnpm typecheck` REQUIRED before every commit — package vitest does NOT
  catch TS4111 (`noPropertyAccessFromIndexSignature`). If it fires, use bracket
  access + `// biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)`.
- tsconfig is `strict` with `exactOptionalPropertyTypes` — never assign an
  explicit `undefined` to an optional property; use conditional spreads
  (`...(x !== undefined ? { x } : {})`), exactly as the code below does.
- Branded IDs: raw UUID string literals in tests need `as ProjectId` /
  `as MemoryEntryId` / `as SessionId` casts (types from `@megasaver/shared`).
- Core tests live in `packages/core/test/` (NOT `src/__tests__`), imported via
  relative `../src/<module>.js` paths. Output-filter tests live in
  `packages/output-filter/test/`.

---

### Task 1: Anchor schemas (`memory-anchor.ts`) + `anchor`/`lastVerified` on all three memory-entry shapes

Creates `packages/core/src/memory-anchor.ts` with the five contract schemas
(`fileAnchorSchema`, `symbolAnchorSchema`, `codeAnchorSchema`,
`verificationResultSchema`, `lastVerifiedSchema`) and threads
`anchor`/`lastVerified` as optional fields through ALL THREE memory-entry
shapes: `memoryEntrySchema`, `overlayMemoryEntrySchema`, and
`memoryEntryUpdatePatchSchema`. All three are `.strict()` and
`updateMemoryEntry` re-parses the full entry — omitting the patch/overlay
additions turns every later verify mutation into a runtime Zod rejection
(spec §4, architect N1). `overlayMemoryEntryUpdatePatchSchema` is a literal
alias of `memoryEntryUpdatePatchSchema` (memory-entry.ts:357), so patching
the base patch schema covers the overlay patch automatically.

**Files:**

- Create: `packages/core/src/memory-anchor.ts`
- Modify: `packages/core/src/memory-entry.ts`
- Modify: `packages/core/src/index.ts`
- Create (test): `packages/core/test/memory-anchor.test.ts`

**Steps:**

- [ ] **Step 1: Confirm the worktree.**
  `cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/living-brain && git branch --show-current`
  must print `feat/living-brain`. If not, stop and report — this section
  builds only on that branch.

- [ ] **Step 2: Confirm the three insertion points (chunked reads, no proxy).**
  `grep -n 'tier: memoryTierSchema.optional()' packages/core/src/memory-entry.ts`
  must print exactly three hits (~lines 114, 297, 347): the memoryEntrySchema
  object, the overlayMemoryEntrySchema object, and the update-patch object.
  Also `grep -n 'strict' packages/core/src/memory-entry.ts` — `.strict()` at
  ~116 and ~299 (both BEFORE their `.superRefine`) and ~350 (last call on the
  patch schema). If the shapes have drifted, report instead of guessing.

- [ ] **Step 3: Write the failing test.** Create
  `packages/core/test/memory-anchor.test.ts` with exactly:

```ts
import type { MemoryEntryId, ProjectId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import {
  codeAnchorSchema,
  fileAnchorSchema,
  lastVerifiedSchema,
  symbolAnchorSchema,
  verificationResultSchema,
} from "../src/memory-anchor.js";
import {
  type MemoryEntry,
  memoryEntrySchema,
  memoryEntryUpdatePatchSchema,
  overlayMemoryEntrySchema,
} from "../src/memory-entry.js";
import { createInMemoryCoreRegistry } from "../src/registry.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const ENTRY_ID = "00000000-0000-4000-8000-0000000000a1" as MemoryEntryId;
const TS = "2026-07-13T00:00:00.000Z";
const NOW = "2026-07-13T12:00:00.000Z";

const ANCHOR = {
  repoHead: "3f786850e387550fdab836ed7e6dc881de23001b",
  capturedAt: TS,
  files: [{ path: "src/a.ts", blobSha: "89e6c98d92887913cadf06b2adb97f26cde4849b" }],
  symbols: [
    {
      path: "src/a.ts",
      name: "alpha",
      startLine: 1,
      endLine: 3,
      contentHash: "2b66fd261ee5c6cfc8de7fa466bab600bcfe4f69",
    },
  ],
};

const LAST_VERIFIED = {
  headSha: "3f786850e387550fdab836ed7e6dc881de23001b",
  at: NOW,
  result: "verified" as const,
  closedByCodeTruth: false,
};

function baseEntry(): Record<string, unknown> {
  return {
    id: ENTRY_ID,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "auth uses jwt",
    content: "auth uses jwt",
    keywords: [],
    confidence: "medium",
    source: "manual",
    approval: "approved",
    stale: false,
    createdAt: TS,
    updatedAt: TS,
  };
}

describe("memory-anchor schemas", () => {
  it("parses file, symbol, and code anchors", () => {
    expect(fileAnchorSchema.parse(ANCHOR.files[0])).toEqual(ANCHOR.files[0]);
    expect(symbolAnchorSchema.parse(ANCHOR.symbols[0])).toEqual(ANCHOR.symbols[0]);
    expect(codeAnchorSchema.parse(ANCHOR)).toEqual(ANCHOR);
  });

  it("rejects unknown keys on every anchor shape (strict)", () => {
    expect(fileAnchorSchema.safeParse({ ...ANCHOR.files[0], bogus: 1 }).success).toBe(false);
    expect(symbolAnchorSchema.safeParse({ ...ANCHOR.symbols[0], bogus: 1 }).success).toBe(false);
    expect(codeAnchorSchema.safeParse({ ...ANCHOR, bogus: 1 }).success).toBe(false);
  });

  it("rejects non-positive line numbers on symbol anchors", () => {
    expect(
      symbolAnchorSchema.safeParse({ ...ANCHOR.symbols[0], startLine: 0 }).success,
    ).toBe(false);
  });

  it("verificationResultSchema admits exactly verified|contradicted|healed", () => {
    expect(verificationResultSchema.parse("verified")).toBe("verified");
    expect(verificationResultSchema.parse("contradicted")).toBe("contradicted");
    expect(verificationResultSchema.parse("healed")).toBe("healed");
    expect(verificationResultSchema.safeParse("stale").success).toBe(false);
  });

  it("lastVerifiedSchema requires closedByCodeTruth and rejects unknown keys", () => {
    expect(lastVerifiedSchema.parse(LAST_VERIFIED)).toEqual(LAST_VERIFIED);
    const { closedByCodeTruth: _drop, ...missing } = LAST_VERIFIED;
    expect(lastVerifiedSchema.safeParse(missing).success).toBe(false);
    expect(lastVerifiedSchema.safeParse({ ...LAST_VERIFIED, bogus: 1 }).success).toBe(false);
  });
});

describe("memory entry anchor fields", () => {
  it("memoryEntrySchema round-trips anchor + lastVerified", () => {
    const entry = memoryEntrySchema.parse({
      ...baseEntry(),
      anchor: ANCHOR,
      lastVerified: LAST_VERIFIED,
    });
    expect(entry.anchor).toEqual(ANCHOR);
    expect(entry.lastVerified).toEqual(LAST_VERIFIED);
  });

  it("legacy row without anchor fields still parses (additive)", () => {
    const entry = memoryEntrySchema.parse(baseEntry());
    expect(entry.anchor).toBeUndefined();
    expect(entry.lastVerified).toBeUndefined();
  });

  it("memoryEntrySchema still rejects unknown keys (strict regression)", () => {
    expect(memoryEntrySchema.safeParse({ ...baseEntry(), bogus: 1 }).success).toBe(false);
  });

  it("overlayMemoryEntrySchema accepts anchor + lastVerified and stays strict", () => {
    const overlay = {
      ...baseEntry(),
      workspaceKey: "ws-1",
      liveSessionId: null,
      anchor: ANCHOR,
      lastVerified: LAST_VERIFIED,
    };
    const { projectId: _p, sessionId: _s, ...overlayRow } = overlay;
    const parsed = overlayMemoryEntrySchema.parse(overlayRow);
    expect(parsed.anchor).toEqual(ANCHOR);
    expect(parsed.lastVerified).toEqual(LAST_VERIFIED);
    expect(overlayMemoryEntrySchema.safeParse({ ...overlayRow, bogus: 1 }).success).toBe(false);
  });

  it("update patch accepts anchor + lastVerified and still rejects unknown keys", () => {
    const patch = memoryEntryUpdatePatchSchema.parse({
      anchor: ANCHOR,
      lastVerified: LAST_VERIFIED,
      updatedAt: NOW,
    });
    expect(patch.anchor).toEqual(ANCHOR);
    expect(patch.lastVerified).toEqual(LAST_VERIFIED);
    expect(
      memoryEntryUpdatePatchSchema.safeParse({ updatedAt: NOW, bogus: 1 }).success,
    ).toBe(false);
  });

  it("registry updateMemoryEntry persists an anchor patch (full-entry re-parse)", () => {
    const registry = createInMemoryCoreRegistry();
    registry.createProject({
      id: PROJECT_ID,
      name: "demo",
      rootPath: "/tmp/demo",
      createdAt: TS,
      updatedAt: TS,
    });
    registry.createMemoryEntry(memoryEntrySchema.parse(baseEntry()) as MemoryEntry);
    registry.updateMemoryEntry(ENTRY_ID, {
      anchor: ANCHOR,
      lastVerified: LAST_VERIFIED,
      updatedAt: NOW,
    });
    const stored = registry.getMemoryEntry(ENTRY_ID);
    expect(stored?.anchor).toEqual(ANCHOR);
    expect(stored?.lastVerified).toEqual(LAST_VERIFIED);
  });
});
```

- [ ] **Step 4: Run to verify FAIL.**
  `cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/living-brain && pnpm build && pnpm --filter @megasaver/core test`
  Expected: `test/memory-anchor.test.ts` fails to load with a
  module-resolution error — `Failed to resolve import "../src/memory-anchor.js"`
  (the module does not exist yet). All pre-existing core tests stay green.

- [ ] **Step 5: Minimal implementation.** Create
  `packages/core/src/memory-anchor.ts` with exactly:

```ts
import { z } from "zod";

export const fileAnchorSchema = z
  .object({
    path: z.string().min(1), // repo-relative, POSIX separators
    blobSha: z.string().min(1), // git blob SHA at capture
  })
  .strict();
export type FileAnchor = z.infer<typeof fileAnchorSchema>;

export const symbolAnchorSchema = z
  .object({
    path: z.string().min(1),
    name: z.string().min(1),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    contentHash: z.string().min(1), // indexer hashText over the block span
  })
  .strict();
export type SymbolAnchor = z.infer<typeof symbolAnchorSchema>;

export const codeAnchorSchema = z
  .object({
    repoHead: z.string().min(1), // HEAD sha at capture
    capturedAt: z.string().datetime({ offset: true }),
    files: z.array(fileAnchorSchema),
    symbols: z.array(symbolAnchorSchema),
  })
  .strict();
export type CodeAnchor = z.infer<typeof codeAnchorSchema>;

export const verificationResultSchema = z.enum(["verified", "contradicted", "healed"]);
export type VerificationResult = z.infer<typeof verificationResultSchema>;

export const lastVerifiedSchema = z
  .object({
    headSha: z.string().min(1),
    at: z.string().datetime({ offset: true }),
    result: verificationResultSchema,
    // Close ownership (architect B1): true ONLY when the contradiction
    // mutation itself closed validTo (found the row open). Heal may reopen
    // validTo only when this is true — a close owned by the lineage channel
    // (supersession, manual close) is never stomped by a code-truth heal.
    closedByCodeTruth: z.boolean(),
  })
  .strict();
export type LastVerified = z.infer<typeof lastVerifiedSchema>;
```

- [ ] **Step 6: Thread the fields through `packages/core/src/memory-entry.ts`.**
  Four edits. First, add the import after the existing `zod` import (line ~13,
  after `import { z } from "zod";`):

```ts
import { codeAnchorSchema, lastVerifiedSchema } from "./memory-anchor.js";
```

  Second — `memoryEntrySchema` (the object whose `.superRefine` checks
  `entry.sessionId`). Replace:

```ts
    // M2 tier. Absent ⇒ recall (see memoryTierSchema). Only the explicit sweep
    // mutates it; recall hides `archival` by default.
    tier: memoryTierSchema.optional(),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (entry.scope === "session" && entry.sessionId === null) {
```

  with:

```ts
    // M2 tier. Absent ⇒ recall (see memoryTierSchema). Only the explicit sweep
    // mutates it; recall hides `archival` by default.
    tier: memoryTierSchema.optional(),
    // Code-truth (i6): git anchor captured at save + verification stamp.
    // Optional + additive — legacy rows parse untouched.
    anchor: codeAnchorSchema.optional(),
    lastVerified: lastVerifiedSchema.optional(),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (entry.scope === "session" && entry.sessionId === null) {
```

  Third — `overlayMemoryEntrySchema` (the object whose `.superRefine` checks
  `entry.liveSessionId`). Replace:

```ts
    // M2 tier. Absent ⇒ recall (see memoryTierSchema). Only the explicit sweep
    // mutates it; recall hides `archival` by default.
    tier: memoryTierSchema.optional(),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (entry.scope === "session" && entry.liveSessionId === null) {
```

  with:

```ts
    // M2 tier. Absent ⇒ recall (see memoryTierSchema). Only the explicit sweep
    // mutates it; recall hides `archival` by default.
    tier: memoryTierSchema.optional(),
    // Code-truth (i6): git anchor captured at save + verification stamp.
    // Optional + additive — legacy rows parse untouched.
    anchor: codeAnchorSchema.optional(),
    lastVerified: lastVerifiedSchema.optional(),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (entry.scope === "session" && entry.liveSessionId === null) {
```

  Fourth — `memoryEntryUpdatePatchSchema` (the object ending in `updatedAt` +
  bare `.strict();`). Replace:

```ts
    // tier is patchable so `mega memory sweep` can demote a memory to archival.
    tier: memoryTierSchema.optional(),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();
```

  with:

```ts
    // tier is patchable so `mega memory sweep` can demote a memory to archival.
    tier: memoryTierSchema.optional(),
    // anchor/lastVerified are patchable so code-truth verify can stamp results
    // and repoint renamed paths (updateMemoryEntry re-parses the full entry —
    // omitting these here would make every verify mutation a Zod rejection).
    anchor: codeAnchorSchema.optional(),
    lastVerified: lastVerifiedSchema.optional(),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();
```

- [ ] **Step 7: Export from `packages/core/src/index.ts`.** Insert one line
  before the named `from "./memory-entry.js"` export block (i.e. after
  `export * from "./json-directory-registry.js";`, line ~16):

```ts
export * from "./memory-anchor.js";
```

- [ ] **Step 8: Run to verify PASS.**
  `cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/living-brain && pnpm build && pnpm --filter @megasaver/core test`
  Expected: all core tests pass, including the 11 new ones in
  `memory-anchor.test.ts`. No pre-existing test may change.

- [ ] **Step 9: Full gates.**
  `pnpm lint:fix && pnpm typecheck` — both clean (TS4111 only surfaces here).

- [ ] **Step 10: Commit.**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/living-brain && \
git add packages/core/src/memory-anchor.ts packages/core/src/memory-entry.ts \
  packages/core/src/index.ts packages/core/test/memory-anchor.test.ts && \
git commit -m "feat(core): memory anchor + lastVerified schemas"
```

---

### Task 2: `extractBlocksForFile` public export from `@megasaver/output-filter`

The polyglot per-file extractor dispatch (`extractorFor`,
`packages/output-filter/src/parsers/outline.ts:15-26`) is module-private
today; nothing at the package surface exposes per-file `ExtractedBlock[]`
extraction. Task 4's `captureCodeAnchor` (in core, which already depends on
output-filter — `packages/core/package.json:30` — so NO new dependency edge)
needs it. This task adds the contract wrapper:

```ts
export async function extractBlocksForFile(path: string, source: string): Promise<ExtractedBlock[] | undefined>
```

`loadExtractors` (semantic.ts:18) is ASYNC — it lazily `await import`s
`@megasaver/indexer` so the multi-MB typescript compiler never loads on a
plain output-filter import. The wrapper must stay lazy: the existing
`no-eager-typescript.test.ts` regression guard imports `dist/index.js` in a
child process and fails if typescript ever loads eagerly. Do NOT add any
static VALUE import of `@megasaver/indexer` — type-only imports are fine
(erased at compile time).

**Files:**

- Modify: `packages/output-filter/src/parsers/outline.ts`
- Modify: `packages/output-filter/src/index.ts`
- Create (test): `packages/output-filter/test/extract-blocks.test.ts`

**Steps:**

- [ ] **Step 1: Confirm the private dispatch.**
  `grep -n 'extractorFor\|loadExtractors' packages/output-filter/src/parsers/outline.ts`
  — expect `extractorFor` defined at ~line 15 (module-local, dispatches
  mts|cts|tsx|jsx|ts|js|mjs|cjs → extractTs, .py → extractPy, .go → extractGo,
  .rs → extractRs, .md → extractMd, .json → extractJson, else undefined) and
  `loadExtractors` imported from `./semantic.js` at line ~3.

- [ ] **Step 2: Write the failing test.** Create
  `packages/output-filter/test/extract-blocks.test.ts` with exactly:

```ts
import { describe, expect, it } from "vitest";
import { extractBlocksForFile } from "../src/index.js";

const TS_SOURCE = `export function alpha(a: number): number {
  return a + 1;
}

export function beta(): void {}
`;

const PY_SOURCE = `def alpha(a):
    return a + 1

class Beta:
    def run(self):
        return 2
`;

describe("extractBlocksForFile", () => {
  it("extracts named TS blocks with contentHash and line spans", async () => {
    const blocks = await extractBlocksForFile("src/a.ts", TS_SOURCE);
    expect(blocks).toBeDefined();
    const alpha = blocks?.find((b) => b.name === "alpha");
    expect(alpha).toBeDefined();
    expect((alpha?.contentHash.length ?? 0) > 0).toBe(true);
    expect(alpha?.startLine).toBeGreaterThan(0);
    expect(alpha?.endLine).toBeGreaterThanOrEqual(alpha?.startLine ?? Number.MAX_SAFE_INTEGER);
  });

  it("dispatches Python sources to the py extractor", async () => {
    const blocks = await extractBlocksForFile("src/b.py", PY_SOURCE);
    expect(blocks?.some((b) => b.name === "alpha")).toBe(true);
    expect(blocks?.some((b) => b.name === "Beta")).toBe(true);
  });

  it("returns undefined for an unsupported extension", async () => {
    expect(await extractBlocksForFile("notes.txt", "hello world")).toBeUndefined();
  });

  it("returns undefined for an extensionless path", async () => {
    expect(await extractBlocksForFile("Makefile", "all:\n\techo hi")).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run to verify FAIL.**
  `cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/living-brain && pnpm build && pnpm --filter @megasaver/output-filter test`
  Expected: `test/extract-blocks.test.ts` fails with a missing-export error
  (`No matching export in "src/index.ts" for import "extractBlocksForFile"` /
  "does not provide an export named 'extractBlocksForFile'"). All other
  output-filter tests (including `no-eager-typescript.test.ts`) stay green.

- [ ] **Step 4: Minimal implementation.** Append to the END of
  `packages/output-filter/src/parsers/outline.ts` (the file already imports
  `type { ExtractedBlock } from "@megasaver/indexer"` at line 1 and
  `loadExtractors` from `./semantic.js` at line 3):

```ts
// Public polyglot per-file extraction (code-truth anchor capture, i6). Wraps
// the private dispatch above: undefined = unsupported extension, so the
// caller falls back to file-level anchors. Async only because the indexer
// (and its typescript dep) loads lazily — never import it eagerly here.
export async function extractBlocksForFile(
  path: string,
  source: string,
): Promise<ExtractedBlock[] | undefined> {
  const extractor = extractorFor(path, await loadExtractors());
  if (extractor === undefined) return undefined;
  return extractor(path, source);
}
```

  Then append to the END of `packages/output-filter/src/index.ts`:

```ts
export { extractBlocksForFile } from "./parsers/outline.js";
// Type-only re-export (erased at runtime — the no-eager-typescript guard
// stays intact): lets @megasaver/core type anchor capture without adding a
// core -> indexer dependency edge.
export type { ExtractedBlock } from "@megasaver/indexer";
```

- [ ] **Step 5: Run to verify PASS.**
  `cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/living-brain && pnpm build && pnpm --filter @megasaver/output-filter test`
  Expected: all output-filter tests pass — the 4 new ones AND
  `no-eager-typescript.test.ts` (proves the wrapper stayed lazy).

- [ ] **Step 6: Full gates.**
  `pnpm lint:fix && pnpm typecheck` — both clean.

- [ ] **Step 7: Commit.**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/living-brain && \
git add packages/output-filter/src/parsers/outline.ts \
  packages/output-filter/src/index.ts \
  packages/output-filter/test/extract-blocks.test.ts && \
git commit -m "feat(output-filter): export extractBlocksForFile"
```

---

### Task 3: `STALE_WEIGHT = 0.3` in `effectiveConfidence`

Adds the exported const `STALE_WEIGHT = 0.3` and multiplies it in when
`memory.stale === true` (spec §9). The function's `Pick` gains `"stale"` —
safe: every existing call site (`memory-search.ts:103`, `warm-start.ts:84`,
and the decay tests) passes a full `MemoryEntry`. Honesty note (architect
M4): both agent-recall rankers EXCLUDE stale rows before ranking
(`memory-search.ts:65` `includeStale` default false;
`get-relevant-memories.ts:71`), so this weight only fires on human
`includeStale` surfaces (CLI list/search) — stale rows sort to the bottom
instead of ranking as if healthy. **Non-stale rows MUST rank bit-identically
to today** — the implementation keeps the exact multiplication order and only
appends the stale multiply; the existing snapshot equalities in
`packages/core/test/memory-search-decay.test.ts` must not change.

**Files:**

- Modify: `packages/core/src/memory-entry.ts`
- Modify: `packages/core/src/index.ts`
- Create (test): `packages/core/test/memory-stale-weight.test.ts`

**Steps:**

- [ ] **Step 1: Confirm the current function (chunked read).**
  `sed -n '206,225p' packages/core/src/memory-entry.ts` — the `Pick` must be
  `"confidence" | "tier" | "createdAt" | "updatedAt" | "lastActiveAt"` and the
  return `CONFIDENCE_WEIGHT[memory.confidence] * factor * TIER_WEIGHT[tierOf(memory)]`.
  (Line numbers shift by +5 after Task 1's additions — locate with
  `grep -n 'export function effectiveConfidence' packages/core/src/memory-entry.ts`
  if the sed window misses.)

- [ ] **Step 2: Write the failing test.** Create
  `packages/core/test/memory-stale-weight.test.ts` with exactly:

```ts
import type { ProjectId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import {
  type MemoryEntry,
  STALE_WEIGHT,
  effectiveConfidence,
  memoryEntrySchema,
} from "../src/memory-entry.js";
import { searchMemoryEntries } from "../src/memory-search.js";

const PROJECT = "00000000-0000-4000-8000-000000000001" as ProjectId;
const NOW = "2026-07-13T00:00:00.000Z";
// exactly one 30-day half-life before NOW
const THIRTY_DAYS_AGO = "2026-06-13T00:00:00.000Z";

function entry(
  over: Omit<Partial<MemoryEntry>, "id"> & { id: string; content: string },
): MemoryEntry {
  return memoryEntrySchema.parse({
    id: over.id,
    projectId: PROJECT,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: over.title ?? over.content,
    content: over.content,
    keywords: over.keywords ?? [],
    confidence: over.confidence ?? "medium",
    source: "manual",
    approval: "approved",
    stale: over.stale ?? false,
    createdAt: over.createdAt ?? NOW,
    updatedAt: over.updatedAt ?? NOW,
    ...(over.lastActiveAt !== undefined ? { lastActiveAt: over.lastActiveAt } : {}),
  });
}

describe("STALE_WEIGHT", () => {
  it("is 0.3", () => {
    expect(STALE_WEIGHT).toBe(0.3);
  });

  it("a stale row scores exactly STALE_WEIGHT x its non-stale twin", () => {
    const fresh = entry({ id: "00000000-0000-4000-8000-0000000000a1", content: "auth uses jwt" });
    const stale = entry({
      id: "00000000-0000-4000-8000-0000000000a2",
      content: "auth uses jwt",
      stale: true,
    });
    expect(effectiveConfidence(stale, NOW)).toBe(effectiveConfidence(fresh, NOW) * STALE_WEIGHT);
    expect(effectiveConfidence(stale, NOW)).toBeLessThan(effectiveConfidence(fresh, NOW));
  });

  it("non-stale rows keep the exact pre-change values (bit-identical)", () => {
    // medium (0.67) x zero-age decay (1) x default recall tier (1)
    const zeroAge = entry({
      id: "00000000-0000-4000-8000-0000000000b1",
      content: "x",
      lastActiveAt: NOW,
    });
    expect(effectiveConfidence(zeroAge, NOW)).toBe(0.67);
    // medium (0.67) x exactly one half-life (0.5) x recall (1)
    const halfLife = entry({
      id: "00000000-0000-4000-8000-0000000000b2",
      content: "x",
      createdAt: THIRTY_DAYS_AGO,
      updatedAt: THIRTY_DAYS_AGO,
      lastActiveAt: THIRTY_DAYS_AGO,
    });
    expect(effectiveConfidence(halfLife, NOW)).toBe(0.67 * 0.5);
  });

  it("includeStale search ranks the stale twin below the non-stale row", () => {
    const fresh = entry({
      id: "00000000-0000-4000-8000-0000000000c1",
      content: "redis cache invalidation strategy",
    });
    const stale = entry({
      id: "00000000-0000-4000-8000-0000000000c2",
      content: "redis cache invalidation strategy",
      stale: true,
    });
    const result = searchMemoryEntries([stale, fresh], {
      text: "redis cache invalidation",
      includeStale: true,
      asOf: NOW,
    });
    expect(result.map((e) => e.id)).toEqual([fresh.id, stale.id]);
  });
});
```

- [ ] **Step 3: Run to verify FAIL.**
  `cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/living-brain && pnpm build && pnpm --filter @megasaver/core test`
  Expected: `test/memory-stale-weight.test.ts` fails at load with a
  missing-export error for `STALE_WEIGHT` from `../src/memory-entry.js`.
  Everything else stays green.

- [ ] **Step 4: Minimal implementation.** In
  `packages/core/src/memory-entry.ts`, replace the current function (the
  block found in Step 1):

```ts
export function effectiveConfidence(
  memory: Pick<MemoryEntry, "confidence" | "tier" | "createdAt" | "updatedAt" | "lastActiveAt">,
  now: string,
): number {
  const at = Date.parse(now);
  const ref = Date.parse(memory.lastActiveAt ?? memory.updatedAt ?? memory.createdAt);
  // A NaN from either parse ⇒ no decay (factor 1) rather than a NaN weight that
  // would corrupt the ranking sort. Ranking degrades gracefully; it never breaks.
  const factor = Number.isNaN(at) || Number.isNaN(ref) ? 1 : ageDecay(at - ref);
  return CONFIDENCE_WEIGHT[memory.confidence] * factor * TIER_WEIGHT[tierOf(memory)];
}
```

  with:

```ts
// Code-truth (i6): stale rows are down-weighted so human includeStale
// surfaces (CLI list/search) sort them to the bottom. Agent rankers exclude
// stale rows before ranking, so this never fires on the agent path (§9).
export const STALE_WEIGHT = 0.3;

export function effectiveConfidence(
  memory: Pick<
    MemoryEntry,
    "confidence" | "tier" | "createdAt" | "updatedAt" | "lastActiveAt" | "stale"
  >,
  now: string,
): number {
  const at = Date.parse(now);
  const ref = Date.parse(memory.lastActiveAt ?? memory.updatedAt ?? memory.createdAt);
  // A NaN from either parse ⇒ no decay (factor 1) rather than a NaN weight that
  // would corrupt the ranking sort. Ranking degrades gracefully; it never breaks.
  const factor = Number.isNaN(at) || Number.isNaN(ref) ? 1 : ageDecay(at - ref);
  // Same multiplication order as before the stale multiply was appended, so
  // non-stale rows rank bit-identically to the pre-code-truth build.
  const base = CONFIDENCE_WEIGHT[memory.confidence] * factor * TIER_WEIGHT[tierOf(memory)];
  return memory.stale ? base * STALE_WEIGHT : base;
}
```

  Then in `packages/core/src/index.ts`, add `STALE_WEIGHT,` to the named
  export block `from "./memory-entry.js"`, directly after the
  `DEFAULT_SWEEP_POLICY,` line:

```ts
export {
  DEFAULT_SWEEP_POLICY,
  STALE_WEIGHT,
  type MemoryApproval,
```

- [ ] **Step 5: Run to verify PASS.**
  `cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/living-brain && pnpm build && pnpm --filter @megasaver/core test`
  Expected: all core tests pass — the 4 new ones AND every pre-existing test
  in `memory-search-decay.test.ts` unchanged (the bit-identical guarantee).

- [ ] **Step 6: Full gates.**
  `pnpm lint:fix && pnpm typecheck` — both clean.

- [ ] **Step 7: Commit.**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/living-brain && \
git add packages/core/src/memory-entry.ts packages/core/src/index.ts \
  packages/core/test/memory-stale-weight.test.ts && \
git commit -m "feat(core): stale weight in effectiveConfidence"
```

---

### Task 4: `captureCodeAnchor` — best-effort git anchor capture

Adds the capture function to `packages/core/src/memory-anchor.ts` (Task 1's
file). Contract signature:

```ts
export async function captureCodeAnchor(opts: {
  rootPath: string;
  relatedFiles?: readonly string[];
  relatedSymbols?: readonly string[];
  now: string;                                        // injected clock
  execGit?: (args: string[], cwd: string) => string;  // injectable for tests
}): Promise<CodeAnchor | undefined>
```

Spec §5 rules, ALL enforced here:

- **Best-effort TOTAL:** any failure (not a git repo, git missing, extractor
  throw, bad `now`) ⇒ `undefined`; capture never throws, never blocks a save.
- Paths normalized to repo-relative POSIX before any git call; inputs that
  normalize outside `rootPath` are skipped; paths containing newlines/control
  characters are rejected before reaching a git argv (architect N3/N4).
- Git spawned via `execFile` (no shell), argv arrays, path-taking calls use
  the `HEAD:` prefix so a leading-dash path can never parse as a flag
  (precedent: `apps/cli/src/git-delta.ts` — injectable `ExecGit`,
  `execFileSync` argv arrays, 3s timeout).
- Untracked files (no blob at HEAD — `rev-parse HEAD:<path>` fails) are
  skipped from `files`.
- Symbols extracted from CURRENT worktree file content (disk read, §6.4) via
  `extractBlocksForFile` (Task 2). Two forms: `path#name` (explicit file) and
  bare `name` (searched across all `relatedFiles`). No match ⇒ symbol skipped.
- **Capture-side collision (architect N2):** more than one candidate block
  matching the name (within the file, or across candidate files for a bare
  name) ⇒ skip that symbol — ambiguity never anchors.
- Nothing anchored (`files` AND `symbols` empty) ⇒ `undefined`.

**Files:**

- Modify: `packages/core/src/memory-anchor.ts`
- Create (test): `packages/core/test/memory-anchor-capture.test.ts`

**Steps:**

- [ ] **Step 1: Write the failing test.** Create
  `packages/core/test/memory-anchor-capture.test.ts` with exactly:

```ts
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { captureCodeAnchor } from "../src/memory-anchor.js";

const NOW = "2026-07-13T12:00:00.000Z";

const TS_SOURCE = `export function alpha(a: number): number {
  return a + 1;
}

export function beta(): void {}
`;

// two top-level defs sharing a name -> the py extractor emits two blocks
// named "dup" (capture-side collision fixture, architect N2)
const PY_DUP_SOURCE = `def dup(a):
    return a + 1

def dup(b):
    return b + 2
`;

function fakeGit(map: Record<string, string>) {
  return (args: string[], _cwd: string): string => {
    const key = args.join(" ");
    const out = map[key];
    if (out === undefined) throw new Error(`fake git rejects: ${key}`);
    return out;
  };
}

describe("captureCodeAnchor (fake git)", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "megasaver-anchor-unit-"));
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "a.ts"), TS_SOURCE);
    writeFileSync(join(root, "src", "d.py"), PY_DUP_SOURCE);
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("anchors a tracked related file with repoHead + blobSha + capturedAt", async () => {
    const anchor = await captureCodeAnchor({
      rootPath: root,
      relatedFiles: ["src/a.ts"],
      now: NOW,
      execGit: fakeGit({
        "rev-parse HEAD": "headsha1\n",
        "rev-parse HEAD:src/a.ts": "blobsha1\n",
      }),
    });
    expect(anchor).toEqual({
      repoHead: "headsha1",
      capturedAt: NOW,
      files: [{ path: "src/a.ts", blobSha: "blobsha1" }],
      symbols: [],
    });
  });

  it("returns undefined when rev-parse HEAD fails (not a git repo)", async () => {
    const anchor = await captureCodeAnchor({
      rootPath: root,
      relatedFiles: ["src/a.ts"],
      now: NOW,
      execGit: fakeGit({}),
    });
    expect(anchor).toBeUndefined();
  });

  it("skips untracked files; nothing anchored -> undefined", async () => {
    const anchor = await captureCodeAnchor({
      rootPath: root,
      relatedFiles: ["src/new.ts"],
      now: NOW,
      execGit: fakeGit({ "rev-parse HEAD": "headsha1\n" }),
    });
    expect(anchor).toBeUndefined();
  });

  it("normalizes absolute in-root inputs to repo-relative POSIX", async () => {
    const anchor = await captureCodeAnchor({
      rootPath: root,
      relatedFiles: [join(root, "src", "a.ts")],
      now: NOW,
      execGit: fakeGit({
        "rev-parse HEAD": "headsha1\n",
        "rev-parse HEAD:src/a.ts": "blobsha1\n",
      }),
    });
    expect(anchor?.files).toEqual([{ path: "src/a.ts", blobSha: "blobsha1" }]);
  });

  it("skips escaping paths and control-character paths (N3/N4)", async () => {
    const anchor = await captureCodeAnchor({
      rootPath: root,
      relatedFiles: ["../outside.ts", "src/a\nb.ts", "/etc/passwd"],
      now: NOW,
      execGit: fakeGit({ "rev-parse HEAD": "headsha1\n" }),
    });
    expect(anchor).toBeUndefined();
  });

  it("anchors a path#name symbol from current file content", async () => {
    const anchor = await captureCodeAnchor({
      rootPath: root,
      relatedSymbols: ["src/a.ts#alpha"],
      now: NOW,
      execGit: fakeGit({ "rev-parse HEAD": "headsha1\n" }),
    });
    expect(anchor?.symbols).toHaveLength(1);
    const sym = anchor?.symbols[0];
    expect(sym?.path).toBe("src/a.ts");
    expect(sym?.name).toBe("alpha");
    expect((sym?.contentHash.length ?? 0) > 0).toBe(true);
    expect(sym?.startLine).toBeGreaterThan(0);
    expect(sym?.endLine).toBeGreaterThanOrEqual(sym?.startLine ?? Number.MAX_SAFE_INTEGER);
  });

  it("resolves a bare symbol name across relatedFiles", async () => {
    const anchor = await captureCodeAnchor({
      rootPath: root,
      relatedFiles: ["src/a.ts"],
      relatedSymbols: ["beta"],
      now: NOW,
      execGit: fakeGit({
        "rev-parse HEAD": "headsha1\n",
        "rev-parse HEAD:src/a.ts": "blobsha1\n",
      }),
    });
    expect(anchor?.symbols.map((s) => s.name)).toEqual(["beta"]);
  });

  it("skips a name-colliding symbol at capture (N2), keeps the file anchor", async () => {
    const anchor = await captureCodeAnchor({
      rootPath: root,
      relatedFiles: ["src/d.py"],
      relatedSymbols: ["src/d.py#dup"],
      now: NOW,
      execGit: fakeGit({
        "rev-parse HEAD": "headsha1\n",
        "rev-parse HEAD:src/d.py": "blobsha2\n",
      }),
    });
    expect(anchor?.files).toEqual([{ path: "src/d.py", blobSha: "blobsha2" }]);
    expect(anchor?.symbols).toEqual([]);
  });

  it("skips an unknown symbol name without failing the capture", async () => {
    const anchor = await captureCodeAnchor({
      rootPath: root,
      relatedFiles: ["src/a.ts"],
      relatedSymbols: ["nope"],
      now: NOW,
      execGit: fakeGit({
        "rev-parse HEAD": "headsha1\n",
        "rev-parse HEAD:src/a.ts": "blobsha1\n",
      }),
    });
    expect(anchor?.files).toHaveLength(1);
    expect(anchor?.symbols).toEqual([]);
  });
});

describe("captureCodeAnchor (real git repo)", () => {
  let repo: string;

  function git(args: string[], cwd: string): string {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  }

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "megasaver-anchor-repo-"));
    git(["init"], repo);
    git(["config", "user.email", "t@t"], repo);
    git(["config", "user.name", "t"], repo);
    writeFileSync(join(repo, "a.ts"), TS_SOURCE);
    git(["add", "."], repo);
    git(["commit", "-m", "add a"], repo);
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("captures real head + blob shas plus a symbol hash (default execGit)", async () => {
    const anchor = await captureCodeAnchor({
      rootPath: repo,
      relatedFiles: ["a.ts"],
      relatedSymbols: ["a.ts#alpha"],
      now: NOW,
    });
    expect(anchor?.repoHead).toBe(git(["rev-parse", "HEAD"], repo).trim());
    expect(anchor?.capturedAt).toBe(NOW);
    expect(anchor?.files).toEqual([
      { path: "a.ts", blobSha: git(["rev-parse", "HEAD:a.ts"], repo).trim() },
    ]);
    expect(anchor?.symbols[0]?.name).toBe("alpha");
    expect((anchor?.symbols[0]?.contentHash.length ?? 0) > 0).toBe(true);
  });

  it("returns undefined in a non-git directory (default execGit)", async () => {
    const plain = mkdtempSync(join(tmpdir(), "megasaver-anchor-plain-"));
    writeFileSync(join(plain, "a.ts"), TS_SOURCE);
    try {
      const anchor = await captureCodeAnchor({
        rootPath: plain,
        relatedFiles: ["a.ts"],
        now: NOW,
      });
      expect(anchor).toBeUndefined();
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run to verify FAIL.**
  `cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/living-brain && pnpm build && pnpm --filter @megasaver/core test`
  Expected: `test/memory-anchor-capture.test.ts` fails at load with a
  missing-export error for `captureCodeAnchor` from
  `../src/memory-anchor.js`. Everything else stays green.

- [ ] **Step 3: Minimal implementation.** In
  `packages/core/src/memory-anchor.ts`, replace the single import line at the
  top:

```ts
import { z } from "zod";
```

  with:

```ts
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { type ExtractedBlock, extractBlocksForFile } from "@megasaver/output-filter";
import { z } from "zod";
```

  Then append to the END of the file (after `export type LastVerified = ...`):

```ts
type ExecGit = (args: string[], cwd: string) => string;

// timeout so a stuck git (index.lock, slow FS) can't stall a save; the
// best-effort catch below absorbs the throw (same shape as cli git-delta.ts).
const defaultExecGit: ExecGit = (args, cwd) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 3000,
    maxBuffer: 10 * 1024 * 1024,
  });

// Repo-relative POSIX form, or undefined when the input escapes rootPath or
// carries control characters. Nothing unsafe ever reaches a git argv or an
// anchor row (architect N3/N4); every path-taking git call below also uses
// the HEAD: prefix so a leading-dash path can never parse as a flag.
function normalizeRepoPath(rootPath: string, input: string): string | undefined {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control chars is the point (N4)
  if (/[\u0000-\u001f\u007f]/.test(input)) return undefined;
  const rel = relative(rootPath, resolve(rootPath, input));
  if (rel === "" || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) {
    return undefined;
  }
  return rel.split(sep).join("/");
}

// Capture what a memory claims about the code: blob SHAs at HEAD per related
// file, content hashes per related symbol read from the CURRENT worktree file
// (§6.4). Best-effort TOTAL (§5): ANY failure — not a git repo, git missing,
// extractor throw — returns undefined and the save proceeds unanchored.
// Capture must never block or fail a save. Runs BEFORE the sync
// registry.createMemoryEntry; the anchor rides in on the entry.
export async function captureCodeAnchor(opts: {
  rootPath: string;
  relatedFiles?: readonly string[];
  relatedSymbols?: readonly string[];
  now: string;
  execGit?: ExecGit;
}): Promise<CodeAnchor | undefined> {
  const exec = opts.execGit ?? defaultExecGit;
  try {
    const repoHead = exec(["rev-parse", "HEAD"], opts.rootPath).trim();
    if (repoHead === "") return undefined;

    const relFiles: string[] = [];
    for (const input of opts.relatedFiles ?? []) {
      const rel = normalizeRepoPath(opts.rootPath, input);
      if (rel !== undefined && !relFiles.includes(rel)) relFiles.push(rel);
    }

    const files: FileAnchor[] = [];
    for (const rel of relFiles) {
      try {
        const blobSha = exec(["rev-parse", `HEAD:${rel}`], opts.rootPath).trim();
        if (blobSha !== "") files.push({ path: rel, blobSha });
      } catch {
        // no blob at HEAD (untracked/new) — skipped, not an error (§5)
      }
    }

    // Symbols read the worktree, not HEAD — anchors describe what the agent
    // actually sees on disk (§6.4). Cache per file: one read + one extract.
    const blockCache = new Map<string, ExtractedBlock[] | undefined>();
    const blocksFor = async (rel: string): Promise<ExtractedBlock[] | undefined> => {
      if (!blockCache.has(rel)) {
        let blocks: ExtractedBlock[] | undefined;
        try {
          const source = await readFile(resolve(opts.rootPath, rel), "utf8");
          blocks = await extractBlocksForFile(rel, source);
        } catch {
          blocks = undefined; // unreadable / extractor throw — symbols skipped
        }
        blockCache.set(rel, blocks);
      }
      return blockCache.get(rel);
    };

    const symbols: SymbolAnchor[] = [];
    for (const symbol of opts.relatedSymbols ?? []) {
      const hashAt = symbol.indexOf("#");
      const name = hashAt === -1 ? symbol : symbol.slice(hashAt + 1);
      if (name === "") continue;
      let candidatePaths: readonly string[];
      if (hashAt === -1) {
        candidatePaths = relFiles;
      } else {
        const rel = normalizeRepoPath(opts.rootPath, symbol.slice(0, hashAt));
        candidatePaths = rel === undefined ? [] : [rel];
      }

      const matches: SymbolAnchor[] = [];
      for (const rel of candidatePaths) {
        for (const block of (await blocksFor(rel)) ?? []) {
          if (block.name === name) {
            matches.push({
              path: rel,
              name,
              startLine: block.startLine,
              endLine: block.endLine,
              contentHash: block.contentHash,
            });
          }
        }
      }
      // N2: ambiguity never anchors — multiple same-name blocks (within one
      // file, or across candidate files for a bare name) skip the symbol.
      const only = matches[0];
      if (matches.length === 1 && only !== undefined) symbols.push(only);
    }

    if (files.length === 0 && symbols.length === 0) return undefined;
    return codeAnchorSchema.parse({
      repoHead,
      capturedAt: opts.now,
      files,
      symbols,
    });
  } catch {
    return undefined; // best-effort total (§5): capture never blocks a save
  }
}
```

  No `packages/core/src/index.ts` change needed — Task 1's
  `export * from "./memory-anchor.js";` already re-exports
  `captureCodeAnchor`. No `packages/core/package.json` change needed —
  `@megasaver/output-filter` is already a dependency (line 30).

- [ ] **Step 4: Run to verify PASS.**
  `cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/living-brain && pnpm build && pnpm --filter @megasaver/core test`
  Expected: all core tests pass — 9 fake-git unit tests + 2 real-git
  integration tests, nothing pre-existing changed. (Task 2 must be committed
  first: the build must ship `extractBlocksForFile` in output-filter's dist.)

- [ ] **Step 5: Full gates.**
  `pnpm lint:fix && pnpm typecheck` — both clean. Watch the
  `biome-ignore lint/suspicious/noControlCharactersInRegex` annotation: if
  `pnpm lint` still flags the regex, the ignore comment must sit on the line
  DIRECTLY above the `if (/.../.test(input))` line.

- [ ] **Step 6: Commit.**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/living-brain && \
git add packages/core/src/memory-anchor.ts \
  packages/core/test/memory-anchor-capture.test.ts && \
git commit -m "feat(core): captureCodeAnchor best-effort capture"
```
# Section B — Verify engine (Tasks 5–7)

All commands run from the worktree root:
`/Users/halitozger/Desktop/MegaSaver/.claude/worktrees/living-brain`
(branch `feat/living-brain`).

**Section dependency:** Tasks 5–7 require Section A (Tasks 1–4) to be
committed first: `packages/core/src/memory-anchor.ts` (schemas + types
`CodeAnchor`, `LastVerified`), the `anchor?: CodeAnchor` /
`lastVerified?: LastVerified` fields on `memoryEntrySchema`, the overlay
entry schema AND `memoryEntryUpdatePatchSchema`, and
`extractBlocksForFile` exported from `@megasaver/output-filter`. If
`grep -n "lastVerified" packages/core/src/memory-entry.ts` returns nothing,
STOP and finish Section A first.

**Environment hazards (apply to every task below):**

- Mega Saver MCP read-proxy SILENTLY TRUNCATES file reads (banner "N kept, M
  dropped" / "[Mega Saver: compressed...]") — read files via `sed -n 'A,Bp'`
  in <=60-line chunks, locate with `grep -n`. Never trust a proxied read.
- `pnpm build` BEFORE package tests — `packages/core/src/code-truth.ts`
  imports `@megasaver/output-filter`, which resolves via `dist/` (and
  output-filter gained a new export in Section A, so a stale dist WILL fail).
- `pnpm --filter @megasaver/core test -- <pattern>` does NOT narrow — always
  run the whole package suite.
- Full `pnpm typecheck` REQUIRED before every commit — package vitest does NOT
  catch TS4111 (`noPropertyAccessFromIndexSignature`). If it fires, use bracket
  access + `// biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)`.
- Branded IDs in tests: raw UUID strings need `as ProjectId` /
  `as MemoryEntryId` casts (types from `@megasaver/shared`).
- tsconfig is `strict` with `exactOptionalPropertyTypes` — never assign an
  explicit `undefined` to an optional property; use conditional spreads
  (`...(x !== undefined ? { x } : {})`), exactly as the code below does.
- Core tests live in `packages/core/test/*.test.ts` (flat dir), importing
  sources via relative `../src/<module>.js` paths.

---

### Task 5: `verifyAnchors` — the pure code-truth planner

New file `packages/core/src/code-truth.ts`. Pure function: fixture
`RepoState` in, `VerifyPlan` out, zero git, zero I/O — the pure/impure split
mirrors `sweepMemoryTiers` (spec §6). Policy baked in (spec §6.2/§6.3):

- A blob change ALONE is NEVER a contradiction. File anchors are weak claims —
  they contradict only on delete-without-rename. The unit of strong
  contradiction is the symbol hash.
- Contradiction = file deleted w/o rename | cited symbol missing from the
  file's current blocks | symbol present but `contentHash` changed.
- Name collision at verify resolves optimistically: ANY same-name block
  matching the anchored hash ⇒ verified; contradiction only if NONE matches.
- A missing file first consults `renames`; a rename **repoints** (planner
  emits `repointed`, checks re-run under the new path in the same pass) —
  never flags. `repointed` is an orthogonal bucket: a repointed entry ALSO
  lands in exactly one of contradicted/healed/verified.
- Heal is keyed STRICTLY on `lastVerified.result === "contradicted"` — never
  on evidence-string sniffing (architect B1). The planner NEVER inspects
  `validTo`: close ownership is decided at APPLY time (Task 7), not plan time.
- No anchor ⇒ `unanchored`.
- Commit attribution comes from `repo.attribution` (path → falsifying sha);
  an unattributed failure gets `commit` absent and the reason suffixed
  `(uncommitted change)` (spec §6.4 dirty-tree semantics).

**Files:**

- Create: `packages/core/src/code-truth.ts`
- Modify: `packages/core/src/index.ts`
- Create (test): `packages/core/test/code-truth.test.ts`

**Steps:**

- [ ] **Step 1: Confirm the worktree and Section A.**
  `cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/living-brain && git branch --show-current`
  must print `feat/living-brain`. Then
  `grep -n "lastVerified" packages/core/src/memory-entry.ts` and
  `grep -n "extractBlocksForFile" packages/output-filter/src/index.ts` —
  both MUST hit. If not, Section A is incomplete; stop and report.

- [ ] **Step 2: Write the failing test.** Create
  `packages/core/test/code-truth.test.ts` with exactly:

```ts
import type { MemoryEntryId, ProjectId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { type ExtractedBlockLite, type RepoState, verifyAnchors } from "../src/code-truth.js";
import type { CodeAnchor } from "../src/memory-anchor.js";
import { type MemoryEntry, memoryEntrySchema } from "../src/memory-entry.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const E1 = "00000000-0000-4000-8000-0000000000b1" as MemoryEntryId;
const TS = "2026-07-13T00:00:00.000Z";
const NOW = "2026-07-14T12:00:00.000Z";
const EARLIER = "2026-07-10T00:00:00.000Z";
const OLD_HEAD = "1111111111111111111111111111111111111111";
const HEAD = "2222222222222222222222222222222222222222";
const FALSIFIER = "3333333333333333333333333333333333333333";

function anchor(over?: Partial<CodeAnchor>): CodeAnchor {
  return { repoHead: OLD_HEAD, capturedAt: TS, files: [], symbols: [], ...over };
}

function mem(over: Omit<Partial<MemoryEntry>, "id"> & { id: string }): MemoryEntry {
  return memoryEntrySchema.parse({
    id: over.id,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "auth verifies via verifyToken",
    content: "auth middleware validates requests via verifyToken",
    keywords: [],
    confidence: "medium",
    source: "manual",
    approval: "approved",
    stale: over.stale ?? false,
    createdAt: TS,
    updatedAt: TS,
    ...(over.anchor !== undefined ? { anchor: over.anchor } : {}),
    ...(over.lastVerified !== undefined ? { lastVerified: over.lastVerified } : {}),
    ...(over.validTo !== undefined ? { validTo: over.validTo } : {}),
  });
}

function repo(over?: Partial<RepoState>): RepoState {
  return {
    headSha: HEAD,
    blobs: new Map(),
    blocks: new Map(),
    renames: new Map(),
    attribution: new Map(),
    ...over,
  };
}

const FILE_ANCHOR = anchor({ files: [{ path: "src/a.ts", blobSha: "blob-old" }] });
const SYMBOL_ANCHOR = anchor({
  symbols: [
    { path: "src/a.ts", name: "verifyToken", startLine: 1, endLine: 3, contentHash: "hash-old" },
  ],
});

const block = (over?: Partial<ExtractedBlockLite>): ExtractedBlockLite => ({
  name: "verifyToken",
  contentHash: "hash-old",
  startLine: 1,
  endLine: 3,
  ...over,
});

describe("verifyAnchors — contradiction ladder", () => {
  it("entry without anchor -> unanchored", () => {
    const plan = verifyAnchors([mem({ id: E1 })], repo(), NOW);
    expect(plan.unanchored).toEqual([E1]);
    expect(plan.verified).toEqual([]);
    expect(plan.contradicted).toEqual([]);
  });

  it("blob change alone stays verified — file anchors are weak claims", () => {
    const entries = [mem({ id: E1, anchor: FILE_ANCHOR })];
    const plan = verifyAnchors(entries, repo({ blobs: new Map([["src/a.ts", "blob-NEW"]]) }), NOW);
    expect(plan.verified).toEqual([E1]);
    expect(plan.contradicted).toEqual([]);
  });

  it("file deleted without rename -> contradicted with commit attribution", () => {
    const entries = [mem({ id: E1, anchor: FILE_ANCHOR })];
    const plan = verifyAnchors(
      entries,
      repo({
        blobs: new Map([["src/a.ts", "missing"]]),
        attribution: new Map([["src/a.ts", FALSIFIER]]),
      }),
      NOW,
    );
    expect(plan.contradicted).toEqual([{ id: E1, reason: "src/a.ts deleted", commit: FALSIFIER }]);
  });

  it("file deleted WITH rename -> repointed + verified, never contradicted", () => {
    const entries = [mem({ id: E1, anchor: FILE_ANCHOR })];
    const plan = verifyAnchors(
      entries,
      repo({
        blobs: new Map([
          ["src/a.ts", "missing"],
          ["src/b.ts", "blob-whatever"],
        ]),
        renames: new Map([["src/a.ts", "src/b.ts"]]),
      }),
      NOW,
    );
    expect(plan.repointed).toEqual([{ id: E1, from: "src/a.ts", to: "src/b.ts" }]);
    expect(plan.verified).toEqual([E1]);
    expect(plan.contradicted).toEqual([]);
  });

  it("symbol missing -> contradicted", () => {
    const entries = [mem({ id: E1, anchor: SYMBOL_ANCHOR })];
    const plan = verifyAnchors(
      entries,
      repo({
        blocks: new Map([["src/a.ts", [block({ name: "parseToken" })]]]),
        attribution: new Map([["src/a.ts", FALSIFIER]]),
      }),
      NOW,
    );
    expect(plan.contradicted).toEqual([
      { id: E1, reason: "src/a.ts#verifyToken missing", commit: FALSIFIER },
    ]);
  });

  it("symbol hash changed -> contradicted", () => {
    const entries = [mem({ id: E1, anchor: SYMBOL_ANCHOR })];
    const plan = verifyAnchors(
      entries,
      repo({
        blocks: new Map([["src/a.ts", [block({ contentHash: "hash-NEW" })]]]),
        attribution: new Map([["src/a.ts", FALSIFIER]]),
      }),
      NOW,
    );
    expect(plan.contradicted).toEqual([
      { id: E1, reason: "src/a.ts#verifyToken hash changed", commit: FALSIFIER },
    ]);
  });

  it("name collision: ANY candidate matching the hash verifies", () => {
    const entries = [mem({ id: E1, anchor: SYMBOL_ANCHOR })];
    const plan = verifyAnchors(
      entries,
      repo({
        blocks: new Map([
          ["src/a.ts", [block({ contentHash: "hash-NEW" }), block({ startLine: 10, endLine: 12 })]],
        ]),
      }),
      NOW,
    );
    expect(plan.verified).toEqual([E1]);
    expect(plan.contradicted).toEqual([]);
  });

  it("name collision: NO candidate matching the hash contradicts", () => {
    const entries = [mem({ id: E1, anchor: SYMBOL_ANCHOR })];
    const plan = verifyAnchors(
      entries,
      repo({
        blocks: new Map([
          [
            "src/a.ts",
            [
              block({ contentHash: "hash-NEW" }),
              block({ contentHash: "hash-OTHER", startLine: 10, endLine: 12 }),
            ],
          ],
        ]),
        attribution: new Map([["src/a.ts", FALSIFIER]]),
      }),
      NOW,
    );
    expect(plan.contradicted).toEqual([
      { id: E1, reason: "src/a.ts#verifyToken hash changed", commit: FALSIFIER },
    ]);
  });

  it("dirty tree: no attribution -> commit absent, reason says uncommitted change", () => {
    const entries = [mem({ id: E1, anchor: SYMBOL_ANCHOR })];
    const plan = verifyAnchors(
      entries,
      repo({ blocks: new Map([["src/a.ts", [block({ contentHash: "hash-NEW" })]]]) }),
      NOW,
    );
    expect(plan.contradicted).toEqual([
      { id: E1, reason: "src/a.ts#verifyToken hash changed (uncommitted change)" },
    ]);
  });

  it("rename re-checks the symbol under the NEW path in the same pass", () => {
    const entries = [
      mem({
        id: E1,
        anchor: anchor({
          files: [{ path: "src/a.ts", blobSha: "blob-old" }],
          symbols: [
            { path: "src/a.ts", name: "verifyToken", startLine: 1, endLine: 3, contentHash: "hash-old" },
          ],
        }),
      }),
    ];
    const plan = verifyAnchors(
      entries,
      repo({
        blobs: new Map([
          ["src/a.ts", "missing"],
          ["src/b.ts", "blob-new"],
        ]),
        renames: new Map([["src/a.ts", "src/b.ts"]]),
        blocks: new Map([["src/b.ts", [block()]]]),
      }),
      NOW,
    );
    expect(plan.repointed).toEqual([{ id: E1, from: "src/a.ts", to: "src/b.ts" }]);
    expect(plan.verified).toEqual([E1]);
  });
});

describe("verifyAnchors — heal keyed strictly on lastVerified (B1 plan level)", () => {
  const PASSING = repo({
    blobs: new Map([["src/a.ts", "blob-old"]]),
    blocks: new Map([["src/a.ts", [block()]]]),
  });

  it("lastVerified contradicted + checks pass -> healed", () => {
    const entries = [
      mem({
        id: E1,
        anchor: SYMBOL_ANCHOR,
        lastVerified: { headSha: OLD_HEAD, at: TS, result: "contradicted", closedByCodeTruth: true },
      }),
    ];
    const plan = verifyAnchors(entries, PASSING, NOW);
    expect(plan.healed).toEqual([E1]);
    expect(plan.verified).toEqual([]);
  });

  it("row closed by lineage WITHOUT lastVerified stays verified — never healed", () => {
    // B1 regression, plan level: supersession closed validTo; there is no
    // structured contradiction record, so the planner must not emit a heal
    // (evidence-string sniffing is exactly what B1 forbids).
    const entries = [mem({ id: E1, anchor: SYMBOL_ANCHOR, validTo: EARLIER })];
    const plan = verifyAnchors(entries, PASSING, NOW);
    expect(plan.verified).toEqual([E1]);
    expect(plan.healed).toEqual([]);
  });

  it("lastVerified verified + checks pass -> verified, not healed", () => {
    const entries = [
      mem({
        id: E1,
        anchor: SYMBOL_ANCHOR,
        lastVerified: { headSha: OLD_HEAD, at: TS, result: "verified", closedByCodeTruth: false },
      }),
    ];
    const plan = verifyAnchors(entries, PASSING, NOW);
    expect(plan.verified).toEqual([E1]);
    expect(plan.healed).toEqual([]);
  });

  it("still-failing contradicted row -> contradicted again, not healed", () => {
    const entries = [
      mem({
        id: E1,
        anchor: SYMBOL_ANCHOR,
        lastVerified: { headSha: OLD_HEAD, at: TS, result: "contradicted", closedByCodeTruth: true },
      }),
    ];
    const plan = verifyAnchors(
      entries,
      repo({ blocks: new Map([["src/a.ts", [block({ contentHash: "hash-NEW" })]]]) }),
      NOW,
    );
    expect(plan.contradicted).toHaveLength(1);
    expect(plan.healed).toEqual([]);
  });
});
```

- [ ] **Step 3: Run to verify FAIL.**
  `pnpm build && pnpm --filter @megasaver/core test`
  Expected: the new file fails with a module-resolution error —
  `Failed to resolve import "../src/code-truth.js" from "test/code-truth.test.ts"`
  (or `Cannot find module`). All pre-existing tests stay green.

- [ ] **Step 4: Minimal implementation.** Create
  `packages/core/src/code-truth.ts` with exactly:

```ts
import type { MemoryEntryId } from "@megasaver/shared";
import type { CodeAnchor } from "./memory-anchor.js";
import type { MemoryEntry } from "./memory-entry.js";

export type ExtractedBlockLite = {
  name?: string;
  contentHash: string;
  startLine: number;
  endLine: number;
};

export type RepoState = {
  headSha: string;
  // path → current blob sha at HEAD, or "missing"
  blobs: ReadonlyMap<string, string | "missing">;
  // path → extracted blocks of the CURRENT worktree content (only for files
  // cited by symbol anchors, plus rename targets)
  blocks: ReadonlyMap<string, readonly ExtractedBlockLite[]>;
  // path → rename target discovered via `git diff -M` (present only when the
  // anchored path is missing and a rename was detected)
  renames: ReadonlyMap<string, string>;
  // path → falsifying commit sha (last commit touching path since anchor head)
  attribution: ReadonlyMap<string, string>;
};

export type VerifyPlan = {
  contradicted: Array<{ id: MemoryEntryId; reason: string; commit?: string }>;
  healed: MemoryEntryId[];
  verified: MemoryEntryId[];
  repointed: Array<{ id: MemoryEntryId; from: string; to: string }>;
  unanchored: MemoryEntryId[];
};

type Contradiction = { reason: string; path: string };

// First failing check for one entry, or undefined when every check passes.
// Contradiction policy (spec §6.2): a blob change ALONE never contradicts —
// file anchors are weak claims that only contradict on delete-without-rename;
// the unit of strong contradiction is the symbol hash. Name collisions at
// verify resolve optimistically: ANY same-name block matching the anchored
// hash verifies; contradiction only when none matches.
function firstContradiction(anchor: CodeAnchor, repo: RepoState): Contradiction | undefined {
  const effective = (path: string): string => repo.renames.get(path) ?? path;
  for (const file of anchor.files) {
    const blob = repo.blobs.get(effective(file.path)) ?? "missing";
    if (blob === "missing" && !repo.renames.has(file.path)) {
      return { reason: `${file.path} deleted`, path: file.path };
    }
  }
  for (const symbol of anchor.symbols) {
    const path = effective(symbol.path);
    const candidates = (repo.blocks.get(path) ?? []).filter(
      (candidate) => candidate.name === symbol.name,
    );
    if (candidates.length === 0) {
      return { reason: `${path}#${symbol.name} missing`, path };
    }
    if (!candidates.some((candidate) => candidate.contentHash === symbol.contentHash)) {
      return { reason: `${path}#${symbol.name} hash changed`, path };
    }
  }
  return undefined;
}

// Pure planner (spec §6.1) — fixture-testable, zero git. Heal is keyed
// STRICTLY on lastVerified.result === "contradicted" (architect B1: never
// evidence-string sniffing). The planner never inspects validTo: close
// ownership is an APPLY-time decision (runVerify), not a plan-time one.
// `now` is part of the pinned signature; timestamps are stamped at apply time.
export function verifyAnchors(
  entries: readonly MemoryEntry[],
  repo: RepoState,
  now: string,
): VerifyPlan {
  const plan: VerifyPlan = {
    contradicted: [],
    healed: [],
    verified: [],
    repointed: [],
    unanchored: [],
  };
  for (const entry of entries) {
    const anchor = entry.anchor;
    if (anchor === undefined) {
      plan.unanchored.push(entry.id);
      continue;
    }
    const cited = new Set<string>([
      ...anchor.files.map((file) => file.path),
      ...anchor.symbols.map((symbol) => symbol.path),
    ]);
    for (const path of cited) {
      const target = repo.renames.get(path);
      if (target !== undefined) {
        plan.repointed.push({ id: entry.id, from: path, to: target });
      }
    }
    const failure = firstContradiction(anchor, repo);
    if (failure !== undefined) {
      const commit = repo.attribution.get(failure.path);
      const reason =
        commit === undefined ? `${failure.reason} (uncommitted change)` : failure.reason;
      plan.contradicted.push({
        id: entry.id,
        reason,
        ...(commit !== undefined ? { commit } : {}),
      });
      continue;
    }
    if (entry.lastVerified?.result === "contradicted") {
      plan.healed.push(entry.id);
    } else {
      plan.verified.push(entry.id);
    }
  }
  return plan;
}
```

  Note: the unused `now` parameter is deliberate (pinned contract signature;
  the runner stamps timestamps). Neither this repo's biome recommended set
  (1.9.4) nor its tsconfig (`noUnusedParameters` absent) flags unused
  parameters — if a future lint bump does, rename to `_now`.

- [ ] **Step 5: Export from the package surface.** In
  `packages/core/src/index.ts`, add one line directly after
  `export * from "./context-gate.js";` (line 1):

```ts
export * from "./code-truth.js";
```

- [ ] **Step 6: Run to verify PASS.**
  `pnpm --filter @megasaver/core test`
  Expected: `test/code-truth.test.ts` green (14 tests), full suite green.

- [ ] **Step 7: Gates.** `pnpm lint:fix && pnpm typecheck` — both clean.

- [ ] **Step 8: Commit.**
  ```bash
  git add packages/core/src/code-truth.ts packages/core/src/index.ts packages/core/test/code-truth.test.ts
  git commit -m "feat(core): pure code-truth verify planner

Fixture-testable RepoState -> VerifyPlan. Blob change alone never
contradicts; symbol hash is the contradiction unit; renames repoint;
heal keyed strictly on lastVerified (B1), close ownership deferred
to apply time."
  ```

---

### Task 6: `applyMemoryEntryPatches` — batch apply on the registry

`updateMemoryEntry` re-reads and rewrites the whole per-project store under a
dir lock PER CALL — applying a verify plan row-by-row would be N serialized
full-store rewrites (architect M5). This task adds one batch operation to the
`CoreRegistry` interface (there is NO separate MemoryRegistry interface in
this codebase — memory methods live on `CoreRegistry`; the contract's
`MemoryRegistry` name is introduced in Task 7 as a `Pick` of it) and both
implementations:

- in-memory (`packages/core/src/registry.ts`)
- JSON directory (`packages/core/src/json-directory-registry.ts`) — ONE
  `withDirLock` critical section, one `readMemoryEntriesForProject`, one
  `writeMemoryEntriesForProject`.

**DECISION (contract asked us to pick): whole-batch atomicity.** Every patch
is validated (patch-schema parse + merged full-entry re-parse, same as
`updateMemoryEntry`) BEFORE anything is committed; any invalid patch or
unknown id rejects the ENTIRE batch and the store is untouched. This is also
the observable proof of "one store rewrite": a per-row writer would persist
patch 1 before failing on patch 2 — the atomicity tests below distinguish the
two implementations directly, without brittle mtime/inode counting.

**Files:**

- Modify: `packages/core/src/registry.ts`
- Modify: `packages/core/src/json-directory-registry.ts`
- Create (test): `packages/core/test/apply-memory-entry-patches.test.ts`

**Steps:**

- [ ] **Step 1: Write the failing test.** Create
  `packages/core/test/apply-memory-entry-patches.test.ts` with exactly:

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MemoryEntryId, ProjectId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CoreRegistryError } from "../src/errors.js";
import { createJsonDirectoryCoreRegistry } from "../src/json-directory-registry.js";
import {
  type MemoryEntry,
  type MemoryEntryUpdatePatch,
  memoryEntrySchema,
} from "../src/memory-entry.js";
import { type CoreRegistry, createInMemoryCoreRegistry } from "../src/registry.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const OTHER_PROJECT_ID = "22222222-2222-4222-8222-222222222222" as ProjectId;
const E1 = "00000000-0000-4000-8000-0000000000c1" as MemoryEntryId;
const E2 = "00000000-0000-4000-8000-0000000000c2" as MemoryEntryId;
const E3 = "00000000-0000-4000-8000-0000000000c3" as MemoryEntryId;
const FOREIGN = "00000000-0000-4000-8000-0000000000c4" as MemoryEntryId;
const MISSING = "00000000-0000-4000-8000-0000000000ff" as MemoryEntryId;
const TS = "2026-07-13T00:00:00.000Z";
const NOW = "2026-07-14T12:00:00.000Z";

function mem(id: MemoryEntryId, projectId: ProjectId = PROJECT_ID): MemoryEntry {
  return memoryEntrySchema.parse({
    id,
    projectId,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: `memory ${id.slice(-2)}`,
    content: `content ${id.slice(-2)}`,
    keywords: [],
    confidence: "medium",
    source: "manual",
    approval: "approved",
    stale: false,
    createdAt: TS,
    updatedAt: TS,
  });
}

function seed(registry: CoreRegistry): void {
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: "/tmp/demo",
    createdAt: TS,
    updatedAt: TS,
  });
  registry.createProject({
    id: OTHER_PROJECT_ID,
    name: "other",
    rootPath: "/tmp/other",
    createdAt: TS,
    updatedAt: TS,
  });
  for (const id of [E1, E2, E3]) {
    registry.createMemoryEntry(mem(id));
  }
  registry.createMemoryEntry(mem(FOREIGN, OTHER_PROJECT_ID));
}

function itBehavesLikeBatchApply(makeRegistry: () => CoreRegistry): void {
  it("applies every patch in one batch and returns updated entries in order", () => {
    const registry = makeRegistry();
    seed(registry);
    const results = registry.applyMemoryEntryPatches(PROJECT_ID, [
      { id: E1, patch: { title: "one", updatedAt: NOW } },
      { id: E2, patch: { content: "two", updatedAt: NOW } },
      { id: E3, patch: { stale: true, updatedAt: NOW } },
    ]);
    expect(results.map((entry) => entry.id)).toEqual([E1, E2, E3]);
    expect(registry.getMemoryEntry(E1)?.title).toBe("one");
    expect(registry.getMemoryEntry(E2)?.content).toBe("two");
    expect(registry.getMemoryEntry(E3)?.stale).toBe(true);
    expect(registry.getMemoryEntry(E3)?.updatedAt).toBe(NOW);
  });

  it("duplicate id: later patch is applied on top of the earlier result", () => {
    const registry = makeRegistry();
    seed(registry);
    registry.applyMemoryEntryPatches(PROJECT_ID, [
      { id: E1, patch: { title: "first", updatedAt: NOW } },
      { id: E1, patch: { content: "second", updatedAt: NOW } },
    ]);
    const entry = registry.getMemoryEntry(E1);
    expect(entry?.title).toBe("first");
    expect(entry?.content).toBe("second");
  });

  it("whole-batch atomicity: invalid patch value rejects the batch, store untouched", () => {
    const registry = makeRegistry();
    seed(registry);
    expect(() =>
      registry.applyMemoryEntryPatches(PROJECT_ID, [
        { id: E1, patch: { title: "should not persist", updatedAt: NOW } },
        { id: E2, patch: { title: "bad", updatedAt: "not-a-datetime" } },
      ]),
    ).toThrow();
    // A row-by-row writer would have persisted patch 1 before failing on
    // patch 2 — this assertion is the observable for "one store rewrite".
    expect(registry.getMemoryEntry(E1)?.title).not.toBe("should not persist");
  });

  it("unknown id mid-batch rejects the whole batch", () => {
    const registry = makeRegistry();
    seed(registry);
    expect(() =>
      registry.applyMemoryEntryPatches(PROJECT_ID, [
        { id: E1, patch: { title: "should not persist", updatedAt: NOW } },
        { id: MISSING, patch: { title: "nope", updatedAt: NOW } },
      ]),
    ).toThrow(CoreRegistryError);
    expect(registry.getMemoryEntry(E1)?.title).not.toBe("should not persist");
  });

  it("cross-project id is not found under this projectId", () => {
    const registry = makeRegistry();
    seed(registry);
    expect(() =>
      registry.applyMemoryEntryPatches(PROJECT_ID, [
        { id: FOREIGN, patch: { title: "nope", updatedAt: NOW } },
      ]),
    ).toThrow(CoreRegistryError);
  });

  it("strict patch validation matches updateMemoryEntry: unknown keys rejected", () => {
    const registry = makeRegistry();
    seed(registry);
    const bad = {
      projectId: OTHER_PROJECT_ID,
      updatedAt: NOW,
    } as unknown as MemoryEntryUpdatePatch;
    expect(() =>
      registry.applyMemoryEntryPatches(PROJECT_ID, [{ id: E1, patch: bad }]),
    ).toThrow();
    expect(registry.getMemoryEntry(E1)?.projectId).toBe(PROJECT_ID);
  });

  it("empty patch list returns [] without writing", () => {
    const registry = makeRegistry();
    seed(registry);
    expect(registry.applyMemoryEntryPatches(PROJECT_ID, [])).toEqual([]);
    expect(registry.getMemoryEntry(E1)?.updatedAt).toBe(TS);
  });
}

describe("applyMemoryEntryPatches — in-memory registry", () => {
  itBehavesLikeBatchApply(createInMemoryCoreRegistry);
});

describe("applyMemoryEntryPatches — JSON directory registry", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "megasaver-batch-apply-"));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  itBehavesLikeBatchApply(() => createJsonDirectoryCoreRegistry({ rootDir }));
});
```

- [ ] **Step 2: Run to verify FAIL.**
  `pnpm --filter @megasaver/core test`
  Expected: every new test fails with
  `TypeError: registry.applyMemoryEntryPatches is not a function`
  (vitest transpiles without type-checking, so the missing interface method
  surfaces at runtime).

- [ ] **Step 3: Add the interface method.** In
  `packages/core/src/registry.ts`, locate (grep -n first; last verified at
  line 86):

```ts
  updateMemoryEntry(id: MemoryEntryId, patch: MemoryEntryUpdatePatch): MemoryEntry;
```

  and insert directly after it:

```ts
  // Batch variant for code-truth verify (architect M5): one locked
  // read-modify-write instead of N full-store rewrites. Whole-batch atomic —
  // any invalid patch or unknown id rejects the entire batch; per-entry
  // validation is identical to updateMemoryEntry.
  applyMemoryEntryPatches(
    projectId: ProjectId,
    patches: ReadonlyArray<{ id: MemoryEntryId; patch: MemoryEntryUpdatePatch }>,
  ): MemoryEntry[];
```

- [ ] **Step 4: In-memory implementation.** In the same file, inside
  `createInMemoryCoreRegistry`, locate the end of `updateMemoryEntry`
  (grep -n `updateMemoryEntry(id, patch) {`; the method ends with):

```ts
      const updated = memoryEntrySchema.parse({ ...existing, ...parsedPatch });
      memoryEntries.set(id, updated);
      return updated;
    },
```

  and insert directly after that `},`:

```ts
    applyMemoryEntryPatches(projectId, patches) {
      requireProject(projectId);
      // Stage everything first — whole-batch atomicity: any rejection above
      // leaves the backing Map untouched.
      const staged = new Map<MemoryEntryId, MemoryEntry>();
      const results: MemoryEntry[] = [];
      for (const { id, patch } of patches) {
        const parsedPatch = memoryEntryUpdatePatchSchema.parse(patch);
        const existing = staged.get(id) ?? memoryEntries.get(id);
        if (!existing || existing.projectId !== projectId) {
          throw new CoreRegistryError(
            "memory_entry_not_found",
            `Memory entry does not exist: ${id}`,
          );
        }
        const updated = memoryEntrySchema.parse({ ...existing, ...parsedPatch });
        staged.set(id, updated);
        results.push(updated);
      }
      for (const [id, updated] of staged) {
        memoryEntries.set(id, updated);
      }
      return results;
    },
```

- [ ] **Step 5: JSON directory implementation.** In
  `packages/core/src/json-directory-registry.ts`, locate the end of
  `updateMemoryEntry` (grep -n; the method ends with):

```ts
        writeMemoryEntriesForProject(paths, existing.projectId, next);
        return updated;
      });
    },
```

  and insert directly after that `},`:

```ts
    applyMemoryEntryPatches(projectId, patches) {
      // One dir-locked read-modify-write for the whole plan (architect M5):
      // read the project store once, merge every patch in memory, rewrite the
      // JSONL once. Whole-batch atomic — any rejection escapes before the
      // single write, so a partially-applied plan can never hit disk.
      return withDirLock(options.rootDir, () => {
        requireProject(projectId);
        const entries = readMemoryEntriesForProject(paths, projectId);
        const byId = new Map(entries.map((entry) => [entry.id, entry] as const));
        const results: MemoryEntry[] = [];
        for (const { id, patch } of patches) {
          const parsedPatch = memoryEntryUpdatePatchSchema.parse(patch);
          const existing = byId.get(id);
          if (!existing) {
            throw new CoreRegistryError(
              "memory_entry_not_found",
              `Memory entry does not exist: ${id}`,
            );
          }
          const updated = memoryEntrySchema.parse({ ...existing, ...parsedPatch });
          byId.set(id, updated);
          results.push(updated);
        }
        if (results.length > 0) {
          writeMemoryEntriesForProject(
            paths,
            projectId,
            entries.map((entry) => byId.get(entry.id) ?? entry),
          );
        }
        return results;
      });
    },
```

  No new imports are needed in either file — `memoryEntrySchema`,
  `memoryEntryUpdatePatchSchema`, `CoreRegistryError`, `withDirLock`,
  `readMemoryEntriesForProject`, and `writeMemoryEntriesForProject` are all
  already in scope for `updateMemoryEntry`.

- [ ] **Step 6: Run to verify PASS.**
  `pnpm --filter @megasaver/core test`
  Expected: all 14 new tests green (7 per registry), full suite green.

- [ ] **Step 7: Gates.** `pnpm lint:fix && pnpm typecheck` — both clean.
  (Typecheck also proves the third registry-shaped object, if any other
  in-repo implementer of `CoreRegistry` exists, fails loudly — fix any such
  site by adding the same method; `grep -rn "CoreRegistry =" packages | grep -v test`
  to check. As of extraction there are exactly the two implementations.)

- [ ] **Step 8: Commit.**
  ```bash
  git add packages/core/src/registry.ts packages/core/src/json-directory-registry.ts packages/core/test/apply-memory-entry-patches.test.ts
  git commit -m "feat(core): batch memory patch apply

applyMemoryEntryPatches: one dir-locked store rewrite per verify
plan instead of N (architect M5). Whole-batch atomic; per-entry
validation identical to updateMemoryEntry."
  ```

---

### Task 7: `runVerify` — the impure runner (git + mutations)

Extends `packages/core/src/code-truth.ts` with the impure half (spec §6.5 +
§7). Responsibilities:

- **Git reads** (execFile, never a shell, `--` separators): one
  `rev-parse HEAD`; ONE batched `cat-file --batch-check` (single spawn, paths
  fed via stdin as `HEAD:<path>` lines) for all anchored blobs — plus a second
  small batch only when renames introduce new target paths; renames via
  `git diff --name-status -M <anchorHead>..HEAD` per distinct anchor head of
  entries citing missing paths; attribution via
  `git log -n1 --format=%H <anchorHead>..HEAD -- <path>` per contradicted
  entry's cited path. Unreachable anchorHead (rebase/amend, N7) degrades to
  "attribution unavailable" — `commit` absent, never a throw. Non-git rootPath
  degrades the whole run to `unanchored` with zero writes.
- **Worktree reads** (§6.4 pinned): symbol existence is a worktree question —
  files cited by symbol anchors are read from disk and re-extracted with
  `extractBlocksForFile`; blob identity stays a HEAD question.
- **Two-phase plan:** a dry `verifyAnchors` pass (empty attribution) finds
  contradictions; attribution runs only for those entries' paths; the pure
  planner re-runs with attribution filled in. Keeps "one git log per
  contradicted path" without threading failure locations out of the planner.
- **Mutations** (§7 table) via ONE `applyMemoryEntryPatches` batch:
  - contradicted: `stale: true`; `validTo: now` ONLY if currently open
    (`validTo == null` — null or undefined) and `closedByCodeTruth: true` in
    exactly that case (else `false`); append evidence
    `code-truth: contradicted by <sha7> — <reason>` (or without the
    `by <sha7>` clause when unattributed); set `lastVerified`.
    Idempotence guard: an entry already recorded contradicted at the SAME
    head is skipped entirely (same principle as verified suppression —
    evidence must not grow on repeat runs at an unchanged head).
  - healed: `stale: false`; `validTo: null` ONLY when
    `lastVerified.closedByCodeTruth === true` (B1 ownership guard); append
    `code-truth: healed at <sha7> — hash matches again`; `lastVerified`
    `{result: "healed", closedByCodeTruth: false}`.
  - verified: `lastVerified` update with NO-OP SUPPRESSION — skip when
    `lastVerified.headSha` is unchanged.
  - repointed: rewrite `anchor.files[].path` / `anchor.symbols[].path` only
    (merged into the same patch when the entry also has a status mutation).
  - NEVER touch `lastActiveAt` — verify is observation, not use.
- `scope.changedPaths` filters candidates to entries whose anchor cites at
  least one changed path (post-commit hook mode).
- **Injection note:** the contract pins
  `execGit?: (args: string[], cwd: string) => string`. The batched cat-file
  needs stdin, so the exported `ExecGit` type takes an optional third
  `input?: string` parameter — a contract-shaped 2-arg function is still
  assignable (TS allows fewer params), but any CUSTOM execGit that a caller
  injects must forward `input` to git's stdin or batch-check returns nothing.
  The default (execFileSync wrapper, 3s timeout, mirrors
  `apps/cli/src/git-delta.ts`) does.

**Files:**

- Modify: `packages/core/src/code-truth.ts`
- Create (test): `packages/core/test/run-verify.test.ts`

**Steps:**

- [ ] **Step 1: Write the failing test.** Create
  `packages/core/test/run-verify.test.ts` with exactly:

```ts
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractBlocksForFile } from "@megasaver/output-filter";
import type { MemoryEntryId, ProjectId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ExecGit, type MemoryRegistry, runVerify } from "../src/code-truth.js";
import type { CodeAnchor } from "../src/memory-anchor.js";
import { type MemoryEntry, memoryEntrySchema } from "../src/memory-entry.js";
import { type CoreRegistry, createInMemoryCoreRegistry } from "../src/registry.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const E1 = "00000000-0000-4000-8000-0000000000d1" as MemoryEntryId;
const E2 = "00000000-0000-4000-8000-0000000000d2" as MemoryEntryId;
const TS = "2026-07-13T00:00:00.000Z";
const EARLIER = "2026-07-10T00:00:00.000Z";
const NOW = "2026-07-14T12:00:00.000Z";
const LATER = "2026-07-14T13:00:00.000Z";
const OLD_HEAD = "1111111111111111111111111111111111111111";
const HEAD = "2222222222222222222222222222222222222222";
const FALSIFIER = "3333333333333333333333333333333333333333";
const ROOT = tmpdir();

function mem(over: Omit<Partial<MemoryEntry>, "id"> & { id: string }): MemoryEntry {
  return memoryEntrySchema.parse({
    id: over.id,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "auth verifies via verifyToken",
    content: "auth middleware validates requests via verifyToken",
    keywords: [],
    confidence: "medium",
    source: "manual",
    approval: "approved",
    stale: over.stale ?? false,
    createdAt: TS,
    updatedAt: TS,
    ...(over.anchor !== undefined ? { anchor: over.anchor } : {}),
    ...(over.lastVerified !== undefined ? { lastVerified: over.lastVerified } : {}),
    ...(over.validTo !== undefined ? { validTo: over.validTo } : {}),
    ...(over.evidence !== undefined ? { evidence: over.evidence } : {}),
  });
}

function freshRegistry(rootPath: string): CoreRegistry {
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath,
    createdAt: TS,
    updatedAt: TS,
  });
  return registry;
}

function fileAnchor(path = "src/a.ts"): CodeAnchor {
  return {
    repoHead: OLD_HEAD,
    capturedAt: TS,
    files: [{ path, blobSha: "blob-old" }],
    symbols: [],
  };
}

type FakeGitState = {
  head: string;
  blobs: Record<string, string>;
  renames?: string;
  attribution?: Record<string, string>;
};

function fakeGit(state: FakeGitState): ExecGit {
  return (args, _cwd, input) => {
    if (args[0] === "rev-parse") {
      return `${state.head}\n`;
    }
    if (args[0] === "cat-file") {
      const lines = (input ?? "").split("\n").filter((line) => line !== "");
      return `${lines
        .map((line) => {
          const sha = state.blobs[line.replace(/^HEAD:/, "")];
          return sha === undefined ? `${line} missing` : `${sha} blob 100`;
        })
        .join("\n")}\n`;
    }
    if (args.includes("diff")) {
      return state.renames ?? "";
    }
    if (args[0] === "log") {
      const path = args[args.length - 1] ?? "";
      const sha = state.attribution?.[path];
      return sha === undefined ? "" : `${sha}\n`;
    }
    throw new Error(`unexpected git args: ${args.join(" ")}`);
  };
}

function spy(registry: CoreRegistry): { registry: MemoryRegistry; calls: () => number } {
  let applyCalls = 0;
  return {
    registry: {
      listMemoryEntries: (projectId) => registry.listMemoryEntries(projectId),
      applyMemoryEntryPatches: (projectId, patches) => {
        applyCalls += 1;
        return registry.applyMemoryEntryPatches(projectId, patches);
      },
    },
    calls: () => applyCalls,
  };
}

describe("runVerify — mutation semantics (fake git)", () => {
  it("contradiction closes an open row and owns the close", async () => {
    const registry = freshRegistry(ROOT);
    registry.createMemoryEntry(mem({ id: E1, anchor: fileAnchor() }));
    const plan = await runVerify({
      registry,
      projectId: PROJECT_ID,
      rootPath: ROOT,
      now: NOW,
      execGit: fakeGit({ head: HEAD, blobs: {}, attribution: { "src/a.ts": FALSIFIER } }),
    });
    expect(plan.contradicted).toEqual([
      { id: E1, reason: "src/a.ts deleted", commit: FALSIFIER },
    ]);
    const entry = registry.getMemoryEntry(E1);
    expect(entry?.stale).toBe(true);
    expect(entry?.validTo).toBe(NOW);
    expect(entry?.lastVerified).toEqual({
      headSha: HEAD,
      at: NOW,
      result: "contradicted",
      closedByCodeTruth: true,
    });
    expect(entry?.evidence).toContain(
      `code-truth: contradicted by ${FALSIFIER.slice(0, 7)} — src/a.ts deleted`,
    );
    // Verify is observation, not use — decay anchor untouched.
    expect(entry?.lastActiveAt).toBe(TS);
  });

  it("contradiction on an already-closed row leaves validTo, flag false", async () => {
    const registry = freshRegistry(ROOT);
    registry.createMemoryEntry(mem({ id: E1, anchor: fileAnchor(), validTo: EARLIER }));
    const plan = await runVerify({
      registry,
      projectId: PROJECT_ID,
      rootPath: ROOT,
      now: NOW,
      execGit: fakeGit({ head: HEAD, blobs: {}, attribution: { "src/a.ts": FALSIFIER } }),
    });
    expect(plan.contradicted).toHaveLength(1);
    const entry = registry.getMemoryEntry(E1);
    expect(entry?.stale).toBe(true);
    expect(entry?.validTo).toBe(EARLIER);
    expect(entry?.lastVerified?.closedByCodeTruth).toBe(false);
  });

  it("B1 REGRESSION: heal never reopens a close owned by the lineage channel", async () => {
    const registry = freshRegistry(ROOT);
    // Supersession closed this row (validTo set by lineage); a later verify
    // marked it contradicted WITHOUT owning the close (closedByCodeTruth
    // false because the row was already closed).
    registry.createMemoryEntry(
      mem({
        id: E1,
        anchor: fileAnchor(),
        stale: true,
        validTo: EARLIER,
        lastVerified: { headSha: OLD_HEAD, at: TS, result: "contradicted", closedByCodeTruth: false },
      }),
    );
    const plan = await runVerify({
      registry,
      projectId: PROJECT_ID,
      rootPath: ROOT,
      now: NOW,
      execGit: fakeGit({ head: HEAD, blobs: { "src/a.ts": "blob-old" } }),
    });
    expect(plan.healed).toEqual([E1]);
    const entry = registry.getMemoryEntry(E1);
    expect(entry?.stale).toBe(false);
    // The lineage close survives the heal — A must NOT resurrect alongside B.
    expect(entry?.validTo).toBe(EARLIER);
    expect(entry?.lastVerified?.result).toBe("healed");
  });

  it("heal reopens validTo when code-truth itself owned the close", async () => {
    const registry = freshRegistry(ROOT);
    registry.createMemoryEntry(
      mem({
        id: E1,
        anchor: fileAnchor(),
        stale: true,
        validTo: EARLIER,
        lastVerified: { headSha: OLD_HEAD, at: TS, result: "contradicted", closedByCodeTruth: true },
      }),
    );
    const plan = await runVerify({
      registry,
      projectId: PROJECT_ID,
      rootPath: ROOT,
      now: NOW,
      execGit: fakeGit({ head: HEAD, blobs: { "src/a.ts": "blob-old" } }),
    });
    expect(plan.healed).toEqual([E1]);
    const entry = registry.getMemoryEntry(E1);
    expect(entry?.validTo).toBeNull();
    expect(entry?.lastVerified).toEqual({
      headSha: HEAD,
      at: NOW,
      result: "healed",
      closedByCodeTruth: false,
    });
    expect(entry?.evidence).toContain(
      `code-truth: healed at ${HEAD.slice(0, 7)} — hash matches again`,
    );
  });

  it("verified no-op: repeat verify at unchanged head writes nothing", async () => {
    const registry = freshRegistry(ROOT);
    registry.createMemoryEntry(
      mem({
        id: E1,
        anchor: fileAnchor(),
        lastVerified: { headSha: HEAD, at: TS, result: "verified", closedByCodeTruth: false },
      }),
    );
    const spied = spy(registry);
    const plan = await runVerify({
      registry: spied.registry,
      projectId: PROJECT_ID,
      rootPath: ROOT,
      now: NOW,
      execGit: fakeGit({ head: HEAD, blobs: { "src/a.ts": "blob-old" } }),
    });
    expect(plan.verified).toEqual([E1]);
    expect(spied.calls()).toBe(0);
    expect(registry.getMemoryEntry(E1)?.updatedAt).toBe(TS);
  });

  it("repeat contradiction at unchanged head appends no duplicate evidence", async () => {
    const registry = freshRegistry(ROOT);
    registry.createMemoryEntry(
      mem({
        id: E1,
        anchor: fileAnchor(),
        stale: true,
        validTo: EARLIER,
        lastVerified: { headSha: HEAD, at: TS, result: "contradicted", closedByCodeTruth: true },
        evidence: ["code-truth: contradicted by 3333333 — src/a.ts deleted"],
      }),
    );
    const spied = spy(registry);
    const plan = await runVerify({
      registry: spied.registry,
      projectId: PROJECT_ID,
      rootPath: ROOT,
      now: NOW,
      execGit: fakeGit({ head: HEAD, blobs: {}, attribution: { "src/a.ts": FALSIFIER } }),
    });
    expect(plan.contradicted).toHaveLength(1);
    expect(spied.calls()).toBe(0);
    expect(registry.getMemoryEntry(E1)?.evidence).toHaveLength(1);
  });

  it("stamps lastVerified on first verify with ONE batch apply", async () => {
    const registry = freshRegistry(ROOT);
    registry.createMemoryEntry(mem({ id: E1, anchor: fileAnchor() }));
    registry.createMemoryEntry(mem({ id: E2, anchor: fileAnchor() }));
    const spied = spy(registry);
    const plan = await runVerify({
      registry: spied.registry,
      projectId: PROJECT_ID,
      rootPath: ROOT,
      now: NOW,
      execGit: fakeGit({ head: HEAD, blobs: { "src/a.ts": "blob-old" } }),
    });
    expect(plan.verified).toEqual([E1, E2]);
    expect(spied.calls()).toBe(1);
    expect(registry.getMemoryEntry(E1)?.lastVerified?.headSha).toBe(HEAD);
  });

  it("scope.changedPaths filters candidates to anchors citing a changed path", async () => {
    const registry = freshRegistry(ROOT);
    registry.createMemoryEntry(mem({ id: E1, anchor: fileAnchor() }));
    registry.createMemoryEntry(mem({ id: E2, anchor: fileAnchor("src/other.ts") }));
    const plan = await runVerify({
      registry,
      projectId: PROJECT_ID,
      rootPath: ROOT,
      now: NOW,
      scope: { changedPaths: ["src/a.ts"] },
      execGit: fakeGit({ head: HEAD, blobs: {}, attribution: { "src/a.ts": FALSIFIER } }),
    });
    expect(plan.contradicted.map((item) => item.id)).toEqual([E1]);
    expect(plan.verified).toEqual([]);
    expect(registry.getMemoryEntry(E2)?.lastVerified).toBeUndefined();
  });

  it("rename detection repoints the anchor instead of contradicting", async () => {
    const registry = freshRegistry(ROOT);
    registry.createMemoryEntry(mem({ id: E1, anchor: fileAnchor() }));
    const plan = await runVerify({
      registry,
      projectId: PROJECT_ID,
      rootPath: ROOT,
      now: NOW,
      execGit: fakeGit({
        head: HEAD,
        blobs: { "src/b.ts": "blob-new" },
        renames: "R100\tsrc/a.ts\tsrc/b.ts\n",
      }),
    });
    expect(plan.repointed).toEqual([{ id: E1, from: "src/a.ts", to: "src/b.ts" }]);
    expect(plan.contradicted).toEqual([]);
    expect(registry.getMemoryEntry(E1)?.anchor?.files[0]?.path).toBe("src/b.ts");
  });

  it("non-git project degrades to unanchored and writes nothing", async () => {
    const registry = freshRegistry(ROOT);
    registry.createMemoryEntry(mem({ id: E1, anchor: fileAnchor() }));
    const failingGit: ExecGit = () => {
      throw new Error("not a git repository");
    };
    const plan = await runVerify({
      registry,
      projectId: PROJECT_ID,
      rootPath: ROOT,
      now: NOW,
      execGit: failingGit,
    });
    expect(plan.unanchored).toEqual([E1]);
    expect(registry.getMemoryEntry(E1)?.lastVerified).toBeUndefined();
  });
});

describe("runVerify — WOW loop on a real repo", () => {
  let repoDir: string;

  function git(args: string[]): string {
    return execFileSync("git", args, { cwd: repoDir, encoding: "utf8" });
  }

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), "megasaver-codetruth-repo-"));
    git(["init"]);
    git(["config", "user.email", "t@t"]);
    git(["config", "user.name", "t"]);
    mkdirSync(join(repoDir, "src"), { recursive: true });
    writeFileSync(
      join(repoDir, "src/auth.ts"),
      [
        "export function verifyToken(token: string): boolean {",
        "  return token.length > 0;",
        "}",
        "",
        "export function parseToken(token: string): string {",
        "  return token.trim();",
        "}",
        "",
      ].join("\n"),
    );
    git(["add", "."]);
    git(["commit", "-m", "add auth"]);
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it(
    "delete symbol -> commit -> contradicts naming the commit; revert -> heals",
    async () => {
      const anchorHead = git(["rev-parse", "HEAD"]).trim();
      const blobSha = git(["rev-parse", "HEAD:src/auth.ts"]).trim();
      const source = readFileSync(join(repoDir, "src/auth.ts"), "utf8");
      const extracted = await extractBlocksForFile("src/auth.ts", source);
      const symbol = extracted?.find((candidate) => candidate.name === "verifyToken");
      expect(symbol).toBeDefined();
      if (symbol === undefined) {
        throw new Error("fixture: verifyToken block not extracted");
      }

      const registry = freshRegistry(repoDir);
      registry.createMemoryEntry(
        mem({
          id: E1,
          anchor: {
            repoHead: anchorHead,
            capturedAt: TS,
            files: [{ path: "src/auth.ts", blobSha }],
            symbols: [
              {
                path: "src/auth.ts",
                name: "verifyToken",
                startLine: symbol.startLine,
                endLine: symbol.endLine,
                contentHash: symbol.contentHash,
              },
            ],
          },
        }),
      );

      // WOW step 1: a refactor deletes the anchored symbol.
      writeFileSync(
        join(repoDir, "src/auth.ts"),
        [
          "export function parseToken(token: string): string {",
          "  return token.trim();",
          "}",
          "",
        ].join("\n"),
      );
      git(["add", "."]);
      git(["commit", "-m", "remove verifyToken"]);
      const falsifier = git(["rev-parse", "HEAD"]).trim();

      const plan1 = await runVerify({
        registry,
        projectId: PROJECT_ID,
        rootPath: repoDir,
        now: NOW,
      });
      expect(plan1.contradicted).toEqual([
        { id: E1, reason: "src/auth.ts#verifyToken missing", commit: falsifier },
      ]);
      const closed = registry.getMemoryEntry(E1);
      expect(closed?.stale).toBe(true);
      expect(closed?.validTo).toBe(NOW);
      expect(closed?.lastVerified?.closedByCodeTruth).toBe(true);
      expect(closed?.evidence?.some((line) => line.includes(falsifier.slice(0, 7)))).toBe(true);

      // WOW step 2: the code reverts — the memory heals, reopening the close
      // it owns.
      git(["revert", "--no-edit", "HEAD"]);
      const plan2 = await runVerify({
        registry,
        projectId: PROJECT_ID,
        rootPath: repoDir,
        now: LATER,
      });
      expect(plan2.healed).toEqual([E1]);
      const healed = registry.getMemoryEntry(E1);
      expect(healed?.stale).toBe(false);
      expect(healed?.validTo).toBeNull();
      expect(healed?.lastVerified?.result).toBe("healed");
    },
    20000,
  );
});
```

- [ ] **Step 2: Run to verify FAIL.**
  `pnpm build && pnpm --filter @megasaver/core test`
  Expected: `test/run-verify.test.ts` fails at import time —
  `does not provide an export named 'runVerify'` (or `'ExecGit'` /
  `'MemoryRegistry'`) from `../src/code-truth.js`. Task 5's planner tests
  stay green.

- [ ] **Step 3: Implement the runner.** Replace the entire contents of
  `packages/core/src/code-truth.ts` with (planner from Task 5 unchanged,
  runner appended, imports extended):

```ts
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractBlocksForFile } from "@megasaver/output-filter";
import type { MemoryEntryId, ProjectId } from "@megasaver/shared";
import type { CodeAnchor } from "./memory-anchor.js";
import type { MemoryEntry, MemoryEntryUpdatePatch } from "./memory-entry.js";
import type { CoreRegistry } from "./registry.js";

export type ExtractedBlockLite = {
  name?: string;
  contentHash: string;
  startLine: number;
  endLine: number;
};

export type RepoState = {
  headSha: string;
  // path → current blob sha at HEAD, or "missing"
  blobs: ReadonlyMap<string, string | "missing">;
  // path → extracted blocks of the CURRENT worktree content (only for files
  // cited by symbol anchors, plus rename targets)
  blocks: ReadonlyMap<string, readonly ExtractedBlockLite[]>;
  // path → rename target discovered via `git diff -M` (present only when the
  // anchored path is missing and a rename was detected)
  renames: ReadonlyMap<string, string>;
  // path → falsifying commit sha (last commit touching path since anchor head)
  attribution: ReadonlyMap<string, string>;
};

export type VerifyPlan = {
  contradicted: Array<{ id: MemoryEntryId; reason: string; commit?: string }>;
  healed: MemoryEntryId[];
  verified: MemoryEntryId[];
  repointed: Array<{ id: MemoryEntryId; from: string; to: string }>;
  unanchored: MemoryEntryId[];
};

type Contradiction = { reason: string; path: string };

// First failing check for one entry, or undefined when every check passes.
// Contradiction policy (spec §6.2): a blob change ALONE never contradicts —
// file anchors are weak claims that only contradict on delete-without-rename;
// the unit of strong contradiction is the symbol hash. Name collisions at
// verify resolve optimistically: ANY same-name block matching the anchored
// hash verifies; contradiction only when none matches.
function firstContradiction(anchor: CodeAnchor, repo: RepoState): Contradiction | undefined {
  const effective = (path: string): string => repo.renames.get(path) ?? path;
  for (const file of anchor.files) {
    const blob = repo.blobs.get(effective(file.path)) ?? "missing";
    if (blob === "missing" && !repo.renames.has(file.path)) {
      return { reason: `${file.path} deleted`, path: file.path };
    }
  }
  for (const symbol of anchor.symbols) {
    const path = effective(symbol.path);
    const candidates = (repo.blocks.get(path) ?? []).filter(
      (candidate) => candidate.name === symbol.name,
    );
    if (candidates.length === 0) {
      return { reason: `${path}#${symbol.name} missing`, path };
    }
    if (!candidates.some((candidate) => candidate.contentHash === symbol.contentHash)) {
      return { reason: `${path}#${symbol.name} hash changed`, path };
    }
  }
  return undefined;
}

// Pure planner (spec §6.1) — fixture-testable, zero git. Heal is keyed
// STRICTLY on lastVerified.result === "contradicted" (architect B1: never
// evidence-string sniffing). The planner never inspects validTo: close
// ownership is an APPLY-time decision (runVerify), not a plan-time one.
// `now` is part of the pinned signature; timestamps are stamped at apply time.
export function verifyAnchors(
  entries: readonly MemoryEntry[],
  repo: RepoState,
  now: string,
): VerifyPlan {
  const plan: VerifyPlan = {
    contradicted: [],
    healed: [],
    verified: [],
    repointed: [],
    unanchored: [],
  };
  for (const entry of entries) {
    const anchor = entry.anchor;
    if (anchor === undefined) {
      plan.unanchored.push(entry.id);
      continue;
    }
    const cited = new Set<string>([
      ...anchor.files.map((file) => file.path),
      ...anchor.symbols.map((symbol) => symbol.path),
    ]);
    for (const path of cited) {
      const target = repo.renames.get(path);
      if (target !== undefined) {
        plan.repointed.push({ id: entry.id, from: path, to: target });
      }
    }
    const failure = firstContradiction(anchor, repo);
    if (failure !== undefined) {
      const commit = repo.attribution.get(failure.path);
      const reason =
        commit === undefined ? `${failure.reason} (uncommitted change)` : failure.reason;
      plan.contradicted.push({
        id: entry.id,
        reason,
        ...(commit !== undefined ? { commit } : {}),
      });
      continue;
    }
    if (entry.lastVerified?.result === "contradicted") {
      plan.healed.push(entry.id);
    } else {
      plan.verified.push(entry.id);
    }
  }
  return plan;
}

// ---------------------------------------------------------------------------
// Impure runner (spec §6.5 + §7)
// ---------------------------------------------------------------------------

// The registry surface the runner needs. There is no standalone
// MemoryRegistry interface in core — memory methods live on CoreRegistry —
// so the contract name is a Pick; any full CoreRegistry satisfies it.
export type MemoryRegistry = Pick<CoreRegistry, "listMemoryEntries" | "applyMemoryEntryPatches">;

// The optional third `input` feeds git's stdin (batched cat-file). A
// contract-shaped (args, cwd) => string function is still assignable, but a
// custom execGit MUST forward `input` or batch-check sees an empty stdin and
// every blob reads as missing. The default forwards it.
export type ExecGit = (args: string[], cwd: string, input?: string) => string;

// timeout so a stuck git (index.lock, slow FS) can't stall a hook run;
// tryGit catches the throw (mirrors apps/cli/src/git-delta.ts).
const defaultExecGit: ExecGit = (args, cwd, input) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "ignore"],
    timeout: 3000,
    maxBuffer: 10 * 1024 * 1024,
    ...(input === undefined ? {} : { input }),
  });

function tryGit(exec: ExecGit, args: string[], cwd: string, input?: string): string | null {
  try {
    return exec(args, cwd, input);
  } catch {
    return null;
  }
}

const sha7 = (sha: string): string => sha.slice(0, 7);

function citedPaths(anchor: CodeAnchor): Set<string> {
  return new Set([
    ...anchor.files.map((file) => file.path),
    ...anchor.symbols.map((symbol) => symbol.path),
  ]);
}

// One spawn for every anchored blob: `HEAD:<path>` lines on stdin,
// `<sha> blob <size>` / `<name> missing` lines out, order preserved.
function batchCheckBlobs(
  exec: ExecGit,
  cwd: string,
  paths: readonly string[],
): Array<[string, string | "missing"]> {
  if (paths.length === 0) {
    return [];
  }
  const input = `${paths.map((path) => `HEAD:${path}`).join("\n")}\n`;
  const out = tryGit(exec, ["cat-file", "--batch-check"], cwd, input);
  if (out === null) {
    return paths.map((path) => [path, "missing"]);
  }
  const lines = out.split("\n");
  return paths.map((path, index) => {
    const line = lines[index] ?? "";
    if (line === "" || line.endsWith(" missing")) {
      return [path, "missing"];
    }
    const sha = line.split(" ")[0];
    return [path, sha === undefined || sha === "" ? "missing" : sha];
  });
}

export async function runVerify(opts: {
  registry: MemoryRegistry;
  projectId: ProjectId;
  rootPath: string;
  now: string;
  scope?: { changedPaths: readonly string[] };
  execGit?: (args: string[], cwd: string) => string;
}): Promise<VerifyPlan> {
  const exec: ExecGit = opts.execGit ?? defaultExecGit;
  const entries = opts.registry.listMemoryEntries(opts.projectId);
  const changed = opts.scope === undefined ? undefined : new Set(opts.scope.changedPaths);
  const candidates =
    changed === undefined
      ? entries
      : entries.filter(
          (entry) =>
            entry.anchor !== undefined &&
            [...citedPaths(entry.anchor)].some((path) => changed.has(path)),
        );

  const headRaw = tryGit(exec, ["rev-parse", "HEAD"], opts.rootPath);
  if (headRaw === null) {
    // Non-git project (or broken repo): degrade gracefully — nothing can be
    // checked, so nothing is written (spec §2).
    return {
      contradicted: [],
      healed: [],
      verified: [],
      repointed: [],
      unanchored: candidates.map((entry) => entry.id),
    };
  }
  const headSha = headRaw.trim();

  const anchored = candidates.filter(
    (entry): entry is MemoryEntry & { anchor: CodeAnchor } => entry.anchor !== undefined,
  );

  // 1. One batched cat-file --batch-check for every anchored blob (§6.5).
  const allPaths = [...new Set(anchored.flatMap((entry) => [...citedPaths(entry.anchor)]))];
  const blobs = new Map<string, string | "missing">(
    batchCheckBlobs(exec, opts.rootPath, allPaths),
  );

  // 2. Renames for missing paths, per distinct anchor head (git diff -M).
  //    An unreachable anchor head (rebase/amend — N7) just yields no rename
  //    info; it must never throw the runner.
  const renames = new Map<string, string>();
  if (allPaths.some((path) => blobs.get(path) === "missing")) {
    const heads = new Set(
      anchored
        .filter((entry) => [...citedPaths(entry.anchor)].some((p) => blobs.get(p) === "missing"))
        .map((entry) => entry.anchor.repoHead),
    );
    for (const anchorHead of heads) {
      const out = tryGit(
        exec,
        ["-c", "core.quotePath=off", "diff", "--name-status", "-M", `${anchorHead}..HEAD`],
        opts.rootPath,
      );
      if (out === null) {
        continue;
      }
      for (const line of out.split("\n")) {
        const [status, from, to] = line.split("\t");
        if (
          status !== undefined &&
          status.startsWith("R") &&
          from !== undefined &&
          to !== undefined &&
          blobs.get(from) === "missing"
        ) {
          renames.set(from, to);
        }
      }
    }
    // Rename targets need blobs too — the planner re-checks under the new
    // path in the same pass.
    const targets = [...renames.values()].filter((path) => !blobs.has(path));
    for (const [path, blob] of batchCheckBlobs(exec, opts.rootPath, targets)) {
      blobs.set(path, blob);
    }
  }

  // 3. Re-extract worktree content for files cited by symbol anchors (§6.4:
  //    symbol existence is a WORKTREE question — disk read, not HEAD blobs).
  const blocks = new Map<string, readonly ExtractedBlockLite[]>();
  const symbolPaths = new Set(
    anchored.flatMap((entry) =>
      entry.anchor.symbols.map((symbol) => renames.get(symbol.path) ?? symbol.path),
    ),
  );
  for (const path of symbolPaths) {
    let source: string;
    try {
      source = readFileSync(join(opts.rootPath, path), "utf8");
    } catch {
      continue; // unreadable/deleted on disk ⇒ no blocks ⇒ symbols missing (N6)
    }
    const extracted = await extractBlocksForFile(path, source);
    if (extracted === undefined) {
      continue;
    }
    blocks.set(
      path,
      extracted.map((block) => ({
        contentHash: block.contentHash,
        startLine: block.startLine,
        endLine: block.endLine,
        ...(block.name !== undefined ? { name: block.name } : {}),
      })),
    );
  }

  // 4. Two-phase plan: a dry pass (pure, cheap) finds contradictions, then
  //    one `git log -n1` per contradicted entry's cited path attributes them,
  //    and the planner re-runs with attribution filled in.
  const dryRepo: RepoState = { headSha, blobs, blocks, renames, attribution: new Map() };
  const dryPlan = verifyAnchors(candidates, dryRepo, opts.now);
  const attribution = new Map<string, string>();
  const contradictedIds = new Set(dryPlan.contradicted.map((item) => item.id));
  for (const entry of anchored) {
    if (!contradictedIds.has(entry.id)) {
      continue;
    }
    for (const path of citedPaths(entry.anchor)) {
      const effectivePath = renames.get(path) ?? path;
      if (attribution.has(effectivePath)) {
        continue;
      }
      const out = tryGit(
        exec,
        ["log", "-n1", "--format=%H", `${entry.anchor.repoHead}..HEAD`, "--", effectivePath],
        opts.rootPath,
      );
      // Unreachable anchor head or untouched path ⇒ attribution unavailable
      // (N7) — commit stays absent, never a throw.
      const sha = out?.trim();
      if (sha !== undefined && sha !== "") {
        attribution.set(effectivePath, sha);
      }
    }
  }
  const plan = verifyAnchors(candidates, { headSha, blobs, blocks, renames, attribution }, opts.now);

  // 5. Mutations (§7) — merged per entry, applied in ONE batch. NEVER touches
  //    lastActiveAt: verify is observation, not use.
  const byId = new Map(candidates.map((entry) => [entry.id, entry] as const));
  const patchFor = new Map<MemoryEntryId, MemoryEntryUpdatePatch>();
  const upsertPatch = (
    id: MemoryEntryId,
    patch: Omit<Partial<MemoryEntryUpdatePatch>, "updatedAt">,
  ): void => {
    const current = patchFor.get(id) ?? { updatedAt: opts.now };
    patchFor.set(id, { ...current, ...patch, updatedAt: opts.now });
  };

  const rewrittenAnchors = new Map<MemoryEntryId, CodeAnchor>();
  for (const item of plan.repointed) {
    const entry = byId.get(item.id);
    if (entry?.anchor === undefined) {
      continue;
    }
    const current = rewrittenAnchors.get(item.id) ?? entry.anchor;
    rewrittenAnchors.set(item.id, {
      ...current,
      files: current.files.map((file) =>
        file.path === item.from ? { ...file, path: item.to } : file,
      ),
      symbols: current.symbols.map((symbol) =>
        symbol.path === item.from ? { ...symbol, path: item.to } : symbol,
      ),
    });
  }
  for (const [id, anchor] of rewrittenAnchors) {
    upsertPatch(id, { anchor });
  }

  for (const item of plan.contradicted) {
    const entry = byId.get(item.id);
    if (entry === undefined) {
      continue;
    }
    // Idempotence: a contradiction already recorded at this head is a no-op —
    // same principle as the verified suppression; evidence must not grow on
    // repeat runs at an unchanged head.
    if (entry.lastVerified?.result === "contradicted" && entry.lastVerified.headSha === headSha) {
      continue;
    }
    const open = entry.validTo == null; // null OR undefined — row still current
    const evidenceLine =
      item.commit === undefined
        ? `code-truth: contradicted — ${item.reason}`
        : `code-truth: contradicted by ${sha7(item.commit)} — ${item.reason}`;
    upsertPatch(item.id, {
      stale: true,
      ...(open ? { validTo: opts.now } : {}),
      evidence: [...(entry.evidence ?? []), evidenceLine],
      lastVerified: {
        headSha,
        at: opts.now,
        result: "contradicted",
        // B1 close ownership: true ONLY when this contradiction itself closed
        // an open row. A row already closed by lineage/manual keeps false so
        // a later heal never reopens a close it does not own.
        closedByCodeTruth: open,
      },
    });
  }

  for (const id of plan.healed) {
    const entry = byId.get(id);
    if (entry === undefined) {
      continue;
    }
    const ownedClose = entry.lastVerified?.closedByCodeTruth === true;
    upsertPatch(id, {
      stale: false,
      ...(ownedClose ? { validTo: null } : {}),
      evidence: [
        ...(entry.evidence ?? []),
        `code-truth: healed at ${sha7(headSha)} — hash matches again`,
      ],
      lastVerified: { headSha, at: opts.now, result: "healed", closedByCodeTruth: false },
    });
  }

  for (const id of plan.verified) {
    const entry = byId.get(id);
    if (entry === undefined) {
      continue;
    }
    // No-op suppression (§7): repeat verifies at an unchanged head write
    // nothing — keeps them free and updatedAt honest.
    if (entry.lastVerified?.headSha === headSha) {
      continue;
    }
    upsertPatch(id, {
      lastVerified: { headSha, at: opts.now, result: "verified", closedByCodeTruth: false },
    });
  }

  const patches = [...patchFor.entries()].map(([id, patch]) => ({ id, patch }));
  if (patches.length > 0) {
    opts.registry.applyMemoryEntryPatches(opts.projectId, patches);
  }
  return plan;
}
```

  (No `index.ts` change needed — Task 5's `export * from "./code-truth.js";`
  already surfaces `runVerify`, `MemoryRegistry`, and `ExecGit`.)

- [ ] **Step 4: Run to verify PASS.**
  `pnpm build && pnpm --filter @megasaver/core test`
  Expected: all 11 runner tests green (10 fake-git + 1 WOW integration),
  Task 5/6 tests still green, full suite green. If the WOW test fails on the
  `symbol` extraction assert, inspect what `extractBlocksForFile` names TS
  function blocks (`node -e` one-liner against the built dist) before
  touching the runner — the fix belongs in the test fixture, not the engine.

- [ ] **Step 5: Gates.** `pnpm lint:fix && pnpm typecheck` — both clean.
  Watch for TS4111 on any `Record` access introduced by lint rewrites; keep
  bracket access with the biome-ignore comment if it fires.

- [ ] **Step 6: Commit.**
  ```bash
  git add packages/core/src/code-truth.ts packages/core/test/run-verify.test.ts
  git commit -m "feat(core): code-truth verify runner

Two-phase plan keeps the planner pure; one batched cat-file spawn
and one registry batch write per run. B1 close ownership: heal
reopens validTo only when the contradiction itself closed the row."
  ```

---
# Section C — CLI package (Tasks 8–13)

All commands run from the worktree root:
`/Users/halitozger/Desktop/MegaSaver/.claude/worktrees/living-brain`
(branch `feat/living-brain`).

**Prerequisites:** Section A (core) must be green first — these tasks import
`captureCodeAnchor` and `runVerify` from `@megasaver/core`, rely on
`anchor`/`lastVerified` existing on `memoryEntrySchema` AND
`memoryEntryUpdatePatchSchema`, and on `ProFeature` containing `"code-truth"`.
Note: the contract's `MemoryRegistry` is spelled `CoreRegistry` in code — the
CLI just passes the registry from `ensureStoreReady` unchanged.

**Environment hazards (apply to every task below):**

- Mega Saver MCP read-proxy SILENTLY TRUNCATES file reads (banner "N kept, M
  dropped" / "[Mega Saver: compressed...]") — read files via `sed -n 'A,Bp'`
  in <=60-line chunks, locate with `grep -n`. Never trust a proxied read.
- `pnpm build` BEFORE package tests (`@megasaver/cli` resolves `@megasaver/core`
  via `dist/`; Section A changed core).
- `pnpm --filter @megasaver/cli test -- <pattern>` does NOT narrow. Single
  file: `pnpm --filter @megasaver/cli exec vitest run test/memory/<file>.test.ts`.
- Full `pnpm typecheck` REQUIRED before every commit — package vitest does NOT
  catch TS4111 (`noPropertyAccessFromIndexSignature`). If it fires, use bracket
  access + `// biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)`.
- Citty `--no-<name>` negation sets the arg it NAMES: an `anchor` boolean arg
  with `default: true` reads `args.anchor !== false`; multi-word args are read
  in kebab form (`args["install-hook"]`). Opt-out flags are positive names
  with `default: true`, never `noX` args.
- Branded IDs: raw string literals in tests need `as ProjectId` /
  `as MemoryEntryId` casts where a branded type is required.
- tsconfig is `strict` with `exactOptionalPropertyTypes` — never assign an
  explicit `undefined` to an optional property; use conditional spreads
  (`...(x !== undefined ? { x } : {})`), exactly as the code below does.

---

### Task 8: `--symbol` plumbing — the missing `relatedSymbols` writer

`relatedSymbols` is read by four surfaces but written by NO writer (spec §5.1,
architect M1). The symbol is the contradiction unit, so this is a hard
prerequisite for capture. This task adds a repeatable
`--symbol <name|path#name>` flag to `mega memory create` and
`mega memory update`, normalized via the existing `toStringArray` boundary
helper (citty yields bare string for one occurrence, `string[]` for several).
No capture yet — pure plumbing. The `rootPath` resolution for update-side
re-capture (via `registry.getMemoryEntry(id).projectId →
registry.getProject(...)`) lands in Task 9 where capture consumes it — wiring
it here would be dead code with nothing observable to test.

**Files:**

- Modify: `apps/cli/src/commands/memory/create.ts`
- Modify: `apps/cli/src/commands/memory/update.ts`
- Create (test): `apps/cli/test/memory/symbol-flag.test.ts`

**Steps:**

- [ ] **Step 1: Confirm the worktree.**
  `cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/living-brain && git branch --show-current`
  must print `feat/living-brain`. Run `pnpm build` once so `@megasaver/core`
  dist (Section A output) is current.

- [ ] **Step 2: Write the failing test.** Create
  `apps/cli/test/memory/symbol-flag.test.ts` with exactly:

```ts
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "citty";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryCreateCommand, runMemoryCreate } from "../../src/commands/memory/create.js";
import { runMemoryUpdate } from "../../src/commands/memory/update.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SEED_ID = "33333333-3333-4333-8333-333333333333";
const NEW_ID = "55555555-5555-4555-8555-555555555555";
const TS = "2026-07-01T00:00:00.000Z";
const NOW = "2026-07-14T00:00:00.000Z";

type StoredRow = {
  id: string;
  relatedFiles?: string[];
  relatedSymbols?: string[];
  lastActiveAt?: string;
};

describe("mega memory create/update --symbol", () => {
  let store: string;
  const lines: string[] = [];
  const errLines: string[] = [];
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
  const originalNodeEnv = process.env["NODE_ENV"];

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-symbol-flag-"));
    lines.length = 0;
    errLines.length = 0;
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = 0;
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = 0;
    // biome-ignore lint/performance/noDelete: process.env clear semantics require delete
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    delete process.env["MEGA_TEST_MEMORY_ENTRY_ID"];
    // biome-ignore lint/performance/noDelete: process.env clear semantics require delete
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    delete process.env["MEGA_TEST_NOW"];
    // biome-ignore lint/performance/noDelete: restoring env to absent state requires delete
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    if (originalNodeEnv === undefined) delete process.env["NODE_ENV"];
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    else process.env["NODE_ENV"] = originalNodeEnv;
    await rm(store, { recursive: true, force: true });
  });

  async function seedStore(): Promise<void> {
    await mkdir(join(store, "memory"), { recursive: true });
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        { id: PROJECT_ID, name: "demo", rootPath: "/tmp", createdAt: TS, updatedAt: TS },
      ]),
    );
    await writeFile(join(store, "sessions.json"), "[]");
    const seed = {
      id: SEED_ID,
      projectId: PROJECT_ID,
      sessionId: null,
      scope: "project",
      type: "decision",
      title: "seed",
      content: "seed",
      keywords: [],
      confidence: "medium",
      source: "manual",
      approval: "approved",
      stale: false,
      createdAt: TS,
      updatedAt: TS,
    };
    await writeFile(join(store, "memory", `${PROJECT_ID}.jsonl`), `${JSON.stringify(seed)}\n`);
  }

  async function readRows(): Promise<StoredRow[]> {
    const raw = await readFile(join(store, "memory", `${PROJECT_ID}.jsonl`), "utf8");
    return raw
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as StoredRow);
  }

  function makeCreateInput(
    over: Partial<Parameters<typeof runMemoryCreate>[0]>,
  ): Parameters<typeof runMemoryCreate>[0] {
    return {
      projectName: "demo",
      scopeFlag: "project",
      contentFlag: "use zod at boundaries",
      sessionFlag: undefined,
      storeFlag: store,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
      home: process.env["HOME"] ?? "",
      xdgDataHome: undefined,
      platform: process.platform,
      localAppData: undefined,
      stdout: (line) => lines.push(line),
      stderr: (line) => errLines.push(line),
      newId: () => NEW_ID,
      now: () => NOW,
      ...over,
    };
  }

  function makeUpdateInput(
    over: Partial<Parameters<typeof runMemoryUpdate>[0]>,
  ): Parameters<typeof runMemoryUpdate>[0] {
    return {
      memoryEntryId: SEED_ID,
      typeFlag: undefined,
      titleFlag: undefined,
      contentFlag: undefined,
      confidenceFlag: undefined,
      sourceFlag: undefined,
      reasonFlag: undefined,
      goalFlag: undefined,
      keywordFlags: undefined,
      fileFlags: undefined,
      symbolFlags: undefined,
      staleFlag: undefined,
      expiresFlag: undefined,
      storeFlag: store,
      jsonFlag: false,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
      home: process.env["HOME"] ?? "",
      xdgDataHome: undefined,
      platform: process.platform,
      localAppData: undefined,
      stdout: (line) => lines.push(line),
      stderr: (line) => errLines.push(line),
      now: () => NOW,
      ...over,
    };
  }

  it("create persists --symbol values as relatedSymbols", async () => {
    await seedStore();
    const code = await runMemoryCreate(
      makeCreateInput({
        fileFlags: ["src/auth.ts"],
        symbolFlags: ["src/auth.ts#verifyToken", "helper"],
      }),
    );
    expect(code).toBe(0);
    const rows = await readRows();
    const created = rows.find((r) => r.id === NEW_ID);
    expect(created?.relatedSymbols).toEqual(["src/auth.ts#verifyToken", "helper"]);
  });

  it("citty parse path: a single --symbol survives as a one-element array", async () => {
    await seedStore();
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    process.env["NODE_ENV"] = "test";
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    process.env["MEGA_TEST_MEMORY_ENTRY_ID"] = NEW_ID;
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    process.env["MEGA_TEST_NOW"] = NOW;
    await runCommand(memoryCreateCommand, {
      rawArgs: [
        "demo",
        "--scope",
        "project",
        "--content",
        "use zod at boundaries",
        "--symbol",
        "verifyToken",
        "--store",
        store,
      ],
    });
    expect(process.exitCode).toBe(0);
    const rows = await readRows();
    expect(rows.find((r) => r.id === NEW_ID)?.relatedSymbols).toEqual(["verifyToken"]);
  });

  it("update replaces relatedSymbols and refreshes the decay anchor", async () => {
    await seedStore();
    const code = await runMemoryUpdate(makeUpdateInput({ symbolFlags: ["a#x", "y"] }));
    expect(code).toBe(0);
    const rows = await readRows();
    const updated = rows.find((r) => r.id === SEED_ID);
    expect(updated?.relatedSymbols).toEqual(["a#x", "y"]);
    // symbols are content-bearing: lastActiveAt re-keys decay (i1 pattern)
    expect(updated?.lastActiveAt).toBe(NOW);
  });
});
```

- [ ] **Step 3: Run to verify FAIL.**
  `pnpm build && pnpm --filter @megasaver/cli exec vitest run test/memory/symbol-flag.test.ts`
  Expected: test 1 and test 3 fail with
  `AssertionError: expected undefined to deeply equal [ 'src/auth.ts#verifyToken', 'helper' ]`
  (the input property `symbolFlags` does not exist yet, so it is silently
  dropped); test 2 fails the same way (`--symbol` is an undeclared flag).
  `makeUpdateInput` also fails `pnpm typecheck` right now (unknown
  `symbolFlags` key) — that is part of the red state.

- [ ] **Step 4: Implement create.ts plumbing.** In
  `apps/cli/src/commands/memory/create.ts`, apply exactly these four edits:

  (a) In `RunMemoryCreateInput`, after the line `fileFlags?: unknown;` add:

```ts
  symbolFlags?: unknown;
```

  (b) In `runMemoryCreate`, replace the line
  `const relatedFiles = toStringArray(input.fileFlags);` with:

```ts
  const relatedFiles = toStringArray(input.fileFlags);
  const relatedSymbols = toStringArray(input.symbolFlags);
```

  (c) In the `memoryEntrySchema.parse({ ... })` object, after the line
  `...(relatedFiles.length > 0 ? { relatedFiles } : {}),` add:

```ts
      ...(relatedSymbols.length > 0 ? { relatedSymbols } : {}),
```

  (d) In the `defineCommand` `args`, after the
  `file: { type: "string", description: "Related file path (repeatable)." },`
  line add:

```ts
    symbol: {
      type: "string",
      description: "Related symbol name or path#name (repeatable).",
    },
```

  and in the `run({ args })` wrapper, after `fileFlags: args.file,` add:

```ts
      symbolFlags: args.symbol,
```

- [ ] **Step 5: Implement update.ts plumbing.** In
  `apps/cli/src/commands/memory/update.ts`, apply exactly these four edits:

  (a) In `RunMemoryUpdateInput`, after the line `fileFlags: unknown;` add:

```ts
  symbolFlags: unknown;
```

  (b) In `runMemoryUpdate`, after the `if (input.fileFlags !== undefined) { ... }`
  block (the one ending `contentBearing = true;` for `patch.relatedFiles`), add:

```ts
  if (input.symbolFlags !== undefined) {
    patch.relatedSymbols = toStringArray(input.symbolFlags);
    touched = true;
    contentBearing = true;
  }
```

  (c) In the `defineCommand` `args`, after the
  `file: { type: "string", description: "Replace related files (repeatable)." },`
  line add:

```ts
    symbol: {
      type: "string",
      description: "Replace related symbols, name or path#name (repeatable).",
    },
```

  (d) In the `run({ args })` wrapper, after `fileFlags: args.file,` add:

```ts
      symbolFlags: args.symbol,
```

  (`memoryEntryUpdatePatchSchema` already carries
  `relatedSymbols: z.array(z.string()).optional()` — verified at
  `packages/core/src/memory-entry.ts:338` — so no core change is needed.)

- [ ] **Step 6: Run to verify PASS.**
  `pnpm build && pnpm --filter @megasaver/cli exec vitest run test/memory/symbol-flag.test.ts`
  Expected: 3 passed. Then the full gates:
  `pnpm lint:fix && pnpm typecheck && pnpm --filter @megasaver/cli test`
  — all green, zero regressions.

- [ ] **Step 7: Commit.**

```bash
git add apps/cli/src/commands/memory/create.ts apps/cli/src/commands/memory/update.ts apps/cli/test/memory/symbol-flag.test.ts
git commit -m "feat(cli): --symbol flag plumbs relatedSymbols"
```

---

### Task 9: Anchor capture on every CLI writer

Wire `captureCodeAnchor` (from `@megasaver/core`, Section A) into the four CLI
writers per spec §5.1: `create` and `update` get a positive boolean `anchor`
arg with `default: true` (`--no-anchor` opts out — citty negation sets
`args.anchor = false`); `task status --save-summary` and
`memory from-session` capture unconditionally (agents/extractions don't get an
opt-out). Capture is best-effort TOTAL: any failure returns `undefined` and
the save proceeds unanchored. On update, a failed re-capture leaves the stored
anchor untouched — verify repoints/contradicts it from repo state later.

**Files:**

- Modify: `apps/cli/src/commands/memory/create.ts`
- Modify: `apps/cli/src/commands/memory/update.ts`
- Modify: `apps/cli/src/commands/task/status.ts`
- Modify: `apps/cli/src/commands/memory/from-session.ts`
- Create (test): `apps/cli/test/memory/create-anchor.test.ts`

**Steps:**

- [ ] **Step 1: Write the failing test.** Create
  `apps/cli/test/memory/create-anchor.test.ts` with exactly:

```ts
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "citty";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryCreateCommand, runMemoryCreate } from "../../src/commands/memory/create.js";
import { runMemoryFromSession } from "../../src/commands/memory/from-session.js";
import { runMemoryUpdate } from "../../src/commands/memory/update.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const SEED_ID = "33333333-3333-4333-8333-333333333333";
const FA_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NEW_ID = "55555555-5555-4555-8555-555555555555";
const TS = "2026-07-01T00:00:00.000Z";
const NOW = "2026-07-14T00:00:00.000Z";
const SHA40 = /^[0-9a-f]{40}$/;

type StoredRow = {
  id: string;
  source?: string;
  anchor?: {
    repoHead: string;
    capturedAt: string;
    files: Array<{ path: string; blobSha: string }>;
    symbols: Array<{ path: string; name: string; contentHash: string }>;
  };
};

describe("anchor capture on CLI writers", () => {
  let store: string;
  let repo: string;
  const lines: string[] = [];
  const errLines: string[] = [];
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
  const originalNodeEnv = process.env["NODE_ENV"];

  function git(args: string[], cwd: string): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
  }

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-anchor-store-"));
    repo = await mkdtemp(join(tmpdir(), "megasaver-anchor-repo-"));
    lines.length = 0;
    errLines.length = 0;
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = 0;
    git(["init"], repo);
    git(["config", "user.email", "t@t"], repo);
    git(["config", "user.name", "t"], repo);
    await writeFile(join(repo, "a.ts"), "export function foo(): number {\n  return 1;\n}\n");
    git(["add", "."], repo);
    git(["commit", "-m", "add a"], repo);
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = 0;
    // biome-ignore lint/performance/noDelete: process.env clear semantics require delete
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    delete process.env["MEGA_TEST_MEMORY_ENTRY_ID"];
    // biome-ignore lint/performance/noDelete: process.env clear semantics require delete
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    delete process.env["MEGA_TEST_NOW"];
    // biome-ignore lint/performance/noDelete: restoring env to absent state requires delete
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    if (originalNodeEnv === undefined) delete process.env["NODE_ENV"];
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    else process.env["NODE_ENV"] = originalNodeEnv;
    await rm(store, { recursive: true, force: true });
    await rm(repo, { recursive: true, force: true });
  });

  async function seedStore(rootPath: string, withFailure = false): Promise<void> {
    await mkdir(join(store, "memory"), { recursive: true });
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        { id: PROJECT_ID, name: "demo", rootPath, createdAt: TS, updatedAt: TS },
      ]),
    );
    await writeFile(
      join(store, "sessions.json"),
      JSON.stringify([
        {
          id: SESSION_ID,
          projectId: PROJECT_ID,
          agentId: "claude-code",
          riskLevel: "medium",
          title: "demo session",
          startedAt: TS,
          endedAt: null,
        },
      ]),
    );
    const seed = {
      id: SEED_ID,
      projectId: PROJECT_ID,
      sessionId: null,
      scope: "project",
      type: "decision",
      title: "seed",
      content: "seed",
      keywords: [],
      confidence: "medium",
      source: "manual",
      approval: "approved",
      stale: false,
      createdAt: TS,
      updatedAt: TS,
    };
    await writeFile(join(store, "memory", `${PROJECT_ID}.jsonl`), `${JSON.stringify(seed)}\n`);
    if (withFailure) {
      await mkdir(join(store, "failed-attempts"), { recursive: true });
      const failure = {
        id: FA_ID,
        projectId: PROJECT_ID,
        sessionId: SESSION_ID,
        task: "fix foo",
        failedStep: "run tests",
        relatedFiles: ["a.ts"],
        convertedToRule: false,
        createdAt: TS,
      };
      await writeFile(
        join(store, "failed-attempts", `${PROJECT_ID}.jsonl`),
        `${JSON.stringify(failure)}\n`,
      );
    }
  }

  async function readRows(): Promise<StoredRow[]> {
    const raw = await readFile(join(store, "memory", `${PROJECT_ID}.jsonl`), "utf8");
    return raw
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as StoredRow);
  }

  function makeCreateInput(
    over: Partial<Parameters<typeof runMemoryCreate>[0]>,
  ): Parameters<typeof runMemoryCreate>[0] {
    return {
      projectName: "demo",
      scopeFlag: "project",
      contentFlag: "foo returns 1",
      sessionFlag: undefined,
      storeFlag: store,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
      home: process.env["HOME"] ?? "",
      xdgDataHome: undefined,
      platform: process.platform,
      localAppData: undefined,
      stdout: (line) => lines.push(line),
      stderr: (line) => errLines.push(line),
      newId: () => NEW_ID,
      now: () => NOW,
      ...over,
    };
  }

  it("create captures an anchor when files/symbols are cited in a git repo", async () => {
    await seedStore(repo);
    const code = await runMemoryCreate(
      makeCreateInput({ fileFlags: ["a.ts"], symbolFlags: ["foo"] }),
    );
    expect(code).toBe(0);
    const created = (await readRows()).find((r) => r.id === NEW_ID);
    expect(created?.anchor).toBeDefined();
    expect(created?.anchor?.repoHead).toMatch(SHA40);
    expect(created?.anchor?.files).toEqual([
      { path: "a.ts", blobSha: expect.stringMatching(SHA40) },
    ]);
    expect(created?.anchor?.symbols[0]?.name).toBe("foo");
    expect(created?.anchor?.symbols[0]?.path).toBe("a.ts");
  });

  it("citty parse path: --no-anchor skips capture", async () => {
    await seedStore(repo);
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    process.env["NODE_ENV"] = "test";
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    process.env["MEGA_TEST_MEMORY_ENTRY_ID"] = NEW_ID;
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    process.env["MEGA_TEST_NOW"] = NOW;
    await runCommand(memoryCreateCommand, {
      rawArgs: [
        "demo",
        "--scope",
        "project",
        "--content",
        "foo returns 1",
        "--file",
        "a.ts",
        "--no-anchor",
        "--store",
        store,
      ],
    });
    expect(process.exitCode).toBe(0);
    const created = (await readRows()).find((r) => r.id === NEW_ID);
    expect(created).toBeDefined();
    expect(created?.anchor).toBeUndefined();
  });

  it("non-git project root degrades to an unanchored save", async () => {
    await seedStore(store); // the store dir is not a git repo
    const code = await runMemoryCreate(makeCreateInput({ fileFlags: ["a.ts"] }));
    expect(code).toBe(0);
    const created = (await readRows()).find((r) => r.id === NEW_ID);
    expect(created).toBeDefined();
    expect(created?.anchor).toBeUndefined();
  });

  it("update re-captures when --file changes", async () => {
    await seedStore(repo);
    const code = await runMemoryUpdate({
      memoryEntryId: SEED_ID,
      typeFlag: undefined,
      titleFlag: undefined,
      contentFlag: undefined,
      confidenceFlag: undefined,
      sourceFlag: undefined,
      reasonFlag: undefined,
      goalFlag: undefined,
      keywordFlags: undefined,
      fileFlags: ["a.ts"],
      symbolFlags: ["foo"],
      staleFlag: undefined,
      expiresFlag: undefined,
      storeFlag: store,
      jsonFlag: false,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
      home: process.env["HOME"] ?? "",
      xdgDataHome: undefined,
      platform: process.platform,
      localAppData: undefined,
      stdout: (line) => lines.push(line),
      stderr: (line) => errLines.push(line),
      now: () => NOW,
    });
    expect(code).toBe(0);
    const updated = (await readRows()).find((r) => r.id === SEED_ID);
    expect(updated?.anchor).toBeDefined();
    expect(updated?.anchor?.symbols[0]?.name).toBe("foo");
  });

  it("from-session captures anchors for candidates that cite files", async () => {
    await seedStore(repo, true);
    const code = await runMemoryFromSession({
      sessionId: SESSION_ID,
      storeFlag: store,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
      home: process.env["HOME"] ?? "",
      xdgDataHome: undefined,
      platform: process.platform,
      localAppData: undefined,
      jsonFlag: false,
      now: NOW,
      stdout: (line) => lines.push(line),
      stderr: (line) => errLines.push(line),
    } as Parameters<typeof runMemoryFromSession>[0]);
    expect(code).toBe(0);
    const rows = await readRows();
    const extracted = rows.find((r) => r.id !== SEED_ID && r.anchor !== undefined);
    expect(extracted).toBeDefined();
    expect(extracted?.anchor?.files[0]?.path).toBe("a.ts");
  });
});
```

- [ ] **Step 2: Run to verify FAIL.**
  `pnpm build && pnpm --filter @megasaver/cli exec vitest run test/memory/create-anchor.test.ts`
  Expected: tests 1, 4, 5 fail with
  `AssertionError: expected undefined to be defined` (no anchor field is
  written yet). Tests 2 and 3 pass vacuously — the red signal is 1/4/5.

- [ ] **Step 3: Implement create.ts capture.** In
  `apps/cli/src/commands/memory/create.ts`:

  (a) Add `captureCodeAnchor` to the `@megasaver/core` import list (it is
  alphabetical — after `POSSIBLE_SUPERSEDES_PREFIX`):

```ts
import {
  type MemoryEntry,
  POSSIBLE_SUPERSEDES_PREFIX,
  captureCodeAnchor,
  memoryConfidenceSchema,
  memoryEntrySchema,
  memoryScopeSchema,
  memorySourceSchema,
  memoryTypeSchema,
  saveMemoryWithLineage,
} from "@megasaver/core";
```

  (b) In `RunMemoryCreateInput`, after `symbolFlags?: unknown;` add:

```ts
  anchorFlag?: boolean | undefined;
```

  (c) In `runMemoryCreate`, replace the line
  `const createdAt = readTestEnv("MEGA_TEST_NOW") ?? now();` with:

```ts
    const createdAt = readTestEnv("MEGA_TEST_NOW") ?? now();

    // Best-effort capture (spec §5): any failure — non-git root, untracked
    // file, extractor throw — yields undefined and the save proceeds
    // unanchored. Skipped entirely when nothing is cited (no git spawn).
    const anchor =
      input.anchorFlag === false || (relatedFiles.length === 0 && relatedSymbols.length === 0)
        ? undefined
        : await captureCodeAnchor({
            rootPath: project.rootPath,
            relatedFiles,
            relatedSymbols,
            now: createdAt,
          });
```

  (d) In the `memoryEntrySchema.parse({ ... })` object, after
  `...(relatedSymbols.length > 0 ? { relatedSymbols } : {}),` add:

```ts
      ...(anchor !== undefined ? { anchor } : {}),
```

  (e) In `defineCommand` `args`, after the `symbol:` entry add:

```ts
    anchor: {
      type: "boolean",
      default: true,
      description: "Capture a code anchor from cited files/symbols (--no-anchor to skip).",
    },
```

  (f) In the `run({ args })` wrapper, after `symbolFlags: args.symbol,` add
  (single-word flag: citty negation lands on the same key):

```ts
      anchorFlag: args.anchor !== false,
```

- [ ] **Step 4: Implement update.ts re-capture.** In
  `apps/cli/src/commands/memory/update.ts`:

  (a) Extend the `@megasaver/core` import:

```ts
import {
  type MemoryEntryUpdatePatch,
  captureCodeAnchor,
  memoryConfidenceSchema,
  memorySourceSchema,
  memoryTypeSchema,
} from "@megasaver/core";
```

  (b) In `RunMemoryUpdateInput`, after `symbolFlags: unknown;` add:

```ts
  anchorFlag?: boolean | undefined;
```

  (c) In the try block, replace:

```ts
    if (registry.getMemoryEntry(parsedId) === null) {
      const cli = memoryEntryNotFoundMessage(parsedId);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    const updated = registry.updateMemoryEntry(parsedId, patch);
```

  with:

```ts
    const existing = registry.getMemoryEntry(parsedId);
    if (existing === null) {
      const cli = memoryEntryNotFoundMessage(parsedId);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    // Re-capture when citations change (spec §5.1). Best-effort: a failed
    // capture leaves the stored anchor untouched — verify will contradict or
    // repoint it from repo state if it drifted.
    if (
      input.anchorFlag !== false &&
      (input.fileFlags !== undefined || input.symbolFlags !== undefined)
    ) {
      const project = registry.getProject(existing.projectId);
      if (project !== null) {
        const anchor = await captureCodeAnchor({
          rootPath: project.rootPath,
          relatedFiles: patch.relatedFiles ?? existing.relatedFiles ?? [],
          relatedSymbols: patch.relatedSymbols ?? existing.relatedSymbols ?? [],
          now: updatedAt,
        });
        if (anchor !== undefined) patch.anchor = anchor;
      }
    }
    const updated = registry.updateMemoryEntry(parsedId, patch);
```

  (d) In `defineCommand` `args`, after the `symbol:` entry add:

```ts
    anchor: {
      type: "boolean",
      default: true,
      description: "Re-capture the code anchor when citations change (--no-anchor to skip).",
    },
```

  and in the wrapper after `symbolFlags: args.symbol,` add:

```ts
      anchorFlag: args.anchor !== false,
```

- [ ] **Step 5: Implement task/status.ts capture.** In
  `apps/cli/src/commands/task/status.ts`:

  (a) Add `captureCodeAnchor` to the `@megasaver/core` import:

```ts
import {
  type MemoryEntry,
  captureCodeAnchor,
  memoryEntrySchema,
  readySteps,
  saveMemoryWithLineage,
} from "@megasaver/core";
```

  (b) Inside the `--save-summary` block, replace the line
  `const ts = readTestEnv("MEGA_TEST_NOW") ?? now();` with:

```ts
      const ts = readTestEnv("MEGA_TEST_NOW") ?? now();
      const project = registry.getProject(plan.projectId);
      // Summaries cite no files today, so this returns undefined until they
      // do — wired per spec §5.1 writer table (every writer auto-captures).
      const anchor =
        project === null
          ? undefined
          : await captureCodeAnchor({ rootPath: project.rootPath, relatedFiles: [], now: ts });
```

  (c) In the summary `memoryEntrySchema.parse({ ... })` object, after
  `source: "session_summary",` add:

```ts
        ...(anchor !== undefined ? { anchor } : {}),
```

- [ ] **Step 6: Implement from-session.ts capture.** In
  `apps/cli/src/commands/memory/from-session.ts`:

  (a) Extend the `@megasaver/core` import:

```ts
import {
  type MemoryEntry,
  captureCodeAnchor,
  extractSessionMemories,
  memoryEntrySchema,
  saveMemoryWithLineage,
} from "@megasaver/core";
```

  (b) Replace the line
  `const now = input.now ?? readTestEnv("MEGA_TEST_NOW") ?? new Date().toISOString();`
  with:

```ts
    const now = input.now ?? readTestEnv("MEGA_TEST_NOW") ?? new Date().toISOString();
    const project = registry.getProject(session.projectId);
```

  (c) Inside the candidate loop, replace the line
  `const entry: MemoryEntry = memoryEntrySchema.parse({` with:

```ts
      // ponytail: one capture (≈1 git spawn per cited file) per candidate;
      // batch through RepoState if extraction volume ever grows.
      const anchor =
        project === null || candidate.relatedFiles.length === 0
          ? undefined
          : await captureCodeAnchor({
              rootPath: project.rootPath,
              relatedFiles: candidate.relatedFiles,
              now,
            });
      const entry: MemoryEntry = memoryEntrySchema.parse({
```

  (d) In that same parse object, after
  `...(candidate.relatedFiles.length > 0 ? { relatedFiles: candidate.relatedFiles } : {}),`
  add:

```ts
        ...(anchor !== undefined ? { anchor } : {}),
```

- [ ] **Step 7: Run to verify PASS.**
  `pnpm build && pnpm --filter @megasaver/cli exec vitest run test/memory/create-anchor.test.ts`
  Expected: 5 passed. Then the full gates:
  `pnpm lint:fix && pnpm typecheck && pnpm --filter @megasaver/cli test`
  — all green. The existing `memory-from-session.test.ts` and task-status
  tests pass unchanged (their fixture `rootPath` is `/tmp`, a non-git dir, so
  capture returns `undefined` and rows are byte-identical).

- [ ] **Step 8: Commit.**

```bash
git add apps/cli/src/commands/memory/create.ts apps/cli/src/commands/memory/update.ts apps/cli/src/commands/task/status.ts apps/cli/src/commands/memory/from-session.ts apps/cli/test/memory/create-anchor.test.ts
git commit -m "feat(cli): capture code anchors on memory writes"
```

---

### Task 10: `mega memory verify` — the FREE one-shot verify command

New subcommand `mega memory verify <projectId> [--changed] [--quiet] [--json]
[--store <dir>]` (spec §8.1). Thin shell over core `runVerify`: table summary
`N contradicted, N healed, N verified, N unanchored, N repointed` plus
per-row lines; `--json` prints the raw `VerifyPlan`; `--quiet` prints only
when contradicted+healed > 0 (hook mode); exit 0 always for verify outcomes
(input errors still exit 1); when contradictions > 0 and
`checkEntitlement("code-truth", ...)` is not entitled, `MEMORY_VERIFY_UPSELL`
goes to stderr (stdout stays machine-safe). `--changed` computes
`changedPaths` via `git diff-tree --no-commit-id --name-only -r HEAD`
(fail-open to an empty scope: hook mode must never break a commit). Note the
positional is the project **id** (contract + hook body), not the project name.

**Files:**

- Create: `apps/cli/src/commands/memory/verify.ts`
- Modify: `apps/cli/src/commands/memory/index.ts`
- Create (test): `apps/cli/test/memory/verify.test.ts`

**Steps:**

- [ ] **Step 1: Write the failing test.** Create
  `apps/cli/test/memory/verify.test.ts` with exactly:

```ts
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMemoryCreate } from "../../src/commands/memory/create.js";
import { memoryCommand } from "../../src/commands/memory/index.js";
import { MEMORY_VERIFY_UPSELL, runMemoryVerify } from "../../src/commands/memory/verify.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const ENTRY_ID = "55555555-5555-4555-8555-555555555555";
const UNANCHORED_ID = "66666666-6666-4666-8666-666666666666";
const TS = "2026-07-01T00:00:00.000Z";
const T_CREATE = "2026-07-02T00:00:00.000Z";
const NOW = "2026-07-14T00:00:00.000Z";
const FOO_V1 = "export function foo(): number {\n  return 1;\n}\n";
const FOO_V2 = "export function foo(): number {\n  return 2;\n}\n";

let store: string;
let repo: string;
let lines: string[];
let errLines: string[];

function git(args: string[], cwd: string): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

beforeEach(async () => {
  store = await mkdtemp(join(tmpdir(), "megasaver-verify-store-"));
  repo = await mkdtemp(join(tmpdir(), "megasaver-verify-repo-"));
  lines = [];
  errLines = [];
  git(["init"], repo);
  git(["config", "user.email", "t@t"], repo);
  git(["config", "user.name", "t"], repo);
  await writeFile(join(repo, "a.ts"), FOO_V1);
  git(["add", "."], repo);
  git(["commit", "-m", "add a"], repo);
});

afterEach(async () => {
  await rm(store, { recursive: true, force: true });
  await rm(repo, { recursive: true, force: true });
});

function memRow(id: string): string {
  return JSON.stringify({
    id,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "unanchored row",
    content: "unanchored row",
    keywords: [],
    confidence: "medium",
    source: "manual",
    approval: "approved",
    stale: false,
    createdAt: TS,
    updatedAt: TS,
  });
}

async function seedStore(rootPath: string, memoryRows: string[]): Promise<void> {
  await mkdir(join(store, "memory"), { recursive: true });
  await writeFile(
    join(store, "projects.json"),
    JSON.stringify([{ id: PROJECT_ID, name: "demo", rootPath, createdAt: TS, updatedAt: TS }]),
  );
  await writeFile(join(store, "sessions.json"), "[]");
  if (memoryRows.length > 0) {
    await writeFile(
      join(store, "memory", `${PROJECT_ID}.jsonl`),
      `${memoryRows.join("\n")}\n`,
    );
  }
}

function verifyInput(
  over: Partial<Parameters<typeof runMemoryVerify>[0]> = {},
): Parameters<typeof runMemoryVerify>[0] {
  return {
    projectId: PROJECT_ID,
    changedFlag: false,
    quietFlag: false,
    jsonFlag: false,
    storeFlag: store,
    cwd: process.cwd(),
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    home: process.env["HOME"] ?? "",
    xdgDataHome: undefined,
    platform: process.platform,
    localAppData: undefined,
    stdout: (line) => lines.push(line),
    stderr: (line) => errLines.push(line),
    now: () => NOW,
    ...over,
  };
}

async function createAnchored(): Promise<void> {
  const code = await runMemoryCreate({
    projectName: "demo",
    scopeFlag: "project",
    contentFlag: "foo returns 1",
    sessionFlag: undefined,
    fileFlags: ["a.ts"],
    symbolFlags: ["foo"],
    storeFlag: store,
    cwd: process.cwd(),
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    home: process.env["HOME"] ?? "",
    xdgDataHome: undefined,
    platform: process.platform,
    localAppData: undefined,
    stdout: () => {},
    stderr: () => {},
    newId: () => ENTRY_ID,
    now: () => T_CREATE,
  });
  expect(code).toBe(0);
}

describe("mega memory verify", () => {
  it("is registered as a memory subcommand", () => {
    const sub = (memoryCommand as { subCommands?: Record<string, unknown> }).subCommands ?? {};
    expect(Object.keys(sub)).toContain("verify");
  });

  it("counts unanchored rows and exits 0", async () => {
    await seedStore(repo, [memRow(UNANCHORED_ID)]);
    const code = await runMemoryVerify(verifyInput());
    expect(code).toBe(0);
    expect(lines[0]).toBe("0 contradicted, 0 healed, 0 verified, 1 unanchored, 0 repointed");
  });

  it("WOW loop: contradiction is reported with the upsell, then heals", async () => {
    await seedStore(repo, []);
    await createAnchored();

    let code = await runMemoryVerify(verifyInput());
    expect(code).toBe(0);
    expect(lines[0]).toBe("0 contradicted, 0 healed, 1 verified, 0 unanchored, 0 repointed");

    lines = [];
    errLines = [];
    await writeFile(join(repo, "a.ts"), FOO_V2);
    git(["add", "."], repo);
    git(["commit", "-m", "change foo"], repo);

    code = await runMemoryVerify(verifyInput());
    expect(code).toBe(0);
    expect(lines[0]).toBe("1 contradicted, 0 healed, 0 verified, 0 unanchored, 0 repointed");
    expect(lines.slice(1).join("\n")).toContain(`contradicted ${ENTRY_ID}`);
    expect(errLines).toContain(MEMORY_VERIFY_UPSELL);

    lines = [];
    errLines = [];
    await writeFile(join(repo, "a.ts"), FOO_V1);
    git(["add", "."], repo);
    git(["commit", "-m", "revert foo"], repo);

    code = await runMemoryVerify(verifyInput());
    expect(code).toBe(0);
    expect(lines[0]).toBe("0 contradicted, 1 healed, 0 verified, 0 unanchored, 0 repointed");
    expect(lines.slice(1).join("\n")).toContain(`healed ${ENTRY_ID}`);
  });

  it("--json emits the machine plan shape", async () => {
    await seedStore(repo, [memRow(UNANCHORED_ID)]);
    const code = await runMemoryVerify(verifyInput({ jsonFlag: true }));
    expect(code).toBe(0);
    const parsed = JSON.parse(lines.join("")) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual([
      "contradicted",
      "healed",
      "repointed",
      "unanchored",
      "verified",
    ]);
    expect(parsed["unanchored"]).toEqual([UNANCHORED_ID]);
  });

  it("--quiet prints nothing when nothing flipped", async () => {
    await seedStore(repo, [memRow(UNANCHORED_ID)]);
    const code = await runMemoryVerify(verifyInput({ quietFlag: true }));
    expect(code).toBe(0);
    expect(lines).toEqual([]);
  });

  it("rejects a malformed project id with exit 1", async () => {
    await seedStore(repo, []);
    const code = await runMemoryVerify(verifyInput({ projectId: "not-a-uuid" }));
    expect(code).toBe(1);
    expect(errLines.join("\n")).toContain("invalid project id");
  });
});
```

- [ ] **Step 2: Run to verify FAIL.**
  `pnpm build && pnpm --filter @megasaver/cli exec vitest run test/memory/verify.test.ts`
  Expected: the whole file errors with
  `Error: Failed to load ... Cannot find module '../../src/commands/memory/verify.js'`
  (the module does not exist yet).

- [ ] **Step 3: Implement.** Create `apps/cli/src/commands/memory/verify.ts`
  with exactly:

```ts
import { execFileSync } from "node:child_process";
import type { KeyObject } from "node:crypto";
import { runVerify } from "@megasaver/core";
import { checkEntitlement } from "@megasaver/entitlement";
import { type MemoryEntryId, projectIdSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import { mapErrorToCliMessage, projectNotFoundMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { readTestEnv } from "../session/shared.js";

export const MEMORY_VERIFY_UPSELL =
  "Automatic code-truth verification (post-commit hook, sweep pre-pass) is a Mega Saver Pro feature. Activate a key: mega license activate <key>.";

export type RunMemoryVerifyInput = {
  projectId: string;
  changedFlag: boolean;
  quietFlag: boolean;
  jsonFlag: boolean;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  now?: () => string;
  nowMs?: () => number;
  publicKey?: KeyObject | string;
  execGit?: (args: string[], cwd: string) => string;
};

// timeout mirrors git-delta.ts: a stuck git (index.lock) must not hang the CLI.
const defaultExecGit = (args: string[], cwd: string): string =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 3000,
    maxBuffer: 10 * 1024 * 1024,
  });

// Fail-open (hook mode must never break a commit): outside a git repo or on a
// commitless HEAD, an empty scope verifies nothing instead of erroring.
function changedPathsAtHead(
  rootPath: string,
  execGit: (args: string[], cwd: string) => string,
): string[] {
  try {
    return execGit(["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"], rootPath)
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

function sha7(sha: string): string {
  return sha.slice(0, 7);
}

export async function runMemoryVerify(input: RunMemoryVerifyInput): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath({
      storeFlag: input.storeFlag,
      cwd: input.cwd,
      home: input.home,
      xdgDataHome: input.xdgDataHome,
      platform: input.platform,
      localAppData: input.localAppData,
    });
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  const idResult = projectIdSchema.safeParse(input.projectId);
  if (!idResult.success) {
    input.stderr(`error: invalid project id: ${input.projectId}`);
    return 1;
  }

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);
    const project = registry.getProject(idResult.data);
    if (project === null) {
      const cli = projectNotFoundMessage(input.projectId);
      input.stderr(cli.message);
      return cli.exitCode;
    }

    const now = readTestEnv("MEGA_TEST_NOW") ?? (input.now ?? (() => new Date().toISOString()))();
    const execGit = input.execGit ?? defaultExecGit;

    const plan = await runVerify({
      registry,
      projectId: project.id,
      rootPath: project.rootPath,
      now,
      ...(input.changedFlag
        ? { scope: { changedPaths: changedPathsAtHead(project.rootPath, execGit) } }
        : {}),
      execGit,
    });

    const flips = plan.contradicted.length + plan.healed.length;
    const titleOf = (id: MemoryEntryId): string => registry.getMemoryEntry(id)?.title ?? "";

    if (input.jsonFlag) {
      input.stdout(JSON.stringify(plan));
    } else if (!input.quietFlag || flips > 0) {
      input.stdout(
        `${plan.contradicted.length} contradicted, ${plan.healed.length} healed, ` +
          `${plan.verified.length} verified, ${plan.unanchored.length} unanchored, ` +
          `${plan.repointed.length} repointed`,
      );
      for (const row of plan.contradicted) {
        const commit = row.commit === undefined ? "" : ` (commit ${sha7(row.commit)})`;
        input.stdout(`contradicted ${row.id} "${titleOf(row.id)}" ${row.reason}${commit}`);
      }
      for (const id of plan.healed) input.stdout(`healed ${id} "${titleOf(id)}"`);
      for (const row of plan.repointed) {
        input.stdout(`repointed ${row.id} ${row.from} -> ${row.to}`);
      }
    }

    // Organic upsell (spec §8.1): a free verify that finds contradictions
    // names the Pro automation. Disclosure goes to stderr like all CLI notes;
    // stdout stays machine-safe for --json/table consumers.
    if (plan.contradicted.length > 0) {
      const ent = checkEntitlement("code-truth", {
        storeRoot: rootDir,
        now: input.nowMs ?? (() => Date.now()),
        ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
      });
      if (!ent.entitled) input.stderr(MEMORY_VERIFY_UPSELL);
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const memoryVerifyCommand = defineCommand({
  meta: {
    name: "verify",
    description: "Verify code anchors against the repo (code-truth). Exit 0 always.",
  },
  args: {
    projectId: { type: "positional", required: true, description: "Project id (UUID)." },
    changed: {
      type: "boolean",
      default: false,
      description: "Scope to paths changed in the last commit (hook mode).",
    },
    quiet: {
      type: "boolean",
      default: false,
      description: "Print only when something contradicted or healed.",
    },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runMemoryVerify({
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      projectId: typeof args.projectId === "string" ? args.projectId : "",
      changedFlag: args.changed === true,
      quietFlag: args.quiet === true,
      jsonFlag: args.json === true,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

- [ ] **Step 4: Register the subcommand.** In
  `apps/cli/src/commands/memory/index.ts`:

  (a) After `import { memoryUpdateCommand } from "./update.js";` add:

```ts
import { memoryVerifyCommand } from "./verify.js";
```

  (b) After the `history.js` re-export block add:

```ts
export {
  type RunMemoryVerifyInput,
  runMemoryVerify,
  memoryVerifyCommand,
  MEMORY_VERIFY_UPSELL,
} from "./verify.js";
```

  (c) In the `subCommands` map, after `reopen: memoryReopenCommand,` add:

```ts
    verify: memoryVerifyCommand,
```

- [ ] **Step 5: Run to verify PASS.**
  `pnpm build && pnpm --filter @megasaver/cli exec vitest run test/memory/verify.test.ts`
  Expected: 6 passed. Then the full gates:
  `pnpm lint:fix && pnpm typecheck && pnpm --filter @megasaver/cli test`.

- [ ] **Step 6: Smoke evidence (DoD §5).** Run the WOW loop through the real
  binary and capture the terminal session (git repo + store in `/tmp` via
  `mktemp -d`, `mega project create` or seeded store, create → change →
  commit → `mega memory verify <projectId>` shows `1 contradicted` → revert →
  `1 healed`). Save the transcript for the PR body.

- [ ] **Step 7: Commit.**

```bash
git add apps/cli/src/commands/memory/verify.ts apps/cli/src/commands/memory/index.ts apps/cli/test/memory/verify.test.ts
git commit -m "feat(cli): mega memory verify command"
```

---

### Task 11: `--install-hook` / `--uninstall-hook` (PRO, CRITICAL-adjacent)

Adds hook mode to the verify command. Confinement rules (spec §8.2,
non-negotiable): PRO gate FIRST — `checkEntitlement("code-truth", ...)` runs
before ANY filesystem write (including `ensureStoreReady`, which initializes
the store on disk); free tier prints the upsell and exits 0 without touching
the repo. Only ever writes `<rootPath>/.git/hooks/post-commit`. Sentinel block
`# MEGA_SAVER_BLOCK_START` / `# MEGA_SAVER_BLOCK_END`; foreign content outside
the block preserved byte-for-byte (string-index splice, no line rebuilding);
file created `0755` with a `#!/bin/sh` shebang + `# created-by-mega-saver`
marker ONLY when absent; uninstall removes only the block, and deletes the
file only when we created it (marker present) AND the remainder minus our
shebang/marker lines is whitespace. Hook body:
`mega memory verify <projectId> --changed --quiet --store <storeDir> || true`.

**Files:**

- Create: `apps/cli/src/commands/memory/verify-hook.ts`
- Modify: `apps/cli/src/commands/memory/verify.ts`
- Create (test): `apps/cli/test/memory/verify-hook.test.ts`

**Steps:**

- [ ] **Step 1: Write the failing test.** Create
  `apps/cli/test/memory/verify-hook.test.ts` with exactly:

```ts
import { execFileSync } from "node:child_process";
import { type KeyObject, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activateLicense } from "@megasaver/entitlement";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  HOOK_BLOCK_END,
  HOOK_BLOCK_START,
  HOOK_CREATED_MARKER,
} from "../../src/commands/memory/verify-hook.js";
import { MEMORY_VERIFY_UPSELL, runMemoryVerify } from "../../src/commands/memory/verify.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TS = "2026-07-01T00:00:00.000Z";
const NOW = "2026-07-14T00:00:00.000Z";
const FOREIGN = "#!/bin/bash\necho foreign hook\n";

type LicensePayload = { v: number; tier: string; id: string; iat: number; exp: number | null };
const b64url = (buf: Buffer): string => buf.toString("base64url");
function signTestLicense(
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"],
  payload: LicensePayload,
): string {
  const bytes = Buffer.from(JSON.stringify(payload));
  return `msp_${b64url(bytes)}.${b64url(sign(null, bytes, privateKey))}`;
}

let store: string;
let repo: string;
let hookPath: string;
let proPublicKey: KeyObject | undefined;
let lines: string[];
let errLines: string[];

function git(args: string[], cwd: string): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function activatePro(): void {
  const keys = generateKeyPairSync("ed25519");
  const key = signTestLicense(keys.privateKey, { v: 1, tier: "pro", id: "t1", iat: 0, exp: null });
  activateLicense(store, key, { publicKey: keys.publicKey, now: () => Date.parse(NOW) });
  proPublicKey = keys.publicKey;
}

beforeEach(async () => {
  store = await mkdtemp(join(tmpdir(), "megasaver-hook-store-"));
  repo = await mkdtemp(join(tmpdir(), "megasaver-hook-repo-"));
  hookPath = join(repo, ".git", "hooks", "post-commit");
  proPublicKey = undefined;
  lines = [];
  errLines = [];
  git(["init"], repo);
  await mkdir(join(store, "memory"), { recursive: true });
  await writeFile(
    join(store, "projects.json"),
    JSON.stringify([{ id: PROJECT_ID, name: "demo", rootPath: repo, createdAt: TS, updatedAt: TS }]),
  );
  await writeFile(join(store, "sessions.json"), "[]");
});

afterEach(async () => {
  await rm(store, { recursive: true, force: true });
  await rm(repo, { recursive: true, force: true });
});

function hookInput(
  over: Partial<Parameters<typeof runMemoryVerify>[0]> = {},
): Parameters<typeof runMemoryVerify>[0] {
  return {
    projectId: PROJECT_ID,
    changedFlag: false,
    quietFlag: false,
    jsonFlag: false,
    storeFlag: store,
    cwd: process.cwd(),
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    home: process.env["HOME"] ?? "",
    xdgDataHome: undefined,
    platform: process.platform,
    localAppData: undefined,
    stdout: (line) => lines.push(line),
    stderr: (line) => errLines.push(line),
    now: () => NOW,
    nowMs: () => Date.parse(NOW),
    ...(proPublicKey === undefined ? {} : { publicKey: proPublicKey }),
    ...over,
  };
}

describe("mega memory verify --install-hook / --uninstall-hook", () => {
  it("free tier writes NOTHING and prints the upsell", async () => {
    const code = await runMemoryVerify(hookInput({ installHookFlag: true }));
    expect(code).toBe(0);
    expect(lines).toContain(MEMORY_VERIFY_UPSELL);
    expect(existsSync(hookPath)).toBe(false);
  });

  it("creates the hook 0755 with shebang + marker, idempotently", async () => {
    activatePro();
    let code = await runMemoryVerify(hookInput({ installHookFlag: true }));
    expect(code).toBe(0);
    code = await runMemoryVerify(hookInput({ installHookFlag: true }));
    expect(code).toBe(0);

    const content = await readFile(hookPath, "utf8");
    // double install => exactly one sentinel block
    expect(content.split(HOOK_BLOCK_START).length).toBe(2);
    expect(content.split(HOOK_BLOCK_END).length).toBe(2);
    expect(content.startsWith(`#!/bin/sh\n${HOOK_CREATED_MARKER}\n`)).toBe(true);
    expect(content).toContain(
      `mega memory verify ${PROJECT_ID} --changed --quiet --store '${store}' || true`,
    );
    // owner-executable
    expect(statSync(hookPath).mode & 0o100).not.toBe(0);
  });

  it("preserves a foreign hook byte-for-byte and uninstall removes only the block", async () => {
    activatePro();
    await writeFile(hookPath, FOREIGN, { mode: 0o755 });

    let code = await runMemoryVerify(hookInput({ installHookFlag: true }));
    expect(code).toBe(0);
    const installed = await readFile(hookPath, "utf8");
    expect(installed.startsWith(FOREIGN)).toBe(true);
    expect(installed).toContain(HOOK_BLOCK_START);
    expect(installed).not.toContain(HOOK_CREATED_MARKER);

    code = await runMemoryVerify(hookInput({ uninstallHookFlag: true }));
    expect(code).toBe(0);
    expect(existsSync(hookPath)).toBe(true);
    expect(await readFile(hookPath, "utf8")).toBe(FOREIGN);
  });

  it("uninstall deletes the file only when we created it", async () => {
    activatePro();
    await runMemoryVerify(hookInput({ installHookFlag: true }));
    expect(existsSync(hookPath)).toBe(true);
    const code = await runMemoryVerify(hookInput({ uninstallHookFlag: true }));
    expect(code).toBe(0);
    expect(existsSync(hookPath)).toBe(false);
  });

  it("--install-hook and --uninstall-hook are mutually exclusive", async () => {
    activatePro();
    const code = await runMemoryVerify(
      hookInput({ installHookFlag: true, uninstallHookFlag: true }),
    );
    expect(code).toBe(1);
    expect(errLines.join("\n")).toContain("mutually exclusive");
    expect(existsSync(hookPath)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify FAIL.**
  `pnpm build && pnpm --filter @megasaver/cli exec vitest run test/memory/verify-hook.test.ts`
  Expected:
  `Error: Failed to load ... Cannot find module '../../src/commands/memory/verify-hook.js'`.

- [ ] **Step 3: Implement the hook file writer.** Create
  `apps/cli/src/commands/memory/verify-hook.ts` with exactly:

```ts
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const HOOK_BLOCK_START = "# MEGA_SAVER_BLOCK_START";
export const HOOK_BLOCK_END = "# MEGA_SAVER_BLOCK_END";
export const HOOK_CREATED_MARKER = "# created-by-mega-saver";

// POSIX single-quote escaping: the store dir may contain spaces.
const shq = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;

export function renderHookBlock(projectId: string, storeDir: string): string {
  return `${HOOK_BLOCK_START}\nmega memory verify ${projectId} --changed --quiet --store ${shq(storeDir)} || true\n${HOOK_BLOCK_END}`;
}

export type HookResult =
  | { ok: true; path: string; deleted: boolean }
  | { ok: false; message: string };

// Confinement (spec §8.2): only ever touches <rootPath>/.git/hooks/post-commit.
// Foreign bytes outside the sentinel block are preserved exactly — replacement
// is a string-index splice, never a line rebuild.
export function installPostCommitHook(opts: {
  rootPath: string;
  projectId: string;
  storeDir: string;
}): HookResult {
  const gitDir = join(opts.rootPath, ".git");
  if (!existsSync(gitDir)) {
    return { ok: false, message: `error: ${opts.rootPath} is not a git repository` };
  }
  const hooksDir = join(gitDir, "hooks");
  const hookPath = join(hooksDir, "post-commit");
  const block = renderHookBlock(opts.projectId, opts.storeDir);

  if (!existsSync(hookPath)) {
    mkdirSync(hooksDir, { recursive: true });
    // Marker on the bootstrap: uninstall may delete the file ONLY when we
    // created it (the marker is the ownership record).
    writeFileSync(hookPath, `#!/bin/sh\n${HOOK_CREATED_MARKER}\n${block}\n`, { mode: 0o755 });
    return { ok: true, path: hookPath, deleted: false };
  }

  const raw = readFileSync(hookPath, "utf8");
  const start = raw.indexOf(HOOK_BLOCK_START);
  const end = raw.indexOf(HOOK_BLOCK_END);
  const next =
    start !== -1 && end !== -1 && end >= start
      ? raw.slice(0, start) + block + raw.slice(end + HOOK_BLOCK_END.length)
      : `${raw}${raw.endsWith("\n") ? "" : "\n"}${block}\n`;
  // Existing file: content only — never touch its mode or add the marker.
  writeFileSync(hookPath, next);
  return { ok: true, path: hookPath, deleted: false };
}

export function uninstallPostCommitHook(opts: { rootPath: string }): HookResult {
  const hookPath = join(opts.rootPath, ".git", "hooks", "post-commit");
  if (!existsSync(hookPath)) return { ok: true, path: hookPath, deleted: false };
  const raw = readFileSync(hookPath, "utf8");
  const start = raw.indexOf(HOOK_BLOCK_START);
  const end = raw.indexOf(HOOK_BLOCK_END);
  if (start === -1 || end === -1 || end < start) {
    return { ok: true, path: hookPath, deleted: false };
  }
  let afterEnd = end + HOOK_BLOCK_END.length;
  if (raw[afterEnd] === "\n") afterEnd += 1;
  const remainder = raw.slice(0, start) + raw.slice(afterEnd);
  const createdByUs = raw.includes(HOOK_CREATED_MARKER);
  const strippedOfOurs = remainder
    .split("\n")
    .filter((line) => line !== "#!/bin/sh" && line !== HOOK_CREATED_MARKER)
    .join("\n");
  if (createdByUs && strippedOfOurs.trim().length === 0) {
    unlinkSync(hookPath);
    return { ok: true, path: hookPath, deleted: true };
  }
  writeFileSync(hookPath, remainder);
  return { ok: true, path: hookPath, deleted: false };
}
```

- [ ] **Step 4: Wire hook mode into verify.ts.** In
  `apps/cli/src/commands/memory/verify.ts`:

  (a) Add the import after the `readTestEnv` import line:

```ts
import { installPostCommitHook, uninstallPostCommitHook } from "./verify-hook.js";
```

  (b) In `RunMemoryVerifyInput`, after `jsonFlag: boolean;` add (optional so
  Task 10 tests stay untouched):

```ts
  installHookFlag?: boolean;
  uninstallHookFlag?: boolean;
```

  (c) In `runMemoryVerify`, immediately after the `idResult.success` guard
  (before the main `try` block), insert:

```ts
  // Hook mode (spec §8.2). PRO gate FIRST — before ensureStoreReady (which
  // initializes the store on disk) and before any write into the user's repo.
  // Free tier must not touch the filesystem at all.
  if (input.installHookFlag === true || input.uninstallHookFlag === true) {
    if (input.installHookFlag === true && input.uninstallHookFlag === true) {
      input.stderr("error: --install-hook and --uninstall-hook are mutually exclusive");
      return 1;
    }
    const ent = checkEntitlement("code-truth", {
      storeRoot: rootDir,
      now: input.nowMs ?? (() => Date.now()),
      ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
    });
    if (!ent.entitled) {
      input.stdout(MEMORY_VERIFY_UPSELL);
      return 0;
    }
    try {
      const { registry, initialized } = await ensureStoreReady(rootDir);
      if (initialized) input.stderr(`note: initialized store at ${rootDir}`);
      const project = registry.getProject(idResult.data);
      if (project === null) {
        const cli = projectNotFoundMessage(input.projectId);
        input.stderr(cli.message);
        return cli.exitCode;
      }
      const result =
        input.installHookFlag === true
          ? installPostCommitHook({
              rootPath: project.rootPath,
              projectId: project.id,
              storeDir: rootDir,
            })
          : uninstallPostCommitHook({ rootPath: project.rootPath });
      if (!result.ok) {
        input.stderr(result.message);
        return 1;
      }
      input.stdout(
        input.installHookFlag === true ? `installed: ${result.path}` : `uninstalled: ${result.path}`,
      );
      return 0;
    } catch (err) {
      const cli = mapErrorToCliMessage(err);
      input.stderr(cli.message);
      return cli.exitCode;
    }
  }
```

  (d) In `defineCommand` `args`, after the `quiet:` entry add:

```ts
    "install-hook": {
      type: "boolean",
      default: false,
      description: "Install the post-commit verify hook into this project's repo (Pro).",
    },
    "uninstall-hook": {
      type: "boolean",
      default: false,
      description: "Remove the Mega Saver block from the post-commit hook (Pro).",
    },
```

  (e) In the `run({ args })` wrapper, after `jsonFlag: args.json === true,`
  add (kebab keys — citty stores multi-word flags kebab-cased):

```ts
      installHookFlag: args["install-hook"] === true,
      uninstallHookFlag: args["uninstall-hook"] === true,
```

- [ ] **Step 5: Run to verify PASS.**
  `pnpm build && pnpm --filter @megasaver/cli exec vitest run test/memory/verify-hook.test.ts`
  Expected: 5 passed. Also re-run Task 10's file:
  `pnpm --filter @megasaver/cli exec vitest run test/memory/verify.test.ts`
  (still 6 passed — hook flags are optional). Then the full gates:
  `pnpm lint:fix && pnpm typecheck && pnpm --filter @megasaver/cli test`.

- [ ] **Step 6: Commit.**

```bash
git add apps/cli/src/commands/memory/verify-hook.ts apps/cli/src/commands/memory/verify.ts apps/cli/test/memory/verify-hook.test.ts
git commit -m "feat(cli): verify hook install and uninstall"
```

---

### Task 12: Sweep verify pre-pass (PRO, silent on free tier)

`mega memory sweep` gains a code-truth pre-pass (spec §8.3): when entitled and
`--no-verify` was not passed, run `runVerify` before the existing sweep — the
sweep already archives `stale` rows, so contradicted rows archive in the same
run with zero new sweep logic. Free tier: behavior byte-identical to today —
the entitlement check is silent, no verify runs, no output changes; the
existing `apps/cli/test/memory-sweep.test.ts` MUST pass unmodified.

**Files:**

- Modify: `apps/cli/src/commands/memory/sweep.ts`
- Create (test): `apps/cli/test/memory/sweep-verify.test.ts`
- Test (regression, unmodified): `apps/cli/test/memory-sweep.test.ts`

**Steps:**

- [ ] **Step 1: Write the failing test.** Create
  `apps/cli/test/memory/sweep-verify.test.ts` with exactly:

```ts
import { execFileSync } from "node:child_process";
import { type KeyObject, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activateLicense } from "@megasaver/entitlement";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMemoryCreate } from "../../src/commands/memory/create.js";
import { runMemorySweep } from "../../src/commands/memory/sweep.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const ENTRY_ID = "55555555-5555-4555-8555-555555555555";
const TS = "2026-07-01T00:00:00.000Z";
const T_CREATE = "2026-07-02T00:00:00.000Z";
const NOW = "2026-07-14T00:00:00.000Z";
const FOO_V1 = "export function foo(): number {\n  return 1;\n}\n";
const FOO_V2 = "export function foo(): number {\n  return 2;\n}\n";

type LicensePayload = { v: number; tier: string; id: string; iat: number; exp: number | null };
const b64url = (buf: Buffer): string => buf.toString("base64url");
function signTestLicense(
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"],
  payload: LicensePayload,
): string {
  const bytes = Buffer.from(JSON.stringify(payload));
  return `msp_${b64url(bytes)}.${b64url(sign(null, bytes, privateKey))}`;
}

type StoredRow = {
  id: string;
  stale?: boolean;
  tier?: string;
  lastVerified?: { result: string };
};

let store: string;
let repo: string;
let proPublicKey: KeyObject | undefined;
let out: string[];
let err: string[];

function git(args: string[], cwd: string): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function activatePro(): void {
  const keys = generateKeyPairSync("ed25519");
  const key = signTestLicense(keys.privateKey, { v: 1, tier: "pro", id: "t1", iat: 0, exp: null });
  activateLicense(store, key, { publicKey: keys.publicKey, now: () => Date.parse(NOW) });
  proPublicKey = keys.publicKey;
}

beforeEach(async () => {
  store = await mkdtemp(join(tmpdir(), "megasaver-sweep-verify-store-"));
  repo = await mkdtemp(join(tmpdir(), "megasaver-sweep-verify-repo-"));
  proPublicKey = undefined;
  out = [];
  err = [];
  git(["init"], repo);
  git(["config", "user.email", "t@t"], repo);
  git(["config", "user.name", "t"], repo);
  await writeFile(join(repo, "a.ts"), FOO_V1);
  git(["add", "."], repo);
  git(["commit", "-m", "add a"], repo);
  await mkdir(join(store, "memory"), { recursive: true });
  await writeFile(
    join(store, "projects.json"),
    JSON.stringify([{ id: PROJECT_ID, name: "demo", rootPath: repo, createdAt: TS, updatedAt: TS }]),
  );
  await writeFile(join(store, "sessions.json"), "[]");
});

afterEach(async () => {
  await rm(store, { recursive: true, force: true });
  await rm(repo, { recursive: true, force: true });
});

async function seedContradictedFixture(): Promise<void> {
  const code = await runMemoryCreate({
    projectName: "demo",
    scopeFlag: "project",
    contentFlag: "foo returns 1",
    sessionFlag: undefined,
    fileFlags: ["a.ts"],
    symbolFlags: ["foo"],
    storeFlag: store,
    cwd: process.cwd(),
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    home: process.env["HOME"] ?? "",
    xdgDataHome: undefined,
    platform: process.platform,
    localAppData: undefined,
    stdout: () => {},
    stderr: () => {},
    newId: () => ENTRY_ID,
    now: () => T_CREATE,
  });
  expect(code).toBe(0);
  await writeFile(join(repo, "a.ts"), FOO_V2);
  git(["add", "."], repo);
  git(["commit", "-m", "change foo"], repo);
}

function sweepInput(over: Record<string, unknown> = {}) {
  return {
    projectName: "demo",
    storeFlag: store,
    jsonFlag: false,
    cwd: process.cwd(),
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)
    home: process.env["HOME"] ?? "",
    xdgDataHome: undefined,
    platform: process.platform,
    localAppData: undefined,
    now: NOW,
    nowMs: () => Date.parse(NOW),
    ...(proPublicKey === undefined ? {} : { publicKey: proPublicKey }),
    stdout: (l: string) => out.push(l),
    stderr: (l: string) => err.push(l),
    ...over,
  } as Parameters<typeof runMemorySweep>[0];
}

async function readRows(): Promise<StoredRow[]> {
  const raw = await readFile(join(store, "memory", `${PROJECT_ID}.jsonl`), "utf8");
  return raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as StoredRow);
}

describe("mega memory sweep — verify pre-pass", () => {
  it("free tier: sweep is byte-identical to today (no pre-pass, no new output)", async () => {
    await seedContradictedFixture();
    const code = await runMemorySweep(sweepInput());
    expect(code).toBe(0);
    expect(out).toEqual(["archived=0 scanned=1"]);
    const row = (await readRows()).find((r) => r.id === ENTRY_ID);
    expect(row?.stale).toBe(false);
    expect(row?.lastVerified).toBeUndefined();
    expect(row?.tier).toBeUndefined();
  });

  it("entitled: pre-pass flips the contradicted row and the same run archives it", async () => {
    await seedContradictedFixture();
    activatePro();
    const code = await runMemorySweep(sweepInput());
    expect(code).toBe(0);
    expect(out).toEqual(["archived=1 scanned=1"]);
    const row = (await readRows()).find((r) => r.id === ENTRY_ID);
    expect(row?.stale).toBe(true);
    expect(row?.lastVerified?.result).toBe("contradicted");
    expect(row?.tier).toBe("archival");
  });

  it("--no-verify skips the pre-pass even when entitled", async () => {
    await seedContradictedFixture();
    activatePro();
    const code = await runMemorySweep(sweepInput({ verifyFlag: false }));
    expect(code).toBe(0);
    expect(out).toEqual(["archived=0 scanned=1"]);
    const row = (await readRows()).find((r) => r.id === ENTRY_ID);
    expect(row?.lastVerified).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify FAIL.**
  `pnpm build && pnpm --filter @megasaver/cli exec vitest run test/memory/sweep-verify.test.ts`
  Expected: test 2 fails with
  `AssertionError: expected [ 'archived=0 scanned=1' ] to deeply equal [ 'archived=1 scanned=1' ]`
  (no pre-pass exists, so the row never flips stale). Tests 1 and 3 pass
  vacuously — test 2 is the red signal.

- [ ] **Step 3: Implement.** In `apps/cli/src/commands/memory/sweep.ts`:

  (a) Replace the imports block header:

```ts
import type { KeyObject } from "node:crypto";
import { runVerify, sweepMemoryTiers } from "@megasaver/core";
import { checkEntitlement } from "@megasaver/entitlement";
```

  (the `citty`, `errors.js`, `store.js`, `session/shared.js`,
  `shared/schemas.js` imports stay as they are).

  (b) In `RunMemorySweepInput`, after `now?: string;` add:

```ts
  verifyFlag?: boolean;
  nowMs?: () => number;
  publicKey?: KeyObject | string;
  execGit?: (args: string[], cwd: string) => string;
```

  (c) In `runMemorySweep`, replace:

```ts
    const now = input.now ?? readTestEnv("MEGA_TEST_NOW") ?? new Date().toISOString();
    const entries = registry.listMemoryEntries(project.id);
```

  with:

```ts
    const now = input.now ?? readTestEnv("MEGA_TEST_NOW") ?? new Date().toISOString();

    // PRO verify pre-pass (spec §8.3): contradicted rows flip stale and the
    // sweep below archives them in the same run — zero new sweep logic. The
    // free tier skips silently: output stays byte-identical to today.
    if (input.verifyFlag !== false) {
      const ent = checkEntitlement("code-truth", {
        storeRoot: rootDir,
        now: input.nowMs ?? (() => Date.now()),
        ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
      });
      if (ent.entitled) {
        await runVerify({
          registry,
          projectId: project.id,
          rootPath: project.rootPath,
          now,
          ...(input.execGit !== undefined ? { execGit: input.execGit } : {}),
        });
      }
    }

    const entries = registry.listMemoryEntries(project.id);
```

  (d) In `defineCommand` `args`, after the `store:` entry add:

```ts
    verify: {
      type: "boolean",
      default: true,
      description: "Run the code-truth verify pre-pass first (Pro; --no-verify to skip).",
    },
```

  (e) In the `run({ args })` wrapper, after `jsonFlag: args.json === true,`
  add:

```ts
      verifyFlag: args.verify !== false,
```

- [ ] **Step 4: Run to verify PASS.**
  `pnpm build && pnpm --filter @megasaver/cli exec vitest run test/memory/sweep-verify.test.ts`
  Expected: 3 passed. Then the free-tier regression proof — the existing sweep
  suite UNMODIFIED:
  `pnpm --filter @megasaver/cli exec vitest run test/memory-sweep.test.ts`
  Expected: 4 passed with zero edits to that file (`git status --short
  apps/cli/test/memory-sweep.test.ts` prints nothing). Then the full gates:
  `pnpm lint:fix && pnpm typecheck && pnpm --filter @megasaver/cli test`.

- [ ] **Step 5: Commit.**

```bash
git add apps/cli/src/commands/memory/sweep.ts apps/cli/test/memory/sweep-verify.test.ts
git commit -m "feat(cli): sweep code-truth verify pre-pass"
```

---

### Task 13: `show` / `explain` — anchor summary + verification badge

FREE surface (spec §8.5): `formatMemoryShowLines` gains an anchor summary line
(`N files, N symbols @ <sha7>`) and a verification badge line from
`lastVerified`; `formatMemoryExplainLines` gains the same two lines between
the `relatedSymbols` and `createdAt` rows. Code-truth evidence strings are
plain `evidence[]` entries and already render through the existing `evidence`
row — the test pins that. Both lines are conditional: legacy rows render
byte-identically.

**Files:**

- Modify: `apps/cli/src/commands/memory/shared.ts`
- Create (test): `apps/cli/test/memory/show-anchor.test.ts`

**Steps:**

- [ ] **Step 1: Write the failing test.** Create
  `apps/cli/test/memory/show-anchor.test.ts` with exactly:

```ts
import { memoryEntrySchema } from "@megasaver/core";
import { describe, expect, it } from "vitest";
import {
  formatMemoryExplainLines,
  formatMemoryShowLines,
} from "../../src/commands/memory/shared.js";

const TS = "2026-07-01T00:00:00.000Z";
const NOW = "2026-07-14T00:00:00.000Z";
const HEAD = "aaaabbbbccccddddeeeeffff0000111122223333";
const BLOB = "1111222233334444555566667777888899990000";
const EVIDENCE = "code-truth: contradicted by aaaabbb — src/a.ts#foo symbol hash changed";

const base = {
  id: "55555555-5555-4555-8555-555555555555",
  projectId: "11111111-1111-4111-8111-111111111111",
  sessionId: null,
  scope: "project",
  type: "decision",
  title: "anchored row",
  content: "anchored row",
  keywords: [],
  confidence: "medium",
  source: "manual",
  approval: "approved",
  stale: false,
  createdAt: TS,
  updatedAt: TS,
};

const anchored = memoryEntrySchema.parse({
  ...base,
  evidence: [EVIDENCE],
  anchor: {
    repoHead: HEAD,
    capturedAt: TS,
    files: [{ path: "src/a.ts", blobSha: BLOB }],
    symbols: [{ path: "src/a.ts", name: "foo", startLine: 1, endLine: 3, contentHash: "h1" }],
  },
  lastVerified: {
    headSha: HEAD,
    at: NOW,
    result: "contradicted",
    closedByCodeTruth: false,
  },
});

const plain = memoryEntrySchema.parse(base);

describe("show/explain anchor + verification lines", () => {
  it("show renders the anchor summary and the verification badge", () => {
    const lines = formatMemoryShowLines(anchored);
    expect(lines).toContain(`${"anchor".padEnd(12)}1 files, 1 symbols @ aaaabbb`);
    expect(lines).toContain(`${"verified".padEnd(12)}contradicted @ aaaabbb (${NOW})`);
  });

  it("show renders no anchor/badge lines for a legacy row", () => {
    const lines = formatMemoryShowLines(plain);
    expect(lines.some((l) => l.startsWith("anchor"))).toBe(false);
    expect(lines.some((l) => l.startsWith("verified"))).toBe(false);
  });

  it("explain renders anchor, verification, and the code-truth evidence trail", () => {
    const lines = formatMemoryExplainLines(anchored);
    expect(lines).toContain(`${"anchor".padEnd(16)}1 files, 1 symbols @ aaaabbb`);
    expect(lines).toContain(`${"verification".padEnd(16)}contradicted @ aaaabbb (${NOW})`);
    // evidence[] already renders — code-truth strings need no new plumbing
    expect(lines.find((l) => l.startsWith("evidence"))).toContain(EVIDENCE);
  });

  it("explain renders no anchor/verification lines for a legacy row", () => {
    const lines = formatMemoryExplainLines(plain);
    expect(lines.some((l) => l.startsWith("anchor"))).toBe(false);
    expect(lines.some((l) => l.startsWith("verification"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify FAIL.**
  `pnpm build && pnpm --filter @megasaver/cli exec vitest run test/memory/show-anchor.test.ts`
  Expected: tests 1 and 3 fail with
  `AssertionError: expected [ ...lines ] to include 'anchor      1 files, 1 symbols @ aaaabbb'`
  (the renderers do not emit the lines yet); tests 2 and 4 pass vacuously.

- [ ] **Step 3: Implement.** In `apps/cli/src/commands/memory/shared.ts`:

  (a) Replace the type-only import line
  `import type { MemoryEntry, MemoryValidation } from "@megasaver/core";` with:

```ts
import type { CodeAnchor, LastVerified, MemoryEntry, MemoryValidation } from "@megasaver/core";
```

  (b) Replace the whole `formatMemoryShowLines` function with:

```ts
export function formatMemoryShowLines(entry: {
  id: string;
  projectId: string;
  sessionId: string | null;
  scope: "project" | "session";
  content: string;
  createdAt: string;
  anchor?: CodeAnchor | undefined;
  lastVerified?: LastVerified | undefined;
}): string[] {
  return [
    `${pad("id")}${entry.id}`,
    `${pad("project")}${entry.projectId}`,
    `${pad("session")}${entry.sessionId ?? "-"}`,
    `${pad("scope")}${entry.scope}`,
    `${pad("content")}${entry.content}`,
    `${pad("createdAt")}${entry.createdAt}`,
    ...(entry.anchor !== undefined
      ? [
          `${pad("anchor")}${entry.anchor.files.length} files, ${entry.anchor.symbols.length} symbols @ ${entry.anchor.repoHead.slice(0, 7)}`,
        ]
      : []),
    ...(entry.lastVerified !== undefined
      ? [
          `${pad("verified")}${entry.lastVerified.result} @ ${entry.lastVerified.headSha.slice(0, 7)} (${entry.lastVerified.at})`,
        ]
      : []),
  ];
}
```

  (c) In `formatMemoryExplainLines`, between the
  `` `${padExplain("relatedSymbols")}${list(entry.relatedSymbols)}`, `` line
  and the `` `${padExplain("createdAt")}${entry.createdAt}`, `` line, insert:

```ts
    ...(entry.anchor !== undefined
      ? [
          `${padExplain("anchor")}${entry.anchor.files.length} files, ${entry.anchor.symbols.length} symbols @ ${entry.anchor.repoHead.slice(0, 7)}`,
        ]
      : []),
    ...(entry.lastVerified !== undefined
      ? [
          `${padExplain("verification")}${entry.lastVerified.result} @ ${entry.lastVerified.headSha.slice(0, 7)} (${entry.lastVerified.at})`,
        ]
      : []),
```

  No change to `show.ts` or `explain.ts` themselves — both already pass the
  full `MemoryEntry` into these renderers, and their `--json` paths emit the
  new fields automatically.

- [ ] **Step 4: Run to verify PASS.**
  `pnpm build && pnpm --filter @megasaver/cli exec vitest run test/memory/show-anchor.test.ts`
  Expected: 4 passed. Then the full gates:
  `pnpm lint:fix && pnpm typecheck && pnpm --filter @megasaver/cli test`
  — all green (`memory-extended.test.ts` exercises the explain renderer on
  legacy rows and must pass unchanged).

- [ ] **Step 5: Commit.**

```bash
git add apps/cli/src/commands/memory/shared.ts apps/cli/test/memory/show-anchor.test.ts
git commit -m "feat(cli): anchor lines in show and explain"
```
# Section D — MCP bridge, entitlement, stats ledger (Tasks 14–17)

All commands run from the worktree root:
`/Users/halitozger/Desktop/MegaSaver/.claude/worktrees/living-brain`
(branch `feat/living-brain`).

**Section prerequisites (hard):** the core-section tasks must be committed
before Task 14 starts — specifically: `anchor`/`lastVerified` on
`memoryEntrySchema` + overlay + `memoryEntryUpdatePatchSchema`
(`packages/core/src/memory-anchor.ts` schemas), `captureCodeAnchor`,
`runVerify` + `VerifyPlan` + `applyMemoryEntryPatches`
(`packages/core/src/code-truth.ts`), and the `extractBlocksForFile` public
export from `@megasaver/output-filter`. All are contract names; import them
exactly as written there.

**Environment hazards (apply to every task below):**

- Mega Saver MCP read-proxy SILENTLY TRUNCATES file reads (banner "N kept, M
  dropped" / "[Mega Saver: compressed...]") — read files via `sed -n 'A,Bp'`
  in <=60-line chunks, locate with `grep -n`. Never trust a proxied read.
- `pnpm build` BEFORE package tests (workspace deps resolve via `dist/`).
- `pnpm --filter @megasaver/<pkg> test -- <pattern>` does NOT narrow — always
  run the whole package suite.
- Full `pnpm typecheck` REQUIRED before every commit — package vitest does NOT
  catch TS4111 (`noPropertyAccessFromIndexSignature`). If it fires, use bracket
  access + `// biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature (TS4111)`.
- tsconfig is `strict` with `exactOptionalPropertyTypes` — never assign an
  explicit `undefined` to an optional property; use conditional spreads
  (`...(x !== undefined ? { x } : {})`), exactly as the code below does.
- Branded IDs: raw string literals in tests need `as ProjectId` /
  `as MemoryEntryId` / `as SessionId` casts.
- No bare `===` in zsh echo commands.

**Section-wide design decisions (resolved ambiguities — read once):**

- The bridge has NO entitlement dependency by design. Pro is resolved
  CLI-side (`mega mcp serve` → `resolveIsPro` → `McpBridgeConfig.isPro` →
  `ServerDeps.isPro`) and threaded into tool envs as
  `isPro: deps.isPro ?? false` — the same precedent as `check_approach`.
  No env flag, no `checkEntitlement` import in `packages/mcp-bridge`.
- The registry interface is `CoreRegistry` (the contract's "MemoryRegistry"
  name does not exist in the repo — verified).
- FREE badge mapping (from STORED fields only): no `anchor` ⇒ `"unanchored"`;
  `lastVerified.result === "contradicted"` ⇒ `"contradicted-by-code"`;
  otherwise ⇒ `"verified"` (reads as "anchored, no known contradiction").
- Spot-check evidence says `code-truth: contradicted at <sha7> — …` (the
  observation HEAD), not `by <sha7>`: the 50ms budget has no room for
  `git log` attribution. Safe because heal keys STRICTLY on
  `lastVerified.result` (architect B1), never on evidence strings.
- The spot-check inspects SYMBOL anchors only. File-only anchors contradict
  only on deletion-without-rename (§6.2), and rename detection needs git
  history — over budget. The full `runVerify` pass covers them.
- `verify_memories` takes a REQUIRED `projectId` (a stateless MCP call has no
  inferable default project). Free tier returns
  `{ upsell: VERIFY_MEMORIES_UPSELL }` with no Pro compute (exit-0 CLI
  precedent: a locked feature is a normal state, not an error).
- Ledger `sessionId`: `mega_recall` demotions use `session.id`;
  `get_relevant_memories` has no session argument, so demotions use
  `hit.sessionId ?? "unattributed"`.

---

### Task 14: `"code-truth"` ProFeature + `save_memory` symbol plumbing and anchor capture

Two thin writer-side slices: (a) the entitlement union gains the
`"code-truth"` key (`checkEntitlement` is feature-agnostic — the key
documents intent, gates nothing extra at check time); (b) MCP `save_memory`
accepts `relatedSymbols` (same shape as `relatedFiles` — spec §5.1: the field
is read by four surfaces but written by NO writer today) and captures a code
anchor before the entry is built, best-effort and total: any capture failure
saves unanchored, never blocks the save.

**Files:**

- Modify: `packages/entitlement/src/entitlement.ts`
- Modify (test): `packages/entitlement/test/entitlement.test.ts`
- Modify: `packages/mcp-bridge/src/tools/save-memory.ts`
- Create (test): `packages/mcp-bridge/test/tools/save-memory-anchor.test.ts`

**Steps:**

- [ ] **Step 1: Confirm the worktree and prerequisites.**
  `cd /Users/halitozger/Desktop/MegaSaver/.claude/worktrees/living-brain && git branch --show-current`
  must print `feat/living-brain`. Then confirm the core prerequisites exist:
  `grep -n "captureCodeAnchor" packages/core/src/index.ts` and
  `grep -n "anchor" packages/core/src/memory-entry.ts | head -5` must both
  hit. If either misses, STOP — the core section has not landed; report
  instead of proceeding.

- [ ] **Step 2: Write the failing entitlement type test.** Append inside the
  existing `describe("checkEntitlement", ...)` block of
  `packages/entitlement/test/entitlement.test.ts` (after the last `it`):

```ts
  it("accepts the code-truth feature key (i6) and stays fail-closed", () => {
    const { publicKey } = generateKeyPairSync("ed25519");
    expect(checkEntitlement("code-truth", { storeRoot: root, now, publicKey })).toEqual({
      entitled: false,
      reason: "no_license",
    });
  });
```

- [ ] **Step 3: Verify the RED is a TYPE failure.** `vitest` transpiles
  without type-checking, so the runtime test PASSES — the red signal is:
  `pnpm typecheck`
  Expected failure: `TS2345: Argument of type '"code-truth"' is not
  assignable to parameter of type 'ProFeature'.` in
  `packages/entitlement/test/entitlement.test.ts`.

- [ ] **Step 4: Minimal implementation — extend the union.** In
  `packages/entitlement/src/entitlement.ts` replace line 6:

```ts
export type ProFeature = "savings-analytics" | "brain-portability";
```

  with:

```ts
export type ProFeature = "savings-analytics" | "brain-portability" | "code-truth";
```

- [ ] **Step 5: Verify GREEN.** Run:
  `pnpm typecheck && pnpm --filter @megasaver/entitlement test`
  Expected: typecheck clean; entitlement suite passes including the new test.

- [ ] **Step 6: Commit the entitlement slice.**

```bash
git add packages/entitlement
git commit -m "feat(entitlement): add code-truth pro feature key"
```

- [ ] **Step 7: Write the failing save_memory anchor test.** Create
  `packages/mcp-bridge/test/tools/save-memory-anchor.test.ts` with exactly:

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CoreRegistry, createInMemoryCoreRegistry } from "@megasaver/core";
import type { MemoryEntryId, ProjectId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleSaveMemory } from "../../src/tools/save-memory.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const TS = "2026-07-14T00:00:00.000Z";
const HEAD_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const BLOB_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

let repoDir: string;
beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "save-memory-anchor-"));
  mkdirSync(join(repoDir, "src"), { recursive: true });
  writeFileSync(
    join(repoDir, "src", "auth.ts"),
    "export function verifyToken(token: string): boolean {\n  return token.length > 0;\n}\n",
  );
});
afterEach(() => rmSync(repoDir, { recursive: true, force: true }));

function registryAt(rootPath: string): CoreRegistry {
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath,
    createdAt: TS,
    updatedAt: TS,
  });
  return registry;
}

// Mirrors the git calls the contract pins for captureCodeAnchor:
// `rev-parse HEAD` (repo head) and `rev-parse HEAD:<path>` (per-file blob).
// Any other invocation throws, which capture treats as a per-file skip.
// If the core capture implementation added further git probes, extend this
// fake to answer them — do not weaken the assertions.
function fakeExecGit(args: string[], _cwd: string): string {
  const joined = args.join(" ");
  if (joined === "rev-parse HEAD") return HEAD_SHA;
  if (joined.startsWith("rev-parse HEAD:")) return BLOB_SHA;
  throw new Error(`unexpected git call: ${joined}`);
}

describe("save_memory — code anchor capture (i6 §5/§5.1)", () => {
  it("accepts relatedSymbols and stores the captured anchor on the entry", async () => {
    const registry = registryAt(repoDir);
    const result = await handleSaveMemory(
      {
        registry,
        now: () => TS,
        newId: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        execGit: fakeExecGit,
      },
      {
        projectId: PROJECT_ID,
        scope: "project",
        content: "verifyToken must reject empty tokens",
        type: "decision",
        relatedFiles: ["src/auth.ts"],
        relatedSymbols: ["verifyToken"],
      },
    );
    const stored = registry.getMemoryEntry(result.id as MemoryEntryId);
    expect(stored).not.toBeNull();
    expect(stored?.relatedSymbols).toEqual(["verifyToken"]);
    expect(stored?.anchor).toBeDefined();
    expect(stored?.anchor?.repoHead).toBe(HEAD_SHA);
    expect(stored?.anchor?.capturedAt).toBe(TS);
    expect(stored?.anchor?.files).toEqual([{ path: "src/auth.ts", blobSha: BLOB_SHA }]);
    const symbol = stored?.anchor?.symbols[0];
    expect(symbol?.path).toBe("src/auth.ts");
    expect(symbol?.name).toBe("verifyToken");
    expect(symbol?.contentHash).toBeTruthy();
  });

  it("saves unanchored when the project root is not a git repo", async () => {
    const registry = registryAt(repoDir);
    const result = await handleSaveMemory(
      {
        registry,
        now: () => TS,
        newId: () => "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        execGit: () => {
          throw new Error("fatal: not a git repository");
        },
      },
      {
        projectId: PROJECT_ID,
        scope: "project",
        content: "verifyToken must reject empty tokens",
        relatedFiles: ["src/auth.ts"],
        relatedSymbols: ["verifyToken"],
      },
    );
    const stored = registry.getMemoryEntry(result.id as MemoryEntryId);
    expect(stored).not.toBeNull();
    expect(stored?.anchor).toBeUndefined();
    expect(stored?.relatedSymbols).toEqual(["verifyToken"]);
  });
});
```

- [ ] **Step 8: Run to verify FAIL.**
  `pnpm build && pnpm --filter @megasaver/mcp-bridge test`
  Expected failure: both new tests throw
  `McpBridgeError: validation_failed` whose message contains
  `Unrecognized key(s) in object: 'relatedSymbols'` (the `.strict()` input
  schema rejects the new field). The TS compile may also flag `execGit` as an
  unknown env property — both symptoms are the same missing implementation.

- [ ] **Step 9: Minimal implementation.** Edit
  `packages/mcp-bridge/src/tools/save-memory.ts` (locate each site with
  `grep -n`; the file is 148 lines pre-edit):

  9a. Add `captureCodeAnchor` to the existing `@megasaver/core` import list
  (it currently imports `type CoreRegistry, type MemoryEntry, ...,
  saveMemoryWithLineage`):

```ts
import {
  type CoreRegistry,
  type MemoryEntry,
  type SaveMemoryLineageResult,
  captureCodeAnchor,
  memoryApprovalSchema,
  memoryConfidenceSchema,
  memoryEmbedText,
  memoryEmbeddingsSidecarPath,
  memoryEntrySchema,
  memoryScopeSchema,
  memorySourceSchema,
  memoryTypeSchema,
  saveMemoryWithLineage,
} from "@megasaver/core";
```

  9b. Extend `SaveMemoryEnv` (add the last field):

```ts
export type SaveMemoryEnv = {
  registry: CoreRegistry;
  now: () => string;
  newId: () => string;
  // Cosine supersession inputs are best-effort: storeRoot locates the memory
  // vector sidecar; embedFn is injectable so tests never load the real model.
  storeRoot?: string;
  embedFn?: (texts: readonly string[]) => Promise<Float32Array[]>;
  // Injectable git runner threaded into captureCodeAnchor so anchor tests
  // never need a real repo. Absent ⇒ capture's execFileSync default.
  execGit?: (args: string[], cwd: string) => string;
};
```

  9c. In `saveMemoryInputSchema`, add directly after the
  `relatedFiles: z.array(z.string()).optional(),` line:

```ts
    relatedSymbols: z.array(z.string()).optional(),
```

  9d. In `handleSaveMemory`, directly after `const d = parsed.data;` and
  before `let entry: MemoryEntry;`, insert:

```ts
  // Code anchor capture (i6 §5): best-effort and TOTAL — any failure (no git,
  // missing project, extractor throw) yields undefined and the save proceeds
  // unanchored. Capture must never block or fail a save. save_memory has no
  // opt-out flag by design (§5.1: agents shouldn't decide).
  const project = env.registry.getProject(d.projectId as ProjectId);
  const anchor =
    project !== null && (d.relatedFiles !== undefined || d.relatedSymbols !== undefined)
      ? await captureCodeAnchor({
          rootPath: project.rootPath,
          ...(d.relatedFiles !== undefined ? { relatedFiles: d.relatedFiles } : {}),
          ...(d.relatedSymbols !== undefined ? { relatedSymbols: d.relatedSymbols } : {}),
          now: env.now(),
          ...(env.execGit !== undefined ? { execGit: env.execGit } : {}),
        })
      : undefined;
```

  9e. In the `memoryEntrySchema.parse({ ... })` object, add directly after
  the `...(d.relatedFiles !== undefined ? { relatedFiles: d.relatedFiles } : {}),`
  spread:

```ts
      ...(d.relatedSymbols !== undefined ? { relatedSymbols: d.relatedSymbols } : {}),
      ...(anchor !== undefined ? { anchor } : {}),
```

- [ ] **Step 10: Run to verify PASS.**
  `pnpm build && pnpm --filter @megasaver/mcp-bridge test`
  Expected: full mcp-bridge suite green, including the two new tests.

- [ ] **Step 11: Gates + commit.**
  `pnpm lint:fix && pnpm typecheck` (both clean), then:

```bash
git add packages/mcp-bridge
git commit -m "feat(mcp): save_memory captures code anchors"
```

---

### Task 15: FREE verification badge + PRO pre-recall spot-check (get_relevant_memories + mega_recall)

New shared module `code-truth-check.ts` owns two things: (1) the FREE badge
computed from STORED fields only, and (2) the PRO spot-check per spec §8.4 —
top-5 anchored hits post-ranking, mtime pre-filter against
`anchor.capturedAt`, hard ~50ms budget with fail-open passthrough,
contradicted hits EXCLUDED from results and disclosed in a response-level
`contradictedByCode: [{id, title}]` (titles through the i1 `containsSentinel`
guard), and the stale/validTo flip persisted INLINE inside the existing
handler try/catch with write errors swallowed (architect M3). Both recall
surfaces are wired (the enrichment-duplication precedent: `withChangedFrom`
in get-relevant-memories.ts AND the inline closure in recall.ts).

`containsSentinel` lives in `@megasaver/connectors-shared`, which mcp-bridge
does not depend on today — add the workspace dep (no cycle:
connectors-shared depends only on core + shared; core cannot re-export it
because connectors-shared depends on core).

**Files:**

- Modify: `packages/mcp-bridge/package.json` (add `@megasaver/connectors-shared`)
- Create: `packages/mcp-bridge/src/tools/code-truth-check.ts`
- Modify: `packages/mcp-bridge/src/tools/get-relevant-memories.ts`
- Modify: `packages/mcp-bridge/src/tools/recall.ts`
- Modify: `packages/mcp-bridge/src/server.ts` (two dispatch cases)
- Create (test): `packages/mcp-bridge/test/tools/code-truth-check.test.ts`

**Steps:**

- [ ] **Step 1: Add the connectors-shared dependency.** In
  `packages/mcp-bridge/package.json` `dependencies`, insert (alphabetical —
  before `"@megasaver/content-store"`):

```json
    "@megasaver/connectors-shared": "workspace:*",
```

  Then run `pnpm install` (workspace link only, fast).

- [ ] **Step 2: Write the failing test.** Create
  `packages/mcp-bridge/test/tools/code-truth-check.test.ts` with exactly:

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CoreRegistry, type MemoryEntry, createInMemoryCoreRegistry } from "@megasaver/core";
import { extractBlocksForFile } from "@megasaver/output-filter";
import type { MemoryEntryId, ProjectId, SessionId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleGetRelevantMemories } from "../../src/tools/get-relevant-memories.js";
import { handleRecall } from "../../src/tools/recall.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const SESSION_ID = "33333333-3333-4333-8333-333333333333" as SessionId;
const STALE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as MemoryEntryId;
const PLAIN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" as MemoryEntryId;
const GOOD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc" as MemoryEntryId;
const FLAGGED = "dddddddd-dddd-4ddd-8ddd-dddddddddddd" as MemoryEntryId;
const TS = "2026-07-14T00:00:00.000Z";
const NOW = "2026-07-14T12:00:00.000Z";
// Long past so every real file mtime is newer than the anchor capture.
const CAPTURED_AT = "2020-01-01T00:00:00.000Z";
const OLD_HEAD = "1111111111111111111111111111111111111111";
const NEW_HEAD = "2222222222222222222222222222222222222222";

const AUTH_SOURCE = `export function verifyToken(token: string): boolean {
  return token.length > 0;
}
`;

const fakeExecGit = (args: string[], _cwd: string): string => {
  if (args.join(" ") === "rev-parse HEAD") return NEW_HEAD;
  throw new Error(`unexpected git call: ${args.join(" ")}`);
};

let repoDir: string;
beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "code-truth-check-"));
  mkdirSync(join(repoDir, "src"), { recursive: true });
  writeFileSync(join(repoDir, "src", "auth.ts"), AUTH_SOURCE);
});
afterEach(() => rmSync(repoDir, { recursive: true, force: true }));

function seeded(): CoreRegistry {
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: repoDir,
    createdAt: TS,
    updatedAt: TS,
  });
  return registry;
}

function staleAnchor() {
  return {
    repoHead: OLD_HEAD,
    capturedAt: CAPTURED_AT,
    files: [{ path: "src/auth.ts", blobSha: "0000000000000000000000000000000000000000" }],
    symbols: [
      {
        path: "src/auth.ts",
        name: "verifyToken",
        startLine: 1,
        endLine: 3,
        contentHash: "not-the-current-hash",
      },
    ],
  };
}

function makeEntry(
  registry: CoreRegistry,
  id: MemoryEntryId,
  extra?: Pick<Partial<MemoryEntry>, "anchor" | "lastVerified" | "title">,
): void {
  registry.createMemoryEntry({
    id,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: extra?.title ?? `memory ${id.slice(0, 8)}`,
    content: "verifyToken rejects empty tokens",
    keywords: [],
    confidence: "medium",
    source: "manual",
    approval: "approved",
    stale: false,
    createdAt: TS,
    updatedAt: TS,
    ...(extra?.anchor !== undefined ? { anchor: extra.anchor } : {}),
    ...(extra?.lastVerified !== undefined ? { lastVerified: extra.lastVerified } : {}),
  });
}

describe("code-truth on recall surfaces (i6 §8.4/§8.6)", () => {
  it("FREE path: badge per hit from stored fields, no spot-check, no writes", async () => {
    const registry = seeded();
    makeEntry(registry, STALE, { anchor: staleAnchor() });
    makeEntry(registry, PLAIN);
    makeEntry(registry, FLAGGED, {
      anchor: staleAnchor(),
      lastVerified: {
        headSha: OLD_HEAD,
        at: TS,
        result: "contradicted",
        closedByCodeTruth: false,
      },
    });

    const result = await handleGetRelevantMemories(
      { registry, isPro: false, now: () => NOW, execGit: fakeExecGit },
      { projectId: PROJECT_ID, task: "verifyToken" },
    );
    const badges = new Map(result.memory.map((m) => [m.id, m.verification]));
    expect(badges.get(STALE)).toBe("verified");
    expect(badges.get(PLAIN)).toBe("unanchored");
    expect(badges.get(FLAGGED)).toBe("contradicted-by-code");
    expect(result.contradictedByCode).toBeUndefined();
    // Free tier never persists a flip.
    expect(registry.getMemoryEntry(STALE)?.stale).toBe(false);
  });

  it("PRO spot-check excludes the contradicted hit, discloses it, persists the flip", async () => {
    const registry = seeded();
    makeEntry(registry, STALE, { anchor: staleAnchor() });
    makeEntry(registry, PLAIN);
    // GOOD anchors the REAL current hash — the any-match rule must keep it.
    const blocks = await extractBlocksForFile("src/auth.ts", AUTH_SOURCE);
    const realHash = blocks?.find((b) => b.name === "verifyToken")?.contentHash;
    expect(realHash).toBeTruthy();
    makeEntry(registry, GOOD, {
      anchor: {
        ...staleAnchor(),
        symbols: [
          {
            path: "src/auth.ts",
            name: "verifyToken",
            startLine: 1,
            endLine: 3,
            contentHash: realHash as string,
          },
        ],
      },
    });

    const result = await handleGetRelevantMemories(
      { registry, isPro: true, now: () => NOW, execGit: fakeExecGit },
      { projectId: PROJECT_ID, task: "verifyToken" },
    );
    expect(result.memory.map((m) => m.id).sort()).toEqual([PLAIN, GOOD].sort());
    expect(result.contradictedByCode).toEqual([{ id: STALE, title: "memory aaaaaaaa" }]);

    const flipped = registry.getMemoryEntry(STALE);
    expect(flipped?.stale).toBe(true);
    expect(flipped?.validTo).toBe(NOW);
    expect(flipped?.lastVerified).toEqual({
      headSha: NEW_HEAD,
      at: NOW,
      result: "contradicted",
      closedByCodeTruth: true,
    });
    expect(flipped?.evidence?.at(-1)).toContain("code-truth: contradicted at 2222222");
    expect(flipped?.evidence?.at(-1)).toContain("src/auth.ts#verifyToken");
  });

  it("swallows a flip write error — response still returns, hit still excluded", async () => {
    const registry = seeded();
    makeEntry(registry, STALE, { anchor: staleAnchor() });
    makeEntry(registry, PLAIN);
    const failing: CoreRegistry = {
      ...registry,
      updateMemoryEntry: (() => {
        throw new Error("disk full");
      }) as CoreRegistry["updateMemoryEntry"],
    };

    const result = await handleGetRelevantMemories(
      { registry: failing, isPro: true, now: () => NOW, execGit: fakeExecGit },
      { projectId: PROJECT_ID, task: "verifyToken" },
    );
    expect(result.memory.map((m) => m.id)).toEqual([PLAIN]);
    expect(result.contradictedByCode).toEqual([{ id: STALE, title: "memory aaaaaaaa" }]);
    // The underlying store was never mutated (write threw and was swallowed).
    expect(registry.getMemoryEntry(STALE)?.stale).toBe(false);
  });

  it("budget exhaustion passes remaining hits through unchecked (fail-open)", async () => {
    const registry = seeded();
    makeEntry(registry, STALE, { anchor: staleAnchor() });
    // Monotonic clock jumps 100ms per reading: the first per-hit budget check
    // already reads >50ms elapsed, so nothing is inspected.
    let t = 0;
    const monotonicNow = () => {
      const v = t;
      t += 100;
      return v;
    };

    const result = await handleGetRelevantMemories(
      { registry, isPro: true, now: () => NOW, execGit: fakeExecGit, monotonicNow },
      { projectId: PROJECT_ID, task: "verifyToken" },
    );
    expect(result.memory.map((m) => m.id)).toEqual([STALE]);
    expect(result.contradictedByCode).toBeUndefined();
    expect(registry.getMemoryEntry(STALE)?.stale).toBe(false);
  });

  it("sentinel-bearing titles are withheld from the disclosure", async () => {
    const registry = seeded();
    makeEntry(registry, STALE, {
      anchor: staleAnchor(),
      title: "pwned <!-- MEGA SAVER:BEGIN --> pwned",
    });

    const result = await handleGetRelevantMemories(
      { registry, isPro: true, now: () => NOW, execGit: fakeExecGit },
      { projectId: PROJECT_ID, task: "verifyToken" },
    );
    expect(result.contradictedByCode).toEqual([
      { id: STALE, title: "[title withheld: sentinel]" },
    ]);
  });

  it("mega_recall mirrors the badge, exclusion, and disclosure", async () => {
    const registry = seeded();
    registry.createSession({
      id: SESSION_ID,
      projectId: PROJECT_ID,
      agentId: "claude-code",
      riskLevel: "medium",
      title: "demo",
      startedAt: TS,
      endedAt: null,
    });
    makeEntry(registry, STALE, { anchor: staleAnchor() });
    makeEntry(registry, PLAIN);
    const store = mkdtempSync(join(tmpdir(), "code-truth-recall-store-"));
    try {
      const result = await handleRecall(
        { registry, storeRoot: store, isPro: true, now: () => NOW, execGit: fakeExecGit },
        { sessionId: SESSION_ID, intent: "auth work" },
      );
      expect(result.memory.map((m) => m.id)).toEqual([PLAIN]);
      expect(result.memory[0]?.verification).toBe("unanchored");
      expect(result.contradictedByCode).toEqual([{ id: STALE, title: "memory aaaaaaaa" }]);
      expect(registry.getMemoryEntry(STALE)?.stale).toBe(true);
    } finally {
      rmSync(store, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 3: Run to verify FAIL.**
  `pnpm build && pnpm --filter @megasaver/mcp-bridge test`
  The test file imports only the two handlers (which exist), and vitest
  transpiles without type-checking, so the red signal is six assertion
  failures, not a module error: `m.verification` is `undefined` (first diff:
  `badges.get(PLAIN)` is `undefined`, expected `"unanchored"`),
  `result.contradictedByCode` never appears, and the PRO tests find the
  stale hit still present.

- [ ] **Step 4: Create the shared check module.** Create
  `packages/mcp-bridge/src/tools/code-truth-check.ts` with exactly:

```ts
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { containsSentinel } from "@megasaver/connectors-shared";
import type { CoreRegistry, MemoryEntry } from "@megasaver/core";
import { extractBlocksForFile } from "@megasaver/output-filter";
import type { MemoryEntryId } from "@megasaver/shared";

export type VerificationBadge = "verified" | "contradicted-by-code" | "unanchored";

// FREE badge from STORED state only (spec §8.6): the anchor decides
// anchored/unanchored; a stored contradiction wins over everything else. An
// anchored row with no stored contradiction reads "verified" — the badge
// claims "anchored, no known contradiction", never a live check.
export function verificationBadgeFor(entry: MemoryEntry): VerificationBadge {
  if (entry.anchor === undefined) return "unanchored";
  if (entry.lastVerified?.result === "contradicted") return "contradicted-by-code";
  return "verified";
}

export const SPOT_CHECK_BUDGET_MS = 50;
export const SPOT_CHECK_TOP_N = 5;

export type ContradictedDisclosure = { id: string; title: string };

export type SpotCheckEnv = {
  registry: CoreRegistry;
  isPro: boolean;
  now: () => string;
  // Injectable for tests (spec §12): budget clock + git head resolver.
  monotonicNow?: () => number;
  execGit?: (args: string[], cwd: string) => string;
};

export type SpotCheckResult<T extends MemoryEntry> = {
  hits: T[];
  contradictedByCode: ContradictedDisclosure[];
};

function defaultExecGit(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 1500 }).trim();
}

// Pre-recall spot-check (spec §8.4). PRO only; FREE returns the input
// untouched. Inspects the top-5 anchored hits post-ranking, SYMBOL anchors
// only (file-only anchors contradict only on deletion-without-rename — §6.2 —
// and rename detection needs git history, which the ~50ms budget forbids; the
// full `mega memory verify` pass covers them). mtime pre-filter is a
// non-authoritative optimization (architect N5) — fail-open by design.
// Contradicted hits are excluded from the returned list and disclosed with
// sentinel-guarded titles; the stale/validTo flip persists inline and every
// write error is swallowed (architect M3: the response must always return).
export async function spotCheckHits<T extends MemoryEntry>(
  env: SpotCheckEnv,
  rootPath: string,
  ranked: readonly T[],
): Promise<SpotCheckResult<T>> {
  const passthrough: SpotCheckResult<T> = { hits: [...ranked], contradictedByCode: [] };
  if (!env.isPro) return passthrough;

  const clock = env.monotonicNow ?? Date.now;
  const started = clock();
  const overBudget = () => clock() - started > SPOT_CHECK_BUDGET_MS;

  let headSha: string;
  try {
    headSha = (env.execGit ?? defaultExecGit)(["rev-parse", "HEAD"], rootPath);
  } catch {
    return passthrough; // not a git repo / git missing — fail open
  }

  const anchored = ranked.filter((h) => h.anchor !== undefined).slice(0, SPOT_CHECK_TOP_N);
  const contradictedIds = new Set<string>();
  const disclosures: ContradictedDisclosure[] = [];

  for (const hit of anchored) {
    if (overBudget()) break; // fail-open: remaining hits pass through unchecked
    const anchor = hit.anchor;
    if (anchor === undefined || anchor.symbols.length === 0) continue;
    const capturedAtMs = Date.parse(anchor.capturedAt);
    const paths = [...new Set(anchor.symbols.map((s) => s.path))];
    let contradiction: { path: string; symbol: string; reason: string } | undefined;

    for (const path of paths) {
      if (overBudget() || contradiction !== undefined) break;
      const symbols = anchor.symbols.filter((s) => s.path === path);
      let source: string;
      try {
        // mtime pre-filter (§8.4): untouched since capture ⇒ skip re-hash.
        if (statSync(join(rootPath, path)).mtimeMs <= capturedAtMs) continue;
        source = readFileSync(join(rootPath, path), "utf8");
      } catch {
        // Worktree read failed ⇒ every symbol in the file is missing (§6.4).
        const first = symbols[0];
        if (first !== undefined) {
          contradiction = { path, symbol: first.name, reason: "file missing from worktree" };
        }
        continue;
      }
      let blocks: Awaited<ReturnType<typeof extractBlocksForFile>>;
      try {
        blocks = await extractBlocksForFile(path, source);
      } catch {
        continue; // extractor failure is never a contradiction — fail open
      }
      if (blocks === undefined) continue; // unsupported extension: file anchor only
      for (const sym of symbols) {
        const candidates = blocks.filter((b) => b.name === sym.name);
        if (candidates.length === 0) {
          contradiction = { path, symbol: sym.name, reason: "symbol missing" };
          break;
        }
        // Name-collision rule (§6.2/N2): ANY candidate matching ⇒ verified;
        // ambiguity never produces a contradiction.
        if (!candidates.some((b) => b.contentHash === sym.contentHash)) {
          contradiction = { path, symbol: sym.name, reason: "symbol hash changed" };
          break;
        }
      }
    }
    if (contradiction === undefined) continue;

    contradictedIds.add(hit.id);
    disclosures.push({
      id: hit.id,
      title: containsSentinel(hit.title) ? "[title withheld: sentinel]" : hit.title,
    });
    // Flip persisted INLINE, fail-open (§7 contradicted bucket): stale, close
    // validTo ONLY when open (and own that close via closedByCodeTruth),
    // machine-composed evidence, lastVerified. NEVER touches lastActiveAt.
    try {
      const now = env.now();
      const open = hit.validTo === undefined || hit.validTo === null;
      env.registry.updateMemoryEntry(hit.id as MemoryEntryId, {
        stale: true,
        ...(open ? { validTo: now } : {}),
        evidence: [
          ...(hit.evidence ?? []),
          `code-truth: contradicted at ${headSha.slice(0, 7)} — ${contradiction.path}#${contradiction.symbol} ${contradiction.reason}`,
        ],
        lastVerified: {
          headSha,
          at: now,
          result: "contradicted",
          closedByCodeTruth: open,
        },
        updatedAt: now,
      });
    } catch {
      // swallowed: the spot-check must never fail the recall response
    }
  }

  return {
    hits: ranked.filter((h) => !contradictedIds.has(h.id)),
    contradictedByCode: disclosures,
  };
}
```

- [ ] **Step 5: Rewrite `get-relevant-memories.ts`.** Replace the FULL
  contents of `packages/mcp-bridge/src/tools/get-relevant-memories.ts` with:

```ts
import {
  type ChangedFrom,
  type CoreRegistry,
  CoreRegistryError,
  type MemoryEntry,
  changedFromFor,
  isRecallable,
  memoryEmbeddingsSidecarPath,
  searchMemoryEntriesSemantic,
} from "@megasaver/core";
import { embed, readVectors } from "@megasaver/embeddings";
import type { ProjectId } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";
import {
  type ContradictedDisclosure,
  type VerificationBadge,
  spotCheckHits,
  verificationBadgeFor,
} from "./code-truth-check.js";

// embedFn is injectable so the boundary can be unit-tested with a fake — no model
// in CI. storeRoot locates the per-project memory-vector sidecar; absent ⇒ the
// semantic signal is skipped and BM25 is used.
export type EmbedFn = (texts: readonly string[]) => Promise<Float32Array[]>;
export type GetRelevantMemoriesEnv = {
  registry: CoreRegistry;
  storeRoot?: string;
  embedFn?: EmbedFn;
  // Pro is resolved CLI-side (mega mcp serve) and threaded through ServerDeps;
  // the spot-check (i6 §8.4) is a no-op when absent/false. now/monotonicNow/
  // execGit are injectable for deterministic spot-check tests.
  isPro?: boolean;
  now?: () => string;
  monotonicNow?: () => number;
  execGit?: (args: string[], cwd: string) => string;
};

const getRelevantMemoriesInputSchema = z
  .object({
    projectId: z.string().min(1),
    task: z.string().min(1),
    limit: z.number().int().positive().optional(),
    // Bi-temporal time-travel: rank memories valid AS OF this instant.
    // Absent ⇒ now ⇒ currently-valid only.
    asOf: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export type GetRelevantMemoriesResult = {
  memory: readonly (MemoryEntry & {
    changedFrom?: ChangedFrom;
    verification: VerificationBadge;
  })[];
  contradictedByCode?: ContradictedDisclosure[];
};

// Best-effort semantic ranking: returns vector-ranked memories ONLY when a
// sidecar with FULL coverage of the candidate memories exists AND embedding the
// task succeeds. Any failure (no storeRoot, no/partial sidecar, model absent,
// embed throws) returns null so the caller falls back to BM25. Never throws.
// Mirrors embeddingSignalFor in context-pruning.ts.
//
// Full-coverage guard: searchMemoryEntriesSemantic drops any candidate whose
// vector is missing. No production path embeds on write, so a memory created or
// approved after the last manual sidecar build is un-vectored — the default
// steady state is PARTIAL coverage. Ranking a partial sidecar would silently
// omit a real approved memory. So if any candidate lacks a vector, fall back to
// BM25 (which returns all matches): results are either full-coverage semantic OR
// BM25, never a silently-truncated mix.
async function semanticMemoryRanking(
  env: GetRelevantMemoriesEnv,
  projectId: ProjectId,
  task: string,
  limit: number | undefined,
  asOf: string,
): Promise<MemoryEntry[] | null> {
  if (env.storeRoot === undefined) return null;
  try {
    const memoryVectors = readVectors(memoryEmbeddingsSidecarPath(env.storeRoot, projectId));
    if (memoryVectors.size === 0) return null;
    const entries = env.registry.listMemoryEntries(projectId);
    // The same filter searchMemoryEntriesSemantic applies by default: approved,
    // current-as-of (isRecallable), non-stale. A candidate missing a vector means
    // partial coverage → BM25. The asOf gate must match so a closed (non-current)
    // memory without a vector does not force a needless BM25 fallback.
    const candidates = entries.filter((e) => isRecallable(e, asOf) && !e.stale);
    if (candidates.some((e) => !memoryVectors.has(e.id))) return null;
    const [queryVector] = await (env.embedFn ?? embed)([task]);
    if (queryVector === undefined) return null;
    // Pass `candidates` (the gated set the coverage check validated), not the raw
    // entries, so the coverage gate and the ranked input are the same set.
    return searchMemoryEntriesSemantic(candidates, {
      queryVector,
      memoryVectors,
      asOf,
      ...(limit !== undefined ? { limit } : {}),
    });
  } catch {
    return null;
  }
}

// changedFrom enrichment (response-only, never persisted): a hit that
// supersedes a CLOSED predecessor carries { title, closedAt, reason } so the
// agent sees what changed. Reopened predecessors (validTo null) carry nothing.
function withChangedFrom(
  registry: CoreRegistry,
  hits: readonly MemoryEntry[],
): (MemoryEntry & { changedFrom?: ChangedFrom })[] {
  const byId = new Map<string, MemoryEntry>();
  for (const hit of hits) {
    if (hit.supersedesId === undefined || byId.has(hit.supersedesId)) continue;
    const predecessor = registry.getMemoryEntry(hit.supersedesId);
    if (predecessor !== null) byId.set(hit.supersedesId, predecessor);
  }
  return hits.map((hit) => {
    const changedFrom = changedFromFor(hit, byId);
    return { ...hit, ...(changedFrom === undefined ? {} : { changedFrom }) };
  });
}

// Free-text task → top-N relevant memories. Semantic (cosine over the memory
// sidecar) when available, gracefully falling back to BM25 over title+content+
// keywords (the same offline ranker as `mega memory search`).
export async function handleGetRelevantMemories(
  env: GetRelevantMemoriesEnv,
  rawArgs: unknown,
): Promise<GetRelevantMemoriesResult> {
  const parsed = getRelevantMemoriesInputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const { projectId, task, limit, asOf } = parsed.data;
  const at = asOf ?? new Date().toISOString();

  try {
    const semantic = await semanticMemoryRanking(env, projectId as ProjectId, task, limit, at);
    const ranked =
      semantic ??
      env.registry.searchMemoryEntries(projectId as ProjectId, {
        text: task,
        asOf: at,
        ...(limit !== undefined ? { limit } : {}),
      });
    // Pre-recall spot-check (i6 §8.4): Pro-only, fail-open, ~50ms budget.
    // Contradicted hits are EXCLUDED from the response and disclosed in
    // contradictedByCode; the stale/validTo flip persists inline inside THIS
    // try/catch (architect M3 — the bridge has no post-response lifecycle).
    const project = env.registry.getProject(projectId as ProjectId);
    const check =
      project !== null
        ? await spotCheckHits(
            {
              registry: env.registry,
              isPro: env.isPro ?? false,
              now: env.now ?? (() => new Date().toISOString()),
              ...(env.monotonicNow !== undefined ? { monotonicNow: env.monotonicNow } : {}),
              ...(env.execGit !== undefined ? { execGit: env.execGit } : {}),
            },
            project.rootPath,
            ranked,
          )
        : { hits: [...ranked], contradictedByCode: [] as ContradictedDisclosure[] };
    const memory = withChangedFrom(env.registry, check.hits).map((m) => ({
      ...m,
      verification: verificationBadgeFor(m),
    }));
    return {
      memory,
      ...(check.contradictedByCode.length > 0
        ? { contradictedByCode: check.contradictedByCode }
        : {}),
    };
  } catch (err) {
    if (err instanceof CoreRegistryError && err.code === "project_not_found") {
      throw new McpBridgeError("resource_not_found", err.message);
    }
    throw err;
  }
}
```

- [ ] **Step 6: Rewrite `recall.ts`.** Replace the FULL contents of
  `packages/mcp-bridge/src/tools/recall.ts` with:

```ts
import { type ChunkSetSummary, listChunkSets } from "@megasaver/content-store";
import {
  type ChangedFrom,
  type CoreRegistry,
  type MemoryEntry,
  changedFromFor,
  isRecallable,
} from "@megasaver/core";
import type { SessionId } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";
import {
  type ContradictedDisclosure,
  type VerificationBadge,
  spotCheckHits,
  verificationBadgeFor,
} from "./code-truth-check.js";
import { forwardOrFallback } from "./forward.js";

export type RecallToolEnv = {
  registry: CoreRegistry;
  storeRoot: string;
  // Pro is resolved CLI-side and threaded via ServerDeps (i6 §8.4). now/
  // monotonicNow/execGit are injectable for deterministic spot-check tests.
  isPro?: boolean;
  now?: () => string;
  monotonicNow?: () => number;
  execGit?: (args: string[], cwd: string) => string;
};

const recallInputSchema = z
  .object({
    sessionId: z.string().min(1),
    intent: z.string(),
    maxBytes: z.number().int().positive().optional(),
    // Bi-temporal time-travel: recall what we believed as of this instant.
    // Absent ⇒ now ⇒ currently-valid memories only.
    asOf: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export type RecallToolResult = {
  memory: readonly (MemoryEntry & {
    changedFrom?: ChangedFrom;
    verification: VerificationBadge;
  })[];
  chunkSets: readonly ChunkSetSummary[];
  contradictedByCode?: ContradictedDisclosure[];
};

export async function handleRecall(
  env: RecallToolEnv,
  rawArgs: unknown,
): Promise<RecallToolResult> {
  const parsed = recallInputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const { sessionId, intent, asOf } = parsed.data;

  if (intent.trim() === "") {
    throw new McpBridgeError("intent_required", "mega_recall requires a non-empty intent");
  }
  const at = asOf ?? new Date().toISOString();

  return forwardOrFallback(
    env.storeRoot,
    "/recall-registry",
    { sessionId, intent, ...(asOf !== undefined ? { asOf } : {}) },
    async () => {
      const session = env.registry.getSession(sessionId as SessionId);
      if (session === null) {
        throw new McpBridgeError("session_not_found", `session not found: ${sessionId}`);
      }

      const allMemory = env.registry.listMemoryEntries(session.projectId);
      const recallable = allMemory.filter(
        (m) => isRecallable(m, at) && (m.sessionId === session.id || m.scope === "project"),
      );
      // Pre-recall spot-check (i6 §8.4). recall is unranked, so "top-5
      // anchored hits post-ranking" degrades to the first 5 anchored entries
      // in result order. Pro-only; free tier passes through unchanged.
      const project = env.registry.getProject(session.projectId);
      const check =
        project !== null
          ? await spotCheckHits(
              {
                registry: env.registry,
                isPro: env.isPro ?? false,
                now: env.now ?? (() => new Date().toISOString()),
                ...(env.monotonicNow !== undefined ? { monotonicNow: env.monotonicNow } : {}),
                ...(env.execGit !== undefined ? { execGit: env.execGit } : {}),
              },
              project.rootPath,
              recallable,
            )
          : { hits: recallable, contradictedByCode: [] as ContradictedDisclosure[] };
      // changedFrom enrichment (response-only): the predecessor lookup is free
      // from the already-loaded allMemory. NOTE: the daemon /recall-registry
      // route has no server-side handler today; if one ever lands it must
      // mirror this enrichment AND the badge/spot-check above.
      const byId = new Map<string, MemoryEntry>(allMemory.map((m) => [m.id, m]));
      const memory = check.hits.map((m) => {
        const changedFrom = changedFromFor(m, byId);
        return {
          ...m,
          ...(changedFrom === undefined ? {} : { changedFrom }),
          verification: verificationBadgeFor(m),
        };
      });
      const chunkSets = await listChunkSets({
        storeRoot: env.storeRoot,
        projectId: session.projectId,
        sessionId: session.id,
      });

      return {
        memory,
        chunkSets,
        ...(check.contradictedByCode.length > 0
          ? { contradictedByCode: check.contradictedByCode }
          : {}),
      };
    },
  );
}
```

- [ ] **Step 7: Thread isPro/now through the two dispatch cases.** In
  `packages/mcp-bridge/src/server.ts` (locate with
  `grep -n 'case "mega_recall"' packages/mcp-bridge/src/server.ts` and
  `grep -n 'case "get_relevant_memories"'`), replace:

```ts
      case "mega_recall":
        return handleRecall({ registry: deps.registry, storeRoot: deps.storeRoot }, args);
```

  with:

```ts
      case "mega_recall":
        return handleRecall(
          { registry: deps.registry, storeRoot: deps.storeRoot, isPro: deps.isPro ?? false, now },
          args,
        );
```

  and replace:

```ts
      case "get_relevant_memories":
        return handleGetRelevantMemories(
          { registry: deps.registry, storeRoot: deps.storeRoot },
          args,
        );
```

  with:

```ts
      case "get_relevant_memories":
        return handleGetRelevantMemories(
          { registry: deps.registry, storeRoot: deps.storeRoot, isPro: deps.isPro ?? false, now },
          args,
        );
```

- [ ] **Step 8: Run to verify PASS.**
  `pnpm build && pnpm --filter @megasaver/mcp-bridge test`
  Expected: all six new tests green AND the pre-existing suites
  (`memory-tools.test.ts`, `get-relevant-memories-semantic.test.ts`,
  `server.e2e.test.ts`) still green — they assert ids/order, and the new
  `verification` field is additive. If any pre-existing test does a deep
  `toEqual` on whole memory objects, update THAT assertion to include
  `verification: "unanchored"` (do not weaken the new handlers).

- [ ] **Step 9: Gates + commit.**
  `pnpm lint:fix && pnpm typecheck` (both clean), then:

```bash
git add packages/mcp-bridge pnpm-lock.yaml
git commit -m "feat(mcp): recall badge + pro spot-check"
```

---

### Task 16: new `verify_memories` MCP tool (PRO)

Thin alias over the core `runVerify` runner (contract). Registration follows
the exact new-tool recipe: enum entry in `tool-name.ts` (alphabetical),
handler file with `.strict()` Zod input, `TOOL_DEFS` entry + dispatch case in
`server.ts`. No `NAME_PAIRS` entry (same name in both naming modes). The
server e2e test's tool count moves 34 → 35.

**Files:**

- Create: `packages/mcp-bridge/src/tools/verify-memories.ts`
- Modify: `packages/mcp-bridge/src/tool-name.ts`
- Modify: `packages/mcp-bridge/src/server.ts`
- Modify (test): `packages/mcp-bridge/test/server.e2e.test.ts`
- Create (test): `packages/mcp-bridge/test/tools/verify-memories.test.ts`

**Steps:**

- [ ] **Step 1: Write the failing test.** Create
  `packages/mcp-bridge/test/tools/verify-memories.test.ts` with exactly
  (real git — this is the WOW-loop fixture from spec §12):

```ts
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CoreRegistry, createInMemoryCoreRegistry } from "@megasaver/core";
import type { MemoryEntryId, ProjectId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleSaveMemory } from "../../src/tools/save-memory.js";
import { VERIFY_MEMORIES_UPSELL, handleVerifyMemories } from "../../src/tools/verify-memories.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const TS = "2026-07-14T00:00:00.000Z";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

const AUTH_WITH_SYMBOL = `export function verifyToken(token: string): boolean {
  return token.length > 0;
}

export function otherHelper(): number {
  return 1;
}
`;

const AUTH_WITHOUT_SYMBOL = `export function otherHelper(): number {
  return 1;
}
`;

let repoDir: string;
beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "verify-memories-"));
  git(repoDir, "init", "-q");
  git(repoDir, "config", "user.email", "test@test.invalid");
  git(repoDir, "config", "user.name", "test");
  git(repoDir, "config", "commit.gpgsign", "false");
  mkdirSync(join(repoDir, "src"), { recursive: true });
  writeFileSync(join(repoDir, "src", "auth.ts"), AUTH_WITH_SYMBOL);
  git(repoDir, "add", ".");
  git(repoDir, "commit", "-q", "-m", "fixture: auth with verifyToken");
});
afterEach(() => rmSync(repoDir, { recursive: true, force: true }));

function registryAt(rootPath: string): CoreRegistry {
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath,
    createdAt: TS,
    updatedAt: TS,
  });
  return registry;
}

describe("verify_memories (Pro) — WOW loop", () => {
  it("returns the contradicted id after the anchored symbol is deleted", async () => {
    const registry = registryAt(repoDir);
    // Save an anchored memory through the real capture path (Task 14 wiring;
    // real git this time — no injected execGit).
    const saved = await handleSaveMemory(
      { registry, now: () => TS, newId: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      {
        projectId: PROJECT_ID,
        scope: "project",
        content: "verifyToken rejects empty tokens",
        type: "decision",
        relatedFiles: ["src/auth.ts"],
        relatedSymbols: ["verifyToken"],
      },
    );
    expect(registry.getMemoryEntry(saved.id as MemoryEntryId)?.anchor).toBeDefined();

    // Falsify: delete the symbol and commit.
    writeFileSync(join(repoDir, "src", "auth.ts"), AUTH_WITHOUT_SYMBOL);
    git(repoDir, "add", ".");
    git(repoDir, "commit", "-q", "-m", "refactor: drop verifyToken");

    const plan = await handleVerifyMemories(
      { registry, now: () => "2026-07-14T12:00:00.000Z", isPro: true },
      { projectId: PROJECT_ID },
    );
    if ("upsell" in plan) throw new Error("expected a VerifyPlan for pro tier");
    expect(plan.contradicted.map((c) => c.id)).toEqual([saved.id]);
    expect(registry.getMemoryEntry(saved.id as MemoryEntryId)?.stale).toBe(true);
  });

  it("free tier returns the upsell without running verification", async () => {
    const registry = registryAt(repoDir);
    const result = await handleVerifyMemories(
      { registry, now: () => TS, isPro: false },
      { projectId: PROJECT_ID },
    );
    expect(result).toEqual({ upsell: VERIFY_MEMORIES_UPSELL });
  });

  it("throws resource_not_found for an unknown project", async () => {
    const registry = createInMemoryCoreRegistry();
    await expect(
      handleVerifyMemories({ registry, now: () => TS, isPro: true }, { projectId: PROJECT_ID }),
    ).rejects.toMatchObject({ code: "resource_not_found" });
  });
});
```

- [ ] **Step 2: Run to verify FAIL.**
  `pnpm build && pnpm --filter @megasaver/mcp-bridge test`
  Expected failure: the new file fails to load with
  `Cannot find module '../../src/tools/verify-memories.js'`.

- [ ] **Step 3: Create the handler.** Create
  `packages/mcp-bridge/src/tools/verify-memories.ts` with exactly:

```ts
import { type CoreRegistry, type VerifyPlan, runVerify } from "@megasaver/core";
import type { ProjectId } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

export type VerifyMemoriesEnv = {
  registry: CoreRegistry;
  now: () => string;
  isPro: boolean;
  // Injectable git runner threaded into runVerify for hermetic tests.
  execGit?: (args: string[], cwd: string) => string;
};

// Exit-0 precedent (savings history): a locked feature is a normal state, not
// an error — free tier gets the upsell payload and NO Pro compute runs.
export const VERIFY_MEMORIES_UPSELL =
  "Agent-triggered memory verification is Mega Saver Pro — mega license activate <key>. Free tier: run `mega memory verify <projectId>` manually.";

const inputSchema = z.object({ projectId: z.string().min(1) }).strict();

export type VerifyMemoriesResult = VerifyPlan | { upsell: string };

// Thin alias over core's runVerify (i6 §8.6): same JSON shape as the CLI
// --json output. Deterministic from repo state — an agent cannot ask for a
// close, only trigger a look at reality.
export async function handleVerifyMemories(
  env: VerifyMemoriesEnv,
  rawArgs: unknown,
): Promise<VerifyMemoriesResult> {
  const parsed = inputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  if (!env.isPro) return { upsell: VERIFY_MEMORIES_UPSELL };
  const projectId = parsed.data.projectId as ProjectId;
  const project = env.registry.getProject(projectId);
  if (project === null) {
    throw new McpBridgeError("resource_not_found", `project not found: ${projectId}`);
  }
  return runVerify({
    registry: env.registry,
    projectId,
    rootPath: project.rootPath,
    now: env.now(),
    ...(env.execGit !== undefined ? { execGit: env.execGit } : {}),
  });
}
```

- [ ] **Step 4: Register the tool name.** In
  `packages/mcp-bridge/src/tool-name.ts`, inside the `mcpToolNameSchema`
  z.enum array, add after `"search_memory",` (alphabetical order —
  `verify_memories` sorts last):

```ts
  "verify_memories",
```

- [ ] **Step 5: Register in the server.** In
  `packages/mcp-bridge/src/server.ts`:

  5a. Add the import after
  `import { handleSweepMemory } from "./tools/sweep-memory.js";`:

```ts
import { handleVerifyMemories } from "./tools/verify-memories.js";
```

  5b. In `TOOL_DEFS`, add as the LAST entry before the closing `];`
  (after the `search_memory` entry):

```ts
  { id: "verify_memories", description: "Verify anchored memories against the current repo (Pro)." },
```

  5c. In the `dispatch` switch, add a case (after the
  `case "get_applicable_rules":` case, before the closing brace of the
  switch):

```ts
      case "verify_memories":
        return handleVerifyMemories(
          { registry: deps.registry, now, isPro: deps.isPro ?? false },
          args,
        );
```

- [ ] **Step 6: Bump the e2e tool count.** In
  `packages/mcp-bridge/test/server.e2e.test.ts` (locate with
  `grep -n "lists 34 tools" packages/mcp-bridge/test/server.e2e.test.ts`),
  replace:

```ts
  it("lists 34 tools", async () => {
    const { client, server } = await connectWithTools();
    const { tools } = (await client.listTools()) as { tools: { name: string }[] };
    expect(tools).toHaveLength(34);
```

  with:

```ts
  it("lists 35 tools", async () => {
    const { client, server } = await connectWithTools();
    const { tools } = (await client.listTools()) as { tools: { name: string }[] };
    expect(tools).toHaveLength(35);
    expect(tools.map((t) => t.name)).toContain("verify_memories");
```

- [ ] **Step 7: Run to verify PASS.**
  `pnpm build && pnpm --filter @megasaver/mcp-bridge test`
  Expected: green, including the three new tests and the updated e2e count.
  (The naming test files `tool-name-*.test.ts` / `tool-naming.test.ts` carry
  no count assertions — verified — but if one fails on the enum change,
  extend its expected name list with `verify_memories`; never remove names.)

- [ ] **Step 8: Gates + commit.**
  `pnpm lint:fix && pnpm typecheck` (both clean), then:

```bash
git add packages/mcp-bridge
git commit -m "feat(mcp): add verify_memories pro tool"
```

---

### Task 17: `stale-recall-avoided` ledger + savings line (PRO)

Mirror of the guard-ledger precedent, end-to-end: (a) new append-only jsonl
ledger `packages/stats/src/code-truth-event.ts` (exact structural copy of
`guard-event.ts`, path `<root>/stats/<projectId>/code-truth.events.jsonl`);
(b) each spot-check demotion appends one event with
`avoidedTokens = tokensFromBytes(byteLength(content))`; (c) the Pro savings
surfaces (`mega savings history` + `mega savings insights`) fold a
"Stale recall waste avoided" line exactly like the guard "Retry cost avoided"
line — plain-text render only, never JSON/CSV. The CLI reads the ledger
through `@megasaver/core` re-exports (the dep-graph test forbids a direct
CLI→stats dep); the bridge does the same (it has no stats dep either).

**Files:**

- Create: `packages/stats/src/code-truth-event.ts`
- Modify: `packages/stats/src/index.ts`
- Modify: `packages/core/src/context-gate.ts` (re-export block)
- Modify: `packages/mcp-bridge/src/tools/code-truth-check.ts`
- Modify: `packages/mcp-bridge/src/tools/get-relevant-memories.ts`
- Modify: `packages/mcp-bridge/src/tools/recall.ts`
- Modify: `apps/cli/src/commands/savings/shared.ts`
- Modify: `apps/cli/src/commands/savings/history.ts`
- Modify: `apps/cli/src/commands/savings/insights.ts`
- Modify: `apps/cli/src/commands/savings/index.ts`
- Create (test): `packages/stats/test/code-truth-event.test.ts`
- Modify (test): `packages/mcp-bridge/test/tools/code-truth-check.test.ts`
- Modify (test): `apps/cli/test/commands/savings.test.ts`

**Steps:**

- [ ] **Step 1: Write the failing ledger test.** Create
  `packages/stats/test/code-truth-event.test.ts` with exactly:

```ts
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendCodeTruthEvent,
  codeTruthEventSchema,
  readCodeTruthEvents,
} from "../src/code-truth-event.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-codetruth-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function demotion(over: Partial<Record<string, unknown>> = {}) {
  return codeTruthEventSchema.parse({
    type: "stale-recall-avoided",
    id: "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1",
    projectId: PROJECT_ID,
    sessionId: "s1",
    memoryId: "m1",
    avoidedTokens: 120,
    estimated: true,
    createdAt: "2026-07-14T10:00:00.000Z",
    ...over,
  });
}

describe("CodeTruthEvent", () => {
  it("append/read round-trips demotion rows", () => {
    appendCodeTruthEvent({ root }, demotion());
    appendCodeTruthEvent(
      { root },
      demotion({ id: "e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2", memoryId: "m2", avoidedTokens: 30 }),
    );
    const events = readCodeTruthEvents({ root }, PROJECT_ID);
    expect(events.map((e) => e.memoryId)).toEqual(["m1", "m2"]);
    expect(events.map((e) => e.avoidedTokens)).toEqual([120, 30]);
  });

  it("throws StatsError schema_invalid on a malformed event", () => {
    expect(() =>
      appendCodeTruthEvent({ root }, { type: "stale-recall-avoided", id: "x" } as never),
    ).toThrowError(expect.objectContaining({ code: "schema_invalid" }));
  });

  it("skips torn lines", () => {
    appendCodeTruthEvent({ root }, demotion());
    appendFileSync(join(root, "stats", PROJECT_ID, "code-truth.events.jsonl"), "{torn\n");
    appendCodeTruthEvent({ root }, demotion({ id: "e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3" }));
    expect(readCodeTruthEvents({ root }, PROJECT_ID)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run to verify FAIL.**
  `pnpm --filter @megasaver/stats test`
  Expected failure: `Cannot find module '../src/code-truth-event.js'`.

- [ ] **Step 3: Create the ledger.** Create
  `packages/stats/src/code-truth-event.ts` with exactly:

```ts
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ProjectId } from "@megasaver/shared";
import { projectIdSchema } from "@megasaver/shared";
import { z } from "zod";
import { StatsError } from "./errors.js";

// Code-Truth analytics ledger (i6 spec §10). Deliberately NOT a
// TokenSaverEvent: avoidedTokens is an ESTIMATE of the demoted memory's token
// size, never a measured byte-savings — mixing them would poison the honest
// savings pipeline. Append-only: one row per pre-recall spot-check demotion.
export const codeTruthEventSchema = z
  .object({
    type: z.literal("stale-recall-avoided"),
    id: z.string().uuid(),
    projectId: projectIdSchema,
    sessionId: z.string().min(1),
    memoryId: z.string().min(1),
    avoidedTokens: z.number().int().nonnegative(),
    estimated: z.literal(true),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type CodeTruthEvent = z.infer<typeof codeTruthEventSchema>;

type StoreRoot = { root: string };

function codeTruthEventsPath(store: StoreRoot, projectId: ProjectId): string {
  return join(store.root, "stats", projectId, "code-truth.events.jsonl");
}

export function appendCodeTruthEvent(store: StoreRoot, event: CodeTruthEvent): void {
  const parsed = codeTruthEventSchema.safeParse(event);
  if (!parsed.success) {
    throw new StatsError("schema_invalid");
  }
  const path = codeTruthEventsPath(store, parsed.data.projectId);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(parsed.data)}\n`);
}

export function readCodeTruthEvents(store: StoreRoot, projectId: ProjectId): CodeTruthEvent[] {
  const path = codeTruthEventsPath(store, projectId);
  if (!existsSync(path)) return [];
  const events: CodeTruthEvent[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    const parsed = codeTruthEventSchema.safeParse(raw);
    if (parsed.success) events.push(parsed.data);
  }
  return events;
}
```

- [ ] **Step 4: Export from stats + re-export from core.**

  4a. In `packages/stats/src/index.ts`, add directly after the guard-event
  export block (`} from "./guard-event.js";`):

```ts
export {
  appendCodeTruthEvent,
  codeTruthEventSchema,
  readCodeTruthEvents,
  type CodeTruthEvent,
} from "./code-truth-event.js";
```

  4b. In `packages/core/src/context-gate.ts`, replace the existing block
  (lines ~57-64):

```ts
export {
  appendGuardEvent,
  appendWarmStartEvent,
  readGuardEvents,
  readWarmStartEvents,
  type GuardEvent,
  type WarmStartEvent,
} from "@megasaver/stats";
```

  with:

```ts
export {
  appendCodeTruthEvent,
  appendGuardEvent,
  appendWarmStartEvent,
  readCodeTruthEvents,
  readGuardEvents,
  readWarmStartEvents,
  type CodeTruthEvent,
  type GuardEvent,
  type WarmStartEvent,
} from "@megasaver/stats";
```

- [ ] **Step 5: Verify ledger GREEN.**
  `pnpm build && pnpm --filter @megasaver/stats test`
  Expected: the three new ledger tests pass.

- [ ] **Step 6: Write the failing demotion-append test.** Append inside the
  `describe("code-truth on recall surfaces (i6 §8.4/§8.6)", ...)` block of
  `packages/mcp-bridge/test/tools/code-truth-check.test.ts`:

```ts
  it("a spot-check demotion appends one stale-recall-avoided ledger event", async () => {
    const registry = seeded();
    makeEntry(registry, STALE, { anchor: staleAnchor() });
    const store = mkdtempSync(join(tmpdir(), "code-truth-ledger-"));
    try {
      await handleGetRelevantMemories(
        { registry, storeRoot: store, isPro: true, now: () => NOW, execGit: fakeExecGit },
        { projectId: PROJECT_ID, task: "verifyToken" },
      );
      const events = readCodeTruthEvents({ root: store }, PROJECT_ID);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "stale-recall-avoided",
        projectId: PROJECT_ID,
        sessionId: "unattributed",
        memoryId: STALE,
        avoidedTokens: tokensFromBytes(
          Buffer.byteLength("verifyToken rejects empty tokens", "utf8"),
        ),
        estimated: true,
        createdAt: NOW,
      });
    } finally {
      rmSync(store, { recursive: true, force: true });
    }
  });
```

  And extend the test file's `@megasaver/core` import line to:

```ts
import {
  type CoreRegistry,
  type MemoryEntry,
  createInMemoryCoreRegistry,
  readCodeTruthEvents,
  tokensFromBytes,
} from "@megasaver/core";
```

- [ ] **Step 7: Run to verify FAIL.**
  `pnpm build && pnpm --filter @megasaver/mcp-bridge test`
  Expected failure: the new test's `readCodeTruthEvents` returns `[]`
  (`expected [] to have a length of 1`) — nothing appends yet.

- [ ] **Step 8: Wire the append into the spot-check.** Edit
  `packages/mcp-bridge/src/tools/code-truth-check.ts`:

  8a. Extend the imports — replace:

```ts
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { containsSentinel } from "@megasaver/connectors-shared";
import type { CoreRegistry, MemoryEntry } from "@megasaver/core";
```

  with:

```ts
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { containsSentinel } from "@megasaver/connectors-shared";
import {
  type CoreRegistry,
  type MemoryEntry,
  appendCodeTruthEvent,
  tokensFromBytes,
} from "@megasaver/core";
```

  8b. Extend `SpotCheckEnv` — add after the `execGit?` field:

```ts
  // Savings ledger (i6 §10): when present, each demotion appends one
  // stale-recall-avoided event. sessionId comes from the caller (mega_recall
  // has a session; get_relevant_memories does not — its demotions fall back
  // to the memory's own sessionId or "unattributed").
  ledger?: { storeRoot: string; sessionId?: string; newId?: () => string };
```

  8c. In the demotion branch, directly after the flip `try { ... } catch { ... }`
  block (still inside the `for (const hit of anchored)` loop), add:

```ts
    if (env.ledger !== undefined) {
      // Analytics only: the ledger append must never block or fail recall.
      try {
        appendCodeTruthEvent(
          { root: env.ledger.storeRoot },
          {
            type: "stale-recall-avoided",
            id: (env.ledger.newId ?? randomUUID)(),
            projectId: hit.projectId,
            sessionId: env.ledger.sessionId ?? hit.sessionId ?? "unattributed",
            memoryId: hit.id,
            avoidedTokens: tokensFromBytes(Buffer.byteLength(hit.content, "utf8")),
            estimated: true,
            createdAt: env.now(),
          },
        );
      } catch {
        // swallowed
      }
    }
```

  8d. In `packages/mcp-bridge/src/tools/get-relevant-memories.ts`, inside the
  `spotCheckHits(...)` env object (after the `execGit` conditional spread),
  add:

```ts
              ...(env.storeRoot !== undefined ? { ledger: { storeRoot: env.storeRoot } } : {}),
```

  8e. In `packages/mcp-bridge/src/tools/recall.ts`, inside the
  `spotCheckHits(...)` env object (after the `execGit` conditional spread),
  add:

```ts
                ...(env.storeRoot !== undefined
                  ? { ledger: { storeRoot: env.storeRoot, sessionId: session.id } }
                  : {}),
```

  (`storeRoot` is required in `RecallToolEnv`, but the conditional spread
  keeps the shape uniform and satisfies `exactOptionalPropertyTypes` without
  a cast.)

- [ ] **Step 9: Run to verify PASS.**
  `pnpm build && pnpm --filter @megasaver/mcp-bridge test`
  Expected: green including the new ledger-append test (and the Task 15
  tests still green — they pass no `storeRoot`, so no ledger writes happen
  there except the recall test, which asserts memory/disclosure shape only).

- [ ] **Step 10: Write the failing savings-line tests.** Append at the end of
  `apps/cli/test/commands/savings.test.ts`:

```ts
describe("savings — stale-recall-avoided line (estimated, i6 §10)", () => {
  beforeEach(() => activatePro());

  it("history appends the stale-recall line when demotions exist", async () => {
    const code = await runSavingsHistory({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: stubReader(),
      readCodeTruthTotals: () => ({ demotions: 2, avoidedTokens: 300 }),
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("Stale recall waste avoided (estimated): ~300 tokens");
    expect(out.join("\n")).toContain("across 2 demotions");
  });

  it("history omits the line when there are zero demotions", async () => {
    const code = await runSavingsHistory({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: stubReader(),
      readCodeTruthTotals: () => ({ demotions: 0, avoidedTokens: 0 }),
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(out.join("\n")).not.toContain("Stale recall waste avoided");
  });

  it("insights mirrors the line", async () => {
    const code = await runSavingsInsights({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: insightsReader(),
      readCodeTruthTotals: () => ({ demotions: 1, avoidedTokens: 120 }),
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("Stale recall waste avoided (estimated): ~120 tokens");
  });

  it("never adds the line to --json output", async () => {
    const code = await runSavingsHistory({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: stubReader(),
      readCodeTruthTotals: () => ({ demotions: 2, avoidedTokens: 300 }),
      json: true,
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(out.join("\n")).not.toContain("Stale recall waste avoided");
  });

  it("defaultCodeTruthTotalsReader sums real ledger events", async () => {
    const projectId = projectIdSchema.parse("22222222-2222-4222-8222-222222222222");
    await initStore(root);
    createJsonDirectoryCoreRegistry({ rootDir: root }).createProject({
      id: projectId,
      name: "demo",
      rootPath: "/tmp/demo",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    appendCodeTruthEvent(
      { root },
      {
        type: "stale-recall-avoided",
        id: randomUUID(),
        projectId,
        sessionId: "sess-1",
        memoryId: "m1",
        avoidedTokens: 120,
        estimated: true,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    );
    appendCodeTruthEvent(
      { root },
      {
        type: "stale-recall-avoided",
        id: randomUUID(),
        projectId,
        sessionId: "sess-1",
        memoryId: "m2",
        avoidedTokens: 30,
        estimated: true,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    );
    const totals = await defaultCodeTruthTotalsReader(readStoreEnv(root))();
    expect(totals).toEqual({ demotions: 2, avoidedTokens: 150 });
  });
});
```

  And extend the file's imports: add `appendCodeTruthEvent` to the existing
  `@megasaver/core` import list (alphabetical, before `appendGuardEvent`),
  and add `defaultCodeTruthTotalsReader` to the existing
  `../../src/commands/savings/index.js` import list (before
  `defaultGuardTotalsReader`).

- [ ] **Step 11: Run to verify FAIL.**
  `pnpm build && pnpm --filter @megasaver/cli test`
  Expected failure: `defaultCodeTruthTotalsReader` has no export (module
  resolution error on the savings index import), and/or TS unknown-property
  `readCodeTruthTotals` — the five new tests fail.

- [ ] **Step 12: Implement the CLI fold (guard precedent, exactly).**

  12a. In `apps/cli/src/commands/savings/shared.ts`: add
  `readCodeTruthEvents` to the existing `@megasaver/core` import list
  (alphabetical — after `readEvents`, before `readGuardEvents` keeps Biome
  happy; run `pnpm lint:fix` after). Then add after `formatGuardLine`:

```ts
export type CodeTruthTotals = { demotions: number; avoidedTokens: number };
export type CodeTruthTotalsReader = () => CodeTruthTotals | Promise<CodeTruthTotals>;

// One row per pre-recall spot-check demotion (i6 spec §10). Estimated by
// contract — never mixed into TokenSaverEvent totals.
export function defaultCodeTruthTotalsReader(
  storeInput: ResolveStorePathInput,
): CodeTruthTotalsReader {
  return async () => {
    const rootDir = resolveStorePath(storeInput);
    const { registry } = await ensureStoreReady(rootDir);
    let demotions = 0;
    let avoidedTokens = 0;
    for (const project of registry.listProjects()) {
      for (const e of readCodeTruthEvents({ root: rootDir }, project.id)) {
        demotions += 1;
        avoidedTokens += e.avoidedTokens;
      }
    }
    return { demotions, avoidedTokens };
  };
}

export function formatCodeTruthLine(totals: CodeTruthTotals): string | null {
  if (totals.demotions === 0) return null;
  const dollars = (totals.avoidedTokens / 1_000_000) * INPUT_PRICE_PER_MTOK_USD;
  return `Stale recall waste avoided (estimated): ~${totals.avoidedTokens} tokens (~${formatDollarsSaved(dollars)}) across ${totals.demotions} demotions`;
}
```

  12b. In `apps/cli/src/commands/savings/history.ts`:
  - Extend the `./shared.js` import list with `type CodeTruthTotalsReader`,
    `defaultCodeTruthTotalsReader`, `formatCodeTruthLine`.
  - Add to `RunSavingsHistoryInput` after `readGuardTotals?`:

```ts
  readCodeTruthTotals?: CodeTruthTotalsReader;
```

  - In the plain-text render branch, directly after the guard-line block
    (`if (input.readGuardTotals !== undefined) { ... }`), add:

```ts
    if (input.readCodeTruthTotals !== undefined) {
      const codeTruthLine = formatCodeTruthLine(await input.readCodeTruthTotals());
      if (codeTruthLine !== null) rendered = `${rendered}\n\n${codeTruthLine}`;
    }
```

  - In the citty `run({ args })` production wiring, after the
    `readGuardTotals: defaultGuardTotalsReader(...)` entry, add:

```ts
      readCodeTruthTotals: defaultCodeTruthTotalsReader(
        readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      ),
```

  12c. In `apps/cli/src/commands/savings/insights.ts`: the identical mirror —
  same three edits (import additions, `readCodeTruthTotals?: CodeTruthTotalsReader;`
  on `RunSavingsInsightsInput` after `readGuardTotals?`, the same render
  block after the guard block in the plain-text branch, and the same
  production-wiring entry after `readGuardTotals: defaultGuardTotalsReader(...)`).

  12d. In `apps/cli/src/commands/savings/index.ts`, extend the `./shared.js`
  re-export block with (alphabetical among the existing names):

```ts
  type CodeTruthTotals,
  type CodeTruthTotalsReader,
  defaultCodeTruthTotalsReader,
  formatCodeTruthLine,
```

- [ ] **Step 13: Run to verify PASS.**
  `pnpm build && pnpm --filter @megasaver/cli test`
  Expected: all five new savings tests green; existing savings tests green
  (the new input field is optional — omitted readers render nothing).

- [ ] **Step 14: Full gates + commit.**
  `pnpm lint:fix && pnpm typecheck && pnpm test` (all clean/green), then:

```bash
git add packages/stats packages/core packages/mcp-bridge apps/cli
git commit -m "feat(stats): stale-recall ledger + savings line"
```

---

**Section D closing note:** changesets for the public-API changes in
`@megasaver/entitlement`, `@megasaver/stats`, `@megasaver/core`, and
`@megasaver/mcp-bridge` are owned by the plan's final verification/DoD task
(one changeset covering the whole i6 branch), not by the per-section tasks.

---

### Task 18: Changeset, spec deviation note, wiki, verify + E2E smoke, gauntlet

**Files:**
- Create: `.changeset/code-truth-verify.md`
- Modify: `docs/superpowers/specs/2026-07-13-code-truth-verify-design.md` (deviation note if any accumulated)
- Modify: `wiki/syntheses/memory-moat-portfolio.md`, `wiki/log.md`

- [ ] **Step 1: Write the changeset**

First confirm exact package names: `grep '"name"' packages/core/package.json packages/output-filter/package.json packages/stats/package.json packages/entitlement/package.json packages/mcp-bridge/package.json apps/cli/package.json`

```markdown
---
"@megasaver/core": minor
"@megasaver/output-filter": minor
"@megasaver/stats": minor
"@megasaver/entitlement": minor
"@megasaver/mcp-bridge": minor
"@megasaver/cli": minor
---

Code-Truth Verify (i6): git-anchored memories that stale and heal.

- core: `memory-anchor` module (codeAnchor/lastVerified schemas, best-effort
  `captureCodeAnchor`), `code-truth` module (pure `verifyAnchors` planner +
  `runVerify` git runner), whole-batch `applyMemoryEntryPatches`, and
  `STALE_WEIGHT` down-ranking for stale rows on includeStale surfaces.
  Contradiction closes `validTo` with ownership tracking; heal reopens only
  code-truth-owned closes.
- output-filter: public `extractBlocksForFile` polyglot per-file extraction.
- cli: `mega memory verify` (one-shot free; `--install-hook`/`--uninstall-hook`
  Pro post-commit automation), `--symbol` inputs, `--no-anchor` opt-out,
  sweep verify pre-pass (Pro), show/explain anchor + badge.
- mcp-bridge: `save_memory` symbol anchors, `get_relevant_memories`
  verification badges + Pro pre-recall spot-check with disclosure, new
  `verify_memories` tool (Pro).
- stats/entitlement: `code-truth` ProFeature key, stale-recall-avoided ledger
  + savings line.
```

- [ ] **Step 2: Spec deviation note**

Append to the spec any deviations that accumulated during Tasks 1-17 (collect
from task-commit messages / reviewer notes). Known-at-planning deviations to
record verbatim:

```markdown
> Implementation deviations (plan phase, 2026-07-14):
> - Registry interface is `CoreRegistry` (spec's "MemoryRegistry" name kept
>   only as a Pick-alias in code-truth.ts).
> - `captureCodeAnchor`/`extractBlocksForFile` are async (indexer extractor
>   loading is a memoized dynamic import).
> - `verify_memories` requires `projectId` (no default in a stateless call);
>   free tier returns an upsell payload, not an error.
> - Badge for anchored-but-never-verified rows is "verified" (= no known
>   contradiction).
> - Spot-check evidence line says "contradicted at <sha7>" (current HEAD) —
>   commit attribution runs only in the full verify pass, not in the 50ms
>   budget.
> - mcp-bridge gains a `@megasaver/connectors-shared` dependency for
>   `containsSentinel` (bridge had no sentinel guard; core re-export would
>   invert the dependency direction).
```

- [ ] **Step 3: Full verify**

Run from the worktree root: `pnpm verify`
Expected: lint + typecheck + all test projects + conventions:check green.

- [ ] **Step 4: E2E smoke — the WOW loop (DoD evidence, capture the terminal session)**

```bash
pnpm build
STORE=$(mktemp -d)
REPO=$(mktemp -d)
CLI="node apps/cli/dist/cli.js"
cd "$REPO" && git init -q && git config user.email t@t && git config user.name t
cat > auth.ts <<'EOF'
export function verifyToken(token: string): boolean {
  return token.length > 0;
}
EOF
git add auth.ts && git commit -qm "add verifyToken"
cd -
# seed project with rootPath=$REPO + session per the CLI test-store bootstrap,
# then:
$CLI memory create <project> --scope project --type project_rule \
  --content "verifyToken must reject empty tokens" \
  --file auth.ts --symbol "auth.ts#verifyToken" --store "$STORE"
$CLI memory verify <project> --store "$STORE"           # expect: 0 contradicted, 1 verified
cd "$REPO" && sed -i '' 's/verifyToken/checkToken/' auth.ts && git commit -qam "rename"
cd -
$CLI memory verify <project> --store "$STORE"           # expect: 1 contradicted, reason names commit
$CLI memory show <id> --store "$STORE"                  # badge: contradicted, evidence trail
cd "$REPO" && git revert -n HEAD && git commit -qm "revert" && cd -
$CLI memory verify <project> --store "$STORE"           # expect: 1 healed
$CLI memory verify <project> --install-hook --store "$STORE"  # free tier => upsell, no file written
```

Adjust seeding to the real harness (tests write `projects.json`/JSONL
directly — copy that bootstrap). Every claim in the PR description must trace
to a line in this capture.

- [ ] **Step 5: Wiki update**

- `wiki/syntheses/memory-moat-portfolio.md`: mark i6 SHIPPED (branch, PR, date).
- `wiki/log.md`: timestamped entry — what shipped, gauntlet verdicts, deviations.

- [ ] **Step 6: Commit**

```bash
git add .changeset/code-truth-verify.md docs/superpowers/specs/2026-07-13-code-truth-verify-design.md wiki/
git commit -m "chore(release): code-truth verify changeset + wiki"
```

- [ ] **Step 7: Gauntlet (HIGH risk — do not skip)**

Dispatch fresh-context `code-reviewer` AND adversarial `critic` (both opus,
full branch diff `git diff feat/living-brain...feat/code-truth`); verifier
re-pass on any fixes. Author and reviewer never the same context. Attack
surface to name explicitly for the critic:

- B1 regression: heal reopening a supersession-owned close (ownership flag
  forgery via crafted patch? via save_memory lastVerified injection? — the
  input schema must NOT accept `lastVerified`/`anchor` from agents; verify).
- False-stale ladder: blob-only change, rename repoint, name collision.
- Hook confinement: foreign hook preservation, free-tier no-write, marker
  spoofing.
- Spot-check: budget exhaustion, inline-flip write-error swallowing, sentinel
  injection through disclosure titles, ledger double-count.
- Batch apply atomicity + lock contention with concurrent CLI writes.
- `--changed` scoping misses (multi-commit push, merge commits).
