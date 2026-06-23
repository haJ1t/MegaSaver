import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentLauncher, LaunchHandle, LauncherEvent } from "@megasaver/connectors-shared";
import { createInMemoryCoreRegistry } from "@megasaver/core";
import {
  officeAgentIdSchema,
  officeTaskIdSchema,
  projectIdSchema,
  roleIdSchema,
  workspaceKeySchema,
} from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveAgent } from "../src/agent-store.js";
import { createLauncherRegistry } from "../src/launcher-registry.js";
import { saveRole } from "../src/role-store.js";
import { createSupervisor } from "../src/supervisor.js";
import { loadTask, saveTask } from "../src/task-store.js";
import type { TranscriptEntry } from "../src/transcript.js";

const WK = workspaceKeySchema.parse("0123456789abcdef");
const PROJECT_ID = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");
const ROLE_ID = roleIdSchema.parse("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const AGENT_ID = officeAgentIdSchema.parse("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
const TASK_ID = officeTaskIdSchema.parse("cccccccc-cccc-4ccc-8ccc-cccccccccccc");

// Fake launcher that emits two stream events synchronously when onEvent is
// subscribed, then exits 0 — exercises the supervisor's transcript capture.
function makeEmittingLauncher(): AgentLauncher {
  const events: LauncherEvent[] = [
    {
      kind: "stream",
      payload: {
        type: "assistant",
        message: { content: [{ type: "text", text: "Working on it" }] },
      },
    },
    {
      kind: "stream",
      payload: {
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Bash", input: { command: "pnpm test" } }] },
      },
    },
  ];
  return {
    kind: "claude-code",
    launch(): LaunchHandle {
      return {
        sessionId: `fake-${randomUUID()}`,
        onEvent(cb) {
          for (const e of events) cb(e);
        },
        onExit(cb) {
          cb({ code: 0 });
        },
        cancel() {},
      };
    },
  };
}

async function seed(storeRoot: string): Promise<void> {
  await saveRole({
    storeRoot,
    role: {
      id: ROLE_ID,
      name: "Coder",
      kind: "claude-code",
      persona: "p",
      model: "sonnet",
      allowedTools: [],
      skillPacks: [],
      permissionMode: "plan",
      createdAt: "2026-06-23T12:00:00.000Z",
    },
  });
  await saveAgent({
    storeRoot,
    agent: {
      id: AGENT_ID,
      name: "Archie",
      roleId: ROLE_ID,
      kind: "claude-code",
      workspaceKey: WK,
      workdir: "/repo",
      status: "idle",
      createdAt: "2026-06-23T12:00:00.000Z",
    },
  });
  await saveTask({
    storeRoot,
    task: {
      id: TASK_ID,
      agentId: AGENT_ID,
      workspaceKey: WK,
      instruction: "Do work.",
      status: "queued",
      queuedAt: "2026-06-23T12:00:00.000Z",
    },
  });
}

function makeSupervisor(
  storeRoot: string,
  onTranscript: Parameters<typeof createSupervisor>[0]["onTranscript"],
) {
  let n = 0;
  const coreRegistry = createInMemoryCoreRegistry();
  coreRegistry.createProject({
    id: PROJECT_ID,
    name: "Test Project",
    rootPath: "/repo",
    createdAt: "2026-06-23T12:00:00.000Z",
    updatedAt: "2026-06-23T12:00:00.000Z",
  });
  return createSupervisor({
    storeRoot,
    registry: createLauncherRegistry([makeEmittingLauncher()]),
    coreRegistry,
    projectId: PROJECT_ID,
    now: () => "2026-06-23T13:00:00.000Z",
    newId: () => `00000000-0000-4000-8000-${String(n++).padStart(12, "0")}`,
    onTranscript,
  });
}

describe("supervisor transcript capture", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "supervisor-tr-"));
  });
  afterEach(() => {
    // best-effort; tmp
  });

  it("captures projected entries via onTranscript with monotonic seq", async () => {
    await seed(root);
    const seen: { officeAgentId: string; entry: TranscriptEntry }[] = [];
    const supervisor = makeSupervisor(root, (x) => seen.push(x));
    await supervisor.drainAgent(WK, AGENT_ID);

    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen[0]?.entry.role).toBe("assistant");
    expect(seen[0]?.entry.text).toBe("Working on it");
    expect(seen[1]?.entry).toMatchObject({ role: "tool", tool: "Bash", summary: "pnpm test" });
    expect(seen.map((s) => s.entry.seq)).toEqual(seen.map((_, i) => i));
    expect(seen.every((s) => s.officeAgentId === AGENT_ID)).toBe(true);
  });

  it("a throwing onTranscript does not fail the task", async () => {
    await seed(root);
    const supervisor = makeSupervisor(root, () => {
      throw new Error("sink boom");
    });
    await supervisor.drainAgent(WK, AGENT_ID);
    const task = await loadTask({
      storeRoot: root,
      workspaceKey: WK,
      officeAgentId: AGENT_ID,
      officeTaskId: TASK_ID,
    });
    expect(task.status).toBe("done");
  });

  it("drops a malformed stream event without failing the task", async () => {
    await seed(root);
    const seen: { entry: TranscriptEntry }[] = [];
    let n = 0;
    const coreRegistry = createInMemoryCoreRegistry();
    coreRegistry.createProject({
      id: PROJECT_ID,
      name: "P",
      rootPath: "/repo",
      createdAt: "2026-06-23T12:00:00.000Z",
      updatedAt: "2026-06-23T12:00:00.000Z",
    });
    // Launcher emits a malformed event (null content block) then a good one,
    // asynchronously (microtask) — mirrors production's async stdout callback.
    const malformedLauncher: AgentLauncher = {
      kind: "claude-code",
      launch(): LaunchHandle {
        return {
          sessionId: `fake-${randomUUID()}`,
          onEvent(cb) {
            Promise.resolve().then(() => {
              cb({ kind: "stream", payload: { type: "assistant", message: { content: [null] } } });
              cb({
                kind: "stream",
                payload: {
                  type: "assistant",
                  message: { content: [{ type: "text", text: "ok" }] },
                },
              });
            });
          },
          onExit(cb) {
            // exit after the emitted events settle
            Promise.resolve()
              .then(() => undefined)
              .then(() => cb({ code: 0 }));
          },
          cancel() {},
        };
      },
    };
    const supervisor = createSupervisor({
      storeRoot: root,
      registry: createLauncherRegistry([malformedLauncher]),
      coreRegistry,
      projectId: PROJECT_ID,
      now: () => "2026-06-23T13:00:00.000Z",
      newId: () => `00000000-0000-4000-8000-${String(n++).padStart(12, "0")}`,
      onTranscript: (x) => seen.push(x),
    });
    await supervisor.drainAgent(WK, AGENT_ID);
    const task = await loadTask({
      storeRoot: root,
      workspaceKey: WK,
      officeAgentId: AGENT_ID,
      officeTaskId: TASK_ID,
    });
    expect(task.status).toBe("done");
    // The malformed event is skipped; the good one is captured.
    expect(seen.map((s) => s.entry.text)).toEqual(["ok"]);
  });
});
