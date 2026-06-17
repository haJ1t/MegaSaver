import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import path from "node:path";
import type { ProjectId, TaskPlanId, TaskStepId, ToolDefinitionId } from "@megasaver/shared";
import { CorePersistenceError, CoreRegistryError } from "./errors.js";
import { searchFailedAttempts as searchFailures } from "./failed-attempt-search.js";
import {
  type FailedAttempt,
  failedAttemptPatchSchema,
  failedAttemptSchema,
  seedFailureEvidence,
} from "./failed-attempt.js";
import {
  readAllFailedAttempts,
  readAllMemoryEntries,
  readAllProjectRules,
  readAllTaskPlans,
  readAllToolDefinitions,
  readFailedAttemptsForProject,
  readMemoryEntriesForProject,
  readMemoryValidation,
  readProjectRulesForProject,
  readProjects,
  readSessions,
  readTaskPlansForProject,
  readToolDefinitionsForProject,
  resolveStorePaths,
  writeFailedAttemptsForProject,
  writeMemoryEntriesForProject,
  writeMemoryValidation,
  writeProjectRulesForProject,
  writeProjects,
  writeSessions,
  writeTaskPlansForProject,
  writeToolDefinitionsForProject,
} from "./json-directory-store.js";
import { memoryEntrySchema, memoryEntryUpdatePatchSchema } from "./memory-entry.js";
import { searchMemoryEntries as searchEntries } from "./memory-search.js";
import { memoryValidationSchema } from "./memory-validation.js";
import { type ProjectRule, failureToRuleInputSchema, projectRuleSchema } from "./project-rule.js";
import { type Project, projectSchema } from "./project.js";
import {
  type CoreRegistry,
  applyTaskStepRecord,
  applyTaskStepRetry,
  buildTaskPlanFromInput,
  buildToolDefinitionFromInput,
} from "./registry.js";
import { type Session, sessionSchema, sessionUpdatePatchSchema } from "./session.js";
import type { StepOutcome } from "./task-plan-transitions.js";
import { type TaskPlanInput, taskPlanSchema } from "./task-plan.js";
import { tokenSaverSettingsSchema } from "./token-saver.js";
import { toolDefinitionSchema } from "./tool-definition.js";
import { routeToolsForTask as routeTools } from "./tool-router.js";

export type JsonDirectoryCoreRegistryOptions = {
  rootDir: string;
};

function isLockHolderAlive(lockPath: string): boolean {
  let raw: string;
  try {
    raw = readFileSync(lockPath, "utf8");
  } catch {
    // lockfile vanished between EEXIST and read — treat as gone
    return false;
  }
  const pid = Number.parseInt(raw.trim(), 10);
  if (!Number.isInteger(pid) || pid <= 0) {
    // malformed payload — treat as stale, reclaim
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      return false; // confirmed dead
    }
    // EPERM (process exists but signal blocked), other → conservative alive
    return true;
  }
}

// Single-developer scale: a .lock file in rootDir acts as a mutex for
// create operations that follow a read-check-write pattern (TOCTOU).
// PID is written into the lock file; a stale holder (crashed process)
// is detected via process.kill(pid, 0) and the lock is reclaimed.
function withDirLock<T>(rootDir: string, fn: () => T): T {
  const lockPath = path.join(rootDir, ".projects.lock");
  mkdirSync(rootDir, { recursive: true });
  const deadline = Date.now() + 5000; // 5s acquire timeout
  let fd: number | undefined;
  while (Date.now() < deadline) {
    try {
      fd = openSync(lockPath, "wx");
      writeSync(fd, String(process.pid));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw new CorePersistenceError("store_write_failed", "Failed to acquire registry lock.", {
          cause: error,
          filePath: lockPath,
        });
      }
      if (!isLockHolderAlive(lockPath)) {
        try {
          rmSync(lockPath, { force: true });
          continue; // reclaim succeeded — immediate retry
        } catch {
          // reclaim failed (e.g. permission denied) — fall through to backoff
        }
      }
      const buf = new Int32Array(new SharedArrayBuffer(4));
      Atomics.wait(buf, 0, 0, 50);
    }
  }
  if (fd === undefined) {
    throw new CorePersistenceError("store_write_failed", "Timed out acquiring registry lock.", {
      filePath: lockPath,
    });
  }
  try {
    return fn();
  } finally {
    try {
      closeSync(fd);
    } catch {}
    try {
      rmSync(lockPath, { force: true });
    } catch {}
  }
}

export function createJsonDirectoryCoreRegistry(
  options: JsonDirectoryCoreRegistryOptions,
): CoreRegistry {
  const paths = resolveStorePaths(options.rootDir);

  const requireProject = (projectId: ProjectId): Project => {
    const project = readProjects(paths).find((candidate) => candidate.id === projectId);
    if (!project) {
      throw new CoreRegistryError("project_not_found", `Project does not exist: ${projectId}`);
    }

    return projectSchema.parse(project);
  };

  return {
    createProject(project) {
      return withDirLock(options.rootDir, () => {
        const parsed = projectSchema.parse(project);
        const projects = readProjects(paths);
        if (projects.some((existingProject) => existingProject.id === parsed.id)) {
          throw new CoreRegistryError(
            "project_already_exists",
            `Project already exists: ${parsed.id}`,
          );
        }

        writeProjects(paths, [...projects, parsed]);
        return projectSchema.parse(parsed);
      });
    },

    getProject(id) {
      const project = readProjects(paths).find((candidate) => candidate.id === id);
      return project ? projectSchema.parse(project) : null;
    },

    listProjects() {
      return readProjects(paths).map((project) => projectSchema.parse(project));
    },

    createSession(session) {
      return withDirLock(options.rootDir, () => {
        const parsed = sessionSchema.parse(session);
        const sessions = readSessions(paths);
        if (sessions.some((existingSession) => existingSession.id === parsed.id)) {
          throw new CoreRegistryError(
            "session_already_exists",
            `Session already exists: ${parsed.id}`,
          );
        }

        requireProject(parsed.projectId);
        writeSessions(paths, [...sessions, parsed]);
        return sessionSchema.parse(parsed);
      });
    },

    getSession(id) {
      const session = readSessions(paths).find((candidate) => candidate.id === id);
      return session ? sessionSchema.parse(session) : null;
    },

    listSessions(projectId) {
      requireProject(projectId);
      return readSessions(paths)
        .filter((session) => session.projectId === projectId)
        .map((session) => sessionSchema.parse(session));
    },

    endSession(id, opts) {
      // No requireProject check: a session existing in the registry implies its project
      // existed at create-time, and the registry does not delete projects.
      return withDirLock(options.rootDir, () => {
        const sessions = readSessions(paths);
        const existingRaw = sessions.find((candidate) => candidate.id === id);
        if (!existingRaw) {
          throw new CoreRegistryError("session_not_found", `Session does not exist: ${id}`);
        }
        const existing = sessionSchema.parse(existingRaw);
        if (existing.endedAt !== null) {
          throw new CoreRegistryError("session_already_ended", `Session already ended: ${id}`);
        }
        const updated = sessionSchema.parse({ ...existing, endedAt: opts.endedAt });
        const next = sessions.map((session) => (session.id === id ? updated : session));
        writeSessions(paths, next);
        return updated;
      });
    },

    updateSession(id, patch) {
      const parsedPatch = sessionUpdatePatchSchema.parse(patch);
      return withDirLock(options.rootDir, () => {
        const sessions = readSessions(paths);
        const existingRaw = sessions.find((candidate) => candidate.id === id);
        if (!existingRaw) {
          throw new CoreRegistryError("session_not_found", `Session does not exist: ${id}`);
        }
        const existing = sessionSchema.parse(existingRaw);
        if (existing.endedAt !== null) {
          throw new CoreRegistryError("session_already_ended", `Session already ended: ${id}`);
        }
        const updated = sessionSchema.parse({ ...existing, ...parsedPatch });
        const next = sessions.map((session) => (session.id === id ? updated : session));
        writeSessions(paths, next);
        return updated;
      });
    },

    updateTokenSaver(id, settings) {
      const parsedSettings = tokenSaverSettingsSchema.parse(settings);
      return withDirLock(options.rootDir, () => {
        const sessions = readSessions(paths);
        const existingRaw = sessions.find((candidate) => candidate.id === id);
        if (!existingRaw) {
          throw new CoreRegistryError("session_not_found", `Session does not exist: ${id}`);
        }
        const existing = sessionSchema.parse(existingRaw);
        if (existing.endedAt !== null) {
          throw new CoreRegistryError("session_already_ended", `Session already ended: ${id}`);
        }
        const updated = sessionSchema.parse({ ...existing, tokenSaver: parsedSettings });
        const next = sessions.map((session) => (session.id === id ? updated : session));
        writeSessions(paths, next);
        return updated;
      });
    },

    createMemoryEntry(entry) {
      return withDirLock(options.rootDir, () => {
        const parsed = memoryEntrySchema.parse(entry);
        if (readAllMemoryEntries(paths).some((existingEntry) => existingEntry.id === parsed.id)) {
          throw new CoreRegistryError(
            "memory_entry_already_exists",
            `Memory entry already exists: ${parsed.id}`,
          );
        }

        requireProject(parsed.projectId);

        if (parsed.scope === "session" && parsed.sessionId !== null) {
          const session = readSessions(paths).find(
            (candidate) => candidate.id === parsed.sessionId,
          );
          if (!session) {
            throw new CoreRegistryError(
              "session_not_found",
              `Session does not exist: ${parsed.sessionId}`,
            );
          }

          if (session.projectId !== parsed.projectId) {
            throw new CoreRegistryError(
              "session_project_mismatch",
              `Session ${parsed.sessionId} does not belong to project ${parsed.projectId}`,
            );
          }
        }

        const projectEntries = readMemoryEntriesForProject(paths, parsed.projectId);
        writeMemoryEntriesForProject(paths, parsed.projectId, [...projectEntries, parsed]);
        return memoryEntrySchema.parse(parsed);
      });
    },

    getMemoryEntry(id) {
      const entry = readAllMemoryEntries(paths).find((candidate) => candidate.id === id);
      return entry ? memoryEntrySchema.parse(entry) : null;
    },

    listMemoryEntries(projectId) {
      requireProject(projectId);
      return readMemoryEntriesForProject(paths, projectId).map((entry) =>
        memoryEntrySchema.parse(entry),
      );
    },

    updateMemoryEntry(id, patch) {
      const parsedPatch = memoryEntryUpdatePatchSchema.parse(patch);
      return withDirLock(options.rootDir, () => {
        const existing = readAllMemoryEntries(paths).find((candidate) => candidate.id === id);
        if (!existing) {
          throw new CoreRegistryError(
            "memory_entry_not_found",
            `Memory entry does not exist: ${id}`,
          );
        }
        const updated = memoryEntrySchema.parse({ ...existing, ...parsedPatch });
        const next = readMemoryEntriesForProject(paths, existing.projectId).map((entry) =>
          entry.id === id ? updated : entry,
        );
        writeMemoryEntriesForProject(paths, existing.projectId, next);
        return updated;
      });
    },

    deleteMemoryEntry(id) {
      withDirLock(options.rootDir, () => {
        const existing = readAllMemoryEntries(paths).find((candidate) => candidate.id === id);
        if (!existing) {
          throw new CoreRegistryError(
            "memory_entry_not_found",
            `Memory entry does not exist: ${id}`,
          );
        }
        const next = readMemoryEntriesForProject(paths, existing.projectId).filter(
          (entry) => entry.id !== id,
        );
        writeMemoryEntriesForProject(paths, existing.projectId, next);
      });
    },

    searchMemoryEntries(projectId, query) {
      requireProject(projectId);
      const entries = readMemoryEntriesForProject(paths, projectId).map((entry) =>
        memoryEntrySchema.parse(entry),
      );
      return searchEntries(entries, query);
    },

    createProjectRule(rule) {
      return withDirLock(options.rootDir, () => {
        const parsed = projectRuleSchema.parse(rule);
        if (readAllProjectRules(paths).some((r) => r.id === parsed.id)) {
          throw new CoreRegistryError(
            "project_rule_already_exists",
            `Project rule already exists: ${parsed.id}`,
          );
        }
        requireProject(parsed.projectId);
        const existing = readProjectRulesForProject(paths, parsed.projectId);
        writeProjectRulesForProject(paths, parsed.projectId, [...existing, parsed]);
        return projectRuleSchema.parse(parsed);
      });
    },

    getProjectRule(id) {
      const rule = readAllProjectRules(paths).find((r) => r.id === id);
      return rule ? projectRuleSchema.parse(rule) : null;
    },

    listProjectRules(projectId) {
      requireProject(projectId);
      return readProjectRulesForProject(paths, projectId).map((r) => projectRuleSchema.parse(r));
    },

    createFailedAttempt(attempt) {
      return withDirLock(options.rootDir, () => {
        const parsed = failedAttemptSchema.parse(attempt);
        if (readAllFailedAttempts(paths).some((fa) => fa.id === parsed.id)) {
          throw new CoreRegistryError(
            "failed_attempt_already_exists",
            `Failed attempt already exists: ${parsed.id}`,
          );
        }
        requireProject(parsed.projectId);
        if (parsed.sessionId !== null) {
          const session = readSessions(paths).find((s) => s.id === parsed.sessionId);
          if (!session) {
            throw new CoreRegistryError(
              "session_not_found",
              `Session does not exist: ${parsed.sessionId}`,
            );
          }
          if (session.projectId !== parsed.projectId) {
            throw new CoreRegistryError(
              "session_project_mismatch",
              `Session ${parsed.sessionId} does not belong to project ${parsed.projectId}`,
            );
          }
        }
        const existing = readFailedAttemptsForProject(paths, parsed.projectId);
        writeFailedAttemptsForProject(paths, parsed.projectId, [...existing, parsed]);
        return failedAttemptSchema.parse(parsed);
      });
    },

    getFailedAttempt(id) {
      const fa = readAllFailedAttempts(paths).find((f) => f.id === id);
      return fa ? failedAttemptSchema.parse(fa) : null;
    },

    listFailedAttempts(projectId) {
      requireProject(projectId);
      return readFailedAttemptsForProject(paths, projectId).map((fa) =>
        failedAttemptSchema.parse(fa),
      );
    },

    updateFailedAttempt(id, patch) {
      const parsedPatch = failedAttemptPatchSchema.parse(patch);
      return withDirLock(options.rootDir, () => {
        const existing = readAllFailedAttempts(paths).find((f) => f.id === id);
        if (!existing) {
          throw new CoreRegistryError(
            "failed_attempt_not_found",
            `Failed attempt does not exist: ${id}`,
          );
        }
        const updated = failedAttemptSchema.parse({ ...existing, ...parsedPatch });
        const next = readFailedAttemptsForProject(paths, existing.projectId).map((f) =>
          f.id === id ? updated : f,
        );
        writeFailedAttemptsForProject(paths, existing.projectId, next);
        return updated;
      });
    },

    searchFailedAttempts(projectId, query) {
      requireProject(projectId);
      const attempts = readFailedAttemptsForProject(paths, projectId).map((a) =>
        failedAttemptSchema.parse(a),
      );
      return searchFailures(attempts, query);
    },

    convertFailureToRule(failureId, input, clock) {
      const parsedInput = failureToRuleInputSchema.parse(input);
      return withDirLock(options.rootDir, () => {
        const failure = readAllFailedAttempts(paths).find((f) => f.id === failureId);
        if (!failure) {
          throw new CoreRegistryError(
            "failed_attempt_not_found",
            `Failed attempt does not exist: ${failureId}`,
          );
        }
        if (failure.convertedToRule) {
          throw new CoreRegistryError(
            "failed_attempt_already_converted",
            `Failed attempt already converted: ${failureId}`,
          );
        }
        const rule = projectRuleSchema.parse({
          id: clock.newId(),
          projectId: failure.projectId,
          title: parsedInput.title,
          rule: parsedInput.rule,
          appliesTo: parsedInput.appliesTo ?? failure.relatedFiles,
          evidence: [...(parsedInput.evidence ?? []), seedFailureEvidence(failure)],
          severity: parsedInput.severity,
          confidence: parsedInput.confidence ?? "medium",
          createdFrom: "failed_attempt",
          createdAt: clock.now(),
          updatedAt: clock.now(),
        });
        if (readAllProjectRules(paths).some((r) => r.id === rule.id)) {
          throw new CoreRegistryError(
            "project_rule_already_exists",
            `Project rule already exists: ${rule.id}`,
          );
        }
        writeProjectRulesForProject(paths, rule.projectId, [
          ...readProjectRulesForProject(paths, rule.projectId),
          rule,
        ]);
        const updatedFailure = failedAttemptSchema.parse({ ...failure, convertedToRule: true });
        const nextFailures = readFailedAttemptsForProject(paths, failure.projectId).map((f) =>
          f.id === failureId ? updatedFailure : f,
        );
        writeFailedAttemptsForProject(paths, failure.projectId, nextFailures);
        return { rule, failure: updatedFailure };
      });
    },

    createTaskPlan(projectId, input, clock) {
      return withDirLock(options.rootDir, () => {
        requireProject(projectId);
        const plan = buildTaskPlanFromInput(projectId, input, clock);
        if (plan.sessionId !== null) {
          const session = readSessions(paths).find((s) => s.id === plan.sessionId);
          if (!session) {
            throw new CoreRegistryError(
              "session_not_found",
              `Session does not exist: ${plan.sessionId}`,
            );
          }
          if (session.projectId !== projectId) {
            throw new CoreRegistryError(
              "session_project_mismatch",
              `Session ${plan.sessionId} does not belong to project ${projectId}`,
            );
          }
        }
        if (readAllTaskPlans(paths).some((p) => p.id === plan.id)) {
          throw new CoreRegistryError(
            "task_plan_already_exists",
            `Task plan already exists: ${plan.id}`,
          );
        }
        writeTaskPlansForProject(paths, projectId, [
          ...readTaskPlansForProject(paths, projectId),
          plan,
        ]);
        return taskPlanSchema.parse(plan);
      });
    },

    getTaskPlan(id) {
      const plan = readAllTaskPlans(paths).find((p) => p.id === id);
      return plan ? taskPlanSchema.parse(plan) : null;
    },

    listTaskPlans(projectId) {
      requireProject(projectId);
      return readTaskPlansForProject(paths, projectId).map((p) => taskPlanSchema.parse(p));
    },

    recordTaskStep(planId, stepId, outcome, clock) {
      return withDirLock(options.rootDir, () => {
        const existing = readAllTaskPlans(paths).find((p) => p.id === planId);
        if (!existing) {
          throw new CoreRegistryError("task_plan_not_found", `Task plan does not exist: ${planId}`);
        }
        const updated = applyTaskStepRecord(existing, stepId, outcome, clock.now());
        const next = readTaskPlansForProject(paths, existing.projectId).map((p) =>
          p.id === planId ? updated : p,
        );
        writeTaskPlansForProject(paths, existing.projectId, next);
        return updated;
      });
    },

    retryTaskStep(planId, stepId) {
      return withDirLock(options.rootDir, () => {
        const existing = readAllTaskPlans(paths).find((p) => p.id === planId);
        if (!existing) {
          throw new CoreRegistryError("task_plan_not_found", `Task plan does not exist: ${planId}`);
        }
        const updated = applyTaskStepRetry(existing, stepId);
        const next = readTaskPlansForProject(paths, existing.projectId).map((p) =>
          p.id === planId ? updated : p,
        );
        writeTaskPlansForProject(paths, existing.projectId, next);
        return updated;
      });
    },

    createToolDefinition(projectId, input, clock) {
      return withDirLock(options.rootDir, () => {
        requireProject(projectId);
        const tool = buildToolDefinitionFromInput(projectId, input, clock);
        if (readAllToolDefinitions(paths).some((t) => t.id === tool.id)) {
          throw new CoreRegistryError(
            "tool_definition_already_exists",
            `Tool definition already exists: ${tool.id}`,
          );
        }
        writeToolDefinitionsForProject(paths, projectId, [
          ...readToolDefinitionsForProject(paths, projectId),
          tool,
        ]);
        return toolDefinitionSchema.parse(tool);
      });
    },

    getToolDefinition(id) {
      const tool = readAllToolDefinitions(paths).find((t) => t.id === id);
      return tool ? toolDefinitionSchema.parse(tool) : null;
    },

    listToolDefinitions(projectId) {
      requireProject(projectId);
      return readToolDefinitionsForProject(paths, projectId).map((t) =>
        toolDefinitionSchema.parse(t),
      );
    },

    routeToolsForTask(projectId, query) {
      requireProject(projectId);
      const tools = readToolDefinitionsForProject(paths, projectId).map((t) =>
        toolDefinitionSchema.parse(t),
      );
      return routeTools(tools, query);
    },

    setMemoryValidation(validation) {
      const parsed = memoryValidationSchema.parse(validation);
      writeMemoryValidation(paths, parsed);
      return parsed;
    },

    getMemoryValidation(id) {
      return readMemoryValidation(paths, id);
    },
  };
}
