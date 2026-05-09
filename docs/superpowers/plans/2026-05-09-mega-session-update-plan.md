# mega session update + I5 split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `mega session update <id> [--title …] [--risk …] [--agent …]` for partial session mutation, AND split `apps/cli/src/commands/session.ts` (511 LOC) into a `commands/session/` directory closing backlog item I5.

**Architecture:** Core gains a `SessionUpdatePatchSchema` (Zod, `.strict` + `.refine` min-1-key) and a new `CoreRegistry.updateSession(id, patch)` method on both the in-memory and JSON-directory implementations. CLI splits the existing single-file session module into per-subcommand modules under `commands/session/`, then adds a new `update.ts` for the new subcommand wired through the existing parent `sessionCommand`. Public CLI exports stay byte-identical; `main.ts` import path updates from `./commands/session.js` to `./commands/session/index.js`.

**Tech Stack:** TypeScript strict ESM, Node 22, pnpm + Turborepo, Vitest, Biome, Citty, Zod.

**Spec:** `docs/superpowers/specs/2026-05-09-mega-session-update-design.md`.

**Working dir for every step:** `/Users/halitozger/Desktop/MegaSaver/.worktrees/session-update` (branch `feat/session-update`). All `pnpm` invocations run from there.

**Build/test commands:**

```bash
pnpm --filter @megasaver/core test --run
pnpm --filter @megasaver/cli test --run
pnpm verify
```

**Build dependency:** `pnpm test` calls `pnpm build` first; if you see DTS errors about missing modules, build deps in order: `pnpm --filter @megasaver/shared build && pnpm --filter @megasaver/core build && pnpm --filter @megasaver/connectors-shared build && pnpm --filter @megasaver/connector-generic-cli build`.

---

## File map

### Core (`packages/core/`)

- **Modify** `packages/core/src/session.ts`
  - Add `SessionUpdatePatchSchema` and `SessionUpdatePatch` type exports.
- **Modify** `packages/core/src/registry.ts`
  - Add `updateSession(id, patch): Session` to the `CoreRegistry` interface.
  - Implement it inside `createInMemoryCoreRegistry`.
- **Modify** `packages/core/src/json-directory-registry.ts`
  - Implement `updateSession` parallel to `endSession`'s pattern (atomic write, lock).
- **Modify** `packages/core/src/index.ts`
  - Re-export `SessionUpdatePatch` + `SessionUpdatePatchSchema`.
- **Modify** `packages/core/test/registry.test.ts`
  - Add 6 new tests for the in-memory `updateSession`.
- **Modify** `packages/core/test/json-directory-registry.test.ts`
  - Add 6 new tests for the JSON-directory `updateSession` (parallel coverage).

### CLI (`apps/cli/`)

- **Delete** `apps/cli/src/commands/session.ts` — replaced by directory.
- **Create** `apps/cli/src/commands/session/index.ts` — parent `sessionCommand` + re-exports.
- **Create** `apps/cli/src/commands/session/shared.ts` — `readTestEnv`, `formatSessionLine`, `formatShowLines`.
- **Create** `apps/cli/src/commands/session/create.ts` — moved from old session.ts (lines 1–192 region).
- **Create** `apps/cli/src/commands/session/list.ts` — moved (lines 194–286 region).
- **Create** `apps/cli/src/commands/session/show.ts` — moved (lines 288–389 region).
- **Create** `apps/cli/src/commands/session/end.ts` — moved (lines 391–501 region).
- **Create** `apps/cli/src/commands/session/update.ts` — NEW.
- **Modify** `apps/cli/src/main.ts` — import path may stay `./commands/session.js` if NodeNext resolves the directory's `index.ts`; otherwise update to `./commands/session/index.js`. Verify in T4.
- **Modify** `apps/cli/src/errors.ts` — add `kind: "session_update"` ZodContext variant + `nothingToUpdateMessage` helper.
- **Modify** `apps/cli/test/session.test.ts` — import path update; add ~11 new update tests.
- **Modify** `apps/cli/test/errors.test.ts` — add ~2 new tests for `kind: "session_update"` and `nothingToUpdateMessage`.

### Wiki + changeset

- **Create** `.changeset/mega-session-update.md` — `@megasaver/core` minor + `@megasaver/cli` minor.
- **Modify** `wiki/entities/cli.md` — add `mega session update` subsection; update `mega session create` line if needed.
- **Modify** `wiki/entities/core.md` — note `updateSession` + `SessionUpdatePatchSchema`.
- **Modify** `wiki/index.md` — Status section update; bump test counts.
- **Append** `wiki/log.md` — new schema entry.

No changes outside the listed files.

---

## Conventions every task obeys

- Caveman-commit: subject ≤ 50 chars, imperative.
- TDD: write failing test, RED, implement, GREEN, commit.
- After every task run the affected package's test command. After T6 run `pnpm verify`.
- Existing tests must stay byte-identical-pass; the split (T4) must not change any behaviour.

---

### Task 1: Core — `SessionUpdatePatchSchema` + interface declaration

**Files:**
- Modify: `packages/core/src/session.ts`
- Modify: `packages/core/src/registry.ts`
- Modify: `packages/core/src/index.ts`

**Goal:** Export the patch schema, declare the new method on `CoreRegistry`. No implementation yet — the in-memory registry will throw "not implemented" so T2 can replace it. Type exports go through `index.ts` so downstream consumers compile.

- [ ] **Step 1: Add the patch schema (`packages/core/src/session.ts`)**

Add at the END of `packages/core/src/session.ts` (after the existing `sessionSchema` export):

```ts
export const SessionUpdatePatchSchema = z
  .object({
    title: z.string().nullable().optional(),
    riskLevel: riskLevelSchema.optional(),
    agentId: agentIdSchema.optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0, {
    message: "patch must contain at least one field",
  });

export type SessionUpdatePatch = z.infer<typeof SessionUpdatePatchSchema>;
```

If `riskLevelSchema` and `agentIdSchema` are not yet imported at the top of the file, add them:

```ts
import { agentIdSchema, riskLevelSchema } from "@megasaver/shared";
```

(Skip if either import already exists.)

- [ ] **Step 2: Update `CoreRegistry` interface (`packages/core/src/registry.ts`)**

Find the existing interface (around line 7):

```ts
export interface CoreRegistry {
  createProject(project: Project): Project;
  // ...existing...
  endSession(id: SessionId, opts: { endedAt: string }): Session;
  // ...
}
```

Add a new method declaration RIGHT AFTER `endSession`:

```ts
  updateSession(id: SessionId, patch: SessionUpdatePatch): Session;
```

Add the imports at the top:

```ts
import { type Session, type SessionUpdatePatch, sessionSchema, SessionUpdatePatchSchema } from "./session.js";
```

(Replace the existing `import { type Session, sessionSchema } from "./session.js";` line.)

- [ ] **Step 3: Stub `updateSession` in the in-memory registry (`packages/core/src/registry.ts`)**

Find the `endSession` impl block (around line 80) inside `createInMemoryCoreRegistry`. Add a stub `updateSession` impl immediately after the closing brace of `endSession`:

```ts
    updateSession() {
      throw new Error("updateSession not implemented yet (T1 stub; lands in T2)");
    },
```

This makes the type-checker happy without committing real behaviour. T2 replaces the stub.

- [ ] **Step 4: Re-export from `packages/core/src/index.ts`**

Find the existing export line for `Session`:

```ts
export { type Session, sessionSchema } from "./session.js";
```

Replace with:

```ts
export {
  type Session,
  sessionSchema,
  type SessionUpdatePatch,
  SessionUpdatePatchSchema,
} from "./session.js";
```

(If the existing export is laid out differently in the source, preserve the existing style; only add the two new symbols.)

- [ ] **Step 5: Run typecheck**

Run: `pnpm --filter @megasaver/core typecheck`
Expected: clean. Tests will fail on the stub, which is intentional — T2 lands them.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/session.ts packages/core/src/registry.ts packages/core/src/index.ts
git commit -m "feat(core): SessionUpdatePatchSchema + interface stub"
```

---

### Task 2: Core in-memory `updateSession` impl + tests

**Files:**
- Modify: `packages/core/src/registry.ts`
- Modify: `packages/core/test/registry.test.ts`

**Goal:** Replace the T1 stub with the real impl. Add 6 behavioural tests that mirror the spec §6 contract.

- [ ] **Step 1: Add the failing tests (RED)**

Append the following describe block to the END of `packages/core/test/registry.test.ts`. The file already imports `createInMemoryCoreRegistry`, `CoreRegistryError`, etc. — reuse those.

```ts
describe("updateSession (in-memory)", () => {
  function buildRegistry() {
    const reg = createInMemoryCoreRegistry();
    const project = projectSchema.parse({
      id: "11111111-1111-4111-8111-111111111111",
      name: "demo",
      rootPath: "/tmp",
      createdAt: "2026-05-09T00:00:00.000Z",
      updatedAt: "2026-05-09T00:00:00.000Z",
    });
    reg.createProject(project);
    const session = sessionSchema.parse({
      id: "22222222-2222-4222-8222-222222222222",
      projectId: project.id,
      agentId: "claude-code",
      riskLevel: "medium",
      title: null,
      startedAt: "2026-05-09T00:00:00.000Z",
      endedAt: null,
    });
    reg.createSession(session);
    return { reg, project, session };
  }

  it("sets a single field (title) on an open session", () => {
    const { reg, session } = buildRegistry();
    const updated = reg.updateSession(session.id, { title: "auth refactor" });
    expect(updated.title).toBe("auth refactor");
    expect(updated.id).toBe(session.id);
    expect(updated.riskLevel).toBe("medium");
    expect(updated.agentId).toBe("claude-code");
  });

  it("clears title to null", () => {
    const { reg, session } = buildRegistry();
    reg.updateSession(session.id, { title: "first" });
    const cleared = reg.updateSession(session.id, { title: null });
    expect(cleared.title).toBeNull();
  });

  it("mutates all three fields atomically", () => {
    const { reg, session } = buildRegistry();
    const updated = reg.updateSession(session.id, {
      title: "x",
      riskLevel: "high",
      agentId: "cursor",
    });
    expect(updated.title).toBe("x");
    expect(updated.riskLevel).toBe("high");
    expect(updated.agentId).toBe("cursor");
  });

  it("throws Zod error on empty patch", () => {
    const { reg, session } = buildRegistry();
    expect(() => reg.updateSession(session.id, {})).toThrow(/at least one field/);
  });

  it("throws session_not_found for unknown id", () => {
    const { reg } = buildRegistry();
    expect(() =>
      reg.updateSession("99999999-9999-4999-8999-999999999999", { title: "x" }),
    ).toThrow(CoreRegistryError);
  });

  it("throws session_already_ended for ended session", () => {
    const { reg, session } = buildRegistry();
    reg.endSession(session.id, { endedAt: "2026-05-09T01:00:00.000Z" });
    expect(() => reg.updateSession(session.id, { title: "x" })).toThrow(/already ended/);
  });
});
```

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @megasaver/core test --run registry.test`
Expected: 6 new tests fail with "not implemented yet".

- [ ] **Step 3: Implement `updateSession` (GREEN)**

In `packages/core/src/registry.ts`, replace the T1 stub:

```ts
    updateSession() {
      throw new Error("updateSession not implemented yet (T1 stub; lands in T2)");
    },
```

with the real impl:

```ts
    updateSession(id, patch) {
      const parsedPatch = SessionUpdatePatchSchema.parse(patch);
      const existing = sessions.get(id);
      if (!existing) {
        throw new CoreRegistryError("session_not_found", `Session does not exist: ${id}`);
      }
      if (existing.endedAt !== null) {
        throw new CoreRegistryError("session_already_ended", `Session already ended: ${id}`);
      }
      const updated = sessionSchema.parse({ ...existing, ...parsedPatch });
      sessions.set(id, updated);
      return updated;
    },
```

The `sessionSchema.parse` re-validation is intentional: it catches the case where the patch's `riskLevel` or `agentId` somehow drifted (defensive on the schema boundary, not on impossible cases).

- [ ] **Step 4: Run GREEN**

Run: `pnpm --filter @megasaver/core test --run`
Expected: all prior tests + 6 new = green. Total core tests 116 → 122.

- [ ] **Step 5: Lint**

Run: `pnpm --filter @megasaver/core exec biome check src test`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/registry.ts packages/core/test/registry.test.ts
git commit -m "feat(core): in-memory updateSession impl"
```

---

### Task 3: Core JSON-directory `updateSession` impl + tests

**Files:**
- Modify: `packages/core/src/json-directory-registry.ts`
- Modify: `packages/core/test/json-directory-registry.test.ts`

**Goal:** Add `updateSession` to the JSON-directory registry, parallel to its existing `endSession` pattern (atomic write + lock). Add 6 tests that mirror T2's coverage but exercise on-disk persistence.

- [ ] **Step 1: Add the failing tests (RED)**

Append a similar describe block to the END of `packages/core/test/json-directory-registry.test.ts`. The exact helper names depend on the existing file's pattern — read it first (the fixture probably uses `mkdtemp` per test). The 6 tests cover the same behavioural axes as T2:

```ts
describe("updateSession (json-directory)", () => {
  // Fixture creation matches the existing endSession test pattern in the same file.
  // Replace the helper signatures below with whatever the file already uses.
  let dir: string;
  let reg: CoreRegistry;
  const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
  const SESSION_ID = "22222222-2222-4222-8222-222222222222";

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "megasaver-core-update-"));
    reg = createJsonDirectoryCoreRegistry(dir);
    reg.createProject(
      projectSchema.parse({
        id: PROJECT_ID,
        name: "demo",
        rootPath: "/tmp",
        createdAt: "2026-05-09T00:00:00.000Z",
        updatedAt: "2026-05-09T00:00:00.000Z",
      }),
    );
    reg.createSession(
      sessionSchema.parse({
        id: SESSION_ID,
        projectId: PROJECT_ID,
        agentId: "claude-code",
        riskLevel: "medium",
        title: null,
        startedAt: "2026-05-09T00:00:00.000Z",
        endedAt: null,
      }),
    );
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("persists title change to sessions.json on disk", async () => {
    reg.updateSession(SESSION_ID, { title: "auth refactor" });
    const raw = JSON.parse(await readFile(join(dir, "sessions.json"), "utf8"));
    expect(raw[0].title).toBe("auth refactor");
  });

  it("persists null clear on disk", async () => {
    reg.updateSession(SESSION_ID, { title: "first" });
    reg.updateSession(SESSION_ID, { title: null });
    const raw = JSON.parse(await readFile(join(dir, "sessions.json"), "utf8"));
    expect(raw[0].title).toBeNull();
  });

  it("persists multi-field patch on disk", () => {
    const updated = reg.updateSession(SESSION_ID, {
      title: "x",
      riskLevel: "high",
      agentId: "cursor",
    });
    expect(updated.title).toBe("x");
    expect(updated.riskLevel).toBe("high");
    expect(updated.agentId).toBe("cursor");
  });

  it("throws Zod error on empty patch", () => {
    expect(() => reg.updateSession(SESSION_ID, {})).toThrow(/at least one field/);
  });

  it("throws session_not_found for unknown id", () => {
    expect(() =>
      reg.updateSession("99999999-9999-4999-8999-999999999999", { title: "x" }),
    ).toThrow(CoreRegistryError);
  });

  it("throws session_already_ended for ended session", () => {
    reg.endSession(SESSION_ID, { endedAt: "2026-05-09T01:00:00.000Z" });
    expect(() => reg.updateSession(SESSION_ID, { title: "x" })).toThrow(/already ended/);
  });
});
```

If `createJsonDirectoryCoreRegistry` is named differently in this codebase, use the existing factory name. Likewise the `mkdtemp` / `tmpdir` / `join` / `rm` / `readFile` imports may need to be added to the test file.

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @megasaver/core test --run json-directory-registry`
Expected: 6 new tests fail.

- [ ] **Step 3: Implement (GREEN)**

In `packages/core/src/json-directory-registry.ts`, find the existing `endSession` impl. Add an `updateSession` impl that mirrors its pattern: load the current sessions array from disk, mutate the matching session in memory, atomically rewrite `sessions.json`. Pseudocode:

```ts
    updateSession(id, patch) {
      const parsedPatch = SessionUpdatePatchSchema.parse(patch);
      // Same lock/atomic-write semantics as endSession in this file.
      // Load → find → guard not-found → guard already-ended → spread patch → re-parse
      // through sessionSchema → write atomically → return updated.
    },
```

The exact code MUST match this file's existing transactional shape (which mirrors `endSession` line-by-line). DO NOT introduce a new locking pattern; reuse the helpers `endSession` already calls (e.g. `withSessionsFile`, `atomicWriteSessions`, or whatever the file names them).

- [ ] **Step 4: Run GREEN**

Run: `pnpm --filter @megasaver/core test --run`
Expected: all prior + 6 new = green. Total core tests 122 → 128.

- [ ] **Step 5: Lint**

Run: `pnpm --filter @megasaver/core exec biome check src test`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/json-directory-registry.ts packages/core/test/json-directory-registry.test.ts
git commit -m "feat(core): json-dir updateSession impl"
```

---

### Task 4: CLI split — `commands/session.ts` → `commands/session/`

**Files:**
- Delete: `apps/cli/src/commands/session.ts`
- Create: `apps/cli/src/commands/session/{index,shared,create,list,show,end}.ts`
- Modify: `apps/cli/src/main.ts` (only if NodeNext doesn't resolve the directory's index)
- Modify: `apps/cli/test/session.test.ts` (import path update)

**Goal:** Move every existing piece into the directory layout WITHOUT changing behaviour. Existing 21 session tests + 3 (errors module) pass byte-identically (only the import path changes). NO new subcommand here — that's T5.

- [ ] **Step 1: Inspect existing layout**

Read `apps/cli/src/commands/session.ts` end-to-end. Identify the boundaries:

- Lines 1–48: imports + `readTestEnv` + (other top-of-file helpers).
- Lines 49–192: `RunSessionCreateInput`, `runSessionCreate`, `sessionCreateCommand`.
- Lines 194–286: `formatSessionLine`, `RunSessionListInput`, `runSessionList`, `sessionListCommand`.
- Lines 288–389: `formatShowLines`, `RunSessionShowInput`, `runSessionShow`, `sessionShowCommand`.
- Lines 391–501: `RunSessionEndInput`, `runSessionEnd`, `sessionEndCommand`.
- Lines 503–end: parent `sessionCommand`.

Confirm exact line numbers in the actual file (the spec's estimates may have drifted by ±5 lines).

- [ ] **Step 2: Create `apps/cli/src/commands/session/shared.ts`**

Move into this file:
- The `readTestEnv` helper.
- The `formatSessionLine` helper (currently around line 194).
- The `formatShowLines` helper (currently around line 288).
- Any other private helpers that are referenced by more than one of the per-subcommand modules.

Each helper keeps its existing signature and body byte-identically. Re-export them with `export function …` so the per-subcommand modules can import. Add the imports those helpers depend on (likely `@megasaver/shared`, Zod, etc.).

- [ ] **Step 3: Create `apps/cli/src/commands/session/create.ts`**

Move the create chunk verbatim. The file imports:
- `defineCommand` from `citty`,
- whatever `RunSessionCreateInput` referenced (`@megasaver/core`, etc.),
- `readTestEnv` from `./shared.js`,
- error helpers from `../../errors.js`.

Re-export `RunSessionCreateInput`, `runSessionCreate`, `sessionCreateCommand`. The path-prefix in imports inside the moved code goes up one extra level (e.g. `from "../store.js"` → `from "../../store.js"`).

- [ ] **Step 4: Create `apps/cli/src/commands/session/list.ts`**

Same pattern. Move list chunk. Imports `formatSessionLine` from `./shared.js`. Re-exports `RunSessionListInput`, `runSessionList`, `sessionListCommand`.

- [ ] **Step 5: Create `apps/cli/src/commands/session/show.ts`**

Same pattern. Imports `formatShowLines` from `./shared.js`. Re-exports `RunSessionShowInput`, `runSessionShow`, `sessionShowCommand`.

- [ ] **Step 6: Create `apps/cli/src/commands/session/end.ts`**

Same pattern. Re-exports `RunSessionEndInput`, `runSessionEnd`, `sessionEndCommand`.

- [ ] **Step 7: Create `apps/cli/src/commands/session/index.ts`**

```ts
import { defineCommand } from "citty";
import { sessionCreateCommand } from "./create.js";
import { sessionEndCommand } from "./end.js";
import { sessionListCommand } from "./list.js";
import { sessionShowCommand } from "./show.js";

export {
  type RunSessionCreateInput,
  runSessionCreate,
  sessionCreateCommand,
} from "./create.js";
export {
  type RunSessionEndInput,
  runSessionEnd,
  sessionEndCommand,
} from "./end.js";
export {
  type RunSessionListInput,
  runSessionList,
  sessionListCommand,
} from "./list.js";
export {
  type RunSessionShowInput,
  runSessionShow,
  sessionShowCommand,
} from "./show.js";

export const sessionCommand = defineCommand({
  meta: { name: "session", description: "Manage Mega Saver sessions." },
  subCommands: {
    create: sessionCreateCommand,
    list: sessionListCommand,
    show: sessionShowCommand,
    end: sessionEndCommand,
  },
});
```

(Match the parent `sessionCommand`'s existing meta description literal verbatim — copy from old session.ts line 503-area.)

- [ ] **Step 8: Delete `apps/cli/src/commands/session.ts`**

```bash
git rm apps/cli/src/commands/session.ts
```

- [ ] **Step 9: Verify `main.ts` import**

Read `apps/cli/src/main.ts`. The line that imports the parent should look like:

```ts
import { sessionCommand } from "./commands/session.js";
```

Two outcomes are acceptable:
- NodeNext resolves the directory → import literal stays unchanged because TypeScript / the build resolves `commands/session/index.js`. Verify this works by running `pnpm --filter @megasaver/cli typecheck`.
- NodeNext does NOT resolve → update the literal to `./commands/session/index.js`.

The Mega Saver build uses tsup + `package.json#exports`; tsup typically does not auto-resolve directory imports. If typecheck fails, update the literal.

- [ ] **Step 10: Update `apps/cli/test/session.test.ts` imports**

Same logic as Step 9 for the test file. Find the `from "../src/commands/session.js"` line. Either it still resolves, or update to `from "../src/commands/session/index.js"`.

- [ ] **Step 11: Run all CLI tests; confirm GREEN**

Run: `pnpm --filter @megasaver/cli test --run`
Expected: 128 tests still passing, byte-identical to pre-split. The split should be invisible to behaviour.

- [ ] **Step 12: Lint**

Run: `pnpm --filter @megasaver/cli exec biome check src test`
Expected: clean.

- [ ] **Step 13: Commit**

```bash
git add apps/cli/src/commands/session/ apps/cli/src/main.ts apps/cli/test/session.test.ts
git rm apps/cli/src/commands/session.ts  # if not already staged via git rm in step 8
git commit -m "refactor(cli): split commands/session.ts (I5)"
```

---

### Task 5: CLI — `mega session update`

**Files:**
- Modify: `apps/cli/src/errors.ts`
- Create: `apps/cli/src/commands/session/update.ts`
- Modify: `apps/cli/src/commands/session/index.ts`
- Modify: `apps/cli/test/session.test.ts`
- Modify: `apps/cli/test/errors.test.ts`

**Goal:** Add the new subcommand. Wire it into the parent. Add 11 behavioural tests + 2 errors module tests.

- [ ] **Step 1: Add `nothingToUpdateMessage` and `kind: "session_update"` to `errors.ts` (RED)**

In `apps/cli/src/errors.ts`:

(a) Add to the `ZodContext` discriminated union:

```ts
type ZodContext =
  | { kind: "name" }
  | { kind: "store" }
  | { kind: "session" }
  | { kind: "session_update" }
  | { kind: "connector"; targetId: string; relativePath: string }
  // ...existing remaining variants...
```

(Insert `session_update` alphabetically next to `session`.)

(b) Add a new error helper at the bottom of the file (next to `projectNotFoundMessage`, etc.):

```ts
export function nothingToUpdateMessage(): CliMessage {
  return { message: "error: nothing to update", exitCode: 1 };
}
```

(c) In `mapErrorToCliMessage`, when handling Zod errors, add a branch for `kind === "session_update"`. The simplest implementation: route through the existing Zod-issue mapper, which already lifts the schema's `.message` field. If the spec's `SessionUpdatePatchSchema.refine`'s `"patch must contain at least one field"` message must surface for callers that hit the schema path (not the CLI's pre-flight `nothingToUpdateMessage`), wire it as:

```ts
if (ctx?.kind === "session_update") {
  // Surface the Zod issue verbatim (or via a stable wording).
  // If the issue is the empty-patch refine, prefer "error: nothing to update"
  // for parity with the CLI pre-flight check.
  // …route accordingly…
}
```

The exact wording is flexible as long as the tests in step 4 pass.

- [ ] **Step 2: Add 2 tests for the new error mappings (RED)**

In `apps/cli/test/errors.test.ts`, append:

```ts
describe("errors — session update", () => {
  it("nothingToUpdateMessage returns the documented shape", () => {
    expect(nothingToUpdateMessage()).toEqual({
      message: "error: nothing to update",
      exitCode: 1,
    });
  });

  it("mapErrorToCliMessage routes a Zod issue under kind: session_update", () => {
    const zodErr = SessionUpdatePatchSchema.safeParse({});
    expect(zodErr.success).toBe(false);
    if (!zodErr.success) {
      const cli = mapErrorToCliMessage(zodErr.error, { kind: "session_update" });
      expect(cli.exitCode).toBe(1);
      expect(cli.message.startsWith("error:")).toBe(true);
    }
  });
});
```

Update imports in `errors.test.ts` to include `nothingToUpdateMessage` and `SessionUpdatePatchSchema`.

- [ ] **Step 3: Run RED on errors tests**

Run: `pnpm --filter @megasaver/cli test --run errors.test`
Expected: 2 tests fail because `nothingToUpdateMessage` not exported / `kind: "session_update"` not in union.

- [ ] **Step 4: Run errors tests GREEN**

Verify the production code from Step 1 covers Step 2's assertions. Tweak as needed. Re-run.

- [ ] **Step 5: Add session update tests (RED)**

Append a new describe block to `apps/cli/test/session.test.ts`:

```ts
describe("sessionUpdateCommand", () => {
  let store: string;
  let projectRoot: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-update-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-cli-update-root-"));
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

  const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
  const SESSION_ID = "22222222-2222-4222-8222-222222222222";

  async function seedOpenSession(): Promise<void> {
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
          title: null,
          startedAt: ts,
          endedAt: null,
        },
      ]),
    );
  }

  async function runUpdate(args: Record<string, string>): Promise<void> {
    await sessionUpdateCommand.run?.({
      args: { ...args, store },
      cmd: sessionUpdateCommand,
      rawArgs: [],
      data: undefined,
    } as never);
  }

  async function readSessions(): Promise<Array<Record<string, unknown>>> {
    return JSON.parse(await readFile(join(store, "sessions.json"), "utf8"));
  }

  it("sets title with --title 'foo'", async () => {
    await seedOpenSession();
    await runUpdate({ sessionId: SESSION_ID, title: "foo" });
    expect(process.exitCode).toBe(0);
    expect(logSpy).not.toHaveBeenCalled();
    const arr = await readSessions();
    expect(arr[0]?.title).toBe("foo");
  });

  it("clears title with --title ''", async () => {
    await seedOpenSession();
    await runUpdate({ sessionId: SESSION_ID, title: "" });
    expect(process.exitCode).toBe(0);
    const arr = await readSessions();
    expect(arr[0]?.title).toBeNull();
  });

  it("sets riskLevel with --risk high", async () => {
    await seedOpenSession();
    await runUpdate({ sessionId: SESSION_ID, risk: "high" });
    const arr = await readSessions();
    expect(arr[0]?.riskLevel).toBe("high");
  });

  it("sets agentId with --agent cursor", async () => {
    await seedOpenSession();
    await runUpdate({ sessionId: SESSION_ID, agent: "cursor" });
    const arr = await readSessions();
    expect(arr[0]?.agentId).toBe("cursor");
  });

  it("rejects empty update (no flags) with 'nothing to update'", async () => {
    await seedOpenSession();
    await runUpdate({ sessionId: SESSION_ID });
    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.some((c) => c[0] === "error: nothing to update")).toBe(true);
    const arr = await readSessions();
    expect(arr[0]?.title).toBeNull();
  });

  it("applies multi-field patch atomically", async () => {
    await seedOpenSession();
    await runUpdate({
      sessionId: SESSION_ID,
      title: "x",
      risk: "high",
      agent: "cursor",
    });
    const arr = await readSessions();
    expect(arr[0]?.title).toBe("x");
    expect(arr[0]?.riskLevel).toBe("high");
    expect(arr[0]?.agentId).toBe("cursor");
  });

  it("rejects invalid session id with non-zero exit", async () => {
    await seedOpenSession();
    await runUpdate({ sessionId: "not-a-uuid", title: "foo" });
    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.length).toBeGreaterThan(0);
  });

  it("rejects unknown session id with session_not_found", async () => {
    await seedOpenSession();
    await runUpdate({
      sessionId: "99999999-9999-4999-8999-999999999999",
      title: "x",
    });
    expect(process.exitCode).toBe(1);
    expect(
      errSpy.mock.calls.some((c) => /session.*not found|does not exist/i.test(c[0] as string)),
    ).toBe(true);
  });

  it("rejects ended session with session_already_ended", async () => {
    await seedOpenSession();
    // end the session manually in the store
    const ended = JSON.parse(await readFile(join(store, "sessions.json"), "utf8"));
    ended[0].endedAt = "2026-05-09T01:00:00.000Z";
    await writeFile(join(store, "sessions.json"), JSON.stringify(ended));

    await runUpdate({ sessionId: SESSION_ID, title: "x" });
    expect(process.exitCode).toBe(1);
    expect(
      errSpy.mock.calls.some((c) => /already ended/i.test(c[0] as string)),
    ).toBe(true);
  });

  it("rejects --risk with unknown level", async () => {
    await seedOpenSession();
    await runUpdate({ sessionId: SESSION_ID, risk: "bogus" });
    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.length).toBeGreaterThan(0);
  });

  it("rejects --agent with unknown id", async () => {
    await seedOpenSession();
    await runUpdate({ sessionId: SESSION_ID, agent: "ghost-agent" });
    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.length).toBeGreaterThan(0);
  });
});
```

Add the `sessionUpdateCommand` import to the test file (T5 implementation will export it).

- [ ] **Step 6: Run RED on session tests**

Run: `pnpm --filter @megasaver/cli test --run session.test`
Expected: 11 new tests fail because `sessionUpdateCommand` is not exported.

- [ ] **Step 7: Implement `apps/cli/src/commands/session/update.ts` (GREEN)**

Create `apps/cli/src/commands/session/update.ts`. The shape mirrors the other subcommand modules:

```ts
import {
  type CoreRegistry,
  type SessionUpdatePatch,
  SessionUpdatePatchSchema,
} from "@megasaver/core";
import { sessionIdSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import { z } from "zod";
import {
  mapErrorToCliMessage,
  nothingToUpdateMessage,
} from "../../errors.js";
import { ensureStoreReady, resolveStorePath } from "../../store.js";

export type RunSessionUpdateInput = {
  sessionId: string;
  titleFlag: string | undefined;
  riskFlag: string | undefined;
  agentFlag: string | undefined;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runSessionUpdate(input: RunSessionUpdateInput): Promise<0 | 1> {
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

  let parsedSessionId: string;
  try {
    parsedSessionId = sessionIdSchema.parse(input.sessionId);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "session" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  const patch: SessionUpdatePatch = {};
  if (input.titleFlag !== undefined) {
    patch.title = input.titleFlag === "" ? null : input.titleFlag;
  }
  if (input.riskFlag !== undefined) patch.riskLevel = input.riskFlag as never;
  if (input.agentFlag !== undefined) patch.agentId = input.agentFlag as never;

  if (Object.keys(patch).length === 0) {
    const cli = nothingToUpdateMessage();
    input.stderr(cli.message);
    return cli.exitCode;
  }

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);
    registry.updateSession(parsedSessionId as never, patch);
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "session_update" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const sessionUpdateCommand = defineCommand({
  meta: { name: "update", description: "Update fields on an open session." },
  args: {
    sessionId: {
      type: "positional",
      required: true,
      description: "Session id (UUID).",
    },
    title: { type: "string", description: "New title (empty string clears)." },
    // Keep in sync with agentIdSchema in @megasaver/shared.
    risk: {
      type: "string",
      description: "New risk level (low | medium | high | critical).",
    },
    // Keep in sync with agentIdSchema in @megasaver/shared.
    agent: {
      type: "string",
      description: "New agent id (claude-code | codex | cursor | generic-cli).",
    },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const code = await runSessionUpdate({
      sessionId: typeof args.sessionId === "string" ? args.sessionId : "",
      titleFlag: typeof args.title === "string" ? args.title : undefined,
      riskFlag: typeof args.risk === "string" ? args.risk : undefined,
      agentFlag: typeof args.agent === "string" ? args.agent : undefined,
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
```

The two `as never` casts are intentional escape hatches for the TS type narrowing on the patch object — the runtime `SessionUpdatePatchSchema.parse` inside Core's `updateSession` validates the actual shape. If `noUncheckedIndexedAccess` or `exactOptionalPropertyTypes` complains, prefer narrowing via Zod (`riskLevelSchema.parse(input.riskFlag)` before assigning) — that's the cleaner path.

- [ ] **Step 8: Wire `sessionUpdateCommand` into `index.ts`**

In `apps/cli/src/commands/session/index.ts`, add the import + re-export + sub-command wiring:

```ts
import { sessionUpdateCommand } from "./update.js";

// ...existing...

export {
  type RunSessionUpdateInput,
  runSessionUpdate,
  sessionUpdateCommand,
} from "./update.js";

export const sessionCommand = defineCommand({
  meta: { name: "session", description: "Manage Mega Saver sessions." },
  subCommands: {
    create: sessionCreateCommand,
    list: sessionListCommand,
    show: sessionShowCommand,
    end: sessionEndCommand,
    update: sessionUpdateCommand,
  },
});
```

- [ ] **Step 9: Run all CLI tests; confirm GREEN**

Run: `pnpm --filter @megasaver/cli test --run`
Expected: 128 prior + 13 new = **141 passing**.

- [ ] **Step 10: Lint**

Run: `pnpm --filter @megasaver/cli exec biome check src test`
Expected: clean.

- [ ] **Step 11: Commit**

```bash
git add apps/cli/src/errors.ts \
        apps/cli/src/commands/session/update.ts \
        apps/cli/src/commands/session/index.ts \
        apps/cli/test/session.test.ts \
        apps/cli/test/errors.test.ts
git commit -m "feat(cli): mega session update + errors plumbing"
```

---

### Task 6: Ship — changeset + wiki + verify

**Files:**
- Create: `.changeset/mega-session-update.md`
- Modify: `wiki/entities/cli.md`
- Modify: `wiki/entities/core.md`
- Modify: `wiki/index.md`
- Modify: `wiki/log.md`

**Goal:** DoD verify, changeset, wiki updates. PR slot left `TBD` (post-merge fill).

- [ ] **Step 1: `pnpm verify`**

Run: `pnpm verify`
Expected: green. Total tests: 24 (shared) + 128 (core) + 56 (connectors-shared) + 45 (connector-claude-code) + 26 (connector-generic-cli) + 141 (cli) = **420**.

If verify is red, STOP and report BLOCKED.

- [ ] **Step 2: Write changeset**

Create `.changeset/mega-session-update.md`:

```md
---
"@megasaver/core": minor
"@megasaver/cli": minor
---

Add `mega session update <sessionId> [--title …] [--risk …] [--agent …]`
for partial mutation of an open session. Empty `--title ""` clears
to `null`; ended sessions are rejected (`session_already_ended`);
`mega session update <id>` with no flags emits `error: nothing to
update`. `@megasaver/core` exports `SessionUpdatePatchSchema` and a
new `CoreRegistry.updateSession(id, patch)` method on both the
in-memory and JSON-directory implementations. `apps/cli`'s
`commands/session.ts` is split into a `commands/session/`
directory closing v0.1 backlog item I5.
```

- [ ] **Step 3: Update `wiki/entities/cli.md`**

Add a new `### \`mega session update <sessionId> ...\`` subsection between `mega session end` and `mega connector sync`:

```md
### `mega session update <sessionId> [--title "..."] [--risk medium] [--agent <id>]`

Partial update of an open session. At least one of `--title`,
`--risk`, `--agent` is required; otherwise the command exits 1
with `error: nothing to update`. `--title ""` clears the title to
`null` (matches `session create` accept-empty semantics). Ended
sessions are rejected with `session_already_ended`. Silent stdout
on success, exit 0.
```

In the `## Risk` section near the bottom, append:

```md
Session update + I5 split: PR <https://github.com/haJ1t/MegaSaver/pull/TBD> (TBD).
```

- [ ] **Step 4: Update `wiki/entities/core.md`**

Find the section that documents the `CoreRegistry` interface. Add a sentence to the methods list (or wherever methods are enumerated):

> `updateSession(id, patch)` — partial mutation on an open session.
> Throws `session_not_found` (unknown id) or `session_already_ended`
> (closed session). Patch validated by `SessionUpdatePatchSchema`
> (Zod, strict + ≥1 key required).

If the file lists exported schemas, add `SessionUpdatePatchSchema`
alongside `sessionSchema`.

- [ ] **Step 5: Update `wiki/index.md` Status section**

Replace the leading paragraph so `mega session update` is the lead announcement. Bump test counts:
- core 116 → 128 (+12 across in-memory + json-directory)
- cli 128 → 141 (+13 across update + errors)
- total 395 → 420

The replacement leading paragraph (preserve existing Markdown style):

> `mega session update` + I5 split landed via PR #TBD (`TBD`):
> new `mega session update <sessionId> [--title …] [--risk …]
> [--agent …]` for partial mutation of an open session. `--title ""`
> clears to `null`; ended sessions are rejected. `@megasaver/core`
> exports `SessionUpdatePatchSchema` and a new
> `CoreRegistry.updateSession(id, patch)` method on both the
> in-memory and JSON-directory implementations. `apps/cli`'s
> `commands/session.ts` (511 LOC > §8 300 threshold) is split into
> `commands/session/{create,list,show,end,update,shared,index}.ts`
> closing v0.1 backlog item I5. Previously: …

(Continue with the existing prior-merge prose.)

- [ ] **Step 6: Append to `wiki/log.md`**

Append at the END of the file:

```md
## [2026-05-09] schema | mega session update + I5 split

- Spec: `docs/superpowers/specs/2026-05-09-mega-session-update-design.md`
- Plan: `docs/superpowers/plans/2026-05-09-mega-session-update-plan.md`
- Branch: `feat/session-update`
- Result: `mega session update <sessionId> [--title …] [--risk …]
  [--agent …]` for partial open-session mutation. `@megasaver/core`
  ships `SessionUpdatePatchSchema` and `CoreRegistry.updateSession`
  on both in-memory and JSON-directory implementations. CLI's
  `commands/session.ts` (511 LOC) split into `commands/session/`
  directory; closes v0.1 backlog item I5. 25 new tests (12 core +
  13 cli). core 116 → 128, cli 128 → 141, total 395 → 420.
  PR: TBD.
```

- [ ] **Step 7: Final `pnpm verify`**

Run: `pnpm verify`
Expected: still green.

- [ ] **Step 8: Commit**

```bash
git add .changeset/mega-session-update.md \
        wiki/entities/cli.md wiki/entities/core.md \
        wiki/index.md wiki/log.md
git commit -m "feat(session): ship update + I5 split"
```

---

## Self-review

**Spec coverage:**
- §3.1 Core schema + `updateSession` interface → T1. ✓
- §3.1 in-memory impl → T2. ✓
- §3.1 JSON-directory impl → T3. ✓
- §3.2 split refactor → T4. ✓
- §3.3 CLI new subcommand → T5. ✓
- §3.4 errors module extensions → T5. ✓
- §5 file LOC budget post-split → T4 (verified by inspection at end of split). ✓
- §6 test plan (12 core + 13 cli = 25) → T2 (6) + T3 (6) + T5 (13). ✓
- §7 risk MEDIUM, full chain → T6 runs `pnpm verify`. ✓
- §9 migration: none required → no migration step in any task. ✓

**Placeholder scan:** every `TBD` is the intentional post-merge PR-fill marker. No "TODO" / "TBD" appears in production code.

**Type consistency:**
- `SessionUpdatePatch = { title?: string | null; riskLevel?: RiskLevel; agentId?: AgentId }` consistent across §3.1 / T1 / T2 / T3 / T5.
- `CoreRegistry.updateSession(id, patch)` signature consistent.
- CLI helpers: `RunSessionUpdateInput`, `runSessionUpdate`, `sessionUpdateCommand` follow the same shape as the other 4 subcommand exports.
- `nothingToUpdateMessage` returns `{ message: "error: nothing to update", exitCode: 1 }` everywhere.

**Test math:** Core +12 (T2: 6, T3: 6) + CLI +13 (T5: 11 update + 2 errors) = +25. core 116 → 128; cli 128 → 141; total 395 → 420. Math holds.

---

## Execution

Plan saved. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task,
   two-stage review (spec compliance → code quality) between
   tasks.
2. **Inline Execution** — same session, batch checkpoints.

Defaults to subagent-driven if not specified.
