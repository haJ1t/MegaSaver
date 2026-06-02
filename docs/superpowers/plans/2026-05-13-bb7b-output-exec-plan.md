# BB7b — `mega output exec` + policy-gated child-process spawn — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `mega output exec <session-id> --intent <s> -- <cmd> [args...]` — the single child-process spawn surface of the AA epic — as a thin CLI adapter over a new spawn-specialised core orchestrator that gates with `policy.evaluateCommand` BEFORE spawning, redacts via the filter BEFORE storing, and writes a chunkSet + stats event.

**Architecture:** ONE orchestrator, TWO entry points (BB7b spec §1a). Spawn + env-marker + policy-gate-ordering live in `packages/core/src/context-gate/run-command.ts`; `apps/cli/src/commands/output/exec.ts` does only arg plumbing, store resolution, session-id parse, `--intent` presence check, env-marker capture (in the `defineCommand` wrapper), and result→text/JSON+exit-code mapping. BB8's MCP `mega_run_command` (AA1 §8d) becomes the second caller of the SAME orchestrator. The CLI adapter contains NO `child_process` / `spawn` / `execFile` string (the BB7a `no-child-process.test.ts` guard covers `apps/cli/src/commands/output/`).

**Tech Stack:** TypeScript strict ESM (NodeNext), Vitest, Citty (CLI), Zod boundaries, pnpm workspaces. Packages consumed (not defined): `@megasaver/policy` (`evaluateCommand`, `PolicyDenyCode`), `@megasaver/output-filter` (`filterOutput`, `FilterOutputResult`, `OutputExcerpt`), `@megasaver/content-store` (`saveChunkSet`, `ChunkSet`), `@megasaver/stats` (`appendEvent`, `TokenSaverEvent`), `@megasaver/shared` (`modeToBudget`, `TokenSaverMode`, `sessionIdSchema`).

---

## ⚠ CRITICAL-RISK EXECUTION NOTICE (read before any task)

BB7b is **CRITICAL** risk (AA1 §15; BB7b spec frontmatter; `CLAUDE.md` §12) — the first user-visible `child_process.spawn` in Mega Saver. Per AA1 §16 (CRITICAL pipeline) and BB7b spec §10 the execution of this plan requires ALL of:

1. `architect` (opus) concept/alternatives memo BEFORE the child-spec brainstorm (HIGH chain, inherited).
2. `critic` (opus) adversarial pass AFTER `executor` implements, BEFORE `code-reviewer`.
3. `security-reviewer` sign-off report posted as a PR comment — OWASP review of the spawn path, env handling, the policy gate.
4. `tracer` pass — enumerate every branch that could spawn a child or skip the policy gate.
5. **Manual user confirmation before merge** — user replies `confirm BB7b merge` verbatim (AA1 §16, F-MAJ-6) to a message linking: verifier evidence bundle, security-reviewer report, tracer hypotheses, the child-process whitelist verification (exact `command` strings that reached `spawn()` in integration testing), and the manual real-spawn smoke output.
6. **NO `autopilot` / `ralph` / unsupervised loops at any point** (`CLAUDE.md` §12; BB7b spec §10.6).
7. **NO log compression**; Mega Saver Mode is NEVER enabled on the session that develops it — paradox guard, also enforced at runtime by the `recursive_megasaver` env-marker gate (AA1 §15; BB7b spec §10.7).

**Security invariants this plan enforces (verify in every relevant step):**

- **Deny BEFORE spawn, never spawn-then-deny.** `policy.evaluateCommand` runs at step 4; `child_process.spawn` runs at step 5. Task 5 ships a test asserting `spawn` is never invoked on any denial branch (BB7b spec §3 final paragraph, §9).
- **Env-marker set on spawn AND checked on entry.** The `defineCommand` wrapper computes `originPid` (Task 6); the orchestrator forwards it into `evaluateCommand` (check on entry) AND into the spawned child's `env.MEGASAVER_ORIGIN_PID` (set on spawn) — BB7b spec §3 steps 3–5, §4.
- **Redaction BEFORE store.** `filterOutput` redacts unconditionally as its first internal step (BB7b spec §3.6; confirmed at `packages/output-filter/src/types.ts` — `redact(raw)` runs before chunking); the orchestrator passes raw output straight to `filterOutput` and derives the `ChunkSet.redacted` flag from a `"redacted…"` warning. Secrets never reach the chunks because redaction precedes chunking inside the filter — the "redact before store" invariant (AA1 §10d, F-MAJ-3) holds. BB7b does NOT make a separate `policy.redact()` call (BB7b spec §3.6 supersedes AA1 §8d step 6).

---

## Phase 0 — Blocker confirmation & rebase (DO FIRST; no code until green)

BB7b is **BLOCKED-BY** `feat/bb7-orchestrator-extract` (PR #75) for the orchestrator helpers and the `EffectiveSettings` shape (BB7b spec §1c, §11.1, §11.6). At the time this plan was written, `main` (67d66dc) does **NOT** contain `packages/core/src/context-gate/`; the helpers (`resolveEffectiveSettings`, `runTwoGates`, `readAndFilter`, `persistChunkSet`, `defaultNow`, `defaultNewId`) live in `apps/cli/src/commands/output/shared.ts`, and `packages/core` depends only on `@megasaver/shared` + `zod`. PR #75 moves those helpers into `packages/core/src/context-gate/{read,run,types}.ts`, adds the `packages/core/src/context-gate.ts` barrel, and widens core's deps to `[content-store, output-filter, policy, shared, zod]` with a cycle-guard test at `packages/core/test/context-gate/dependency-direction.test.ts`.

- [ ] **Step 0.1: Confirm PR #75 is merged into `main`.**

Run:
```bash
git -C /Users/halitozger/Desktop/MegaSaver fetch origin main -q
git -C /Users/halitozger/Desktop/MegaSaver log origin/main --oneline -20 | grep -iE "bb7.*orchestr|orchestrator.extract|#75"
```
Expected: a commit line matching the extraction PR. If **no match**, STOP — do not start implementation. PR #75 is a hard blocker (BB7b spec §11.6); writing-plans → TDD must not begin until it lands.

- [ ] **Step 0.2: Rebase this worktree onto the updated `main`.**

Run:
```bash
git -C /Users/halitozger/Desktop/MegaSaver/.worktrees/cc-bb-plans fetch origin main -q
git -C /Users/halitozger/Desktop/MegaSaver/.worktrees/cc-bb-plans rebase origin/main
```
Expected: clean rebase (this plan touches only files PR #75 doesn't). Resolve conflicts in `docs/` if any.

- [ ] **Step 0.3: Read the landed orchestrator export shape (load-bearing contract).**

Run:
```bash
sed -n '1,80p' /Users/halitozger/Desktop/MegaSaver/.worktrees/cc-bb-plans/packages/core/src/context-gate/read.ts
sed -n '1,40p' /Users/halitozger/Desktop/MegaSaver/.worktrees/cc-bb-plans/packages/core/src/context-gate/types.ts
cat /Users/halitozger/Desktop/MegaSaver/.worktrees/cc-bb-plans/packages/core/src/context-gate.ts
```
Confirm these match the assumptions this plan is written against (verified against `origin/feat/bb7-orchestrator-extract` when authoring):
- `resolveEffectiveSettings(registry, sessionId): EffectiveSettings | null`.
- `EffectiveSettings = { projectId; projectRoot; mode; maxReturnedBytes: number | undefined; storeRawOutput }` — **NO `redactSecrets` field** (BB7b spec §3.2 correction).
- `defaultNow(): string`, `defaultNewId(): string`.
- The barrel `packages/core/src/context-gate.ts` re-exports `resolveEffectiveSettings`, `defaultNow`, `defaultNewId`.

If the landed names differ (e.g. `runCommand` vs `execCommand` already exists, or `EffectiveSettings` carries extra fields), adjust the imports/types in Tasks 1–4 to match the landed surface — the file paths and the flow stay as specced; only the imported helper names track #75 (BB7b spec §11.1). Record the confirmed signatures in the verifier evidence bundle.

- [ ] **Step 0.4: Confirm `context-hints.ts` did NOT land in #75.**

Run:
```bash
ls /Users/halitozger/Desktop/MegaSaver/.worktrees/cc-bb-plans/packages/core/src/context-gate/context-hints.ts 2>&1
```
Expected (as of authoring, against `origin/feat/bb7-orchestrator-extract`): **No such file**. Per BB7b spec §3.7 + §11.3, when `context-hints.ts` is absent BB7b **omits** `sessionHints` from the `filterOutput` call (the field is `.optional()` in `filterOutputInputSchema`, confirmed at `packages/output-filter/src/types.ts`) and files a follow-up. This plan is written for the omitted case. If `context-hints.ts` DID land, add `sessionHints: contextHints(session)` to the `filterOutput` call in Task 2 Step 3 and import `contextHints` from the barrel — otherwise leave it omitted.

---

## File-Structure Map (one responsibility per file)

**New source (2 files):**

| File | Responsibility | Max LOC (`CLAUDE.md` §8) |
|------|----------------|--------------------------|
| `packages/core/src/context-gate/run-command.ts` | Spawn-specialised orchestrator. Computes effective settings + budget, runs the policy gate, spawns the child with the env marker, captures combined stdout+stderr under timeout/max-bytes bounds, runs `filterOutput` → `saveChunkSet` → `appendEvent`, returns a typed discriminated-union result. Injects `spawn`, `now`, `newId` for testability. The ONLY spawn site in the output pipeline. | ≤ 300 |
| `apps/cli/src/commands/output/exec.ts` | Thin CLI adapter: `RunOutputExecInput`, `runOutputExec` (pure, `Promise<number>`), `outputExecCommand` (`defineCommand` wrapper that reads `process.*` incl. `MEGASAVER_ORIGIN_PID`/`process.pid` and the `--` trailing tokens via `args._`). Maps orchestrator result/errors → text/JSON + exit codes. **Contains no `child_process`/`spawn`/`execFile` string** (no-child-process guard). | ≤ 300 |

**Edited source (4 files):**

| File | Change |
|------|--------|
| `packages/core/src/context-gate.ts` (barrel) | Re-export `runOutputExecCommand` orchestrator + its input/result types. |
| `packages/core/package.json` | Add `@megasaver/stats: workspace:*` to `dependencies` (the orchestrator's stats step needs it; core does not yet depend on stats — verified against `origin/feat/bb7-orchestrator-extract`). |
| `apps/cli/src/commands/output/index.ts` | Add `exec: outputExecCommand` to `subCommands`; re-export `runOutputExec` + `RunOutputExecInput`. |
| `apps/cli/src/errors.ts` | Add `commandDeniedMessage(reason)`, `commandFailedMessage(detail)`, `storeWriteFailedMessage(detail)`. Reuse existing `intentRequiredMessage`, `sessionNotFoundMessage`, `invalidSessionIdMessage`, `mapErrorToCliMessage`. Extend, do not rewrite (BB7b spec §8). No `redactionFailedMessage` (redaction is internal to `filterOutput`). |

**New tests (3 files):**

| File | Responsibility |
|------|----------------|
| `packages/core/test/context-gate/run-command.test.ts` | Orchestrator unit tests with an injected fake `spawn` (NO real process — AA1 §12, BB7b spec §9): policy-deny-before-spawn, spawn success → filter→store→stats, child non-zero exit, timeout, max-bytes, spawn error, redaction-applied, storeRawOutput=false. |
| `apps/cli/test/output/exec.test.ts` | Full CLI command coverage with an injected fake `spawn`: intent_missing, command_denied (×3 reasons), session_not_found, spawn success (text + JSON shapes), child-mirror exit codes, store-written assertion. |
| `apps/cli/test/output/exec.recursive.test.ts` | Inherited `MEGASAVER_ORIGIN_PID !== pid` → `recursive_megasaver`, exit 1, no spawn (AA1 §14 BB7b row; BB7b spec §4, §8). |

**Edited tests (2 files):**

| File | Change |
|------|--------|
| `apps/cli/test/json-failure-paths.test.ts` | Add `runOutputExec` failure cases: intent missing, command denied, session not found (each: text stderr, empty stdout, exit ≥ 1, no JSON). |
| `packages/core/test/context-gate/dependency-direction.test.ts` | Widen the core cycle-guard allow-list to include `@megasaver/stats` (the orchestrator imports it). See Task 0-prime / contradiction note. |

**New changeset (1 file):** `.changeset/bb7b-output-exec.md` — `@megasaver/cli` minor + `@megasaver/core` minor (orchestrator re-exported = core public-API change; AA1 §9 item 9, BB7b spec §10).

**No new closed enum, no `*.test-d.ts`** (BB7b spec §8 "No new closed enum"): BB7b consumes `PolicyDenyCode`, `OutputSourceKind`, `TokenSaverMode`; defines none. No AA3 tuple pin is added (AA1 §17 lists no BB7b enum).

---

## Type contracts (defined once, referenced by every task)

`run-command.ts` defines and exports these (referenced verbatim in Tasks 1–4 and the CLI adapter):

```ts
export type RunOutputExecCommandInput = {
  registry: CoreRegistry;
  storeRoot: string;
  sessionId: SessionId;
  intent: string;
  command: string;
  args: readonly string[];
  originPid: string;          // injected by the CLI wrapper; never read from process.env here
  timeoutMs: number;          // default 300_000 supplied by the caller
  maxCaptureBytes: number;    // default 20_000_000 supplied by the caller
  now?: () => string;
  newId?: () => string;
  spawn?: SpawnFn;            // injectable for tests; defaults to node:child_process spawn
};

export type RunOutputExecResult =
  | { ok: true; result: ExecResult }
  | { ok: false; reason: "session_not_found" }
  | { ok: false; reason: "command_denied"; code: PolicyDenyCode }
  | { ok: false; reason: "command_failed"; detail: string }
  | { ok: false; reason: "store_write_failed"; detail: string };

export type ExecResult = FilterOutputResult & {
  childExitCode: number | null;          // null when killed by a bound
  terminated?: "timeout" | "max_bytes";  // set when a bound fired
};
```

`SpawnFn` is the minimal structural slice of `node:child_process`'s `spawn` this orchestrator uses (defined in Task 1 Step 3). The CLI adapter (`exec.ts`) imports `RunOutputExecResult` / `RunOutputExecCommandInput` and `runOutputExecCommand` from `@megasaver/core` and maps the union to exit codes per BB7b spec §6.

---

## ⚠ Contradiction flagged (do NOT silently resolve — confirm with reviewer)

**Core cycle-guard allow-list omits `@megasaver/stats`, but the BB7b orchestrator needs it.** The extraction PR #75 ships `packages/core/test/context-gate/dependency-direction.test.ts` with an allow-list `["@megasaver/content-store", "@megasaver/output-filter", "@megasaver/policy", "@megasaver/shared", "zod"]` AND a strict `toEqual(...)` assertion ("declares exactly the allow-listed dependencies"). BB7b's `run-command.ts` MUST import `@megasaver/stats` (BB7b spec §3 step 9, §8) — so Task 8 adds `@megasaver/stats` to `packages/core/package.json` and widens that allow-list to include it. This is a legitimate, spec-mandated widening (AA1 §3c places `stats` below `shared` and explicitly allows `core` to depend on "all packages above"), **not** a guard bypass — but because it edits a cycle-guard test authored by another PR, the `critic`/`code-reviewer` must explicitly sign off that the new dep does not close a cycle (`@megasaver/stats` depends only on `@megasaver/shared` + `@megasaver/output-filter` per AA1 §3c, never on `core`). Confirm `apps/cli` does NOT gain a direct `@megasaver/stats` dep (its `dependency-graph.test.ts` forbids it; BB7b spec §11.4 preference: consume stats only through `@megasaver/core`).

---

## Task 1: Orchestrator scaffold + `SpawnFn` injectable + policy gate (deny-before-spawn)

**Files:**
- Create: `packages/core/src/context-gate/run-command.ts`
- Test: `packages/core/test/context-gate/run-command.test.ts`

This task lands the orchestrator's first two responsibilities: resolve settings + run the policy gate, and prove `spawn` is never called when the gate denies (the load-bearing security invariant — BB7b spec §3 final paragraph, §9).

- [ ] **Step 1.1: Write the failing test — policy deny happens before spawn.**

Create `packages/core/test/context-gate/run-command.test.ts`:

```ts
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJsonDirectoryCoreRegistry, initStore } from "@megasaver/core";
import { runOutputExecCommand } from "@megasaver/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const TS = "2026-05-10T00:00:00.000Z";

async function seed(store: string, projectRoot: string): Promise<void> {
  await mkdir(store, { recursive: true });
  await writeFile(
    join(store, "projects.json"),
    JSON.stringify([
      { id: PROJECT_ID, name: "demo", rootPath: projectRoot, createdAt: TS, updatedAt: TS },
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
        tokenSaver: {
          enabled: true,
          mode: "balanced",
          maxReturnedBytes: 12_000,
          storeRawOutput: true,
          redactSecrets: true,
          autoRepair: true,
          createdAt: TS,
          updatedAt: TS,
        },
      },
    ]),
  );
}

describe("runOutputExecCommand — policy gate (deny before spawn)", () => {
  let store: string;
  let projectRoot: string;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "ms-runcmd-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "ms-runcmd-root-"));
    await seed(store, projectRoot);
    await initStore(store);
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("non-allowlisted command → command_denied:command_not_allowed and spawn is NEVER called", async () => {
    const registry = createJsonDirectoryCoreRegistry({ rootDir: store });
    const spawn = vi.fn();
    const out = await runOutputExecCommand({
      registry,
      storeRoot: store,
      sessionId: SESSION_ID as never,
      intent: "run it",
      command: "definitely-not-allowed-binary",
      args: [],
      originPid: "1234",
      timeoutMs: 300_000,
      maxCaptureBytes: 20_000_000,
      spawn: spawn as never,
    });

    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("expected denial");
    expect(out.reason).toBe("command_denied");
    if (out.reason !== "command_denied") throw new Error("narrow");
    expect(out.code).toBe("command_not_allowed");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("dangerous pattern (rm -rf /) → command_denied:dangerous_pattern, no spawn", async () => {
    const registry = createJsonDirectoryCoreRegistry({ rootDir: store });
    const spawn = vi.fn();
    const out = await runOutputExecCommand({
      registry,
      storeRoot: store,
      sessionId: SESSION_ID as never,
      intent: "run it",
      command: "rm",
      args: ["-rf", "/"],
      originPid: "1234",
      timeoutMs: 300_000,
      maxCaptureBytes: 20_000_000,
      spawn: spawn as never,
    });
    expect(out.ok).toBe(false);
    if (out.ok || out.reason !== "command_denied") throw new Error("narrow");
    expect(out.code).toBe("dangerous_pattern");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("recursive marker (originPid !== current pid) → recursive_megasaver, no spawn", async () => {
    const registry = createJsonDirectoryCoreRegistry({ rootDir: store });
    const spawn = vi.fn();
    const out = await runOutputExecCommand({
      registry,
      storeRoot: store,
      sessionId: SESSION_ID as never,
      intent: "run it",
      command: "pnpm",
      args: ["test"],
      originPid: String(process.pid + 1), // inherited from a different (parent) pid
      timeoutMs: 300_000,
      maxCaptureBytes: 20_000_000,
      spawn: spawn as never,
    });
    expect(out.ok).toBe(false);
    if (out.ok || out.reason !== "command_denied") throw new Error("narrow");
    expect(out.code).toBe("recursive_megasaver");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("unknown session → session_not_found, no spawn", async () => {
    const registry = createJsonDirectoryCoreRegistry({ rootDir: store });
    const spawn = vi.fn();
    const out = await runOutputExecCommand({
      registry,
      storeRoot: store,
      sessionId: "99999999-9999-4999-8999-999999999999" as never,
      intent: "run it",
      command: "pnpm",
      args: ["test"],
      originPid: "1234",
      timeoutMs: 300_000,
      maxCaptureBytes: 20_000_000,
      spawn: spawn as never,
    });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("expected failure");
    expect(out.reason).toBe("session_not_found");
    expect(spawn).not.toHaveBeenCalled();
  });
});
```

> Note on `evaluateCommand`'s recursive check: the shipped policy gate (`packages/policy/src/evaluate-command.ts`) compares `input.env.MEGASAVER_ORIGIN_PID` against `String(process.pid)` of the **current** process. In the orchestrator unit test the current process IS the test runner, so passing `originPid = String(process.pid + 1)` reliably triggers `recursive_megasaver` (BB7b spec §4: deny when `originPid` present, non-empty, AND `!== String(process.pid)`).

- [ ] **Step 1.2: Run the test to verify it fails.**

Run: `pnpm --filter @megasaver/core test run-command`
Expected: FAIL — `runOutputExecCommand` is not exported from `@megasaver/core` (module/export not found).

- [ ] **Step 1.3: Write the orchestrator scaffold — settings + budget + policy gate (no spawn yet).**

Create `packages/core/src/context-gate/run-command.ts`:

```ts
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawn as nodeSpawn } from "node:child_process";
import { type ChunkSet, saveChunkSet } from "@megasaver/content-store";
import { type FilterOutputResult, filterOutput } from "@megasaver/output-filter";
import { evaluateCommand, type PolicyDenyCode } from "@megasaver/policy";
import { modeToBudget, type SessionId } from "@megasaver/shared";
import { appendEvent, type TokenSaverEvent } from "@megasaver/stats";
import type { CoreRegistry } from "../registry.js";
import { defaultNewId, defaultNow, resolveEffectiveSettings } from "./read.js";

// AA1 §8a / §8d step 7: maxReturnedBytes ceiling is 2 * modeToBudget("safe").
const MAX_RETURNED_BYTES_CEILING = 2 * modeToBudget("safe"); // 64_000

// Minimal structural slice of node:child_process.spawn this orchestrator uses.
// Injectable so tests never start a real process (AA1 §12 CRITICAL; BB7b spec §9).
export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: {
    cwd: string;
    shell: false;
    stdio: ["ignore", "pipe", "pipe"];
    env: NodeJS.ProcessEnv;
  },
) => ChildProcessWithoutNullStreams;

export type RunOutputExecCommandInput = {
  registry: CoreRegistry;
  storeRoot: string;
  sessionId: SessionId;
  intent: string;
  command: string;
  args: readonly string[];
  originPid: string;
  timeoutMs: number;
  maxCaptureBytes: number;
  now?: () => string;
  newId?: () => string;
  spawn?: SpawnFn;
};

export type ExecResult = FilterOutputResult & {
  childExitCode: number | null;
  terminated?: "timeout" | "max_bytes";
};

export type RunOutputExecCommandResult =
  | { ok: true; result: ExecResult }
  | { ok: false; reason: "session_not_found" }
  | { ok: false; reason: "command_denied"; code: PolicyDenyCode }
  | { ok: false; reason: "command_failed"; detail: string }
  | { ok: false; reason: "store_write_failed"; detail: string };

export async function runOutputExecCommand(
  input: RunOutputExecCommandInput,
): Promise<RunOutputExecCommandResult> {
  const settings = resolveEffectiveSettings(input.registry, input.sessionId);
  if (settings === null) return { ok: false, reason: "session_not_found" };

  // Step 4 (AA1 §8d): policy gate BEFORE any spawn. Env marker checked on entry.
  const decision = evaluateCommand({
    command: input.command,
    args: input.args,
    project: settings.projectId,
    env: { MEGASAVER_ORIGIN_PID: input.originPid },
  });
  if (!decision.allowed) {
    return { ok: false, reason: "command_denied", code: decision.reason };
  }

  // Steps 5–10 land in Task 2/3.
  throw new Error("not implemented: spawn pipeline (Task 2)");
}
```

> The dangling `throw` is a deliberate, temporary scaffold marker removed in Task 2 Step 3 — it is never reached by the Step 1.1 tests (all four return before it). This is not a half-implementation ship: Task 2 completes the function in the same PR before any verify/merge.

- [ ] **Step 1.4: Export the orchestrator from the core barrel + index.**

Edit `packages/core/src/context-gate.ts` — append:

```ts
export {
  runOutputExecCommand,
  type RunOutputExecCommandInput,
  type RunOutputExecCommandResult,
  type ExecResult,
  type SpawnFn,
} from "./context-gate/run-command.js";
```

`packages/core/src/index.ts` already re-exports the barrel via the extraction PR (it exports `./context-gate.js`); confirm with:
```bash
grep -n "context-gate" /Users/halitozger/Desktop/MegaSaver/.worktrees/cc-bb-plans/packages/core/src/index.ts
```
If `index.ts` does NOT yet re-export `./context-gate.js`, add `export * from "./context-gate.js";` to it (the extraction PR is expected to have done this; verify against the landed #75).

- [ ] **Step 1.5: Add `@megasaver/stats` to core deps + widen the cycle-guard allow-list.**

Edit `packages/core/package.json` `dependencies` — add (keep alphabetical):
```json
"@megasaver/stats": "workspace:*",
```
Edit `packages/core/test/context-gate/dependency-direction.test.ts` — add `"@megasaver/stats"` to `ALLOWED_DEPENDENCIES` (keep alphabetical):
```ts
const ALLOWED_DEPENDENCIES = [
  "@megasaver/content-store",
  "@megasaver/output-filter",
  "@megasaver/policy",
  "@megasaver/shared",
  "@megasaver/stats",
  "zod",
];
```
Run `pnpm install` to materialise the workspace link:
```bash
pnpm --dir /Users/halitozger/Desktop/MegaSaver/.worktrees/cc-bb-plans install
```
Expected: lockfile updates; `@megasaver/stats` linked into `@megasaver/core`.

- [ ] **Step 1.6: Run the test to verify Task 1 passes.**

Run: `pnpm --filter @megasaver/core test run-command`
Expected: PASS — all four cases (command_not_allowed, dangerous_pattern, recursive_megasaver, session_not_found) return their typed denial and `spawn` was never called.

Run: `pnpm --filter @megasaver/core test dependency-direction`
Expected: PASS — core's deps still a subset and now exactly equal the widened allow-list (incl. `@megasaver/stats`).

- [ ] **Step 1.7: Commit.**

```bash
git -C /Users/halitozger/Desktop/MegaSaver/.worktrees/cc-bb-plans add packages/core/src/context-gate/run-command.ts packages/core/src/context-gate.ts packages/core/src/index.ts packages/core/package.json packages/core/test/context-gate/run-command.test.ts packages/core/test/context-gate/dependency-direction.test.ts
git -C /Users/halitozger/Desktop/MegaSaver/.worktrees/cc-bb-plans commit -m "feat(core): exec orchestrator scaffold + policy gate"
```

---

## Task 2: Orchestrator spawn + capture + filter → store → stats (happy path)

**Files:**
- Modify: `packages/core/src/context-gate/run-command.ts`
- Test: `packages/core/test/context-gate/run-command.test.ts`

Lands steps 5–10 (BB7b spec §3): spawn with the env marker, capture combined stdout+stderr in arrival order, filter (redacts internally), persist a `command`-source chunkSet, append a stats event, return `ExecResult` with `childExitCode`.

- [ ] **Step 2.1: Write the failing test — spawn success path.**

Append to `packages/core/test/context-gate/run-command.test.ts`. First add a fake-spawn factory at the top of the file (after the imports):

```ts
import { EventEmitter } from "node:events";

// Build a fake child process: emits the given stdout/stderr chunks, then
// closes with `exitCode` on the next tick. Mirrors the slice runCommand uses.
function fakeSpawn(opts: {
  stdoutChunks?: string[];
  stderrChunks?: string[];
  exitCode?: number;
  recordEnv?: (env: NodeJS.ProcessEnv) => void;
}) {
  return (_cmd: string, _args: readonly string[], options: { env: NodeJS.ProcessEnv }) => {
    opts.recordEnv?.(options.env);
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: (sig?: string) => boolean;
    };
    child.stdout = stdout;
    child.stderr = stderr;
    child.kill = () => true;
    queueMicrotask(() => {
      for (const c of opts.stdoutChunks ?? []) stdout.emit("data", Buffer.from(c));
      for (const c of opts.stderrChunks ?? []) stderr.emit("data", Buffer.from(c));
      child.emit("close", opts.exitCode ?? 0, null);
    });
    return child as never;
  };
}
```

Then the test cases:

```ts
describe("runOutputExecCommand — spawn success pipeline", () => {
  let store: string;
  let projectRoot: string;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "ms-runcmd2-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "ms-runcmd2-root-"));
    await seed(store, projectRoot);
    await initStore(store);
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("happy path: combined output → filter → store → stats; exitCode 0; chunkSet on disk", async () => {
    const registry = createJsonDirectoryCoreRegistry({ rootDir: store });
    let seenEnv: NodeJS.ProcessEnv | undefined;
    const out = await runOutputExecCommand({
      registry,
      storeRoot: store,
      sessionId: SESSION_ID as never,
      intent: "find the error",
      command: "pnpm",
      args: ["test"],
      originPid: "4242",
      timeoutMs: 300_000,
      maxCaptureBytes: 20_000_000,
      now: () => "2026-05-10T12:00:00.000Z",
      newId: () => "cs-fixed",
      spawn: fakeSpawn({
        stdoutChunks: ["line one\nerror: boom\n"],
        stderrChunks: ["warn: x\n"],
        exitCode: 0,
        recordEnv: (e) => {
          seenEnv = e;
        },
      }) as never,
    });

    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("expected ok");
    expect(out.result.childExitCode).toBe(0);
    expect(out.result.terminated).toBeUndefined();
    expect(typeof out.result.summary).toBe("string");
    expect(out.result.chunkSetId).toBe("cs-fixed");
    // env marker propagated to the child (BB7b spec §3 step 5)
    expect(seenEnv?.MEGASAVER_ORIGIN_PID).toBe("4242");

    const { readdir, readFile } = await import("node:fs/promises");
    const dir = join(store, "content", PROJECT_ID, SESSION_ID);
    const files = await readdir(dir);
    expect(files).toContain("cs-fixed.json");
    const cs = JSON.parse(await readFile(join(dir, "cs-fixed.json"), "utf8")) as {
      source: { kind: string; command: string; args: string[] };
      redacted: boolean;
    };
    expect(cs.source.kind).toBe("command");
    expect(cs.source.command).toBe("pnpm");
    expect(cs.source.args).toEqual(["test"]);

    // stats event appended + summary written
    const eventsRaw = await readFile(join(store, "stats", PROJECT_ID, `${SESSION_ID}.events.jsonl`), "utf8");
    expect(eventsRaw.trim().split("\n")).toHaveLength(1);
    const evt = JSON.parse(eventsRaw.trim()) as { sourceKind: string; mode: string };
    expect(evt.sourceKind).toBe("command");
    expect(evt.mode).toBe("balanced");
  });

  it("child non-zero exit: success output still written; childExitCode mirrors", async () => {
    const registry = createJsonDirectoryCoreRegistry({ rootDir: store });
    const out = await runOutputExecCommand({
      registry,
      storeRoot: store,
      sessionId: SESSION_ID as never,
      intent: "find it",
      command: "pnpm",
      args: ["test"],
      originPid: "1",
      timeoutMs: 300_000,
      maxCaptureBytes: 20_000_000,
      now: () => "2026-05-10T12:00:00.000Z",
      newId: () => "cs-7",
      spawn: fakeSpawn({ stdoutChunks: ["partial\n"], exitCode: 7 }) as never,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("expected ok");
    expect(out.result.childExitCode).toBe(7);
    expect(out.result.chunkSetId).toBe("cs-7");
  });

  it("redaction applied: secret-shaped output → redacted warning + chunkSet.redacted true", async () => {
    const registry = createJsonDirectoryCoreRegistry({ rootDir: store });
    const out = await runOutputExecCommand({
      registry,
      storeRoot: store,
      sessionId: SESSION_ID as never,
      intent: "find it",
      command: "pnpm",
      args: ["test"],
      originPid: "1",
      timeoutMs: 300_000,
      maxCaptureBytes: 20_000_000,
      now: () => "2026-05-10T12:00:00.000Z",
      newId: () => "cs-red",
      spawn: fakeSpawn({
        stdoutChunks: ["token=ghp_0123456789012345678901234567890123456789\n"],
        exitCode: 0,
      }) as never,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("expected ok");
    expect((out.result.warnings ?? []).some((w) => w.startsWith("redacted"))).toBe(true);

    const { readFile } = await import("node:fs/promises");
    const cs = JSON.parse(
      await readFile(join(store, "content", PROJECT_ID, SESSION_ID, "cs-red.json"), "utf8"),
    ) as { redacted: boolean; chunks: { text: string }[] };
    expect(cs.redacted).toBe(true);
    for (const chunk of cs.chunks) expect(chunk.text).not.toContain("ghp_0123456789");
  });

  it("storeRawOutput=false: exit ok, no chunkSetId, no file written", async () => {
    // Re-seed a session with storeRawOutput false.
    await writeFile(
      join(store, "sessions.json"),
      JSON.stringify([
        {
          id: SESSION_ID,
          projectId: PROJECT_ID,
          agentId: "claude-code",
          riskLevel: "medium",
          title: "demo",
          startedAt: TS,
          endedAt: null,
          tokenSaver: {
            enabled: true,
            mode: "balanced",
            maxReturnedBytes: 12_000,
            storeRawOutput: false,
            redactSecrets: true,
            autoRepair: true,
            createdAt: TS,
            updatedAt: TS,
          },
        },
      ]),
    );
    const registry = createJsonDirectoryCoreRegistry({ rootDir: store });
    const out = await runOutputExecCommand({
      registry,
      storeRoot: store,
      sessionId: SESSION_ID as never,
      intent: "find it",
      command: "pnpm",
      args: ["test"],
      originPid: "1",
      timeoutMs: 300_000,
      maxCaptureBytes: 20_000_000,
      now: () => "2026-05-10T12:00:00.000Z",
      newId: () => "cs-none",
      spawn: fakeSpawn({ stdoutChunks: ["ok\n"], exitCode: 0 }) as never,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("expected ok");
    expect(out.result.chunkSetId).toBeUndefined();
    const { readdir } = await import("node:fs/promises");
    await expect(readdir(join(store, "content", PROJECT_ID, SESSION_ID))).rejects.toThrow();
  });
});
```

- [ ] **Step 2.2: Run the test to verify it fails.**

Run: `pnpm --filter @megasaver/core test run-command`
Expected: FAIL — the new "spawn success pipeline" cases hit the `throw new Error("not implemented: spawn pipeline (Task 2)")` scaffold marker.

- [ ] **Step 2.3: Implement steps 5–10 in the orchestrator.**

Replace the `throw new Error("not implemented: spawn pipeline (Task 2)");` line (and add a capture helper above `runOutputExecCommand`) in `packages/core/src/context-gate/run-command.ts`:

```ts
// Capture combined stdout+stderr in data-event arrival order (BB7b spec §3 step 5,
// §11.5: arrival-order chunk concatenation, not byte-exact PTY interleave). Enforces
// the manual timeout (SIGTERM then SIGKILL after 2s grace) and the max-capture bound.
function captureChild(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
  maxCaptureBytes: number,
): Promise<{ combined: string; exitCode: number | null; terminated?: "timeout" | "max_bytes" }> {
  return new Promise((resolve) => {
    const parts: Buffer[] = [];
    let bytes = 0;
    let terminated: "timeout" | "max_bytes" | undefined;
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;

    const finish = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolve({ combined: Buffer.concat(parts).toString("utf8"), exitCode, terminated });
    };

    const forceKill = (why: "timeout" | "max_bytes"): void => {
      terminated = why;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 2_000);
    };

    const onData = (buf: Buffer): void => {
      if (settled) return;
      if (bytes >= maxCaptureBytes) return;
      const room = maxCaptureBytes - bytes;
      const slice = buf.length > room ? buf.subarray(0, room) : buf;
      parts.push(slice);
      bytes += slice.length;
      if (bytes >= maxCaptureBytes && terminated === undefined) forceKill("max_bytes");
    };

    const timer = setTimeout(() => {
      if (terminated === undefined) forceKill("timeout");
    }, timeoutMs);

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", () => finish(null)); // spawn-time error handled by caller's wrapper
    child.on("close", (code) => finish(code));
  });
}
```

And replace the dangling `throw` with the full pipeline:

```ts
  const mode = settings.mode;
  const maxReturnedBytes =
    settings.maxReturnedBytes === undefined
      ? modeToBudget(mode)
      : Math.min(settings.maxReturnedBytes, MAX_RETURNED_BYTES_CEILING);

  // Step 5: spawn (env marker SET here — propagation half of the recursive guard).
  const spawnFn = input.spawn ?? (nodeSpawn as unknown as SpawnFn);
  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawnFn(input.command, input.args, {
      cwd: settings.projectRoot,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, MEGASAVER_ORIGIN_PID: input.originPid },
    });
  } catch (err) {
    return { ok: false, reason: "command_failed", detail: err instanceof Error ? err.message : "spawn failed" };
  }

  // node spawn emits 'error' asynchronously for ENOENT/EACCES; surface it as command_failed.
  const spawnError = await new Promise<string | null>((resolve) => {
    let done = false;
    child.once("error", (e: Error) => {
      if (!done) {
        done = true;
        resolve(e.message);
      }
    });
    queueMicrotask(() => {
      if (!done) {
        done = true;
        resolve(null);
      }
    });
  });
  if (spawnError !== null) {
    return { ok: false, reason: "command_failed", detail: spawnError };
  }

  const captured = await captureChild(child, input.timeoutMs, input.maxCaptureBytes);

  // Steps 6–7: redaction is internal to filterOutput (BB7b spec §3.6); pass raw straight in.
  // sessionHints omitted — context-hints.ts not landed (BB7b spec §3.7, §11.3; Phase 0 Step 0.4).
  const filtered = filterOutput({
    raw: captured.combined,
    intent: input.intent,
    mode,
    maxReturnedBytes,
    source: { kind: "command", command: input.command, args: input.args },
  });

  const redacted = (filtered.warnings ?? []).some((w) => w.startsWith("redacted"));
  const result: ExecResult = {
    ...filtered,
    childExitCode: captured.exitCode,
    ...(captured.terminated !== undefined ? { terminated: captured.terminated } : {}),
  };

  // Step 8: store (redact-before-store invariant already satisfied inside filterOutput).
  if (settings.storeRawOutput) {
    const chunkSetId = (input.newId ?? defaultNewId)();
    const chunkSet: ChunkSet = {
      chunkSetId,
      sessionId: input.sessionId,
      projectId: settings.projectId,
      createdAt: (input.now ?? defaultNow)(),
      source: { kind: "command", command: input.command, args: input.args },
      rawBytes: filtered.rawBytes,
      redacted,
      chunks: filtered.excerpts.map((e, i) => ({
        id: String(i),
        startLine: e.startLine,
        endLine: e.endLine,
        bytes: Buffer.byteLength(e.text, "utf8"),
        text: e.text,
      })),
    };
    try {
      await saveChunkSet({ storeRoot: input.storeRoot, chunkSet });
    } catch (err) {
      return { ok: false, reason: "store_write_failed", detail: err instanceof Error ? err.message : "store write failed" };
    }
    result.chunkSetId = chunkSetId;
  }

  // Step 9: stats event (single appendEvent; updates summary inline — BB7b spec §11.2).
  const redactedCount = readRedactedCount(filtered.warnings);
  const event: TokenSaverEvent = {
    id: (input.newId ?? defaultNewId)(),
    sessionId: input.sessionId,
    projectId: settings.projectId,
    createdAt: (input.now ?? defaultNow)(),
    sourceKind: "command",
    label: [input.command, ...input.args].join(" "),
    rawBytes: filtered.rawBytes,
    returnedBytes: filtered.returnedBytes,
    bytesSaved: filtered.bytesSaved,
    savingRatio: filtered.savingRatio,
    ...(result.chunkSetId !== undefined ? { chunkSetId: result.chunkSetId } : {}),
    summary: filtered.summary,
    mode,
  };
  appendEvent({
    store: { root: input.storeRoot },
    event,
    secretsRedacted: redactedCount,
    chunksStored: result.chunkSetId !== undefined ? filtered.excerpts.length : 0,
  });

  // Step 10: return.
  return { ok: true, result };
}

// "redacted N secret(s) before processing" → N (0 when no redaction warning).
function readRedactedCount(warnings: readonly string[] | undefined): number {
  const w = (warnings ?? []).find((x) => x.startsWith("redacted "));
  if (w === undefined) return 0;
  const m = w.match(/redacted (\d+)/);
  return m?.[1] !== undefined ? Number.parseInt(m[1], 10) : 0;
}
```

> `filterOutput` clamps `returnedBytes` ≤ budget; `appendEvent` validates the event with `.strict()` and requires `savingRatio` ∈ [0,1] — `filterOutput` already guarantees that. The `id` for the chunkSet and the event reuse `newId`; in tests both share `"cs-fixed"`-style fixed ids, which is fine (the event id is opaque). If a unique event id is preferred, call `(input.newId ?? defaultNewId)()` is already invoked twice — acceptable; the stats schema only requires `min(1)`.

- [ ] **Step 2.4: Run the test to verify it passes.**

Run: `pnpm --filter @megasaver/core test run-command`
Expected: PASS — all Task 1 + Task 2 cases green (happy path writes chunkSet with `source.kind: "command"`, redaction warning present, `redacted: true`, stats event appended, `childExitCode` mirrors, storeRawOutput=false writes nothing).

- [ ] **Step 2.5: Commit.**

```bash
git -C /Users/halitozger/Desktop/MegaSaver/.worktrees/cc-bb-plans add packages/core/src/context-gate/run-command.ts packages/core/test/context-gate/run-command.test.ts
git -C /Users/halitozger/Desktop/MegaSaver/.worktrees/cc-bb-plans commit -m "feat(core): exec orchestrator spawn + filter/store/stats pipeline"
```

---

## Task 3: Orchestrator timeout + max-bytes forced-termination

**Files:**
- Modify: `packages/core/src/context-gate/run-command.ts` (only if a bug surfaces — the capture helper from Task 2 already implements both bounds)
- Test: `packages/core/test/context-gate/run-command.test.ts`

Proves the two bounds (BB7b spec §2, §3 step 5, §5): on timeout or max-bytes the orchestrator does NOT error — it marks `terminated`, still filters/stores the partial output, and returns `ok: true` with `childExitCode: null`. (The CLI maps these to exit 1 — Task 5.)

- [ ] **Step 3.1: Write the failing test — timeout and max-bytes.**

Append to `packages/core/test/context-gate/run-command.test.ts`. Add a never-closing fake-spawn helper after `fakeSpawn`:

```ts
// A child that emits chunks but NEVER closes on its own; records kill signals.
function fakeHangingSpawn(opts: { chunks?: string[]; onKill?: (sig: string) => void }) {
  return () => {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: (sig?: string) => boolean;
    };
    child.stdout = stdout;
    child.stderr = stderr;
    child.kill = (sig = "SIGTERM") => {
      opts.onKill?.(sig);
      // emulate the OS delivering the signal: close shortly after SIGTERM
      if (sig === "SIGTERM") queueMicrotask(() => child.emit("close", null, "SIGTERM"));
      return true;
    };
    queueMicrotask(() => {
      for (const c of opts.chunks ?? []) stdout.emit("data", Buffer.from(c));
    });
    return child as never;
  };
}
```

Then:

```ts
describe("runOutputExecCommand — forced termination", () => {
  let store: string;
  let projectRoot: string;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "ms-runcmd3-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "ms-runcmd3-root-"));
    await seed(store, projectRoot);
    await initStore(store);
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("timeout: hanging child → SIGTERM sent, partial output stored, terminated=timeout, ok", async () => {
    const registry = createJsonDirectoryCoreRegistry({ rootDir: store });
    const signals: string[] = [];
    const out = await runOutputExecCommand({
      registry,
      storeRoot: store,
      sessionId: SESSION_ID as never,
      intent: "find it",
      command: "pnpm",
      args: ["test"],
      originPid: "1",
      timeoutMs: 5, // fire fast
      maxCaptureBytes: 20_000_000,
      now: () => "2026-05-10T12:00:00.000Z",
      newId: () => "cs-to",
      spawn: fakeHangingSpawn({ chunks: ["partial output\n"], onKill: (s) => signals.push(s) }) as never,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("expected ok");
    expect(out.result.terminated).toBe("timeout");
    expect(out.result.childExitCode).toBeNull();
    expect(signals).toContain("SIGTERM");
    expect(out.result.chunkSetId).toBe("cs-to");
  });

  it("max-bytes: child emits beyond cap → capture stops, terminated=max_bytes, ok", async () => {
    const registry = createJsonDirectoryCoreRegistry({ rootDir: store });
    const signals: string[] = [];
    const big = "x".repeat(50);
    const out = await runOutputExecCommand({
      registry,
      storeRoot: store,
      sessionId: SESSION_ID as never,
      intent: "find it",
      command: "pnpm",
      args: ["test"],
      originPid: "1",
      timeoutMs: 300_000,
      maxCaptureBytes: 10, // tiny cap
      now: () => "2026-05-10T12:00:00.000Z",
      newId: () => "cs-mb",
      spawn: fakeHangingSpawn({ chunks: [big], onKill: (s) => signals.push(s) }) as never,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("expected ok");
    expect(out.result.terminated).toBe("max_bytes");
    expect(signals).toContain("SIGTERM");
  });
});
```

- [ ] **Step 3.2: Run the test.**

Run: `pnpm --filter @megasaver/core test run-command`
Expected: PASS if Task 2's `captureChild` is correct. If a case FAILS (e.g. the close-on-SIGTERM emulation races the `killTimer`), this is a real bug surfaced by the test — debug per `superpowers:systematic-debugging` and fix `captureChild` until both bounds settle deterministically. Do NOT weaken the test.

- [ ] **Step 3.3: Commit.**

```bash
git -C /Users/halitozger/Desktop/MegaSaver/.worktrees/cc-bb-plans add packages/core/src/context-gate/run-command.ts packages/core/test/context-gate/run-command.test.ts
git -C /Users/halitozger/Desktop/MegaSaver/.worktrees/cc-bb-plans commit -m "test(core): exec orchestrator timeout + max-bytes bounds"
```

---

## Task 4: CLI error message builders

**Files:**
- Modify: `apps/cli/src/errors.ts`
- Test: (covered by Task 5/6 CLI tests; no standalone error-builder test — the existing `errors.ts` has none and these are trivial string builders, `CLAUDE.md` §8 "3 similar lines > premature abstraction")

- [ ] **Step 4.1: Add the three message builders.**

Edit `apps/cli/src/errors.ts` — append after `fileReadFailedMessage` (mirrors the existing `pathDeniedMessage` / `fileReadFailedMessage` shape exactly):

```ts
export function commandDeniedMessage(reason: string): CliMessage {
  return { message: `error: command_denied: ${reason}`, exitCode: 1 };
}

export function commandFailedMessage(detail: string): CliMessage {
  return { message: `error: command_failed: ${detail}`, exitCode: 1 };
}

export function storeWriteFailedMessage(detail: string): CliMessage {
  return { message: `error: store_write_failed: ${detail}`, exitCode: 1 };
}
```

- [ ] **Step 4.2: Verify it typechecks.**

Run: `pnpm --filter @megasaver/cli typecheck`
Expected: PASS (no usage yet; the builders are referenced in Task 5).

- [ ] **Step 4.3: Commit.**

```bash
git -C /Users/halitozger/Desktop/MegaSaver/.worktrees/cc-bb-plans add apps/cli/src/errors.ts
git -C /Users/halitozger/Desktop/MegaSaver/.worktrees/cc-bb-plans commit -m "feat(cli): add exec error message builders"
```

---

## Task 5: CLI adapter `exec.ts` (pure `runOutputExec` + exit-code mapping)

**Files:**
- Create: `apps/cli/src/commands/output/exec.ts`
- Test: `apps/cli/test/output/exec.test.ts`

The thin adapter. Mirrors `apps/cli/src/commands/output/file.ts` exactly for store resolution, session-id parse, and `--intent` check; then calls the core orchestrator and maps its result to exit codes per BB7b spec §6 (child-mirror on clean run, 1 on MegaSaver error + forced-termination, 2 on unexpected). **No `child_process`/`spawn`/`execFile` string appears in this file** (no-child-process guard at `apps/cli/test/output/no-child-process.test.ts`).

- [ ] **Step 5.1: Write the failing test — CLI command coverage with injected spawn.**

Create `apps/cli/test/output/exec.test.ts`:

```ts
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runOutputExec } from "../../src/commands/output/exec.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const TS = "2026-05-10T00:00:00.000Z";
const NOW = "2026-05-10T12:00:00.000Z";
const NEW_ID = "cs-fixed-id";

async function seed(store: string, projectRoot: string, storeRawOutput = true): Promise<void> {
  await mkdir(store, { recursive: true });
  await writeFile(
    join(store, "projects.json"),
    JSON.stringify([
      { id: PROJECT_ID, name: "demo", rootPath: projectRoot, createdAt: TS, updatedAt: TS },
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
        tokenSaver: {
          enabled: true,
          mode: "balanced",
          maxReturnedBytes: 12_000,
          storeRawOutput,
          redactSecrets: true,
          autoRepair: true,
          createdAt: TS,
          updatedAt: TS,
        },
      },
    ]),
  );
}

function fakeSpawn(opts: { stdout?: string[]; stderr?: string[]; exitCode?: number }) {
  return () => {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: () => boolean;
    };
    child.stdout = stdout;
    child.stderr = stderr;
    child.kill = () => true;
    queueMicrotask(() => {
      for (const c of opts.stdout ?? []) stdout.emit("data", Buffer.from(c));
      for (const c of opts.stderr ?? []) stderr.emit("data", Buffer.from(c));
      child.emit("close", opts.exitCode ?? 0, null);
    });
    return child as never;
  };
}

function capture(): { out: string[]; err: string[] } {
  return { out: [], err: [] };
}

function baseInput(store: string, projectRoot: string, o: { out: string[]; err: string[] }) {
  return {
    sessionId: SESSION_ID,
    intentFlag: "find the error",
    command: "pnpm",
    args: ["test"] as string[],
    storeFlag: store,
    cwd: projectRoot,
    home: projectRoot,
    xdgDataHome: undefined,
    originPid: "4242",
    stdout: (l: string) => o.out.push(l),
    stderr: (l: string) => o.err.push(l),
    now: () => NOW,
    newId: () => NEW_ID,
  };
}

describe("runOutputExec", () => {
  let store: string;
  let projectRoot: string;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "ms-exec-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "ms-exec-root-"));
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("happy path --json: single-line { sessionId, result } incl childExitCode; chunkSet on disk; exit 0", async () => {
    await seed(store, projectRoot);
    const o = capture();
    const code = await runOutputExec({
      ...baseInput(store, projectRoot, o),
      json: true,
      spawn: fakeSpawn({ stdout: ["line\nerror: boom\n"], exitCode: 0 }) as never,
    });
    expect(code).toBe(0);
    expect(o.out).toHaveLength(1);
    const parsed = JSON.parse(o.out[0] ?? "") as {
      sessionId: string;
      result: { childExitCode: number; chunkSetId?: string };
    };
    expect(parsed.sessionId).toBe(SESSION_ID);
    expect(parsed.result.childExitCode).toBe(0);
    expect(parsed.result.chunkSetId).toBe(NEW_ID);
    const files = await readdir(join(store, "content", PROJECT_ID, SESSION_ID));
    expect(files).toContain(`${NEW_ID}.json`);
  });

  it("happy path text: prints the Ran … line", async () => {
    await seed(store, projectRoot);
    const o = capture();
    const code = await runOutputExec({
      ...baseInput(store, projectRoot, o),
      json: false,
      spawn: fakeSpawn({ stdout: ["ok\n"], exitCode: 0 }) as never,
    });
    expect(code).toBe(0);
    expect(o.out.some((l) => l.startsWith(`Ran pnpm test for ${SESSION_ID}`))).toBe(true);
  });

  it("child non-zero exit: exit mirrors child code (7), success output written, note on stderr", async () => {
    await seed(store, projectRoot);
    const o = capture();
    const code = await runOutputExec({
      ...baseInput(store, projectRoot, o),
      json: true,
      spawn: fakeSpawn({ stdout: ["partial\n"], exitCode: 7 }) as never,
    });
    expect(code).toBe(7);
    expect(o.out).toHaveLength(1); // JSON success STILL written
    expect(o.err.some((l) => l.includes("note: command exited 7"))).toBe(true);
  });

  it("missing --intent → intent_required, exit 1, no stdout (no spawn)", async () => {
    await seed(store, projectRoot);
    const o = capture();
    let spawnCalled = false;
    const code = await runOutputExec({
      ...baseInput(store, projectRoot, o),
      intentFlag: undefined,
      json: true,
      spawn: (() => {
        spawnCalled = true;
        return undefined as never;
      }) as never,
    });
    expect(code).toBe(1);
    expect(o.out).toHaveLength(0);
    expect(o.err.some((e) => e.includes("intent_required"))).toBe(true);
    expect(spawnCalled).toBe(false);
  });

  it("command denied (non-allowlisted) → command_denied:command_not_allowed, exit 1, no spawn", async () => {
    await seed(store, projectRoot);
    const o = capture();
    let spawnCalled = false;
    const code = await runOutputExec({
      ...baseInput(store, projectRoot, o),
      command: "totally-not-allowed",
      args: [],
      json: false,
      spawn: (() => {
        spawnCalled = true;
        return undefined as never;
      }) as never,
    });
    expect(code).toBe(1);
    expect(o.out).toHaveLength(0);
    expect(o.err.some((e) => e.includes("command_denied"))).toBe(true);
    expect(o.err.some((e) => e.includes("command_not_allowed"))).toBe(true);
    expect(spawnCalled).toBe(false);
  });

  it("session not found → session_not_found, exit 1, no spawn", async () => {
    await seed(store, projectRoot);
    const o = capture();
    let spawnCalled = false;
    const code = await runOutputExec({
      ...baseInput(store, projectRoot, o),
      sessionId: "99999999-9999-4999-8999-999999999999",
      json: true,
      spawn: (() => {
        spawnCalled = true;
        return undefined as never;
      }) as never,
    });
    expect(code).toBe(1);
    expect(o.out).toHaveLength(0);
    expect(o.err.some((e) => /not found/.test(e))).toBe(true);
    expect(spawnCalled).toBe(false);
  });

  it("forced termination (timeout) → exit 1 even though partial output stored", async () => {
    await seed(store, projectRoot);
    const o = capture();
    // hanging child: never closes, timeout fires
    const hanging = () => {
      const stdout = new EventEmitter();
      const stderr = new EventEmitter();
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: (s?: string) => boolean;
      };
      child.stdout = stdout;
      child.stderr = stderr;
      child.kill = (s = "SIGTERM") => {
        if (s === "SIGTERM") queueMicrotask(() => child.emit("close", null, "SIGTERM"));
        return true;
      };
      queueMicrotask(() => stdout.emit("data", Buffer.from("partial\n")));
      return child as never;
    };
    const code = await runOutputExec({
      ...baseInput(store, projectRoot, o),
      json: true,
      timeoutSec: 0.005,
      spawn: hanging as never,
    });
    expect(code).toBe(1);
  });
});
```

- [ ] **Step 5.2: Run the test to verify it fails.**

Run: `pnpm --filter @megasaver/cli test exec`
Expected: FAIL — `apps/cli/src/commands/output/exec.js` does not exist.

- [ ] **Step 5.3: Implement `exec.ts`.**

Create `apps/cli/src/commands/output/exec.ts`:

```ts
import {
  runOutputExecCommand,
  type SpawnFn,
} from "@megasaver/core";
import { sessionIdSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import {
  commandDeniedMessage,
  commandFailedMessage,
  intentRequiredMessage,
  mapErrorToCliMessage,
  sessionNotFoundMessage,
  storeWriteFailedMessage,
} from "../../errors.js";
import { ensureStoreReady, resolveStorePath } from "../../store.js";

const DEFAULT_TIMEOUT_SEC = 300;
const DEFAULT_MAX_BYTES = 20_000_000;

export type RunOutputExecInput = {
  sessionId: string;
  intentFlag: string | undefined;
  command: string;
  args: readonly string[];
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  originPid: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json?: boolean;
  timeoutSec?: number;
  maxBytes?: number;
  now?: () => string;
  newId?: () => string;
  spawn?: SpawnFn;
};

// Exit-code mapping is the load-bearing CLI contract (BB7b spec §6):
//   clean child run → mirror child exit code
//   MegaSaver expected error (incl. forced-termination) → 1
//   unexpected throw → 2
export async function runOutputExec(input: RunOutputExecInput): Promise<number> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath({
      storeFlag: input.storeFlag,
      cwd: input.cwd,
      home: input.home,
      xdgDataHome: input.xdgDataHome,
    });
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  let sessionId: ReturnType<typeof sessionIdSchema.parse>;
  try {
    sessionId = sessionIdSchema.parse(input.sessionId);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "sessionId" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  if (input.intentFlag === undefined || input.intentFlag === "") {
    const cli = intentRequiredMessage();
    input.stderr(cli.message);
    return cli.exitCode;
  }
  const intent = input.intentFlag;

  try {
    const { registry } = await ensureStoreReady(rootDir);
    const outcome = await runOutputExecCommand({
      registry,
      storeRoot: rootDir,
      sessionId,
      intent,
      command: input.command,
      args: input.args,
      originPid: input.originPid,
      timeoutMs: Math.round((input.timeoutSec ?? DEFAULT_TIMEOUT_SEC) * 1000),
      maxCaptureBytes: input.maxBytes ?? DEFAULT_MAX_BYTES,
      ...(input.now !== undefined ? { now: input.now } : {}),
      ...(input.newId !== undefined ? { newId: input.newId } : {}),
      ...(input.spawn !== undefined ? { spawn: input.spawn } : {}),
    });

    if (!outcome.ok) {
      const cli =
        outcome.reason === "session_not_found"
          ? sessionNotFoundMessage(input.sessionId)
          : outcome.reason === "command_denied"
            ? commandDeniedMessage(outcome.code)
            : outcome.reason === "command_failed"
              ? commandFailedMessage(outcome.detail)
              : storeWriteFailedMessage(outcome.detail);
      input.stderr(cli.message);
      return cli.exitCode;
    }

    const { result } = outcome;

    // Forced termination (timeout / max-bytes): partial output already stored,
    // but the run is exit 1 (BB7b spec §6). No stdout success payload.
    if (result.terminated !== undefined) {
      input.stderr(`error: command_failed: terminated: ${result.terminated}`);
      return 1;
    }

    if (input.json) {
      input.stdout(JSON.stringify({ sessionId: input.sessionId, result }));
    } else {
      const pct = Math.round(result.savingRatio * 100);
      let line = `Ran ${input.command} for ${input.sessionId} (${result.returnedBytes} B kept, ${result.bytesSaved} B saved, ${pct}%)`;
      if (result.chunkSetId !== undefined) line += ` chunkSetId=${result.chunkSetId}`;
      input.stdout(line);
      input.stdout(result.summary);
    }

    // Child-code mirror: a non-zero child is NOT a MegaSaver failure — success
    // output is written and the code is mirrored, with a one-line note on stderr.
    if (result.childExitCode !== null && result.childExitCode !== 0) {
      input.stderr(`note: command exited ${result.childExitCode}`);
      return result.childExitCode;
    }
    return result.childExitCode ?? 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    // mapErrorToCliMessage returns exitCode 1; unexpected throws are exit 2 (BB7b §6).
    input.stderr(cli.message);
    return 2;
  }
}

export const outputExecCommand = defineCommand({
  meta: {
    name: "exec",
    description: "Spawn a policy-gated command and filter its output through the pipeline.",
  },
  args: {
    sessionId: { type: "positional", required: true, description: "Session id (UUID)." },
    intent: { type: "string", description: "What you need from the output (required)." },
    store: { type: "string", description: "Override store directory." },
    timeout: { type: "string", description: "Max child wall-clock seconds (default 300)." },
    "max-bytes": { type: "string", description: "Max captured output bytes (default 20000000)." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    // Everything after `--` arrives as positional rest in args._ (BB7b spec §2):
    // the first token is the command, the remainder are its args.
    const rest = Array.isArray(args._) ? args._.map((t) => String(t)) : [];
    const command = rest[0] ?? "";
    const commandArgs = rest.slice(1);

    const timeoutSec =
      typeof args.timeout === "string" && args.timeout !== ""
        ? Number.parseFloat(args.timeout)
        : undefined;
    const maxBytes =
      typeof args["max-bytes"] === "string" && args["max-bytes"] !== ""
        ? Number.parseInt(args["max-bytes"], 10)
        : undefined;

    // Env-marker capture (BB7b spec §3 step 3): inherited marker → downstream of
    // MegaSaver; absent/empty → this process is the root.
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    const inherited = process.env["MEGASAVER_ORIGIN_PID"];
    const originPid = inherited && inherited !== "" ? inherited : String(process.pid);

    const code = await runOutputExec({
      sessionId: typeof args.sessionId === "string" ? args.sessionId : "",
      intentFlag: typeof args.intent === "string" ? args.intent : undefined,
      command,
      args: commandArgs,
      storeFlag: typeof args.store === "string" ? args.store : undefined,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      home: process.env["HOME"] ?? "",
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      xdgDataHome: process.env["XDG_DATA_HOME"],
      originPid,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
      ...(timeoutSec !== undefined ? { timeoutSec } : {}),
      ...(maxBytes !== undefined ? { maxBytes } : {}),
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

> The `defineCommand` wrapper is the only place that reads `process.env.MEGASAVER_ORIGIN_PID` / `process.pid` / `args._` (BB7b spec §2, §3 step 3). `runOutputExec` is pure (no `process.*` reads). The orchestrator (`run-command.ts` in core) holds all spawn logic, so `exec.ts` contains none of `child_process`/`spawn`/`execFile` — preserving the `no-child-process.test.ts` guard.

- [ ] **Step 5.4: Run the test to verify it passes.**

Run: `pnpm --filter @megasaver/cli test exec`
Expected: PASS — all `runOutputExec` cases green (JSON + text happy path, child-mirror exit 7 with note, intent_required no-spawn, command_denied no-spawn, session_not_found no-spawn, timeout → exit 1).

- [ ] **Step 5.5: Verify the no-child-process guard still passes.**

Run: `pnpm --filter @megasaver/cli test no-child-process`
Expected: PASS — `exec.ts` is now in `apps/cli/src/commands/output/` and the guard scans every `.ts` there; it must contain no `child_process`, `spawn`, or `execFile` string. (If it FAILS, the adapter accidentally references spawn directly — move that logic into the orchestrator.)

- [ ] **Step 5.6: Commit.**

```bash
git -C /Users/halitozger/Desktop/MegaSaver/.worktrees/cc-bb-plans add apps/cli/src/commands/output/exec.ts apps/cli/test/output/exec.test.ts
git -C /Users/halitozger/Desktop/MegaSaver/.worktrees/cc-bb-plans commit -m "feat(cli): mega output exec adapter + exit-code mirror"
```

---

## Task 6: Recursive-detection test (env marker → `recursive_megasaver`)

**Files:**
- Test: `apps/cli/test/output/exec.recursive.test.ts`

Dedicated test for the re-entry guard (AA1 §14 BB7b row; BB7b spec §4, §8): an inherited `originPid` that differs from the current pid → `command_denied: recursive_megasaver`, exit 1, no spawn. This is the paradox guard (BB7b spec §4, §10.7).

- [ ] **Step 6.1: Write the failing test.**

Create `apps/cli/test/output/exec.recursive.test.ts`:

```ts
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runOutputExec } from "../../src/commands/output/exec.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const TS = "2026-05-10T00:00:00.000Z";

async function seed(store: string, projectRoot: string): Promise<void> {
  await mkdir(store, { recursive: true });
  await writeFile(
    join(store, "projects.json"),
    JSON.stringify([
      { id: PROJECT_ID, name: "demo", rootPath: projectRoot, createdAt: TS, updatedAt: TS },
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
        tokenSaver: {
          enabled: true,
          mode: "balanced",
          maxReturnedBytes: 12_000,
          storeRawOutput: true,
          redactSecrets: true,
          autoRepair: true,
          createdAt: TS,
          updatedAt: TS,
        },
      },
    ]),
  );
}

describe("runOutputExec — recursive_megasaver re-entry guard", () => {
  let store: string;
  let projectRoot: string;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "ms-exec-rec-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "ms-exec-rec-root-"));
    await seed(store, projectRoot);
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("inherited MEGASAVER_ORIGIN_PID != current pid → command_denied:recursive_megasaver, exit 1, no spawn", async () => {
    const out: string[] = [];
    const err: string[] = [];
    let spawnCalled = false;
    const code = await runOutputExec({
      sessionId: SESSION_ID,
      intentFlag: "run tests",
      command: "pnpm",
      args: ["test"],
      storeFlag: store,
      cwd: projectRoot,
      home: projectRoot,
      xdgDataHome: undefined,
      // simulate a downstream process: marker inherited from a DIFFERENT (parent) pid
      originPid: String(process.pid + 1),
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      json: false,
      spawn: (() => {
        spawnCalled = true;
        return undefined as never;
      }) as never,
    });

    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(err.some((e) => e.includes("command_denied"))).toBe(true);
    expect(err.some((e) => e.includes("recursive_megasaver"))).toBe(true);
    expect(spawnCalled).toBe(false);
    // no chunkSet written on a denial
    await expect(readdir(join(store, "content", PROJECT_ID, SESSION_ID))).rejects.toThrow();
  });

  it("originPid == current pid (root run) is NOT recursive (would proceed to spawn)", async () => {
    const out: string[] = [];
    const err: string[] = [];
    let spawnCalled = false;
    const code = await runOutputExec({
      sessionId: SESSION_ID,
      intentFlag: "run tests",
      command: "pnpm",
      args: ["test"],
      storeFlag: store,
      cwd: projectRoot,
      home: projectRoot,
      xdgDataHome: undefined,
      originPid: String(process.pid), // root: marker equals our own pid
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      json: false,
      now: () => "2026-05-10T12:00:00.000Z",
      newId: () => "cs-root",
      spawn: (() => {
        spawnCalled = true;
        // minimal closing child so the pipeline completes
        const { EventEmitter } = require("node:events") as typeof import("node:events");
        const so = new EventEmitter();
        const se = new EventEmitter();
        const child = new EventEmitter() as EventEmitter & {
          stdout: typeof so;
          stderr: typeof se;
          kill: () => boolean;
        };
        child.stdout = so;
        child.stderr = se;
        child.kill = () => true;
        queueMicrotask(() => {
          so.emit("data", Buffer.from("ok\n"));
          child.emit("close", 0, null);
        });
        return child as never;
      }) as never,
    });

    expect(spawnCalled).toBe(true); // NOT denied as recursive
    expect(code).toBe(0);
    expect(err.some((e) => e.includes("recursive_megasaver"))).toBe(false);
  });
});
```

> The second case proves the guard is precise: a root run (`originPid === String(process.pid)`) is NOT flagged recursive and proceeds to spawn — guarding against a false-positive that would break legitimate first invocations. Uses `require("node:events")` inline to keep the closure self-contained; if Biome rejects `require` in ESM, hoist `import { EventEmitter } from "node:events"` to the top of the file and drop the inline require.

- [ ] **Step 6.2: Run the test to verify it fails, then passes.**

Run: `pnpm --filter @megasaver/cli test exec.recursive`
Expected: FAIL first only if `exec.ts` were missing — but `exec.ts` exists from Task 5, so this should PASS immediately (the orchestrator's policy gate already returns `recursive_megasaver`). If it FAILS, the env-marker plumbing is broken — debug the `originPid` flow (wrapper → `runOutputExec` → orchestrator → `evaluateCommand.env`). Expected final: PASS.

- [ ] **Step 6.3: Commit.**

```bash
git -C /Users/halitozger/Desktop/MegaSaver/.worktrees/cc-bb-plans add apps/cli/test/output/exec.recursive.test.ts
git -C /Users/halitozger/Desktop/MegaSaver/.worktrees/cc-bb-plans commit -m "test(cli): exec recursive_megasaver re-entry guard"
```

---

## Task 7: Register `exec` in the output command tree

**Files:**
- Modify: `apps/cli/src/commands/output/index.ts`
- Test: (registration verified by a smoke assertion in this task; the CLI tests already drive `runOutputExec` directly)

- [ ] **Step 7.1: Write the failing test — `exec` is a registered subcommand and re-exported.**

Append to `apps/cli/test/output/exec.test.ts` (a new `describe` at the bottom):

```ts
import { outputCommand } from "../../src/commands/output/index.js";
import { runOutputExec as reexportedRunOutputExec } from "../../src/commands/output/index.js";

describe("output command registration", () => {
  it("registers exec in subCommands", async () => {
    const sub = await (outputCommand.subCommands as Record<string, unknown>);
    expect(sub).toHaveProperty("exec");
  });

  it("re-exports runOutputExec from the output barrel", () => {
    expect(typeof reexportedRunOutputExec).toBe("function");
  });
});
```

- [ ] **Step 7.2: Run to verify it fails.**

Run: `pnpm --filter @megasaver/cli test exec`
Expected: FAIL — `exec` not in `subCommands`; `runOutputExec` not re-exported from `index.ts`.

- [ ] **Step 7.3: Register `exec` and re-export.**

Edit `apps/cli/src/commands/output/index.ts`:

```ts
import { defineCommand } from "citty";
import { outputChunkCommand } from "./chunk.js";
import { outputExecCommand } from "./exec.js";
import { outputFileCommand } from "./file.js";
import { outputFilterCommand } from "./filter.js";

export {
  type RunOutputFileInput,
  runOutputFile,
  outputFileCommand,
} from "./file.js";
export {
  type RunOutputFilterInput,
  runOutputFilter,
  outputFilterCommand,
} from "./filter.js";
export {
  type RunOutputChunkInput,
  runOutputChunk,
  outputChunkCommand,
} from "./chunk.js";
export {
  type RunOutputExecInput,
  runOutputExec,
  outputExecCommand,
} from "./exec.js";

export const outputCommand = defineCommand({
  meta: { name: "output", description: "Filter and chunk tool output." },
  subCommands: {
    file: outputFileCommand,
    filter: outputFilterCommand,
    chunk: outputChunkCommand,
    exec: outputExecCommand,
  },
});
```

- [ ] **Step 7.4: Run to verify it passes.**

Run: `pnpm --filter @megasaver/cli test exec`
Expected: PASS — `exec` registered, `runOutputExec` re-exported.

- [ ] **Step 7.5: Commit.**

```bash
git -C /Users/halitozger/Desktop/MegaSaver/.worktrees/cc-bb-plans add apps/cli/src/commands/output/index.ts
git -C /Users/halitozger/Desktop/MegaSaver/.worktrees/cc-bb-plans commit -m "feat(cli): register output exec subcommand"
```

---

## Task 8: Extend the `--json` failure-path drift guard

**Files:**
- Modify: `apps/cli/test/json-failure-paths.test.ts`

Add `output exec` failure cases to the drift guard (AA1 §5b/§5a JSON-failure invariant; BB7b spec §8 "Edited tests"): on every MegaSaver-failure path, `--json` emits text stderr + empty stdout + exit ≥ 1, never JSON on stdout.

- [ ] **Step 8.1: Write the failing test cases.**

Append to `apps/cli/test/json-failure-paths.test.ts` (after the existing `runOutputChunk` block; the file already imports `runOutputFile`/`runOutputFilter`/`runOutputChunk`, `seedSession`, `PROJECT_ID_W`, `SESSION_ID_W`, `nonJsonStderr`, `TS_W`). Add the `runOutputExec` import near the other output imports at the top:

```ts
import { runOutputExec } from "../src/commands/output/exec.js";
```

Then append:

```ts
// ---------------------------------------------------------------------------
// output exec --json failure paths (BB7b §8)
// ---------------------------------------------------------------------------

describe("runOutputExec --json failure paths", () => {
  let store: string;
  let projectRoot: string;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-json-fail-oe-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-json-fail-oe-root-"));
    await seedSession(store, projectRoot);
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  function noSpawn() {
    return (() => {
      throw new Error("spawn must not be called on a failure path");
    }) as never;
  }

  it("missing --intent → text stderr, no stdout, exit 1", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runOutputExec({
      sessionId: SESSION_ID_W,
      intentFlag: undefined,
      command: "pnpm",
      args: ["test"],
      storeFlag: store,
      cwd: projectRoot,
      home: projectRoot,
      xdgDataHome: undefined,
      originPid: "4242",
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      json: true,
      spawn: noSpawn(),
    });
    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    nonJsonStderr(err);
  });

  it("command denied (non-allowlisted) → text stderr, no stdout, exit 1", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runOutputExec({
      sessionId: SESSION_ID_W,
      intentFlag: "run it",
      command: "definitely-not-allowed",
      args: [],
      storeFlag: store,
      cwd: projectRoot,
      home: projectRoot,
      xdgDataHome: undefined,
      originPid: "4242",
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      json: true,
      spawn: noSpawn(),
    });
    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    nonJsonStderr(err);
  });

  it("session not found → text stderr, no stdout, exit 1", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runOutputExec({
      sessionId: "99999999-9999-4999-8999-999999999999",
      intentFlag: "run it",
      command: "pnpm",
      args: ["test"],
      storeFlag: store,
      cwd: projectRoot,
      home: projectRoot,
      xdgDataHome: undefined,
      originPid: "4242",
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      json: true,
      spawn: noSpawn(),
    });
    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    nonJsonStderr(err);
  });
});
```

- [ ] **Step 8.2: Run to verify it passes.**

Run: `pnpm --filter @megasaver/cli test json-failure-paths`
Expected: PASS — the three `runOutputExec` failure cases emit text stderr, empty stdout, exit 1; `spawn` never called (the throwing fake would surface as exit 2 if ever invoked, which would fail the `expect(code).toBe(1)` — a strong guard that denial precedes spawn even through the CLI layer).

- [ ] **Step 8.3: Commit.**

```bash
git -C /Users/halitozger/Desktop/MegaSaver/.worktrees/cc-bb-plans add apps/cli/test/json-failure-paths.test.ts
git -C /Users/halitozger/Desktop/MegaSaver/.worktrees/cc-bb-plans commit -m "test(cli): json-failure drift guard covers output exec"
```

---

## Task 9: Changeset + full verify

**Files:**
- Create: `.changeset/bb7b-output-exec.md`

- [ ] **Step 9.1: Write the changeset.**

Create `.changeset/bb7b-output-exec.md`:

```md
---
"@megasaver/cli": minor
"@megasaver/core": minor
---

Add the `mega output exec` CLI subcommand — the single policy-gated
child-process spawn surface of the Context Gate epic (BB7b, CRITICAL).
`mega output exec <session-id> --intent <s> -- <cmd> [args...]` spawns the
command through a new core orchestrator (`runOutputExecCommand`, re-exported
from `@megasaver/core`) that runs `policy.evaluateCommand` BEFORE spawning,
sets `MEGASAVER_ORIGIN_PID` on the child env (and denies inherited-marker
re-entry with `recursive_megasaver`), captures combined stdout+stderr under
`--timeout` / `--max-bytes` bounds, redacts + filters via `filterOutput`,
persists a `command`-source chunk-set, and appends a stats event. The CLI
exit code mirrors the child's on a clean run; MegaSaver errors and forced
termination exit 1. No spawn logic lives in `apps/cli` (the
`no-child-process` guard still holds for the output command directory).
```

- [ ] **Step 9.2: Run the full verify gate.**

Run: `pnpm --dir /Users/halitozger/Desktop/MegaSaver/.worktrees/cc-bb-plans verify`
Expected: PASS — `lint` (Biome) clean, `typecheck` (tsc -b) clean, `test` (Vitest) all green across the workspace. Specifically confirm:
- `packages/core/test/context-gate/run-command.test.ts` — all cases.
- `packages/core/test/context-gate/dependency-direction.test.ts` — allow-list now includes `@megasaver/stats`.
- `apps/cli/test/output/exec.test.ts`, `exec.recursive.test.ts` — all cases.
- `apps/cli/test/output/no-child-process.test.ts` — still green (exec.ts has no spawn string).
- `apps/cli/test/dependency-graph.test.ts` — still green (`apps/cli` did NOT gain a `@megasaver/stats` dep).
- `apps/cli/test/json-failure-paths.test.ts` — exec cases green.

If anything fails, debug per `superpowers:systematic-debugging`; do not weaken assertions.

- [ ] **Step 9.3: Commit.**

```bash
git -C /Users/halitozger/Desktop/MegaSaver/.worktrees/cc-bb-plans add .changeset/bb7b-output-exec.md
git -C /Users/halitozger/Desktop/MegaSaver/.worktrees/cc-bb-plans commit -m "chore: changeset for mega output exec (BB7b)"
```

---

## Task 10: Post-merge LOC audit (§2a deferred-extraction trigger)

**Files:** none (evidence-only step; AA1 §2a, §14 BB7b row, BB7b spec §10.8)

- [ ] **Step 10.1: Run the context-gate LOC audit and record it.**

Run:
```bash
wc -l /Users/halitozger/Desktop/MegaSaver/.worktrees/cc-bb-plans/packages/core/src/context-gate/*.ts
```
Record the **total** line count in the verifier evidence bundle. Per AA1 §2a + §14 BB7b row: if total LOC across the context-gate module (`run.ts + run-command.ts + read.ts + types.ts + fetch-chunk.ts + locate-chunk-set.ts + the barrel`) **exceeds 500**, queue the **BB12** chore PR to extract `@megasaver/context-gate` as its own package. If **≤ 500**, keep folded (note the number and decision in the bundle either way).

- [ ] **Step 10.2: Capture the manual real-spawn smoke evidence (under §16 supervision — NOT in CI).**

Per BB7b spec §9 + §10.5, the user (during the manual-confirmation gate) runs the acceptance smoke against a real session and records the output in the verifier evidence bundle — it is NEVER automated into the test suite (AA1 §12 CRITICAL: no unsupervised execution):
```bash
mega output exec <real-session-id> --intent "failing tests" -- pnpm test
```
Confirm: a chunkSet is written under `<store>/content/<projectId>/<sessionId>/`, a stats event is appended, the exit code mirrors `pnpm test`'s real code, and (if `redactSecrets`) the stored chunks carry no secrets. Record the exact `command` strings that reached `spawn()` (the child-process whitelist verification, AA1 §16 item 4).

---

## Self-Review (run against the BB7b spec + AA1, fix gaps inline)

**1. Spec coverage (BB7b spec section → task):**

- §1a (orchestrator + thin adapter + index registration + error builders) → Tasks 1–2 (orchestrator), 4 (errors), 5 (adapter), 7 (registration). ✓
- §1b (out of scope: MCP, new enum, file/filter/chunk) → respected; no MCP, no new `z.enum`, no `*.test-d.ts`. ✓
- §1c / §11.1 / §11.6 (build on PR #75; confirm export shape; rebase) → Phase 0. ✓
- §2 (surface, flags `--intent`/`--store`/`--timeout`/`--max-bytes`/`--json`, `--` via `args._`, pure `runOutputExec` returns `Promise<number>`, wrapper reads `process.*`) → Task 5 (`exec.ts` + wrapper). ✓
- §3 steps 0–2 (store resolve, session-id parse, intent check, resolve session via `resolveEffectiveSettings`, pre-AA defaults, NO `redactSecrets` branch) → Task 5 (adapter) + Task 1 (orchestrator `resolveEffectiveSettings`). ✓
- §3 step 3 (env-marker capture in wrapper, injected as string) → Task 5 wrapper. ✓
- §3 step 4 (policy gate; deny → exit 1) → Task 1. ✓
- §3 step 5 (spawn: `shell:false`, `cwd: projectRoot`, env marker set, combine stdout+stderr arrival-order, manual timeout SIGTERM→SIGKILL 2s grace, max-bytes kill, spawn error → command_failed) → Task 2 (`captureChild` + spawn) + Task 3 (bounds). ✓
- §3 step 6 (redact folded into filter; NO separate `policy.redact`) → Task 2 (raw passed straight to `filterOutput`). ✓
- §3 step 7 (`filterOutput` with `source: {kind:"command",...}`; `sessionHints` omitted since context-hints not landed) → Task 2 + Phase 0 Step 0.4. ✓
- §3 step 8 (store when `storeRawOutput`; `redacted` from `"redacted…"` warning; throw → store_write_failed) → Task 2. ✓
- §3 step 9 (single `appendEvent`; sourceKind command, label, bytes, chunkSetId, summary, mode, secretsRedacted, chunksStored) → Task 2 + §11.2 honored (no `updateSessionStats`). ✓
- §3 step 10 (return FilterOutputResult + childExitCode + terminated; not persisted) → Task 2 (`ExecResult`). ✓
- §4 (`recursive_megasaver`: deny when originPid present, non-empty, ≠ pid; consumed not re-implemented) → Task 1 + Task 6 (both directions tested). ✓
- §5 (maxReturnedBytes resolution + 64_000 ceiling clamp; raw cap is `--max-bytes`) → Task 2 (`MAX_RETURNED_BYTES_CEILING`, `Math.min`). ✓
- §6 (exit codes: child-mirror, 1 for MegaSaver+forced-term, 2 unexpected) → Task 5 (mapping) + tested in Tasks 5/6/8. ✓
- §7 (text shape `Ran … (… kept, … saved, …%)` + summary + `note:` on stderr for non-zero child; JSON single line `{sessionId, result}`; no JSON on failure) → Task 5 + tested. ✓
- §8 (files list) → all created/edited per the map. ✓
- §9 (test plan: every listed case) → Tasks 1/2/3/5/6 cover intent_missing, command_not_allowed, dangerous_pattern, recursive_megasaver, session_not_found, spawn success, child non-zero, timeout, max-bytes, spawn error?, redaction applied, JSON vs text, exit codes, spawn-never-called per denial. **GAP CHECK:** "spawn error (ENOENT) → command_failed" — covered by the orchestrator's `child.once("error")` handling (Task 2 impl) but NOT yet given a dedicated unit test. **FIX inline:** add Step 2.1b below.
- §10 (CRITICAL acceptance: architect/critic/security-reviewer/tracer/manual-confirm/no-autopilot/no-log-compression/LOC-audit) → CRITICAL notice block + Task 10. ✓
- §11 (open questions) → Phase 0 (1,6), §11.2 single appendEvent (Task 2), §11.3 sessionHints omitted (Phase 0.4 + Task 2), §11.4 no cli stats dep (contradiction note + Task 1.5), §11.5 arrival-order (Task 2 comment), §11.7 not persisted (Task 2 `ExecResult`). ✓

**FIX inline — add the missing spawn-error unit test (referenced as Step 2.1b):**

Append to the "spawn success pipeline" describe in `packages/core/test/context-gate/run-command.test.ts`:

```ts
  it("spawn error (ENOENT): child emits 'error' → command_failed, nothing stored", async () => {
    const registry = createJsonDirectoryCoreRegistry({ rootDir: store });
    const erroringSpawn = () => {
      const { EventEmitter } = require("node:events") as typeof import("node:events");
      const so = new EventEmitter();
      const se = new EventEmitter();
      const child = new EventEmitter() as EventEmitter & {
        stdout: typeof so;
        stderr: typeof se;
        kill: () => boolean;
      };
      child.stdout = so;
      child.stderr = se;
      child.kill = () => true;
      queueMicrotask(() => child.emit("error", new Error("spawn ENOENT")));
      return child as never;
    };
    const out = await runOutputExecCommand({
      registry,
      storeRoot: store,
      sessionId: SESSION_ID as never,
      intent: "x",
      command: "node", // allowlisted, so it passes the gate and reaches spawn
      args: ["--bogus"],
      originPid: "1",
      timeoutMs: 300_000,
      maxCaptureBytes: 20_000_000,
      newId: () => "cs-err",
      spawn: erroringSpawn as never,
    });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("expected failure");
    expect(out.reason).toBe("command_failed");
    const { readdir } = await import("node:fs/promises");
    await expect(readdir(join(store, "content", PROJECT_ID, SESSION_ID))).rejects.toThrow();
  });
```

> This test exercises the orchestrator's `child.once("error")` spawn-error branch (Task 2 impl). It belongs in Task 2's test file; run it in Step 2.4. (If Biome rejects inline `require`, hoist `import { EventEmitter } from "node:events"` to the top of `run-command.test.ts`.)

**2. Placeholder scan:** No "TBD"/"TODO"/"add error handling"/"similar to Task N" left. Every code step shows complete code. The Task 1 `throw new Error("not implemented")` is a deliberate scaffold removed in Task 2 Step 3 (same PR, before any verify/merge) — documented as such, not a shipped half-implementation. ✓

**3. Type consistency:**

- Orchestrator export name: `runOutputExecCommand` — used identically in Task 1 (def + test), Task 1.4 (barrel), Task 2 (test), Task 5 (CLI import). ✓
- Result type `RunOutputExecCommandResult` with `reason` ∈ {session_not_found, command_denied (+`code`), command_failed (+`detail`), store_write_failed (+`detail`)} — consumed in Task 5's mapping exactly (`outcome.reason`, `outcome.code`, `outcome.detail`). ✓
- `ExecResult = FilterOutputResult & { childExitCode; terminated? }` — produced in Task 2, consumed in Task 5 (`result.childExitCode`, `result.terminated`, `result.summary`, `result.savingRatio`, `result.returnedBytes`, `result.bytesSaved`, `result.chunkSetId`). All fields exist on `FilterOutputResult` (verified at `packages/output-filter/src/types.ts`) plus the two augmenting fields. ✓
- CLI input `RunOutputExecInput` field names (`intentFlag`, `command`, `args`, `originPid`, `timeoutSec`, `maxBytes`, `spawn`, `now`, `newId`) — identical across Task 5 def, Task 5/6/8 tests. ✓
- `appendEvent` call shape `{ store: { root }, event, secretsRedacted, chunksStored }` — matches `packages/stats/src/store.ts` `AppendEventInput` exactly. ✓
- `ChunkSet` literal — matches `packages/content-store/src/chunk-set.ts` (`source.kind: "command"` branch has `command` + `args`; `redacted: boolean`; `chunks` of `{id,startLine,endLine,bytes,text}`). ✓
- `evaluateCommand` input `{ command, args, project, env: { MEGASAVER_ORIGIN_PID } }` — matches `packages/policy/src/evaluate-command.ts` `EvaluateCommandInput`. ✓
- `modeToBudget` imported from `@megasaver/shared` (ceiling `2 * modeToBudget("safe")`) — matches AA1 §4a / §5 / §8a. ✓

All consistent. Plan complete.

---

## Execution Handoff

Per the CRITICAL notice above, autopilot/ralph are FORBIDDEN (`CLAUDE.md` §12; BB7b spec §10.6). Execution MUST be supervised with the §16 agent chain (architect memo already done as a precondition; critic → security-reviewer → tracer → manual `confirm BB7b merge`). Within that supervised frame, the two structural options are:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks (REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`), with the mandatory CRITICAL reviewers (critic, security-reviewer, tracer) layered in before code-reviewer and before the manual-confirmation merge gate.

**2. Inline Execution** — execute tasks in this session with checkpoints (REQUIRED SUB-SKILL: `superpowers:executing-plans`), same CRITICAL reviewer layering and manual-confirmation gate.

Either way: NO unsupervised loop, and NO merge before the user replies `confirm BB7b merge` to the linked evidence bundle.
