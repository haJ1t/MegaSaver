# connector status S1+S2 followups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close two of the twelve critic findings against PR #15 (`mega connector status`): S1 swap `pickLatestOpenSession` to a numeric `Date.parse` comparator, S2 add the `session=<id|none>` suffix to the `error` status line.

**Architecture:** Single-package edit on `apps/cli/src/commands/connector.ts`. S1 changes one comparator inside `pickLatestOpenSession` and adds one behavioural test (offset vs UTC instant disagree). S2 hoists the existing `sessionLabel` computation above the per-target try/catch so the catch branch can reuse it; sync output is left untouched. Two existing status tests flip to the new error wording. Spec + wiki prose updated to drop the "no session suffix on error" caveat.

**Tech Stack:** TypeScript strict ESM, Node 22, pnpm + Turborepo, Vitest, Biome, Citty, Zod.

**Spec:** `docs/superpowers/specs/2026-05-09-connector-status-followups-design.md`.

**Working dir for every step:** `/Users/halitozger/Desktop/MegaSaver/.worktrees/connector-status-followups` (branch `feat/connector-status-followups`). All `pnpm` invocations run from there.

**Build/test commands:**

```bash
pnpm --filter @megasaver/cli build
pnpm --filter @megasaver/cli test --run
pnpm verify
```

---

## File map

- **Modify** `apps/cli/src/commands/connector.ts`
  - S1: change one line inside `pickLatestOpenSession` (the reduce comparator).
  - S2: hoist `pickLatestOpenSession` + `sessionLabel` above the per-target try/catch; pass `sessionLabel` to the `error` `formatStatusLine` call.
- **Modify** `apps/cli/test/connector.test.ts` — append one new test inside the existing pre-target-gates describe block (or a fresh describe block at the end) that pins the comparator behaviour.
- **Modify** `apps/cli/test/connector-status.test.ts` — flip two assertions in the "error + cross-target" describe block.
- **Modify** `docs/superpowers/specs/2026-05-09-mega-connector-status-design.md` — drop "(no session suffix on `error`)" caveats in §0 and §4; add an `error` line to the §4 worked example.
- **Modify** `wiki/entities/cli.md` — drop the "(no session suffix on `error`)" parenthetical in the `mega connector status` subsection.
- **Modify** `wiki/index.md` — Status section: mark S1 / S2 / S12 as closed in this slot, leave S3–S11 open.
- **Append** `wiki/log.md` — new schema entry.
- **Create** `.changeset/connector-status-followups.md` — `@megasaver/cli` patch.

No changes to `apps/cli/src/main.ts`, `apps/cli/src/errors.ts`, `apps/cli/package.json`, `packages/core`, or any package outside `apps/cli`.

---

## Conventions every task obeys

- Caveman-commit: subject ≤ 50 chars, imperative; body only when WHY is non-obvious.
- TDD: write failing test, RED, implement, GREEN, commit.
- After every task run `pnpm --filter @megasaver/cli test --run`. After T3 run full `pnpm verify`.
- Sync output remains byte-identical (existing 21 connector-sync tests must keep passing unchanged).

---

### Task 1: S1 — `pickLatestOpenSession` numeric comparator

**Files:**
- Modify: `apps/cli/src/commands/connector.ts`
- Modify: `apps/cli/test/connector.test.ts`

**Goal:** Switch the reduce comparator from string `>` to
`Date.parse` numeric `>` and pin the change with a behavioural
test that exercises the offset-vs-UTC disagreement.

- [ ] **Step 1: Add the failing test (RED)**

Append the following test to the END of `apps/cli/test/connector.test.ts`. The
file already imports `mkdtemp`, `writeFile`, `mkdir`, `rm`, `readFile`,
`tmpdir`, `join`, `vi`, and `connectorSyncCommand`. Reuse those — do not
re-declare imports. Add the new describe at the end of the file so the
existing fixtures are not reorganised.

```ts
describe("pickLatestOpenSession — numeric ranking", () => {
  let store: string;
  let projectRoot: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-pickrank-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-cli-pickrank-root-"));
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

  const PROJECT_ID_RANK = "44444444-4444-4444-8444-444444444444";
  const SESS_A = "55555555-5555-4555-8555-555555555555";
  const SESS_B = "66666666-6666-4666-8666-666666666666";

  it("ranks open sessions by UTC instant, not lexicographic order", async () => {
    // Two open claude-code sessions whose lexicographic compare
    // disagrees with the numeric (instant) compare.
    //   sess-A startedAt = 2026-05-09T10:00:00+02:00 (UTC 08:00 — earlier)
    //   sess-B startedAt = 2026-05-09T09:00:00Z      (UTC 09:00 — later)
    // Lexicographic ">" picks A ("10..." > "09...").
    // Numeric Date.parse picks B (later instant).
    // Expected: status emits B's id.
    await mkdir(store, { recursive: true });
    const ts = "2026-05-09T00:00:00.000Z";
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        {
          id: PROJECT_ID_RANK,
          name: "rank",
          rootPath: projectRoot,
          createdAt: ts,
          updatedAt: ts,
        },
      ]),
    );
    await writeFile(
      join(store, "sessions.json"),
      JSON.stringify([
        {
          id: SESS_A,
          projectId: PROJECT_ID_RANK,
          agentId: "claude-code",
          riskLevel: "medium",
          title: null,
          startedAt: "2026-05-09T10:00:00+02:00",
          endedAt: null,
        },
        {
          id: SESS_B,
          projectId: PROJECT_ID_RANK,
          agentId: "claude-code",
          riskLevel: "medium",
          title: null,
          startedAt: "2026-05-09T09:00:00Z",
          endedAt: null,
        },
      ]),
    );

    const { connectorStatusCommand } = await import("../src/commands/connector.js");
    await connectorStatusCommand.run?.({
      args: { projectName: "rank", store, target: "claude-code" },
      cmd: connectorStatusCommand,
      rawArgs: [],
      data: undefined,
    } as never);

    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines).toEqual([
      `claude-code  CLAUDE.md  missing  session=${SESS_B}`,
    ]);
  });
});
```

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @megasaver/cli test --run connector.test`
Expected: the new test fails because the lexicographic comparator
picks `SESS_A`, so the assertion sees `session=55555555-...`
instead of `session=66666666-...`.

- [ ] **Step 3: Implement (GREEN)**

In `apps/cli/src/commands/connector.ts`, locate the existing
`pickLatestOpenSession` function:

```ts
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

Replace ONLY the reduce body. Final form:

```ts
function pickLatestOpenSession(
  sessions: readonly Session[],
  agentId: ConnectorTarget["agentId"],
): Session | null {
  const candidates = sessions.filter((s) => s.endedAt === null && s.agentId === agentId);
  if (candidates.length === 0) return null;
  return candidates.reduce((latest, current) =>
    Date.parse(current.startedAt) > Date.parse(latest.startedAt) ? current : latest,
  );
}
```

- [ ] **Step 4: Run all CLI tests; confirm GREEN**

Run: `pnpm --filter @megasaver/cli test --run`
Expected: 119 prior + 1 new = **120 passing**. Sync tests still
green (sync calls the same `pickLatestOpenSession`; the comparator
fix is silent for the only-Z writers used in those fixtures).

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/connector.ts apps/cli/test/connector.test.ts
git commit -m "fix(cli): pickLatestOpenSession numeric compare"
```

---

### Task 2: S2 — error line session suffix

**Files:**
- Modify: `apps/cli/src/commands/connector.ts`
- Modify: `apps/cli/test/connector-status.test.ts`

**Goal:** Hoist `sessionLabel` above the per-target try/catch in
`runConnectorStatus`, then pass it to the `error` `formatStatusLine`
call so the error line carries `session=<id|none>` like every other
status word. Update the two existing tests that pin the old shape.

- [ ] **Step 1: Update both error-test assertions (RED)**

In `apps/cli/test/connector-status.test.ts`, the "error +
cross-target" describe block contains two tests that assert the
old session-less error line shape. Update them:

(a) The block-conflict test currently asserts:

```ts
expect(lines).toEqual(["claude-code  CLAUDE.md  error"]);
```

Change to:

```ts
expect(lines).toEqual(["claude-code  CLAUDE.md  error  session=none"]);
```

(b) The unreadable-file test currently asserts:

```ts
expect(lines[0]).toBe("claude-code  CLAUDE.md  error");
expect(lines[1]).toBe("codex        AGENTS.md  missing  session=none");
```

Update line[0] only:

```ts
expect(lines[0]).toBe("claude-code  CLAUDE.md  error  session=none");
expect(lines[1]).toBe("codex        AGENTS.md  missing  session=none");
```

Do not touch the cross-target mixed-state test — it does not
emit any `error` lines.

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @megasaver/cli test --run connector-status`
Expected: both modified tests fail because the production code
still emits the bare `"error"` line.

- [ ] **Step 3: Implement (GREEN)**

In `apps/cli/src/commands/connector.ts`, locate the per-target
loop inside `runConnectorStatus` (begins with `for (const target of
targets)`). The current shape is roughly:

```ts
for (const target of targets) {
  try {
    const absPath = join(project.rootPath, target.relativePath);
    const existing = await readTargetFile(absPath);
    const session = pickLatestOpenSession(sessions, target.agentId);
    const sessionLabel = session === null ? "none" : session.id;

    if (existing === null) {
      input.stdout(formatStatusLine(target, "missing", sessionLabel));
      continue;
    }

    const parsed = parseBlock(existing);
    if (parsed.block === null) {
      anyDriftOrError = true;
      input.stdout(formatStatusLine(target, "no-block", sessionLabel));
      continue;
    }

    const context = buildConnectorContext(target, project, sessions);
    const upserted = upsertBlock({ existingContent: existing, context });
    if (upserted === existing) {
      input.stdout(formatStatusLine(target, "in-sync", sessionLabel));
      continue;
    }
    anyDriftOrError = true;
    input.stdout(formatStatusLine(target, "drift", sessionLabel));
  } catch (err) {
    anyDriftOrError = true;
    input.stdout(formatStatusLine(target, "error"));
    const cli = mapErrorToCliMessage(err, {
      kind: "connector",
      targetId: target.id,
      relativePath: target.relativePath,
    });
    input.stderr(cli.message);
  }
}
```

Move the `session` and `sessionLabel` declarations OUT of the
try block so the catch branch can use them. Pass `sessionLabel`
to the `formatStatusLine(target, "error", ...)` call. Final
shape:

```ts
for (const target of targets) {
  const session = pickLatestOpenSession(sessions, target.agentId);
  const sessionLabel = session === null ? "none" : session.id;
  try {
    const absPath = join(project.rootPath, target.relativePath);
    const existing = await readTargetFile(absPath);

    if (existing === null) {
      input.stdout(formatStatusLine(target, "missing", sessionLabel));
      continue;
    }

    const parsed = parseBlock(existing);
    if (parsed.block === null) {
      anyDriftOrError = true;
      input.stdout(formatStatusLine(target, "no-block", sessionLabel));
      continue;
    }

    const context = buildConnectorContext(target, project, sessions);
    const upserted = upsertBlock({ existingContent: existing, context });
    if (upserted === existing) {
      input.stdout(formatStatusLine(target, "in-sync", sessionLabel));
      continue;
    }
    anyDriftOrError = true;
    input.stdout(formatStatusLine(target, "drift", sessionLabel));
  } catch (err) {
    anyDriftOrError = true;
    input.stdout(formatStatusLine(target, "error", sessionLabel));
    const cli = mapErrorToCliMessage(err, {
      kind: "connector",
      targetId: target.id,
      relativePath: target.relativePath,
    });
    input.stderr(cli.message);
  }
}
```

Constraints:
- Do not change `runConnectorSync`. Sync's per-target loop and its
  error line stay session-less.
- Do not modify `formatStatusLine`'s signature — its third arg has
  been optional since T1 of the previous slot.
- Do not modify `buildConnectorContext`.

- [ ] **Step 4: Run all CLI tests; confirm GREEN**

Run: `pnpm --filter @megasaver/cli test --run`
Expected: 120 passing (the two updated assertions now match;
nothing else flips). Sync tests unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/connector.ts apps/cli/test/connector-status.test.ts
git commit -m "fix(cli): connector status error line session suffix"
```

---

### Task 3: Ship — spec, wiki, changeset, verify

**Files:**
- Modify: `docs/superpowers/specs/2026-05-09-mega-connector-status-design.md`
- Modify: `wiki/entities/cli.md`
- Modify: `wiki/index.md`
- Modify: `wiki/log.md`
- Create: `.changeset/connector-status-followups.md`

**Goal:** Update prose to reflect the new contract, run full DoD
verify, and commit. PR slots remain `TBD` and are filled
post-merge by the controller.

- [ ] **Step 1: Update the `mega connector status` design spec**

Open `docs/superpowers/specs/2026-05-09-mega-connector-status-design.md`
and apply two edits.

(a) §0 TL;DR contains:

```text
Status words on stdout: `wrote`, `noop`, ...
```

Wait — re-read the file before editing. The actual §0 paragraph
ends with a status-word list. Do NOT touch §0 if the wording does
not include "no session suffix on error". The phrase you're hunting
for actually lives in §4 (Output) — see (b).

(b) §4 Output contains the sentence:

```
`<id>  <relPath>  <status>  session=<id|none>` (no session suffix on
`error`).
```

Replace with:

```
`<id>  <relPath>  <status>  session=<id|none>`. Every status word —
including `error` — emits the session suffix.
```

The §4 worked example currently shows:

```text
claude-code  CLAUDE.md   in-sync   session=01HXY...
codex        AGENTS.md   drift     session=none
```

Append a third worked-example line to demonstrate the error case:

```text
codex        AGENTS.md   error     session=none
```

If the wording shape in the existing spec differs slightly, keep
the substantive change (drop the "no session suffix on error"
caveat and add an error worked example) but match the surrounding
prose.

- [ ] **Step 2: Update `wiki/entities/cli.md`**

In the `### \`mega connector status ...\`` subsection, find the
sentence that currently says (paraphrased):

```
Output line is `<id>  <relPath>  <status>  session=<id|none>`
(no session suffix on `error`).
```

Drop the `(no session suffix on \`error\`)` parenthetical:

```
Output line is `<id>  <relPath>  <status>  session=<id|none>`.
```

- [ ] **Step 3: Update `wiki/index.md` Status section**

The Status section currently lists S1, S2, S3, S4, S5, S6, S7, S8,
S9, S10, S11, S12 as open critic followups for PR #15. Replace the
list with one closed pointer + the still-open subset:

(a) Find the long paragraph that begins
`Critic v0.2 followups for PR #15 (\`mega connector status\`):` and
ends with `S12 dedupe per-target session compute in \`runConnectorStatus\`.`

(b) Replace it with this paragraph (PR # placeholder filled
post-merge):

```
Critic v0.2 followups for PR #15 (`mega connector status`):
S1 + S2 + S12 closed in PR #TBD (`TBD`) — `pickLatestOpenSession`
switched to `Date.parse` numeric compare; `error` status line now
carries `session=<id|none>` for column symmetry; S12 closed by
decision (the duplicate compute inside `buildConnectorContext`
is kept deliberately to preserve its self-contained shape).
Still open: S3 extract `resolveProjectAndRoot` shared prologue
between sync + status when third consumer arrives; S4 split
`apps/cli/src/commands/connector.ts` (366 LOC) into
`connector/{sync,status,shared,index}.ts`; S5 harden read-path
symlink semantics (`readTargetFile` lstat-first or
`assertTargetWithinProject`); S6 regression-fixture asserting
`upsertBlock(existing, ctx) === existing` for seeded files
inoculates byte-equality predicate; S7 multi-open-session
tie-break test; S8 `--target` help-text divergence (filter ≠
seed); S9 spec §4 example uses 3-space gutter, impl + tests use
2; S10 spec §11 concurrency stanza for status vs concurrent
sync; S11 `targets.length > 0` invariant after filter.
```

- [ ] **Step 4: Append `wiki/log.md`**

Append a new entry at the END of `wiki/log.md`:

```md
## [2026-05-09] schema | connector status S1+S2 followups

- Spec: `docs/superpowers/specs/2026-05-09-connector-status-followups-design.md`
- Plan: `docs/superpowers/plans/2026-05-09-connector-status-followups-plan.md`
- Branch: `feat/connector-status-followups`
- Result: closes critic findings S1 + S2 + S12 against PR #15.
  S1 swaps `pickLatestOpenSession` from lexicographic compare to
  `Date.parse` numeric compare (one line, both call sites — sync
  and status — fixed). S2 hoists `sessionLabel` above the
  per-target try/catch in `runConnectorStatus` so the `error`
  line carries `session=<id|none>` matching the other four
  status words. S12 closed by decision (the duplicate
  `pickLatestOpenSession` call inside `buildConnectorContext` is
  kept deliberately). 1 new CLI test (offset-vs-instant
  ranking), 2 existing tests flip wording. CLI 119 → 120,
  total 379 → 380. PR: TBD.
```

- [ ] **Step 5: Write the changeset**

Create `.changeset/connector-status-followups.md`:

```md
---
"@megasaver/cli": patch
---

Fix `mega connector status`: swap `pickLatestOpenSession` to a
`Date.parse` numeric comparator (correct ranking under mixed
RFC 3339 offsets) and emit the `session=<id|none>` suffix on the
`error` status line for column symmetry across all five status
words. Sync output is unchanged.
```

- [ ] **Step 6: Run `pnpm verify`**

Run: `pnpm verify`
Expected: lint + typecheck + Vitest all green. Total test count:
`@megasaver/cli` 120; project total 380.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/specs/2026-05-09-mega-connector-status-design.md \
        wiki/entities/cli.md wiki/index.md wiki/log.md \
        .changeset/connector-status-followups.md
git commit -m "docs(cli): record S1+S2 followup ship"
```

---

## Self-review

**Spec coverage:**
- §3 S1 comparator change → T1 (RED → swap reduce body → GREEN, +1 test). ✓
- §4 S2 hoist `sessionLabel` + suffix on `error` → T2 (flip 2 assertions, hoist, swap one call site). ✓
- §4 closes S12 by decision → T3 wiki update explicitly says so. ✓
- §5 test changes (1 new, 2 flipped) → T1 adds the new test, T2 flips both. ✓
- §6 spec + wiki + log + changeset prose → T3 covers all four files. ✓
- §7 out-of-scope items → none of S3–S11 appear in any task. ✓
- §8 risk MEDIUM, full chain → T3 runs full `pnpm verify`; this slot will receive code-reviewer + critic-equivalent passes after T3 the same way the prior slot did. ✓

**Placeholder scan:** every `TBD` is the intentional post-merge
PR-fill marker (sync's pattern). No "TBD" / "TODO" appears in
production code or test code.

**Type consistency:** `formatStatusLine(target, status, session?)`
is unchanged; the new T2 call adds the third arg at one call site.
`pickLatestOpenSession` retains its return type `Session | null`.
No new symbols are introduced. `runConnectorSync`'s per-target
loop is not touched.

**Test math:** +1 new (T1) + 2 modified (T2) → CLI 119 → 120;
project 379 → 380.

---

## Execution

Plan saved. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task,
   two-stage review (spec compliance → code quality) between
   tasks.
2. **Inline Execution** — same session, batch checkpoints.

Defaults to subagent-driven if not specified.
