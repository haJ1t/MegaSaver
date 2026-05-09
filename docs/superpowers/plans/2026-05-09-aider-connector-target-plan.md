# Aider Connector Target Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `aider` as the 4th built-in connector target (`CONVENTIONS.md`), completing the v0.1 connector matrix (claude-code + codex + cursor + aider).

**Architecture:** Mirror the cursor target pattern but with the `header` field absent (plain markdown). Touch three packages (`@megasaver/shared`, `@megasaver/connector-generic-cli`, `@megasaver/cli`) additively. Existing `upsertBlock` / `parseBlock` / `renderBlock` primitives are not modified. Pre-existing `CONVENTIONS.md` content (e.g. team conventions) is preserved in the `before` region; the rendered block is appended at the end and replaced in-place on subsequent syncs.

**Tech Stack:** TypeScript strict ESM, Node 22 LTS, Vitest, Citty, Zod, pnpm workspaces, Turborepo.

**Spec:** `docs/superpowers/specs/2026-05-09-aider-connector-target-design.md`.

**Worktree:** `.worktrees/aider-target` on branch `feat/aider-target`.

---

## File Structure

| File | Type | Responsibility |
|------|------|----------------|
| `packages/shared/src/agent-id.ts` | Modify | Add `"aider"` to `agentIdSchema` (alphabetic insert as first member). |
| `packages/shared/test/agent-id.test.ts` | Modify | Add explicit `"aider"` parse test, update drift-guard `members` array (4→5) and `widens-to-N` count. |
| `packages/connectors/generic-cli/src/targets.ts` | Modify | Add `aiderTarget` const (no header), append to `builtinTargets`. |
| `packages/connectors/generic-cli/test/targets.test.ts` | Modify | +5 tests covering aiderTarget shape, header-absence, builtinTargets membership, findTarget. |
| `apps/cli/src/errors.ts` | Modify | Append `"aider"` to `KNOWN_TARGET_IDS` (launch order). |
| `apps/cli/src/commands/connector.ts` | Modify | Import `aiderTarget` from `@megasaver/connector-generic-cli`, append to `KNOWN_TARGETS`. |
| `apps/cli/test/connector.test.ts` | Modify | Update pinned `invalid target` error message (now includes `aider`) + 3 new sync tests. |
| `apps/cli/test/connector-status.test.ts` | Modify | Update pinned `invalid target` error message + 2 new status tests. |
| `apps/cli/test/session.test.ts` | Modify | +1 test for `mega session create --agent aider`. |

**Total new tests:** 13 (2 shared + 5 generic-cli + 6 CLI). Project total 455 → 468.

---

## Task 1: `@megasaver/shared` — agent-id enum widening

**Files:**
- Modify: `packages/shared/src/agent-id.ts`
- Test: `packages/shared/test/agent-id.test.ts`

- [ ] **Step 1: Add the failing explicit-parse test**

Open `packages/shared/test/agent-id.test.ts` and append a new `it` block inside the existing `describe("agentIdSchema", ...)`:

```ts
  it("explicitly accepts 'aider'", () => {
    expect(agentIdSchema.parse("aider")).toBe("aider");
  });
```

Place it next to the existing `it("explicitly accepts 'cursor'", ...)` block for symmetry.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/aider-target
pnpm --filter @megasaver/shared exec vitest run agent-id
```

Expected: 1 FAIL — `agentIdSchema.parse("aider")` throws `ZodError` with `invalid_enum_value`. Other tests still PASS.

- [ ] **Step 3: Add `"aider"` to the enum (alphabetic-first)**

Edit `packages/shared/src/agent-id.ts`:

```ts
import { z } from "zod";

export const agentIdSchema = z.enum(["aider", "claude-code", "codex", "cursor", "generic-cli"]);

export type AgentId = z.infer<typeof agentIdSchema>;
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @megasaver/shared exec vitest run agent-id
```

Expected: the new explicit-aider test PASSES. The drift-guard test `widens to 4 closed-set members` will now FAIL because `members` array still has length 4 — that is the next step.

- [ ] **Step 5: Update the drift-guard `members` array and rename the count test**

Edit `packages/shared/test/agent-id.test.ts`. Update the `members` constant and the count assertion:

```ts
const members: ReadonlyArray<AgentId> = ["aider", "claude-code", "codex", "cursor", "generic-cli"];
```

```ts
  it("widens to 5 closed-set members", () => {
    expect(members).toHaveLength(5);
  });
```

The property tests `property: any enum member is accepted` and `property: any string outside the enum is rejected` already iterate `members`, so they automatically cover `"aider"` after this update.

- [ ] **Step 6: Run all shared tests**

```bash
pnpm --filter @megasaver/shared exec vitest run
```

Expected: ALL PASS. Test count delta: shared 24 → 26 (+1 explicit aider, +1 from the renamed `widens-to-5`; the original `widens-to-4` test was renamed and the count delta nets to +2 vs the cursor baseline).

- [ ] **Step 7: Commit**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/aider-target
git add packages/shared/src/agent-id.ts packages/shared/test/agent-id.test.ts
git commit -m "feat(shared): add aider to agent-id enum"
```

---

## Task 2: `@megasaver/connector-generic-cli` — `aiderTarget` manifest

**Files:**
- Modify: `packages/connectors/generic-cli/src/targets.ts`
- Test: `packages/connectors/generic-cli/test/targets.test.ts`

- [ ] **Step 1: Add the failing manifest tests**

Open `packages/connectors/generic-cli/test/targets.test.ts` and add the following tests at the end of the existing `describe("ConnectorTarget registry", ...)` block. Also update the `import` at line 2 to include `aiderTarget`:

```ts
import { aiderTarget, builtinTargets, codexTarget, cursorTarget, findTarget } from "../src/targets.js";
```

Append these `it` blocks inside the describe (after the existing `codexTarget has no header` test):

```ts
  it("ships the aider target", () => {
    expect(aiderTarget.id).toBe("aider");
    expect(aiderTarget.agentId).toBe("aider");
    expect(aiderTarget.relativePath).toBe("CONVENTIONS.md");
  });

  it("aiderTarget has no header (markdown plain target)", () => {
    expect(aiderTarget.header).toBeUndefined();
  });

  it("findTarget returns the aider target by id", () => {
    expect(findTarget("aider")).toBe(aiderTarget);
  });
```

Update the existing `builtinTargets contains both codex and cursor` test to also assert aider membership and the new length:

```ts
  it("builtinTargets contains codex, cursor, and aider", () => {
    expect(builtinTargets).toHaveLength(3);
    expect(builtinTargets).toContain(codexTarget);
    expect(builtinTargets).toContain(cursorTarget);
    expect(builtinTargets).toContain(aiderTarget);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @megasaver/connector-generic-cli exec vitest run
```

Expected: 4 FAIL — `aiderTarget` is undefined / not exported. TypeScript compile error or `Cannot read properties of undefined`.

- [ ] **Step 3: Add `aiderTarget` and update `builtinTargets`**

Edit `packages/connectors/generic-cli/src/targets.ts`. Final file:

```ts
import type { AgentId } from "@megasaver/shared";

export interface ConnectorTarget {
  readonly id: string;
  readonly agentId: AgentId;
  readonly relativePath: string;
  readonly header?: string;
}

export const codexTarget: ConnectorTarget = Object.freeze({
  id: "codex",
  agentId: "codex" satisfies AgentId,
  relativePath: "AGENTS.md",
});

export const cursorTarget: ConnectorTarget = Object.freeze({
  id: "cursor",
  agentId: "cursor" satisfies AgentId,
  relativePath: ".cursor/rules/megasaver.mdc",
  header: [
    "---",
    "description: Mega Saver project context (auto-managed block)",
    "alwaysApply: true",
    "---",
    "",
    "",
  ].join("\n"),
});

export const aiderTarget: ConnectorTarget = Object.freeze({
  id: "aider",
  agentId: "aider" satisfies AgentId,
  relativePath: "CONVENTIONS.md",
});

export const builtinTargets: readonly ConnectorTarget[] = Object.freeze([
  codexTarget,
  cursorTarget,
  aiderTarget,
]);

export function findTarget(id: string): ConnectorTarget | null {
  return builtinTargets.find((target) => target.id === id) ?? null;
}
```

- [ ] **Step 4: Check the public re-export surface**

Verify `packages/connectors/generic-cli/src/index.ts` re-exports the symbols. If `aiderTarget` is missing from the export list, add it. Open the file and confirm — typical pattern:

```ts
export { aiderTarget, builtinTargets, codexTarget, cursorTarget, findTarget } from "./targets.js";
export type { ConnectorTarget } from "./targets.js";
```

If the existing index just does `export * from "./targets.js";` then no edit is needed.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter @megasaver/connector-generic-cli exec vitest run
```

Expected: ALL PASS. Test count delta: generic-cli 26 → 30 (+3 net new tests: 2 shape + 1 findTarget; the existing `builtinTargets contains both codex and cursor` test was rewritten in place, not net-new). If `public-export.test.ts` pins exact export shape and breaks, update it to include `aiderTarget`.

- [ ] **Step 6: Commit**

```bash
git add packages/connectors/generic-cli/src/targets.ts packages/connectors/generic-cli/test/targets.test.ts
# Also stage src/index.ts and test/public-export.test.ts if they were edited.
git commit -m "feat(generic-cli): add aiderTarget manifest"
```

---

## Task 3: `@megasaver/cli` — wire aider into KNOWN_TARGETS + update pinned error message

**Files:**
- Modify: `apps/cli/src/errors.ts`
- Modify: `apps/cli/src/commands/connector.ts`
- Test: `apps/cli/test/connector.test.ts`
- Test: `apps/cli/test/connector-status.test.ts`

The pre-target-gate tests in both `connector.test.ts` and `connector-status.test.ts` pin the exact `invalid target` error string, which currently reads `expected: claude-code | codex | cursor`. Adding aider to `KNOWN_TARGET_IDS` mechanically widens that string. We update the assertions first (TDD), watch them fail against the unmodified production code, then wire aider in.

- [ ] **Step 1: Update both pinned error-message assertions**

In `apps/cli/test/connector.test.ts`, update the assertion at line ~70:

```ts
    expect(
      errSpy.mock.calls.some(
        (c) =>
          c[0] === 'error: invalid target "nope", expected: claude-code | codex | cursor | aider',
      ),
    ).toBe(true);
```

In `apps/cli/test/connector-status.test.ts`, update the equivalent assertion at line ~66 the same way:

```ts
    expect(
      errSpy.mock.calls.some(
        (c) =>
          c[0] === 'error: invalid target "nope", expected: claude-code | codex | cursor | aider',
      ),
    ).toBe(true);
```

- [ ] **Step 2: Run both test files to verify they fail**

```bash
pnpm --filter @megasaver/cli exec vitest run connector connector-status
```

Expected: 2 FAIL — both pinned assertions miss. The production error string still reads `… cursor` without `| aider`. Other tests PASS.

- [ ] **Step 3: Update `KNOWN_TARGET_IDS` in `apps/cli/src/errors.ts`**

Find the line that declares `KNOWN_TARGET_IDS`. Append `"aider"` (launch order, after cursor):

```ts
const KNOWN_TARGET_IDS = ["claude-code", "codex", "cursor", "aider"] as const;
```

If the constant is also referenced in the `invalidTargetMessage` builder, no other change needed there — the message is constructed via `.join(" | ")` over the full array.

- [ ] **Step 4: Wire `aiderTarget` into `connector.ts` `KNOWN_TARGETS`**

Open `apps/cli/src/commands/connector.ts`. Update the import at the top:

```ts
import {
  type ConnectorTarget,
  aiderTarget,
  codexTarget,
  cursorTarget,
} from "@megasaver/connector-generic-cli";
```

Update the `KNOWN_TARGETS` array (append `aiderTarget`, launch order):

```ts
const KNOWN_TARGETS: readonly ConnectorTarget[] = [
  CLAUDE_CODE_TARGET,
  codexTarget,
  cursorTarget,
  aiderTarget,
];
```

Also locate `KNOWN_TARGET_IDS` near the top of `connector.ts` — there is a small duplicated tuple used in the `KnownTargetId` type-narrowing helper. Update it to keep both tuples in sync:

```ts
const KNOWN_TARGET_IDS = ["claude-code", "codex", "cursor", "aider"] as const;
type KnownTargetId = (typeof KNOWN_TARGET_IDS)[number];
```

(The "Keep in sync with KNOWN_TARGET_IDS in apps/cli/src/errors.ts" comment above the tuple already documents this intent.)

- [ ] **Step 5: Run both test files to verify they pass**

```bash
pnpm --filter @megasaver/cli exec vitest run connector connector-status
```

Expected: ALL PASS. The pinned-error tests now match production output. No other tests should regress because (a) `aiderTarget` has no header, so `(target.header ?? "")` short-circuits to empty string identical to claude-code/codex; (b) the per-target loop iterates by `KNOWN_TARGETS`, which now produces an extra `skipped` line for `aider` whenever `CONVENTIONS.md` is missing — pre-existing tests that count "all targets skipped" exit-0 paths still pass because they assert *no error*, not exact line counts.

If a pre-existing test asserts an exact set of status lines and breaks because of the new aider line, update that assertion to include the new `aider …` line.

- [ ] **Step 6: Commit**

```bash
git add \
  apps/cli/src/errors.ts \
  apps/cli/src/commands/connector.ts \
  apps/cli/test/connector.test.ts \
  apps/cli/test/connector-status.test.ts
git commit -m "feat(cli): wire aider target"
```

---

## Task 4: CLI sync coverage for aider

**Files:**
- Test: `apps/cli/test/connector.test.ts`

After Task 3 the wiring is fully in place; this task adds explicit aider sync coverage. The first new test exercises a fresh `created` seed, the second exercises the **append-on-pre-existing-content** behaviour the spec calls out (Q2A: standard `upsertBlock` semantics on `CONVENTIONS.md`), the third pins the default-skip behaviour.

- [ ] **Step 1: Add the three failing aider sync tests**

Open `apps/cli/test/connector.test.ts`. Find the existing top-level describe block titled something like `"connectorSyncCommand — skipped + created"` (around line 104, the same describe used for other `created`-status tests). Inside that describe — after the existing tests but before its closing `})` — add the following block.

The describe already provides `seedProject` and a `runSync` helper; the new tests reuse them. (If the helpers live in a different describe in your local copy, mirror the same fixture pattern.)

```ts
  it("creates CONVENTIONS.md with no frontmatter when --target aider on empty project", async () => {
    await seedProject("demo", projectRoot);
    await runSync({ projectName: "demo", target: "aider" });
    expect(process.exitCode).toBe(0);
    const written = await readFile(join(projectRoot, "CONVENTIONS.md"), "utf8");
    // Plain markdown — no YAML frontmatter prefix.
    expect(written.startsWith("---\n")).toBe(false);
    expect(written).toContain("<!-- MEGA SAVER:BEGIN -->");
    expect(written).toContain("Agent: aider");
    expect(written).toContain("<!-- MEGA SAVER:END -->");
    expect(logSpy.mock.calls.some((c) => /^aider\s+CONVENTIONS\.md\s+created$/.test(c[0] as string))).toBe(true);
  });

  it("appends the block to a pre-existing CONVENTIONS.md and preserves user content", async () => {
    await seedProject("demo", projectRoot);
    const userContent = "# Team Conventions\n\n- Use 2-space indent.\n- Run pnpm verify before push.\n";
    await writeFile(join(projectRoot, "CONVENTIONS.md"), userContent);

    await runSync({ projectName: "demo", target: "aider" });

    expect(process.exitCode).toBe(0);
    const written = await readFile(join(projectRoot, "CONVENTIONS.md"), "utf8");
    // User content stays intact at the top.
    expect(written.startsWith("# Team Conventions\n")).toBe(true);
    expect(written).toContain("- Use 2-space indent.");
    expect(written).toContain("- Run pnpm verify before push.");
    // Block is appended below.
    expect(written).toMatch(/Run pnpm verify before push\.\n+<!-- MEGA SAVER:BEGIN -->/);
    expect(written.endsWith("<!-- MEGA SAVER:END -->\n")).toBe(true);
    // Status word is "wrote" because file existed (not "created").
    expect(logSpy.mock.calls.some((c) => /^aider\s+CONVENTIONS\.md\s+wrote$/.test(c[0] as string))).toBe(true);
  });

  it("default sync (no --target) silently skips a missing CONVENTIONS.md", async () => {
    await seedProject("demo", projectRoot);
    await runSync({ projectName: "demo" });
    expect(process.exitCode).toBe(0);
    expect(logSpy.mock.calls.some((c) => /^aider\s+CONVENTIONS\.md\s+skipped$/.test(c[0] as string))).toBe(true);
  });
```

(`readFile`, `writeFile`, and `join` are already imported at the top of the file from earlier tests; if your top-of-file imports differ, ensure these are available.)

- [ ] **Step 2: Run the connector sync tests**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/aider-target
pnpm --filter @megasaver/cli exec vitest run connector.test
```

Expected: ALL three new aider tests PASS (Task 3 already wired the behaviour). Existing connector tests remain green. If the `wrote` status assertion fails because the existing-file branch reports a different status word, inspect the runtime by adding `console.log(logSpy.mock.calls)` temporarily to confirm the actual word, then align the regex.

- [ ] **Step 3: Commit**

```bash
git add apps/cli/test/connector.test.ts
git commit -m "test(cli): aider connector sync coverage"
```

---

## Task 5: CLI status + session coverage for aider

**Files:**
- Test: `apps/cli/test/connector-status.test.ts`
- Test: `apps/cli/test/session.test.ts`

- [ ] **Step 1: Add the failing aider status tests**

Open `apps/cli/test/connector-status.test.ts`. Find the describe block that contains existing `missing`/`in-sync` tests (the `connectorStatusCommand — missing + no-block` describe around line 82, or the equivalent one that constructs full project/session fixtures). Append:

```ts
  it("reports all four targets missing on an empty project root", async () => {
    await seedProject("demo", projectRoot);
    await runStatus({ projectName: "demo" });
    expect(process.exitCode).toBe(0);
    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines.some((l) => /^claude-code\s+CLAUDE\.md\s+missing/.test(l))).toBe(true);
    expect(lines.some((l) => /^codex\s+AGENTS\.md\s+missing/.test(l))).toBe(true);
    expect(lines.some((l) => /^cursor\s+\.cursor\/rules\/megasaver\.mdc\s+missing/.test(l))).toBe(true);
    expect(lines.some((l) => /^aider\s+CONVENTIONS\.md\s+missing/.test(l))).toBe(true);
  });

  it("reports aider in-sync after sync --target aider seeds the file", async () => {
    await seedProject("demo", projectRoot);
    // Run sync first to seed CONVENTIONS.md.
    await runConnectorSync({
      projectName: "demo",
      store,
      target: "aider",
      stdout: () => {},
      stderr: () => {},
    });
    // Now status should be in-sync.
    await runStatus({ projectName: "demo", target: "aider" });
    expect(process.exitCode).toBe(0);
    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines.some((l) => /^aider\s+CONVENTIONS\.md\s+in-sync/.test(l))).toBe(true);
  });
```

The `runConnectorSync` import at the top of `connector-status.test.ts` already exists (line 5: `import { connectorStatusCommand, runConnectorSync } from "../src/commands/connector.js";`). The test invokes `runConnectorSync` as a function directly (not via citty's `.run`); confirm the call shape matches what the existing `connector-status.test.ts` `in-sync` tests use for cursor (they will be the closest precedent — copy the exact arg shape).

If the existing precedent for in-sync setup uses `connectorSyncCommand.run?.(...)` instead, adapt accordingly:

```ts
    await connectorSyncCommand.run?.({
      args: { projectName: "demo", target: "aider", store },
      cmd: connectorSyncCommand,
      rawArgs: [],
      data: undefined,
    } as never);
```

- [ ] **Step 2: Run the status tests**

```bash
pnpm --filter @megasaver/cli exec vitest run connector-status.test
```

Expected: both new tests PASS. Existing status tests remain green. If the four-targets-missing test fails because the existing assertion-style reads exact line counts (e.g. `expect(lines.length).toBe(3)`), update those existing assertions to expect 4.

- [ ] **Step 3: Add the failing session test**

Open `apps/cli/test/session.test.ts`. Find an existing `session create --agent <id>` test (cursor or codex variants). Mirror its shape for aider. Add inside the appropriate describe:

```ts
  it("creates a session with --agent aider", async () => {
    // Reuse the existing test's fixture pattern: seed a project, run create, assert show output.
    // See the cursor variant immediately above this block for the exact helper invocation.
    const out: string[] = [];
    const err: string[] = [];

    // 1. Project create (or seedProject helper if the file uses one).
    await runProjectCreate({ name: "demo", store, stdout: (l) => out.push(l), stderr: (l) => err.push(l) });

    // 2. Session create --agent aider.
    out.length = 0;
    await runSessionCreate({
      projectName: "demo",
      agent: "aider",
      store,
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
    });
    expect(process.exitCode).toBe(0);
    const sessionId = out[0]?.trim();
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);

    // 3. Session show — assert agent: aider.
    out.length = 0;
    await runSessionShow({
      sessionId: sessionId as string,
      store,
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
    });
    expect(out.join("\n")).toMatch(/^agent\s+aider$/m);
  });
```

Adapt the helper names (`runProjectCreate`, `runSessionCreate`, `runSessionShow`) to whatever the existing session.test.ts uses — these may be in-test closures over `cmd.run?.(...)` calls or shared fixture helpers. The cursor `--agent cursor` test added in PR #17 is the **exact** precedent; copy its invocation shape line-for-line and substitute `cursor` → `aider`.

- [ ] **Step 4: Run the session test**

```bash
pnpm --filter @megasaver/cli exec vitest run session.test
```

Expected: the new test PASSES (the agentIdSchema widening from Task 1 plus the existing session create flow handle aider transparently).

- [ ] **Step 5: Commit**

```bash
git add apps/cli/test/connector-status.test.ts apps/cli/test/session.test.ts
git commit -m "test(cli): aider status + session coverage"
```

---

## Task 6: DoD gate — `pnpm verify` + smoke

**Files:** none modified. This is the green-bar gate.

- [ ] **Step 1: Run the full verify suite**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/aider-target
pnpm verify
```

Expected: ALL green. Lint clean (Biome), typecheck clean (`tsc -b --noEmit`), all tests pass.

If any test or lint failure surfaces:
- Lint: run `pnpm lint:fix` and re-stage; if a Biome rule still complains after autoformat, address it manually.
- Typecheck: confirm the alphabetic enum order is preserved in `agentIdSchema` and that no consumer of `AgentId` exhaustively switches on the union without an `aider` arm. Search: `grep -rn "agentId" packages apps --include="*.ts" | grep -v "test"`.
- Test: identify the failing assertion and align with reality (e.g. exact line counts in older tests that did not anticipate aider).

- [ ] **Step 2: Smoke evidence — `mega connector sync --target aider` end-to-end**

Build the CLI and run a manual smoke against a temp store + temp project root:

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/aider-target
pnpm --filter @megasaver/cli build

STORE=$(mktemp -d -t megasaver-smoke-store-XXXX)
ROOT=$(mktemp -d -t megasaver-smoke-root-XXXX)
cd "$ROOT"
node /Users/halitozger/Desktop/MegaSaver/.worktrees/aider-target/apps/cli/dist/cli.js project create demo --store "$STORE"
node /Users/halitozger/Desktop/MegaSaver/.worktrees/aider-target/apps/cli/dist/cli.js session create demo --agent aider --store "$STORE"
node /Users/halitozger/Desktop/MegaSaver/.worktrees/aider-target/apps/cli/dist/cli.js connector sync demo --target aider --store "$STORE"
cat CONVENTIONS.md
node /Users/halitozger/Desktop/MegaSaver/.worktrees/aider-target/apps/cli/dist/cli.js connector status demo --store "$STORE"
```

Expected output:
- `connector sync demo --target aider` line: `aider        CONVENTIONS.md  created`
- `cat CONVENTIONS.md` shows the rendered block (no frontmatter, sentinels present, `Agent: aider`, `Session: <id>`).
- `connector status demo` shows `aider        CONVENTIONS.md  in-sync   session=<id>`.

Capture the relevant output lines for the PR description.

- [ ] **Step 3: Push the branch and open the PR**

```bash
git push -u origin feat/aider-target
gh pr create --title "feat(connector): aider target (CONVENTIONS.md)" --body "$(cat <<'EOF'
## Summary
- Adds 4th built-in connector target: `aider` → `CONVENTIONS.md`.
- Closes the v0.1 connector matrix (claude-code + codex + cursor + aider).
- Mirrors the cursor pattern with the `header` field absent (plain markdown).

## Test plan
- [x] `pnpm verify` green
- [x] Manual smoke: `mega connector sync demo --target aider` against an empty project root → `created`, then `connector status demo` → `in-sync`
- [x] Manual smoke: pre-existing `CONVENTIONS.md` with team content → block appended, user content preserved

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

The reviewer agents (`code-reviewer` then `critic` for HIGH-risk pattern alignment) run after PR creation, separately from the implementer's session.

---

## Self-Review Notes

- **Spec coverage:** §3.1 (Task 1), §3.2 (Task 2), §3.3 (Task 3), §4 (Task 5 status), §5 (Task 4 first-seed), §6 (Tasks 1-5 each ship their slice of the test plan), §9 (Task 4 second test exercises the migration / pre-existing content scenario). All sections covered.
- **Placeholder scan:** Test code and production code blocks are complete. The session.test.ts helper names (`runProjectCreate`, etc.) are explicitly flagged as "adapt to local naming" because the precedent file uses ad-hoc closures across multiple tests, but the cursor PR #17 precedent is named as the exact line-for-line template. This is intentional flexibility, not a placeholder.
- **Type consistency:** `aiderTarget`, `KNOWN_TARGET_IDS`, `KNOWN_TARGETS`, `agentIdSchema` member spelling — all `"aider"` (lowercase, no hyphen). `relativePath` is `"CONVENTIONS.md"` consistently. Order in `agentIdSchema` is alphabetic-first; order in `KNOWN_TARGET_IDS` and `KNOWN_TARGETS` is launch-order-appended (cursor → aider). This asymmetry is documented in the spec §3.1 vs §3.3 and is intentional (alphabetical for closed-enum drift-guard discipline; launch order for human-facing CLI output).
