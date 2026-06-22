import type { LaunchHandle } from "@megasaver/connectors-shared";
import type { CoreRegistry } from "@megasaver/core";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { listAgents, loadAgent, saveAgent } from "./agent-store.js";
import type { OfficeAgent } from "./agent.js";
import { appendAudit } from "./audit-store.js";
import type { AuditEvent } from "./audit.js";
import type { LauncherRegistry } from "./launcher-registry.js";
import { resolveLauncherPermission } from "./permission.js";
import { loadRole } from "./role-store.js";
import { listTasks, saveTask } from "./task-store.js";
import type { OfficeTask } from "./task.js";

const DEFAULT_TASK_TIMEOUT_MS = 30 * 60 * 1000;

// Await the handle's exit, escalating to SIGKILL if it never exits within the
// timeout. clearTimeout on a normal exit is required so the process is not kept
// alive by a pending 30-minute timer.
function awaitExit(handle: LaunchHandle, timeoutMs: number): Promise<{ code: number | null }> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      handle.cancel("SIGKILL");
      resolve({ code: null });
    }, timeoutMs);
    handle.onExit(({ code }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code });
    });
  });
}

export interface Supervisor {
  processNextTask(workspaceKey: string, officeAgentId: string): Promise<OfficeTask | null>;
  drainAgent(workspaceKey: string, officeAgentId: string): Promise<OfficeTask[]>;
  runWorkspace(workspaceKey: string, opts?: { maxConcurrent?: number }): Promise<void>;
}

export function createSupervisor(deps: {
  storeRoot: string;
  registry: LauncherRegistry;
  coreRegistry: CoreRegistry;
  projectId: ProjectId;
  now: () => string;
  newId: () => string;
  allowFull?: boolean;
  taskTimeoutMs?: number;
}): Supervisor {
  const {
    storeRoot,
    registry,
    coreRegistry,
    projectId,
    now,
    newId,
    allowFull = false,
    taskTimeoutMs = DEFAULT_TASK_TIMEOUT_MS,
  } = deps;

  async function processNextTask(
    workspaceKey: string,
    officeAgentId: string,
  ): Promise<OfficeTask | null> {
    // Step 1: Load agent; skip non-runnable statuses
    const agent = await loadAgent({ storeRoot, workspaceKey, officeAgentId });
    if (agent.status === "error" || agent.status === "stopped" || agent.status === "paused") {
      return null;
    }

    // Step 2: Pick earliest queued task
    const tasks = await listTasks({ storeRoot, workspaceKey, officeAgentId });
    const queued = tasks
      .filter((t) => t.status === "queued")
      .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
    const task = queued[0];
    if (task === undefined) return null;

    // Step 3: Load role + resolve permission (before session creation)
    const role = await loadRole({ storeRoot, roleId: agent.roleId });
    let permissionMode: ReturnType<typeof resolveLauncherPermission>;
    try {
      permissionMode = resolveLauncherPermission(role.permissionMode, { allowFull });
    } catch (err) {
      // Permission denied: fail task, set agent error, NO audit row (no session spawned)
      const failedTask: OfficeTask = {
        ...task,
        status: "failed",
        startedAt: now(),
        finishedAt: now(),
      };
      await saveTask({ storeRoot, task: failedTask });
      const errorAgent: OfficeAgent = { ...agent, status: "error" };
      await saveAgent({ storeRoot, agent: errorAgent });
      return failedTask;
    }

    // Step 4: Mark task running, agent working
    const runningTask: OfficeTask = { ...task, status: "running", startedAt: now() };
    await saveTask({ storeRoot, task: runningTask });
    const workingAgent: OfficeAgent = { ...agent, status: "working" };
    await saveAgent({ storeRoot, agent: workingAgent });

    // From here on, an infra error (createSession / appendAudit / launch /
    // endSession / a store write) must NEVER leave the task `running` or the
    // agent `working`, and must NEVER reject — we settle to a terminal state and
    // return the failed task. Explicit flags drive cleanup in the catch.
    let sessionId: SessionId | undefined;
    let sessionEnded = false;
    let spawnAudited = false;
    try {
      // Step 5: Create core session. The title is intentionally NOT the
      // instruction (which may carry secrets) — core's session store is a
      // cleartext sink, so we record only a non-sensitive label.
      const session = coreRegistry.createSession({
        id: newId() as SessionId,
        projectId,
        agentId: agent.kind,
        riskLevel: "high",
        title: `Office: ${role.name}`,
        startedAt: now(),
        endedAt: null,
      });
      sessionId = session.id;

      // Step 6: Decide session continuity
      const claudeSessionInput: { sessionId?: string; resumeSessionId?: string } =
        agent.claudeSessionId !== undefined
          ? { resumeSessionId: agent.claudeSessionId }
          : { sessionId: newId() };

      // Step 7: appendAudit(spawn)
      const spawnAudit: AuditEvent = {
        id: newId(),
        ts: now(),
        type: "spawn",
        workspaceKey: agent.workspaceKey,
        officeAgentId: agent.id,
        taskId: task.id,
        kind: agent.kind,
        permissionMode,
        workdir: agent.workdir,
        coreSessionId: sessionId as AuditEvent["coreSessionId"],
        claudeSessionId: claudeSessionInput.resumeSessionId ?? claudeSessionInput.sessionId ?? "",
      };
      await appendAudit({ storeRoot, event: spawnAudit });
      spawnAudited = true;

      // Step 8: Launch and await exit (with timeout → SIGKILL escalation)
      const handle = registry.get(agent.kind).launch({
        workdir: agent.workdir,
        instruction: task.instruction,
        model: role.model,
        permissionMode,
        allowedTools: role.allowedTools as string[],
        persona: role.persona,
        ...claudeSessionInput,
      });
      // Subscribe onEvent (Phase 2: presence proves wiring; ignore payloads)
      handle.onEvent(() => {});

      const exit = await awaitExit(handle, taskTimeoutMs);

      // Step 9: End session, settle task + agent, write the terminal audit row.
      coreRegistry.endSession(sessionId, { endedAt: now() });
      sessionEnded = true;

      const ok = exit.code === 0;
      const finishedAt = now();
      const newClaudeSessionId = handle.sessionId;

      const settledTask: OfficeTask = {
        ...runningTask,
        status: ok ? "done" : "failed",
        finishedAt,
        exitCode: exit.code ?? undefined,
      };
      await saveTask({ storeRoot, task: settledTask });

      // I5: persist handle.sessionId on BOTH paths so a retry can --resume.
      const settledAgent: OfficeAgent = {
        ...workingAgent,
        status: ok ? "idle" : "error",
        claudeSessionId: newClaudeSessionId,
      };
      await saveAgent({ storeRoot, agent: settledAgent });

      const terminalAudit: AuditEvent = {
        id: newId(),
        ts: finishedAt,
        type: ok ? "task_done" : "task_failed",
        workspaceKey: agent.workspaceKey,
        officeAgentId: agent.id,
        taskId: task.id,
        kind: agent.kind,
        permissionMode,
        workdir: agent.workdir,
        coreSessionId: sessionId as AuditEvent["coreSessionId"],
        claudeSessionId: newClaudeSessionId,
        exitCode: exit.code,
      };
      await appendAudit({ storeRoot, event: terminalAudit });
      return settledTask;
    } catch {
      // Infra failure mid-run — settle best-effort, do NOT rethrow.
      const failedTask: OfficeTask = { ...runningTask, status: "failed", finishedAt: now() };
      try {
        await saveTask({ storeRoot, task: failedTask });
        await saveAgent({ storeRoot, agent: { ...workingAgent, status: "error" } });
        if (sessionId !== undefined && !sessionEnded) {
          // Best-effort: a failing endSession here must not block the terminal
          // audit row below, which is the durable record of the failure.
          try {
            coreRegistry.endSession(sessionId, { endedAt: now() });
          } catch {
            // Session may already be ended or core may be down — ignore.
          }
        }
        if (spawnAudited && sessionId !== undefined) {
          const failedAudit: AuditEvent = {
            id: newId(),
            ts: now(),
            type: "task_failed",
            workspaceKey: agent.workspaceKey,
            officeAgentId: agent.id,
            taskId: task.id,
            kind: agent.kind,
            permissionMode,
            workdir: agent.workdir,
            coreSessionId: sessionId as AuditEvent["coreSessionId"],
            // The handle's session id is unavailable on the infra-failure path
            // (it may have failed before/at launch). Record the resume id if the
            // agent had one, else a sentinel — claudeSessionId is `.min(1)`.
            claudeSessionId: agent.claudeSessionId ?? "unknown",
            exitCode: null,
          };
          await appendAudit({ storeRoot, event: failedAudit });
        }
      } catch {
        // Ignore settle errors; the returned failed task is the best signal.
      }
      return failedTask;
    }
  }

  async function drainAgent(workspaceKey: string, officeAgentId: string): Promise<OfficeTask[]> {
    const processed: OfficeTask[] = [];
    for (;;) {
      const task = await processNextTask(workspaceKey, officeAgentId);
      if (task === null) break;
      processed.push(task);
      // Stop on failure (agent → error; next processNextTask would return null anyway,
      // but stopping here is explicit per spec)
      if (task.status === "failed") break;
    }
    return processed;
  }

  async function runWorkspace(
    workspaceKey: string,
    opts?: { maxConcurrent?: number },
  ): Promise<void> {
    const maxConcurrent = opts?.maxConcurrent ?? 4;
    const agents = await listAgents({ storeRoot, workspaceKey });

    // Simple promise pool: keep at most maxConcurrent drains in flight
    const queue = agents.slice();
    const active = new Set<Promise<void>>();

    const runNext = () => {
      const agent = queue.shift();
      if (agent === undefined) return;
      const p: Promise<void> = drainAgent(workspaceKey, agent.id).then(() => {
        active.delete(p);
        runNext();
      });
      active.add(p);
    };

    // Seed initial concurrent slots
    const initial = Math.min(maxConcurrent, queue.length);
    for (let i = 0; i < initial; i++) {
      runNext();
    }

    while (active.size > 0) {
      await Promise.race(active);
    }
  }

  return { processNextTask, drainAgent, runWorkspace };
}
