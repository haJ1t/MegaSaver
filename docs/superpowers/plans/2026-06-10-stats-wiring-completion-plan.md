# Stats Wiring Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every `runOutputPipeline` run appends a `TokenSaverEvent` (mirroring the exec path), and `mega session saver stats` reads the real stats store instead of printing the stale BB6 stub.

**Architecture:** Gap A wires `appendEvent` into the file-read orchestrator (`packages/context-gate/src/run.ts`) and widens `RunOutputResult` with `store_write_failed`; exhaustive switches force the three consumers (CLI `output file`/`output filter`, MCP `read-file`) to map the new reason — all three mapping helpers already exist. Gap B adds `@megasaver/stats` to the CLI and replaces the `BB6_NOTICE` stub with `readSummary`.

**Tech Stack:** TypeScript strict ESM, Vitest, pnpm workspaces, Zod. Spec: `docs/superpowers/specs/2026-06-10-stats-wiring-completion-design.md`.

**Worktree:** `/Users/halitozger/Desktop/MegaSaver/.worktrees/stats-wiring`, branch `feat/stats-wiring-completion`. Run all commands from the worktree root.

---

### Task 1: Extract shared stats helpers in context-gate

`messageOf` and `redactedCount` are private to `run-command.ts`; `run.ts` needs both. Pure move, no behavior change.

**Files:**
- Create: `packages/context-gate/src/stats-helpers.ts`
- Modify: `packages/context-gate/src/run-command.ts` (delete local defs at lines 155-160 area and 290-298; import instead)
- Test: `packages/context-gate/test/stats-helpers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/context-gate/test/stats-helpers.test.ts
import { describe, expect, it } from "vitest";
import { messageOf, redactedCount } from "../src/stats-helpers.js";

describe("redactedCount", () => {
  it("parses N from the filter's redaction warning", () => {
    expect(redactedCount(["redacted 2 secret(s) before processing"])).toBe(2);
  });
  it("returns 0 when no redaction warning is present", () => {
    expect(redactedCount(["terminated: timeout"])).toBe(0);
    expect(redactedCount([])).toBe(0);
  });
});

describe("messageOf", () => {
  it("extracts Error.message", () => {
    expect(messageOf(new Error("boom"))).toBe("boom");
  });
  it("stringifies non-Error values", () => {
    expect(messageOf("plain")).toBe("plain");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/context-gate test -- stats-helpers`
Expected: FAIL — cannot resolve `../src/stats-helpers.js`

- [ ] **Step 3: Create the module (move, don't rewrite)**

Cut `messageOf` (run-command.ts:155-ish) and `redactedCount` (run-command.ts:290-298) verbatim into:

```ts
// packages/context-gate/src/stats-helpers.ts
// Shared by run.ts and run-command.ts: stats-event plumbing helpers.

export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// The filter warning shape is "redacted N secret(s) before processing"; pull N
// back out for the stats event's secretsRedacted total.
export function redactedCount(warnings: readonly string[]): number {
  for (const w of warnings) {
    const m = /^redacted (\d+) secret/.exec(w);
    if (m?.[1] !== undefined) return Number(m[1]);
  }
  return 0;
}
```

> NOTE: copy the existing `messageOf` body from `run-command.ts` exactly — if it differs from the sketch above, the existing body wins.

In `run-command.ts`: delete both local definitions, add
`import { messageOf, redactedCount } from "./stats-helpers.js";`.
Do NOT export from `src/index.ts` (package-internal).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @megasaver/context-gate test && pnpm --filter @megasaver/context-gate typecheck`
Expected: PASS (existing exec tests stay green)

- [ ] **Step 5: Commit**

```bash
git add packages/context-gate/src/stats-helpers.ts packages/context-gate/src/run-command.ts packages/context-gate/test/stats-helpers.test.ts
git commit -m "refactor(context-gate): extract stats helpers for reuse"
```

---

### Task 2: Failing tests — runOutputPipeline appends a TokenSaverEvent

**Files:**
- Create: `packages/context-gate/test/run.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/context-gate/test/run.test.ts
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { readSummary } from "@megasaver/stats";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OrchestratorRegistry } from "../src/registry-port.js";
import { runOutputPipeline } from "../src/run.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const SESSION_ID = "22222222-2222-4222-8222-222222222222" as SessionId;
const NOW = "2026-06-10T12:00:00.000Z";
const NEW_ID = "fixed-id";

function registry(projectRoot: string, opts: { storeRawOutput?: boolean } = {}): OrchestratorRegistry {
  return {
    getSession: (id) =>
      id === SESSION_ID
        ? {
            projectId: PROJECT_ID,
            tokenSaver: {
              mode: "balanced",
              maxReturnedBytes: 12_000,
              storeRawOutput: opts.storeRawOutput ?? true,
            },
          }
        : null,
    getProject: (id) => (id === PROJECT_ID ? { rootPath: projectRoot } : null),
  };
}

describe("runOutputPipeline — stats event wiring", () => {
  let store: string;
  let projectRoot: string;
  let logPath: string;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "cg-run-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "cg-run-root-"));
    logPath = join(projectRoot, "log.txt");
    await writeFile(logPath, "line one\nerror: boom\nline three\n");
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  function run(reg: OrchestratorRegistry) {
    return runOutputPipeline({
      registry: reg,
      storeRoot: store,
      sessionId: SESSION_ID,
      path: logPath,
      intent: "find the error",
      now: () => NOW,
      newId: () => NEW_ID,
      loadPermissions: () => null,
    });
  }

  it("appends one event and updates the summary on success", async () => {
    const outcome = await run(registry(projectRoot));
    expect(outcome.ok).toBe(true);

    const eventsRaw = await readFile(
      join(store, "stats", PROJECT_ID, `${SESSION_ID}.events.jsonl`),
      "utf8",
    );
    const lines = eventsRaw.trimEnd().split("\n");
    expect(lines).toHaveLength(1);
    const event = JSON.parse(lines[0] as string);
    expect(event.sourceKind).toBe("file");
    expect(event.label).toBe(logPath);
    expect(event.sessionId).toBe(SESSION_ID);
    expect(event.mode).toBe("balanced");
    expect(event.chunkSetId).toBe(NEW_ID);
    expect(event.rawBytes).toBeGreaterThan(0);

    const summary = readSummary({ root: store }, PROJECT_ID, SESSION_ID);
    expect(summary?.eventsTotal).toBe(1);
    expect(summary?.rawBytesTotal).toBe(event.rawBytes);
  });

  it("storeRawOutput=false still appends the event, without chunkSetId", async () => {
    const outcome = await run(registry(projectRoot, { storeRawOutput: false }));
    expect(outcome.ok).toBe(true);

    const eventsRaw = await readFile(
      join(store, "stats", PROJECT_ID, `${SESSION_ID}.events.jsonl`),
      "utf8",
    );
    const event = JSON.parse(eventsRaw.trimEnd());
    expect(event.chunkSetId).toBeUndefined();
    expect(readSummary({ root: store }, PROJECT_ID, SESSION_ID)?.eventsTotal).toBe(1);
  });

  it("stats write failure → store_write_failed (not a throw)", async () => {
    // Plant a FILE at <store>/stats so appendEvent's mkdirSync(recursive) throws.
    await writeFile(join(store, "stats"), "not a directory");
    const outcome = await run(registry(projectRoot));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("store_write_failed");
  });

  it("chunkSet write failure → store_write_failed (not a throw)", async () => {
    // Plant a FILE at <store>/content so saveChunkSet's mkdir throws.
    await writeFile(join(store, "content"), "not a directory");
    const outcome = await run(registry(projectRoot));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("store_write_failed");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @megasaver/context-gate test -- run.test`
Expected: FAIL — first two tests ENOENT on `.events.jsonl` (no event written today); failure tests throw raw errors / typecheck rejects `"store_write_failed"` comparison.

- [ ] **Step 3: Commit the failing tests**

```bash
git add packages/context-gate/test/run.test.ts
git commit -m "test(context-gate): pin stats event wiring for runOutputPipeline"
```

---

### Task 3: Implement the wiring + widen RunOutputResult + consumer cases

**Files:**
- Modify: `packages/context-gate/src/run.ts`
- Modify: `apps/cli/src/commands/output/file.ts:72-88` (switch)
- Modify: `apps/cli/src/commands/output/filter.ts:80-96` (switch)
- Modify: `packages/mcp-bridge/src/tools/read-file.ts:54-75` (switch)

- [ ] **Step 1: Rewrite `run.ts` tail (persist + event)**

Replace the imports and the block after `if (!filtered.ok) ...` (lines 1-12 and 67-83) so the file becomes:

```ts
import type { FilterOutputResult } from "@megasaver/output-filter";
import type { SessionId } from "@megasaver/shared";
import { type TokenSaverEvent, appendEvent } from "@megasaver/stats";
import {
  type LoadProjectPermissions,
  defaultNewId,
  defaultNow,
  persistChunkSet,
  readAndFilter,
  resolveEffectiveSettings,
  runTwoGates,
} from "./read.js";
import type { OrchestratorRegistry } from "./registry-port.js";
import { messageOf, redactedCount } from "./stats-helpers.js";
```

`RunOutputResult` union gains one member (after `file_read_failed`):

```ts
  | { ok: false; reason: "file_read_failed"; detail: string }
  | { ok: false; reason: "store_write_failed"; detail: string };
```

Tail of `runOutputPipeline` (replacing lines 67-82):

```ts
  const now = input.now ?? defaultNow;
  const newId = input.newId ?? defaultNewId;

  const result = { ...filtered.result };
  if (settings.storeRawOutput) {
    const chunkSetId = newId();
    try {
      await persistChunkSet({
        storeRoot: input.storeRoot,
        chunkSetId,
        sessionId: input.sessionId,
        projectId: settings.projectId,
        createdAt: now(),
        path: input.path,
        result: filtered.result,
      });
    } catch (err) {
      return { ok: false, reason: "store_write_failed", detail: messageOf(err) };
    }
    result.chunkSetId = chunkSetId;
  }

  const event: TokenSaverEvent = {
    id: newId(),
    sessionId: input.sessionId,
    projectId: settings.projectId,
    createdAt: now(),
    sourceKind: "file",
    label: input.path,
    rawBytes: filtered.result.rawBytes,
    returnedBytes: filtered.result.returnedBytes,
    bytesSaved: filtered.result.bytesSaved,
    savingRatio: filtered.result.savingRatio,
    ...(result.chunkSetId !== undefined ? { chunkSetId: result.chunkSetId } : {}),
    summary: filtered.result.summary,
    mode: settings.mode,
  };
  try {
    appendEvent({
      store: { root: input.storeRoot },
      event,
      secretsRedacted: redactedCount(filtered.result.warnings ?? []),
      chunksStored: filtered.result.excerpts.length,
    });
  } catch (err) {
    return { ok: false, reason: "store_write_failed", detail: messageOf(err) };
  }

  return { ok: true, result };
```

- [ ] **Step 2: Run the Task 2 tests**

Run: `pnpm --filter @megasaver/context-gate test -- run.test`
Expected: PASS (all 4)

- [ ] **Step 3: Fix the consumers (typecheck forces this)**

Run: `pnpm typecheck`
Expected: errors in `file.ts`, `filter.ts`, `read-file.ts` (non-exhaustive switch → IIFE returns `CliMessage | undefined`).

`apps/cli/src/commands/output/file.ts` AND `filter.ts` — add to imports: `storeWriteFailedMessage`; add the case after `file_read_failed`:

```ts
        case "store_write_failed":
          return storeWriteFailedMessage(outcome.detail);
```

`packages/mcp-bridge/src/tools/read-file.ts` — add the case after `file_read_failed`:

```ts
    case "store_write_failed":
      throw new McpBridgeError("store_write_failed", outcome.detail, {
        cause: new Error(outcome.detail),
      });
```

- [ ] **Step 4: Verify the whole workspace compiles and tests pass**

Run: `pnpm typecheck && pnpm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/context-gate/src/run.ts apps/cli/src/commands/output/file.ts apps/cli/src/commands/output/filter.ts packages/mcp-bridge/src/tools/read-file.ts
git commit -m "feat(context-gate): append stats event in runOutputPipeline

File reads were invisible to token-saver stats; only the exec path
recorded events. Widens RunOutputResult with store_write_failed
(also wrapping the previously-unwrapped persistChunkSet throw) and
maps it in the three consumers."
```

---

### Task 4: Consumer-level regression tests for store_write_failed

**Files:**
- Modify: `apps/cli/test/output/file.test.ts`
- Modify: `apps/cli/test/output/filter.test.ts`
- Modify: `packages/mcp-bridge/test/tools/read-file.test.ts`

- [ ] **Step 1: CLI tests** — append inside the existing `describe` (harness vars `store`, `projectRoot` already exist). For `file.test.ts`:

```ts
  it("stats write failure → error: store_write_failed, exit 1", async () => {
    await seed(store, projectRoot, { storeRawOutput: false });
    const logPath = join(projectRoot, "log.txt");
    await writeFile(logPath, "hello\n");
    await writeFile(join(store, "stats"), "not a directory");

    const { out, err } = capture();
    const code = await runOutputFile({
      sessionId: SESSION_ID,
      intentFlag: "summary",
      path: logPath,
      storeFlag: store,
      cwd: projectRoot,
      home: projectRoot,
      xdgDataHome: undefined,
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      json: true,
      now: () => NOW,
      newId: () => NEW_ID,
    });

    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(err.join("\n")).toContain("error: store_write_failed:");
  });
```

For `filter.test.ts`: same test body, calling `runOutputFilter` with `fileFlag: logPath` instead of `path: logPath` (mirror that file's existing harness/arg names exactly).

- [ ] **Step 2: MCP bridge test** — append to `packages/mcp-bridge/test/tools/read-file.test.ts`:

```ts
  it("throws store_write_failed when the stats dir is unwritable", async () => {
    const registry = seededRegistry(projectRoot);
    const logPath = join(projectRoot, "log.txt");
    await writeFile(logPath, "line one\n");
    await writeFile(join(store, "stats"), "not a directory");
    await expect(
      handleReadFile(
        { registry, storeRoot: store, now: () => TS, newId: () => "x" },
        { path: logPath, intent: "read it", sessionId: SESSION_ID },
      ),
    ).rejects.toMatchObject({ code: "store_write_failed" });
  });
```

- [ ] **Step 3: Run the three suites**

Run: `pnpm --filter @megasaver/cli test -- output && pnpm --filter @megasaver/mcp-bridge test -- read-file`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/cli/test/output/file.test.ts apps/cli/test/output/filter.test.ts packages/mcp-bridge/test/tools/read-file.test.ts
git commit -m "test: pin store_write_failed mapping in pipeline consumers"
```

---

### Task 5: Failing tests — real `mega session saver stats`

**Files:**
- Modify: `apps/cli/test/session-saver.test.ts` (stats describe, lines ~488-533)

- [ ] **Step 1: Update the two stale assertions and add the events-recorded case**

In the `describe("stats", ...)` block:

(a) Replace the `"configured session text → settings line + literal BB6 sentence"` test:

```ts
    it("configured session, no events → settings line + 'No events recorded yet.'", async () => {
      await seed();
      await enable({ mode: "balanced" });
      const { out, code } = await stats();
      expect(code).toBe(0);
      const joined = out.join("\n");
      expect(joined).toContain("balanced");
      expect(joined).toContain("12000");
      expect(joined).toContain("No events recorded yet.");
      expect(joined).not.toContain("arrive with BB6");
    });
```

(b) Add after it (imports at top of file: `import { appendEvent } from "@megasaver/stats";` plus `projectIdSchema`-style ids are plain strings in this harness — use the existing `PROJECT_ID`/`SESSION_ID` consts; check their actual names in this file and reuse them):

```ts
    function recordEvent(): void {
      appendEvent({
        store: { root: store },
        event: {
          id: "evt-1",
          sessionId: SESSION_ID,
          projectId: PROJECT_ID,
          createdAt: NOW_TS,
          sourceKind: "file",
          label: "/tmp/log.txt",
          rawBytes: 1000,
          returnedBytes: 200,
          bytesSaved: 800,
          savingRatio: 0.8,
          summary: "demo",
          mode: "balanced",
        },
        secretsRedacted: 1,
        chunksStored: 3,
      });
    }

    it("with recorded events → text totals from the summary", async () => {
      await seed();
      await enable({ mode: "balanced" });
      recordEvent();
      const { out, code } = await stats();
      expect(code).toBe(0);
      const joined = out.join("\n");
      expect(joined).toContain("events: 1");
      expect(joined).toContain("raw: 1000 B");
      expect(joined).toContain("returned: 200 B");
      expect(joined).toContain("saved: 800 B (80.0%)");
      expect(joined).toContain("secrets redacted: 1");
      expect(joined).toContain("chunks stored: 3");
    });

    it("with recorded events → --json carries the full summary", async () => {
      await seed();
      await enable({ mode: "balanced" });
      recordEvent();
      const { out, code } = await stats({ json: true });
      expect(code).toBe(0);
      const payload = JSON.parse(out[0] as string);
      expect(payload.eventStats).toMatchObject({
        sessionId: SESSION_ID,
        eventsTotal: 1,
        rawBytesTotal: 1000,
        returnedBytesTotal: 200,
        bytesSavedTotal: 800,
        savingRatio: 0.8,
        secretsRedactedTotal: 1,
        chunksStoredTotal: 3,
      });
    });
```

> NOTE: the harness's project id const may be named differently (check the top of `session-saver.test.ts`); if the seeded project id isn't exported as `PROJECT_ID`, reuse whatever const seeds `projects.json`. `NOW_TS` is the existing fixed timestamp const. The `"configured session JSON → eventStats: null"` test stays valid (no events recorded) — keep it.

- [ ] **Step 2: Run to verify the new/changed tests fail**

Run: `pnpm --filter @megasaver/cli test -- session-saver`
Expected: FAIL — text still prints the BB6 sentence; `eventStats` still hardcoded null; `appendEvent` import fails until the dep lands (Task 6 Step 1 adds it — if the import itself blocks the failing-test run, add the dep first, then confirm the assertions fail).

- [ ] **Step 3: Commit the failing tests**

```bash
git add apps/cli/test/session-saver.test.ts
git commit -m "test(cli): pin real saver stats readout (BB6 stub retired)"
```

---

### Task 6: Implement real `mega session saver stats`

**Files:**
- Modify: `apps/cli/package.json` (dependencies)
- Modify: `apps/cli/src/commands/session/saver/stats.ts`

- [ ] **Step 1: Add the dependency**

In `apps/cli/package.json` dependencies (alphabetical position):

```json
    "@megasaver/stats": "workspace:*",
```

Run: `pnpm install`

- [ ] **Step 2: Rewrite the command body**

In `stats.ts`: delete `const BB6_NOTICE = ...`; add imports:

```ts
import { type SessionTokenSaverStats, readSummary } from "@megasaver/stats";
```

Replace the body of the final `try` block (lines 55-81) with:

```ts
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);
    const session = registry.getSession(parsedSessionId);
    if (!session) {
      const cli = sessionNotFoundMessage(parsedSessionId);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    const ts = session.tokenSaver;
    const eventStats: SessionTokenSaverStats | null = readSummary(
      { root: rootDir },
      session.projectId,
      parsedSessionId,
    );
    if (input.json) {
      input.stdout(
        JSON.stringify({ sessionId: parsedSessionId, tokenSaver: ts ?? null, eventStats }),
      );
      return 0;
    }
    if (!ts) {
      input.stdout(
        `Mega Saver Mode not configured for ${parsedSessionId} — run: mega session saver enable ${parsedSessionId} --mode <mode>`,
      );
      return 0;
    }
    input.stdout(
      `Mega Saver Mode ${ts.enabled ? "enabled" : "disabled"} for ${parsedSessionId} (${ts.mode}; ${ts.maxReturnedBytes} B)`,
    );
    if (!eventStats) {
      input.stdout("No events recorded yet.");
      return 0;
    }
    const pct = (eventStats.savingRatio * 100).toFixed(1);
    input.stdout(
      `events: ${eventStats.eventsTotal} | raw: ${eventStats.rawBytesTotal} B | returned: ${eventStats.returnedBytesTotal} B | saved: ${eventStats.bytesSavedTotal} B (${pct}%)`,
    );
    input.stdout(
      `secrets redacted: ${eventStats.secretsRedactedTotal} | chunks stored: ${eventStats.chunksStoredTotal} | updated: ${eventStats.updatedAt}`,
    );
    return 0;
```

(`StatsError("store_corrupt")` from `readSummary` propagates to the existing outer `catch` → `mapErrorToCliMessage` → text stderr, exit 1 — matches the `--json` failure-path policy.)

- [ ] **Step 3: Run the suite**

Run: `pnpm --filter @megasaver/cli test -- session-saver`
Expected: PASS (incl. the pre-AA / not-configured / read-only tests — JSON `eventStats` is `null` for them since no events exist)

- [ ] **Step 4: Commit**

```bash
git add apps/cli/package.json pnpm-lock.yaml apps/cli/src/commands/session/saver/stats.ts
git commit -m "feat(cli): real session saver stats from the stats store

Retires the BB6_NOTICE stub: text mode renders summary totals,
--json fills eventStats with SessionTokenSaverStats | null.
Intentional byte-compat break on the text path (stale notice)."
```

---

### Task 7: Full verify + smoke evidence

- [ ] **Step 1: Workspace gate**

Run: `pnpm verify`
Expected: lint + typecheck + all tests green. Fix anything that surfaces before proceeding (biome may reformat — run `pnpm lint:fix` if it flags style).

- [ ] **Step 2: Smoke (real CLI against a temp store)**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/stats-wiring
pnpm build
STORE=$(mktemp -d)
ROOT=$(mktemp -d)
printf 'line one\nerror: boom\nline three\n' > "$ROOT/log.txt"
node apps/cli/dist/index.mjs project create demo --root "$ROOT" --store "$STORE" --json
SESSION=$(node apps/cli/dist/index.mjs session create demo --agent claude-code --store "$STORE" --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
node apps/cli/dist/index.mjs session saver enable "$SESSION" --mode balanced --store "$STORE"
node apps/cli/dist/index.mjs output file "$SESSION" "$ROOT/log.txt" --intent "find the error" --store "$STORE"
node apps/cli/dist/index.mjs session saver stats "$SESSION" --store "$STORE"
node apps/cli/dist/index.mjs session saver stats "$SESSION" --store "$STORE" --json
```

Expected: the stats text output shows `events: 1` and non-zero byte totals; `--json` carries `eventStats.eventsTotal: 1`. Capture this output as DoD evidence.
(Adjust the exact CLI entrypoint/flags to whatever `mega --help` in the worktree reports — e.g. if the bin is `dist/main.mjs` or `session create` takes the project as a flag, follow the real surface; the evidence requirement is the non-zero stats readout after one `output file` run.)

---

### Task 8: Changesets, wiki, docs

- [ ] **Step 1: Changesets**

Create `.changeset/stats-wiring-completion.md`:

```md
---
"@megasaver/context-gate": minor
"@megasaver/cli": minor
---

runOutputPipeline now records a TokenSaverEvent per file read
(RunOutputResult widens with store_write_failed), and
`mega session saver stats` reads the real stats store
(text totals + eventStats in --json; BB6 stub retired).
```

- [ ] **Step 2: Wiki updates** (in the worktree)

- `wiki/entities/stats.md` — Wiring status section: Gap A + Gap B closed by this PR; file-read path now appends events; CLI readout real.
- `wiki/entities/cli.md` — `mega session saver stats` section: new output shape (text totals + `eventStats`).
- `wiki/concepts/context-gate-pipeline.md` — stats stage note: wired on BOTH paths now.
- `wiki/syntheses/post-v1.1-roadmap.md` — item 3 resolved.
- `wiki/log.md` — append `## [2026-06-10] feat | stats wiring completion (PR #TBD)` entry (fill the PR number at PR-open time).

- [ ] **Step 3: Commit**

```bash
git add .changeset wiki
git commit -m "docs(wiki): stats wiring completion recorded"
```

---

### Task 9: Review + PR

- [ ] Run `superpowers:requesting-code-review` (external reviewer agent; author ≠ reviewer).
- [ ] Address findings (superpowers:receiving-code-review).
- [ ] Push branch, open PR titled `feat: complete stats wiring (file-read events + real saver stats)`, body links the spec + plan, includes smoke evidence.
- [ ] CI green → merge per `superpowers:finishing-a-development-branch`.
