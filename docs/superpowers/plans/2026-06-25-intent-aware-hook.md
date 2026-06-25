# Intent-Aware Hook (Phase 6b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture the user's latest prompt via a `UserPromptSubmit` hook and use it as the ranking intent for PostToolUse-captured native output when no explicit intent is present (fill-gap).

**Architecture:** A new `UserPromptSubmit` hook writes the latest prompt to `<storeRoot>/stats/<workspaceKey>/session-intent.json`. The PostToolUse saver path (`buildSaverDecision`) reads it and threads `intent` into `recordAndFilterOverlayOutput` → `filterOutput` → `scoreChunk`. The daemon `/excerpt` path carries the same `intent` field. `workspaceKey` parity is guaranteed by both sides calling the existing `encodeWorkspaceKey(cwd)`.

**Tech Stack:** TypeScript (ESM, strict, `exactOptionalPropertyTypes`), Zod boundaries, Vitest, Citty CLI, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-06-25-intent-aware-hook-design.md`

**Risk:** MEDIUM (§12). Reviewer: `code-reviewer`. Ranking *input* changes only; `scoreChunk`/weights untouched. If a task forces a `scoreChunk`/weights edit, STOP and re-classify HIGH.

**Key convention:** With `exactOptionalPropertyTypes`, never assign `undefined` to an optional property. Use the conditional-spread idiom already in the codebase: `...(x !== undefined ? { key: x } : {})`.

---

## File Map

**Create:**
- `apps/cli/src/hooks/intent-run.ts` — writer (`captureIntent`, `runIntentHookFromProcess`) + reader (`readSessionIntent`, `intentFilePath`).
- `apps/cli/src/commands/hooks/intent.ts` — `mega hooks intent` Citty command.
- `apps/cli/test/hooks/intent-run.test.ts` — writer/reader tests.
- `packages/context-gate/test/record-output-intent.test.ts` — intent-threading test (mocks `filterOutput`).
- `.changeset/intent-aware-hook.md` — changeset.

**Modify:**
- `packages/context-gate/src/record-output.ts` — add `intent?` to `RecordOverlayOutputInput`; thread into `filterOutput` call.
- `packages/daemon/src/handlers.ts` — add optional `intent` to `excerptRequestSchema`.
- `packages/daemon/test/handlers.test.ts` — excerpt-accepts-intent test.
- `apps/cli/src/hooks/saver.ts` — add `readSessionIntent` to `SaverDeps`; fill-gap inject `intent` into `deps.record({...})`.
- `apps/cli/src/hooks/saver-run.ts` — wire real `readSessionIntent` into `SaverDeps`.
- `apps/cli/test/hooks/saver.test.ts` — fill-gap precedence tests.
- `apps/cli/src/commands/hooks/index.ts` — register `intent` subcommand + export.
- `packages/connectors/claude-code/src/hook-settings.ts` — `INTENT_HOOK_COMMAND`, `has/addUserPromptSubmitHook`, wire into install/uninstall.
- `packages/connectors/claude-code/test/hook-settings.test.ts` — UserPromptSubmit hook tests.
- `apps/cli/src/commands/hooks/install.ts` — update success message.

---

## Task 1: Thread `intent` through `recordAndFilterOverlayOutput`

**Files:**
- Modify: `packages/context-gate/src/record-output.ts` (type at `:35`, `filterOutput` call at `:91`)
- Test: `packages/context-gate/test/record-output-intent.test.ts` (create)

- [ ] **Step 1: Write the failing test**

`packages/context-gate/test/record-output-intent.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

// Mock filterOutput to a passthrough decision so recordAndFilterOverlayOutput
// returns early (record-output.ts:106) with NO filesystem side effects, while we
// assert the exact arg it was called with.
vi.mock("@megasaver/output-filter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@megasaver/output-filter")>();
  return {
    ...actual,
    filterOutput: vi.fn(() => ({
      decision: "passthrough" as const,
      summary: "",
      excerpts: [],
      rawBytes: 2,
      returnedBytes: 2,
      bytesSaved: 0,
      savingRatio: 0,
    })),
  };
});

import { filterOutput } from "@megasaver/output-filter";
import { recordAndFilterOverlayOutput } from "../src/record-output.js";

const base = {
  storeRoot: "/unused-passthrough",
  workspaceKey: "0000000000000000",
  liveSessionId: "s",
  raw: "hi",
  sourceKind: "file" as const,
  label: "x",
  mode: "safe" as const,
  storeRawOutput: false,
};

describe("recordAndFilterOverlayOutput intent threading", () => {
  it("forwards intent to filterOutput when set", async () => {
    vi.mocked(filterOutput).mockClear();
    await recordAndFilterOverlayOutput({ ...base, intent: "fix the parser" });
    expect(vi.mocked(filterOutput)).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "fix the parser" }),
    );
  });

  it("omits the intent key when not set", async () => {
    vi.mocked(filterOutput).mockClear();
    await recordAndFilterOverlayOutput(base);
    const arg = vi.mocked(filterOutput).mock.calls[0]?.[0] ?? {};
    expect("intent" in arg).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/context-gate test -- record-output-intent`
Expected: FAIL — `intent` is not a property of `RecordOverlayOutputInput` (type error) and/or `filterOutput` called without `intent`.

- [ ] **Step 3: Add `intent?` to the input type**

In `packages/context-gate/src/record-output.ts`, in `RecordOverlayOutputInput` (starts `:35`), add after `storeRawOutput: boolean;`:

```ts
  // Ranking hint passed to filterOutput. Optional: when absent, ranking is
  // generic (today's behavior). The hook path fills it from the captured
  // session prompt; proxy tools already pass their own explicit intent.
  intent?: string;
```

- [ ] **Step 4: Thread it into the `filterOutput` call**

Replace the `filterOutput({...})` call (currently `:91`–`:95`):

```ts
  const filtered = filterOutput({
    raw: input.raw,
    mode: input.mode,
    maxReturnedBytes: modeToBudget(input.mode),
  });
```

with:

```ts
  const filtered = filterOutput({
    raw: input.raw,
    mode: input.mode,
    maxReturnedBytes: modeToBudget(input.mode),
    ...(input.intent !== undefined ? { intent: input.intent } : {}),
  });
```

(`filterOutputInputSchema` already accepts `intent: z.string().min(1).optional()` — `packages/output-filter/src/types.ts:32`. The reader in Task 3 guarantees a non-empty string, so `min(1)` never trips.)

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @megasaver/context-gate test -- record-output-intent`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/context-gate/src/record-output.ts packages/context-gate/test/record-output-intent.test.ts
git commit -m "feat(context-gate): thread optional intent into overlay filter"
```

---

## Task 2: Accept `intent` in the daemon `/excerpt` schema

**Files:**
- Modify: `packages/daemon/src/handlers.ts` (`excerptRequestSchema` at `:22`)
- Test: `packages/daemon/test/handlers.test.ts`

- [ ] **Step 1: Write the failing test**

Open `packages/daemon/test/handlers.test.ts`, find the existing passing `excerptHandler` test and its valid request body (it already constructs a valid `workspaceKey`/`liveSessionId`). Add, in the same `describe`:

```ts
it("accepts an optional intent field (strict schema passthrough)", async () => {
  // Reuse the same valid body the existing excerpt test uses; tiny raw stays
  // passthrough so no chunk storage runs.
  const res = await excerptHandler(storeRoot, {
    ...validExcerptBody, // the body object the existing test already defines
    raw: "hi",
    intent: "find the bug",
  });
  expect(res.status).toBe(200);
});
```

If the existing test inlines its body instead of naming it, copy that inline object here and add `intent: "find the bug"` + `raw: "hi"`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/daemon test -- handlers`
Expected: FAIL — `excerptRequestSchema` is `.strict()` and rejects the unknown `intent` key → `res.status` is `400`, not `200`.

- [ ] **Step 3: Add `intent` to the schema**

In `packages/daemon/src/handlers.ts`, `excerptRequestSchema` (`:22`–`:32`), add one line before `.strict()`:

```ts
const excerptRequestSchema = z
  .object({
    workspaceKey: workspaceKeySchema,
    liveSessionId: liveSessionIdSchema,
    raw: z.string(),
    sourceKind: outputSourceKindSchema,
    label: z.string(),
    mode: tokenSaverModeSchema,
    storeRawOutput: z.boolean(),
    intent: z.string().min(1).optional(),
  })
  .strict();
```

No handler-body change: `excerptHandler` already spreads `...parsed.data` into `recordAndFilterOverlayOutput` (`:43`), so `intent` flows through automatically.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/daemon test -- handlers`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/daemon/src/handlers.ts packages/daemon/test/handlers.test.ts
git commit -m "feat(daemon): accept optional intent on /excerpt"
```

---

## Task 3: Intent capture writer + reader module

**Files:**
- Create: `apps/cli/src/hooks/intent-run.ts`
- Test: `apps/cli/test/hooks/intent-run.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/cli/test/hooks/intent-run.test.ts`:

```ts
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { captureIntent, intentFilePath, readSessionIntent } from "../../src/hooks/intent-run.js";

let storeRoot: string;
const cwd = "/some/project";
const wk = encodeWorkspaceKey(cwd);

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "intent-"));
});
afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

describe("captureIntent", () => {
  it("writes {prompt, ts} to the workspace-keyed file", () => {
    captureIntent(storeRoot, { prompt: "fix the parser", cwd }, () => 123);
    const raw = readFileSync(intentFilePath(storeRoot, wk), "utf8");
    expect(JSON.parse(raw)).toEqual({ prompt: "fix the parser", ts: 123 });
  });

  it("writes nothing for an empty/whitespace prompt", () => {
    captureIntent(storeRoot, { prompt: "   ", cwd }, () => 1);
    expect(existsSync(intentFilePath(storeRoot, wk))).toBe(false);
  });

  it("writes nothing for a malformed payload", () => {
    captureIntent(storeRoot, { nope: true }, () => 1);
    expect(existsSync(intentFilePath(storeRoot, wk))).toBe(false);
  });
});

describe("readSessionIntent", () => {
  it("returns undefined when the file is missing", () => {
    expect(readSessionIntent(storeRoot, wk)).toBeUndefined();
  });

  it("returns the prompt for a valid file", () => {
    captureIntent(storeRoot, { prompt: "add logging", cwd }, () => 1);
    expect(readSessionIntent(storeRoot, wk)).toBe("add logging");
  });

  it("returns undefined for malformed JSON", () => {
    writeFileSync(intentFilePath(storeRoot, wk), "{ not json", "utf8");
    expect(readSessionIntent(storeRoot, wk)).toBeUndefined();
  });

  it("returns undefined for an empty stored prompt", () => {
    writeFileSync(intentFilePath(storeRoot, wk), JSON.stringify({ prompt: "", ts: 1 }), "utf8");
    expect(readSessionIntent(storeRoot, wk)).toBeUndefined();
  });
});
```

Note: the "malformed JSON" test writes to `intentFilePath` whose parent dir was created by an earlier `captureIntent`; in tests that run it standalone, add `mkdirSync(dirname(path), { recursive: true })` first — or rely on the preceding valid-file test in the same `beforeEach` group. To be safe, create the dir in the two `writeFileSync` tests:
```ts
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
mkdirSync(dirname(intentFilePath(storeRoot, wk)), { recursive: true });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/cli test -- intent-run`
Expected: FAIL — `../../src/hooks/intent-run.js` does not exist.

- [ ] **Step 3: Write the implementation**

`apps/cli/src/hooks/intent-run.ts`:

```ts
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { z } from "zod";
import { readStoreEnv, resolveStorePath } from "../store.js";

const intentFileSchema = z.object({ prompt: z.string(), ts: z.number() });
const payloadSchema = z.object({ prompt: z.string(), cwd: z.string().min(1) });

export function intentFilePath(storeRoot: string, workspaceKey: string): string {
  return join(storeRoot, "stats", workspaceKey, "session-intent.json");
}

export function readSessionIntent(storeRoot: string, workspaceKey: string): string | undefined {
  const path = intentFilePath(storeRoot, workspaceKey);
  if (!existsSync(path)) return undefined;
  try {
    const parsed = intentFileSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    if (!parsed.success) return undefined;
    const prompt = parsed.data.prompt.trim();
    return prompt === "" ? undefined : prompt;
  } catch {
    return undefined;
  }
}

// Atomic write (tmp + rename): the file is read by a separate process (the saver
// hook / daemon); a reader must never see a half-written file.
function writeIntentFile(storeRoot: string, workspaceKey: string, prompt: string, ts: number): void {
  const path = intentFilePath(storeRoot, workspaceKey);
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${randomUUID()}.tmp`);
  try {
    writeFileSync(tmp, `${JSON.stringify({ prompt, ts })}\n`);
    renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

// Pure-ish core: parse payload, derive the SAME workspaceKey the saver hook reads
// with (encodeWorkspaceKey(cwd)), write latest-wins. Exported for tests.
export function captureIntent(
  storeRoot: string,
  payload: unknown,
  now: () => number = Date.now,
): void {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return;
  const prompt = parsed.data.prompt.trim();
  if (prompt === "") return;
  writeIntentFile(storeRoot, encodeWorkspaceKey(parsed.data.cwd), prompt, now());
}

function readStdinSync(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

// The command Claude Code's UserPromptSubmit hook invokes. ALWAYS exits 0; on any
// failure writes nothing so the prompt is never blocked. Wired by `mega hooks install`.
export function runIntentHookFromProcess(): void {
  process.exitCode = 0;
  try {
    const raw = readStdinSync().trim();
    if (raw === "") return;
    const payload: unknown = JSON.parse(raw);
    const storeRoot = resolveStorePath(readStoreEnv(undefined));
    captureIntent(storeRoot, payload);
  } catch {
    // best-effort; never block the prompt.
  }
}
```

(Confirm the import path `../store.js` exports `readStoreEnv` and `resolveStorePath` — it is the same import `saver-run.ts:11` uses.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/cli test -- intent-run`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/hooks/intent-run.ts apps/cli/test/hooks/intent-run.test.ts
git commit -m "feat(cli): session-intent capture writer + reader"
```

---

## Task 4: `mega hooks intent` command + registration

**Files:**
- Create: `apps/cli/src/commands/hooks/intent.ts`
- Modify: `apps/cli/src/commands/hooks/index.ts`
- Test: `apps/cli/test/hooks/intent-command.test.ts` (create)

- [ ] **Step 1: Write the failing test**

`apps/cli/test/hooks/intent-command.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { hooksCommand } from "../../src/commands/hooks/index.js";

describe("hooks command group", () => {
  it("registers the intent subcommand", () => {
    expect(hooksCommand.subCommands).toHaveProperty("intent");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/cli test -- intent-command`
Expected: FAIL — `subCommands` has no `intent`.

- [ ] **Step 3: Create the command**

`apps/cli/src/commands/hooks/intent.ts`:

```ts
import { defineCommand } from "citty";
import { runIntentHookFromProcess } from "../../hooks/intent-run.js";

// The command Claude Code's UserPromptSubmit hook invokes. Reads the prompt
// payload on stdin and records it as the session intent for ranking. SAFETY:
// ALWAYS exits 0; writes nothing on any error. Wired by `mega hooks install`.
export const hooksIntentCommand = defineCommand({
  meta: {
    name: "intent",
    description: "Internal: record the latest Claude Code prompt as ranking intent (stdin payload).",
  },
  run() {
    runIntentHookFromProcess();
  },
});
```

- [ ] **Step 4: Register it**

In `apps/cli/src/commands/hooks/index.ts`:

Add the import (with the other command imports):
```ts
import { hooksIntentCommand } from "./intent.js";
```
Add the export (with the other command re-exports):
```ts
export { hooksIntentCommand } from "./intent.js";
```
Add to `subCommands` in `hooksCommand` (after `saver: hooksSaverCommand,`):
```ts
    intent: hooksIntentCommand,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @megasaver/cli test -- intent-command`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/commands/hooks/intent.ts apps/cli/src/commands/hooks/index.ts apps/cli/test/hooks/intent-command.test.ts
git commit -m "feat(cli): mega hooks intent command"
```

---

## Task 5: Fill-gap injection in `buildSaverDecision`

**Files:**
- Modify: `apps/cli/src/hooks/saver.ts` (`SaverDeps` type + record call at `:159`)
- Modify: `apps/cli/src/hooks/saver-run.ts` (`:99` deps wiring)
- Test: `apps/cli/test/hooks/saver.test.ts`

- [ ] **Step 1: Write the failing test**

In `apps/cli/test/hooks/saver.test.ts`, add a `describe` block. Reuse the existing helpers in that file for a valid PostToolUse payload and the over-budget raw shape (the existing saver tests already build these). The new tests inject a fake `record` that captures its input and a fake `readSessionIntent`:

```ts
import { buildSaverDecision } from "../../src/hooks/saver.js";
// ... existing imports

describe("buildSaverDecision intent fill-gap", () => {
  // validPayload: a PostToolUse payload whose tool_response.raw exceeds the
  //   budget so compression runs (copy the one the existing saver tests use).
  // makeDeps(over): builds SaverDeps with readSettings -> {enabled:true, mode:"safe"},
  //   a record that resolves a compressed RecordOverlayOutputResult, and the
  //   overridable readSessionIntent.

  it("sets intent from readSessionIntent when present", async () => {
    let captured: { intent?: string } | undefined;
    const deps = {
      storeRoot: "/store",
      readSettings: () => ({ enabled: true, mode: "safe" as const }),
      readSessionIntent: () => "refactor the auth module",
      record: async (input: { intent?: string }) => {
        captured = input;
        return {
          decision: "compressed" as const,
          summary: "s",
          returnedText: "s",
          rawBytes: 10_000,
          returnedBytes: 100,
          bytesSaved: 9_900,
          savingRatio: 0.99,
          chunkSetId: "c1",
        };
      },
    };
    await buildSaverDecision(validPayload, deps as never);
    expect(captured?.intent).toBe("refactor the auth module");
  });

  it("omits intent when readSessionIntent returns undefined", async () => {
    let captured: Record<string, unknown> | undefined;
    const deps = {
      storeRoot: "/store",
      readSettings: () => ({ enabled: true, mode: "safe" as const }),
      readSessionIntent: () => undefined,
      record: async (input: Record<string, unknown>) => {
        captured = input;
        return {
          decision: "compressed" as const,
          summary: "s",
          returnedText: "s",
          rawBytes: 10_000,
          returnedBytes: 100,
          bytesSaved: 9_900,
          savingRatio: 0.99,
          chunkSetId: "c1",
        };
      },
    };
    await buildSaverDecision(validPayload, deps as never);
    expect(captured && "intent" in captured).toBe(false);
  });
});
```

If `saver.test.ts` does not already expose a `validPayload`/deps factory, build the payload inline: `{ tool_name: "Read", session_id: "s", cwd: "/p", tool_input: { file_path: "/p/a.ts" }, tool_response: { content: "X".repeat(50_000) } }` (the `content` string must exceed `modeToBudget("safe")`).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/cli test -- saver.test`
Expected: FAIL — `SaverDeps` has no `readSessionIntent` (type error), and the record input has no `intent`.

- [ ] **Step 3: Add `readSessionIntent` to `SaverDeps`**

In `apps/cli/src/hooks/saver.ts`, find the `SaverDeps` type (it has `storeRoot`, `readSettings`, `record`). Add:

```ts
  readSessionIntent: (storeRoot: string, workspaceKey: string) => string | undefined;
```

- [ ] **Step 4: Fill-gap inject in `buildSaverDecision`**

In `apps/cli/src/hooks/saver.ts`, immediately after `const workspaceKey = encodeWorkspaceKey(cwd);` (`:150`) add:

```ts
    const sessionIntent = deps.readSessionIntent(deps.storeRoot, workspaceKey);
```

Then in the `deps.record({ ... })` call (`:159`), add the conditional-spread line after `storeRawOutput: true,`:

```ts
      storeRawOutput: true,
      ...(sessionIntent !== undefined ? { intent: sessionIntent } : {}),
```

(Fill-gap: the hook path never sets an explicit intent, so this is the only intent source here. `exactOptionalPropertyTypes` requires the conditional spread, never `intent: sessionIntent` directly.)

- [ ] **Step 5: Wire the real reader in `saver-run.ts`**

In `apps/cli/src/hooks/saver-run.ts`, add the import:

```ts
import { readSessionIntent } from "./intent-run.js";
```

Change the deps construction (`:99`) from:

```ts
    const deps: SaverDeps = { storeRoot, readSettings, record: makeRecord(storeRoot) };
```

to:

```ts
    const deps: SaverDeps = {
      storeRoot,
      readSettings,
      record: makeRecord(storeRoot),
      readSessionIntent,
    };
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @megasaver/cli test -- saver`
Expected: PASS (new fill-gap tests + existing saver/saver-run tests still green — the existing tests must now also pass a `readSessionIntent` in their deps; if any existing test constructs `SaverDeps` inline it needs `readSessionIntent: () => undefined` added. Fix those inline.)

- [ ] **Step 7: Commit**

```bash
git add apps/cli/src/hooks/saver.ts apps/cli/src/hooks/saver-run.ts apps/cli/test/hooks/saver.test.ts
git commit -m "feat(cli): fill-gap session intent into saver hook ranking"
```

---

## Task 6: Install/uninstall the `UserPromptSubmit` hook

**Files:**
- Modify: `packages/connectors/claude-code/src/hook-settings.ts`
- Modify: `apps/cli/src/commands/hooks/install.ts` (message at `:38`)
- Test: `packages/connectors/claude-code/test/hook-settings.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/connectors/claude-code/test/hook-settings.test.ts`, add:

```ts
import {
  INTENT_HOOK_COMMAND,
  addUserPromptSubmitHook,
  hasUserPromptSubmitHook,
  installClaudeCodeHook,
} from "../src/hook-settings.js"; // align with the file's existing import style

describe("UserPromptSubmit intent hook", () => {
  it("adds a UserPromptSubmit hook idempotently", () => {
    const once = addUserPromptSubmitHook({}, INTENT_HOOK_COMMAND);
    expect(hasUserPromptSubmitHook(once, INTENT_HOOK_COMMAND)).toBe(true);
    const twice = addUserPromptSubmitHook(once, INTENT_HOOK_COMMAND);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it("install writes all three hooks", () => {
    // Reuse the test's existing tmp settingsPath helper.
    const settingsPath = makeTempSettingsPath(); // existing helper in this file
    installClaudeCodeHook({ settingsPath });
    const written = JSON.parse(readFileSync(settingsPath, "utf8"));
    expect(hasUserPromptSubmitHook(written, INTENT_HOOK_COMMAND)).toBe(true);
  });
});
```

(Match the existing test file's helpers for temp settings paths and imports; the assertions above are the new behavior.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/connector-claude-code test -- hook-settings`
Expected: FAIL — `INTENT_HOOK_COMMAND` / `addUserPromptSubmitHook` / `hasUserPromptSubmitHook` are not exported.

- [ ] **Step 3: Add the constant + helpers**

In `packages/connectors/claude-code/src/hook-settings.ts`, near the other command constants (`:46`–`:49`):

```ts
export const INTENT_HOOK_COMMAND = "mega hooks intent";
```

Add the helpers (UserPromptSubmit entries carry NO matcher — unlike PreToolUse/PostToolUse):

```ts
export function hasUserPromptSubmitHook(settings: unknown, command: string): boolean {
  if (typeof settings !== "object" || settings === null) return false;
  const ups = (settings as SettingsObject).hooks?.UserPromptSubmit;
  return Array.isArray(ups) && ups.some((e) => entryReferencesCommand(e, command));
}

export function addUserPromptSubmitHook(settings: unknown, command: string): SettingsObject {
  const next = asSettings(settings);
  if (hasUserPromptSubmitHook(next, command)) return next;
  const hooks = next.hooks ? { ...next.hooks } : {};
  const existing = hooks.UserPromptSubmit;
  const ups = Array.isArray(existing) ? [...(existing as ToolUseEntry[])] : [];
  ups.push({ hooks: [{ type: "command", command }] });
  next.hooks = { ...hooks, UserPromptSubmit: ups };
  return next;
}
```

Add `UserPromptSubmit?: unknown;` to the `SettingsObject` `hooks` type (`:53`–`:55`):

```ts
type SettingsObject = {
  hooks?: { PreToolUse?: unknown; PostToolUse?: unknown; UserPromptSubmit?: unknown; [key: string]: unknown };
  [key: string]: unknown;
};
```

- [ ] **Step 4: Wire into install/uninstall**

In `installClaudeCodeHook` (`:25`), extend the idempotency check and the add chain:

```ts
export function installClaudeCodeHook(input: InstallClaudeCodeHookInput): ClaudeCodeHookResult {
  const command = input.command ?? DEFAULT_HOOK_COMMAND;
  const existing = readSettings(input.settingsPath);
  if (
    hasPreToolUseHook(existing, command) &&
    hasPostToolUseHook(existing, SAVER_HOOK_COMMAND) &&
    hasUserPromptSubmitHook(existing, INTENT_HOOK_COMMAND)
  ) {
    return { settingsPath: input.settingsPath, changed: false };
  }
  let next = addPreToolUseHook(existing, command);
  next = addPostToolUseHook(next, SAVER_HOOK_COMMAND);
  next = addUserPromptSubmitHook(next, INTENT_HOOK_COMMAND);
  writeSettings(input.settingsPath, next);
  return { settingsPath: input.settingsPath, changed: true };
}
```

In `uninstallClaudeCodeHook`, mirror however it removes PostToolUse/PreToolUse: add a `removeUserPromptSubmitHook` step for `INTENT_HOOK_COMMAND`, following the existing remove-helper pattern in the file. (Read the uninstall body first; replicate its remove idiom for `UserPromptSubmit`.)

- [ ] **Step 5: Update the install success message**

In `apps/cli/src/commands/hooks/install.ts` (`:38`), update the "Installed" string:

```ts
        ? `Installed Claude Code Mega Saver hooks (PreToolUse telemetry + PostToolUse saver + UserPromptSubmit intent) at ${result.settingsPath}`
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @megasaver/connector-claude-code test -- hook-settings`
Expected: PASS (new + existing; if an existing "install writes exactly N hooks" assertion exists, update its expected shape to include UserPromptSubmit).

- [ ] **Step 7: Commit**

```bash
git add packages/connectors/claude-code/src/hook-settings.ts apps/cli/src/commands/hooks/install.ts packages/connectors/claude-code/test/hook-settings.test.ts
git commit -m "feat(connector-claude-code): install UserPromptSubmit intent hook"
```

---

## Task 7: Changeset, full verify, smoke evidence

**Files:**
- Create: `.changeset/intent-aware-hook.md`

- [ ] **Step 1: Add the changeset**

`.changeset/intent-aware-hook.md`:

```md
---
"@megasaver/cli": minor
"@megasaver/context-gate": minor
"@megasaver/daemon": minor
"@megasaver/connector-claude-code": minor
---

Intent-aware hook (Phase 6b): a UserPromptSubmit hook captures the latest prompt
and fills it as the ranking intent for PostToolUse-captured native output when no
explicit intent is present (fill-gap). Daemon /excerpt accepts an optional intent.
```

- [ ] **Step 2: Run the full DoD gate**

Run: `pnpm verify`
Expected: PASS — `biome check`, `tsc -b --noEmit`, `vitest run` all green.

If lint flags the pre-existing untracked cruft files (`.claire/`, `.omc/`, etc.) unrelated to this branch, confirm they are not part of this change and out of scope — do not "fix" them here.

- [ ] **Step 3: Smoke evidence (DoD #5 — CLI feature)**

Capture a terminal session proving the loop end to end:

```bash
# 1. install hooks into a throwaway settings file, show all three present
node apps/cli/dist/index.js hooks install claude-code --settings /tmp/ms-settings.json --json
cat /tmp/ms-settings.json   # expect PreToolUse + PostToolUse + UserPromptSubmit

# 2. simulate UserPromptSubmit capture
echo '{"prompt":"fix the auth bug","cwd":"/tmp/proj"}' | node apps/cli/dist/index.js hooks intent
# show the written intent file (workspaceKey = encodeWorkspaceKey("/tmp/proj"))
cat "$MEGASAVER_STORE/stats/"*/session-intent.json   # expect {"prompt":"fix the auth bug","ts":...}
```

(Build first: `pnpm --filter @megasaver/cli build`. Use the store path the CLI resolves; print it if unsure.)

- [ ] **Step 4: Commit**

```bash
git add .changeset/intent-aware-hook.md
git commit -m "chore: changeset for intent-aware hook"
```

- [ ] **Step 5: Code review (DoD #6)**

Dispatch `code-reviewer` (fresh context, author ≠ reviewer) on the branch diff. Address findings via `superpowers:receiving-code-review`. Required because risk is MEDIUM.

- [ ] **Step 6: Verifier pass (DoD #7)**

Run `omc:verify` (or the `verifier` agent) against the spec's success criteria + smoke evidence.

---

## Self-Review (filled)

**Spec coverage:**
- Capture hook (UserPromptSubmit) → Task 3 (writer) + Task 4 (command) + Task 6 (install).
- Shared `workspaceKey` (`encodeWorkspaceKey`) → Task 3 (writer uses it) + already used by `buildSaverDecision` (Task 5 reads with same key).
- Reader `readSessionIntent` → Task 3.
- Fill-gap injection → Task 5.
- Daemon schema passthrough → Task 2 (+ Task 1 type so it compiles).
- Install → Task 6.
- Error/boundary (missing/malformed/empty → undefined; node:path) → Task 3 tests.
- Risk/changeset/verify/review → Task 7.

**Placeholder scan:** No TBD/TODO. The two "reuse the existing test fixture" notes (Task 2 valid body, Task 5 valid payload, Task 6 temp-settings helper) point at concrete existing fixtures and include an inline fallback — not placeholders.

**Type consistency:** `readSessionIntent(storeRoot, workspaceKey) => string | undefined` identical in Task 3 (def), Task 5 (`SaverDeps` + call), Task 5 wiring. `intent?: string` consistent across `RecordOverlayOutputInput` (Task 1), `excerptRequestSchema` `intent: z.string().min(1).optional()` (Task 2), `filterOutputInputSchema` (existing). `INTENT_HOOK_COMMAND = "mega hooks intent"` matches the `mega hooks intent` command name (Task 4) and install message (Task 6). Conditional-spread idiom used everywhere `intent` is optionally set (`exactOptionalPropertyTypes`).
