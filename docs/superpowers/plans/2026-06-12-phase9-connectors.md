# Phase 9 — Multi-Agent Connectors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Widen the **already-shipped** connector subsystem with three new config-file agents — `gemini` (`GEMINI.md`), `windsurf` (`.windsurfrules`), `continue` (`.continue/rules/megasaver.md`) — each a frozen `ConnectorTarget` object + one `agentIdSchema` literal (NO new sync code); add `mega connector list` and `mega connector doctor` to the existing `connector` group; and prove the roadmap exit ("same project memory shared across agents") with a cross-agent integration test. `vscode`/`jetbrains` (native IDE plugins) and a `mega connect` rename are out of scope.

**Architecture:** A new agent is **data, not code**. `runConnectorSync` / `runConnectorStatus` iterate `KNOWN_TARGETS` and need no per-agent branch (the seed path already prepends an optional `header` and `mkdir -p`s the parent). So each new target is `{ id, agentId, relativePath }` (no `header`) in `@megasaver/connector-generic-cli`, registered in the CLI's `apps/cli/src/known-targets.ts` `KNOWN_TARGETS` (and the GUI bridge mirror). The agentId widening is a **contract change**: it ripples to derived consumers (auto), two exhaustive maps/mirrors (`badges.tsx` `Record<AgentId,…>`, `session-forms.tsx` `AGENT_IDS`), and several pinned drift-guard tests (`agent-id.test.ts`/`.test-d.ts`, GUI tests) — all updated in lockstep. `list`/`doctor` reuse `resolveProjectAndRoot` / `buildConnectorContext` / `upsertBlock` / `formatStatusLine`; `doctor` adds an `access(…, W_OK)` writability probe (no write). The `knownAgentIdSchema` / `detectAgent` MCP-install enum is a SEPARATE, narrower set and stays UNTOUCHED.

**Tech Stack:** TypeScript strict ESM (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), Zod, Vitest, Citty (CLI), pnpm + Turborepo, Biome. Reuses the shipped connector machinery verbatim (`ConnectorTarget`, `buildConnectorContext`, `upsertBlock`/`parseBlock`, `syncGenericCliTarget`, `readTargetFile`/`writeTargetFile`, `KNOWN_TARGETS`/`isKnownTargetId`). No LLM, no new package, no new error codes.

**Spec:** `docs/superpowers/specs/2026-06-12-phase9-connectors-design.md`

**Working dir:** `/Users/halitozger/Desktop/MegaSaver/.worktrees/phase9-connectors` (branch `feat/phase9-connectors`, off `main` @ Phase 8). All `pnpm`/`git` run from there.

**Test commands:** per-package `pnpm --filter @megasaver/<pkg> test --run <pattern>`; type `pnpm --filter @megasaver/<pkg> typecheck`. Final gate: `pnpm verify` (= lint `biome check .` over the whole repo + typecheck + test + `conventions:check`). Run `biome check --write` on every new/edited file before committing so lint stays clean. Workspace packages resolve to built `dist/`; if a dependent test fails on an unresolved `@megasaver/*` import, build that dep first (`pnpm --filter @megasaver/shared build`, `pnpm --filter @megasaver/connector-generic-cli build`).

---

## File map

**Modify (shared — the enum, 5 → 8 members):**
- `packages/shared/src/agent-id.ts` — add `"continue"`, `"gemini"`, `"windsurf"` (alphabetical).
- `packages/shared/test/agent-id.test.ts` — extend `members`, bump length, update `.options` tuple, explicit parse assertions.
- `packages/shared/test/agent-id.test-d.ts` — update `.options` ordered-tuple type + add assignable members.

**Modify (generic-cli — three target objects):**
- `packages/connectors/generic-cli/src/targets.ts` — add `geminiTarget`, `windsurfTarget`, `continueTarget`; widen `builtinTargets`.
- `packages/connectors/generic-cli/src/index.ts` — re-export the three.
- `packages/connectors/generic-cli/test/targets.test.ts` — tests for the three.

**Modify (CLI — register targets + new commands):**
- `apps/cli/src/known-targets.ts` — import + append the three to `KNOWN_TARGETS`.
- `apps/cli/src/commands/connector/list.ts` — **create** `runConnectorList` + `connectorListCommand`.
- `apps/cli/src/commands/connector/doctor.ts` — **create** `runConnectorDoctor` + `connectorDoctorCommand`.
- `apps/cli/src/commands/connector/index.ts` — register `list` + `doctor` subcommands; re-export.
- `apps/cli/test/connector.test.ts` — sync tests for the three new targets.
- `apps/cli/test/connector-status.test.ts` — status tests for the three new targets.
- `apps/cli/test/connector-list.test.ts` — **create**.
- `apps/cli/test/connector-doctor.test.ts` — **create**.
- `apps/cli/test/connector-cross-agent.test.ts` — **create** (exit-criterion proof).
- `apps/cli/test/session.test.ts` — `--agent gemini` smoke.

**Modify (GUI — exhaustive map + mirror + pinned tests):**
- `apps/gui/bridge/known-targets.ts` — append the three to the GUI `KNOWN_TARGETS` mirror.
- `apps/gui/src/components/badges.tsx` — add `gemini`/`windsurf`/`continue` keys to `AGENT_LABEL: Record<AgentId,string>`.
- `apps/gui/src/components/session-forms.tsx` — append the three to the `AGENT_IDS` tuple (alphabetical).
- `apps/gui/test/components/badges.test.tsx` — render assertions for the three labels.
- `apps/gui/test/components/session-forms.test.tsx` — update the expected dropdown-options array.

**Create (release):** `.changeset/phase9-connectors.md`.

**Modify (wiki — per project §0 rule):** `wiki/entities/connectors-generic-cli.md`, `wiki/entities/cli.md`, `wiki/entities/shared.md`, `wiki/syntheses/contextops-roadmap.md` (mark Phase 9 done), `wiki/index.md`, `wiki/log.md`.

**NOT touched (scope boundary — spec §6d):** `packages/mcp-bridge/src/setup/agent-ids.ts`, `detect-agent.ts`, `apps/gui/bridge/zod-schemas.ts` MCP bodies. `scripts/conventions-sync/src/manifest.ts` (the new files are not conventions consumers — spec §2a).

---

## Conventions every task obeys

- Caveman-commit: subject ≤ 50 chars, imperative; body only when WHY is non-obvious.
- TDD: write the failing test, run RED, implement, run GREEN, commit.
- After each task run the affected package's test command; after the final task run `pnpm verify`.
- The four shipped targets (`claude-code`/`codex`/`cursor`/`aider`) MUST stay byte-identical — no behaviour change.
- One commit per task (commands given per task).

---

## Task 1: `@megasaver/shared` — widen `AgentId` by three (contract change)

**Files:** Modify `packages/shared/src/agent-id.ts`, `packages/shared/test/agent-id.test.ts`, `packages/shared/test/agent-id.test-d.ts`.

**Goal:** Widen the closed `AgentId` enum from 5 → 8 members (`continue`, `gemini`, `windsurf`), alphabetically, and update the hand-maintained drift guards.

- [ ] **Step 1: Update the runtime drift-guard test (RED).** In `packages/shared/test/agent-id.test.ts`, change the `members` line:

```ts
const members: ReadonlyArray<AgentId> = [
  "aider",
  "claude-code",
  "codex",
  "continue",
  "cursor",
  "gemini",
  "generic-cli",
  "windsurf",
];
```

Update the length test and the `.options` order test, and append explicit parse assertions. Replace the `"widens to 5 closed-set members"` and `"preserves alphabetic order — AA3 convention"` tests with:

```ts
  it("explicitly accepts 'gemini'", () => {
    expect(agentIdSchema.parse("gemini")).toBe("gemini");
  });

  it("explicitly accepts 'windsurf'", () => {
    expect(agentIdSchema.parse("windsurf")).toBe("windsurf");
  });

  it("explicitly accepts 'continue'", () => {
    expect(agentIdSchema.parse("continue")).toBe("continue");
  });

  it("widens to 8 closed-set members", () => {
    expect(members).toHaveLength(8);
  });

  it("preserves alphabetic order — AA3 convention", () => {
    expect(agentIdSchema.options).toEqual([
      "aider",
      "claude-code",
      "codex",
      "continue",
      "cursor",
      "gemini",
      "generic-cli",
      "windsurf",
    ]);
  });
```

- [ ] **Step 2: Update the type-level drift guard (RED).** In `packages/shared/test/agent-id.test-d.ts`, update the two affected tests:

```ts
  it("each member is a valid AgentId", () => {
    const _a: AgentId = "aider";
    const _b: AgentId = "claude-code";
    const _c: AgentId = "codex";
    const _d: AgentId = "continue";
    const _e: AgentId = "cursor";
    const _f: AgentId = "gemini";
    const _g: AgentId = "generic-cli";
    const _h: AgentId = "windsurf";
    void _a;
    void _b;
    void _c;
    void _d;
    void _e;
    void _f;
    void _g;
    void _h;
  });
```

and the ordered-tuple test:

```ts
  it("agentIdSchema.options preserves alphabetic order", () => {
    const _t: readonly [
      "aider",
      "claude-code",
      "codex",
      "continue",
      "cursor",
      "gemini",
      "generic-cli",
      "windsurf",
    ] = agentIdSchema.options;
    void _t;
  });
```

- [ ] **Step 3: Run RED.** `pnpm --filter @megasaver/shared test --run agent-id`. Expected: RED — the schema still has 5 members so `members` literals fail to typecheck / runtime assertions fail.

- [ ] **Step 4: Implement (GREEN).** In `packages/shared/src/agent-id.ts`:

```ts
export const agentIdSchema = z.enum([
  "aider",
  "claude-code",
  "codex",
  "continue",
  "cursor",
  "gemini",
  "generic-cli",
  "windsurf",
]);
```

- [ ] **Step 5: GREEN + lint.** `pnpm --filter @megasaver/shared test --run` (all green) then `pnpm --filter @megasaver/shared exec biome check src test`.

- [ ] **Step 6: Commit.**

```bash
git add packages/shared/src/agent-id.ts packages/shared/test/agent-id.test.ts packages/shared/test/agent-id.test-d.ts
git commit -m "feat(shared): widen AgentId with gemini/windsurf/continue"
```

---

## Task 2: `@megasaver/connector-generic-cli` — three target objects

**Files:** Modify `packages/connectors/generic-cli/src/targets.ts`, `src/index.ts`, `test/targets.test.ts`.

**Goal:** Ship `geminiTarget`, `windsurfTarget`, `continueTarget` (flat-file shape, no header), append to `builtinTargets`.

- [ ] **Step 1: Add tests (RED).** In `packages/connectors/generic-cli/test/targets.test.ts`, extend the import and append cases inside the existing `describe("ConnectorTarget registry", …)` block:

```ts
import {
  aiderTarget,
  builtinTargets,
  codexTarget,
  continueTarget,
  cursorTarget,
  findTarget,
  geminiTarget,
  validateConnectorTarget,
  windsurfTarget,
} from "../src/targets.js";
```

```ts
  it("ships the gemini target", () => {
    expect(geminiTarget).toEqual({
      id: "gemini",
      agentId: "gemini",
      relativePath: "GEMINI.md",
    });
  });

  it("ships the windsurf target", () => {
    expect(windsurfTarget).toEqual({
      id: "windsurf",
      agentId: "windsurf",
      relativePath: ".windsurfrules",
    });
  });

  it("ships the continue target", () => {
    expect(continueTarget).toEqual({
      id: "continue",
      agentId: "continue",
      relativePath: ".continue/rules/megasaver.md",
    });
  });

  it("new flat-file targets carry no header", () => {
    expect("header" in geminiTarget).toBe(false);
    expect("header" in windsurfTarget).toBe(false);
    expect("header" in continueTarget).toBe(false);
  });

  it("findTarget returns each new target by id", () => {
    expect(findTarget("gemini")).toBe(geminiTarget);
    expect(findTarget("windsurf")).toBe(windsurfTarget);
    expect(findTarget("continue")).toBe(continueTarget);
  });

  it("builtinTargets contains codex, cursor, aider, gemini, windsurf, continue", () => {
    expect(builtinTargets).toHaveLength(6);
    for (const t of [
      codexTarget,
      cursorTarget,
      aiderTarget,
      geminiTarget,
      windsurfTarget,
      continueTarget,
    ]) {
      expect(builtinTargets).toContain(t);
    }
  });
```

- [ ] **Step 2: Run RED.** `pnpm --filter @megasaver/connector-generic-cli test --run targets`. Expected: import fails (`geminiTarget` etc. not exported).

- [ ] **Step 3: Implement (GREEN).** In `packages/connectors/generic-cli/src/targets.ts`, add the three frozen targets after `aiderTarget` and before `builtinTargets`:

```ts
export const geminiTarget = Object.freeze({
  id: "gemini",
  agentId: "gemini" satisfies AgentId,
  relativePath: "GEMINI.md",
});

export const windsurfTarget = Object.freeze({
  id: "windsurf",
  agentId: "windsurf" satisfies AgentId,
  relativePath: ".windsurfrules",
});

export const continueTarget = Object.freeze({
  id: "continue",
  agentId: "continue" satisfies AgentId,
  relativePath: ".continue/rules/megasaver.md",
});
```

Widen `builtinTargets` (launch order preserved: existing first, new appended):

```ts
export const builtinTargets: readonly ConnectorTarget[] = Object.freeze([
  codexTarget,
  cursorTarget,
  aiderTarget,
  geminiTarget,
  windsurfTarget,
  continueTarget,
]);
```

(The module-load `assertHeaderHasNoSentinels` loop and `validateConnectorTarget` are unchanged — the new targets have no header, so the guard is a no-op for them.)

- [ ] **Step 4: Re-export.** In `packages/connectors/generic-cli/src/index.ts`, extend the `./targets.js` re-export block to include `continueTarget`, `geminiTarget`, `windsurfTarget` (keep alphabetical within the existing export list):

```ts
export {
  aiderTarget,
  builtinTargets,
  codexTarget,
  type ConnectorTarget,
  continueTarget,
  cursorTarget,
  findTarget,
  geminiTarget,
  validateConnectorTarget,
  windsurfTarget,
} from "./targets.js";
```

- [ ] **Step 5: GREEN + lint.** `pnpm --filter @megasaver/connector-generic-cli test --run` then `pnpm --filter @megasaver/connector-generic-cli exec biome check src test`.

- [ ] **Step 6: Commit.**

```bash
git add packages/connectors/generic-cli/src/targets.ts packages/connectors/generic-cli/src/index.ts packages/connectors/generic-cli/test/targets.test.ts
git commit -m "feat(generic-cli): add gemini/windsurf/continue targets"
```

---

## Task 3: `@megasaver/cli` — register the three targets

**Files:** Modify `apps/cli/src/known-targets.ts`, `apps/cli/test/connector.test.ts`, `apps/cli/test/connector-status.test.ts`, `apps/cli/test/session.test.ts`.

**Goal:** Register the three new targets in `KNOWN_TARGETS`; prove sync/status/session work end-to-end. **No production change beyond the registry** — the sync/status loops already iterate `KNOWN_TARGETS`.

- [ ] **Step 1: Register (production).** In `apps/cli/src/known-targets.ts`, update the import and `KNOWN_TARGETS`:

```ts
import type { ConnectorTarget } from "@megasaver/connector-generic-cli";
import {
  aiderTarget,
  codexTarget,
  continueTarget,
  cursorTarget,
  geminiTarget,
  windsurfTarget,
} from "@megasaver/connector-generic-cli";
import type { AgentId } from "@megasaver/shared";

export const CLAUDE_CODE_TARGET = {
  id: "claude-code",
  agentId: "claude-code" satisfies AgentId,
  relativePath: "CLAUDE.md",
} as const;

// claude-code lives in @megasaver/connector-claude-code; the rest live in
// @megasaver/connector-generic-cli; this aggregates across packages.
export const KNOWN_TARGETS = [
  CLAUDE_CODE_TARGET,
  codexTarget,
  cursorTarget,
  aiderTarget,
  geminiTarget,
  windsurfTarget,
  continueTarget,
] as const satisfies readonly ConnectorTarget[];
```

(`KNOWN_TARGET_IDS`, `KnownTargetId`, `isKnownTargetId` derive from `KNOWN_TARGETS` — unchanged. `TARGET_ID_COLUMN_WIDTH` recomputes to `max` id length = 11 (`generic-cli`/`claude-code`), still 11 since `windsurf`/`continue`/`gemini` are shorter.)

- [ ] **Step 2: Sync tests for the three new targets (write, then RED→GREEN).** In `apps/cli/test/connector.test.ts`, append a new describe block at end of file. It seeds a project + a session per agent and seeds the target with `--target`, asserting the file is created with a Mega Saver block. Padding: ids pad to width 11, so `"gemini"` → `"gemini     "` (6 + 5 spaces), `"windsurf"` → `"windsurf   "`, `"continue"` → `"continue   "`, each followed by a 2-space gutter, the path, a 2-space gutter, the status word, then `  session=<id|none>` (the full-mode sync line carries `session=`).

```ts
describe("connectorSyncCommand — phase 9 targets", () => {
  let store: string;
  let projectRoot: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  const PID = "77777777-7777-4777-8777-777777777777";
  const TS = "2026-06-12T00:00:00.000Z";

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-p9-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-cli-p9-root-"));
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

  async function seedProject(): Promise<void> {
    await mkdir(store, { recursive: true });
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        { id: PID, name: "demo", rootPath: projectRoot, createdAt: TS, updatedAt: TS },
      ]),
    );
    await writeFile(join(store, "sessions.json"), "[]");
  }

  async function runSync(target?: string): Promise<void> {
    const cliArgs: Record<string, string> = { projectName: "demo", store };
    if (target !== undefined) cliArgs["target"] = target;
    await connectorSyncCommand.run?.({
      args: cliArgs,
      cmd: connectorSyncCommand,
      rawArgs: [],
      data: undefined,
    } as never);
  }

  const cases = [
    { id: "gemini", path: "GEMINI.md" },
    { id: "windsurf", path: ".windsurfrules" },
    { id: "continue", path: ".continue/rules/megasaver.md" },
  ] as const;

  for (const c of cases) {
    it(`seeds ${c.path} with a Mega Saver block on first --target sync`, async () => {
      await seedProject();
      await runSync(c.id);
      const content = await readFile(join(projectRoot, c.path), "utf8");
      expect(content).toContain(MEGA_SAVER_BLOCK_START);
      const lines = logSpy.mock.calls.map((cc) => cc[0] as string);
      expect(lines.some((l) => l.startsWith(c.id) && l.includes(c.path) && l.includes("created"))).toBe(
        true,
      );
    });

    it(`default sync skips a missing ${c.id} file`, async () => {
      await seedProject();
      await runSync();
      const lines = logSpy.mock.calls.map((cc) => cc[0] as string);
      expect(lines.some((l) => l.startsWith(c.id) && l.includes("skipped"))).toBe(true);
      await expect(readFile(join(projectRoot, c.path), "utf8")).rejects.toThrow();
    });
  }
});
```

- [ ] **Step 3: Status tests.** In `apps/cli/test/connector-status.test.ts`, append a describe block proving each new target reports `missing` then `in-sync` after a seed (mirror the existing cursor status round-trip block, swapping the target id/path and using `runConnectorSync` to seed then `connectorStatusCommand.run` to report). Assert the exact `formatStatusLine` output, e.g.:

```ts
    expect(lines).toContain(
      "gemini       GEMINI.md  in-sync  session=none",
    );
```

(Use `--target <id>` filtering so each assertion is a single line; `session=none` because no session is seeded for that agent.)

- [ ] **Step 4: Session smoke.** In `apps/cli/test/session.test.ts`, append one test creating a session with `--agent gemini` and asserting `sessions[0].agentId === "gemini"` (mirror the existing `--agent cursor` smoke).

- [ ] **Step 5: RED→GREEN.** `pnpm --filter @megasaver/cli test --run connector` then `--run session`. Sync/status/session pass once Step 1's registration is in place (no further production change). If anything else fails, STOP and report — do not add production code beyond the registry.

- [ ] **Step 6: Lint + commit.**

```bash
pnpm --filter @megasaver/cli exec biome check src test
git add apps/cli/src/known-targets.ts apps/cli/test/connector.test.ts apps/cli/test/connector-status.test.ts apps/cli/test/session.test.ts
git commit -m "feat(cli): register gemini/windsurf/continue targets"
```

---

## Task 4: `@megasaver/cli` — `mega connector list`

**Files:** Create `apps/cli/src/commands/connector/list.ts`, `apps/cli/test/connector-list.test.ts`; modify `apps/cli/src/commands/connector/index.ts`.

**Goal:** Static enumeration of known targets with present/absent; exit 0 always.

- [ ] **Step 1: Failing test (RED).** Create `apps/cli/test/connector-list.test.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectorListCommand } from "../src/commands/connector/index.js";

describe("connectorListCommand", () => {
  let store: string;
  let projectRoot: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  const PID = "77777777-7777-4777-8777-777777777777";
  const TS = "2026-06-12T00:00:00.000Z";

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-list-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-cli-list-root-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = 0;
    await mkdir(store, { recursive: true });
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        { id: PID, name: "demo", rootPath: projectRoot, createdAt: TS, updatedAt: TS },
      ]),
    );
    await writeFile(join(store, "sessions.json"), "[]");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.exitCode = 0;
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function runList(json = false): Promise<void> {
    const args: Record<string, unknown> = { projectName: "demo", store };
    if (json) args["json"] = true;
    await connectorListCommand.run?.({
      args,
      cmd: connectorListCommand,
      rawArgs: [],
      data: undefined,
    } as never);
  }

  it("lists all known targets as absent in a fresh project and exits 0", async () => {
    await runList();
    expect(process.exitCode).toBe(0);
    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    for (const id of [
      "claude-code",
      "codex",
      "cursor",
      "aider",
      "gemini",
      "windsurf",
      "continue",
    ]) {
      expect(lines.some((l) => l.startsWith(id) && l.endsWith("absent"))).toBe(true);
    }
  });

  it("marks a present file present", async () => {
    await writeFile(join(projectRoot, "GEMINI.md"), "hello");
    await runList();
    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines.some((l) => l.startsWith("gemini") && l.endsWith("present"))).toBe(true);
  });

  it("--json emits id/agent/relativePath/present", async () => {
    await writeFile(join(projectRoot, "GEMINI.md"), "hello");
    await runList(true);
    const out = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string);
    const gemini = out.find((r: { id: string }) => r.id === "gemini");
    expect(gemini).toEqual({
      id: "gemini",
      agent: "gemini",
      relativePath: "GEMINI.md",
      present: true,
    });
  });
});
```

- [ ] **Step 2: Run RED.** `pnpm --filter @megasaver/cli test --run connector-list`. Expected: import fails (`connectorListCommand` not exported).

- [ ] **Step 3: Implement (GREEN).** Create `apps/cli/src/commands/connector/list.ts`:

```ts
import { join } from "node:path";
import { readTargetFile } from "@megasaver/connectors-shared";
import { defineCommand } from "citty";
import { KNOWN_TARGETS } from "../../known-targets.js";
import { readStoreEnv } from "../../store.js";
import { TARGET_ID_COLUMN_WIDTH, resolveProjectAndRoot } from "./shared.js";

export type RunConnectorListInput = {
  projectName: string;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  json: boolean;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

type ListRecord = {
  id: string;
  agent: string;
  relativePath: string;
  present: boolean;
};

export async function runConnectorList(input: RunConnectorListInput): Promise<0 | 1> {
  const resolved = await resolveProjectAndRoot({
    projectName: input.projectName,
    targetFlag: undefined,
    storeFlag: input.storeFlag,
    cwd: input.cwd,
    home: input.home,
    xdgDataHome: input.xdgDataHome,
    platform: input.platform,
    localAppData: input.localAppData,
    stderr: input.stderr,
  });
  if (!resolved.ok) return resolved.exitCode;
  const { project } = resolved;

  const records: ListRecord[] = [];
  for (const target of KNOWN_TARGETS) {
    const existing = await readTargetFile(join(project.rootPath, target.relativePath));
    const present = existing !== null;
    records.push({ id: target.id, agent: target.agentId, relativePath: target.relativePath, present });
    if (!input.json) {
      input.stdout(
        `${target.id.padEnd(TARGET_ID_COLUMN_WIDTH, " ")}  ${target.agentId.padEnd(
          TARGET_ID_COLUMN_WIDTH,
          " ",
        )}  ${target.relativePath}  ${present ? "present" : "absent"}`,
      );
    }
  }
  if (input.json) input.stdout(JSON.stringify(records));
  return 0;
}

export const connectorListCommand = defineCommand({
  meta: { name: "list", description: "List known connector targets and their presence." },
  args: {
    projectName: {
      type: "positional",
      required: true,
      description: "Project name (must already exist).",
    },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runConnectorList({
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      json: !!args.json,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

(If `TARGET_ID_COLUMN_WIDTH` is not yet exported from `./shared.js`, it already is — see `apps/cli/src/commands/connector/shared.ts:13`.)

- [ ] **Step 4: Register.** In `apps/cli/src/commands/connector/index.ts`, import and register:

```ts
import { defineCommand } from "citty";
import { connectorDoctorCommand } from "./doctor.js";
import { connectorListCommand } from "./list.js";
import { connectorStatusCommand } from "./status.js";
import { connectorSyncCommand } from "./sync.js";

export {
  type RunConnectorStatusInput,
  runConnectorStatus,
  connectorStatusCommand,
} from "./status.js";
export {
  type RunConnectorSyncInput,
  runConnectorSync,
  connectorSyncCommand,
} from "./sync.js";
export { type RunConnectorListInput, runConnectorList, connectorListCommand } from "./list.js";
export {
  type RunConnectorDoctorInput,
  runConnectorDoctor,
  connectorDoctorCommand,
} from "./doctor.js";

export const connectorCommand = defineCommand({
  meta: { name: "connector", description: "Manage Mega Saver connector targets." },
  subCommands: {
    sync: connectorSyncCommand,
    status: connectorStatusCommand,
    list: connectorListCommand,
    doctor: connectorDoctorCommand,
  },
});
```

> NOTE: this references `connectorDoctorCommand` (Task 5). To keep this task self-contained for RED→GREEN, either (a) do Tasks 4 and 5 back-to-back before running the index file, or (b) temporarily comment the doctor import/register lines in this step and uncomment them in Task 5 Step 4. Prefer (a).

- [ ] **Step 5: GREEN + lint.** `pnpm --filter @megasaver/cli test --run connector-list`; `biome check --write` the new file; `pnpm --filter @megasaver/cli exec biome check src test`.

- [ ] **Step 6: Commit.**

```bash
git add apps/cli/src/commands/connector/list.ts apps/cli/src/commands/connector/index.ts apps/cli/test/connector-list.test.ts
git commit -m "feat(cli): add mega connector list"
```

---

## Task 5: `@megasaver/cli` — `mega connector doctor`

**Files:** Create `apps/cli/src/commands/connector/doctor.ts`, `apps/cli/test/connector-doctor.test.ts`; (index already registered in Task 4).

**Goal:** Per-target diagnostic: `ok` / `stale` / `no-block` / `missing` / `not-writable` / `error`; exit 1 on any `stale`/`not-writable`/`error`.

- [ ] **Step 1: Failing test (RED).** Create `apps/cli/test/connector-doctor.test.ts`:

```ts
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectorDoctorCommand, runConnectorSync } from "../src/commands/connector/index.js";
import { describeUnlessWindows } from "./_platform.js";

describe("connectorDoctorCommand", () => {
  let store: string;
  let projectRoot: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  const PID = "77777777-7777-4777-8777-777777777777";
  const TS = "2026-06-12T00:00:00.000Z";

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-doc-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-cli-doc-root-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = 0;
    await mkdir(store, { recursive: true });
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        { id: PID, name: "demo", rootPath: projectRoot, createdAt: TS, updatedAt: TS },
      ]),
    );
    await writeFile(join(store, "sessions.json"), "[]");
    await mkdir(join(store, "memory"), { recursive: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.exitCode = 0;
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function seedMemory(content: string): Promise<void> {
    await writeFile(
      join(store, "memory", `${PID}.jsonl`),
      `${JSON.stringify({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        projectId: PID,
        sessionId: null,
        scope: "project",
        content,
        createdAt: TS,
      })}\n`,
    );
  }

  async function seed(target: string): Promise<void> {
    await runConnectorSync({
      projectName: "demo",
      targetFlag: target,
      storeFlag: store,
      cwd: projectRoot,
      home: "/tmp",
      xdgDataHome: undefined,
      platform: process.platform,
      localAppData: undefined,
      stdout: () => {},
      stderr: () => {},
      json: false,
    });
  }

  async function runDoctor(target?: string): Promise<void> {
    const args: Record<string, unknown> = { projectName: "demo", store };
    if (target !== undefined) args["target"] = target;
    await connectorDoctorCommand.run?.({
      args,
      cmd: connectorDoctorCommand,
      rawArgs: [],
      data: undefined,
    } as never);
  }

  it("reports ok for a freshly-synced, current file (exit 0)", async () => {
    await seed("gemini");
    await runDoctor("gemini");
    expect(process.exitCode).toBe(0);
    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines.some((l) => l.startsWith("gemini") && l.includes("ok"))).toBe(true);
  });

  it("reports stale and exits 1 when project memory advances after sync", async () => {
    await seed("gemini");
    await seedMemory("a new decision the file does not yet contain");
    await runDoctor("gemini");
    expect(process.exitCode).toBe(1);
    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines.some((l) => l.startsWith("gemini") && l.includes("stale"))).toBe(true);
  });

  it("reports missing for an absent file (exit 0)", async () => {
    await runDoctor("gemini");
    expect(process.exitCode).toBe(0);
    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines.some((l) => l.startsWith("gemini") && l.includes("missing"))).toBe(true);
  });

  it("reports no-block for a user file without sentinels (exit 0)", async () => {
    await writeFile(join(projectRoot, "GEMINI.md"), "my own notes, no block\n");
    await runDoctor("gemini");
    expect(process.exitCode).toBe(0);
    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines.some((l) => l.startsWith("gemini") && l.includes("no-block"))).toBe(true);
  });

  describeUnlessWindows("writability (POSIX chmod)", () => {
    it("reports not-writable and exits 1 without modifying the file", async () => {
      await seed("gemini");
      const path = join(projectRoot, "GEMINI.md");
      const before = await readFile(path, "utf8");
      await chmod(path, 0o444);
      try {
        await runDoctor("gemini");
        expect(process.exitCode).toBe(1);
        const lines = logSpy.mock.calls.map((c) => c[0] as string);
        expect(lines.some((l) => l.startsWith("gemini") && l.includes("not-writable"))).toBe(true);
        expect(await readFile(path, "utf8")).toBe(before);
      } finally {
        await chmod(path, 0o644);
      }
    });
  });
});
```

- [ ] **Step 2: Run RED.** `pnpm --filter @megasaver/cli test --run connector-doctor`. Expected: import fails.

- [ ] **Step 3: Implement (GREEN).** Create `apps/cli/src/commands/connector/doctor.ts`:

```ts
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ConnectorTarget } from "@megasaver/connector-generic-cli";
import { normalizeEol, parseBlock, readTargetFile, upsertBlock } from "@megasaver/connectors-shared";
import { defineCommand } from "citty";
import { mapErrorToCliMessage } from "../../errors.js";
import { KNOWN_TARGETS, KNOWN_TARGET_IDS } from "../../known-targets.js";
import { readStoreEnv } from "../../store.js";
import {
  buildConnectorContext,
  formatStatusLine,
  pickLatestOpenSession,
  resolveProjectAndRoot,
} from "./shared.js";

export type RunConnectorDoctorInput = {
  projectName: string;
  targetFlag: string | undefined;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  json: boolean;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

type DoctorStatus = "ok" | "stale" | "no-block" | "missing" | "not-writable" | "error";

type DoctorRecord = {
  id: string;
  relativePath: string;
  status: DoctorStatus;
  writable: boolean;
  session: string | null;
};

// Probe write permission without writing: W_OK on the file if it exists,
// else on the nearest existing ancestor directory. Never opens for write,
// never mkdir's — a pure capability check.
async function isWritable(absPath: string, exists: boolean): Promise<boolean> {
  const probe = exists ? absPath : dirname(absPath);
  try {
    await access(probe, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export async function runConnectorDoctor(input: RunConnectorDoctorInput): Promise<0 | 1> {
  const resolved = await resolveProjectAndRoot({
    projectName: input.projectName,
    targetFlag: input.targetFlag,
    storeFlag: input.storeFlag,
    cwd: input.cwd,
    home: input.home,
    xdgDataHome: input.xdgDataHome,
    platform: input.platform,
    localAppData: input.localAppData,
    stderr: input.stderr,
  });
  if (!resolved.ok) return resolved.exitCode;
  const { project, registry } = resolved;

  const targets =
    input.targetFlag === undefined
      ? KNOWN_TARGETS
      : KNOWN_TARGETS.filter((t) => t.id === input.targetFlag);

  const sessions = registry.listSessions(project.id);
  const memoryEntries = registry.listMemoryEntries(project.id);
  const records: DoctorRecord[] = [];
  let anyDefect = false;

  const emit = (target: ConnectorTarget, status: DoctorStatus, writable: boolean, session: string | null) => {
    records.push({ id: target.id, relativePath: target.relativePath, status, writable, session });
    if (!input.json) input.stdout(formatStatusLine(target, status, session ?? "none"));
  };

  for (const target of targets) {
    const session = pickLatestOpenSession(sessions, target.agentId);
    const sessionId = session?.id ?? null;
    try {
      const absPath = join(project.rootPath, target.relativePath);
      const existing = await readTargetFile(absPath);
      const writable = await isWritable(absPath, existing !== null);

      if (existing === null) {
        // missing is benign; but if we couldn't even write the parent, surface it.
        if (!writable) {
          anyDefect = true;
          emit(target, "not-writable", false, sessionId);
        } else {
          emit(target, "missing", true, sessionId);
        }
        continue;
      }

      if (parseBlock(existing).block === null) {
        emit(target, "no-block", writable, sessionId);
        continue;
      }

      const context = buildConnectorContext(target, project, sessions, memoryEntries);
      const upserted = upsertBlock({ existingContent: existing, context });
      const inSync = normalizeEol(upserted) === normalizeEol(existing);

      if (!writable) {
        anyDefect = true;
        emit(target, "not-writable", false, sessionId);
      } else if (inSync) {
        emit(target, "ok", true, sessionId);
      } else {
        anyDefect = true;
        emit(target, "stale", true, sessionId);
      }
    } catch (err) {
      anyDefect = true;
      emit(target, "error", false, sessionId);
      const cli = mapErrorToCliMessage(err, {
        kind: "connector",
        targetId: target.id,
        relativePath: target.relativePath,
      });
      input.stderr(cli.message);
    }
  }

  if (input.json) input.stdout(JSON.stringify(records));
  return anyDefect ? 1 : 0;
}

export const connectorDoctorCommand = defineCommand({
  meta: { name: "doctor", description: "Diagnose per-target connector health (exists/writable/sync)." },
  args: {
    projectName: {
      type: "positional",
      required: true,
      description: "Project name (must already exist).",
    },
    target: {
      type: "string",
      description: `Optional target id (${KNOWN_TARGET_IDS.join(" | ")}) to filter the report.`,
    },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runConnectorDoctor({
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      targetFlag: typeof args.target === "string" ? args.target : undefined,
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      json: !!args.json,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

- [ ] **Step 4: Ensure index registration.** Confirm `apps/cli/src/commands/connector/index.ts` (edited in Task 4) imports + registers `connectorDoctorCommand` and re-exports `runConnectorDoctor` / `RunConnectorDoctorInput`. If you used the "comment out" approach in Task 4, uncomment now.

- [ ] **Step 5: GREEN + lint.** `pnpm --filter @megasaver/cli test --run connector-doctor`; `biome check --write apps/cli/src/commands/connector/doctor.ts`; `pnpm --filter @megasaver/cli exec biome check src test`.

- [ ] **Step 6: Commit.**

```bash
git add apps/cli/src/commands/connector/doctor.ts apps/cli/test/connector-doctor.test.ts apps/cli/src/commands/connector/index.ts
git commit -m "feat(cli): add mega connector doctor"
```

---

## Task 6: Cross-agent shared-memory proof (exit criterion)

**Files:** Create `apps/cli/test/connector-cross-agent.test.ts`.

**Goal:** Prove project-scoped memory synced to two agents lands identically in both files (spec §7). Test-only task — no production change.

- [ ] **Step 1: Write the test (it should pass immediately on the shipped path; if it fails, that is a real regression — STOP and report).**

```ts
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseBlock } from "@megasaver/connectors-shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runConnectorSync } from "../src/commands/connector/index.js";

describe("cross-agent shared memory (Phase 9 exit criterion)", () => {
  let store: string;
  let projectRoot: string;
  const PID = "77777777-7777-4777-8777-777777777777";
  const MEM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const TS = "2026-06-12T00:00:00.000Z";
  const DECISION = "AUTH BUG: the login token is double-encoded";

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-xagent-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-cli-xagent-root-"));
    process.exitCode = 0;
    await mkdir(store, { recursive: true });
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        { id: PID, name: "demo", rootPath: projectRoot, createdAt: TS, updatedAt: TS },
      ]),
    );
    await writeFile(join(store, "sessions.json"), "[]");
    await mkdir(join(store, "memory"), { recursive: true });
    await writeFile(
      join(store, "memory", `${PID}.jsonl`),
      `${JSON.stringify({
        id: MEM,
        projectId: PID,
        sessionId: null,
        scope: "project",
        content: DECISION,
        createdAt: TS,
      })}\n`,
    );
  });

  afterEach(async () => {
    process.exitCode = 0;
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function sync(target: string): Promise<void> {
    await runConnectorSync({
      projectName: "demo",
      targetFlag: target,
      storeFlag: store,
      cwd: projectRoot,
      home: "/tmp",
      xdgDataHome: undefined,
      platform: process.platform,
      localAppData: undefined,
      stdout: () => {},
      stderr: () => {},
      json: false,
    });
  }

  it("syncs the same project memory to claude-code and cursor", async () => {
    await sync("claude-code");
    await sync("cursor");

    const claude = await readFile(join(projectRoot, "CLAUDE.md"), "utf8");
    const cursor = await readFile(join(projectRoot, ".cursor/rules/megasaver.mdc"), "utf8");

    // 1. The decision recorded once surfaces in BOTH agents' files.
    expect(claude).toContain(DECISION);
    expect(cursor).toContain(DECISION);

    // 2. The rendered Mega Saver block body is byte-identical across agents
    //    (cursor's frontmatter lives OUTSIDE the sentinel block).
    const claudeBlock = parseBlock(claude).block;
    const cursorBlock = parseBlock(cursor).block;
    expect(claudeBlock).not.toBeNull();
    expect(cursorBlock).not.toBeNull();
    expect(cursorBlock).toBe(claudeBlock);
  });

  it("a new gemini target participates in the shared-memory guarantee", async () => {
    await sync("claude-code");
    await sync("gemini");
    const claude = await readFile(join(projectRoot, "CLAUDE.md"), "utf8");
    const gemini = await readFile(join(projectRoot, "GEMINI.md"), "utf8");
    expect(gemini).toContain(DECISION);
    expect(parseBlock(gemini).block).toBe(parseBlock(claude).block);
  });
});
```

> If `parseBlock(...).block` returns the inner body (string) — confirm the field name against `packages/connectors/shared/src/parse.ts`; the existing `status.ts` uses `parseBlock(existing).block === null`, so `.block` is the right accessor. If it returns a structured object rather than the raw body, compare the body field instead; adjust the two `.toBe` assertions accordingly.

- [ ] **Step 2: Run.** `pnpm --filter @megasaver/cli test --run connector-cross-agent`. Expected: GREEN on the shipped path. If RED for a reason other than the `parseBlock` accessor note, STOP — it is a real cross-agent regression.

- [ ] **Step 3: Commit.**

```bash
git add apps/cli/test/connector-cross-agent.test.ts
git commit -m "test(cli): prove cross-agent shared memory"
```

---

## Task 7: GUI consumers — exhaustive map, mirror, pinned tests

**Files:** Modify `apps/gui/bridge/known-targets.ts`, `apps/gui/src/components/badges.tsx`, `apps/gui/src/components/session-forms.tsx`, `apps/gui/test/components/badges.test.tsx`, `apps/gui/test/components/session-forms.test.tsx`.

**Goal:** Satisfy the contract change in the GUI: the exhaustive `Record<AgentId,…>` and the hardcoded dropdown mirror + pinned tests.

- [ ] **Step 1: Update pinned tests (RED).** In `apps/gui/test/components/session-forms.test.tsx`, update both option assertions:

```ts
    expect(options).toEqual([
      "aider",
      "claude-code",
      "codex",
      "continue",
      "cursor",
      "gemini",
      "generic-cli",
      "windsurf",
    ]);
```

In `apps/gui/test/components/badges.test.tsx`, append render assertions:

```ts
  it("renders the label for agentId=gemini", () => {
    const { container } = render(<AgentBadge agentId="gemini" />);
    expect(container.textContent).toBe("gemini");
  });

  it("renders the label for agentId=windsurf", () => {
    const { container } = render(<AgentBadge agentId="windsurf" />);
    expect(container.textContent).toBe("windsurf");
  });

  it("renders the label for agentId=continue", () => {
    const { container } = render(<AgentBadge agentId="continue" />);
    expect(container.textContent).toBe("continue");
  });
```

- [ ] **Step 2: Run RED.** `pnpm --filter @megasaver/gui test --run` (badges + session-forms). Expected: RED — typecheck fails on `AGENT_LABEL` missing keys and dropdown assertion mismatches. (If GUI is excluded from the workspace test gate, run its filter directly; confirm `@megasaver/gui` package name from `apps/gui/package.json`.)

- [ ] **Step 3: Implement (GREEN).** In `apps/gui/src/components/badges.tsx`, extend `AGENT_LABEL` (keep keys ordered alphabetically to match the type):

```ts
const AGENT_LABEL: Record<AgentId, string> = {
  aider: "aider",
  "claude-code": "claude",
  codex: "codex",
  continue: "continue",
  cursor: "cursor",
  gemini: "gemini",
  "generic-cli": "cli",
  windsurf: "windsurf",
};
```

In `apps/gui/src/components/session-forms.tsx`, update the hardcoded tuple:

```ts
const AGENT_IDS = [
  "aider",
  "claude-code",
  "codex",
  "continue",
  "cursor",
  "gemini",
  "generic-cli",
  "windsurf",
] as const;
```

In `apps/gui/bridge/known-targets.ts`, extend the import + `KNOWN_TARGETS` mirror:

```ts
import type { ConnectorTarget } from "@megasaver/connector-generic-cli";
import {
  aiderTarget,
  codexTarget,
  continueTarget,
  cursorTarget,
  geminiTarget,
  windsurfTarget,
} from "@megasaver/connector-generic-cli";
import type { AgentId } from "@megasaver/shared";

export const CLAUDE_CODE_TARGET = {
  id: "claude-code",
  agentId: "claude-code" satisfies AgentId,
  relativePath: "CLAUDE.md",
} as const;

export const KNOWN_TARGETS = [
  CLAUDE_CODE_TARGET,
  codexTarget,
  cursorTarget,
  aiderTarget,
  geminiTarget,
  windsurfTarget,
  continueTarget,
] as const satisfies readonly ConnectorTarget[];
```

- [ ] **Step 4: GREEN + lint.** `pnpm --filter @megasaver/gui test --run`; `pnpm --filter @megasaver/gui exec biome check src bridge test` (adjust dirs to the GUI layout).

- [ ] **Step 5: Commit.**

```bash
git add apps/gui/bridge/known-targets.ts apps/gui/src/components/badges.tsx apps/gui/src/components/session-forms.tsx apps/gui/test/components/badges.test.tsx apps/gui/test/components/session-forms.test.tsx
git commit -m "feat(gui): surface gemini/windsurf/continue agents"
```

---

## Task 8: Register commands in `main.ts` (no-op if group already wires them)

**Files:** (verify only) `apps/cli/src/main.ts`.

**Goal:** Confirm `mega connector list` / `mega connector doctor` are reachable. The `connectorCommand` group (edited in Task 4/5) already nests them under `subCommands`, and `main.ts` already registers `connector: connectorCommand` — so **no `main.ts` edit is needed**. This task is a verification gate, not an edit.

- [ ] **Step 1: Smoke the help surface.** From the worktree:

```bash
pnpm --filter @megasaver/cli build
node apps/cli/dist/main.js connector --help
node apps/cli/dist/main.js connector list --help
node apps/cli/dist/main.js connector doctor --help
```

Expected: the group lists `sync`, `status`, `list`, `doctor`; each `--help` prints its args. (Capture this as the CLI smoke evidence for DoD §5.)

- [ ] **Step 2: No commit** unless a `main.ts` edit was actually required (it should not be). If Citty needs the subcommands surfaced differently, make the minimal edit and commit `chore(cli): surface connector list/doctor in help`.

---

## Task 9: Ship — changeset + wiki + final verify

**Files:** Create `.changeset/phase9-connectors.md`; modify `wiki/entities/connectors-generic-cli.md`, `wiki/entities/cli.md`, `wiki/entities/shared.md`, `wiki/syntheses/contextops-roadmap.md`, `wiki/index.md`, `wiki/log.md`.

- [ ] **Step 1: `pnpm verify` (full gate).** Run `pnpm verify` from the worktree. Expected: lint (`biome check .`) + typecheck + all tests + `conventions:check` green. If RED, STOP and report BLOCKED with the first failure + exit code (no raw log dumps — CLAUDE.md §13).

- [ ] **Step 2: Changeset.** Create `.changeset/phase9-connectors.md`:

```md
---
"@megasaver/shared": minor
"@megasaver/connector-generic-cli": minor
"@megasaver/cli": minor
---

Phase 9 — Multi-Agent Connectors. `agentIdSchema` widens to eight
members (adds `continue`, `gemini`, `windsurf`).
`@megasaver/connector-generic-cli` ships three new flat-file targets:
`geminiTarget` (`GEMINI.md`), `windsurfTarget` (`.windsurfrules`),
`continueTarget` (`.continue/rules/megasaver.md`) — each a frozen
target object reusing the existing sync path (no new sync code). The
CLI registers them in `KNOWN_TARGETS` and adds two commands:
`mega connector list` (known targets + present/absent, exit 0) and
`mega connector doctor` (per-target exists/writable/in-sync vs stale,
exit 1 on any stale/not-writable/error). Cross-agent shared memory is
proven by an integration test (project memory synced to two agents
lands byte-identically in both files). `vscode`/`jetbrains` (native IDE
plugins) and a `mega connect` alias are out of scope. The four shipped
targets (`claude-code`/`codex`/`cursor`/`aider`) are byte-identical.
```

- [ ] **Step 3: Wiki updates (per CLAUDE.md §0).**
  - `wiki/entities/connectors-generic-cli.md` — note `geminiTarget`/`windsurfTarget`/`continueTarget`; `builtinTargets` length 3 → 6.
  - `wiki/entities/shared.md` — `agentIdSchema` 5 → 8 members; list the new order.
  - `wiki/entities/cli.md` — under `mega connector`, add `list` + `doctor` subcommands and the three new targets/paths; note `doctor` exit semantics.
  - `wiki/syntheses/contextops-roadmap.md` — Phase 9 row (line ~58) `partial → done` (or "mostly done; vscode/jetbrains deferred"); the Phase-9 detail block (line ~166) updated to reflect gemini/windsurf/continue shipped, list/doctor added, cross-agent test landed, IDE plugins deferred.
  - `wiki/index.md` — Status section: Phase 9 connectors; bump test counts.
  - `wiki/log.md` — append `## [2026-06-12] schema | Phase 9 multi-agent connectors` with spec/plan/branch + result summary.

- [ ] **Step 4: Final `pnpm verify`.** Re-run; expected green.

- [ ] **Step 5: Commit.**

```bash
git add .changeset/phase9-connectors.md wiki/entities/connectors-generic-cli.md wiki/entities/shared.md wiki/entities/cli.md wiki/syntheses/contextops-roadmap.md wiki/index.md wiki/log.md
git commit -m "feat(connectors): Phase 9 changeset + wiki"
```

---

## Self-review (plan vs spec)

- **Spec §3 enum widening (gemini + the contract change)** → Task 1 (schema + both drift-guard tests). ✓
- **Spec §4 windsurf/continue targets, no new sync code** → Task 2 (three frozen target objects, no header) + Task 3 (registration only; sync loop untouched). ✓
- **Spec §6 consumer surface** → Class A (auto): Tasks 1/3 verify via the affected packages' tests; Class B (`Record<AgentId,…>` in `badges.tsx`): Task 7; Class C (hardcoded mirrors + pinned tests `agent-id.test*.ts`, `session-forms` tuple+test, `badges` test): Tasks 1 + 7. §6d NOT-touched (`knownAgentIdSchema`/`detectAgent`): no task edits them. §6e registries (CLI + GUI mirror): Tasks 3 + 7. ✓
- **Spec §5a `list` semantics (lines + always exit 0)** → Task 4. ✓
- **Spec §5b `doctor` semantics (six status words + exit rule + writability probe with no write)** → Task 5 (incl. the `not-writable` no-modify assertion). ✓
- **Spec §7 cross-agent proof (two agents, content + block byte-equality)** → Task 6. ✓
- **Spec §8 deferrals (vscode/jetbrains, mega connect)** → no task adds them; changeset (Task 9) states out-of-scope. ✓
- **Spec §2a conventions-sync isolation (GEMINI.md not a conventions consumer)** → no task touches `manifest.ts`; the new files are disjoint from `CONSUMERS`. (A dedicated isolation test was named in spec §11 — fold it into Task 3's sync tests by asserting `mega connector sync` does not write `.cursor/rules/mega-*.mdc`; optional, low-risk.) ✓
- **TDD with complete code in every step?** Tasks 1–7 give full test + production code; Task 8 is a verify gate; Task 9 ships. ✓
- **Commit per task?** Each task ends with a `git commit`. ✓
- **Final verify + changeset?** Task 9. ✓
- **Placeholder scan:** the only conditional notes are (a) Task 4↔5 index ordering and (b) the `parseBlock(...).block` accessor confirmation in Task 6 — both are implementer guidance, not unresolved code. No `TODO`/`TBD` in production code. ✓

## Execution

Plan saved. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review (spec compliance → code quality) between tasks; `critic` adversarial pass on the enum widening (HIGH risk, spec §9).
2. **Inline Execution** — same session, batch checkpoints.

Defaults to subagent-driven if not specified.
