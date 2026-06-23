# Agent Office Live Transcript (Phase A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Click an office agent in the GUI → a read-only, chat-like feed shows, live, what the agent is doing (assistant text, tool calls, results), accumulated across its task runs.

**Architecture:** The launcher already emits claude stream-json events via `handle.onEvent`; the supervisor currently drops them. Capture → project to a compact `TranscriptEntry` → persist per-agent (one JSON file per entry, mirroring the audit store) → push live to the GUI over SSE via an in-process bus. GUI renders a feed and opens the SSE on agent select.

**Tech Stack:** TypeScript strict ESM, zod, Vitest, Node http bridge + SSE, React.

---

### Task 1: shared id + transcript schema + projectEvent

**Files:**
- Modify: `packages/shared/src/ids.ts`
- Create: `packages/agent-office/src/transcript.ts`
- Test: `packages/agent-office/test/transcript.test.ts`

- [ ] **Step 1: add the branded id** — append to `packages/shared/src/ids.ts`:
```ts
export const officeTranscriptIdSchema = lowercaseUuid.brand<"OfficeTranscriptId">();
export type OfficeTranscriptId = z.infer<typeof officeTranscriptIdSchema>;
```
Rebuild shared so agent-office sees it: `pnpm --filter @megasaver/shared build`.

- [ ] **Step 2: write failing tests** — `packages/agent-office/test/transcript.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { projectEvent, transcriptEntrySchema } from "../src/transcript.js";

describe("projectEvent", () => {
  it("maps an assistant text block", () => {
    const e = projectEvent({ kind: "stream", payload: { type: "assistant", message: { content: [{ type: "text", text: "Hello" }] } } });
    expect(e).toEqual({ role: "assistant", text: "Hello" });
  });
  it("maps an Edit tool_use to a tool entry with basename", () => {
    const e = projectEvent({ kind: "stream", payload: { type: "assistant", message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: "/a/b/foo.ts" } }] } } });
    expect(e).toEqual({ role: "tool", tool: "Edit", summary: "foo.ts" });
  });
  it("maps a Bash tool_use to the truncated command", () => {
    const e = projectEvent({ kind: "stream", payload: { type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "pnpm test" } }] } } });
    expect(e).toEqual({ role: "tool", tool: "Bash", summary: "pnpm test" });
  });
  it("maps a tool_result (user) to a truncated summary", () => {
    const e = projectEvent({ kind: "stream", payload: { type: "user", message: { content: [{ type: "tool_result", content: "x".repeat(500) }] } } });
    expect(e?.role).toBe("tool_result");
    expect((e?.summary ?? "").length).toBeLessThanOrEqual(200);
  });
  it("maps a successful result", () => {
    expect(projectEvent({ kind: "stream", payload: { type: "result", is_error: false } })).toEqual({ role: "result", summary: "done" });
  });
  it("maps a failed result", () => {
    expect(projectEvent({ kind: "stream", payload: { type: "result", is_error: true } })).toEqual({ role: "result", summary: "failed" });
  });
  it("skips system events", () => {
    expect(projectEvent({ kind: "stream", payload: { type: "system", subtype: "init" } })).toBeNull();
  });
  it("maps non-empty stderr", () => {
    expect(projectEvent({ kind: "stderr", text: " boom\n" })).toEqual({ role: "stderr", summary: "boom" });
  });
  it("skips empty stderr", () => {
    expect(projectEvent({ kind: "stderr", text: "  \n" })).toBeNull();
  });
  it("returns first assistant block only when multiple (one entry per call is fine)", () => {
    const e = projectEvent({ kind: "stream", payload: { type: "assistant", message: { content: [{ type: "text", text: "hi" }, { type: "tool_use", name: "Read", input: { file_path: "x.ts" } }] } } });
    expect(e).toEqual({ role: "assistant", text: "hi" });
  });
});

describe("transcriptEntrySchema", () => {
  it("accepts a full entry", () => {
    expect(() => transcriptEntrySchema.parse({ id: "00000000-0000-4000-8000-000000000000", seq: 0, ts: "2026-06-23T12:00:00.000Z", role: "assistant", text: "hi" })).not.toThrow();
  });
});
```

- [ ] **Step 3: run, verify fail** — `pnpm --filter @megasaver/agent-office test -- transcript` → FAIL (module missing).

- [ ] **Step 4: implement** — `packages/agent-office/src/transcript.ts`:
```ts
import { officeTranscriptIdSchema } from "@megasaver/shared";
import { z } from "zod";
import type { LauncherEvent } from "@megasaver/connectors-shared";

export const transcriptRoleSchema = z.enum(["assistant", "tool", "tool_result", "result", "stderr"]);
export type TranscriptRole = z.infer<typeof transcriptRoleSchema>;

export const transcriptEntrySchema = z
  .object({
    id: officeTranscriptIdSchema,
    seq: z.number().int().nonnegative(),
    ts: z.string().datetime({ offset: true }),
    role: transcriptRoleSchema,
    text: z.string().optional(),
    tool: z.string().optional(),
    summary: z.string().optional(),
  })
  .strict();
export type TranscriptEntry = z.infer<typeof transcriptEntrySchema>;

// The projected shape before the supervisor stamps id/seq/ts.
export type TranscriptEntryInput = {
  role: TranscriptRole;
  text?: string;
  tool?: string;
  summary?: string;
};

const MAX = 200;
const truncate = (s: string, n = MAX): string => (s.length > n ? `${s.slice(0, n)}…` : s);
const basename = (p: string): string => p.split("/").pop() ?? p;

function toolSummary(name: string, input: unknown): string | undefined {
  const obj = (input ?? {}) as Record<string, unknown>;
  if ((name === "Edit" || name === "Write" || name === "Read") && typeof obj.file_path === "string") {
    return basename(obj.file_path);
  }
  if (name === "Bash" && typeof obj.command === "string") return truncate(obj.command, 80);
  return undefined;
}

function textOf(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const t = content.find((c): c is { type: string; text?: string; content?: unknown } => typeof c === "object" && c !== null);
    return undefined; // handled by caller per-block
  }
  return undefined;
}

export function projectEvent(event: LauncherEvent): TranscriptEntryInput | null {
  if (event.kind === "stderr") {
    const s = event.text.trim();
    return s.length > 0 ? { role: "stderr", summary: truncate(s) } : null;
  }
  const p = event.payload as { type?: string; is_error?: boolean; message?: { content?: unknown } };
  if (!p || typeof p.type !== "string") return null;

  if (p.type === "result") {
    return { role: "result", summary: p.is_error ? "failed" : "done" };
  }
  if (p.type === "assistant" && Array.isArray(p.message?.content)) {
    for (const b of p.message.content as Array<Record<string, unknown>>) {
      if (b.type === "text" && typeof b.text === "string") return { role: "assistant", text: b.text };
      if (b.type === "tool_use" && typeof b.name === "string") {
        const s = toolSummary(b.name, b.input);
        return s !== undefined ? { role: "tool", tool: b.name, summary: s } : { role: "tool", tool: b.name };
      }
    }
    return null;
  }
  if (p.type === "user" && Array.isArray(p.message?.content)) {
    for (const b of p.message.content as Array<Record<string, unknown>>) {
      if (b.type === "tool_result") {
        const c = b.content;
        const text = typeof c === "string" ? c : Array.isArray(c) ? (c.map((x) => (x as { text?: string }).text ?? "").join(" ")) : "";
        return { role: "tool_result", summary: truncate(text.trim()) };
      }
    }
    return null;
  }
  return null;
}
```
(Remove the unused `textOf` helper if Biome flags it.)

- [ ] **Step 5: run, verify pass** — `pnpm --filter @megasaver/agent-office test -- transcript` → PASS.

- [ ] **Step 6: commit** — `git commit -m "feat(agent-office): transcript schema + projectEvent"`

### Task 2: paths + transcript store

**Files:**
- Modify: `packages/agent-office/src/paths.ts`
- Create: `packages/agent-office/src/transcript-store.ts`
- Test: `packages/agent-office/test/transcript-store.test.ts`

- [ ] **Step 1: add path helpers** — append to `paths.ts`:
```ts
export function transcriptDir(storeRoot: string, workspaceKey: string, officeAgentId: string): string {
  assertSafeSegment(workspaceKey);
  assertSafeSegment(officeAgentId);
  return join(storeRoot, "office", workspaceKey, "transcript", officeAgentId);
}

export function transcriptPath(input: {
  storeRoot: string;
  workspaceKey: string;
  officeAgentId: string;
  transcriptId: string;
}): string {
  assertSafeSegment(input.transcriptId);
  return join(
    transcriptDir(input.storeRoot, input.workspaceKey, input.officeAgentId),
    `${input.transcriptId}.json`,
  );
}
```

- [ ] **Step 2: failing test** — `transcript-store.test.ts`:
```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendTranscript, listTranscript } from "../src/transcript-store.js";

const WK = "0000000000000abc";
const AID = "11111111-1111-4111-8111-111111111111";
const mk = (seq: number, role = "assistant") => ({ id: `2222222${seq}-1111-4111-8111-111111111111`.slice(0,8) + "-1111-4111-8111-111111111111", seq, ts: `2026-06-23T12:00:0${seq}.000Z`, role, text: "x" });

describe("transcript-store", () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "tr-store-")); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it("append then list returns entries ordered by ts,seq", async () => {
    await appendTranscript({ storeRoot: root, workspaceKey: WK, officeAgentId: AID, entry: mk(0) });
    await appendTranscript({ storeRoot: root, workspaceKey: WK, officeAgentId: AID, entry: mk(1) });
    const all = await listTranscript({ storeRoot: root, workspaceKey: WK, officeAgentId: AID });
    expect(all.map((e) => e.seq)).toEqual([0, 1]);
  });
  it("returns [] when none", async () => {
    expect(await listTranscript({ storeRoot: root, workspaceKey: WK, officeAgentId: AID })).toEqual([]);
  });
});
```
(Use real lowercase-UUID ids — adjust `mk` to mint valid uuids, e.g. `33333333-3333-4333-8333-33333333333${seq}`.)

- [ ] **Step 3: verify fail** — `pnpm --filter @megasaver/agent-office test -- transcript-store` → FAIL.

- [ ] **Step 4: implement** — `transcript-store.ts` (mirror `audit-store.ts`):
```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFile } from "./atomic-write.js";
import { AgentOfficeError } from "./errors.js";
import { transcriptDir, transcriptPath } from "./paths.js";
import { type TranscriptEntry, transcriptEntrySchema } from "./transcript.js";

function isErrno(e: unknown): e is NodeJS.ErrnoException { return e instanceof Error && "code" in e; }

function parse(path: string, raw: string): TranscriptEntry {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch (cause) {
    throw new AgentOfficeError("store_corrupt", `Corrupt transcript file: ${path}`, { cause });
  }
  try { return transcriptEntrySchema.parse(parsed); } catch (cause) {
    throw new AgentOfficeError("store_corrupt", `Corrupt transcript file: ${path}`, { cause });
  }
}

export async function appendTranscript(input: {
  storeRoot: string; workspaceKey: string; officeAgentId: string; entry: TranscriptEntry;
}): Promise<void> {
  let entry: TranscriptEntry;
  try { entry = transcriptEntrySchema.parse(input.entry); } catch (cause) {
    throw new AgentOfficeError("schema_invalid", "Transcript entry is invalid.", { cause });
  }
  const path = transcriptPath({ storeRoot: input.storeRoot, workspaceKey: input.workspaceKey, officeAgentId: input.officeAgentId, transcriptId: entry.id });
  atomicWriteFile(path, `${JSON.stringify(entry, null, 2)}\n`);
}

export async function listTranscript(input: {
  storeRoot: string; workspaceKey: string; officeAgentId: string;
}): Promise<readonly TranscriptEntry[]> {
  const dir = transcriptDir(input.storeRoot, input.workspaceKey, input.officeAgentId);
  let names: string[];
  try { names = readdirSync(dir); } catch (e) {
    if (isErrno(e) && e.code === "ENOENT") return [];
    throw e;
  }
  const out: TranscriptEntry[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const path = join(dir, name);
    out.push(parse(path, readFileSync(path, "utf8")));
  }
  out.sort((a, b) => a.ts.localeCompare(b.ts) || a.seq - b.seq);
  return out;
}
```

- [ ] **Step 5: verify pass + export** — add to `index.ts`:
```ts
export { transcriptEntrySchema, projectEvent, type TranscriptEntry, type TranscriptEntryInput } from "./transcript.js";
export { appendTranscript, listTranscript } from "./transcript-store.js";
```
Run `pnpm --filter @megasaver/agent-office test -- transcript-store` → PASS.

- [ ] **Step 6: commit** — `git commit -m "feat(agent-office): per-agent transcript store"`

### Task 3: supervisor onTranscript wiring

**Files:**
- Modify: `packages/agent-office/src/supervisor.ts`
- Test: `packages/agent-office/test/supervisor-transcript.test.ts`

- [ ] **Step 1: failing test** — assert that during a fake-launcher run that emits stream events, an injected `onTranscript` receives projected entries with monotonic `seq`, and that a throwing `onTranscript` does not fail the task. Use the existing fake-launcher pattern from `test/` (a launcher whose `onEvent` cb is invoked synchronously with sample stream payloads before `onExit`).
```ts
// sketch — mirror existing supervisor test harness for store/core/registry setup
it("captures projected transcript entries via onTranscript", async () => {
  const seen: { officeAgentId: string; entry: { seq: number; role: string } }[] = [];
  // launcher.onEvent immediately emits one assistant text event, then exits 0
  // supervisor created with onTranscript: (x) => seen.push(x)
  await supervisor.drainAgent(WK, AID);
  expect(seen.some((s) => s.entry.role === "assistant")).toBe(true);
  expect(seen.map((s) => s.entry.seq)).toEqual([...seen.map((_, i) => i)]); // 0..n monotonic
});
it("a throwing onTranscript does not fail the task", async () => {
  // onTranscript throws; task still reaches done
});
```

- [ ] **Step 2: verify fail** — option not yet on `createSupervisor` → type/assertion fail.

- [ ] **Step 3: implement** — in `createSupervisor` deps add `onTranscript?: (x: { workspaceKey: string; officeAgentId: string; entry: TranscriptEntry }) => void;`. Replace `handle.onEvent(() => {})` with:
```ts
let seq = 0;
handle.onEvent((event) => {
  const input = projectEvent(event);
  if (input === null) return;
  const entry: TranscriptEntry = transcriptEntrySchema.parse({
    id: newId(), seq: seq++, ts: now(), ...input,
  });
  try { onTranscript?.({ workspaceKey, officeAgentId, entry }); } catch { /* capture is best-effort */ }
});
```
Import `projectEvent`, `transcriptEntrySchema`, `type TranscriptEntry`.

- [ ] **Step 4: verify pass** — `pnpm --filter @megasaver/agent-office test -- supervisor` → PASS (existing supervisor tests still green).

- [ ] **Step 5: commit** — `git commit -m "feat(agent-office): supervisor captures transcript via onTranscript sink"`

### Task 4: bridge — transcript bus + backlog route + SSE

**Files:**
- Create: `apps/gui/bridge/office-transcript-bus.ts`
- Modify: `apps/gui/bridge/routes/office.ts`, `apps/gui/bridge/handler.ts` (route dispatch)
- Test: `apps/gui/test/bridge/office/transcript-route.test.ts`

- [ ] **Step 1: bus** — `office-transcript-bus.ts`: module-level `Map<string, Set<(e: TranscriptEntry) => void>>` keyed by `${wk}:${agentId}`; `subscribe(key, cb): () => void` and `publish(key, entry)`. (Mirror any existing emitter; otherwise a plain Map.)

- [ ] **Step 2: failing tests** — in `transcript-route.test.ts`: (a) `handleListTranscript(ctx, wk, agentId)` returns stored entries (seed via `appendTranscript`); (b) bad agentId → 404; (c) bad wk → 400; (d) `handleTranscriptStream` writes an SSE `transcript` frame when `publish` is called for that key. Mirror `routes.test.ts` ctx/makeBodyReq harness.

- [ ] **Step 3: verify fail.**

- [ ] **Step 4: implement** — in `routes/office.ts`:
  - `handleListTranscript(ctx, wk, agentId)`: `guardOffice` + `validateWk` + `officeAgentIdSchema` parse (404 on bad id) → `listTranscript({ storeRoot: ctx.storeRoot, workspaceKey: wk, officeAgentId })` → 200 JSON.
  - `handleTranscriptStream(ctx, wk, agentId)`: validate; set SSE headers (reuse the helper `handleOfficeStream` uses); `const off = subscribe(`${wk}:${agentId}`, (e) => writeSse("transcript", e))`; on `req.close` → `off()`. Register before any await, mirror the audit stream lifecycle.
  - Wire `onTranscript` where the run handler builds the supervisor (`handleRunAgent`): pass `onTranscript: ({ workspaceKey, officeAgentId, entry }) => { void appendTranscript({ storeRoot: ctx.storeRoot, workspaceKey, officeAgentId, entry }); publish(`${workspaceKey}:${officeAgentId}`, entry); }`.
  - Add `transcript` GET + `transcript/stream` to the office route dispatch (`handler.ts`), matching `/api/office/:wk/agents/:id/transcript(/stream)?`.

- [ ] **Step 5: verify pass** — `pnpm --filter @megasaver/gui test -- office/transcript-route` and `office/routes` → PASS.

- [ ] **Step 6: commit** — `git commit -m "feat(gui): bridge transcript backlog route + live SSE"`

### Task 5: GUI — client + panel + click-to-open

**Files:**
- Modify: `apps/gui/src/lib/office-client.ts`, `apps/gui/src/views/office/agent-board.tsx`
- Create: `apps/gui/src/views/office/transcript-panel.tsx`
- Test: `apps/gui/test/components/office/transcript-panel.test.tsx`, extend `agent-board.test.tsx`

- [ ] **Step 1: client** — in `office-client.ts` add `TranscriptEntry` type (mirror engine: id, seq, ts, role, text?, tool?, summary?), `fetchTranscript(wk, agentId)` (GET), and `openTranscriptStream(wk, agentId, { onEntry, onError }): () => void` (EventSource on `/api/office/:wk/agents/:id/transcript/stream`, `addEventListener("transcript", …)`, returns a disposer) — mirror `openOfficeStream`.

- [ ] **Step 2: failing tests** — `transcript-panel.test.tsx`: (a) renders backlog entries (assistant text, a `tool` line shows `Edit foo.ts`); (b) an SSE `onEntry` appends a new line. Stub fetch + a fake `openTranscriptStream` capturing `onEntry`. In `agent-board.test.tsx`: clicking an agent card renders the panel for that agent (assert the panel calls `fetchTranscript` with the agent id).

- [ ] **Step 3: verify fail.**

- [ ] **Step 4: implement** — `transcript-panel.tsx`: props `{ wk: string; agentId: string }`; on mount `fetchTranscript` → state; `openTranscriptStream` → append on `onEntry`; dispose on unmount/agent change. Render a scrollable column: assistant entries as text bubbles, `tool` as `▸ {tool} {summary}`, `tool_result`/`stderr` muted, `result` as a status line; auto-scroll to bottom. In `agent-board.tsx`: add `selectedAgentId` state; clicking a card toggles it; render `<TranscriptPanel wk={wk} agentId={selectedAgentId} />` when set (with a close control). Keep existing card controls working (click target for select must not swallow the Run/Stop/Assign buttons — select on the card header area).

- [ ] **Step 5: verify pass** — `pnpm --filter @megasaver/gui test -- office` → PASS.

- [ ] **Step 6: commit** — `git commit -m "feat(gui): agent transcript panel + click-to-open feed"`

### Task 6: verify + changeset + smoke + wiki + review

- [ ] `pnpm verify` from worktree root → green.
- [ ] `.changeset/office-agent-transcript.md`: `@megasaver/agent-office` minor, `@megasaver/shared` minor (new id), `@megasaver/gui` minor.
- [ ] Smoke: rebuild + run the GUI; assign+run an agent (auth already set up); click it → confirm the feed streams assistant/tool lines live; capture a screenshot.
- [ ] Update `wiki/entities/agent-office.md` (new "Live transcript (Phase A)" section) + append `wiki/log.md`. Note Phase B (chat input) as the next phase.
- [ ] Code review: `code-reviewer` + `critic` (fresh context). Address findings.

## Self-Review

- **Spec coverage:** projectEvent + schema (T1), store (T2), supervisor capture (T3), bridge backlog+SSE (T4), GUI panel+click (T5) — all spec sections mapped. Per-agent persistence (history across tasks) ✓ via per-agent dir. Privacy via compaction/truncation in projectEvent ✓.
- **Placeholder scan:** engine code (T1–T3) is complete; bridge/GUI (T4–T5) give concrete signatures + behavior to mirror named existing patterns (audit store/stream, openOfficeStream). Acceptable since author executes inline with repo access.
- **Type consistency:** `TranscriptEntry` {id,seq,ts,role,text?,tool?,summary?} used identically across store, supervisor, bridge, client. `projectEvent` returns `TranscriptEntryInput` (no id/seq/ts); supervisor stamps those. `officeTranscriptId` branded in shared.
