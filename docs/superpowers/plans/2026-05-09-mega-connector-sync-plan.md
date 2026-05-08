# `mega connector sync` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `mega connector sync <projectName>` CLI subcommand that writes Mega Saver context blocks into the agent files declared by `KNOWN_TARGETS` (claude-code → `CLAUDE.md`, codex → `AGENTS.md`), using `connectors-shared` primitives directly.

**Architecture:** CLI handler reads/diffs/writes per target via the existing primitives (`readTargetFile`, `upsertBlock`, `renderBlock`, `writeTargetFile`, `assertProjectRoot`). Project resolution by name is inline (NFC-normalised). Session selection picks the latest open session whose `agentId` matches each target. Memory entries are `[]` in v0.1. Best-effort per-target failure: continue past errors, exit 1 if any target failed.

**Tech Stack:** TypeScript strict + ESM, Node 22, Vitest, Citty, Zod, `@megasaver/core`, `@megasaver/connectors-shared`, `@megasaver/connector-generic-cli` (for `codexTarget`), `@megasaver/shared`. pnpm workspaces, Biome lint/format.

**Spec:** `docs/superpowers/specs/2026-05-09-mega-connector-sync-design.md` (commit `603639d`).

**Risk:** MEDIUM — first CLI command that mutates user files. All write-side primitives are already tested in `connectors-shared` (PR #8/#9). Worktree mandatory; full superpowers chain; `code-reviewer` required pre-merge. Reviewer may upgrade to HIGH per CLAUDE.md §12.

**Worktree:** `.worktrees/mega-connector-sync` on branch `feat/mega-connector-sync`.

---

## File Structure

| File | Responsibility | New / Modify |
|------|----------------|--------------|
| `apps/cli/src/errors.ts` | Add `ConnectorError` mapping + `invalidTargetMessage` helper + `kind: "connector"` `ZodContext` variant | Modify |
| `apps/cli/test/errors.test.ts` | Tests for the new helper + mapper branches | Modify |
| `apps/cli/src/commands/connector.ts` | `runConnectorSync`, `connectorSyncCommand`, parent `connectorCommand`; KNOWN_TARGETS array; per-target loop with skip/seed/diff/write/error semantics | Create (built up across T2–T5) |
| `apps/cli/test/connector.test.ts` | All 13 unit cases from spec §5 | Create (built up across T2–T5) |
| `apps/cli/package.json` | Add `@megasaver/connectors-shared` and `@megasaver/connector-generic-cli` workspace deps | Modify |
| `apps/cli/src/main.ts` | Register `connector: connectorCommand` in `mainCommand.subCommands` | Modify (T6 only) |
| `wiki/entities/cli.md` | Document the new command | Modify (T6, post-merge fill of PR# / SHA) |
| `wiki/log.md` | Append `[2026-05-09] schema | mega connector sync` entry | Modify (T6) |
| `.changeset/mega-connector-sync.md` | `@megasaver/cli` minor | Create (T6) |

The single `apps/cli/src/commands/connector.ts` file follows the locked pattern in `apps/cli/src/commands/project.ts` and `apps/cli/src/commands/session.ts` (handler + Citty wrapper + parent in one file). Estimated end-state size ~250 LOC, well under the §8 split threshold.

---

## Task 1: CLI errors module — `ConnectorError` mapping + `invalidTargetMessage` + `kind: "connector"`

**Files:**
- Modify: `apps/cli/src/errors.ts`
- Modify: `apps/cli/test/errors.test.ts`
- Modify: `apps/cli/package.json` (add `@megasaver/connectors-shared` workspace dep so `errors.ts` can `import { ConnectorError }`)

- [ ] **Step 1: Add `@megasaver/connectors-shared` dep to the CLI package**

Edit `apps/cli/package.json`. In the `dependencies` block, add:

```json
    "@megasaver/connectors-shared": "workspace:*",
    "@megasaver/connector-generic-cli": "workspace:*",
```

(The second dep is for Task 3's `codexTarget` import; adding both now keeps the package.json edit atomic.) Run `pnpm install` from worktree root to update the lockfile.

```bash
pnpm install
```

Expected: lockfile updates without errors. No tests run yet.

- [ ] **Step 2: Write the failing tests**

Append to `apps/cli/test/errors.test.ts`:

```ts
import { ConnectorError } from "@megasaver/connectors-shared";
// (existing imports above; merge — do not duplicate)

describe("connector error mappings", () => {
  it("invalidTargetMessage formats expected list of valid targets", () => {
    expect(invalidTargetMessage("nope")).toEqual({
      message: 'error: invalid target "nope", expected: claude-code | codex',
      exitCode: 1,
    });
  });

  it("mapErrorToCliMessage funnels ConnectorError(context_invalid) with connector ctx", () => {
    const err = new ConnectorError("context_invalid", "Connector context is invalid.");
    expect(
      mapErrorToCliMessage(err, {
        kind: "connector",
        targetId: "claude-code",
        relativePath: "CLAUDE.md",
      }),
    ).toEqual({
      message: 'error: connector context invalid for target "claude-code": Connector context is invalid.',
      exitCode: 1,
    });
  });

  it("mapErrorToCliMessage funnels ConnectorError(block_conflict)", () => {
    const err = new ConnectorError(
      "block_conflict",
      "Found 2 BEGIN sentinels at lines 3, 17.",
      { filePath: "/tmp/CLAUDE.md" },
    );
    expect(
      mapErrorToCliMessage(err, {
        kind: "connector",
        targetId: "claude-code",
        relativePath: "CLAUDE.md",
      }),
    ).toEqual({
      message: "error: connector block conflict in CLAUDE.md: Found 2 BEGIN sentinels at lines 3, 17.",
      exitCode: 1,
    });
  });

  it("mapErrorToCliMessage funnels ConnectorError(file_read_failed)", () => {
    const err = new ConnectorError("file_read_failed", "Failed to read target file.", {
      filePath: "/tmp/CLAUDE.md",
    });
    expect(
      mapErrorToCliMessage(err, {
        kind: "connector",
        targetId: "claude-code",
        relativePath: "CLAUDE.md",
      }),
    ).toEqual({
      message: "error: connector failed to read CLAUDE.md: Failed to read target file.",
      exitCode: 1,
    });
  });

  it("mapErrorToCliMessage funnels ConnectorError(file_write_failed)", () => {
    const err = new ConnectorError("file_write_failed", "Failed to write target file.", {
      filePath: "/tmp/CLAUDE.md",
    });
    expect(
      mapErrorToCliMessage(err, {
        kind: "connector",
        targetId: "claude-code",
        relativePath: "CLAUDE.md",
      }),
    ).toEqual({
      message: "error: connector failed to write CLAUDE.md: Failed to write target file.",
      exitCode: 1,
    });
  });

  it("mapErrorToCliMessage funnels ConnectorError(target_path_invalid)", () => {
    const err = new ConnectorError(
      "target_path_invalid",
      "Project root must be an absolute path to an existing directory.",
      { filePath: "/tmp/missing" },
    );
    expect(mapErrorToCliMessage(err)).toEqual({
      message:
        "error: project root invalid: Project root must be an absolute path to an existing directory.",
      exitCode: 1,
    });
  });

  it("mapErrorToCliMessage falls back to raw message for ConnectorError without ctx", () => {
    const err = new ConnectorError("context_invalid", "Connector context is invalid.");
    expect(mapErrorToCliMessage(err)).toEqual({
      message: "error: context_invalid: Connector context is invalid.",
      exitCode: 1,
    });
  });
});
```

The new `invalidTargetMessage` import should be added to the existing top-of-file import block:

```ts
import {
  // ...existing helpers
  invalidTargetMessage,
  mapErrorToCliMessage,
  // ...
} from "../src/errors.js";
```

- [ ] **Step 3: Run tests, expect failure**

```bash
pnpm --filter @megasaver/cli test -- errors
```

Expected: import errors for `invalidTargetMessage` (not exported yet) and unrecognised `kind: "connector"` ZodContext variant.

- [ ] **Step 4: Implement the helper, the new context variant, and the mapper branches**

Edit `apps/cli/src/errors.ts`. Add the import at the top:

```ts
import { ConnectorError } from "@megasaver/connectors-shared";
```

Extend the `ZodContext` discriminated union (current 6 variants → 7):

```ts
export type ZodContext =
  | { kind: "name" }
  | { kind: "store" }
  | { kind: "title" }
  | { kind: "sessionId" }
  | { kind: "project"; name: string }
  | { kind: "session"; id: string }
  | { kind: "connector"; targetId: string; relativePath: string };
```

Add the `KNOWN_TARGET_IDS` constant and the `invalidTargetMessage` helper near the other validation helpers:

```ts
// Keep in sync with KNOWN_TARGETS in apps/cli/src/commands/connector.ts.
// Two-line tripwire so a third target lands intentionally with both arrays bumped.
const KNOWN_TARGET_IDS = ["claude-code", "codex"] as const;

export function invalidTargetMessage(value: string): CliMessage {
  return {
    message: `error: invalid target "${value}", expected: ${KNOWN_TARGET_IDS.join(" | ")}`,
    exitCode: 1,
  };
}
```

Extend `mapErrorToCliMessage` with a `ConnectorError` branch. Place it after the existing `CorePersistenceError` branch and before the generic `Error` fall-through:

```ts
  if (err instanceof ConnectorError) {
    if (ctx?.kind === "connector") {
      switch (err.code) {
        case "context_invalid":
          return {
            message: `error: connector context invalid for target "${ctx.targetId}": ${err.message}`,
            exitCode: 1,
          };
        case "block_conflict":
          return {
            message: `error: connector block conflict in ${ctx.relativePath}: ${err.message}`,
            exitCode: 1,
          };
        case "file_read_failed":
          return {
            message: `error: connector failed to read ${ctx.relativePath}: ${err.message}`,
            exitCode: 1,
          };
        case "file_write_failed":
          return {
            message: `error: connector failed to write ${ctx.relativePath}: ${err.message}`,
            exitCode: 1,
          };
        case "target_path_invalid":
          return {
            message: `error: project root invalid: ${err.message}`,
            exitCode: 1,
          };
      }
    }
    if (err.code === "target_path_invalid") {
      return {
        message: `error: project root invalid: ${err.message}`,
        exitCode: 1,
      };
    }
    return { message: `error: ${err.code}: ${err.message}`, exitCode: 1 };
  }
```

(`target_path_invalid` is the only code that fires from a project-level pre-check rather than a per-target loop. The CLI handler will call `assertProjectRoot` outside the target loop, with no `kind: "connector"` ctx; the second `if` covers that path with the spec's `error: project root invalid: ...` shape.)

- [ ] **Step 5: Run tests, expect green**

```bash
pnpm --filter @megasaver/cli test -- errors
```

Expected: 7 new tests pass + all pre-existing errors-module tests stay green.

- [ ] **Step 6: Run the full CLI suite for regression**

```bash
pnpm --filter @megasaver/cli test
```

Expected: 85 + 7 = 92 tests across 5 files, all green.

- [ ] **Step 7: Run typecheck + lint**

```bash
pnpm --filter @megasaver/cli typecheck
pnpm lint
```

Expected: both exit 0.

- [ ] **Step 8: Commit**

```bash
git add apps/cli/package.json apps/cli/src/errors.ts apps/cli/test/errors.test.ts pnpm-lock.yaml
git commit -m "feat(cli): add connector error mappings + helper"
```

---

## Task 2: `connector.ts` scaffold — project resolution, projectRoot guard, parent command

**Files:**
- Create: `apps/cli/src/commands/connector.ts`
- Create: `apps/cli/test/connector.test.ts`

This task creates the file with project resolution and the `assertProjectRoot` pre-check. The per-target loop is empty (returns 0 immediately if reached). Tests cover: project not found (case 9), invalid target flag (case 10), NFD project name resolves (case 11), `assertProjectRoot` rejects non-existent rootPath (case 13).

- [ ] **Step 1: Write the failing tests**

Create `apps/cli/test/connector.test.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectorSyncCommand } from "../src/commands/connector.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

describe("connectorSyncCommand — pre-target gates", () => {
  let store: string;
  let projectRoot: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-connector-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-cli-connector-root-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = 0;
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = 0;
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function seedProject(name: string, rootPath: string): Promise<void> {
    await mkdir(store, { recursive: true });
    const ts = "2026-05-09T00:00:00.000Z";
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        { id: PROJECT_ID, name, rootPath, createdAt: ts, updatedAt: ts },
      ]),
    );
    await writeFile(join(store, "sessions.json"), "[]");
  }

  async function runSync(args: { projectName: string; target?: string }): Promise<void> {
    const cliArgs: Record<string, string> = {
      projectName: args.projectName,
      store,
    };
    if (args.target !== undefined) cliArgs["target"] = args.target;
    await connectorSyncCommand.run?.({
      args: cliArgs,
      cmd: connectorSyncCommand,
      rawArgs: [],
      data: undefined,
    } as never);
  }

  it("rejects an unknown project with the documented error and emits no per-target lines", async () => {
    await seedProject("demo", projectRoot);
    await runSync({ projectName: "missing" });
    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.some((c) => c[0] === 'error: project "missing" not found')).toBe(true);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("rejects an invalid --target flag with the documented error", async () => {
    await seedProject("demo", projectRoot);
    await runSync({ projectName: "demo", target: "nope" });
    expect(process.exitCode).toBe(1);
    expect(
      errSpy.mock.calls.some(
        (c) => c[0] === 'error: invalid target "nope", expected: claude-code | codex',
      ),
    ).toBe(true);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("normalizes NFD project name input to NFC for resolution", async () => {
    // IMPORTANT: use explicit \u escapes. Editors silently normalize literal
    // accented chars on save, defeating the test. NFC: "caf" + U+00E9.
    await seedProject("café", projectRoot);
    // NFD CLI input: "cafe" + U+0301 (combining acute).
    await runSync({ projectName: "café" });
    // No targets exist in projectRoot yet, so all are skipped — exit 0.
    expect(process.exitCode).toBe(0);
    // The skipped lines come in T3; for this scaffold the loop is empty so
    // we only need to confirm the resolution succeeded (no error to stderr).
    expect(errSpy.mock.calls.every((c) => !(c[0] as string).startsWith("error:"))).toBe(true);
  });

  it("rejects a non-existent project rootPath via assertProjectRoot", async () => {
    const missing = join(tmpdir(), `megasaver-not-here-${Math.random().toString(36).slice(2)}`);
    await seedProject("demo", missing);
    await runSync({ projectName: "demo" });
    expect(process.exitCode).toBe(1);
    expect(
      errSpy.mock.calls.some((c) =>
        (c[0] as string).startsWith("error: project root invalid:"),
      ),
    ).toBe(true);
    expect(logSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests, expect failure (file does not exist)**

```bash
pnpm --filter @megasaver/cli test -- connector
```

Expected: import error — `apps/cli/src/commands/connector.ts` does not exist.

- [ ] **Step 3: Create `apps/cli/src/commands/connector.ts` scaffold**

```ts
import { assertProjectRoot } from "@megasaver/connectors-shared";
import { defineCommand } from "citty";
import { z } from "zod";
import {
  invalidTargetMessage,
  mapErrorToCliMessage,
  NAME_CONTROL_CHARS_MESSAGE,
  projectNotFoundMessage,
} from "../errors.js";
import { ensureStoreReady, resolveStorePath } from "../store.js";

const projectNameSchema = z
  .string()
  .trim()
  .min(1)
  // C0/C1 control chars and DEL break the line-oriented output protocol.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional
  .regex(/^[^\x00-\x1f\x7f-\x9f]+$/, NAME_CONTROL_CHARS_MESSAGE)
  .transform((value) => value.normalize("NFC"));

// Keep in sync with KNOWN_TARGET_IDS in apps/cli/src/errors.ts.
const KNOWN_TARGET_IDS = ["claude-code", "codex"] as const;
type KnownTargetId = (typeof KNOWN_TARGET_IDS)[number];

function isKnownTargetId(value: string): value is KnownTargetId {
  return (KNOWN_TARGET_IDS as readonly string[]).includes(value);
}

export type RunConnectorSyncInput = {
  projectName: string;
  targetFlag: string | undefined;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runConnectorSync(input: RunConnectorSyncInput): Promise<0 | 1> {
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

  let projectName: string;
  try {
    projectName = projectNameSchema.parse(input.projectName);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "name" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  if (input.targetFlag !== undefined && !isKnownTargetId(input.targetFlag)) {
    const cli = invalidTargetMessage(input.targetFlag);
    input.stderr(cli.message);
    return cli.exitCode;
  }

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) {
      input.stderr(`note: initialized store at ${rootDir}`);
    }
    const project = registry.listProjects().find((p) => p.name === projectName);
    if (!project) {
      const cli = projectNotFoundMessage(projectName);
      input.stderr(cli.message);
      return cli.exitCode;
    }

    try {
      await assertProjectRoot(project.rootPath);
    } catch (err) {
      const cli = mapErrorToCliMessage(err);
      input.stderr(cli.message);
      return cli.exitCode;
    }

    // Per-target loop lands in T3.
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const connectorSyncCommand = defineCommand({
  meta: { name: "sync", description: "Write Mega Saver context blocks into agent files." },
  args: {
    projectName: {
      type: "positional",
      required: true,
      description: "Project name (must already exist).",
    },
    target: {
      type: "string",
      description: "Optional target id to seed when its file does not exist.",
    },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const code = await runConnectorSync({
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      targetFlag: typeof args.target === "string" ? args.target : undefined,
      storeFlag: typeof args.store === "string" ? args.store : undefined,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      home: process.env["HOME"] ?? "",
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      xdgDataHome: process.env["XDG_DATA_HOME"],
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});

export const connectorCommand = defineCommand({
  meta: { name: "connector", description: "Manage Mega Saver connector targets." },
  subCommands: {
    sync: connectorSyncCommand,
  },
});
```

- [ ] **Step 4: Run tests, expect green**

```bash
pnpm --filter @megasaver/cli test -- connector
```

Expected: 4 scaffold tests pass.

- [ ] **Step 5: Full CLI suite + typecheck + lint**

```bash
pnpm --filter @megasaver/cli test
pnpm --filter @megasaver/cli typecheck
pnpm lint
```

Expected: all green; total CLI suite 92 + 4 = 96.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/commands/connector.ts apps/cli/test/connector.test.ts
git commit -m "feat(cli): add connector command scaffold"
```

---

## Task 3: Per-target loop — `KNOWN_TARGETS` array, `skipped`, `created`

**Files:**
- Modify: `apps/cli/src/commands/connector.ts`
- Modify: `apps/cli/test/connector.test.ts`

Adds the `KNOWN_TARGETS` array, the per-target iteration scaffolding, and the two simplest status branches: `skipped` (file does not exist and `--target` does not match) and `created` (file does not exist and `--target` matches the target id). The `wrote` / `noop` / `error` branches land in T4–T5.

Tests added: case 4 (skipped), case 5 (created), case 12 (empty projectRoot).

- [ ] **Step 1: Append the failing tests**

Append to `apps/cli/test/connector.test.ts` after the existing `describe("connectorSyncCommand — pre-target gates")` block:

```ts
import { readFile } from "node:fs/promises";
// (merge with existing top imports; do not duplicate)

const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const STARTED_AT = "2026-05-09T12:00:00.000Z";

describe("connectorSyncCommand — skipped + created", () => {
  let store: string;
  let projectRoot: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-connector-skip-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-cli-connector-skip-root-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = 0;
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = 0;
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function seedProjectWithSession(name: string): Promise<void> {
    await mkdir(store, { recursive: true });
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        { id: PROJECT_ID, name, rootPath: projectRoot, createdAt: STARTED_AT, updatedAt: STARTED_AT },
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
          title: "smoke",
          startedAt: STARTED_AT,
          endedAt: null,
        },
      ]),
    );
  }

  async function runSync(args: { projectName: string; target?: string }): Promise<void> {
    const cliArgs: Record<string, string> = { projectName: args.projectName, store };
    if (args.target !== undefined) cliArgs["target"] = args.target;
    await connectorSyncCommand.run?.({
      args: cliArgs,
      cmd: connectorSyncCommand,
      rawArgs: [],
      data: undefined,
    } as never);
  }

  it("prints two skipped lines for an empty projectRoot with no --target", async () => {
    await seedProjectWithSession("demo");
    await runSync({ projectName: "demo" });
    expect(process.exitCode).toBe(0);
    expect(logSpy.mock.calls.map((c) => c[0])).toEqual([
      "claude-code  CLAUDE.md  skipped",
      "codex        AGENTS.md  skipped",
    ]);
  });

  it("creates AGENTS.md when --target codex is given on an empty projectRoot", async () => {
    await seedProjectWithSession("demo");
    await runSync({ projectName: "demo", target: "codex" });
    expect(process.exitCode).toBe(0);
    expect(logSpy.mock.calls.map((c) => c[0])).toEqual([
      "claude-code  CLAUDE.md  skipped",
      "codex        AGENTS.md  created",
    ]);
    const written = await readFile(join(projectRoot, "AGENTS.md"), "utf8");
    expect(written).toMatch(/<!-- MEGA SAVER:BEGIN -->/);
    expect(written).toMatch(/<!-- MEGA SAVER:END -->/);
    expect(written).toContain("Agent: codex");
  });

  it("creates CLAUDE.md when --target claude-code is given on an empty projectRoot", async () => {
    await seedProjectWithSession("demo");
    await runSync({ projectName: "demo", target: "claude-code" });
    expect(process.exitCode).toBe(0);
    expect(logSpy.mock.calls.map((c) => c[0])).toEqual([
      "claude-code  CLAUDE.md  created",
      "codex        AGENTS.md  skipped",
    ]);
    const written = await readFile(join(projectRoot, "CLAUDE.md"), "utf8");
    expect(written).toContain("Agent: claude-code");
  });
});
```

Note: stdout columns use a fixed-width target id column. The two known target ids are `"claude-code"` (11 chars) and `"codex"` (5 chars). To keep columns aligned in the format `<target.id>  <relativePath>  <status>`, the implementation pads the target id to the longest known id length (11) before emitting. The test expectations above use the padded form (`"codex        AGENTS.md  ..."` has 8 spaces between `codex` and `AGENTS.md` — 6 spaces for the column padding plus 2-space delimiter). Confirm by counting spaces in the expectation strings.

- [ ] **Step 2: Run tests, expect failure**

```bash
pnpm --filter @megasaver/cli test -- connector
```

Expected: the new 3 tests fail (loop is empty in T2 scaffold). Existing 4 still pass.

- [ ] **Step 3: Implement KNOWN_TARGETS + per-target loop with skipped/created**

In `apps/cli/src/commands/connector.ts`, add the import for `codexTarget` and the connectors-shared primitives at the top:

```ts
import {
  type ConnectorContext,
  assertConnectorContext,
  assertProjectRoot,
  readTargetFile,
  renderBlock,
  writeTargetFile,
} from "@megasaver/connectors-shared";
import { type ConnectorTarget, codexTarget } from "@megasaver/connector-generic-cli";
```

(Replace the existing single-import line for `assertProjectRoot`.)

Below the existing `KNOWN_TARGET_IDS` constant, add the target list:

```ts
const CLAUDE_CODE_TARGET: ConnectorTarget = {
  id: "claude-code",
  agentId: "claude-code",
  relativePath: "CLAUDE.md",
};

const KNOWN_TARGETS: readonly ConnectorTarget[] = [CLAUDE_CODE_TARGET, codexTarget];

const TARGET_ID_COLUMN_WIDTH = Math.max(...KNOWN_TARGETS.map((t) => t.id.length));

function formatStatusLine(target: ConnectorTarget, status: string): string {
  return `${target.id.padEnd(TARGET_ID_COLUMN_WIDTH, " ")}  ${target.relativePath}  ${status}`;
}
```

Add a `node:path` import at the top (for `path.join`):

```ts
import { join } from "node:path";
```

Replace the `// Per-target loop lands in T3.` comment + the `return 0;` with the loop:

```ts
    for (const target of KNOWN_TARGETS) {
      const absPath = join(project.rootPath, target.relativePath);
      const existing = await readTargetFile(absPath);

      if (existing === null && input.targetFlag !== target.id) {
        input.stdout(formatStatusLine(target, "skipped"));
        continue;
      }

      if (existing === null) {
        // --target flag matched; seed the file with a fresh block.
        const context = buildConnectorContext(target, project, registry.listSessions(project.id));
        const newContent = renderBlock(context);
        await writeTargetFile({ absPath, content: newContent });
        input.stdout(formatStatusLine(target, "created"));
        continue;
      }

      // wrote/noop branches land in T4.
      input.stdout(formatStatusLine(target, "skipped"));
    }
    return 0;
```

Add the `buildConnectorContext` helper at module scope (after `formatStatusLine`):

```ts
import type { Project, Session } from "@megasaver/core";

function buildConnectorContext(
  target: ConnectorTarget,
  project: Project,
  allSessions: readonly Session[],
): ConnectorContext {
  const session = pickLatestOpenSession(allSessions, target.agentId);
  return assertConnectorContext({
    agentId: target.agentId,
    project,
    session,
    memoryEntries: [],
  });
}

function pickLatestOpenSession(
  sessions: readonly Session[],
  agentId: ConnectorTarget["agentId"],
): Session | null {
  const candidates = sessions.filter((s) => s.endedAt === null && s.agentId === agentId);
  if (candidates.length === 0) return null;
  return candidates.reduce((latest, current) =>
    current.startedAt > latest.startedAt ? current : latest,
  );
}
```

(The `Project` and `Session` type imports come from `@megasaver/core`.)

- [ ] **Step 4: Run tests, expect green**

```bash
pnpm --filter @megasaver/cli test -- connector
```

Expected: 4 + 3 = 7 connector tests pass. Note the third test case (claude-code created) currently uses the `existing === null + targetFlag matches` branch correctly because `--target claude-code` matches, while `--target codex` skips claude-code.

- [ ] **Step 5: Full suite + typecheck + lint**

```bash
pnpm --filter @megasaver/cli test
pnpm --filter @megasaver/cli typecheck
pnpm lint
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/commands/connector.ts apps/cli/test/connector.test.ts
git commit -m "feat(cli): connector loop, skipped + created"
```

---

## Task 4: `wrote` / `noop` — read existing, upsert, diff, write

**Files:**
- Modify: `apps/cli/src/commands/connector.ts`
- Modify: `apps/cli/test/connector.test.ts`

Adds the existing-file branch: read content, run `upsertBlock`, diff against existing, emit `noop` if equal else `wrote`. Tests added: case 1 (happy path two targets), case 2 (idempotent rerun), case 3 (mixed wrote+noop), case 7 (latest-open per agent), case 8 (no matching session → null).

- [ ] **Step 1: Append the failing tests**

Append to `apps/cli/test/connector.test.ts`:

```ts
const MEGA_BLOCK_PLACEHOLDER = (projectName: string, projectId: string, agent: string): string =>
  [
    "# Project notes",
    "",
    "<!-- MEGA SAVER:BEGIN -->",
    "# Mega Saver Context",
    "",
    `Agent: ${agent}`,
    `Project: ${projectName} (${projectId})`,
    "Session: stale",
    "Risk: low",
    "",
    "## Memory",
    "",
    "- none",
    "<!-- MEGA SAVER:END -->",
    "",
  ].join("\n");

describe("connectorSyncCommand — wrote + noop", () => {
  let store: string;
  let projectRoot: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-connector-wrote-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-cli-connector-wrote-root-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = 0;
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = 0;
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function seedProjectAndSessions(opts: {
    name: string;
    sessions: Array<{
      id: string;
      agentId: "claude-code" | "codex";
      title: string | null;
      startedAt: string;
      endedAt: string | null;
    }>;
  }): Promise<void> {
    await mkdir(store, { recursive: true });
    const ts = "2026-05-09T00:00:00.000Z";
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        { id: PROJECT_ID, name: opts.name, rootPath: projectRoot, createdAt: ts, updatedAt: ts },
      ]),
    );
    await writeFile(
      join(store, "sessions.json"),
      JSON.stringify(
        opts.sessions.map((s) => ({
          id: s.id,
          projectId: PROJECT_ID,
          agentId: s.agentId,
          riskLevel: "medium",
          title: s.title,
          startedAt: s.startedAt,
          endedAt: s.endedAt,
        })),
      ),
    );
  }

  async function runSync(args: { projectName: string; target?: string }): Promise<void> {
    const cliArgs: Record<string, string> = { projectName: args.projectName, store };
    if (args.target !== undefined) cliArgs["target"] = args.target;
    await connectorSyncCommand.run?.({
      args: cliArgs,
      cmd: connectorSyncCommand,
      rawArgs: [],
      data: undefined,
    } as never);
  }

  it("writes both targets when each file already exists with a stale block", async () => {
    await seedProjectAndSessions({
      name: "demo",
      sessions: [
        {
          id: SESSION_ID,
          agentId: "claude-code",
          title: "current",
          startedAt: STARTED_AT,
          endedAt: null,
        },
        {
          id: "33333333-3333-4333-8333-333333333333",
          agentId: "codex",
          title: "current-codex",
          startedAt: STARTED_AT,
          endedAt: null,
        },
      ],
    });
    await writeFile(
      join(projectRoot, "CLAUDE.md"),
      MEGA_BLOCK_PLACEHOLDER("demo", "old-id", "claude-code"),
    );
    await writeFile(
      join(projectRoot, "AGENTS.md"),
      MEGA_BLOCK_PLACEHOLDER("demo", "old-id", "codex"),
    );

    await runSync({ projectName: "demo" });

    expect(process.exitCode).toBe(0);
    expect(logSpy.mock.calls.map((c) => c[0])).toEqual([
      "claude-code  CLAUDE.md  wrote",
      "codex        AGENTS.md  wrote",
    ]);
    const claudeMd = await readFile(join(projectRoot, "CLAUDE.md"), "utf8");
    const agentsMd = await readFile(join(projectRoot, "AGENTS.md"), "utf8");
    expect(claudeMd).toContain(`Project: demo (${PROJECT_ID})`);
    expect(claudeMd).toContain("Session: current");
    expect(agentsMd).toContain(`Project: demo (${PROJECT_ID})`);
    expect(agentsMd).toContain("Session: current-codex");
    // Old id is gone.
    expect(claudeMd).not.toContain("old-id");
    expect(agentsMd).not.toContain("old-id");
  });

  it("emits noop on idempotent rerun (block content unchanged)", async () => {
    await seedProjectAndSessions({
      name: "demo",
      sessions: [
        {
          id: SESSION_ID,
          agentId: "claude-code",
          title: "current",
          startedAt: STARTED_AT,
          endedAt: null,
        },
      ],
    });
    // First sync seeds the files.
    await runSync({ projectName: "demo", target: "claude-code" });
    // Reset spies to isolate the rerun output.
    logSpy.mockClear();
    errSpy.mockClear();

    await runSync({ projectName: "demo", target: "claude-code" });

    expect(process.exitCode).toBe(0);
    expect(logSpy.mock.calls.map((c) => c[0])).toEqual([
      "claude-code  CLAUDE.md  noop",
      "codex        AGENTS.md  skipped",
    ]);
  });

  it("emits mixed statuses when only one target's content changed", async () => {
    await seedProjectAndSessions({
      name: "demo",
      sessions: [
        {
          id: SESSION_ID,
          agentId: "claude-code",
          title: "v1",
          startedAt: STARTED_AT,
          endedAt: null,
        },
      ],
    });
    // Seed both files.
    await runSync({ projectName: "demo", target: "claude-code" });
    await runSync({ projectName: "demo", target: "codex" });
    logSpy.mockClear();

    // Bump the claude-code session title via store edit.
    await writeFile(
      join(store, "sessions.json"),
      JSON.stringify([
        {
          id: SESSION_ID,
          projectId: PROJECT_ID,
          agentId: "claude-code",
          riskLevel: "medium",
          title: "v2",
          startedAt: STARTED_AT,
          endedAt: null,
        },
      ]),
    );

    await runSync({ projectName: "demo" });

    expect(process.exitCode).toBe(0);
    expect(logSpy.mock.calls.map((c) => c[0])).toEqual([
      "claude-code  CLAUDE.md  wrote",
      "codex        AGENTS.md  noop",
    ]);
  });

  it("picks latest open session per agent (multiple sessions of same agent)", async () => {
    await seedProjectAndSessions({
      name: "demo",
      sessions: [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          agentId: "claude-code",
          title: "old-open",
          startedAt: "2026-05-09T10:00:00.000Z",
          endedAt: null,
        },
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          agentId: "claude-code",
          title: "newest-open",
          startedAt: "2026-05-09T12:00:00.000Z",
          endedAt: null,
        },
        {
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          agentId: "claude-code",
          title: "ended",
          startedAt: "2026-05-09T13:00:00.000Z",
          endedAt: "2026-05-09T13:30:00.000Z",
        },
      ],
    });
    await runSync({ projectName: "demo", target: "claude-code" });

    const claudeMd = await readFile(join(projectRoot, "CLAUDE.md"), "utf8");
    expect(claudeMd).toContain("Session: newest-open");
    expect(claudeMd).not.toContain("old-open");
    expect(claudeMd).not.toContain("ended");
  });

  it("renders Session: none when no matching open session exists", async () => {
    await seedProjectAndSessions({
      name: "demo",
      sessions: [
        {
          id: SESSION_ID,
          agentId: "claude-code",
          title: "ended",
          startedAt: STARTED_AT,
          endedAt: "2026-05-09T13:00:00.000Z",
        },
      ],
    });
    await runSync({ projectName: "demo", target: "claude-code" });
    const claudeMd = await readFile(join(projectRoot, "CLAUDE.md"), "utf8");
    expect(claudeMd).toContain("Session: none");
  });
});
```

- [ ] **Step 2: Run tests, expect failure**

```bash
pnpm --filter @megasaver/cli test -- connector
```

Expected: the 5 new tests fail (existing-file branch returns `skipped` placeholder from T3).

- [ ] **Step 3: Implement the existing-file branch**

In `apps/cli/src/commands/connector.ts`, replace the placeholder block at the end of the per-target loop:

```ts
      // wrote/noop branches land in T4.
      input.stdout(formatStatusLine(target, "skipped"));
```

…with the real diff-and-write logic. Also import `upsertBlock` (extend the existing `connectors-shared` import block):

```ts
import {
  type ConnectorContext,
  assertConnectorContext,
  assertProjectRoot,
  readTargetFile,
  renderBlock,
  upsertBlock,
  writeTargetFile,
} from "@megasaver/connectors-shared";
```

Replace the placeholder with:

```ts
      const context = buildConnectorContext(target, project, registry.listSessions(project.id));
      const newContent = upsertBlock({ existingContent: existing, context });
      if (newContent === existing) {
        input.stdout(formatStatusLine(target, "noop"));
        continue;
      }
      await writeTargetFile({ absPath, content: newContent });
      input.stdout(formatStatusLine(target, "wrote"));
```

- [ ] **Step 4: Run tests, expect green**

```bash
pnpm --filter @megasaver/cli test -- connector
```

Expected: all 12 connector tests pass.

- [ ] **Step 5: Full suite + typecheck + lint**

```bash
pnpm --filter @megasaver/cli test
pnpm --filter @megasaver/cli typecheck
pnpm lint
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/commands/connector.ts apps/cli/test/connector.test.ts
git commit -m "feat(cli): connector wrote + noop"
```

---

## Task 5: Best-effort partial failure — per-target try/catch + ConnectorError reporting

**Files:**
- Modify: `apps/cli/src/commands/connector.ts`
- Modify: `apps/cli/test/connector.test.ts`

Wraps the per-target body in a try/catch that maps `ConnectorError` via the new `kind: "connector"` ZodContext path. Records whether any target failed; returns 1 if so, 0 otherwise. Test added: case 6 (one wrote + one error, exit 1).

- [ ] **Step 1: Append the failing test**

Append to `apps/cli/test/connector.test.ts`:

```ts
import { ConnectorError } from "@megasaver/connectors-shared";
// (merge with top imports)

describe("connectorSyncCommand — best-effort partial failure", () => {
  let store: string;
  let projectRoot: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-connector-fail-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-cli-connector-fail-root-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = 0;
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = 0;
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function seedSimple(): Promise<void> {
    await mkdir(store, { recursive: true });
    const ts = "2026-05-09T00:00:00.000Z";
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        { id: PROJECT_ID, name: "demo", rootPath: projectRoot, createdAt: ts, updatedAt: ts },
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
          title: "smoke",
          startedAt: STARTED_AT,
          endedAt: null,
        },
      ]),
    );
  }

  async function runSync(args: { projectName: string; target?: string }): Promise<void> {
    const cliArgs: Record<string, string> = { projectName: args.projectName, store };
    if (args.target !== undefined) cliArgs["target"] = args.target;
    await connectorSyncCommand.run?.({
      args: cliArgs,
      cmd: connectorSyncCommand,
      rawArgs: [],
      data: undefined,
    } as never);
  }

  it("continues past a per-target block_conflict, reports both targets, exits 1", async () => {
    await seedSimple();
    // Seed CLAUDE.md cleanly so it can be written.
    await writeFile(join(projectRoot, "CLAUDE.md"), "# Notes\n");
    // Seed AGENTS.md with two BEGIN sentinels — parseBlock throws block_conflict.
    await writeFile(
      join(projectRoot, "AGENTS.md"),
      [
        "<!-- MEGA SAVER:BEGIN -->",
        "first block",
        "<!-- MEGA SAVER:END -->",
        "",
        "<!-- MEGA SAVER:BEGIN -->",
        "second block",
        "<!-- MEGA SAVER:END -->",
        "",
      ].join("\n"),
    );

    await runSync({ projectName: "demo" });

    expect(process.exitCode).toBe(1);
    const stdoutLines = logSpy.mock.calls.map((c) => c[0]);
    expect(stdoutLines).toEqual([
      "claude-code  CLAUDE.md  wrote",
      "codex        AGENTS.md  error",
    ]);
    expect(
      errSpy.mock.calls.some(
        (c) =>
          (c[0] as string).startsWith("error: connector block conflict in AGENTS.md:") &&
          (c[0] as string).includes("BEGIN"),
      ),
    ).toBe(true);
  });

  it("surfaces a ConnectorError(file_write_failed) as per-target error, exit 1", async () => {
    await seedSimple();
    // Seed CLAUDE.md as a SYMLINK — connectors-shared writeTargetFile refuses to replace it.
    const { symlink } = await import("node:fs/promises");
    const tempTarget = join(tmpdir(), `megasaver-symlink-target-${Math.random().toString(36).slice(2)}`);
    await writeFile(tempTarget, "not the real target\n");
    await symlink(tempTarget, join(projectRoot, "CLAUDE.md"));

    await runSync({ projectName: "demo" });

    expect(process.exitCode).toBe(1);
    expect(logSpy.mock.calls.map((c) => c[0])[0]).toBe("claude-code  CLAUDE.md  error");
    expect(
      errSpy.mock.calls.some((c) =>
        (c[0] as string).startsWith("error: connector failed to write CLAUDE.md:"),
      ),
    ).toBe(true);
    await rm(tempTarget, { force: true });
  });
});
```

- [ ] **Step 2: Run tests, expect failure**

```bash
pnpm --filter @megasaver/cli test -- connector
```

Expected: 2 new tests fail. Without per-target try/catch the loop currently throws and aborts — exit code may be 1 already but stdout shape and stderr message are wrong.

- [ ] **Step 3: Implement per-target error handling**

In `apps/cli/src/commands/connector.ts`, refactor the body of the `for (const target of KNOWN_TARGETS)` loop. Wrap everything inside the loop body in a try/catch:

```ts
    let anyFailed = false;
    for (const target of KNOWN_TARGETS) {
      try {
        const absPath = join(project.rootPath, target.relativePath);
        const existing = await readTargetFile(absPath);

        if (existing === null && input.targetFlag !== target.id) {
          input.stdout(formatStatusLine(target, "skipped"));
          continue;
        }

        const context = buildConnectorContext(
          target,
          project,
          registry.listSessions(project.id),
        );

        if (existing === null) {
          const newContent = renderBlock(context);
          await writeTargetFile({ absPath, content: newContent });
          input.stdout(formatStatusLine(target, "created"));
          continue;
        }

        const newContent = upsertBlock({ existingContent: existing, context });
        if (newContent === existing) {
          input.stdout(formatStatusLine(target, "noop"));
          continue;
        }
        await writeTargetFile({ absPath, content: newContent });
        input.stdout(formatStatusLine(target, "wrote"));
      } catch (err) {
        anyFailed = true;
        input.stdout(formatStatusLine(target, "error"));
        const cli = mapErrorToCliMessage(err, {
          kind: "connector",
          targetId: target.id,
          relativePath: target.relativePath,
        });
        input.stderr(cli.message);
      }
    }
    return anyFailed ? 1 : 0;
```

(Remove the previous unconditional `return 0;` at the end of the try block; the `return anyFailed ? 1 : 0;` replaces it.)

- [ ] **Step 4: Run tests, expect green**

```bash
pnpm --filter @megasaver/cli test -- connector
```

Expected: all 14 connector tests pass (12 from T2-T4 + 2 new).

- [ ] **Step 5: Full suite + typecheck + lint**

```bash
pnpm --filter @megasaver/cli test
pnpm --filter @megasaver/cli typecheck
pnpm lint
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/commands/connector.ts apps/cli/test/connector.test.ts
git commit -m "feat(cli): connector best-effort partial failure"
```

---

## Task 6: Wire into root + smoke + wiki + changeset + verify + PR

**Files:**
- Modify: `apps/cli/src/main.ts`
- Modify: `wiki/entities/cli.md`
- Modify: `wiki/log.md`
- Modify: `wiki/index.md`
- Create: `.changeset/mega-connector-sync.md`

- [ ] **Step 1: Register the connector command in `main.ts`**

Edit `apps/cli/src/main.ts`. Add the import and register the subcommand:

```ts
import { createRequire } from "node:module";
import { defineCommand } from "citty";
import { connectorCommand } from "./commands/connector.js";
import { doctorCommand } from "./commands/doctor.js";
import { projectCommand } from "./commands/project.js";
import { sessionCommand } from "./commands/session.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

export const mainCommand = defineCommand({
  meta: {
    name: "mega",
    version: pkg.version,
    description: "Mega Saver - ContextOps platform CLI.",
  },
  subCommands: {
    doctor: doctorCommand,
    project: projectCommand,
    session: sessionCommand,
    connector: connectorCommand,
  },
});
```

- [ ] **Step 2: Build + smoke**

```bash
pnpm build
SMOKE_STORE=$(mktemp -d)
SMOKE_PROJ=$(mktemp -d)
node apps/cli/dist/cli.js project create demo --store "$SMOKE_STORE"
# manually edit the project's rootPath to $SMOKE_PROJ — `mega project create`
# defaults rootPath to process.cwd(); v0.2 will add a flag.
node -e "
const fs = require('node:fs');
const path = require('node:path');
const file = path.join('$SMOKE_STORE', 'projects.json');
const projects = JSON.parse(fs.readFileSync(file, 'utf8'));
projects[0].rootPath = '$SMOKE_PROJ';
fs.writeFileSync(file, JSON.stringify(projects));
"
node apps/cli/dist/cli.js session create demo --agent claude-code --title "smoke session" --store "$SMOKE_STORE"
node apps/cli/dist/cli.js connector sync demo --target claude-code --store "$SMOKE_STORE"   # claude-code created, codex skipped
node apps/cli/dist/cli.js connector sync demo --store "$SMOKE_STORE"                          # claude-code noop, codex skipped
node apps/cli/dist/cli.js connector sync demo --target codex --store "$SMOKE_STORE"          # claude-code noop, codex created
cat "$SMOKE_PROJ/CLAUDE.md"
cat "$SMOKE_PROJ/AGENTS.md"
rm -rf "$SMOKE_STORE" "$SMOKE_PROJ"
```

Capture the captured `cat` output for the PR description. Expected: each file contains a `<!-- MEGA SAVER:BEGIN --> ... <!-- MEGA SAVER:END -->` block with `Project: demo (<id>)`, `Session: smoke session` (claude-code) / `Session: none` (codex, no codex session created), `Memory: - none`.

- [ ] **Step 3: `pnpm verify`**

```bash
pnpm verify
```

Expected: lint + typecheck + tests all green across every package.

- [ ] **Step 4: Add changeset**

Create `.changeset/mega-connector-sync.md`:

```markdown
---
"@megasaver/cli": minor
---

feat: add `mega connector sync` CLI command

Wires the existing `@megasaver/connectors-shared` and
`@megasaver/connector-generic-cli` primitives into a single user-facing
verb. `mega connector sync <projectName>` writes a Mega Saver block
into each known agent file (`CLAUDE.md`, `AGENTS.md`) under the
project's `rootPath`. Default behaviour skips files that do not
already exist; `--target <id>` opts a specific target into seeding.
Best-effort partial failure: each target reports its status (`wrote`,
`noop`, `created`, `skipped`, `error`) on stdout; exit 1 if any
target failed.
```

(Only `@megasaver/cli` bumps; the connector packages are unchanged.)

- [ ] **Step 5: Update `wiki/entities/cli.md`**

Add a new subsection under `Current slice` (after the `mega session end` block):

```markdown
### `mega connector sync <projectName> [--target <id>]`

Writes the Mega Saver context block into each known agent file
under the project's `rootPath`. v0.1 known targets:
- `claude-code` → `CLAUDE.md`
- `codex` → `AGENTS.md`

For each target the command reads the existing file, runs
`upsertBlock`, diff-checks against the existing content, and writes
only when the block changed. Files that do not yet exist are
silently `skipped` unless `--target <id>` opts in to seed exactly
that one. The session embedded in the block is the latest open
session whose `agentId` matches the target; `null` (`Session: none`)
when no match. Memory entries are empty in v0.1.

Status words on stdout: `wrote`, `noop`, `created`, `skipped`,
`error`. Best-effort partial failure: per-target errors emit on
stderr, the loop continues, exit 1 if any target failed.
```

Bump `updated:` frontmatter to `2026-05-09`. Append to the `Risk` section a new line:

> Connector sync: PR #TBD (`<merge-sha>`).

(TBD placeholders fill in post-merge per the established pattern.)

- [ ] **Step 6: Append to `wiki/log.md`**

```markdown
## [2026-05-09] schema | mega connector sync

PR #TBD (`<merge-sha>`): new `mega connector sync <projectName>`
CLI command. Wires `@megasaver/connectors-shared` primitives
(`readTargetFile`, `upsertBlock`, `renderBlock`, `writeTargetFile`,
`assertProjectRoot`) into a per-target loop with five status
words (`wrote`, `noop`, `created`, `skipped`, `error`). Two known
targets in v0.1: `claude-code` (`CLAUDE.md`) and `codex`
(`AGENTS.md`). `--target <id>` opts in to seed a missing file.
CLI errors module gained the `ConnectorError` mapping branch + the
`{ kind: "connector"; targetId; relativePath }` `ZodContext`
variant + the `invalidTargetMessage` helper with a matching
`KNOWN_TARGET_IDS` drift guard. Tests: 14 new CLI (4 pre-target
gates + 3 skipped/created + 5 wrote/noop/agent-selection + 2
best-effort failure), 7 new errors-module. Two-stage external
review per task (subagent-driven development) returned 0 Blocking.
Tracked follow-ups for v0.2: `mega project create --root <dir>`
to remove the smoke flow's manual `projects.json` edit, `mega
connector status` (read-only), per-project manifest, MemoryEntry
CLI integration to populate the now-empty memory list, JSON output
flag pass, Cursor + Aider targets.
```

- [ ] **Step 7: Update `wiki/index.md` Status section**

Replace the current Status block with a new opening sentence (keep the rest):

```markdown
## Status

`mega connector sync` landed on `main` via PR #TBD (`<merge-sha>`):
new CLI command writing Mega Saver context blocks into agent files
(`CLAUDE.md`, `AGENTS.md`) per project. CLI errors module gained
`ConnectorError` mapping + `invalidTargetMessage` helper. Six
packages on `main`: ... [keep the existing package counts list
unchanged but bump `@megasaver/cli` from 85 → 99 tests; total 345 →
359].
```

(The exact diff is mechanical; keep all text below the new opening
sentence and just bump test counts on the cli line.)

- [ ] **Step 8: Commit wiki + changeset + main.ts**

```bash
git add apps/cli/src/main.ts wiki/entities/cli.md wiki/log.md wiki/index.md .changeset/mega-connector-sync.md
git commit -m "feat(cli): wire connector sync + wiki + changeset"
```

- [ ] **Step 9: Final `pnpm verify` from worktree root**

```bash
pnpm verify
```

Expected: all green.

- [ ] **Step 10: Push branch + open PR**

```bash
git push -u origin feat/mega-connector-sync
gh pr create --title "feat(cli): mega connector sync" --body "$(cat <<'EOF'
## Summary

- `@megasaver/cli`: new `mega connector sync <projectName> [--target <id>]` command. Wires `connectors-shared` primitives (`readTargetFile`, `upsertBlock`, `renderBlock`, `writeTargetFile`, `assertProjectRoot`) into a per-target loop. Two known targets in v0.1: `claude-code` (`CLAUDE.md`) and `codex` (`AGENTS.md`).
- CLI errors module: `ConnectorError` mapping (5 codes), `{ kind: "connector"; targetId; relativePath }` `ZodContext` variant, `invalidTargetMessage` helper with `KNOWN_TARGET_IDS` drift guard.

## Status words

- `wrote` — file existed, block content changed, file rewritten.
- `noop` — file existed, block content unchanged, no write.
- `created` — file did not exist, `--target` opted in, file seeded.
- `skipped` — file did not exist and `--target` did not match this target.
- `error` — per-target failure (block conflict, write refused, etc.); detail on stderr.

## Test plan

- [x] `pnpm verify` green (lint + typecheck + all packages).
- [x] Smoke transcript captured (project + session + sync x3 + cat both files).
- [x] Spec at `docs/superpowers/specs/2026-05-09-mega-connector-sync-design.md`.
- [x] Plan at `docs/superpowers/plans/2026-05-09-mega-connector-sync-plan.md`.
- [ ] `code-reviewer` agent pass.

## Risk

MEDIUM — first CLI command that mutates user files. All write-side primitives are already test-covered in `connectors-shared` (PR #8/#9). Per-target best-effort failure isolates blast radius.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Capture the PR URL.

---

## Verification checklist (post-merge, on `main`)

- `pnpm verify` green.
- Six packages still build. Test counts: shared 22, core 116, cli 99 (was 85, +14), connectors-shared 56, connector-claude-code 45, connector-generic-cli 21. Total 359 (was 345).
- `mega connector --help` shows `sync` subcommand.
- Smoke flow reproduces (manual `rootPath` edit step still required).
