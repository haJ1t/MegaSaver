# Realized Saver Mode PostToolUse Hook — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A Claude Code PostToolUse hook (`mega hooks saver`) that evidence-preservingly compresses large native tool output, feeds the model the compressed version (`updatedToolOutput`), and records per-session overlay token-saver events that populate the live GUI tab — gated on the Saver Mode toggle.

**Architecture:** New `@megasaver/context-gate` primitive `recordAndFilterOverlayOutput` filters an arbitrary output buffer (reusing `filterOutput`), persists the raw as a recoverable overlay chunk, and `appendOverlayEvent` keyed by `(workspaceKey, liveSessionId)`. A new `@megasaver/cli` PostToolUse hook reads the payload, gates (eligible tool + Saver Mode enabled for `encode(cwd)` + output > mode budget), calls the primitive, and emits `hookSpecificOutput.updatedToolOutput` in the tool's original output shape. The installer adds the PostToolUse entry. **Never blocks: exit 0 always; any error / unknown shape / disabled ⇒ original output untouched.**

**Tech Stack:** TypeScript strict ESM, Vitest, citty, Zod, `@megasaver/{context-gate,output-filter,stats,shared}`.

---

## File Structure

**Create:**
- `packages/context-gate/src/record-output.ts` — `recordAndFilterOverlayOutput` primitive.
- `packages/context-gate/test/record-output.test.ts`
- `apps/cli/src/hooks/saver.ts` — pure `buildSaverDecision` + output-shape adapter.
- `apps/cli/src/hooks/saver-run.ts` — stdin wrapper, always exit 0.
- `apps/cli/src/commands/hooks/saver.ts` — citty command.
- `apps/cli/test/hooks/saver.test.ts`
- `.changeset/realized-saver-hook.md`

**Modify:**
- `packages/context-gate/src/index.ts` — export the primitive + types.
- `apps/cli/src/commands/hooks/install.ts` — add PostToolUse helpers + install both entries.
- `apps/cli/src/commands/hooks/index.ts` — register `saver` subcommand.
- `apps/cli/test/hooks/install.test.ts` — PostToolUse entry assertions.
- wiki: `entities/cli`, `entities/context-gate`, `log.md`.

---

## Task 1: context-gate `recordAndFilterOverlayOutput` primitive

**Files:**
- Create: `packages/context-gate/src/record-output.ts`
- Modify: `packages/context-gate/src/index.ts`
- Test: `packages/context-gate/test/record-output.test.ts`

- [ ] **Step 1: Write the failing test** — `packages/context-gate/test/record-output.test.ts`:

```ts
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readOverlayEvents, readOverlaySummary } from "@megasaver/stats";
import { afterEach, describe, expect, it } from "vitest";
import { recordAndFilterOverlayOutput } from "../src/record-output.js";

const WK = "0123456789abcdef";
const SID = "live-sess-1";

let root: string;
afterEach(() => {
  root = "";
});

function store(): string {
  root = mkdtempSync(join(tmpdir(), "ms-record-"));
  return root;
}

describe("recordAndFilterOverlayOutput", () => {
  it("compresses a large buffer, records an overlay event keyed by (wk, liveSessionId), stores a recoverable chunk", async () => {
    const storeRoot = store();
    const raw = `line ${"x".repeat(40)}\n`.repeat(2000); // ~84 KB > safe budget
    const res = await recordAndFilterOverlayOutput({
      storeRoot,
      workspaceKey: WK,
      liveSessionId: SID,
      raw,
      sourceKind: "command",
      label: "echo big",
      mode: "aggressive",
      storeRawOutput: true,
    });
    expect(res.decision).toBe("compressed");
    expect(res.returnedBytes).toBeLessThan(res.rawBytes);
    expect(res.bytesSaved).toBeGreaterThan(0);
    expect(res.chunkSetId).toBeTypeOf("string");

    const summary = readOverlaySummary({ root: storeRoot }, WK, SID);
    expect(summary?.eventsTotal).toBe(1);
    expect(summary?.bytesSavedTotal).toBe(res.bytesSaved);
    const events = readOverlayEvents({ root: storeRoot }, WK, SID);
    expect(events).toHaveLength(1);
    expect(events[0]?.liveSessionId).toBe(SID);
    expect(events[0]?.workspaceKey).toBe(WK);
    expect(events[0]?.sourceKind).toBe("command");

    // raw recoverable: the stored chunk set file exists under content/<wk>/<sid>/
    const chunkPath = join(storeRoot, "content", WK, SID, `${res.chunkSetId}.json`);
    const chunk = JSON.parse(readFileSync(chunkPath, "utf8"));
    expect(chunk.chunks.length).toBeGreaterThan(0);
  });

  it("passes through (no event, no chunk) when output is below the mode budget", async () => {
    const storeRoot = store();
    const res = await recordAndFilterOverlayOutput({
      storeRoot,
      workspaceKey: WK,
      liveSessionId: SID,
      raw: "small output\n",
      sourceKind: "command",
      label: "echo small",
      mode: "safe",
      storeRawOutput: true,
    });
    expect(res.decision).toBe("passthrough");
    expect(res.chunkSetId).toBeUndefined();
    expect(readOverlaySummary({ root: storeRoot }, WK, SID)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (module not found):
`pnpm --filter @megasaver/context-gate exec vitest run test/record-output.test.ts`

- [ ] **Step 3: Implement `packages/context-gate/src/record-output.ts`:**

```ts
import { randomUUID } from "node:crypto";
import {
  type FilterDecision,
  type FilterOutputResult,
  type OutputSourceKind,
  filterOutput,
} from "@megasaver/output-filter";
import { type TokenSaverMode, modeToBudget } from "@megasaver/shared";
import { appendOverlayEvent } from "@megasaver/stats";
import { persistOverlayChunkSet } from "./read.js";

export type RecordOverlayOutputInput = {
  storeRoot: string;
  workspaceKey: string;
  liveSessionId: string;
  raw: string;
  sourceKind: OutputSourceKind;
  label: string;
  mode: TokenSaverMode;
  storeRawOutput: boolean;
  now?: () => string;
  newId?: () => string;
};

export type RecordOverlayOutputResult = {
  decision: FilterDecision;
  summary: string;
  returnedText: string;
  rawBytes: number;
  returnedBytes: number;
  bytesSaved: number;
  savingRatio: number;
  chunkSetId?: string;
};

function redactedCount(warnings: readonly string[]): number {
  for (const w of warnings) {
    const m = /^redacted (\d+) secret/.exec(w);
    if (m?.[1] !== undefined) return Number(m[1]);
  }
  return 0;
}

function returnedTextOf(result: FilterOutputResult): string {
  return [result.summary, ...result.excerpts.map((e) => e.text)].join("\n");
}

// Filter an already-produced output buffer (no re-execution, no path gating —
// the output is the tool's own trusted result), record the overlay event keyed
// by (workspaceKey, liveSessionId), and store the raw as a recoverable chunk so
// the agent can expand it. Returns "passthrough" with no side effects when
// filterOutput decides the buffer is small enough to keep whole.
export async function recordAndFilterOverlayOutput(
  input: RecordOverlayOutputInput,
): Promise<RecordOverlayOutputResult> {
  const now = input.now ?? (() => new Date().toISOString());
  const newId = input.newId ?? (() => randomUUID());

  const filtered = filterOutput({
    raw: input.raw,
    mode: input.mode,
    maxReturnedBytes: modeToBudget(input.mode),
  });

  const base = {
    decision: filtered.decision,
    summary: filtered.summary,
    returnedText: returnedTextOf(filtered),
    rawBytes: filtered.rawBytes,
    returnedBytes: filtered.returnedBytes,
    bytesSaved: filtered.bytesSaved,
    savingRatio: filtered.savingRatio,
  };
  if (filtered.decision !== "compressed") return base;

  const createdAt = now();
  let chunkSetId: string | undefined;
  if (input.storeRawOutput) {
    chunkSetId = newId();
    await persistOverlayChunkSet({
      storeRoot: input.storeRoot,
      chunkSetId,
      workspaceKey: input.workspaceKey,
      liveSessionId: input.liveSessionId,
      createdAt,
      path: input.label,
      result: filtered,
    });
  }

  appendOverlayEvent({
    store: { root: input.storeRoot },
    event: {
      id: newId(),
      liveSessionId: input.liveSessionId,
      workspaceKey: input.workspaceKey,
      createdAt,
      sourceKind: input.sourceKind,
      label: input.label,
      rawBytes: filtered.rawBytes,
      returnedBytes: filtered.returnedBytes,
      bytesSaved: filtered.bytesSaved,
      savingRatio: filtered.savingRatio,
      ...(chunkSetId !== undefined ? { chunkSetId } : {}),
      summary: filtered.summary,
      mode: input.mode,
    },
    secretsRedacted: redactedCount(filtered.warnings ?? []),
    chunksStored: chunkSetId !== undefined ? filtered.excerpts.length : 0,
  });

  return { ...base, ...(chunkSetId !== undefined ? { chunkSetId } : {}) };
}
```

> Verify while implementing: `FilterDecision` is exported from `@megasaver/output-filter` (it is referenced in `types.ts`); if its export name differs, import the correct one or inline `"passthrough" | "compressed" | ...`. `readOverlaySummary`/`readOverlayEvents` take `(store: {root}, workspaceKey, liveSessionId)`.

- [ ] **Step 4: Export from `packages/context-gate/src/index.ts`** — add:
```ts
export {
  recordAndFilterOverlayOutput,
  type RecordOverlayOutputInput,
  type RecordOverlayOutputResult,
} from "./record-output.js";
```

- [ ] **Step 5: Run — expect PASS:** `pnpm --filter @megasaver/context-gate test`

- [ ] **Step 6: Commit:**
```bash
git add packages/context-gate/src/record-output.ts packages/context-gate/src/index.ts packages/context-gate/test/record-output.test.ts
git commit -m "feat(context-gate): recordAndFilterOverlayOutput for live overlay stats"
```

---

## Task 2: CLI `mega hooks saver` PostToolUse hook

**Files:**
- Create: `apps/cli/src/hooks/saver.ts`, `apps/cli/src/hooks/saver-run.ts`, `apps/cli/src/commands/hooks/saver.ts`
- Modify: `apps/cli/src/commands/hooks/index.ts`
- Test: `apps/cli/test/hooks/saver.test.ts`

> Build context-gate first so the CLI import resolves: `pnpm --filter @megasaver/context-gate build`.

- [ ] **Step 1: Write the failing test** — `apps/cli/test/hooks/saver.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { buildSaverDecision } from "../../src/hooks/saver.js";

const RECORDED = {
  decision: "compressed" as const,
  summary: "SUMMARY",
  returnedText: "SHORT",
  rawBytes: 100_000,
  returnedBytes: 200,
  bytesSaved: 99_800,
  savingRatio: 0.998,
  chunkSetId: "cs-1",
};

function deps(overrides: Partial<Parameters<typeof buildSaverDecision>[1]> = {}) {
  return {
    storeRoot: "/store",
    readSettings: () => ({ enabled: true, mode: "balanced" as const }),
    record: vi.fn().mockResolvedValue(RECORDED),
    ...overrides,
  };
}

const bigBash = (text: string) => ({
  tool_name: "Bash",
  tool_input: { command: "echo big" },
  tool_output: { stdout: text, stderr: "", interrupted: false, isImage: false },
  session_id: "live-1",
  cwd: "/Users/x/proj",
});

describe("buildSaverDecision", () => {
  it("compresses an eligible large Bash output and preserves the output shape", async () => {
    const d = deps();
    const out = await buildSaverDecision(bigBash("X".repeat(50_000)), d);
    expect("updatedToolOutput" in out).toBe(true);
    if ("updatedToolOutput" in out) {
      const u = out.updatedToolOutput as { stdout: string; stderr: string; isImage: boolean };
      expect(u.stdout).toContain("SHORT");
      expect(u.stdout).toContain("cs-1"); // expand pointer
      expect(u.stderr).toBe(""); // other fields preserved
      expect(u.isImage).toBe(false);
    }
    expect(d.record).toHaveBeenCalledOnce();
  });

  it("passes through when Saver Mode is disabled", async () => {
    const out = await buildSaverDecision(
      bigBash("X".repeat(50_000)),
      deps({ readSettings: () => ({ enabled: false, mode: "balanced" }) }),
    );
    expect(out).toEqual({ passthrough: true });
  });

  it("passes through ineligible tools (Write)", async () => {
    const out = await buildSaverDecision(
      { tool_name: "Write", tool_output: { content: "x", isError: false }, session_id: "s", cwd: "/p" },
      deps(),
    );
    expect(out).toEqual({ passthrough: true });
  });

  it("passes through small output (below budget)", async () => {
    const out = await buildSaverDecision(bigBash("tiny"), deps());
    expect(out).toEqual({ passthrough: true });
  });

  it("passes through an unknown output shape", async () => {
    const out = await buildSaverDecision(
      { tool_name: "Bash", tool_output: { weird: 1 }, session_id: "s", cwd: "/p" },
      deps(),
    );
    expect(out).toEqual({ passthrough: true });
  });

  it("passes through a malformed payload without throwing", async () => {
    await expect(buildSaverDecision(null, deps())).resolves.toEqual({ passthrough: true });
    await expect(buildSaverDecision({ tool_name: "Bash" }, deps())).resolves.toEqual({
      passthrough: true,
    });
  });

  it("compresses a Read output (content string shape)", async () => {
    const out = await buildSaverDecision(
      {
        tool_name: "Read",
        tool_input: { file_path: "/p/big.txt" },
        tool_output: { content: "Y".repeat(50_000), isError: false },
        session_id: "live-1",
        cwd: "/p",
      },
      deps(),
    );
    expect("updatedToolOutput" in out).toBe(true);
    if ("updatedToolOutput" in out) {
      const u = out.updatedToolOutput as { content: string; isError: boolean };
      expect(u.content).toContain("SHORT");
      expect(u.isError).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module not found):
`pnpm --filter @megasaver/cli exec vitest run test/hooks/saver.test.ts`

- [ ] **Step 3: Implement `apps/cli/src/hooks/saver.ts`:**

```ts
import type {
  RecordOverlayOutputInput,
  RecordOverlayOutputResult,
} from "@megasaver/context-gate";
import type { OutputSourceKind } from "@megasaver/output-filter";
import { type TokenSaverMode, encodeWorkspaceKey, modeToBudget } from "@megasaver/shared";

// PostToolUse processes the OUTPUT of these read/observe tools. Write/Edit and
// MCP tools are skipped (nothing to read-compress / already proxied).
const TOOL_SOURCE: Record<string, OutputSourceKind> = {
  Read: "file",
  LS: "file",
  Bash: "command",
  Grep: "grep",
  Glob: "grep",
};

export type SaverSettings = { enabled: boolean; mode: TokenSaverMode };

export type SaverDeps = {
  storeRoot: string;
  readSettings: (storeRoot: string, workspaceKey: string) => SaverSettings | null;
  record: (input: RecordOverlayOutputInput) => Promise<RecordOverlayOutputResult>;
};

export type SaverDecision = { updatedToolOutput: unknown } | { passthrough: true };

const PASSTHROUGH: SaverDecision = { passthrough: true };

// Reads the text payload out of a Claude Code tool_output and returns a
// rebuilder that swaps it for compressed text while preserving every other
// field (so the emitted shape always matches the tool's original schema).
// Unknown shapes ⇒ null ⇒ caller passes through (original output preserved).
type Shaped = { raw: string; rebuild: (text: string) => Record<string, unknown> };
function readOutputShape(toolOutput: unknown): Shaped | null {
  if (typeof toolOutput !== "object" || toolOutput === null) return null;
  const o = toolOutput as Record<string, unknown>;
  if (typeof o.stdout === "string") return { raw: o.stdout, rebuild: (t) => ({ ...o, stdout: t }) };
  if (typeof o.content === "string") {
    return { raw: o.content, rebuild: (t) => ({ ...o, content: t }) };
  }
  if (Array.isArray(o.content)) {
    const raw = o.content
      .map((b) =>
        typeof b === "object" && b !== null && typeof (b as { text?: unknown }).text === "string"
          ? (b as { text: string }).text
          : "",
      )
      .join("\n");
    if (raw.length === 0) return null;
    return { raw, rebuild: (t) => ({ ...o, content: [{ type: "text", text: t }] }) };
  }
  return null;
}

function asStr(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function labelOf(toolInput: unknown, fallback: string): string {
  if (typeof toolInput !== "object" || toolInput === null) return fallback;
  const i = toolInput as Record<string, unknown>;
  return asStr(i.file_path) ?? asStr(i.path) ?? asStr(i.command) ?? asStr(i.pattern) ?? fallback;
}

// Pure decision: never throws (callers rely on this), returns passthrough on any
// gate miss. `deps` are injected so tests need no fs/store.
export async function buildSaverDecision(
  payload: unknown,
  deps: SaverDeps,
): Promise<SaverDecision> {
  try {
    if (typeof payload !== "object" || payload === null) return PASSTHROUGH;
    const p = payload as Record<string, unknown>;
    const tool = asStr(p.tool_name);
    const sessionId = asStr(p.session_id);
    const cwd = asStr(p.cwd);
    if (tool === undefined || sessionId === undefined || cwd === undefined) return PASSTHROUGH;

    const sourceKind = TOOL_SOURCE[tool];
    if (sourceKind === undefined) return PASSTHROUGH;

    const workspaceKey = encodeWorkspaceKey(cwd);
    const settings = deps.readSettings(deps.storeRoot, workspaceKey);
    if (settings === null || !settings.enabled) return PASSTHROUGH;

    const shape = readOutputShape(p.tool_output);
    if (shape === null) return PASSTHROUGH;
    if (Buffer.byteLength(shape.raw, "utf8") <= modeToBudget(settings.mode)) return PASSTHROUGH;

    const recorded = await deps.record({
      storeRoot: deps.storeRoot,
      workspaceKey,
      liveSessionId: sessionId,
      raw: shape.raw,
      sourceKind,
      label: labelOf(p.tool_input, tool),
      mode: settings.mode,
      storeRawOutput: true,
    });
    if (recorded.decision !== "compressed") return PASSTHROUGH;

    const pointer = recorded.chunkSetId
      ? `\n\n[Mega Saver: compressed ${recorded.rawBytes}→${recorded.returnedBytes} B. Full output stored — expand chunk ${recorded.chunkSetId} via proxy_expand_chunk / mega_fetch_chunk.]`
      : "";
    return { updatedToolOutput: shape.rebuild(`${recorded.returnedText}${pointer}`) };
  } catch {
    return PASSTHROUGH; // §13.4 best-effort: never break the tool call.
  }
}
```

- [ ] **Step 4: Run the test — expect PASS:** `pnpm --filter @megasaver/cli exec vitest run test/hooks/saver.test.ts`

- [ ] **Step 5: Implement the stdin wrapper `apps/cli/src/hooks/saver-run.ts`:**

```ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { recordAndFilterOverlayOutput } from "@megasaver/context-gate";
import { tokenSaverModeSchema } from "@megasaver/shared";
import { z } from "zod";
import { readStoreEnv, resolveStorePath } from "../store.js";
import { type SaverDeps, type SaverSettings, buildSaverDecision } from "./saver.js";

const settingsSchema = z.object({ enabled: z.boolean(), mode: tokenSaverModeSchema });

// Reads the GUI-written activation file: <storeRoot>/stats/<wk>/workspace-token-saver.json.
function readSettings(storeRoot: string, workspaceKey: string): SaverSettings | null {
  const path = join(storeRoot, "stats", workspaceKey, "workspace-token-saver.json");
  if (!existsSync(path)) return null;
  try {
    const parsed = settingsSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    return parsed.success ? { enabled: parsed.data.enabled, mode: parsed.data.mode } : null;
  } catch {
    return null;
  }
}

function readStdinSync(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

// Always exits 0. On any failure emits nothing → the model keeps the original
// tool output (PostToolUse "no JSON" = no change). Never blocks the tool call.
export async function runSaverHookFromProcess(): Promise<void> {
  process.exitCode = 0;
  try {
    const raw = readStdinSync().trim();
    if (raw === "") return;
    const payload: unknown = JSON.parse(raw);
    const storeRoot = resolveStorePath(readStoreEnv(undefined));
    const deps: SaverDeps = { storeRoot, readSettings, record: recordAndFilterOverlayOutput };
    const decision = await buildSaverDecision(payload, deps);
    if ("updatedToolOutput" in decision) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PostToolUse",
            updatedToolOutput: decision.updatedToolOutput,
          },
        }),
      );
    }
  } catch {
    // Swallow — best-effort; original output reaches the model.
  }
}
```

> `resolveStorePath`/`readStoreEnv` are exported from `apps/cli/src/store.ts` (`readStoreEnv(undefined)` → `ResolveStorePathInput`; `resolveStorePath(...)` → store dir). Confirm both are exported (they are).

- [ ] **Step 6: Implement the command `apps/cli/src/commands/hooks/saver.ts`:**

```ts
import { defineCommand } from "citty";
import { runSaverHookFromProcess } from "../../hooks/saver-run.js";

// The command Claude Code's PostToolUse hook invokes. Reads the tool result on
// stdin, compresses large native output when Saver Mode is on, and emits an
// updatedToolOutput. SAFETY: ALWAYS exits 0; emits nothing on any error so the
// original output is preserved. Wired by `mega hooks install`, not run by hand.
export const hooksSaverCommand = defineCommand({
  meta: {
    name: "saver",
    description: "Internal: compress a Claude Code PostToolUse tool result (stdin payload).",
  },
  async run() {
    await runSaverHookFromProcess();
  },
});
```

- [ ] **Step 7: Register in `apps/cli/src/commands/hooks/index.ts`** — add the import + export + subcommand:
```ts
import { hooksSaverCommand } from "./saver.js";
```
add `export { hooksSaverCommand } from "./saver.js";` and in `subCommands`: `saver: hooksSaverCommand,`.

- [ ] **Step 8: Typecheck + lint + test:**
```
pnpm --filter @megasaver/cli exec tsc -b --noEmit
pnpm --filter @megasaver/cli exec biome check src/hooks/saver.ts src/hooks/saver-run.ts src/commands/hooks/saver.ts src/commands/hooks/index.ts test/hooks/saver.test.ts
pnpm --filter @megasaver/cli exec vitest run test/hooks/saver.test.ts
```
All green.

- [ ] **Step 9: Commit:**
```bash
git add apps/cli/src/hooks/saver.ts apps/cli/src/hooks/saver-run.ts apps/cli/src/commands/hooks/saver.ts apps/cli/src/commands/hooks/index.ts apps/cli/test/hooks/saver.test.ts
git commit -m "feat(cli): mega hooks saver PostToolUse compression hook"
```

---

## Task 3: Installer adds the PostToolUse entry

**Files:**
- Modify: `apps/cli/src/commands/hooks/install.ts`
- Test: `apps/cli/test/hooks/install.test.ts`

- [ ] **Step 1: Write the failing test** — append to `apps/cli/test/hooks/install.test.ts` (read it first to match its existing imports/helpers; it already exercises `installClaudeCodeHook` with a temp `--settings` path):

```ts
import { existsSync, readFileSync } from "node:fs";
// ... reuse the file's existing temp-settings setup ...

it("installs BOTH the PreToolUse log hook and the PostToolUse saver hook", () => {
  const settingsPath = /* temp path from existing beforeEach */ tmpSettingsPath();
  installClaudeCodeHook({ settingsPath });
  const s = JSON.parse(readFileSync(settingsPath, "utf8"));
  const pre = s.hooks.PreToolUse.flatMap((e: { hooks: { command: string }[] }) => e.hooks);
  const post = s.hooks.PostToolUse.flatMap((e: { hooks: { command: string }[] }) => e.hooks);
  expect(pre.some((h: { command: string }) => h.command === "mega hooks log")).toBe(true);
  expect(post.some((h: { command: string }) => h.command === "mega hooks saver")).toBe(true);
});

it("is idempotent across both hooks (re-install is a no-op)", () => {
  const settingsPath = tmpSettingsPath();
  installClaudeCodeHook({ settingsPath });
  const first = readFileSync(settingsPath, "utf8");
  const result = installClaudeCodeHook({ settingsPath });
  expect(result.changed).toBe(false);
  expect(readFileSync(settingsPath, "utf8")).toBe(first);
});
```

> Adapt `tmpSettingsPath()` to however the existing test creates its temp settings path. Keep the existing PreToolUse tests passing unchanged.

- [ ] **Step 2: Run — expect FAIL:** `pnpm --filter @megasaver/cli exec vitest run test/hooks/install.test.ts`

- [ ] **Step 3: Extend `install.ts`** — add PostToolUse constants + pure helpers mirroring the PreToolUse ones, and make install add both:

```ts
export const SAVER_HOOK_COMMAND = "mega hooks saver";
export const SAVER_HOOK_MATCHER = "Read|Bash|Grep|Glob|LS";

type PostToolUseEntry = { matcher?: string; hooks?: CommandHook[] };

export function hasPostToolUseHook(settings: unknown, command: string): boolean {
  if (typeof settings !== "object" || settings === null) return false;
  const post = (settings as SettingsObject).hooks?.PostToolUse;
  return Array.isArray(post) && post.some((e) => entryReferencesCommand(e, command));
}

export function addPostToolUseHook(settings: unknown, command: string): SettingsObject {
  const next = asSettings(settings);
  if (hasPostToolUseHook(next, command)) return next;
  const hooks = next.hooks ? { ...next.hooks } : {};
  const existingPost = (hooks as { PostToolUse?: unknown }).PostToolUse;
  const post = Array.isArray(existingPost) ? [...(existingPost as PostToolUseEntry[])] : [];
  post.push({ matcher: SAVER_HOOK_MATCHER, hooks: [{ type: "command", command }] });
  next.hooks = { ...hooks, PostToolUse: post };
  return next;
}
```

Add `PostToolUse?: unknown` to the `SettingsObject.hooks` type. Then change `installClaudeCodeHook` so it adds both and reports `changed` if EITHER was added:

```ts
export function installClaudeCodeHook(
  input: InstallClaudeCodeHookInput,
): InstallClaudeCodeHookResult {
  const command = input.command ?? DEFAULT_HOOK_COMMAND;
  const existing = readSettings(input.settingsPath);
  const alreadyPre = hasPreToolUseHook(existing, command);
  const alreadyPost = hasPostToolUseHook(existing, SAVER_HOOK_COMMAND);
  if (alreadyPre && alreadyPost) {
    return { settingsPath: input.settingsPath, changed: false };
  }
  let next = addPreToolUseHook(existing, command);
  next = addPostToolUseHook(next, SAVER_HOOK_COMMAND);
  mkdirSync(dirname(input.settingsPath), { recursive: true });
  writeFileSync(input.settingsPath, `${JSON.stringify(next, null, 2)}\n`);
  return { settingsPath: input.settingsPath, changed: true };
}
```

Export the new helpers from `commands/hooks/index.ts` alongside the PreToolUse ones if other code/tests import them.

- [ ] **Step 4: Run — expect PASS (new + existing):** `pnpm --filter @megasaver/cli exec vitest run test/hooks/install.test.ts`

- [ ] **Step 5: Commit:**
```bash
git add apps/cli/src/commands/hooks/install.ts apps/cli/test/hooks/install.test.ts
git commit -m "feat(cli): install the PostToolUse saver hook alongside telemetry"
```

---

## Task 4: Changeset, wiki, verify, manual smoke

**Files:**
- Create: `.changeset/realized-saver-hook.md`
- Modify: `wiki/entities/cli.md`, `wiki/entities/context-gate.md`, `wiki/log.md`

- [ ] **Step 1: Changeset** — `.changeset/realized-saver-hook.md`:
```markdown
---
"@megasaver/cli": minor
"@megasaver/context-gate": minor
---

Realize Saver Mode on native tool output: a `mega hooks saver` PostToolUse hook
compresses large Read/Bash/Grep/Glob/LS output (evidence-preserving, raw stored
for expand), feeds the model the compressed result via updatedToolOutput, and
records per-session overlay events that populate the live GUI tab. Gated on the
Saver Mode toggle + mode budget; never blocks (exit 0; any error ⇒ original
output). Adds context-gate `recordAndFilterOverlayOutput`.
```

- [ ] **Step 2: Wiki** — `entities/cli.md`: note the new `mega hooks saver` PostToolUse hook + that `mega hooks install` now installs both PreToolUse (telemetry) and PostToolUse (saver). `entities/context-gate.md`: add `recordAndFilterOverlayOutput`. `log.md`: append a `## [2026-06-15] feature | realized Saver Mode PostToolUse hook` entry (what + why: wires the previously-unbuilt overlay-stats producer; keyed by session_id+cwd; evidence-preserving; gated).

- [ ] **Step 3: Full verify** — `pnpm build && pnpm verify` → EXIT 0.

- [ ] **Step 4: Manual smoke** (real hook, no Claude session needed):
```bash
# enable Saver Mode for a temp cwd via the GUI bridge OR write the settings file directly,
# then pipe a synthetic PostToolUse payload:
WK=$(node -e 'const{encodeWorkspaceKey}=require("@megasaver/shared");console.log(encodeWorkspaceKey("/tmp/smoke"))')
mkdir -p "$HOME/.local/share/megasaver/stats/$WK"
echo '{"enabled":true,"mode":"aggressive","updatedAt":"2026-06-15T00:00:00.000Z"}' \
  > "$HOME/.local/share/megasaver/stats/$WK/workspace-token-saver.json"
node -e 'process.stdout.write(JSON.stringify({tool_name:"Bash",tool_input:{command:"x"},tool_output:{stdout:"L".repeat(50000),stderr:"",interrupted:false,isImage:false},session_id:"smoke-sess",cwd:"/tmp/smoke"}))' \
  | node apps/cli/dist/cli.js hooks saver
# Expect: stdout = {"hookSpecificOutput":{"hookEventName":"PostToolUse","updatedToolOutput":{"stdout":"...SHORT...expand chunk...","stderr":"","interrupted":false,"isImage":false}}}
ls "$HOME/.local/share/megasaver/stats/$WK/"   # smoke-sess.json + smoke-sess.events.jsonl now exist
```
Confirm exit code is 0. Disabled case: set `enabled:false`, re-pipe → stdout empty, exit 0.

- [ ] **Step 5: Commit:**
```bash
git add .changeset/realized-saver-hook.md wiki/entities/cli.md wiki/entities/context-gate.md wiki/log.md
git commit -m "chore(cli): changeset + wiki for realized Saver Mode hook"
```

---

## Post-implementation

Per §12 HIGH: external review with `code-reviewer` AND `critic` (separate, author ≠ reviewer), focused on the safety path (never-block, unknown-shape passthrough, evidence-preserving + raw recoverable, secret redaction). Then `superpowers:finishing-a-development-branch`. Note: the exact `updatedToolOutput` per-tool shape is confirmed for Bash (`{stdout,stderr,interrupted,isImage}`) and Read (`{content,isError}`); the shape adapter swaps the text field in place and passes through unknown shapes, so a real-Claude smoke (open the GUI Token saver tab → run a big Bash command → rows appear, output shows the compressed marker) is the final evidence.
```
