# Phase 10 — Team/Cloud Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the **local, deterministic** slice of Phase 10 (Team/Cloud): the **memory approval workflow**. Add one closed-enum field `approval: suggested | approved | rejected` to `MemoryEntry` (backfill defaults legacy rows to `approved`), default agent `save_memory` writes to `suggested` and human `mega memory create` to `approved`, and **gate** `suggested`/`rejected` memory out of every agent/teammate-facing path (connector sync, memory search/relevant, context pack, MCP project-context + recall). Add `mega memory approve`/`reject`, `--all` review opt-ins, one MCP tool `approve_memory` (24 → **25**), and a pure `buildPrMemoryComment` markdown builder + `mega github pr-comment` command (print-only core; optional off-by-default `gh` post). Team-shared memory = a documented shared store + the gate. Hosted cloud sync / auth / private deploy / org rules / hosted audit / web UI / `visibility` are **explicitly deferred** (no infra built).

**Architecture:** The approval **gate** lives at **two points**. Gate point 1: an `includeUnapproved` field (default `false`) inside `searchMemoryEntries` (`packages/core/src/memory-search.ts`) — the single chokepoint that transitively gates `mega memory search`, `search_memory`, `get_relevant_memories`, and the context pack (`loadPack`). Gate point 2: an explicit `approval === "approved"` filter on the four consumers that call `listMemoryEntries` directly — `buildConnectorContext` (CLI + GUI mirror), `get_project_context`, `mega_recall`. The schema carries `approval` so **both** registry impls round-trip it with no bespoke logic; `backfillMemoryEntry` adds an **independent** approval-defaulting branch so typed Phase 1–9 rows (which lack the field) read back `approved`. `visibility` is NOT added (YAGNI). The PR-comment **builder** is a pure string function in `@megasaver/core` (unit-tested); the `gh` shell-out is a thin, off-by-default, untested-by-design wrapper.

**Tech Stack:** TypeScript strict ESM (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), Zod, Vitest, Citty (CLI), pnpm + Turborepo, Biome. Reuses the shipped memory machinery (`memoryEntrySchema`, `searchMemoryEntries`, `updateMemoryEntry`, `buildConnectorContext`, the `mega memory` group, the MCP server dispatch + `TOOL_DEFS`). No LLM, no new package, no server, no auth, no network in the tested path.

**Spec:** `docs/superpowers/specs/2026-06-12-phase10-team-cloud-design.md`

**Working dir:** `/Users/halitozger/Desktop/MegaSaver/.worktrees/phase10-team` (branch `feat/phase10-team-cloud`, off `main` @ Phase 9). All `pnpm`/`git` run from there.

**Test commands:** per-package `pnpm --filter @megasaver/<pkg> test --run <pattern>`; type `pnpm --filter @megasaver/<pkg> typecheck`. Final gate: `pnpm verify` (= lint `biome check .` over the whole repo + typecheck + test + `conventions:check`). Run `biome check --write` on every new/edited file before committing so lint stays clean. Workspace packages resolve to built `dist/`; if a dependent test fails on an unresolved `@megasaver/*` import, build that dep first (`pnpm --filter @megasaver/core build`, `pnpm --filter @megasaver/connectors-shared build`).

---

## File map

**Modify (core — the schema + gate + backfill):**
- `packages/core/src/memory-entry.ts` — add `memoryApprovalSchema`; `approval` on `memoryEntrySchema` (default `approved`) + `memoryEntryUpdatePatchSchema`; independent approval branch in `backfillMemoryEntry`.
- `packages/core/src/memory-search.ts` — `includeUnapproved` field + the `approval === "approved"` filter (gate point 1).
- `packages/core/src/index.ts` — re-export `memoryApprovalSchema` / `MemoryApproval` and `buildPrMemoryComment` / types.
- `packages/core/src/pr-memory-comment.ts` — **create** the pure markdown builder.
- `packages/core/test/memory-entry.test.ts` — approval + backfill tests.
- `packages/core/test/memory-search.test.ts` — gate point 1 tests.
- `packages/core/test/pr-memory-comment.test.ts` — **create**.
- `packages/core/test/<registry-parity>.test.ts` — approval round-trip symmetry (extend existing parity test).

**Modify (gate point 2 — explicit list-consumer filters):**
- `apps/cli/src/commands/connector/shared.ts` — `approval === "approved"` in `filterMemoryEntriesForSession`.
- `apps/gui/bridge/connector-context.ts` — same filter (GUI mirror).
- `packages/mcp-bridge/src/tools/project-context.ts` — `&& m.approval === "approved"` on `keyMemories`.
- `packages/mcp-bridge/src/tools/recall.ts` — `&& m.approval === "approved"` on the memory filter.

**Modify (author defaults):**
- `packages/mcp-bridge/src/tools/save-memory.ts` — optional `approval` arg; default `suggested`.
- `apps/cli/src/commands/memory/create.ts` — optional `--approval`; default `approved` (schema default stands).

**Modify (CLI surface):**
- `apps/cli/src/commands/memory/approve.ts` — **create** `runMemoryApprove` + command (approve & reject via a shared core).
- `apps/cli/src/commands/memory/index.ts` — register `approve`/`reject`; re-export.
- `apps/cli/src/commands/memory/search.ts` — `--all` → `includeUnapproved`.
- `apps/cli/src/commands/memory/shared.ts` — `approval` column in `formatMemoryListLine`; `approval` row in `formatMemoryExplainLines`.
- `apps/cli/src/commands/github/pr-comment.ts` — **create** `runGithubPrComment` + command.
- `apps/cli/src/commands/github/index.ts` — **create** `githubCommand` group.
- `apps/cli/src/main.ts` — register `github` group.
- `apps/cli/test/memory-approve.test.ts` — **create**.
- `apps/cli/test/memory.test.ts` / `memory-list`/`memory-search`/`memory-explain` tests — column + `--all`.
- `apps/cli/test/connector*.test.ts` — gate-point-2 connector tests.
- `apps/cli/test/github-pr-comment.test.ts` — **create**.
- `apps/cli/test/team-shared-memory.test.ts` — **create** (exit proof).

**Modify (MCP tool — `approve_memory`, 24 → 25):**
- `packages/mcp-bridge/src/tool-name.ts` — add `"approve_memory"` first.
- `packages/mcp-bridge/src/tools/approve-memory.ts` — **create** handler.
- `packages/mcp-bridge/src/server.ts` — `TOOL_DEFS` entry + dispatch case.
- `packages/mcp-bridge/test/tool-name-task.test.ts` — 24 → 25, add member first.
- `packages/mcp-bridge/test/tool-name.test-d.ts` — 24 → 25 type tuple.
- `packages/mcp-bridge/test/approve-memory.test.ts` — **create**.
- `packages/mcp-bridge/test/save-memory*.test.ts`, `project-context`/`recall` tests — gate + default assertions.

**Create (release):** `.changeset/phase10-approval.md`.

**Modify (wiki — per project §0 rule):** `wiki/entities/core.md`, `wiki/entities/cli.md`, `wiki/entities/mcp-bridge.md`, `wiki/syntheses/contextops-roadmap.md` (mark Phase 10 done — final phase), `wiki/index.md`, `wiki/log.md`.

**NOT touched (scope boundary — spec §3d, §8):** no `visibility` field; no server/auth/hosting; `mega github pr-comment --post` `gh` path is not unit-tested. The registry interface (`registry.ts` `CoreRegistry`) gains no new method — approve/reject reuse `updateMemoryEntry`.

---

## Conventions every task obeys

- Caveman-commit: subject ≤ 50 chars, imperative; body only when WHY is non-obvious.
- TDD: write the failing test, run RED, implement, run GREEN, commit.
- After each task run the affected package's test command; after the final task run `pnpm verify`.
- The gate must be TOTAL: every task that touches a memory-read consumer asserts unapproved memory is excluded (or, for human surfaces, deliberately included — spec §4d).
- One commit per task (commands given per task).

---

## Task 1: `@megasaver/core` — `approval` schema + backfill (the contract)

**Files:** Modify `packages/core/src/memory-entry.ts`, `packages/core/test/memory-entry.test.ts`. Modify `packages/core/src/index.ts` (re-export).

**Goal:** Add the `approval` closed enum to `MemoryEntry` (default `approved`) + the update-patch, and the **independent** backfill branch that defaults any approval-less row to `approved` (backward compat — critical).

- [ ] **Step 1: Schema + backfill tests (RED).** In `packages/core/test/memory-entry.test.ts`, add a describe block:

```ts
  it("approval defaults to approved when omitted", () => {
    const parsed = memoryEntrySchema.parse({ ...validProjectMemory, approval: undefined });
    expect(parsed.approval).toBe("approved");
  });

  it("approval accepts the three lifecycle members", () => {
    for (const a of ["suggested", "approved", "rejected"] as const) {
      expect(memoryEntrySchema.parse({ ...validProjectMemory, approval: a }).approval).toBe(a);
    }
  });

  it("approval rejects an unknown value", () => {
    expect(() => memoryEntrySchema.parse({ ...validProjectMemory, approval: "maybe" })).toThrow();
  });

  it("update patch accepts approval", () => {
    const patch = memoryEntryUpdatePatchSchema.parse({ approval: "approved", updatedAt: UPDATED_AT });
    expect(patch.approval).toBe("approved");
  });

  it("backfills a typed Phase 1-9 row without approval to approved", () => {
    const typedNoApproval = { ...validProjectMemory } as Record<string, unknown>;
    delete typedNoApproval.approval;
    const upgraded = memoryEntrySchema.parse(backfillMemoryEntry(typedNoApproval));
    expect(upgraded.approval).toBe("approved");
  });
```

Update the existing **legacy v0.1** backfill test to also assert approval, and the **idempotent** + **corrupt-row** tests:

```ts
    expect(upgraded).toMatchObject({
      type: "todo",
      title: "Repo uses strict ESM.",
      keywords: [],
      confidence: "low",
      source: "manual",
      stale: false,
      approval: "approved",
      updatedAt: CREATED_AT,
    });
```

```ts
  it("backfill is idempotent — already-typed approved rows pass through unchanged", () => {
    expect(backfillMemoryEntry(validProjectMemory)).toEqual(validProjectMemory);
  });

  it("adds approval to a corrupt row but it still fails schema validation", () => {
    const corrupt = {
      id: MEMORY_ENTRY_ID,
      projectId: PROJECT_ID,
      sessionId: null,
      scope: "project",
      content: "no timestamp",
    };
    expect(backfillMemoryEntry(corrupt)).toEqual({ ...corrupt, approval: "approved" });
    expect(() => memoryEntrySchema.parse(backfillMemoryEntry(corrupt))).toThrow();
  });
```

> Ensure `validProjectMemory` in this test file now includes `approval: "approved"` (add it to the fixture) so the "passes through unchanged" idempotency test is exact. If `UPDATED_AT` is not already a const, reuse `CREATED_AT`.

Run RED: `pnpm --filter @megasaver/core test --run memory-entry`.

- [ ] **Step 2: Add the enum (GREEN-1).** In `packages/core/src/memory-entry.ts`, after `memorySourceSchema` / `export type MemorySource`:

```ts
// Order: lifecycle — `suggested` (proposed, usually by an agent), then a human
// moves it to `approved` (shared with agents/teammates) or `rejected` (kept for
// audit, never shared). Declaration order is the lifecycle, NOT alphabetic:
// `approved` is the steady state the gate admits and reads most. AA3 convention:
// declaration order is a contract — do not reorder.
export const memoryApprovalSchema = z.enum(["suggested", "approved", "rejected"]);
export type MemoryApproval = z.infer<typeof memoryApprovalSchema>;
```

- [ ] **Step 3: Field on entry + patch (GREEN-2).** In `memoryEntrySchema`, after the `source: memorySourceSchema,` line:

```ts
    source: memorySourceSchema,
    approval: memoryApprovalSchema.default("approved"),
```

In `memoryEntryUpdatePatchSchema`, after `source: memorySourceSchema.optional(),`:

```ts
    source: memorySourceSchema.optional(),
    approval: memoryApprovalSchema.optional(),
```

- [ ] **Step 4: Backfill branch (GREEN-3).** Replace `backfillMemoryEntry` with the independent-branch version from spec §3b:

```ts
export function backfillMemoryEntry(raw: unknown): unknown {
  if (raw === null || typeof raw !== "object") {
    return raw;
  }
  // Phase 10: any row predating the approval field defaults to `approved` so
  // existing shared memory keeps flowing through the gate. INDEPENDENT of the
  // legacy-type upgrade below — typed Phase 1–9 rows also lack `approval`.
  const withApproval =
    "approval" in raw ? raw : { ...(raw as Record<string, unknown>), approval: "approved" };

  if ("type" in withApproval) {
    return withApproval;
  }
  const entry = withApproval as { content?: unknown; createdAt?: unknown };
  // A real v0.1 row always carried `createdAt`. A row without it is corrupt, not
  // legacy — leave it (sans fabricated timestamp) so the schema rejects it loudly.
  if (typeof entry.createdAt !== "string") {
    return withApproval;
  }
  const content = typeof entry.content === "string" ? entry.content : "";
  const title = content.trim().slice(0, LEGACY_TITLE_MAX) || "untitled";
  return {
    ...(withApproval as Record<string, unknown>),
    type: "todo",
    title,
    keywords: [],
    confidence: "low",
    source: "manual",
    stale: false,
    updatedAt: entry.createdAt,
  };
}
```

- [ ] **Step 5: Re-export.** In `packages/core/src/index.ts`, add `memoryApprovalSchema`, `MemoryApproval` to the `memory-entry.js` export (alongside the other memory enum exports).

- [ ] **Step 6: GREEN + commit.** `pnpm --filter @megasaver/core test --run memory-entry` green. `pnpm --filter @megasaver/core build`. `biome check --write packages/core/src/memory-entry.ts packages/core/src/index.ts packages/core/test/memory-entry.test.ts`. Commit:

```bash
git add packages/core/src/memory-entry.ts packages/core/src/index.ts packages/core/test/memory-entry.test.ts
git commit -m "feat(core): add memory approval field + backfill"
```

---

## Task 2: `@megasaver/core` — gate point 1 in `searchMemoryEntries`

**Files:** Modify `packages/core/src/memory-search.ts`, `packages/core/test/memory-search.test.ts`.

**Goal:** Exclude `suggested`/`rejected` from ranked results by default; `includeUnapproved` opt-in. This single edit gates search, relevant-memories, and the context pack.

- [ ] **Step 1: Tests (RED).** In `packages/core/test/memory-search.test.ts`, add (reuse the file's existing entry-factory helper; assume `makeEntry({...})`):

```ts
  it("excludes suggested and rejected by default", () => {
    const entries = [
      makeEntry({ id: "a", approval: "approved", content: "alpha" }),
      makeEntry({ id: "b", approval: "suggested", content: "alpha" }),
      makeEntry({ id: "c", approval: "rejected", content: "alpha" }),
    ];
    const ids = searchMemoryEntries(entries, { text: "alpha" }).map((e) => e.id);
    expect(ids).toEqual(["a"]);
  });

  it("includes unapproved when includeUnapproved is set", () => {
    const entries = [
      makeEntry({ id: "a", approval: "approved", content: "alpha" }),
      makeEntry({ id: "b", approval: "suggested", content: "alpha" }),
    ];
    const ids = searchMemoryEntries(entries, { text: "alpha", includeUnapproved: true })
      .map((e) => e.id)
      .sort();
    expect(ids).toEqual(["a", "b"]);
  });

  it("approval and stale gates are independent", () => {
    const entries = [makeEntry({ id: "x", approval: "suggested", stale: true, content: "alpha" })];
    expect(searchMemoryEntries(entries, { text: "alpha", includeStale: true })).toHaveLength(0);
    expect(
      searchMemoryEntries(entries, { text: "alpha", includeStale: true, includeUnapproved: true }),
    ).toHaveLength(1);
  });
```

> If the test file's entry factory does not yet set `approval`, default it to `"approved"` in the factory so existing tests stay green.

Run RED: `pnpm --filter @megasaver/core test --run memory-search`.

- [ ] **Step 2: Implement (GREEN).** In `packages/core/src/memory-search.ts`, add to `memorySearchQuerySchema` after `includeStale`:

```ts
    includeStale: z.boolean().default(false),
    includeUnapproved: z.boolean().default(false),
```

Add to the `MemorySearchQuery` type:

```ts
  includeStale?: boolean;
  includeUnapproved?: boolean;
```

Add to the `filtered` predicate (after the `includeStale` line):

```ts
      (q.includeStale || !entry.stale) &&
      (q.includeUnapproved || entry.approval === "approved"),
```

- [ ] **Step 3: GREEN + commit.** `pnpm --filter @megasaver/core test --run memory-search` green. `pnpm --filter @megasaver/core build`. `biome check --write packages/core/src/memory-search.ts packages/core/test/memory-search.test.ts`. Commit:

```bash
git add packages/core/src/memory-search.ts packages/core/test/memory-search.test.ts
git commit -m "feat(core): gate unapproved memory out of search"
```

---

## Task 3: gate point 2 — connector sync (CLI + GUI mirror)

**Files:** Modify `apps/cli/src/commands/connector/shared.ts`, `apps/gui/bridge/connector-context.ts`, `apps/cli/test/connector.test.ts` (or the closest connector sync test).

**Goal:** Only `approved` memory is rendered into agent config files — the teammate-facing leak point and the exit-criterion mechanism.

- [ ] **Step 1: Test (RED).** In the CLI connector sync test, add a case: seed a project with one `approved` and one `suggested` project memory; run `runConnectorSync --target claude-code`; assert the synced `CLAUDE.md` **contains** the approved content and **does NOT contain** the suggested content. (Use the test file's existing seed + sync helpers.) Run RED.

- [ ] **Step 2: Implement (GREEN).** In `apps/cli/src/commands/connector/shared.ts`, add the approval filter to `filterMemoryEntriesForSession`:

```ts
export function filterMemoryEntriesForSession(
  entries: readonly MemoryEntry[],
  session: Session | null,
): MemoryEntry[] {
  return entries.filter((entry) => {
    if (entry.approval !== "approved") return false;
    if (entry.scope === "project") return true;
    return session !== null && entry.sessionId === session.id;
  });
}
```

In `apps/gui/bridge/connector-context.ts`, apply the **same** `approval === "approved"` filter in its memory-filtering step (mirror the CLI builder exactly — the file comment says to keep them in sync).

- [ ] **Step 3: GREEN + commit.** Run the connector test (and the GUI bridge connector-context test if present) green. `biome check --write` the two files + test. Commit:

```bash
git add apps/cli/src/commands/connector/shared.ts apps/gui/bridge/connector-context.ts apps/cli/test/connector.test.ts
git commit -m "feat(cli): gate connector sync to approved memory"
```

---

## Task 4: gate point 2 — MCP `get_project_context` + `mega_recall`

**Files:** Modify `packages/mcp-bridge/src/tools/project-context.ts`, `packages/mcp-bridge/src/tools/recall.ts`, and their tests.

**Goal:** The two agent-facing MCP tools that use `listMemoryEntries` exclude unapproved memory.

- [ ] **Step 1: Tests (RED).** In the project-context test, seed approved + suggested key-memory-type entries (e.g. `type: "decision"`); assert `keyMemories` contains only the approved one. In the recall test, seed approved + suggested project memory; assert the recalled `memory` excludes the suggested one. Run RED.

- [ ] **Step 2: Implement (GREEN).** In `project-context.ts`, extend the `keyMemories` filter:

```ts
  const keyMemories = env.registry
    .listMemoryEntries(projectId.data)
    .filter(
      (m) => m.approval === "approved" && !m.stale && m.confidence !== "low" && KEY_MEMORY_TYPES.has(m.type),
    );
```

In `recall.ts`, extend the memory filter:

```ts
  const memory = allMemory.filter(
    (m) => m.approval === "approved" && (m.sessionId === session.id || m.scope === "project"),
  );
```

- [ ] **Step 3: GREEN + commit.** Run both tests green. `biome check --write` the files + tests. Commit:

```bash
git add packages/mcp-bridge/src/tools/project-context.ts packages/mcp-bridge/src/tools/recall.ts packages/mcp-bridge/test/
git commit -m "feat(mcp): gate project-context and recall to approved"
```

---

## Task 5: author defaults — `save_memory` (suggested) + `mega memory create` (approved)

**Files:** Modify `packages/mcp-bridge/src/tools/save-memory.ts`, `apps/cli/src/commands/memory/create.ts`, and their tests.

**Goal:** Agent writes default to `suggested`; human CLI writes default to `approved` (the agent-suggests → human-approves flow).

- [ ] **Step 1: Tests (RED).** In the save-memory test, assert a `save_memory` call **without** `approval` produces an entry that reads back `approval: "suggested"`, and a call **with** `approval: "approved"` honours it. In the memory-create test, assert `mega memory create` (no flag) produces `approval: "approved"`. Run RED.

- [ ] **Step 2: `save_memory` (GREEN).** In `save-memory.ts`, add to `saveMemoryInputSchema` (after `source`):

```ts
    source: memorySourceSchema.optional(),
    approval: memoryApprovalSchema.optional(),
```

Import `memoryApprovalSchema` from `@megasaver/core`. In the constructed entry, after `source: d.source ?? "agent",`:

```ts
      source: d.source ?? "agent",
      approval: d.approval ?? "suggested",
```

- [ ] **Step 3: `mega memory create` (GREEN).** The schema default (`approved`) already covers human creation, so no required change. **Optionally** add a `--approval` flag for a human staging a suggestion: add `approvalFlag?: string` to `RunMemoryCreateInput`, a `memoryApprovalSchema.safeParse(input.approvalFlag ?? "approved")` guard (parity with the other enum guards, with an `invalidApprovalMessage` in `errors.ts`), pass `approval: approvalResult.data` into the constructed entry, and add the `approval` arg to the citty command. If skipping the flag, the entry must still explicitly set `approval: "approved"` so intent is clear:

```ts
      source: sourceResult.data,
      approval: "approved",
```

- [ ] **Step 4: GREEN + commit.** Run both tests green. `biome check --write` the files + tests. Commit:

```bash
git add packages/mcp-bridge/src/tools/save-memory.ts apps/cli/src/commands/memory/create.ts packages/mcp-bridge/test/ apps/cli/test/
git commit -m "feat: default agent memory to suggested, human to approved"
```

---

## Task 6: CLI — `mega memory approve` / `reject`

**Files:** Create `apps/cli/src/commands/memory/approve.ts`. Modify `apps/cli/src/commands/memory/index.ts`. Create `apps/cli/test/memory-approve.test.ts`.

**Goal:** Two verbs that set `approval` via `updateMemoryEntry` (a constrained update); idempotent; not-found → exit 1.

- [ ] **Step 1: Test (RED).** In `apps/cli/test/memory-approve.test.ts`: create a `suggested` memory (via `runMemoryCreate` with the staged-suggestion path, or directly seed the store), run `runMemoryApprove({ memoryEntryId, approval: "approved", ... })`, assert the stored entry reads `approved`; run again → still `approved`, exit 0 (idempotent); a missing id → exit 1 + `memoryEntryNotFoundMessage`; `reject` sets `rejected`; `--json` emits the updated entry. Run RED.

- [ ] **Step 2: Implement (GREEN).** Create `approve.ts` mirroring `update.ts`'s shape (store resolve → id parse → `getMemoryEntry` not-found guard → `updateMemoryEntry`), parameterised by the target approval:

```ts
import { type MemoryEntryUpdatePatch, memoryApprovalSchema } from "@megasaver/core";
import { defineCommand } from "citty";
import { mapErrorToCliMessage, memoryEntryNotFoundMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { readTestEnv } from "../session/shared.js";
import { memoryEntryIdSchema } from "./shared.js";

export type RunMemoryApproveInput = {
  memoryEntryId: string;
  approval: "approved" | "rejected";
  storeFlag: string | undefined;
  jsonFlag: boolean;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  now?: () => string;
};

export async function runMemoryApprove(input: RunMemoryApproveInput): Promise<0 | 1> {
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

  let parsedId: ReturnType<typeof memoryEntryIdSchema.parse>;
  try {
    parsedId = memoryEntryIdSchema.parse(input.memoryEntryId);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "memoryEntryId" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  const now = input.now ?? (() => new Date().toISOString());
  const updatedAt = readTestEnv("MEGA_TEST_NOW") ?? now();
  const patch: MemoryEntryUpdatePatch = { approval: input.approval, updatedAt };

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);
    if (registry.getMemoryEntry(parsedId) === null) {
      const cli = memoryEntryNotFoundMessage(parsedId);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    const updated = registry.updateMemoryEntry(parsedId, patch);
    input.stdout(input.jsonFlag ? JSON.stringify(updated) : updated.id);
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "memory_update" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

function defineApprovalCommand(name: "approve" | "reject", approval: "approved" | "rejected") {
  return defineCommand({
    meta: { name, description: `Set a memory entry's approval to ${approval}.` },
    args: {
      memoryEntryId: { type: "positional", required: true, description: "Memory entry id (UUID)." },
      store: { type: "string", description: "Override store directory." },
      json: { type: "boolean", default: false, description: "Emit JSON output." },
    },
    async run({ args }) {
      const code = await runMemoryApprove({
        ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
        memoryEntryId: typeof args.memoryEntryId === "string" ? args.memoryEntryId : "",
        approval,
        jsonFlag: args.json === true,
        stdout: (line) => console.log(line),
        stderr: (line) => console.error(line),
      });
      if (code !== 0) process.exitCode = code;
    },
  });
}

export const memoryApproveCommand = defineApprovalCommand("approve", "approved");
export const memoryRejectCommand = defineApprovalCommand("reject", "rejected");

// silence unused-enum import lint if memoryApprovalSchema is only documentary
void memoryApprovalSchema;
```

> Drop the `void memoryApprovalSchema;` line and the import if biome flags it unused (the approval values are inlined). Keep the import only if you choose to validate `input.approval` against the schema.

In `apps/cli/src/commands/memory/index.ts`, import and register both:

```ts
import { memoryApproveCommand, memoryRejectCommand, runMemoryApprove } from "./approve.js";
```

```ts
export { type RunMemoryApproveInput, runMemoryApprove, memoryApproveCommand, memoryRejectCommand } from "./approve.js";
```

```ts
  subCommands: {
    create: memoryCreateCommand,
    list: memoryListCommand,
    show: memoryShowCommand,
    search: memorySearchCommand,
    update: memoryUpdateCommand,
    approve: memoryApproveCommand,
    reject: memoryRejectCommand,
    delete: memoryDeleteCommand,
    explain: memoryExplainCommand,
  },
```

- [ ] **Step 3: GREEN + commit.** Run `pnpm --filter @megasaver/cli test --run memory-approve` green. `biome check --write` the new file + index + test. Commit:

```bash
git add apps/cli/src/commands/memory/approve.ts apps/cli/src/commands/memory/index.ts apps/cli/test/memory-approve.test.ts
git commit -m "feat(cli): add mega memory approve and reject"
```

---

## Task 7: CLI — `--all` on search + `approval` column on list/explain

**Files:** Modify `apps/cli/src/commands/memory/search.ts`, `apps/cli/src/commands/memory/shared.ts`, and the relevant CLI tests.

**Goal:** Humans can review pending suggestions (`search --all`) and see approval in `list`/`explain`.

- [ ] **Step 1: Tests (RED).** Search test: a `suggested` entry is absent from `mega memory search` by default and present with `--all`. List test: `formatMemoryListLine` output includes the `approval` value. Explain test: `formatMemoryExplainLines` includes an `approval` row. Run RED.

- [ ] **Step 2: `--all` on search (GREEN).** In `search.ts`, add an `allFlag?: boolean` to the input type, an `all` boolean arg to the command, and pass `...(input.allFlag ? { includeUnapproved: true } : {})` into the search query passed to `searchMemoryEntries`. (Match how the file currently assembles its `MemorySearchQuery`.)

- [ ] **Step 3: columns (GREEN).** In `shared.ts`, add an `approval` column to `formatMemoryListLine` (extend the signature to accept `approval: string`, add a padded column before `content`):

```ts
const APPROVAL_COLUMN_WIDTH = 9;

export function formatMemoryListLine(entry: {
  id: string;
  sessionId: string | null;
  scope: "project" | "session";
  approval: string;
  content: string;
}): string {
  const id = entry.id;
  const scope = entry.scope.padEnd(SCOPE_COLUMN_WIDTH, " ");
  const session = (entry.sessionId ?? "-").padEnd(SESSION_COLUMN_WIDTH, " ");
  const approval = entry.approval.padEnd(APPROVAL_COLUMN_WIDTH, " ");
  const content = truncate(entry.content, CONTENT_TRUNCATE_AT);
  return `${id}  ${scope}  ${session}  ${approval}  ${content}`;
}
```

Add an `approval` row to `formatMemoryExplainLines` (after the `source` row):

```ts
    `${padExplain("source")}${entry.source}`,
    `${padExplain("approval")}${entry.approval}`,
```

> `list.ts` passes whole entries to `formatMemoryListLine`, so `entry.approval` is already present once the schema has it — no `list.ts` change beyond the formatter signature. Update any list-output test snapshot to the new column.

- [ ] **Step 4: GREEN + commit.** Run the affected CLI memory tests green. `biome check --write`. Commit:

```bash
git add apps/cli/src/commands/memory/search.ts apps/cli/src/commands/memory/shared.ts apps/cli/test/
git commit -m "feat(cli): add --all review and approval column"
```

---

## Task 8: MCP — `approve_memory` tool (24 → 25)

**Files:** Modify `packages/mcp-bridge/src/tool-name.ts`, `packages/mcp-bridge/src/server.ts`. Create `packages/mcp-bridge/src/tools/approve-memory.ts`, `packages/mcp-bridge/test/approve-memory.test.ts`. Modify `packages/mcp-bridge/test/tool-name-task.test.ts`, `packages/mcp-bridge/test/tool-name.test-d.ts`.

**Goal:** One new MCP tool to approve/reject a memory; pins moved in lockstep.

- [ ] **Step 1: Pin tests (RED).** In `tool-name-task.test.ts`: change `describe("tool-name enum (24 tools)")` → `(25 tools)`, the assertion text, and add `"approve_memory"` as the **first** element of the expected `.options` array. In `tool-name.test-d.ts`: add `"approve_memory"` first in the `members` array and the ordered `readonly [...]` tuple; update the "24-member" comment to 25. Run RED: `pnpm --filter @megasaver/mcp-bridge test --run tool-name`.

- [ ] **Step 2: Enum (GREEN-1).** In `tool-name.ts`, add `"approve_memory"` as the first member of `mcpToolNameSchema` (before `"audit_token_usage"`); update the leading comment to mention the Phase 10 approval tool.

- [ ] **Step 3: Handler (GREEN-2).** Create `approve-memory.ts`:

```ts
import {
  type CoreRegistry,
  CoreRegistryError,
  type MemoryApproval,
  memoryApprovalSchema,
} from "@megasaver/core";
import type { MemoryEntryId } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

export type ApproveMemoryEnv = { registry: CoreRegistry; now: () => string };

const approveMemoryInputSchema = z
  .object({
    memoryEntryId: z.string().min(1),
    approval: memoryApprovalSchema.default("approved"),
  })
  .strict();

export type ApproveMemoryResult = { id: string; approval: MemoryApproval };

export async function handleApproveMemory(
  env: ApproveMemoryEnv,
  rawArgs: unknown,
): Promise<ApproveMemoryResult> {
  const parsed = approveMemoryInputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const { memoryEntryId, approval } = parsed.data;
  try {
    const updated = env.registry.updateMemoryEntry(memoryEntryId as MemoryEntryId, {
      approval,
      updatedAt: env.now(),
    });
    return { id: updated.id, approval: updated.approval };
  } catch (err) {
    if (err instanceof CoreRegistryError && err.code === "memory_entry_not_found") {
      throw new McpBridgeError("resource_not_found", err.message);
    }
    throw err;
  }
}
```

- [ ] **Step 4: Wire into server (GREEN-3).** In `server.ts`: import `handleApproveMemory`; add the `TOOL_DEFS` entry **first** (alphabetic) — `{ name: "approve_memory", description: "Approve or reject a suggested memory entry." }` before `audit_token_usage`; add the dispatch arm:

```ts
      case "approve_memory":
        return handleApproveMemory({ registry: deps.registry, now }, args);
```

- [ ] **Step 5: Handler test (RED→GREEN).** In `approve-memory.test.ts`: seed a registry with a `suggested` memory; `handleApproveMemory` with `approval: "approved"` returns `{ id, approval: "approved" }` and the stored entry is approved; `reject` path sets `rejected`; a missing id throws `McpBridgeError` with code `resource_not_found`.

- [ ] **Step 6: GREEN + commit.** `pnpm --filter @megasaver/mcp-bridge test --run "tool-name|approve-memory"` green. `pnpm --filter @megasaver/mcp-bridge build`. `biome check --write` the new/edited files. Commit:

```bash
git add packages/mcp-bridge/src/tool-name.ts packages/mcp-bridge/src/server.ts packages/mcp-bridge/src/tools/approve-memory.ts packages/mcp-bridge/test/
git commit -m "feat(mcp): add approve_memory tool, 24 to 25"
```

---

## Task 9: core — `buildPrMemoryComment` (pure markdown builder)

**Files:** Create `packages/core/src/pr-memory-comment.ts`, `packages/core/test/pr-memory-comment.test.ts`. Modify `packages/core/src/index.ts`.

**Goal:** A pure, deterministic Markdown builder — the unit-tested core of the GitHub PR-comment feature.

- [ ] **Step 1: Test (RED).** In `pr-memory-comment.test.ts`: a fixed list of two approved entries produces a stable, asserted markdown string (heading + task line + one bullet each with type/confidence/title and content); an empty list produces the single "No relevant approved project memory." line; a memory whose title contains a backtick/pipe is escaped. Run RED: `pnpm --filter @megasaver/core test --run pr-memory-comment`.

- [ ] **Step 2: Implement (GREEN).** Create `pr-memory-comment.ts`:

```ts
import type { MemoryEntry } from "./memory-entry.js";

export type PrMemoryCommentOptions = {
  projectName: string;
  task?: string;
  heading?: string;
};

const DEFAULT_HEADING = "Mega Saver — relevant project memory";

// Markdown-escape a single-line field so a memory's content cannot break the
// rendered comment (backticks open code spans; pipes break tables; the renderer
// boundary is a real corruption risk — escape defensively here).
function escapeField(value: string): string {
  return value.replace(/[\\`|]/g, (ch) => `\\${ch}`);
}

export function buildPrMemoryComment(
  memories: readonly MemoryEntry[],
  opts: PrMemoryCommentOptions,
): string {
  const lines: string[] = [`## ${opts.heading ?? DEFAULT_HEADING}`, ""];
  lines.push(`Project: \`${escapeField(opts.projectName)}\``);
  if (opts.task !== undefined && opts.task.trim().length > 0) {
    lines.push(`Task: ${escapeField(opts.task)}`);
  }
  lines.push("");
  if (memories.length === 0) {
    lines.push("No relevant approved project memory.");
    return `${lines.join("\n")}\n`;
  }
  for (const m of memories) {
    lines.push(`- **${escapeField(m.type)}** (${escapeField(m.confidence)}): ${escapeField(m.title)}`);
    lines.push(`  ${escapeField(m.content)}`);
    if (m.relatedFiles !== undefined && m.relatedFiles.length > 0) {
      lines.push(`  files: ${m.relatedFiles.map((f) => `\`${escapeField(f)}\``).join(", ")}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
```

- [ ] **Step 3: Re-export.** In `packages/core/src/index.ts`, export `buildPrMemoryComment` + `PrMemoryCommentOptions` from `./pr-memory-comment.js`.

- [ ] **Step 4: GREEN + commit.** Tests green. `pnpm --filter @megasaver/core build`. `biome check --write`. Commit:

```bash
git add packages/core/src/pr-memory-comment.ts packages/core/src/index.ts packages/core/test/pr-memory-comment.test.ts
git commit -m "feat(core): add buildPrMemoryComment markdown builder"
```

---

## Task 10: CLI — `mega github pr-comment`

**Files:** Create `apps/cli/src/commands/github/pr-comment.ts`, `apps/cli/src/commands/github/index.ts`, `apps/cli/test/github-pr-comment.test.ts`. Modify `apps/cli/src/main.ts`.

**Goal:** Print a PR comment built from **approved** relevant project memory; optional off-by-default `--post` via `gh`.

- [ ] **Step 1: Test (RED).** In `github-pr-comment.test.ts`: seed a project with one `approved` and one `suggested` project memory matching `--task`; run `runGithubPrComment({ projectName, task, ... stdout })`; assert stdout **contains** the approved content and **not** the suggested content, exit 0; project-not-found → exit 1. (`--post` is NOT exercised — document it as the untested wrapper.) Run RED.

- [ ] **Step 2: Implement (GREEN).** Create `pr-comment.ts`. Resolve the project (reuse `loadProjectContext` / the store-env helpers used by `mega context`), call `registry.searchMemoryEntries(projectId, { text: task, scope: "project" })` (gate point 1 → approved-only; scope filter keeps it project memory), build via `buildPrMemoryComment`, print to stdout. `--post <n>` spawns `gh pr comment <n> --body-file -` piping the markdown (best-effort; `gh`-missing/non-zero → mapped stderr + exit 1):

```ts
import { buildPrMemoryComment } from "@megasaver/core";
import { defineCommand } from "citty";
import { mapErrorToCliMessage } from "../../errors.js";
import { readStoreEnv } from "../../store.js";
import { loadProjectContext, type StoreEnv } from "../index/shared.js";
import { toStringArray } from "../context/shared.js";

export type RunGithubPrCommentInput = StoreEnv & {
  projectName: string;
  task: string;
  files: string[];
  limitFlag: number | undefined;
  postFlag: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  spawnPost?: (prNumber: string, body: string) => Promise<number>;
};

export async function runGithubPrComment(input: RunGithubPrCommentInput): Promise<0 | 1> {
  const ctx = await loadProjectContext(input.projectName, input, input.stderr);
  if (!ctx) return 1;
  try {
    const memories = ctx.registry.searchMemoryEntries(ctx.project.id, {
      ...(input.task.trim().length > 0 ? { text: input.task } : {}),
      scope: "project",
      ...(input.limitFlag !== undefined ? { limit: input.limitFlag } : {}),
    });
    const body = buildPrMemoryComment(memories, {
      projectName: input.projectName,
      ...(input.task.trim().length > 0 ? { task: input.task } : {}),
    });
    if (input.postFlag !== undefined) {
      const post = input.spawnPost ?? defaultSpawnPost;
      const code = await post(input.postFlag, body);
      if (code !== 0) {
        input.stderr("error: gh pr comment failed");
        return 1;
      }
      return 0;
    }
    input.stdout(body);
    return 0;
  } catch (err) {
    input.stderr(mapErrorToCliMessage(err).message);
    return 1;
  }
}

// Untested by design: external binary + network. Injected as `spawnPost` in tests.
async function defaultSpawnPost(prNumber: string, body: string): Promise<number> {
  const { spawn } = await import("node:child_process");
  return await new Promise<number>((resolve) => {
    const child = spawn("gh", ["pr", "comment", prNumber, "--body-file", "-"], {
      stdio: ["pipe", "inherit", "inherit"],
    });
    child.on("error", () => resolve(1));
    child.on("close", (code) => resolve(code ?? 1));
    child.stdin.write(body);
    child.stdin.end();
  });
}

export const githubPrCommentCommand = defineCommand({
  meta: { name: "pr-comment", description: "Print a PR comment from approved project memory." },
  args: {
    projectName: { type: "positional", required: true, description: "Project name." },
    task: { type: "string", description: "Task text to rank relevant memory by." },
    files: { type: "string", description: "Related file path (repeatable)." },
    limit: { type: "string", description: "Max memories to include." },
    post: { type: "string", description: "PR number to post to via gh (best-effort)." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const limitRaw = typeof args.limit === "string" ? Number.parseInt(args.limit, 10) : undefined;
    const code = await runGithubPrComment({
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      task: typeof args.task === "string" ? args.task : "",
      files: toStringArray(args.files),
      limitFlag: limitRaw !== undefined && Number.isFinite(limitRaw) ? limitRaw : undefined,
      postFlag: typeof args.post === "string" ? args.post : undefined,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

> Verify the exact shape/exports of `loadProjectContext` + `StoreEnv` in `apps/cli/src/commands/index/shared.ts` and adapt the import/inputs to match (the `mega context` command is the reference caller). If `loadProjectContext`'s signature differs, mirror what `apps/cli/src/commands/context/shared.ts` `loadPack` does.

Create `github/index.ts`:

```ts
import { defineCommand } from "citty";
import { githubPrCommentCommand } from "./pr-comment.js";

export { type RunGithubPrCommentInput, runGithubPrComment, githubPrCommentCommand } from "./pr-comment.js";

export const githubCommand = defineCommand({
  meta: { name: "github", description: "GitHub integration commands." },
  subCommands: { "pr-comment": githubPrCommentCommand },
});
```

In `apps/cli/src/main.ts`, import `githubCommand` and add `github: githubCommand,` to `subCommands`.

- [ ] **Step 3: GREEN + commit.** `pnpm --filter @megasaver/cli test --run github-pr-comment` green (inject `spawnPost` if a `--post` unit is desired; otherwise leave `--post` untested). `biome check --write`. Commit:

```bash
git add apps/cli/src/commands/github/ apps/cli/src/main.ts apps/cli/test/github-pr-comment.test.ts
git commit -m "feat(cli): add mega github pr-comment"
```

---

## Task 11: registry parity + the shared-store exit proof

**Files:** Modify the existing core registry-parity test; create `apps/cli/test/team-shared-memory.test.ts`.

**Goal:** Prove both registry impls round-trip `approval` and prove the roadmap exit ("everyone uses the same project memory") end-to-end with the gate.

- [ ] **Step 1: Parity (RED→GREEN).** In the existing registry-parity / round-trip test (the one that asserts in-memory and json-directory impls agree), add an entry with a non-default `approval` (e.g. `suggested`), create it in both impls, read back, assert `approval` is identical. (If both impls already parse via `memoryEntrySchema`, this is green immediately — it is a guard, not a fix.)

- [ ] **Step 2: Exit proof (RED→GREEN).** Create `team-shared-memory.test.ts`:
  1. Seed a store + project; an **agent** writes a project memory via `handleSaveMemory` (no `approval` → `suggested`).
  2. `runConnectorSync --target claude-code` and `--target cursor`; assert **neither** file contains the suggested content (gated out — §6).
  3. `runMemoryApprove({ memoryEntryId, approval: "approved" })`.
  4. Re-sync both; assert **both** `CLAUDE.md` and `.cursor/rules/megasaver.mdc` now contain the content — the same approved memory in two agents' files from one shared store.

  Run green: `pnpm --filter @megasaver/cli test --run team-shared-memory`.

- [ ] **Step 3: commit.**

```bash
git add packages/core/test/ apps/cli/test/team-shared-memory.test.ts
git commit -m "test: prove approval gate + shared-store exit criterion"
```

---

## Task 12: verify + changeset + wiki (closeout)

**Files:** Create `.changeset/phase10-approval.md`. Modify the wiki pages.

**Goal:** Full green gate, release note, and the mandated wiki update (final phase — mark the roadmap complete).

- [ ] **Step 1: Full verify.** From the worktree root: `pnpm verify`. Fix any lint/type/test fallout (most likely: a list-output snapshot needing the new `approval` column, or an MCP tool-count assertion in a test not yet covered — grep `grep -rn "24" packages/mcp-bridge/test apps/cli/test` and bump any stragglers to 25). Re-run until green. Capture the final `pnpm verify` output as completion evidence.

- [ ] **Step 2: Changeset.** Create `.changeset/phase10-approval.md`:

```md
---
"@megasaver/core": minor
"@megasaver/mcp-bridge": minor
"@megasaver/cli": minor
---

Phase 10 (Team/Cloud — local slice): memory approval workflow.
`MemoryEntry` gains `approval` (`suggested | approved | rejected`);
`backfillMemoryEntry` defaults existing rows to `approved` (backward
compat). Agent `save_memory` writes default to `suggested`, human
`mega memory create` to `approved`. `suggested`/`rejected` memory is
gated out of connector sync, memory search / relevant-memories /
context packs, and the MCP `get_project_context` / `mega_recall` tools —
only approved memory is shared with agents/teammates. New: `mega memory
approve|reject`, `--all` review, the `approve_memory` MCP tool (24 → 25),
`buildPrMemoryComment` + `mega github pr-comment`. Team-shared memory =
a shared `--store` path + the approval gate. Hosted cloud sync, auth,
private deployment, org rules, hosted audit, and a web approval UI are
explicitly deferred.
```

- [ ] **Step 3: Wiki.** Update: `wiki/entities/core.md` (the `approval` field + gate point 1 + `buildPrMemoryComment`), `wiki/entities/mcp-bridge.md` (25 tools, `approve_memory`, the two gated tools), `wiki/entities/cli.md` (`memory approve/reject`, `--all`, `github pr-comment`), `wiki/syntheses/contextops-roadmap.md` (mark **Phase 10 done** — local slice shipped, cloud SaaS deferred; the roadmap is now complete through all 10 phases), `wiki/index.md` (catalog if needed), and append a timestamped entry to `wiki/log.md`:

```md
## [2026-06-12] feat | Phase 10 Team/Cloud (local approval slice)
MemoryEntry.approval (suggested|approved|rejected), backfill→approved.
Gate: search (incl. relevant/context-pack) + buildConnectorContext (CLI
+GUI) + get_project_context + mega_recall. CLI approve/reject + --all;
approve_memory MCP tool (24→25); buildPrMemoryComment + mega github
pr-comment. Team = shared store + gate. Cloud/auth/deploy/org/hosted-
audit/web-UI/visibility deferred. Spec+plan 2026-06-12-phase10-team-cloud.
```

- [ ] **Step 4: Final commit.**

```bash
git add .changeset/phase10-approval.md wiki/
git commit -m "chore: Phase 10 changeset + wiki closeout"
```

---

## Self-review (plan vs spec)

- **Schema + backfill (spec §3)?** Task 1 — `approval` enum (lifecycle order), field + patch, independent backfill branch defaulting `approved`; corrupt-row + idempotency tests preserved. ✓
- **Gate point 1 (spec §4a)?** Task 2 — `includeUnapproved` in `searchMemoryEntries`; transitively gates search/relevant/context-pack. ✓
- **Gate point 2 — all four list-consumers (spec §4b)?** Task 3 (connector CLI + GUI mirror), Task 4 (project-context + recall). ✓
- **Author defaults (spec §3c)?** Task 5 — `save_memory`→suggested, create→approved, GUI schema default. ✓
- **CLI surface (spec §5)?** Task 6 (approve/reject), Task 7 (`--all` + columns), Task 10 (`github pr-comment`). ✓
- **MCP tool 24→25 + pins (spec §9)?** Task 8 — `approve_memory` first, runtime + type pins moved. ✓
- **PR-comment builder pure + tested, `gh` off-by-default/untested (spec §7)?** Task 9 (builder) + Task 10 (command, injectable `spawnPost`). ✓
- **Team = shared store + exit proof (spec §6)?** Task 11 — parity + the suggested→sync-empty→approve→sync-shared end-to-end test. ✓
- **No `visibility`, no infra (spec §3d, §8)?** No task adds them; changeset + wiki state the deferrals. ✓
- **Every task TDD (test first) + one commit + complete code?** Each task: RED step, GREEN step, commit command. ✓
- **Final verify + changeset + wiki (DoD)?** Task 12. ✓
- **Bite-sized / batched?** 12 tasks: 1–2 (core schema+gate), 3–4 (gate point 2), 5 (defaults), 6–7 (CLI verbs/flags), 8 (MCP tool), 9–10 (PR comment), 11 (proofs), 12 (closeout). Each is one coherent commit. ✓
