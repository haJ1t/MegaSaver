# Agent Office Phase 1 — AgentLauncher + claude-code adapter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an agent-agnostic `AgentLauncher` interface (`@megasaver/connectors-shared`) and a concrete claude-code adapter (`@megasaver/connector-claude-code`) that runs one headless `claude -p` task and streams its stream-json output — with the spawn injected so tests never launch a real `claude`.

**Architecture:** Interface + a dedicated `LauncherError` live in connectors-shared. The claude-code package adds a pure `buildClaudeArgs` (argv from a `LaunchInput`) and `createClaudeCodeLauncher({ spawn })` that spawns `claude`, line-buffers stdout → `JSON.parse` (skipping non-JSON), forwards stderr, resolves exit on `close`, and `cancel()`s via SIGTERM. The engine/supervisor (Phase 2) consumes the interface; Phase 1 ships only the capability.

**Tech Stack:** TypeScript strict ESM (NodeNext), zod, Vitest (`node:events`/`node:stream` fakes), Node `child_process`.

**Spec:** [docs/superpowers/specs/2026-06-22-agent-office-phase1-launcher-design.md](../specs/2026-06-22-agent-office-phase1-launcher-design.md). **Risk: HIGH** — introduces spawning; **no test may spawn a real `claude`** (inject the fake spawn).

**Grounded facts (claude 2.1.177):** `--model` takes `opus|sonnet|haiku` aliases; `--permission-mode` choices include `plan|acceptEdits|bypassPermissions`; `--print --output-format stream-json` runs with `--verbose` (included defensively; the parser skips non-JSON lines so verbose noise is harmless).

**Conventions:**
- `@megasaver/connectors-shared` already deps `@megasaver/shared` (AgentId) — no dep change. `@megasaver/connector-claude-code` already deps `@megasaver/connectors-shared` — no dep change.
- Commit trailer every commit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. No `--no-verify`.
- Keep imports at file top (Biome). After each task run `pnpm exec biome check <paths>` and fix before committing.
- If a `test/` dir or vitest config is missing in a connectors package, mirror `packages/content-store/vitest.config.ts` + `tsconfig.test.json` (these packages already build/test in CI, so they should exist).

---

## File Structure

```
packages/connectors/shared/src/launcher.ts        # new: interface types + LauncherError
packages/connectors/shared/src/index.ts           # modify: export launcher module
packages/connectors/shared/test/launcher.test.ts  # new: LauncherError test
packages/connectors/claude-code/src/launcher.ts   # new: buildClaudeArgs + createClaudeCodeLauncher
packages/connectors/claude-code/src/index.ts      # modify: export launcher
packages/connectors/claude-code/test/build-claude-args.test.ts  # new: pure argv tests
packages/connectors/claude-code/test/launcher.test.ts           # new: adapter tests (fake spawn)
.changeset/agent-office-phase1-launcher.md         # new: minor x2
```

---

## Task 1: Launcher interface + `LauncherError` (connectors-shared)

**Files:**
- Create: `packages/connectors/shared/src/launcher.ts`
- Modify: `packages/connectors/shared/src/index.ts`
- Test: `packages/connectors/shared/test/launcher.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/connectors/shared/test/launcher.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { LauncherError, launcherErrorCodeSchema } from "../src/launcher.js";

describe("LauncherError", () => {
  it("carries a typed code and name", () => {
    const err = new LauncherError("invalid_session_config", "bad config");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("LauncherError");
    expect(err.code).toBe("invalid_session_config");
    expect(err.message).toBe("bad config");
  });

  it("enumerates its codes", () => {
    expect(launcherErrorCodeSchema.options).toEqual(["invalid_session_config"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/connectors-shared test launcher`
Expected: FAIL — `../src/launcher.js` not found.

- [ ] **Step 3: Write the implementation**

`packages/connectors/shared/src/launcher.ts`:

```ts
import type { AgentId } from "@megasaver/shared";
import { z } from "zod";

export type LauncherPermissionMode = "plan" | "acceptEdits" | "full";
export type LauncherModel = "opus" | "sonnet" | "haiku";

export interface LaunchInput {
  workdir: string;
  instruction: string;
  model: LauncherModel;
  permissionMode: LauncherPermissionMode;
  allowedTools: readonly string[];
  persona?: string;
  sessionId?: string;
  resumeSessionId?: string;
}

export type LauncherEvent =
  | { kind: "stream"; payload: unknown }
  | { kind: "stderr"; text: string };

export interface LaunchHandle {
  readonly sessionId: string;
  onEvent(cb: (event: LauncherEvent) => void): void;
  onExit(cb: (result: { code: number | null }) => void): void;
  cancel(): void;
}

export interface AgentLauncher {
  readonly kind: AgentId;
  launch(input: LaunchInput): LaunchHandle;
}

export const launcherErrorCodeSchema = z.enum(["invalid_session_config"]);
export type LauncherErrorCode = z.infer<typeof launcherErrorCodeSchema>;

export class LauncherError extends Error {
  readonly code: LauncherErrorCode;

  constructor(code: LauncherErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "LauncherError";
    this.code = code;
  }
}
```

- [ ] **Step 4: Export from the package index**

Append to `packages/connectors/shared/src/index.ts`:

```ts
export {
  type AgentLauncher,
  type LaunchHandle,
  type LaunchInput,
  type LauncherEvent,
  type LauncherModel,
  type LauncherPermissionMode,
  LauncherError,
  type LauncherErrorCode,
  launcherErrorCodeSchema,
} from "./launcher.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @megasaver/connectors-shared test launcher`
Expected: PASS.

- [ ] **Step 6: Build so dependents see the new exports**

Run: `pnpm --filter @megasaver/connectors-shared build`
Expected: exit 0.

- [ ] **Step 7: Biome + commit**

```bash
pnpm exec biome check packages/connectors/shared/src/launcher.ts packages/connectors/shared/src/index.ts packages/connectors/shared/test/launcher.test.ts
git add packages/connectors/shared/src/launcher.ts packages/connectors/shared/src/index.ts packages/connectors/shared/test/launcher.test.ts
git commit -m "feat(connectors-shared): add AgentLauncher interface + LauncherError

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `buildClaudeArgs` — pure argv builder (claude-code)

**Files:**
- Create: `packages/connectors/claude-code/src/launcher.ts` (argv builder portion; adapter added in Task 3)
- Test: `packages/connectors/claude-code/test/build-claude-args.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/connectors/claude-code/test/build-claude-args.test.ts`:

```ts
import { LauncherError, type LaunchInput } from "@megasaver/connectors-shared";
import { describe, expect, it } from "vitest";
import { buildClaudeArgs } from "../src/launcher.js";

function base(overrides: Partial<LaunchInput> = {}): LaunchInput {
  return {
    workdir: "/repo",
    instruction: "do the thing",
    model: "opus",
    permissionMode: "plan",
    allowedTools: [],
    sessionId: "11111111-1111-4111-8111-111111111111",
    ...overrides,
  };
}

describe("buildClaudeArgs", () => {
  it("builds the base argv with --session-id for a new run", () => {
    expect(buildClaudeArgs(base())).toEqual([
      "-p",
      "do the thing",
      "--output-format",
      "stream-json",
      "--verbose",
      "--model",
      "opus",
      "--permission-mode",
      "plan",
      "--session-id",
      "11111111-1111-4111-8111-111111111111",
    ]);
  });

  it("uses --resume (not --session-id) for a resumed run", () => {
    const args = buildClaudeArgs(base({ sessionId: undefined, resumeSessionId: "sess-abc" }));
    expect(args).toContain("--resume");
    expect(args[args.indexOf("--resume") + 1]).toBe("sess-abc");
    expect(args).not.toContain("--session-id");
  });

  it("maps acceptEdits and full permission modes", () => {
    expect(buildClaudeArgs(base({ permissionMode: "acceptEdits" }))).toContain("acceptEdits");
    expect(buildClaudeArgs(base({ permissionMode: "full" }))).toContain("bypassPermissions");
  });

  it("passes the model alias through", () => {
    expect(buildClaudeArgs(base({ model: "haiku" }))[6]).toBe("haiku");
  });

  it("includes --allowedTools only when non-empty", () => {
    const withTools = buildClaudeArgs(base({ allowedTools: ["Read", "Grep"] }));
    expect(withTools).toContain("--allowedTools");
    expect(withTools).toContain("Read");
    expect(withTools).toContain("Grep");
    expect(buildClaudeArgs(base())).not.toContain("--allowedTools");
  });

  it("appends persona via --append-system-prompt when set", () => {
    const args = buildClaudeArgs(base({ persona: "You are an architect." }));
    const i = args.indexOf("--append-system-prompt");
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe("You are an architect.");
    expect(buildClaudeArgs(base())).not.toContain("--append-system-prompt");
  });

  it("throws LauncherError when neither session id is provided", () => {
    expect(() => buildClaudeArgs(base({ sessionId: undefined }))).toThrow(LauncherError);
  });

  it("throws LauncherError when both session ids are provided", () => {
    expect(() => buildClaudeArgs(base({ resumeSessionId: "x" }))).toThrow(LauncherError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/connector-claude-code test build-claude-args`
Expected: FAIL — `../src/launcher.js` not found.

- [ ] **Step 3: Write the argv builder**

Create `packages/connectors/claude-code/src/launcher.ts` with (the adapter is appended in Task 3):

```ts
import {
  type LaunchInput,
  type LauncherPermissionMode,
  LauncherError,
} from "@megasaver/connectors-shared";

const PERMISSION_MODE_FLAG: Record<LauncherPermissionMode, string> = {
  plan: "plan",
  acceptEdits: "acceptEdits",
  full: "bypassPermissions",
};

export function buildClaudeArgs(input: LaunchInput): string[] {
  const hasNew = input.sessionId !== undefined;
  const hasResume = input.resumeSessionId !== undefined;
  if (hasNew === hasResume) {
    throw new LauncherError(
      "invalid_session_config",
      "Provide exactly one of sessionId or resumeSessionId.",
    );
  }

  const args = [
    "-p",
    input.instruction,
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    input.model,
    "--permission-mode",
    PERMISSION_MODE_FLAG[input.permissionMode],
  ];

  if (input.allowedTools.length > 0) {
    args.push("--allowedTools", ...input.allowedTools);
  }
  if (input.persona !== undefined) {
    args.push("--append-system-prompt", input.persona);
  }
  if (input.resumeSessionId !== undefined) {
    args.push("--resume", input.resumeSessionId);
  } else if (input.sessionId !== undefined) {
    args.push("--session-id", input.sessionId);
  }

  return args;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/connector-claude-code test build-claude-args`
Expected: PASS (all 8 cases).

- [ ] **Step 5: Biome + commit**

```bash
pnpm exec biome check packages/connectors/claude-code/src/launcher.ts packages/connectors/claude-code/test/build-claude-args.test.ts
git add packages/connectors/claude-code/src/launcher.ts packages/connectors/claude-code/test/build-claude-args.test.ts
git commit -m "feat(connector-claude-code): add buildClaudeArgs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `createClaudeCodeLauncher` — adapter with injectable spawn

**Files:**
- Modify: `packages/connectors/claude-code/src/launcher.ts` (append the adapter)
- Test: `packages/connectors/claude-code/test/launcher.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/connectors/claude-code/test/launcher.test.ts`:

```ts
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { LaunchInput } from "@megasaver/connectors-shared";
import { describe, expect, it, vi } from "vitest";
import { createClaudeCodeLauncher, type SpawnFn, type SpawnedChild } from "../src/launcher.js";

function makeFakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();
  return child;
}

function input(overrides: Partial<LaunchInput> = {}): LaunchInput {
  return {
    workdir: "/repo",
    instruction: "go",
    model: "sonnet",
    permissionMode: "plan",
    allowedTools: [],
    sessionId: "11111111-1111-4111-8111-111111111111",
    ...overrides,
  };
}

describe("createClaudeCodeLauncher", () => {
  it("spawns claude with built args and cwd=workdir", () => {
    const child = makeFakeChild();
    const spawn: SpawnFn = vi.fn(() => child as unknown as SpawnedChild);
    createClaudeCodeLauncher({ spawn }).launch(input());
    expect(spawn).toHaveBeenCalledOnce();
    const call = (spawn as unknown as { mock: { calls: [string, string[], { cwd: string }][] } }).mock
      .calls[0];
    expect(call[0]).toBe("claude");
    expect(call[2]).toEqual({ cwd: "/repo" });
    expect(call[1]).toContain("--session-id");
  });

  it("emits one stream event per JSON line, skips non-JSON, reassembles split lines", () => {
    const child = makeFakeChild();
    const handle = createClaudeCodeLauncher({ spawn: () => child as unknown as SpawnedChild }).launch(
      input(),
    );
    const payloads: unknown[] = [];
    handle.onEvent((e) => {
      if (e.kind === "stream") payloads.push(e.payload);
    });
    child.stdout.emit("data", '{"a":1}\n');
    child.stdout.emit("data", "not json\n");
    child.stdout.emit("data", '{"b":');
    child.stdout.emit("data", "2}\n");
    expect(payloads).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("emits stderr events", () => {
    const child = makeFakeChild();
    const handle = createClaudeCodeLauncher({ spawn: () => child as unknown as SpawnedChild }).launch(
      input(),
    );
    const errs: string[] = [];
    handle.onEvent((e) => {
      if (e.kind === "stderr") errs.push(e.text);
    });
    child.stderr.emit("data", "boom");
    expect(errs).toEqual(["boom"]);
  });

  it("flushes a trailing line and reports the exit code on close", () => {
    const child = makeFakeChild();
    const handle = createClaudeCodeLauncher({ spawn: () => child as unknown as SpawnedChild }).launch(
      input(),
    );
    const payloads: unknown[] = [];
    let exit: { code: number | null } | undefined;
    handle.onEvent((e) => {
      if (e.kind === "stream") payloads.push(e.payload);
    });
    handle.onExit((r) => {
      exit = r;
    });
    child.stdout.emit("data", '{"final":true}'); // no trailing newline
    child.emit("close", 0);
    expect(payloads).toEqual([{ final: true }]);
    expect(exit).toEqual({ code: 0 });
  });

  it("surfaces a spawn error as a stderr event + exit code null", () => {
    const child = makeFakeChild();
    const handle = createClaudeCodeLauncher({ spawn: () => child as unknown as SpawnedChild }).launch(
      input(),
    );
    const errs: string[] = [];
    let exit: { code: number | null } | undefined;
    handle.onEvent((e) => {
      if (e.kind === "stderr") errs.push(e.text);
    });
    handle.onExit((r) => {
      exit = r;
    });
    child.emit("error", new Error("spawn claude ENOENT"));
    expect(errs).toEqual(["spawn claude ENOENT"]);
    expect(exit).toEqual({ code: null });
  });

  it("cancel() sends SIGTERM", () => {
    const child = makeFakeChild();
    const handle = createClaudeCodeLauncher({ spawn: () => child as unknown as SpawnedChild }).launch(
      input(),
    );
    handle.cancel();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("handle.sessionId reflects the resume id", () => {
    const child = makeFakeChild();
    const handle = createClaudeCodeLauncher({ spawn: () => child as unknown as SpawnedChild }).launch(
      input({ sessionId: undefined, resumeSessionId: "resume-xyz" }),
    );
    expect(handle.sessionId).toBe("resume-xyz");
  });

  it("kind is claude-code", () => {
    expect(createClaudeCodeLauncher().kind).toBe("claude-code");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/connector-claude-code test launcher`
Expected: FAIL — `createClaudeCodeLauncher` / `SpawnFn` / `SpawnedChild` not exported.

- [ ] **Step 3: Append the adapter to `src/launcher.ts`**

Add these imports at the top of `packages/connectors/claude-code/src/launcher.ts` (merge with the existing import block — keep all imports at top):

```ts
import { spawn as nodeSpawn } from "node:child_process";
import type { Readable } from "node:stream";
import type {
  AgentLauncher,
  LaunchHandle,
  LauncherEvent,
} from "@megasaver/connectors-shared";
```

Then append:

```ts
export interface SpawnedChild {
  stdout: Readable | null;
  stderr: Readable | null;
  on(event: "close", listener: (code: number | null) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  kill(signal?: NodeJS.Signals): void;
}

export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: { cwd: string },
) => SpawnedChild;

const defaultSpawn: SpawnFn = (command, args, options) =>
  nodeSpawn(command, [...args], options) as unknown as SpawnedChild;

function toText(chunk: string | Buffer): string {
  return typeof chunk === "string" ? chunk : chunk.toString("utf8");
}

export function createClaudeCodeLauncher(options: { spawn?: SpawnFn } = {}): AgentLauncher {
  const spawn = options.spawn ?? defaultSpawn;

  return {
    kind: "claude-code",
    launch(input): LaunchHandle {
      const args = buildClaudeArgs(input); // throws on bad session config before spawning
      // buildClaudeArgs guarantees exactly one id is set.
      const sessionId = (input.resumeSessionId ?? input.sessionId) as string;

      const eventCbs: ((event: LauncherEvent) => void)[] = [];
      const exitCbs: ((result: { code: number | null }) => void)[] = [];
      const emitEvent = (event: LauncherEvent) => {
        for (const cb of eventCbs) cb(event);
      };
      const emitExit = (result: { code: number | null }) => {
        for (const cb of exitCbs) cb(result);
      };

      const child = spawn("claude", args, { cwd: input.workdir });

      let buffer = "";
      const emitLine = (line: string) => {
        const trimmed = line.trim();
        if (trimmed.length === 0) return;
        try {
          emitEvent({ kind: "stream", payload: JSON.parse(trimmed) });
        } catch {
          // Non-JSON line (verbose noise) — skip.
        }
      };

      child.stdout?.on("data", (chunk: string | Buffer) => {
        buffer += toText(chunk);
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) emitLine(line);
      });
      child.stderr?.on("data", (chunk: string | Buffer) => {
        emitEvent({ kind: "stderr", text: toText(chunk) });
      });
      child.on("error", (error) => {
        emitEvent({ kind: "stderr", text: error.message });
        emitExit({ code: null });
      });
      child.on("close", (code) => {
        if (buffer.trim().length > 0) emitLine(buffer);
        buffer = "";
        emitExit({ code });
      });

      return {
        sessionId,
        onEvent(cb) {
          eventCbs.push(cb);
        },
        onExit(cb) {
          exitCbs.push(cb);
        },
        cancel() {
          child.kill("SIGTERM");
        },
      };
    },
  };
}
```

Note: `defaultSpawn` casts the Node `ChildProcess` to `SpawnedChild` (`as unknown as`) because `ChildProcess`'s overloaded `on` is not structurally assignable to the narrowed two-overload `on` without a cast. This cast is confined to the one production line; tests inject a fake and never hit it.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/connector-claude-code test launcher`
Expected: PASS (all adapter cases).

- [ ] **Step 5: Run the full claude-code suite**

Run: `pnpm --filter @megasaver/connector-claude-code test`
Expected: green (new launcher tests + existing connector tests), 0 type errors.

- [ ] **Step 6: Biome + commit**

```bash
pnpm exec biome check packages/connectors/claude-code/src/launcher.ts packages/connectors/claude-code/test/launcher.test.ts
git add packages/connectors/claude-code/src/launcher.ts packages/connectors/claude-code/test/launcher.test.ts
git commit -m "feat(connector-claude-code): add createClaudeCodeLauncher

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Export adapter + changeset + full verify

**Files:**
- Modify: `packages/connectors/claude-code/src/index.ts`
- Create: `.changeset/agent-office-phase1-launcher.md`

- [ ] **Step 1: Export the launcher from the claude-code index**

Append to `packages/connectors/claude-code/src/index.ts`:

```ts
export {
  buildClaudeArgs,
  createClaudeCodeLauncher,
  type SpawnFn,
  type SpawnedChild,
} from "./launcher.js";
```

- [ ] **Step 2: Add a public-surface assertion to the adapter test**

Append to `packages/connectors/claude-code/test/launcher.test.ts`:

```ts
import * as claudeCodeApi from "../src/index.js";

describe("public surface", () => {
  it("re-exports the launcher entry points", () => {
    expect(claudeCodeApi).toHaveProperty("createClaudeCodeLauncher");
    expect(claudeCodeApi).toHaveProperty("buildClaudeArgs");
  });
});
```

- [ ] **Step 3: Run the claude-code suite**

Run: `pnpm --filter @megasaver/connector-claude-code test`
Expected: green.

- [ ] **Step 4: Write the changeset**

`.changeset/agent-office-phase1-launcher.md`:

```md
---
"@megasaver/connectors-shared": minor
"@megasaver/connector-claude-code": minor
---

Agent Office Phase 1: add the agent-agnostic AgentLauncher interface
(+ LauncherError) and a claude-code adapter that runs one headless
`claude -p` task with stream-json output. Spawn is injectable; the
engine/supervisor wiring lands in Phase 2.
```

- [ ] **Step 5: Full DoD gate**

Run: `pnpm verify`
Expected: Biome clean, tsc clean, all Vitest suites pass, conventions:check ok. If Biome flags formatting, run `pnpm lint:fix` and re-stage.

- [ ] **Step 6: Commit**

```bash
git add packages/connectors/claude-code/src/index.ts packages/connectors/claude-code/test/launcher.test.ts .changeset/agent-office-phase1-launcher.md
git commit -m "feat(connector-claude-code): export launcher + changeset

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Definition of Done

- [ ] `AgentLauncher`/`LaunchInput`/`LaunchHandle`/`LauncherEvent` + `LauncherError` exported from connectors-shared.
- [ ] `buildClaudeArgs` + `createClaudeCodeLauncher` (+ `SpawnFn`/`SpawnedChild`) exported from connector-claude-code.
- [ ] argv builder + adapter fully tested with an injected fake spawn; **no real `claude` spawned** anywhere.
- [ ] `pnpm verify` green.
- [ ] Changeset added (minor × 2).
- [ ] code-reviewer pass; per §12 HIGH also a critic adversarial pass. Author ≠ reviewer.

## Self-Review (plan author)

- **Spec coverage:** §1 interface → Task 1; §2 argv builder (flags, mode/model map, exactly-one-session-id throw) → Task 2; §3 adapter (injectable spawn, cwd, line-buffered JSON parse skipping non-JSON, stderr, error→null exit, close→code, cancel→SIGTERM, sessionId) → Task 3; §4 error handling → covered across Tasks 2–3 tests; §5 testing (no real claude) → fake spawn in Task 3; DoD/changeset → Task 4. Deviation from spec noted: spec mentioned `ClaudeCodeConnectorError("invalid_request")`, but that class is CLAUDE.md-projection-scoped (no such code, carries a filePath); the plan uses a dedicated `LauncherError("invalid_session_config")` in connectors-shared — cleaner and reusable by future adapters.
- **Placeholder scan:** none — all code complete.
- **Type consistency:** `LaunchInput`/`LaunchHandle`/`LauncherEvent`/`AgentLauncher`/`LauncherError`/`buildClaudeArgs`/`createClaudeCodeLauncher`/`SpawnFn`/`SpawnedChild` names are identical across interface, adapter, tests, and exports. `permissionMode` map values (`plan`/`acceptEdits`/`bypassPermissions`) and the model passthrough match the spec's grounded facts.
