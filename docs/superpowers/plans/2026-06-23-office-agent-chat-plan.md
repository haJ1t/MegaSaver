# Agent Office Chat (Phase B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A message box in the agent transcript panel: type → agent runs against the message (resuming its session) → reply streams into the same feed; the message shows as a `user` turn.

**Architecture:** Reuse Phase A (transcript capture + SSE) + existing assign/run. New: a `user` transcript role, a `POST .../chat` endpoint that appends a user turn + queues a task + starts the drain (via a `startAgentDrain` helper factored out of `handleRunAgent`), and a GUI input. Continuity is the supervisor's existing `--resume`.

**Tech Stack:** TypeScript strict ESM, zod, Vitest, Node http + SSE, React.

---

### Task 1: `user` transcript role

**Files:**
- Modify: `packages/agent-office/src/transcript.ts`
- Test: `packages/agent-office/test/transcript.test.ts`

- [ ] **Step 1: failing test** — append to `transcript.test.ts`:
```ts
it("accepts a user-role entry", () => {
  expect(() =>
    transcriptEntrySchema.parse({ id: "00000000-0000-4000-8000-000000000000", seq: 0, ts: "2026-06-23T12:00:00.000Z", role: "user", text: "hello agent" }),
  ).not.toThrow();
});
```
- [ ] **Step 2: verify fail** — `pnpm --filter @megasaver/agent-office test -- transcript` → FAIL (`role:"user"` rejected by enum).
- [ ] **Step 3: implement** — add `"user"` to `transcriptRoleSchema`:
```ts
export const transcriptRoleSchema = z.enum([
  "user",
  "assistant",
  "tool",
  "tool_result",
  "result",
  "stderr",
]);
```
- [ ] **Step 4: verify pass.** Rebuild agent-office so the bridge sees it: `pnpm --filter @megasaver/agent-office build`.
- [ ] **Step 5: commit** — `git commit -m "feat(agent-office): add user transcript role"`

### Task 2: bridge — chat endpoint + startAgentDrain extraction

**Files:**
- Modify: `apps/gui/bridge/office-validation.ts`, `apps/gui/bridge/routes/office.ts`, `apps/gui/bridge/handler.ts`
- Test: `apps/gui/test/bridge/office/chat-route.test.ts`

- [ ] **Step 1: validation schema** — append to `office-validation.ts`:
```ts
export const chatInputSchema = z.object({ message: z.string().min(1) }).strict();
```

- [ ] **Step 2: failing tests** — `chat-route.test.ts` (mirror `routes.test.ts` harness: `makeCtx`, `makeBodyReq`, `WORKDIR`/`WK = encodeWorkspaceKey(WORKDIR)`, fake launcher, role+agent setup):
```ts
it("chat → 202, appends a user transcript entry + queues a task", async () => {
  // create role + agent (workdir = WORKDIR) as in routes.test.ts
  const ctx = makeCtx({ req: makeBodyReq({ message: "hello agent" }), newId: seqIds() });
  await handleChat(ctx, WK, agentId);
  expect(ctx.capturedJson[0]?.status).toBe(202);
  const tr = await listTranscript({ storeRoot, workspaceKey: WK, officeAgentId: agentId });
  expect(tr.some((e) => e.role === "user" && e.text === "hello agent")).toBe(true);
  const tasks = await listTasks({ storeRoot, workspaceKey: WK, officeAgentId: agentId });
  expect(tasks.some((t) => t.instruction === "hello agent" && t.status === "queued")).toBe(true);
});
it("empty message → 400", async () => {
  const ctx = makeCtx({ req: makeBodyReq({ message: "" }) });
  await handleChat(ctx, WK, agentId);
  expect(ctx.capturedError[0]?.status).toBe(400);
});
it("unknown agent → 404", async () => {
  const ctx = makeCtx({ req: makeBodyReq({ message: "hi" }) });
  await handleChat(ctx, WK, "99999999-9999-4999-8999-999999999999");
  expect(ctx.capturedError[0]?.status).toBe(404);
});
```
Import `handleChat` + `listTranscript`, `listTasks`.

- [ ] **Step 3: verify fail.**

- [ ] **Step 4: implement** — in `office.ts`:
  - import `chatInputSchema`; import `transcriptEntrySchema` + `listTasks`-style deps already present; add `appendTranscript` (already imported).
  - Extract from `handleRunAgent` the supervisor-build + fire-and-forget drain into:
```ts
function startAgentDrain(ctx: RouteContext, wk: string, officeAgentId: OfficeAgentId): void {
  const office = ctx.office as NonNullable<typeof ctx.office>;
  const supervisor = createSupervisor({
    storeRoot: ctx.storeRoot,
    registry: office.registry,
    coreRegistry: office.coreRegistry,
    projectId: OFFICE_PROJECT_ID,
    now: ctx.now,
    newId: ctx.newId,
    allowFull: office.allowFull,
    onTranscript: ({ workspaceKey, officeAgentId: aid, entry }) => {
      void appendTranscript({ storeRoot: ctx.storeRoot, workspaceKey, officeAgentId: aid, entry }).catch((err) =>
        console.error(`[office] transcript persist failed for ${workspaceKey}/${aid}:`, err),
      );
      publishTranscript(transcriptKey(workspaceKey, aid), entry);
    },
  });
  supervisor.drainAgent(wk, officeAgentId).catch((drainErr) => {
    console.error(`[office] drainAgent failed for ${wk}/${officeAgentId}:`, drainErr);
  });
}
```
  Rewrite `handleRunAgent`'s body after the working-guard to call `startAgentDrain(ctx, wk, idParse.data)` then `sendJson(202, agent)`.
  - Add `handleChat`:
```ts
export async function handleChat(ctx: RouteContext, wk: string, agentId: string): Promise<void> {
  if (!guardOffice(ctx)) return;
  if (validateWk(ctx, wk) === null) return;
  const idParse = officeAgentIdSchema.safeParse(agentId);
  if (!idParse.success) {
    ctx.sendError(ctx.res, 404, "office_not_found", `Agent not found: ${agentId}`, ctx.origin);
    return;
  }
  let body: unknown;
  try { body = await readJsonBody(ctx.req); } catch {
    ctx.sendError(ctx.res, 400, "validation_failed", "Invalid JSON body.", ctx.origin);
    return;
  }
  const parsed = chatInputSchema.safeParse(body);
  if (!parsed.success) {
    ctx.sendError(ctx.res, 400, "validation_failed", zodErrorMessage(parsed.error), ctx.origin, parsed.error.issues);
    return;
  }
  try {
    const agent = await loadAgent({ storeRoot: ctx.storeRoot, workspaceKey: wk, officeAgentId: idParse.data });
    const entry = transcriptEntrySchema.parse({ id: ctx.newId(), seq: 0, ts: ctx.now(), role: "user", text: parsed.data.message });
    await appendTranscript({ storeRoot: ctx.storeRoot, workspaceKey: wk, officeAgentId: idParse.data, entry });
    publishTranscript(transcriptKey(wk, idParse.data), entry);
    const task = officeTaskSchema.parse({ id: ctx.newId(), agentId: idParse.data, workspaceKey: wk, instruction: parsed.data.message, status: "queued", queuedAt: ctx.now() });
    await saveTask({ storeRoot: ctx.storeRoot, task });
    if (agent.status !== "working") startAgentDrain(ctx, wk, idParse.data);
    ctx.sendJson(ctx.res, 202, task, ctx.origin);
  } catch (err) { handleOfficeError(ctx, err); }
}
```
  - In `handler.ts`, add (before the `transcript` matches or near the run match) a chat route:
```ts
const officeChatMatch = path.match(/^\/api\/office\/([^/]+)\/agents\/([^/]+)\/chat$/);
if (officeChatMatch && req.method === "POST") {
  await handleChat(ctx, decodeURIComponent(officeChatMatch[1]!), decodeURIComponent(officeChatMatch[2]!));
  return;
}
```
  (match the existing run-route style + import `handleChat`.)

- [ ] **Step 5: verify pass** — `pnpm --filter @megasaver/gui test -- office/chat-route office/routes` → PASS (run-route tests still green after extraction).
- [ ] **Step 6: commit** — `git commit -m "feat(gui): bridge /chat endpoint — user turn + queued task + drain"`

### Task 3: GUI — sendChat client + message box

**Files:**
- Modify: `apps/gui/src/lib/office-client.ts`, `apps/gui/src/views/office/transcript-panel.tsx`
- Test: `apps/gui/test/components/office/transcript-panel.test.tsx`

- [ ] **Step 1: client** — in `office-client.ts` add:
```ts
export function sendChat(wk: string, agentId: string, message: string): Promise<OfficeTask> {
  return postJson<OfficeTask>(`/api/office/${encodeURIComponent(wk)}/agents/${encodeURIComponent(agentId)}/chat`, { message });
}
```

- [ ] **Step 2: failing tests** — extend `transcript-panel.test.tsx`: (a) typing in the message box + submit calls `sendChat(wk, agentId, "hi")` and clears the input; (b) a `user`-role SSE entry renders distinctly (right-aligned / labelled "You"). Stub `sendChat` on the mocked client.

- [ ] **Step 3: verify fail.**

- [ ] **Step 4: implement** —
  - `transcript-panel.tsx`: add `user` rendering in `TranscriptLine` (`role === "user"` → right-aligned bubble, label "You"). Add a controlled `<form>` with a `<textarea>` + Send button below the feed; on submit (non-empty, trimmed) call `sendChat(wk, agentId, msg)`, clear input, set a transient `sending` disable; Enter submits, Shift+Enter newline. Errors → small alert. (The user turn + reply arrive via the existing SSE; no optimistic insert.)
  - Import `sendChat`.

- [ ] **Step 5: verify pass** — `pnpm --filter @megasaver/gui test -- office` → PASS.
- [ ] **Step 6: commit** — `git commit -m "feat(gui): chat message box in transcript panel"`

### Task 4: verify + changeset + smoke + wiki + review

- [ ] `pnpm verify` from worktree root → green.
- [ ] `.changeset/office-agent-chat.md`: `@megasaver/agent-office` minor, `@megasaver/gui` minor.
- [ ] Smoke: rebuild + restart app; open an agent, send a message → confirm the user turn + streamed reply appear; send a 2nd message → confirm the agent remembers (resume). Screenshot.
- [ ] Update `wiki/entities/agent-office.md` ("Chat (Phase B)" section) + `wiki/log.md`.
- [ ] Code review: `code-reviewer` + `critic` (fresh context).

## Self-Review

- **Spec coverage:** `user` role (T1), `/chat` endpoint = user-turn + task + drain via `startAgentDrain` (T2), GUI box + user rendering (T3). Continuity reused (no change) ✓. Known-limitation queue race documented in spec, not a task (acceptable) ✓.
- **Placeholder scan:** engine/bridge code complete; GUI behaviors specified against named Phase A structures.
- **Type consistency:** `chatInputSchema {message}`; `handleChat(ctx,wk,agentId)`; `startAgentDrain(ctx,wk,OfficeAgentId)`; `sendChat(wk,agentId,message)→OfficeTask`; transcript `user` entry `{id,seq:0,ts,role:"user",text}` matches `transcriptEntrySchema`.
