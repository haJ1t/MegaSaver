# Outline-First Read Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in `outline: true` flag to `mega_read_file` that returns a source file's skeleton (imports + top-level signatures + line ranges + chunk ids) instead of bodies, persisting every body as a fetchable chunk so the agent expands only what it needs.

**Architecture:** A new `outlineFile()` in `@megasaver/output-filter` reuses the PR #182 AST extractors (lazy-loaded) to build `{ skeleton, chunks }`. `filterOutput` short-circuits into an outline branch when the flag is set on a file source; the skeleton is returned as the excerpt while the bodies ride along in a new `result.chunks` field that `persistChunkSet` stores. The `outline` flag threads through the registry read path (`mega_read_file` → daemon `readRegistryHandler` → `runOutputPipeline` → `filterRaw` → `filterOutput`). Non-source / unsupported / parse-fail falls back to today's read unchanged.

**Tech Stack:** TypeScript (strict, ESM), Vitest, Zod, pnpm workspaces. Reuses `@megasaver/indexer` extractors and existing `partitionFile` / `scoreChunk` / `excerptOf` helpers.

---

## File Structure

**Create:**
- `packages/output-filter/src/parsers/outline.ts` — `outlineFile()` + `renderSignature()`; the only new logic.
- `packages/output-filter/test/outline.test.ts` — unit tests for `outlineFile` / `renderSignature`.

**Modify:**
- `packages/output-filter/src/parsers/semantic.ts` — export `loadExtractors` for reuse.
- `packages/output-filter/src/tokens.ts` — add `"outline"` to `FilterDecision`.
- `packages/output-filter/src/types.ts` — `outline?` input field; `OutlineBody` type; `chunks?` result field; outline branch in `filterOutput`.
- `packages/context-gate/src/read.ts` — thread `outline` through `filterRaw` / `readAndFilter`; `persistChunkSet` persists `chunks ?? excerpts`.
- `packages/context-gate/src/run.ts` — thread `outline` into `RunOutputInput`, pass to `filterRaw`, add `#outline` suffix to the read-index key.
- `packages/daemon/src/handlers-registry.ts` — accept `outline` in `readRegistryRequestSchema`, pass to `runOutputPipeline`.
- `packages/mcp-bridge/src/tools/read-file.ts` — accept `outline`, forward in daemon body + local pipeline call.

**Out of scope (v1):** the overlay pipeline (`runOverlayOutputPipeline`) — `mega_read_file` uses the registry path; overlay reads never set `outline` and behave as today.

---

## Task 1: Types — `FilterDecision`, `OutlineBody`, `chunks` result field, `outline` input field

**Files:**
- Modify: `packages/output-filter/src/tokens.ts:8`
- Modify: `packages/output-filter/src/types.ts:30-92` (input schema + result type)
- Test: `packages/output-filter/test/outline.test.ts` (new — type-level + later runtime)

- [ ] **Step 1: Add `"outline"` to the decision union**

In `packages/output-filter/src/tokens.ts`, line 8:

```ts
export type FilterDecision = "passthrough" | "light" | "compressed" | "unchanged-marker" | "outline";
```

- [ ] **Step 2: Add the `outline` input field**

In `packages/output-filter/src/types.ts`, inside `filterOutputInputSchema` (the `.object({...})` ending at line 61, before `.strict()`), add after the `recordTrace` field (line 48):

```ts
    outline: z.boolean().optional(),
```

- [ ] **Step 3: Add `OutlineBody` + `chunks` to the result type**

In `packages/output-filter/src/types.ts`, after the `OutputExcerpt` type (line 73) add:

```ts
export type OutlineBody = {
  startLine: number;
  endLine: number;
  text: string;
};
```

Then inside `FilterOutputResult` (lines 75-92), add after `chunkSetId?` (line 88):

```ts
  chunks?: readonly OutlineBody[];
```

- [ ] **Step 4: Verify it compiles**

Run: `pnpm --filter @megasaver/output-filter typecheck`
Expected: PASS (no usages yet; pure additive types).

- [ ] **Step 5: Commit**

```bash
git add packages/output-filter/src/tokens.ts packages/output-filter/src/types.ts
git commit -m "feat(output-filter): outline decision + chunks result field"
```

---

## Task 2: `outlineFile()` — the skeleton builder

**Files:**
- Modify: `packages/output-filter/src/parsers/semantic.ts:18` (export `loadExtractors`)
- Create: `packages/output-filter/src/parsers/outline.ts`
- Test: `packages/output-filter/test/outline.test.ts`

- [ ] **Step 1: Export `loadExtractors` from semantic.ts**

In `packages/output-filter/src/parsers/semantic.ts`, line 18, add the `export` keyword:

```ts
export async function loadExtractors(): Promise<typeof import("@megasaver/indexer")> {
  if (indexerMod === undefined) indexerMod = await import("@megasaver/indexer");
  return indexerMod;
}
```

- [ ] **Step 2: Write the failing tests**

Create `packages/output-filter/test/outline.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { outlineFile, renderSignature } from "../src/parsers/outline.js";

const TS = `import { z } from "zod";
import { join } from "node:path";

export function alpha(a: number): number {
  return a + 1;
}

export class Beta {
  run(): void {}
}

const gamma = (
  x: string,
  y: string,
) => x + y;
`;

describe("renderSignature", () => {
  it("returns a single-line signature without the body brace", () => {
    const lines = TS.split("\n");
    // alpha starts at line 4 (1-indexed), body opens same line.
    expect(renderSignature(lines, 4, 6, "a.ts")).toBe("export function alpha(a: number): number");
  });

  it("keeps multi-line wrapped params up to the opener", () => {
    const lines = TS.split("\n");
    // gamma spans lines 12-15, opener `=> x + y` has no `{`; cap returns the
    // declaration lines verbatim.
    const sig = renderSignature(lines, 12, 15, "a.ts");
    expect(sig).toContain("const gamma = (");
    expect(sig).toContain("y: string,");
  });

  it("uses only the first line for markdown headings", () => {
    expect(renderSignature(["## Title", "body"], 1, 2, "a.md")).toBe("## Title");
  });
});

describe("outlineFile", () => {
  it("returns null for unsupported extensions", async () => {
    expect(await outlineFile("whatever", "a.bin")).toBeNull();
  });

  it("returns null when nothing extracts", async () => {
    expect(await outlineFile("", "a.ts")).toBeNull();
  });

  it("builds a skeleton with one chunk per declaration and matching ids", async () => {
    const result = await outlineFile(TS, "a.ts");
    expect(result).not.toBeNull();
    if (result === null) return;
    const { skeleton, chunks } = result;

    // Imports header lists the file imports.
    expect(skeleton).toContain("zod");
    expect(skeleton).toContain("node:path");

    // Every declaration line carries a `#<id>  L<start>-<end>  <signature>`.
    expect(skeleton).toMatch(/#\d+ {2}L\d+-\d+ {2}export function alpha/);

    // Each `#id` in the skeleton resolves to a chunk whose body is the full
    // declaration (not just the signature).
    const ids = [...skeleton.matchAll(/#(\d+) {2}L/g)].map((m) => Number(m[1]));
    expect(ids.length).toBeGreaterThanOrEqual(3);
    for (const id of ids) {
      expect(chunks[id]).toBeDefined();
    }
    const alphaId = ids.find((id) => chunks[id]?.text.includes("return a + 1;"));
    expect(alphaId).toBeDefined();
  });

  it("covers every source line across the chunk set (lossless)", async () => {
    const result = await outlineFile(TS, "a.ts");
    if (result === null) throw new Error("expected outline");
    const covered = new Set<number>();
    for (const c of result.chunks) {
      for (let ln = c.startLine; ln <= c.endLine; ln++) covered.add(ln);
    }
    // Non-blank lines must all be reachable via some chunk.
    const lines = TS.split("\n");
    for (let ln = 1; ln <= lines.length; ln++) {
      if (lines[ln - 1]?.trim() !== "") expect(covered.has(ln)).toBe(true);
    }
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @megasaver/output-filter test outline`
Expected: FAIL — `Cannot find module '../src/parsers/outline.js'`.

- [ ] **Step 4: Implement `outline.ts`**

Create `packages/output-filter/src/parsers/outline.ts`:

```ts
import type { ExtractedBlock } from "@megasaver/indexer";
import type { Chunk } from "../rank.js";
import { loadExtractors, partitionFile } from "./semantic.js";

// Skeleton signature is verbatim source truncated at the body opener. A longer
// signature is shown clipped; the full body is one mega_fetch_chunk away, so the
// file-level read stays lossless.
// ponytail: 6-line cap + naive opener scan. Upgrade to the real body-opener
// (balanced brackets) only if wrapped signatures prove unreadable.
const SIGNATURE_MAX_LINES = 6;

type MetaExtractor = (filePath: string, source: string) => ExtractedBlock[];

function extractorFor(
  path: string,
  mod: typeof import("@megasaver/indexer"),
): MetaExtractor | undefined {
  if (/\.(mts|cts|tsx|jsx|ts|js|mjs|cjs)$/.test(path)) return mod.extractTs;
  if (path.endsWith(".py")) return mod.extractPy;
  if (path.endsWith(".go")) return mod.extractGo;
  if (path.endsWith(".rs")) return mod.extractRs;
  if (path.endsWith(".md")) return mod.extractMd;
  if (path.endsWith(".json")) return mod.extractJson;
  return undefined;
}

export function renderSignature(
  lines: readonly string[],
  start: number,
  end: number,
  path: string,
): string {
  const first = (lines[start - 1] ?? "").trim();
  // Heading/key formats have no brace/colon body opener — one line is the whole
  // signature.
  if (path.endsWith(".md") || path.endsWith(".json")) return first;

  const opener = path.endsWith(".py") ? ":" : "{";
  const max = Math.min(end, start + SIGNATURE_MAX_LINES - 1);
  const out: string[] = [];
  for (let ln = start; ln <= max; ln++) {
    const line = lines[ln - 1] ?? "";
    out.push(line);
    if (line.includes(opener)) break;
  }
  let sig = out.join("\n").trimEnd();
  // Drop a trailing lone body brace so `function f() {` reads as `function f()`.
  if (sig.endsWith("{")) sig = sig.slice(0, -1).trimEnd();
  return sig;
}

function uniqueImports(blocks: readonly ExtractedBlock[]): string[] {
  const seen = new Set<string>();
  for (const b of blocks) for (const imp of b.imports) seen.add(imp);
  return [...seen];
}

// Returns null (never throws) to signal "fall back to a normal read":
// unsupported extension, parse failure, or zero extracted blocks — identical
// fallback contract to chunkBySemantic. Async only because the indexer (and its
// typescript dep) loads lazily.
export async function outlineFile(
  text: string,
  path: string,
): Promise<{ skeleton: string; chunks: Chunk[] } | null> {
  if (text === "") return null;
  const extractor = extractorFor(path, await loadExtractors());
  if (extractor === undefined) return null;

  let blocks: ExtractedBlock[];
  try {
    blocks = extractor(path, text);
  } catch {
    return null;
  }
  if (blocks.length === 0) return null;

  // Whole-file partition with oversize sub-splitting disabled, so each top-level
  // declaration is exactly one chunk and gaps stay reachable (lossless).
  const chunks = partitionFile(text, blocks, Number.POSITIVE_INFINITY);
  const idBySpan = new Map<string, number>();
  chunks.forEach((c, i) => idBySpan.set(`${c.startLine}:${c.endLine}`, i));

  const lines = text.split("\n");
  const lastLine = lines.length;
  const sorted = [...blocks]
    .map((b) => ({
      ...b,
      startLine: Math.max(1, b.startLine),
      endLine: Math.min(lastLine, b.endLine),
    }))
    .filter((b) => b.endLine >= b.startLine)
    .sort((a, b) => a.startLine - b.startLine);

  const declLines: string[] = [];
  for (const b of sorted) {
    const id = idBySpan.get(`${b.startLine}:${b.endLine}`);
    // A block with no own chunk was folded by partitionFile's overlap guard;
    // its lines are still in a covering chunk (lossless), just not listed.
    if (id === undefined) continue;
    const sig = renderSignature(lines, b.startLine, b.endLine, path);
    declLines.push(`#${id}  L${b.startLine}-${b.endLine}  ${sig}`);
  }

  const imports = uniqueImports(blocks);
  const header =
    `outline: ${declLines.length} declaration(s), ${lastLine} line(s). ` +
    `Expand a body: mega_fetch_chunk(chunkSetId, <id>).`;
  const importLine = imports.length > 0 ? `imports: ${imports.join(", ")}` : "imports: (none)";
  const skeleton = [header, importLine, "", ...declLines].join("\n");

  return { skeleton, chunks };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @megasaver/output-filter test outline`
Expected: PASS (all cases in `outline.test.ts`).

- [ ] **Step 6: Commit**

```bash
git add packages/output-filter/src/parsers/semantic.ts packages/output-filter/src/parsers/outline.ts packages/output-filter/test/outline.test.ts
git commit -m "feat(output-filter): outlineFile skeleton builder"
```

---

## Task 3: `filterOutput` outline branch

**Files:**
- Modify: `packages/output-filter/src/types.ts:131-143` (insert branch after `normalized`)
- Test: `packages/output-filter/test/filter-output.test.ts` (add cases)

- [ ] **Step 1: Write the failing tests**

Append to `packages/output-filter/test/filter-output.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { filterOutput } from "../src/types.js";

const TS_SRC = `import { z } from "zod";

export function alpha(a: number): number {
  return a + 1;
}

export function beta(b: number): number {
  return b * 2;
}
`;

describe("filterOutput outline branch", () => {
  it("returns a skeleton excerpt plus body chunks when outline is set", async () => {
    const result = await filterOutput({
      raw: TS_SRC,
      mode: "safe",
      outline: true,
      source: { kind: "file", path: "a.ts" },
    });
    expect(result.decision).toBe("outline");
    expect(result.excerpts).toHaveLength(1);
    expect(result.excerpts[0]?.text).toContain("export function alpha");
    expect(result.chunks).toBeDefined();
    // A body chunk holds the actual implementation, not just the signature.
    expect(result.chunks?.some((c) => c.text.includes("return a + 1;"))).toBe(true);
  });

  it("ignores outline for a non-file source (falls back to normal filtering)", async () => {
    const result = await filterOutput({
      raw: TS_SRC,
      mode: "safe",
      outline: true,
    });
    expect(result.decision).not.toBe("outline");
    expect(result.chunks).toBeUndefined();
  });

  it("behaves exactly as today when outline is absent", async () => {
    const result = await filterOutput({
      raw: TS_SRC,
      mode: "safe",
      source: { kind: "file", path: "a.ts" },
    });
    expect(result.decision).not.toBe("outline");
    expect(result.chunks).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @megasaver/output-filter test filter-output`
Expected: FAIL — `decision` is `"passthrough"`/`"light"`, not `"outline"`; `chunks` undefined.

- [ ] **Step 3: Implement the branch**

In `packages/output-filter/src/types.ts`:

(a) Add the import near the other parser imports (after line 12 `import { chunkByFormatWithMeta } from "./parsers/index.js";`):

```ts
import { outlineFile } from "./parsers/outline.js";
```

(b) Insert the outline branch in `filterOutput`, immediately after the `classification` line (after line 147) and before `const rawBytes = ...`:

```ts
  // Narrow `source` to the file variant directly so `source.path` is typed.
  if (input.outline === true && source?.kind === "file") {
    const outline = await outlineFile(normalized, source.path);
    if (outline !== null) {
      const skeletonChunk = {
        text: outline.skeleton,
        startLine: 1,
        endLine: normalized.split("\n").length,
      };
      const excerpt = excerptOf(scoreChunk(intent, skeletonChunk, sessionHints));
      const rawBytes = Buffer.byteLength(raw, "utf8");
      const rawTokens = estimateTokens(raw);
      const returnedBytes = Buffer.byteLength(outline.skeleton, "utf8");
      const returnedTokens = estimateTokens(outline.skeleton);
      const bytesSaved = Math.max(0, rawBytes - returnedBytes);
      const base: FilterOutputResult = {
        summary: `outline mode: expand bodies via mega_fetch_chunk`,
        excerpts: [excerpt],
        chunks: outline.chunks.map((c) => ({
          startLine: c.startLine,
          endLine: c.endLine,
          text: c.text,
        })),
        classification,
        decision: "outline",
        compressor: "generic",
        rawBytes,
        returnedBytes,
        rawTokens,
        returnedTokens,
        bytesSaved,
        savingRatio: rawBytes === 0 ? 0 : bytesSaved / rawBytes,
      };
      return warnings.length > 0 ? { ...base, warnings } : base;
    }
  }
```

Note: `scoreChunk`, `excerptOf`, `estimateTokens` are already imported/defined in this file; the branch runs after `redact` so the persisted bodies are redacted.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @megasaver/output-filter test filter-output`
Expected: PASS.

- [ ] **Step 5: Run the full output-filter suite (no regressions)**

Run: `pnpm --filter @megasaver/output-filter test`
Expected: PASS (including the existing `no-eager-typescript` guard — the outline branch only loads the indexer when `outline === true` on a file).

- [ ] **Step 6: Commit**

```bash
git add packages/output-filter/src/types.ts packages/output-filter/test/filter-output.test.ts
git commit -m "feat(output-filter): filterOutput outline branch"
```

---

## Task 4: `persistChunkSet` stores bodies in outline mode

**Files:**
- Modify: `packages/context-gate/src/read.ts:215`
- Test: `packages/context-gate/test/persist-outline.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/context-gate/test/persist-outline.test.ts`:

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadChunkSet } from "@megasaver/content-store";
import type { FilterOutputResult } from "@megasaver/output-filter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { persistChunkSet } from "../src/read.js";

let storeRoot: string;
beforeEach(async () => {
  storeRoot = await mkdtemp(join(tmpdir(), "ms-outline-"));
});
afterEach(async () => {
  await rm(storeRoot, { recursive: true, force: true });
});

function outlineResult(): FilterOutputResult {
  return {
    summary: "outline mode",
    excerpts: [{ text: "skeleton text", startLine: 1, endLine: 9, score: 0, features: {} as never }],
    chunks: [
      { startLine: 3, endLine: 5, text: "export function alpha() { return 1; }" },
      { startLine: 7, endLine: 9, text: "export function beta() { return 2; }" },
    ],
    classification: { category: "unknown", confidence: 1 },
    decision: "outline",
    compressor: "generic",
    rawBytes: 100,
    returnedBytes: 13,
    rawTokens: 25,
    returnedTokens: 4,
    bytesSaved: 87,
    savingRatio: 0.87,
  };
}

describe("persistChunkSet in outline mode", () => {
  it("persists the bodies (result.chunks), not the skeleton excerpt", async () => {
    await persistChunkSet({
      storeRoot,
      chunkSetId: "cs-1",
      sessionId: "s-1" as never,
      projectId: "p-1" as never,
      createdAt: "2026-06-29T00:00:00.000Z",
      path: "a.ts",
      result: outlineResult(),
    });
    const set = await loadChunkSet({ storeRoot, chunkSetId: "cs-1" });
    expect(set?.chunks).toHaveLength(2);
    expect(set?.chunks[0]?.text).toContain("return 1;");
    expect(set?.chunks[1]?.id).toBe("1");
  });
});
```

(If `loadChunkSet`'s exact name/signature differs, use the content-store reader already used by `packages/context-gate/test/fetch-chunk.test.ts` — match that import.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @megasaver/context-gate test persist-outline`
Expected: FAIL — persisted chunks come from `excerpts` (1 skeleton chunk), not the 2 bodies.

- [ ] **Step 3: Implement the one-line change**

In `packages/context-gate/src/read.ts`, replace the `chunks:` mapping in `persistChunkSet` (line 215):

```ts
    chunks: (input.result.chunks ?? input.result.excerpts).map((e, i) => ({
      id: String(i),
      startLine: e.startLine,
      endLine: e.endLine,
      bytes: Buffer.byteLength(e.text, "utf8"),
      text: e.text,
    })),
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @megasaver/context-gate test persist-outline`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/context-gate/src/read.ts packages/context-gate/test/persist-outline.test.ts
git commit -m "feat(context-gate): persist outline bodies over skeleton excerpt"
```

---

## Task 5: Thread `outline` through the context-gate read path + read-index key

**Files:**
- Modify: `packages/context-gate/src/read.ts:156-194` (`filterRaw`, `readAndFilter`)
- Modify: `packages/context-gate/src/run.ts:50-114` (`RunOutputInput`, pathHash, `filterRaw` call)
- Test: `packages/context-gate/test/run-outline.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/context-gate/test/run-outline.test.ts`. Mirror the harness in `packages/context-gate/test/run.test.ts` (same registry/store fixtures); assert two behaviors:

```ts
// (Reuse the existing run.test.ts setup helpers: a temp storeRoot, a registry
// with one project + session, and a source file on disk.)

it("returns an outline decision when outline:true is passed", async () => {
  const out = await runOutputPipeline({
    registry, storeRoot, sessionId, path: "src/big.ts", intent: "map the file",
    outline: true, now, newId,
  });
  expect(out.ok).toBe(true);
  if (!out.ok) return;
  expect(out.result.decision).toBe("outline");
  expect(out.result.chunkSetId).toBeDefined();
});

it("does not cross-suppress a full read and an outline read of the same file", async () => {
  const full = await runOutputPipeline({ registry, storeRoot, sessionId, path: "src/big.ts", intent: "x", now, newId });
  const outline = await runOutputPipeline({ registry, storeRoot, sessionId, path: "src/big.ts", intent: "x", outline: true, now, newId });
  expect(full.ok && outline.ok).toBe(true);
  if (!outline.ok) return;
  // Outline read is NOT returned as the prior full read's unchanged-marker.
  expect(outline.result.decision).toBe("outline");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @megasaver/context-gate test run-outline`
Expected: FAIL — `outline` is not a known `RunOutputInput` field (TS error) / the second read returns `unchanged-marker`.

- [ ] **Step 3: Thread `outline` through `filterRaw` and `readAndFilter`**

In `packages/context-gate/src/read.ts`:

`filterRaw` (lines 156-170) — add the field and forward it:

```ts
export function filterRaw(input: {
  raw: string;
  path: string;
  intent: string;
  mode: TokenSaverMode;
  maxReturnedBytes: number | undefined;
  outline?: boolean;
}): Promise<FilterOutputResult> {
  return filterOutput({
    raw: input.raw,
    intent: input.intent,
    mode: input.mode,
    ...(input.maxReturnedBytes !== undefined ? { maxReturnedBytes: input.maxReturnedBytes } : {}),
    ...(input.outline === true ? { outline: true } : {}),
    source: { kind: "file", path: input.path },
  });
}
```

(`readAndFilter` at lines 172-194 is only used by the overlay path in this plan's scope — leave it unchanged.)

- [ ] **Step 4: Thread `outline` through `runOutputPipeline`**

In `packages/context-gate/src/run.ts`:

(a) `RunOutputInput` (lines 50-61) — add after `newId?`:

```ts
  outline?: boolean;
```

(b) read-index key (line 102) — make outline reads key into their own slot:

```ts
  const pathHash = hashPath(input.outline === true ? `${gate.absolute}#outline` : gate.absolute);
```

(c) `filterRaw` call (lines 108-114) — forward the flag:

```ts
  const filteredResult = await filterRaw({
    raw: read.raw,
    path: input.path,
    intent: input.intent,
    mode: settings.mode,
    maxReturnedBytes: settings.maxReturnedBytes,
    ...(input.outline === true ? { outline: true } : {}),
  });
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter @megasaver/context-gate test run-outline`
Expected: PASS.

- [ ] **Step 6: Run the full context-gate suite**

Run: `pnpm --filter @megasaver/context-gate test`
Expected: PASS (existing read/run/read-index tests unaffected — `outline` defaults to absent).

- [ ] **Step 7: Commit**

```bash
git add packages/context-gate/src/read.ts packages/context-gate/src/run.ts packages/context-gate/test/run-outline.test.ts
git commit -m "feat(context-gate): thread outline flag + read-index key suffix"
```

---

## Task 6: Thread `outline` through the daemon route + the MCP tool

**Files:**
- Modify: `packages/daemon/src/handlers-registry.ts:161-187`
- Modify: `packages/mcp-bridge/src/tools/read-file.ts:16-87`
- Test: `packages/daemon/test/handlers-registry.test.ts` (add a case), `packages/mcp-bridge/test/tools/read-file.test.ts` (add a case)

- [ ] **Step 1: Write the failing tests**

In `packages/mcp-bridge/test/tools/read-file.test.ts`, add a case asserting an `outline: true` read returns `decision === "outline"` (follow the file's existing `handleReadFile` harness — it stubs the registry/store).

In `packages/daemon/test/handlers-registry.test.ts`, add a case posting `{ sessionId, path, intent, outline: true }` to `readRegistryHandler` and asserting the response carries `decision: "outline"` (follow the existing read-registry test harness).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @megasaver/mcp-bridge test read-file && pnpm --filter @megasaver/daemon test handlers-registry`
Expected: FAIL — `outline` rejected by the strict daemon schema / not forwarded by the tool.

- [ ] **Step 3: Accept `outline` in the daemon schema + handler**

In `packages/daemon/src/handlers-registry.ts`:

`readRegistryRequestSchema` (lines 161-167):

```ts
const readRegistryRequestSchema = z
  .object({
    sessionId: sessionIdSchema,
    path: z.string().min(1),
    intent: z.string().min(1),
    outline: z.boolean().optional(),
  })
  .strict();
```

`runOutputPipeline` call (lines 179-187) — forward it:

```ts
  const result = await runOutputPipeline({
    registry,
    storeRoot,
    sessionId: parsed.data.sessionId,
    path: parsed.data.path,
    intent: parsed.data.intent,
    ...(parsed.data.outline === true ? { outline: true } : {}),
    ...(deps?.now !== undefined ? { now: deps.now } : {}),
    ...(deps?.newId !== undefined ? { newId: deps.newId } : {}),
  });
```

- [ ] **Step 4: Accept + forward `outline` in the MCP tool**

In `packages/mcp-bridge/src/tools/read-file.ts`:

(a) Input schema (lines 16-23) — add the field:

```ts
const readFileInputSchema = z
  .object({
    path: z.string().min(1),
    intent: z.string(),
    sessionId: z.string().min(1),
    maxBytes: z.number().int().positive().optional(),
    outline: z.boolean().optional(),
  })
  .strict();
```

(b) Destructure it (line 33):

```ts
  const { path, intent, sessionId, maxBytes, outline } = parsed.data;
```

(c) Forward body + local pipeline call (lines 46-60):

```ts
  return forwardOrFallback(
    env.storeRoot,
    "/read-registry",
    { sessionId, path, intent, ...(outline === true ? { outline: true } : {}) },
    async () => {
      const outcome = await runOutputPipeline({
        registry: env.registry,
        storeRoot: env.storeRoot,
        sessionId: sessionId as Parameters<typeof runOutputPipeline>[0]["sessionId"],
        path,
        intent,
        ...(outline === true ? { outline: true } : {}),
        now: env.now,
        newId: env.newId,
      });
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter @megasaver/mcp-bridge test read-file && pnpm --filter @megasaver/daemon test handlers-registry`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/daemon/src/handlers-registry.ts packages/mcp-bridge/src/tools/read-file.ts packages/daemon/test/handlers-registry.test.ts packages/mcp-bridge/test/tools/read-file.test.ts
git commit -m "feat(mcp-bridge,daemon): thread outline flag to read path"
```

---

## Task 7: End-to-end integration test + changeset + wiki

**Files:**
- Test: `packages/mcp-bridge/test/tools/read-file.test.ts` (add an outline→fetch round-trip)
- Create: `.changeset/outline-first-read.md`
- Modify: `wiki/index.md`, `wiki/concepts/` (new page), `wiki/log.md`

- [ ] **Step 1: Write the round-trip integration test**

In `packages/mcp-bridge/test/tools/read-file.test.ts`, add a test that:
1. Calls `handleReadFile` with `outline: true` on a multi-declaration TS fixture → captures `chunkSetId` and asserts `decision === "outline"`, skeleton lists `#0 … #N`.
2. Calls `handleFetchChunk` (the `mega_fetch_chunk` handler, imported from `../../src/tools/fetch-chunk.js`) with that `chunkSetId` and an id from the skeleton → asserts the returned chunk text is the full declaration body.

```ts
it("outline read then fetch returns the full body for a skeleton id", async () => {
  const read = await handleReadFile(env, {
    path: fixturePath, intent: "map", sessionId, outline: true,
  });
  expect(read.decision).toBe("outline");
  const id = Number(read.excerpts[0]?.text.match(/#(\d+) {2}L/)?.[1]);
  const body = await handleFetchChunk(fetchEnv, { chunkSetId: read.chunkSetId, chunkId: String(id), sessionId });
  expect(body /* assert per fetch-chunk's result shape */).toBeDefined();
});
```

(Match `handleFetchChunk`'s real argument + result shape from `packages/mcp-bridge/test/tools/fetch-chunk.test.ts`.)

- [ ] **Step 2: Run to verify pass**

Run: `pnpm --filter @megasaver/mcp-bridge test read-file`
Expected: PASS.

- [ ] **Step 3: Full verify**

Run: `pnpm verify`
Expected: PASS — `biome check`, `tsc -b --noEmit`, `vitest run` all green across the workspace.

- [ ] **Step 4: Add the changeset**

Create `.changeset/outline-first-read.md`:

```md
---
"@megasaver/output-filter": minor
"@megasaver/context-gate": minor
"@megasaver/daemon": minor
"@megasaver/mcp-bridge": minor
---

feat: outline-first read mode

`mega_read_file` accepts `outline: true`: for a supported source file it
returns the file skeleton (imports + top-level signatures + line ranges +
chunk ids) and persists every body as a fetchable chunk, so an agent expands
only the bodies it needs via `mega_fetch_chunk`. Lossless, additive, and
falls back to a normal read for non-source / unsupported / unparseable files.
```

- [ ] **Step 5: Update the wiki**

Create `wiki/concepts/outline-first-read.md` (≤50 lines, frontmatter per `wiki/CLAUDE.md`): what it is, the opt-in flag, the skeleton/expand contract, reuse of [[indexer]] extractors + `partitionFile`, the read-index `#outline` key, registry-path-only scope. Add a bullet under "Concepts" in `wiki/index.md`. Append a timestamped entry to `wiki/log.md`.

- [ ] **Step 6: Commit**

```bash
git add .changeset/outline-first-read.md wiki/ packages/mcp-bridge/test/tools/read-file.test.ts
git commit -m "feat: outline-first read e2e test, changeset, wiki"
```

---

## Self-Review notes

- **Spec coverage:** activation flag (Tasks 1,5,6) · skeleton builder top-level-only + signatures-only + line ranges (Task 2) · lossless full-coverage chunks (Task 2 test) · skeleton-displays / bodies-persist divergence (Tasks 3,4) · `mega_fetch_chunk` untouched + round-trip (Task 7) · redaction-before-outline (Task 3 note) · fallback null path (Task 2) · read-index non-cross-suppression (Task 5) · no-eager-typescript guard (Task 3 Step 5). All spec sections map to a task.
- **Signature name consistency:** `outlineFile(text, path)`, `renderSignature(lines, start, end, path)`, `OutlineBody`, `result.chunks`, `decision: "outline"`, `pathHash` `#outline` suffix — used identically across Tasks 2-7.
- **Verify-the-harness reminders:** Tasks 4/6/7 say to match `loadChunkSet` / `handleFetchChunk` / daemon-read shapes to the existing test files rather than guessing — these are the only spots needing a look at sibling tests during execution.
