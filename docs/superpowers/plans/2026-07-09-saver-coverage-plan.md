# Saver Coverage Wave 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The PostToolUse saver compresses Task/BashOutput/WebSearch/ToolSearch/`mcp__*` outputs, Grep/Glob filename arrays, and Bash stderr — and every compression is recoverable in-session via `mega output chunk` (fixed to read overlay chunk sets).

**Architecture:** Extend `TOOL_SOURCE`/`readOutputShape` in `apps/cli/src/hooks/saver.ts` (mapping onto the existing 4 `OutputSourceKind`s — no enum change); fix the recovery path once at `fetchChunk` (packages/context-gate) which CLI + daemon + mcp-bridge all route through; grow both hook matchers with in-place drift repair on `mega hooks install`.

**Tech Stack:** TypeScript strict ESM, Vitest, Zod 3, citty.

**Spec:** `docs/superpowers/specs/2026-07-09-saver-coverage-design.md` (HIGH risk — this worktree `feat/saver-coverage`, never main).

**Grounded constants:** `modeToBudget`: aggressive 4 000 / balanced 12 000 / safe 32 000. New-surface floor `NEW_SURFACE_MIN_BYTES = 16_384`. Overlay dirs are 16-hex workspaceKeys (`/^[0-9a-f]{16}$/`); registry dirs are UUIDs — never collide.

---

### Task 0: Baseline

- [ ] **Step 1:** Worktree `feat/saver-coverage` already exists (spec committed `19b0714`). From its root run `pnpm install && pnpm build` (full turbo — workspace dists needed). If `@megasaver/cli#build` fails on `@megasaver/gui/bridge`, run `pnpm --filter @megasaver/gui build` then retry.
- [ ] **Step 2:** Baseline: `pnpm --filter @megasaver/context-gate test && pnpm --filter @megasaver/cli exec vitest run test/hooks/ && pnpm --filter @megasaver/connector-claude-code test`. All green before any edit.

---

### Task 1: Overlay-aware `fetchChunk` (escape hatch root fix + C15 guard)

**Files:**
- Modify: `packages/context-gate/src/locate-chunk-set.ts` (whole file below)
- Modify: `packages/context-gate/src/fetch-chunk.ts`
- Test: `packages/context-gate/test/fetch-chunk-overlay.test.ts` (new)

Before editing: `grep -rn "locateChunkSet\|LocatedChunkSet" packages/ apps/ --include="*.ts" | grep -v test` — the union return type below changes consumers; adapt every hit (expected: only `fetch-chunk.ts`; if more exist, apply the same layout-switch).

- [ ] **Step 1: Write failing test** — create `packages/context-gate/test/fetch-chunk-overlay.test.ts`:

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveOverlayChunkSet } from "@megasaver/content-store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fetchChunk } from "../src/fetch-chunk.js";

const WK = "7da3a87ecc581dd6";
const LIVE = "ae662232-619e-4c84-b860-e38473ffa7ea";
const SET = "a9c9e447-d3d4-4251-abef-5773f8caafc2";

let store: string;
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "megasaver-cg-overlay-"));
});
afterEach(() => rmSync(store, { recursive: true, force: true }));

async function seedOverlay(): Promise<void> {
  await saveOverlayChunkSet({
    storeRoot: store,
    chunkSet: {
      chunkSetId: SET,
      workspaceKey: WK,
      liveSessionId: LIVE,
      createdAt: "2026-07-09T12:00:00.000Z",
      source: { kind: "command", command: "pnpm verify", args: [] },
      rawBytes: 11,
      redacted: false,
      chunks: [{ id: "0", startLine: 1, endLine: 1, bytes: 11, text: "full output" }],
    },
  });
}

describe("fetchChunk — overlay layout", () => {
  it("reads a hook-written overlay chunk set (the live C11 repro)", async () => {
    await seedOverlay();
    const out = await fetchChunk({ storeRoot: store, chunkSetId: SET, chunkId: "0" });
    expect(out).toEqual({
      ok: true,
      chunk: { id: "0", startLine: 1, endLine: 1, bytes: 11, text: "full output" },
    });
  });

  it("returns chunk_not_found for a missing chunk id in an overlay set", async () => {
    await seedOverlay();
    const out = await fetchChunk({ storeRoot: store, chunkSetId: SET, chunkId: "9" });
    expect(out).toEqual({ ok: false, reason: "chunk_not_found" });
  });

  it("survives a stray non-directory under content/ (C15 .DS_Store)", async () => {
    await seedOverlay();
    writeFileSync(join(store, "content", ".DS_Store"), "junk");
    mkdirSync(join(store, "content", WK, "not-a-dir-holder"), { recursive: true });
    writeFileSync(join(store, "content", WK, ".DS_Store"), "junk");
    const out = await fetchChunk({ storeRoot: store, chunkSetId: SET, chunkId: "0" });
    expect(out.ok).toBe(true);
  });

  it("still returns chunk_set_not_found for an unknown id", async () => {
    await seedOverlay();
    const out = await fetchChunk({
      storeRoot: store,
      chunkSetId: "00000000-0000-4000-8000-000000000000",
      chunkId: "0",
    });
    expect(out).toEqual({ ok: false, reason: "chunk_set_not_found" });
  });
});
```

Check `saveOverlayChunkSet` and the `OverlayChunkSet` type are exported from `@megasaver/content-store` (`packages/content-store/src/index.ts`); if `loadOverlayChunkSet` is not exported there, add it to that index (it lives in `store.ts:190`).

- [ ] **Step 2: Run test, verify FAIL**

Run: `pnpm --filter @megasaver/context-gate exec vitest run test/fetch-chunk-overlay.test.ts`
Expected: first test FAILS — currently `store_corrupt` ("Invalid id." — `validateIds` rejects the 16-hex workspaceKey as ProjectId), not `ok: true`.

- [ ] **Step 3: Rewrite `packages/context-gate/src/locate-chunk-set.ts`** (whole file):

```ts
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ProjectId, SessionId } from "@megasaver/shared";

export type LocatedChunkSet =
  | { layout: "registry"; projectId: ProjectId; sessionId: SessionId }
  | { layout: "overlay"; workspaceKey: string; liveSessionId: string };

// Overlay dirs are 16-hex workspaceKeys (encodeWorkspaceKey); registry dirs
// are UUID project ids — the two shapes never collide.
const WORKSPACE_KEY_DIR = /^[0-9a-f]{16}$/;

// Walks <store>/content/<topDir>/<sessionDir>/ for <chunkSetId>.json.
// Chunk-set ids are globally unique (§3d), so the first match owns it.
// Schema/ownership validation is delegated to the loaders, not done here.
export function locateChunkSet(input: {
  storeRoot: string;
  chunkSetId: string;
}): LocatedChunkSet | null {
  const contentRoot = join(input.storeRoot, "content");
  if (!existsSync(contentRoot)) return null;

  const fileName = `${input.chunkSetId}.json`;
  for (const topDir of readdirSync(contentRoot)) {
    const topPath = join(contentRoot, topDir);
    if (!statSync(topPath).isDirectory()) continue;
    for (const sessionDir of readdirSync(topPath)) {
      const sessionPath = join(topPath, sessionDir);
      if (!statSync(sessionPath).isDirectory()) continue;
      if (existsSync(join(sessionPath, fileName))) {
        return WORKSPACE_KEY_DIR.test(topDir)
          ? { layout: "overlay", workspaceKey: topDir, liveSessionId: sessionDir }
          : {
              layout: "registry",
              projectId: topDir as unknown as ProjectId,
              sessionId: sessionDir as unknown as SessionId,
            };
      }
    }
  }
  return null;
}
```

- [ ] **Step 4: Add the overlay branch to `packages/context-gate/src/fetch-chunk.ts`** — replace the body after the `located === null` check:

```ts
import {
  type Chunk,
  ContentStoreError,
  loadChunkSet,
  loadOverlayChunkSet,
} from "@megasaver/content-store";
import { locateChunkSet } from "./locate-chunk-set.js";

export type FetchChunkResult =
  | { ok: true; chunk: Chunk }
  | { ok: false; reason: "chunk_set_not_found" }
  | { ok: false; reason: "chunk_not_found" }
  | { ok: false; reason: "store_corrupt"; detail: string };

export async function fetchChunk(input: {
  storeRoot: string;
  chunkSetId: string;
  chunkId: string;
}): Promise<FetchChunkResult> {
  const located = locateChunkSet({ storeRoot: input.storeRoot, chunkSetId: input.chunkSetId });
  if (located === null) return { ok: false, reason: "chunk_set_not_found" };

  let chunks: readonly Chunk[];
  try {
    if (located.layout === "overlay") {
      const overlay = await loadOverlayChunkSet({
        storeRoot: input.storeRoot,
        workspaceKey: located.workspaceKey,
        liveSessionId: located.liveSessionId,
        chunkSetId: input.chunkSetId,
      });
      chunks = overlay.chunks;
    } else {
      const registry = await loadChunkSet({
        storeRoot: input.storeRoot,
        projectId: located.projectId,
        sessionId: located.sessionId,
        chunkSetId: input.chunkSetId,
      });
      chunks = registry.chunks;
    }
  } catch (err) {
    if (err instanceof ContentStoreError) {
      if (err.code === "not_found") return { ok: false, reason: "chunk_set_not_found" };
      return { ok: false, reason: "store_corrupt", detail: err.message };
    }
    throw err;
  }

  const chunk = chunks.find((c) => c.id === input.chunkId);
  if (chunk === undefined) return { ok: false, reason: "chunk_not_found" };
  return { ok: true, chunk };
}
```

- [ ] **Step 5: Run tests, verify PASS + no regressions**

Run: `pnpm --filter @megasaver/context-gate exec vitest run test/fetch-chunk-overlay.test.ts` (4 pass), then `pnpm --filter @megasaver/context-gate test` and `pnpm --filter @megasaver/context-gate typecheck`, then `pnpm --filter @megasaver/content-store test` (if index changed). This also un-breaks daemon `/expand-registry` and the mcp-bridge fallback for overlay sets (they call this same `fetchChunk`) — run `pnpm --filter @megasaver/daemon test && pnpm --filter @megasaver/mcp-bridge test` to confirm no expectation pinned the old failure.

- [ ] **Step 6: Commit**

```bash
git add packages/context-gate/src/locate-chunk-set.ts packages/context-gate/src/fetch-chunk.ts packages/context-gate/test/fetch-chunk-overlay.test.ts packages/content-store/src/index.ts
git commit -m "fix(context-gate): fetchChunk reads overlay chunk sets"
```

---

### Task 2: Footer → working escape hatch + C13 no-recompress guard

**Files:**
- Modify: `apps/cli/src/hooks/saver.ts` (footer block ~L192-200; guard after the sourceKind lookup ~L154)
- Test: `apps/cli/test/hooks/saver.test.ts`

- [ ] **Step 1: Write failing tests** — add to `apps/cli/test/hooks/saver.test.ts` (reuse the existing `deps()` + `bigBash()` helpers):

```ts
describe("recovery footer + expansion guard", () => {
  it("footer points at the Bash-callable mega output chunk", async () => {
    const d = deps();
    const out = await buildSaverDecision(bigBash("X".repeat(50_000)), d);
    expect("updatedToolOutput" in out).toBe(true);
    const u = (out as { updatedToolOutput: { stdout: string } }).updatedToolOutput;
    expect(u.stdout).toContain('run: mega output chunk "cs-1" "0"');
    expect(u.stdout).toContain("proxy_expand_chunk");
  });

  it("never re-compresses a mega output chunk expansion (C13)", async () => {
    const d = deps();
    const payload = {
      tool_name: "Bash",
      tool_input: { command: 'mega output chunk "cs-1" "0"' },
      tool_response: { stdout: "Y".repeat(50_000), stderr: "", interrupted: false, isImage: false },
      session_id: "live-1",
      cwd: "/Users/x/proj",
    };
    const out = await buildSaverDecision(payload, d);
    expect(out).toEqual({ passthrough: true });
    expect(d.record).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — `pnpm --filter @megasaver/cli exec vitest run test/hooks/saver.test.ts` (both new tests red; also `grep -n "proxy_expand_chunk" apps/cli/test/hooks/saver.test.ts` — update any existing footer-text assertion to the new wording in the same edit, and note it in the commit).

- [ ] **Step 3: Implement.** In `buildSaverDecision`, immediately after the `sourceKind === undefined` passthrough:

```ts
    // C13: a recovery expansion must arrive whole — never re-compress it.
    if (tool === "Bash") {
      const ti = p["tool_input"];
      const cmd =
        typeof ti === "object" && ti !== null && typeof (ti as Record<string, unknown>)["command"] === "string"
          ? ((ti as Record<string, unknown>)["command"] as string)
          : "";
      if (/\bmega\s+output\s+chunk\b/.test(cmd)) return PASSTHROUGH;
    }
```

Replace the footer block:

```ts
    const expandCmd = `run: mega output chunk "${recorded.chunkSetId}" "0"`;
    const recovery = looksPreTruncated(shape.raw)
      ? `NOTE: upstream output appears truncated, recovered chunk is PARTIAL, not complete — ${expandCmd} (or MCP proxy_expand_chunk if connected)`
      : `Full output recoverable — ${expandCmd} (or MCP proxy_expand_chunk if connected)`;
```

(The `pointer` template line is unchanged.)

- [ ] **Step 4: Run, verify PASS** — same vitest command, all green incl. pre-existing tests.
- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/hooks/saver.ts apps/cli/test/hooks/saver.test.ts
git commit -m "feat(cli): saver footer points at working mega output chunk"
```

---

### Task 3: Tool coverage — TOOL_SOURCE, mcp__ branch, floor, labels

**Files:**
- Modify: `apps/cli/src/hooks/saver.ts`
- Test: `apps/cli/test/hooks/saver.test.ts`

- [ ] **Step 1: Write failing tests** (table-driven; add to saver.test.ts):

```ts
describe("wave-1 tool coverage", () => {
  const big = "Z".repeat(50_000);
  const cases: Array<{ tool: string; input: Record<string, unknown>; response: unknown }> = [
    { tool: "Task", input: { description: "explore auth" }, response: { content: [{ type: "text", text: big }] } },
    { tool: "BashOutput", input: {}, response: { stdout: big, stderr: "" } },
    { tool: "WebSearch", input: { query: "vitest flaky" }, response: big },
    { tool: "ToolSearch", input: { query: "select:Read" }, response: big },
    { tool: "mcp__somevendor__get_page", input: {}, response: { content: [{ type: "text", text: big }] } },
  ];

  it.each(cases)("compresses $tool above the new-surface floor", async ({ tool, input, response }) => {
    const d = deps();
    const out = await buildSaverDecision(
      { tool_name: tool, tool_input: input, tool_response: response, session_id: "live-1", cwd: "/Users/x/proj" },
      d,
    );
    expect("updatedToolOutput" in out).toBe(true);
    expect(d.record).toHaveBeenCalledOnce();
  });

  it("gates new surfaces at max(modeBudget, 16384): 16384 bytes passes through", async () => {
    const d = deps(); // balanced mode: budget 12_000 < floor 16_384
    const out = await buildSaverDecision(
      { tool_name: "WebSearch", tool_input: { query: "q" }, tool_response: "W".repeat(16_384), session_id: "live-1", cwd: "/Users/x/proj" },
      d,
    );
    expect(out).toEqual({ passthrough: true });
    expect(d.record).not.toHaveBeenCalled();
  });

  it("compresses a new surface at 16385 bytes", async () => {
    const d = deps();
    const out = await buildSaverDecision(
      { tool_name: "WebSearch", tool_input: { query: "q" }, tool_response: "W".repeat(16_385), session_id: "live-1", cwd: "/Users/x/proj" },
      d,
    );
    expect("updatedToolOutput" in out).toBe(true);
  });

  it("existing tools keep the plain mode budget (13000 > balanced 12000 compresses)", async () => {
    const d = deps();
    const out = await buildSaverDecision(bigBash("B".repeat(13_000)), d);
    expect("updatedToolOutput" in out).toBe(true);
  });

  it("mega's own MCP tools pass through (no self-compression)", async () => {
    const d = deps();
    const out = await buildSaverDecision(
      { tool_name: "mcp__megasaver__proxy_read_file", tool_input: {}, tool_response: "M".repeat(50_000), session_id: "live-1", cwd: "/Users/x/proj" },
      d,
    );
    expect(out).toEqual({ passthrough: true });
    expect(d.record).not.toHaveBeenCalled();
  });

  it("labels WebSearch by query and Task by description", async () => {
    const d = deps();
    await buildSaverDecision(
      { tool_name: "WebSearch", tool_input: { query: "vitest flaky" }, tool_response: "Q".repeat(50_000), session_id: "live-1", cwd: "/Users/x/proj" },
      d,
    );
    expect(d.record).toHaveBeenCalledWith(expect.objectContaining({ label: "vitest flaky", sourceKind: "grep" }));
    await buildSaverDecision(
      { tool_name: "Task", tool_input: { description: "explore auth" }, tool_response: { content: [{ type: "text", text: "T".repeat(50_000) }] }, session_id: "live-1", cwd: "/Users/x/proj" },
      d,
    );
    expect(d.record).toHaveBeenCalledWith(expect.objectContaining({ label: "explore auth", sourceKind: "command" }));
  });
});
```

- [ ] **Step 2: Run, verify FAIL** (unknown tools currently passthrough).
- [ ] **Step 3: Implement in `apps/cli/src/hooks/saver.ts`:**

Extend the map and add helpers (replacing the bare `TOOL_SOURCE[tool]` lookup):

```ts
const TOOL_SOURCE: Record<string, OutputSourceKind> = {
  Read: "file",
  LS: "file",
  Bash: "command",
  Grep: "grep",
  Glob: "grep",
  WebFetch: "fetch",
  // Wave 1 (spec 2026-07-09): agent/search surfaces. "fetch" is off-limits
  // for these — its chunk-set label is URL-validated and would fail persistence.
  Task: "command",
  BashOutput: "command",
  Monitor: "command",
  WebSearch: "grep",
  ToolSearch: "grep",
};

// Mega's own bridge tools are already compressed upstream — never re-compress.
const MEGA_MCP_TOOL = /^mcp__mega/i;
const NEW_SURFACE_TOOLS = new Set(["Task", "BashOutput", "Monitor", "WebSearch", "ToolSearch"]);
export const NEW_SURFACE_MIN_BYTES = 16_384;

function resolveSourceKind(tool: string): OutputSourceKind | undefined {
  const mapped = TOOL_SOURCE[tool];
  if (mapped !== undefined) return mapped;
  if (tool.startsWith("mcp__") && !MEGA_MCP_TOOL.test(tool)) return "command";
  return undefined;
}

function minBytesFor(tool: string, mode: TokenSaverMode): number {
  const budget = modeToBudget(mode);
  return NEW_SURFACE_TOOLS.has(tool) || tool.startsWith("mcp__")
    ? Math.max(budget, NEW_SURFACE_MIN_BYTES)
    : budget;
}
```

In `buildSaverDecision`: `const sourceKind = resolveSourceKind(tool);` and the size gate becomes
`if (Buffer.byteLength(shape.raw, "utf8") <= minBytesFor(tool, settings.mode)) return PASSTHROUGH;`.
In `labelOf`, extend the chain: `... asStr(i["pattern"]) ?? asStr(i["description"]) ?? asStr(i["query"]) ?? asStr(i["url"]) ?? fallback`.

- [ ] **Step 4: Run, verify PASS** — new describe green + zero regressions in the whole file.
- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/hooks/saver.ts apps/cli/test/hooks/saver.test.ts
git commit -m "feat(cli): saver covers Task, background, search, and mcp outputs"
```

---

### Task 4: New shapes — filename arrays, stderr slot, mixed content

**Files:**
- Modify: `apps/cli/src/hooks/saver.ts` (`readOutputShape`)
- Test: `apps/cli/test/hooks/saver.test.ts`

- [ ] **Step 1: Write failing tests.** REWRITE the existing `"passes through a Glob filenames list (high-signal, never compressed)"` test (design reversal — cite the wave-1 spec in a comment) and add:

```ts
describe("wave-1 shapes", () => {
  it("compresses a Glob filenames array and rebuilds it as string[] (spec 2026-07-09 reverses the v1 passthrough)", async () => {
    const d = deps();
    const out = await buildSaverDecision(
      {
        tool_name: "Glob",
        tool_input: { pattern: "**/*.ts" },
        tool_response: {
          filenames: Array.from({ length: 2_000 }, (_, i) => `src/file-${i}.ts`),
          durationMs: 12,
          numFiles: 2_000,
          truncated: false,
        },
        session_id: "live-1",
        cwd: "/Users/x/proj",
      },
      d,
    );
    expect("updatedToolOutput" in out).toBe(true);
    const u = (out as { updatedToolOutput: { filenames: string[]; numFiles: number } }).updatedToolOutput;
    expect(Array.isArray(u.filenames)).toBe(true);
    expect(u.filenames.join("\n")).toContain("SHORT");
    expect(u.numFiles).toBe(2_000);
  });

  it("compresses Grep files_with_matches filenames", async () => {
    const d = deps();
    const out = await buildSaverDecision(
      {
        tool_name: "Grep",
        tool_input: { pattern: "TODO" },
        tool_response: {
          mode: "files_with_matches",
          filenames: Array.from({ length: 2_000 }, (_, i) => `src/f-${i}.ts`),
          numFiles: 2_000,
        },
        session_id: "live-1",
        cwd: "/Users/x/proj",
      },
      d,
    );
    expect("updatedToolOutput" in out).toBe(true);
  });

  it("compresses the LARGER of stdout/stderr and leaves the other untouched", async () => {
    const d = deps();
    const out = await buildSaverDecision(
      {
        tool_name: "Bash",
        tool_input: { command: "pnpm build" },
        tool_response: { stdout: "ok", stderr: "E".repeat(50_000), interrupted: false, isImage: false },
        session_id: "live-1",
        cwd: "/Users/x/proj",
      },
      d,
    );
    expect("updatedToolOutput" in out).toBe(true);
    const u = (out as { updatedToolOutput: { stdout: string; stderr: string } }).updatedToolOutput;
    expect(u.stdout).toBe("ok");
    expect(u.stderr).toContain("SHORT");
  });

  it("compresses text blocks in a mixed content array and preserves non-text blocks byte-identical", async () => {
    const d = deps();
    const image = { type: "image", source: { type: "base64", data: "AAAA" } };
    const out = await buildSaverDecision(
      {
        tool_name: "Read",
        tool_input: { file_path: "/x/doc.pdf" },
        tool_response: { content: [{ type: "text", text: "T".repeat(50_000) }, image, { type: "text", text: "tail" }] },
        session_id: "live-1",
        cwd: "/Users/x/proj",
      },
      d,
    );
    expect("updatedToolOutput" in out).toBe(true);
    const u = (out as { updatedToolOutput: { content: unknown[] } }).updatedToolOutput;
    expect(u.content).toHaveLength(2);
    expect(u.content[0]).toEqual({ type: "text", text: expect.stringContaining("SHORT") });
    expect(u.content[1]).toEqual(image);
  });

  it("still passes through an all-non-text content array", async () => {
    const d = deps();
    const out = await buildSaverDecision(
      {
        tool_name: "Read",
        tool_input: { file_path: "/x/img.png" },
        tool_response: { content: [{ type: "image", source: { data: "AAAA" } }] },
        session_id: "live-1",
        cwd: "/Users/x/proj",
      },
      d,
    );
    expect(out).toEqual({ passthrough: true });
  });
});
```

- [ ] **Step 2: Run, verify FAIL** (Glob rewrite red — currently passthrough; stderr red; mixed red).
- [ ] **Step 3: Implement in `readOutputShape`:**

Replace the `stdout` branch with the larger-slot logic:

```ts
  const stdout = typeof o["stdout"] === "string" ? o["stdout"] : undefined;
  const stderr = typeof o["stderr"] === "string" ? o["stderr"] : undefined;
  if (stdout !== undefined || stderr !== undefined) {
    // Wave 1 (A6): pnpm/cargo/webpack put their bulk on stderr — compress the
    // larger stream, keep the other untouched so the stdout/stderr split survives.
    const slot = (stderr?.length ?? 0) > (stdout?.length ?? 0) ? "stderr" : "stdout";
    const raw = slot === "stderr" ? (stderr as string) : (stdout ?? "");
    return { raw, rebuild: (t) => ({ ...o, [slot]: t }) };
  }
```

Replace the content-array branch (mixed support, A7):

```ts
  if (Array.isArray(o["content"])) {
    const blocks = o["content"] as unknown[];
    if (blocks.length === 0) return null;
    const isText = (b: unknown): b is { type: "text"; text: string } =>
      typeof b === "object" &&
      b !== null &&
      (b as { type?: unknown })["type"] === "text" &&
      typeof (b as { text?: unknown })["text"] === "string";
    const textBlocks = blocks.filter(isText);
    if (textBlocks.length === 0) return null;
    const raw = textBlocks.map((b) => b.text).join("\n");
    if (raw.length === 0) return null;
    // Wave 1 (A7): compressed text lands at the FIRST text block's position;
    // non-text blocks (images, …) pass through byte-identical, order held.
    const rebuild = (t: string) => {
      const firstTextIdx = blocks.findIndex(isText);
      const next: unknown[] = [];
      blocks.forEach((b, i) => {
        if (i === firstTextIdx) next.push({ type: "text", text: t });
        else if (!isText(b)) next.push(b);
      });
      return { ...o, content: next };
    };
    return { raw, rebuild };
  }
```

Add the filenames branch AFTER the content-array branch, BEFORE the `file` branch (A5):

```ts
  // Wave 1 (A5): Grep files_with_matches / Glob expose a filenames array —
  // uncapped 30KB+ leaks in a monorepo. Compress as newline-joined paths;
  // rebuild keeps the string[] schema (fewer, ranked paths + footer).
  const filenames = o["filenames"];
  if (Array.isArray(filenames) && filenames.length > 0 && filenames.every((f) => typeof f === "string")) {
    const raw = (filenames as string[]).join("\n");
    if (raw.length === 0) return null;
    return { raw, rebuild: (t) => ({ ...o, filenames: t.split("\n") }) };
  }
```

Ordering note: Grep content-mode has `content` STRING (hits the `{content: string}` branch before filenames) — unchanged. The Glob fixture's small `filenames: []` in old Grep tests stays inert (empty array → branch skipped).

- [ ] **Step 4: Run, verify PASS** — whole saver.test.ts green (incl. rewritten Glob test).
- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/hooks/saver.ts apps/cli/test/hooks/saver.test.ts
git commit -m "feat(cli): saver shapes for filename arrays, stderr, mixed content"
```

---

### Task 5: Matchers + drift repair + telemetry categories

**Files:**
- Modify: `packages/connectors/claude-code/src/hook-settings.ts`
- Modify: `apps/cli/src/hooks/logger.ts`
- Test: `packages/connectors/claude-code/test/hook-settings.test.ts`, `apps/cli/test/hooks/install.test.ts`, `apps/cli/test/hooks/uninstall.test.ts`, `apps/cli/test/hooks/logger.test.ts` (locate exact file with `ls apps/cli/test/hooks/`)

- [ ] **Step 1: Write failing tests.** In `packages/connectors/claude-code/test/hook-settings.test.ts` add:

```ts
it("repairs a stale saver matcher in place on install (wave-1 upgrade path)", () => {
  const stale = {
    hooks: {
      PostToolUse: [
        { matcher: "Read|Bash|Grep|Glob|LS|WebFetch", hooks: [{ type: "command", command: "mega hooks saver" }] },
        { matcher: "Write", hooks: [{ type: "command", command: "other-tool run" }] },
      ],
    },
  };
  const next = addPostToolUseHook(stale, "mega hooks saver");
  const post = (next.hooks as { PostToolUse: Array<{ matcher?: string; hooks: unknown }> }).PostToolUse;
  expect(post).toHaveLength(2);
  expect(post[0]?.matcher).toBe(SAVER_HOOK_MATCHER);
  expect(post[1]).toEqual(stale.hooks.PostToolUse[1]);
});
```

Then `grep -rn '"Read|Bash|Grep|Glob|LS' packages/connectors/claude-code/test apps/cli/test` and update every literal matcher expectation to the new constants (import the constants instead of re-hardcoding where the test's purpose allows; keep ONE literal-string pin test per constant so drift is still caught — update that pin to the new full string).

In the logger test add: `Task`→`eligible_command`, `WebSearch`→`eligible_search`, `mcp__somevendor__x`→`eligible_mcp`, `mcp__megasaver__x`→ dropped (null line), `Write`→ still dropped.

- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement.**

`hook-settings.ts` constants:

```ts
export const HOOK_MATCHER = "Read|Bash|Grep|Glob|LS|WebFetch|Task|BashOutput|WebSearch|ToolSearch|mcp__.*";
export const SAVER_HOOK_MATCHER = HOOK_MATCHER;
```

Drift repair — in `addPreToolUseHook`/`addPostToolUseHook`, before the early-return presence check, rewrite a stale matcher on the entry that references our command:

```ts
function repairMatcher(entries: ToolUseEntry[], command: string, matcher: string): boolean {
  let repaired = false;
  for (const entry of entries) {
    if (entryReferencesCommand(entry, command) && entry.matcher !== matcher) {
      entry.matcher = matcher;
      repaired = true;
    }
  }
  return repaired;
}
```

Wire it: each add fn deep-copies the existing array (`post.map((e) => ({ ...e })))`, runs `repairMatcher`; if the command is already present return the (possibly repaired) settings — and `installClaudeCodeHook` must treat a repair as `changed: true`. Simplest wiring: make the add fns return the settings object and let install compare `JSON.stringify(existing) !== JSON.stringify(next)` for its `changed` flag instead of the presence pre-check (read `installClaudeCodeHook` L176-191 and keep its atomic write; the presence short-circuit goes away, idempotence now falls out of value equality).

`logger.ts`:

```ts
const TOOL_CATEGORY: Record<string, string> = {
  Read: "eligible_read",
  Bash: "eligible_command",
  Grep: "eligible_search",
  Glob: "eligible_search",
  LS: "eligible_read",
  WebFetch: "eligible_read",
  Task: "eligible_command",
  BashOutput: "eligible_command",
  Monitor: "eligible_command",
  WebSearch: "eligible_search",
  ToolSearch: "eligible_search",
};
const MEGA_MCP_TOOL = /^mcp__mega/i;
function categoryFor(tool: string): string | undefined {
  const mapped = TOOL_CATEGORY[tool];
  if (mapped !== undefined) return mapped;
  if (tool.startsWith("mcp__") && !MEGA_MCP_TOOL.test(tool)) return "eligible_mcp";
  return undefined;
}
```

Use `categoryFor(tool)` where `TOOL_CATEGORY[tool]` was read; keep `ELIGIBLE_HOOK_TOOLS` derived from `Object.keys(TOOL_CATEGORY)` (grep its consumers first — if something iterates it as "the full eligible set", note that mcp__ tools are intentionally not enumerable there).

- [ ] **Step 4: Run, verify PASS** — `pnpm --filter @megasaver/connector-claude-code test && pnpm --filter @megasaver/cli exec vitest run test/hooks/` all green; `pnpm --filter @megasaver/cli typecheck` exit 0.
- [ ] **Step 5: Commit**

```bash
git add packages/connectors/claude-code/src/hook-settings.ts apps/cli/src/hooks/logger.ts packages/connectors/claude-code/test apps/cli/test/hooks
git commit -m "feat(connectors): wave-1 hook matchers with in-place drift repair"
```

---

### Task 6: Integration roundtrip, changeset, verify, smoke, wiki

**Files:**
- Test: `apps/cli/test/hooks/saver-roundtrip.test.ts` (new)
- Create: `.changeset/saver-coverage-wave1.md`
- Modify: wiki (per §0)

- [ ] **Step 1: Integration test (red only if Task 1 regressed)** — create `apps/cli/test/hooks/saver-roundtrip.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordAndFilterOverlayOutput } from "@megasaver/core";
import { fetchChunk } from "@megasaver/context-gate";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let store: string;
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "megasaver-roundtrip-"));
});
afterEach(() => rmSync(store, { recursive: true, force: true }));

describe("C11 roundtrip: hook compression → mega output chunk path", () => {
  it("fetchChunk returns the full raw for a hook-written overlay set", async () => {
    const raw = Array.from({ length: 3_000 }, (_, i) => `line ${i}: some build output text`).join("\n");
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
    expect(recorded.decision).toBe("compressed");
    const out = await fetchChunk({ storeRoot: store, chunkSetId: recorded.chunkSetId as string, chunkId: "0" });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.chunk.text).toContain("line 2999");
  });
});
```

(Verify `fetchChunk` is exported from `@megasaver/context-gate` index; add the re-export if missing. If `recordAndFilterOverlayOutput` redacts, assert on a non-secret-looking line as above.)

- [ ] **Step 2:** Run it green. Then `pnpm build` (refresh dists) and `pnpm verify` — full gate, all green.
- [ ] **Step 3: Changeset** — create `.changeset/saver-coverage-wave1.md`:

```md
---
"@megasaver/cli": minor
"@megasaver/context-gate": patch
"@megasaver/connector-claude-code": patch
---

Saver coverage wave 1: the PostToolUse saver now compresses Task/subagent
reports, BashOutput/Monitor retrievals, WebSearch/ToolSearch results, and
third-party `mcp__*` tool outputs (16 KiB conservative floor), plus Grep
files-mode/Glob filename arrays, Bash stderr (larger-stream slot), and the
text blocks of mixed content arrays. Recovery is now real: `fetchChunk`
reads hook-written overlay chunk sets, so the compression footer's new
`mega output chunk "<set>" "0"` instruction works in every session (and
expansions are never re-compressed). `mega hooks install` repairs stale
matchers in place.
```

- [ ] **Step 4: Smoke evidence (capture output).** Rebuild CLI (`pnpm --filter @megasaver/cli build`), then reproduce this session's exact C11 failure on the fixed build:

```bash
node apps/cli/dist/cli.js output chunk a9c9e447-d3d4-4251-abef-5773f8caafc2 0
```

Expected: prints the stored chunk (this session's compressed saver.ts read) instead of `error: store_corrupt: Invalid id.` — the default store resolves to `~/.local/share/megasaver` where the live overlay set exists. Capture before/after.

- [ ] **Step 5: Wiki (§0).** Update `wiki/syntheses/saver-savings-gaps.md`: mark A1-A7, C11, C13, C15 as **FIXED (wave 1, feat/saver-coverage)** with one line each; add `wiki/entities/` note or extend `[[entities/cli]]` with the new coverage; append `wiki/log.md` timestamped entry (evidence: verify green + C11 live repro fixed). Do NOT mark C12/C14 (still open — wave 2).
- [ ] **Step 6: Commit**

```bash
git add .changeset/saver-coverage-wave1.md wiki/ apps/cli/test/hooks/saver-roundtrip.test.ts packages/context-gate/src/index.ts
git commit -m "chore(release): saver coverage wave 1 changeset + wiki"
```

---

### Task 7: Review gates (HIGH risk — both reviewers)

- [ ] **Step 1:** `superpowers:requesting-code-review` — `code-reviewer` agent, fresh context, whole branch diff (`git diff 19b0714..HEAD`), focus: shape-rebuild schema fidelity (every rebuild must keep the tool's original schema), passthrough-on-unknown invariants, matcher regex safety, floor boundaries, overlay/registry layout discrimination.
- [ ] **Step 2:** `critic` agent, separate fresh context, adversarial: craft tool_responses that crash a rebuild or leak (filenames with embedded `\n`? stderr slot swapping semantics? mcp__ tool named to dodge the mega exclusion? overlay dir named like a UUID?).
- [ ] **Step 3:** Fix findings RED-first; re-run `pnpm verify`.
- [ ] **Step 4:** `superpowers:finishing-a-development-branch` — PR to main, CI green, rebase-merge. Ships in the 2.0 train with brain portability.

---

## Self-review notes (plan time)

- Spec coverage: §A→Task 3+5, §B→Task 4, §C→Tasks 1+2, §D→Task 5, §E edge cases→tests in Tasks 1-4, §F→every task + Task 6, non-goals untouched. Floor decision §locked-3→Task 3.
- Soft spots the implementer must verify on first touch (grounded but re-check): exact export lists of `@megasaver/content-store` / `@megasaver/context-gate` indexes; `installClaudeCodeHook` body when replacing the presence short-circuit; logger test file name; whether any daemon/mcp-bridge test pinned the old overlay-read failure.
- Type consistency: `LocatedChunkSet` union used only in Task 1's two files; `resolveSourceKind`/`minBytesFor`/`NEW_SURFACE_MIN_BYTES` names consistent across Tasks 3-4; footer string in Task 2 matches Task 6's smoke expectations.
