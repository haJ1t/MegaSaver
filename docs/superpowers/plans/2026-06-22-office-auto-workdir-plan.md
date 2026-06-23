# Auto Agent Workdir Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove manual agent-`workdir` selection; derive it from the project directory automatically (CLI invocation cwd / GUI selected-workspace path), and enforce the invariant at the bridge.

**Architecture:** `workdir` is no longer user input. The CLI sets `workdir = input.cwd`. The GUI `AgentOfficeView` forwards the selected workspace's `label` (= its cwd path) to `AgentBoard`, which sends it as `workdir`. The bridge `handleCreateAgent` asserts `encodeWorkspaceKey(workdir) === wk` and 400s on mismatch. `agentSchema`/`agentCreateInputSchema` keep `workdir` required (no schema change); `CreateAgentInput.workdir` stays optional (thin transport wrapper).

**Tech Stack:** TypeScript strict ESM, Vitest, Citty (CLI), React (GUI), Node http bridge.

---

### Task 1: CLI — derive workdir from cwd, drop `--workdir`

**Files:**
- Modify: `apps/cli/src/commands/office/agent.ts`
- Test: `apps/cli/test/commands/office/agent.test.ts`, `apps/cli/test/commands/office/run.test.ts`

- [ ] **Step 1: Update the failing test** — in `agent.test.ts`, delete every `workdirFlag: "/repo",` line from the `runOfficeAgentCreate(...)` calls, and in the happy-path test assert the stored workdir equals cwd:

```ts
it("happy path — creates agent in cwd, prints id", async () => {
  await createRole(tmpDir);
  const inp = makeBaseInput(tmpDir);
  const code = await runOfficeAgentCreate({
    ...inp,
    nameFlag: "Archie",
    roleIdFlag: ROLE_ID,
    newId: () => AGENT_ID,
    now: () => NOW,
    json: true,
  });
  expect(code).toBe(0);
  const parsed = JSON.parse(inp.lines[0] ?? "{}") as { id: string; workdir: string };
  expect(parsed.id).toBe(AGENT_ID);
  expect(parsed.workdir).toBe(tmpDir);
});
```

  Also delete the four `workdirFlag: "/repo",` lines in `run.test.ts`.

- [ ] **Step 2: Run tests, verify they fail to compile** — `workdirFlag` no longer accepted once the type is changed; first run still references it. Run: `pnpm --filter @megasaver/cli test -- agent` Expected: type/assertion failure.

- [ ] **Step 3: Implement** — in `agent.ts`:
  - Remove `workdirFlag: string;` from `RunOfficeAgentCreateInput`.
  - Change `workdir: input.workdirFlag,` to `workdir: input.cwd,`.
  - Remove the `workdir: { type: "string", required: true, ... }` entry from `officeAgentCreateCommand.args`.
  - Remove `workdirFlag: typeof args.workdir === "string" ? args.workdir : "",` from the `run()` wiring.

- [ ] **Step 4: Run tests** — Run: `pnpm --filter @megasaver/cli test -- agent` Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(cli): office agent workdir defaults to cwd"`

### Task 2: Bridge — assert workdir matches the workspace

**Files:**
- Modify: `apps/gui/bridge/routes/office.ts`
- Test: `apps/gui/test/bridge/office/routes.test.ts`

- [ ] **Step 1: Update the failing test** — in `routes.test.ts`:
  - Add a runtime import: change `import type { AgentId } from "@megasaver/shared";` to `import { type AgentId, encodeWorkspaceKey } from "@megasaver/shared";`.
  - Replace `const WK = "0000000000000001";` with:

```ts
const WORKDIR = "/tmp/office-workdir";
const WK = encodeWorkspaceKey(WORKDIR);
```

  - Replace the agent-create body workdirs `workdir: "/tmp/workdir"` (happy), `workdir: "/tmp"` (delete test), and the two `workdir: storeRoot` (run/full tests) with `workdir: WORKDIR`. Leave the invalid-body test (`{ name: "X", workdir: "/tmp" }`, missing roleId) as-is — it 400s on schema before the guard.
  - Add a guard test in the agent CRUD describe:

```ts
it("create agent rejects a workdir that does not match the workspace → 400", async () => {
  const roleCtx = makeCtx({ req: makeBodyReq(ROLE_BODY), newId: () => UUID_A });
  await handleCreateRole(roleCtx);
  const roleId = (roleCtx.capturedJson[0]?.body as RoleBody).id;

  const agentCtx = makeCtx({
    req: makeBodyReq({ name: "Mismatch", roleId, workdir: "/somewhere/else" }),
    newId: () => UUID_B,
  });
  await handleCreateAgent(agentCtx, WK);
  expect(agentCtx.capturedError[0]?.status).toBe(400);
  expect(agentCtx.capturedError[0]?.code).toBe("validation_failed");
});
```

- [ ] **Step 2: Run tests, verify guard test fails** — Run: `pnpm --filter @megasaver/gui test -- office/routes` Expected: the new guard test FAILS (currently 201, not 400).

- [ ] **Step 3: Implement** — in `office.ts`, ensure `encodeWorkspaceKey` is imported from `@megasaver/shared`, and in `handleCreateAgent` after the successful `agentCreateInputSchema` parse, before `loadRole`:

```ts
if (encodeWorkspaceKey(parsed.data.workdir) !== wk) {
  ctx.sendError(
    ctx.res,
    400,
    "validation_failed",
    "workdir must match the workspace directory.",
    ctx.origin,
  );
  return;
}
```

- [ ] **Step 4: Run tests** — Run: `pnpm --filter @megasaver/gui test -- office/routes` Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(gui): bridge enforces office agent workdir matches workspace"`

### Task 3: GUI — remove workdir input, forward workspace path

**Files:**
- Modify: `apps/gui/src/views/office/agent-board.tsx`, `apps/gui/src/views/agent-office-view.tsx`
- Test: `apps/gui/test/components/office/agent-board.test.tsx`, `apps/gui/test/components/office/agent-office-view.test.tsx`

- [ ] **Step 1: Update the failing tests** —
  - `agent-board.test.tsx`: add `workdir="/home/user/project"` to every `<AgentBoard ... />` render (9 of them). In "add-agent form posts to createAgent", change the final assertion to:

```ts
expect(capturedInput).toMatchObject({ name: "new-agent", workdir: "/home/user/project" });
```

  - `agent-office-view.test.tsx`: add a new test asserting the view forwards the selected workspace `label` as `workdir`:

```ts
it("add-agent through the view sends workdir = selected workspace label", async () => {
  stub.fetchWorkspaces = () => Promise.resolve([WS_1]); // label "my-project"
  stub.fetchRoles = () => Promise.resolve([
    { id: "r1", name: "coder", kind: "claude-code", permissionMode: "plan", allowedTools: [], createdAt: "2026-06-22T00:00:00Z" },
  ]);
  let captured: unknown;
  stub.createAgent = (_wk, input) => {
    captured = input;
    return Promise.resolve(AGENT_WK1);
  };
  render(<AgentOfficeView />);
  await waitFor(() => expect(screen.getByText(/No agents yet/)).toBeDefined());
  fireEvent.click(screen.getByText(/\+ Add agent/));
  await waitFor(() => expect(screen.getByLabelText(/Add agent form/)).toBeDefined());
  fireEvent.change(screen.getByLabelText(/Name \*/), { target: { value: "x" } });
  fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));
  await waitFor(() => expect(captured).toMatchObject({ name: "x", workdir: "my-project" }));
});
```

  (WS_1 auto-selects since it is the only workspace; the board renders empty-state.)

- [ ] **Step 2: Run tests, verify failures** — Run: `pnpm --filter @megasaver/gui test -- office/agent-board office/agent-office-view` Expected: type error on missing `workdir` prop + new view test FAILS.

- [ ] **Step 3: Implement** —
  - `agent-board.tsx`: add `workdir: string;` to `AgentBoardProps`; accept it in the signature. Remove the `addWorkdir`/`setAddWorkdir` state, the `if (addWorkdir.trim()) input.workdir = addWorkdir.trim();` line (replace with `workdir` in the literal), the `setAddWorkdir("")` reset, and the entire "Workdir (optional)" `<div>…<input id="agent-workdir" …/></div>` block. The create payload becomes:

```tsx
const input: CreateAgentInput = { name: addName.trim(), roleId: addRoleId, workdir };
```

  - `agent-office-view.tsx`: compute the selected workspace's label and pass it down. Where `<AgentBoard wk={selectedWk} ... />` renders, add `workdir={workspaces.find((w) => w.key === selectedWk)?.label ?? ""}`.

- [ ] **Step 4: Run tests** — Run: `pnpm --filter @megasaver/gui test -- office` Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(gui): office add-agent uses workspace dir, drops workdir field"`

### Task 4: Verify + changeset + docs

- [ ] **Step 1:** `pnpm verify` from worktree root → green (lint + typecheck + all tests + conventions:check).
- [ ] **Step 2:** Add `.changeset/office-auto-workdir.md` (`@megasaver/cli` minor, `@megasaver/gui` patch).
- [ ] **Step 3:** CLI smoke: `node apps/cli/dist/cli.js office agent create --help` shows no `--workdir`; create an agent in a temp store and confirm `workdir` = cwd via `office agent list`.
- [ ] **Step 4:** Update `wiki/entities/agent-office.md` + append `wiki/log.md`.
- [ ] **Step 5:** Code review: `code-reviewer` + `critic` (fresh context). Address findings.

## Self-Review

- **Spec coverage:** CLI cwd-derive (Task 1) ✓; bridge guard (Task 2) ✓; GUI remove input + forward path (Task 3) ✓; out-of-scope role.defaultWorkdir untouched ✓.
- **Placeholder scan:** none.
- **Type consistency:** `workdir` prop is `string` on `AgentBoardProps`; `CreateAgentInput.workdir` stays optional; `encodeWorkspaceKey` returns branded `WorkspaceKey` assignable to the `wk: string` params.
