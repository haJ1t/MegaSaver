import type { CoreRegistry } from "@megasaver/core";
import type { ProjectId } from "@megasaver/shared";
import { listAgents, loadAgent, saveAgent } from "./agent-store.js";
import type { OfficeAgent } from "./agent.js";
import { appendAudit } from "./audit-store.js";
import type { AuditEvent } from "./audit.js";
import type { LauncherRegistry } from "./launcher-registry.js";
import { resolveLauncherPermission } from "./permission.js";
import { loadRole } from "./role-store.js";
import { listTasks, saveTask } from "./task-store.js";
import type { OfficeTask } from "./task.js";

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
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
}): Supervisor {
  const { storeRoot, registry, coreRegistry, projectId, now, newId, allowFull = false } = deps;

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

    // Step 5: Create core session
    const coreSessionId = newId();
    const sessionTitle = truncate(task.instruction, 120) || "Agent task";
    coreRegistry.createSession({
      id: coreSessionId as Parameters<CoreRegistry["createSession"]>[0]["id"],
      projectId,
      agentId: agent.kind,
      riskLevel: "high",
      title: sessionTitle,
      startedAt: now(),
      endedAt: null,
    });

    // Step 6: Decide session continuity
    const claudeSessionInput: { sessionId?: string; resumeSessionId?: string } =
      agent.claudeSessionId !== undefined
        ? { resumeSessionId: agent.claudeSessionId }
        : { sessionId: newId() };

    // Step 7: appendAudit(spawn)
    const auditId = newId();
    const spawnAudit: AuditEvent = {
      id: auditId,
      ts: now(),
      type: "spawn",
      workspaceKey: agent.workspaceKey,
      officeAgentId: agent.id,
      taskId: task.id,
      kind: agent.kind,
      permissionMode,
      workdir: agent.workdir,
      coreSessionId: coreSessionId as AuditEvent["coreSessionId"],
      claudeSessionId: claudeSessionInput.resumeSessionId ?? claudeSessionInput.sessionId ?? "",
    };
    await appendAudit({ storeRoot, event: spawnAudit });

    // Step 8: Launch and await exit
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

    const { code } = await new Promise<{ code: number | null }>((res) => {
      handle.onExit(res);
    });

    // Step 9: Handle exit
    const finishedAt = now();
    const exitCode = code;
    const newClaudeSessionId = handle.sessionId;

    coreRegistry.endSession(coreSessionId as Parameters<CoreRegistry["endSession"]>[0], {
      endedAt: finishedAt,
    });

    if (exitCode === 0) {
      const doneTask: OfficeTask = {
        ...runningTask,
        status: "done",
        finishedAt,
        exitCode: 0,
      };
      await saveTask({ storeRoot, task: doneTask });

      const idleAgent: OfficeAgent = {
        ...workingAgent,
        status: "idle",
        claudeSessionId: newClaudeSessionId,
      };
      await saveAgent({ storeRoot, agent: idleAgent });

      const doneAudit: AuditEvent = {
        id: newId(),
        ts: finishedAt,
        type: "task_done",
        workspaceKey: agent.workspaceKey,
        officeAgentId: agent.id,
        taskId: task.id,
        kind: agent.kind,
        permissionMode,
        workdir: agent.workdir,
        coreSessionId: coreSessionId as AuditEvent["coreSessionId"],
        claudeSessionId: newClaudeSessionId,
        exitCode: 0,
      };
      await appendAudit({ storeRoot, event: doneAudit });
      return doneTask;
    }
    const failedTask: OfficeTask = {
      ...runningTask,
      status: "failed",
      finishedAt,
      exitCode: exitCode ?? undefined,
    };
    await saveTask({ storeRoot, task: failedTask });

    const errorAgent: OfficeAgent = { ...workingAgent, status: "error" };
    await saveAgent({ storeRoot, agent: errorAgent });

    const failedAudit: AuditEvent = {
      id: newId(),
      ts: finishedAt,
      type: "task_failed",
      workspaceKey: agent.workspaceKey,
      officeAgentId: agent.id,
      taskId: task.id,
      kind: agent.kind,
      permissionMode,
      workdir: agent.workdir,
      coreSessionId: coreSessionId as AuditEvent["coreSessionId"],
      claudeSessionId: newClaudeSessionId,
      exitCode: exitCode,
    };
    await appendAudit({ storeRoot, event: failedAudit });
    return failedTask;
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
