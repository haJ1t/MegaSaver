import type {
  FailedAttemptId,
  MemoryEntryId,
  ProjectId,
  ProjectRuleId,
  SessionId,
  TaskPlanId,
  TaskStepId,
  ToolDefinitionId,
} from "@megasaver/shared";
import { CoreRegistryError } from "./errors.js";
import {
  type FailedAttemptSearchQuery,
  searchFailedAttempts as searchFailures,
} from "./failed-attempt-search.js";
import {
  type FailedAttempt,
  type FailedAttemptPatch,
  failedAttemptPatchSchema,
  failedAttemptSchema,
  seedFailureEvidence,
} from "./failed-attempt.js";
import {
  type MemoryEntry,
  type MemoryEntryUpdatePatch,
  memoryEntrySchema,
  memoryEntryUpdatePatchSchema,
} from "./memory-entry.js";
import { type MemorySearchQuery, searchMemoryEntries as searchEntries } from "./memory-search.js";
import {
  type FailureToRuleInput,
  type ProjectRule,
  failureToRuleInputSchema,
  projectRuleSchema,
} from "./project-rule.js";
import { type Project, projectSchema } from "./project.js";
import {
  type Session,
  type SessionUpdatePatch,
  sessionSchema,
  sessionUpdatePatchSchema,
} from "./session.js";
import {
  type StepOutcome,
  TaskTransitionError,
  applyStepOutcome,
  resetFailedStep,
  rollUpPlanStatus,
} from "./task-plan-transitions.js";
import {
  type TaskPlan,
  type TaskPlanInput,
  taskPlanInputSchema,
  taskPlanSchema,
  taskStepSchema,
} from "./task-plan.js";
import { type TokenSaverSettings, tokenSaverSettingsSchema } from "./token-saver.js";
import { type ToolRouteResult, routeToolsForTask as routeTools } from "./tool-router.js";
import {
  type ToolDefinition,
  type ToolDefinitionInput,
  toolDefinitionInputSchema,
  toolDefinitionSchema,
} from "./tool-definition.js";

export interface CoreRegistry {
  createProject(project: Project): Project;
  getProject(id: ProjectId): Project | null;
  listProjects(): Project[];
  createSession(session: Session): Session;
  getSession(id: SessionId): Session | null;
  listSessions(projectId: ProjectId): Session[];
  endSession(id: SessionId, opts: { endedAt: string }): Session;
  updateSession(id: SessionId, patch: SessionUpdatePatch): Session;
  // AA1 BB1: write the entire TokenSaverSettings blob onto a session.
  // The CLI / GUI compute the blob (mode, budget, timestamps) and hand
  // it over atomically — this method does not merge per-field patches.
  updateTokenSaver(id: SessionId, settings: TokenSaverSettings): Session;
  createMemoryEntry(entry: MemoryEntry): MemoryEntry;
  getMemoryEntry(id: MemoryEntryId): MemoryEntry | null;
  listMemoryEntries(projectId: ProjectId): MemoryEntry[];
  updateMemoryEntry(id: MemoryEntryId, patch: MemoryEntryUpdatePatch): MemoryEntry;
  // Write-only by design: a hard delete returns nothing. A caller that needs
  // the pre-delete state reads it via getMemoryEntry first (the CLI does this
  // to render a not-found error before deleting).
  deleteMemoryEntry(id: MemoryEntryId): void;
  searchMemoryEntries(projectId: ProjectId, query: MemorySearchQuery): MemoryEntry[];
  createProjectRule(rule: ProjectRule): ProjectRule;
  getProjectRule(id: ProjectRuleId): ProjectRule | null;
  listProjectRules(projectId: ProjectId): ProjectRule[];
  createFailedAttempt(attempt: FailedAttempt): FailedAttempt;
  getFailedAttempt(id: FailedAttemptId): FailedAttempt | null;
  listFailedAttempts(projectId: ProjectId): FailedAttempt[];
  updateFailedAttempt(id: FailedAttemptId, patch: FailedAttemptPatch): FailedAttempt;
  searchFailedAttempts(projectId: ProjectId, query: FailedAttemptSearchQuery): FailedAttempt[];
  convertFailureToRule(
    failureId: FailedAttemptId,
    input: FailureToRuleInput,
    clock: { now: () => string; newId: () => string },
  ): ConvertFailureResult;
  createTaskPlan(
    projectId: ProjectId,
    input: TaskPlanInput,
    clock: { now: () => string; newId: () => string },
  ): TaskPlan;
  getTaskPlan(id: TaskPlanId): TaskPlan | null;
  listTaskPlans(projectId: ProjectId): TaskPlan[];
  recordTaskStep(
    planId: TaskPlanId,
    stepId: TaskStepId,
    outcome: StepOutcome,
    clock: { now: () => string },
  ): TaskPlan;
  retryTaskStep(planId: TaskPlanId, stepId: TaskStepId): TaskPlan;
  createToolDefinition(
    projectId: ProjectId,
    input: ToolDefinitionInput,
    clock: { now: () => string; newId: () => string },
  ): ToolDefinition;
  getToolDefinition(id: ToolDefinitionId): ToolDefinition | null;
  listToolDefinitions(projectId: ProjectId): ToolDefinition[];
  routeToolsForTask(projectId: ProjectId, query: string | undefined): ToolRouteResult;
}

export type ConvertFailureResult = { rule: ProjectRule; failure: FailedAttempt };

// Resolve a caller-authored TaskPlanInput into a fully-formed TaskPlan: mint the
// plan id + one TaskStepId per local key, rewrite dependsOnKeys -> dependsOn,
// seed pending/planned. Shared verbatim by both registry impls so they stay
// behaviourally identical.
export function buildTaskPlanFromInput(
  projectId: ProjectId,
  input: TaskPlanInput,
  clock: { now: () => string; newId: () => string },
): TaskPlan {
  const parsedInput = taskPlanInputSchema.parse(input);
  const planId = clock.newId();
  const keyToId = new Map<string, string>();
  for (const step of parsedInput.steps) {
    keyToId.set(step.key, clock.newId());
  }
  const steps = parsedInput.steps.map((step) =>
    taskStepSchema.parse({
      id: keyToId.get(step.key),
      type: step.type,
      title: step.title,
      dependsOn: step.dependsOnKeys.map((k) => keyToId.get(k)),
      status: "pending",
      startedAt: null,
      completedAt: null,
      ...(step.description !== undefined ? { description: step.description } : {}),
    }),
  );
  return taskPlanSchema.parse({
    id: planId,
    projectId,
    sessionId: parsedInput.sessionId,
    task: parsedInput.task,
    status: "planned",
    steps,
    createdAt: clock.now(),
    updatedAt: clock.now(),
  });
}

// Resolve a caller-authored ToolDefinitionInput into a fully-formed
// ToolDefinition: mint the id, stamp createdAt, default opaque I/O schemas to
// null. Shared verbatim by both registry impls so they stay behaviourally
// identical.
export function buildToolDefinitionFromInput(
  projectId: ProjectId,
  input: ToolDefinitionInput,
  clock: { now: () => string; newId: () => string },
): ToolDefinition {
  const parsed = toolDefinitionInputSchema.parse(input);
  return toolDefinitionSchema.parse({
    id: clock.newId(),
    projectId,
    name: parsed.name,
    description: parsed.description,
    category: parsed.category,
    risk: parsed.risk,
    keywords: parsed.keywords,
    inputSchema: parsed.inputSchema ?? null,
    outputSchema: parsed.outputSchema ?? null,
    createdAt: clock.now(),
  });
}

export function applyTaskStepRecord(
  plan: TaskPlan,
  stepId: TaskStepId,
  outcome: StepOutcome,
  now: string,
): TaskPlan {
  let steps: TaskPlan["steps"];
  try {
    steps = applyStepOutcome(plan.steps, stepId, outcome, now);
  } catch (err) {
    if (err instanceof TaskTransitionError) throw new CoreRegistryError(err.code, err.message);
    throw err;
  }
  return taskPlanSchema.parse({
    ...plan,
    steps,
    status: rollUpPlanStatus(steps),
    updatedAt: now,
  });
}

export function applyTaskStepRetry(plan: TaskPlan, stepId: TaskStepId): TaskPlan {
  let steps: TaskPlan["steps"];
  try {
    steps = resetFailedStep(plan.steps, stepId);
  } catch (err) {
    if (err instanceof TaskTransitionError) throw new CoreRegistryError(err.code, err.message);
    throw err;
  }
  return taskPlanSchema.parse({ ...plan, steps, status: rollUpPlanStatus(steps) });
}

export function createInMemoryCoreRegistry(): CoreRegistry {
  const projects = new Map<ProjectId, Project>();
  const sessions = new Map<SessionId, Session>();
  const memoryEntries = new Map<MemoryEntryId, MemoryEntry>();
  const projectRules = new Map<ProjectRuleId, ProjectRule>();
  const failedAttempts = new Map<FailedAttemptId, FailedAttempt>();
  const taskPlans = new Map<TaskPlanId, TaskPlan>();
  const toolDefinitions = new Map<ToolDefinitionId, ToolDefinition>();

  const requireProject = (projectId: ProjectId): void => {
    if (!projects.has(projectId)) {
      throw new CoreRegistryError("project_not_found", `Project does not exist: ${projectId}`);
    }
  };

  return {
    createProject(project) {
      const parsed = projectSchema.parse(project);
      if (projects.has(parsed.id)) {
        throw new CoreRegistryError(
          "project_already_exists",
          `Project already exists: ${parsed.id}`,
        );
      }

      projects.set(parsed.id, parsed);
      return projectSchema.parse(parsed);
    },

    getProject(id) {
      const project = projects.get(id);
      return project ? projectSchema.parse(project) : null;
    },

    listProjects() {
      return Array.from(projects.values(), (project) => projectSchema.parse(project));
    },

    createSession(session) {
      const parsed = sessionSchema.parse(session);
      if (sessions.has(parsed.id)) {
        throw new CoreRegistryError(
          "session_already_exists",
          `Session already exists: ${parsed.id}`,
        );
      }

      requireProject(parsed.projectId);
      sessions.set(parsed.id, parsed);
      return sessionSchema.parse(parsed);
    },

    getSession(id) {
      const session = sessions.get(id);
      return session ? sessionSchema.parse(session) : null;
    },

    listSessions(projectId) {
      requireProject(projectId);
      return Array.from(sessions.values())
        .filter((session) => session.projectId === projectId)
        .map((session) => sessionSchema.parse(session));
    },

    endSession(id, opts) {
      // No requireProject check: a session existing in the registry implies its project
      // existed at create-time, and the registry does not delete projects.
      const existing = sessions.get(id);
      if (!existing) {
        throw new CoreRegistryError("session_not_found", `Session does not exist: ${id}`);
      }
      if (existing.endedAt !== null) {
        throw new CoreRegistryError("session_already_ended", `Session already ended: ${id}`);
      }
      const updated = sessionSchema.parse({ ...existing, endedAt: opts.endedAt });
      sessions.set(id, updated);
      return updated;
    },

    updateSession(id, patch) {
      const parsedPatch = sessionUpdatePatchSchema.parse(patch);
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

    updateTokenSaver(id, settings) {
      const parsedSettings = tokenSaverSettingsSchema.parse(settings);
      const existing = sessions.get(id);
      if (!existing) {
        throw new CoreRegistryError("session_not_found", `Session does not exist: ${id}`);
      }
      if (existing.endedAt !== null) {
        throw new CoreRegistryError("session_already_ended", `Session already ended: ${id}`);
      }
      const updated = sessionSchema.parse({ ...existing, tokenSaver: parsedSettings });
      sessions.set(id, updated);
      return updated;
    },

    createMemoryEntry(entry) {
      const parsed = memoryEntrySchema.parse(entry);
      if (memoryEntries.has(parsed.id)) {
        throw new CoreRegistryError(
          "memory_entry_already_exists",
          `Memory entry already exists: ${parsed.id}`,
        );
      }

      requireProject(parsed.projectId);

      if (parsed.scope === "session" && parsed.sessionId !== null) {
        const session = sessions.get(parsed.sessionId);
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

      memoryEntries.set(parsed.id, parsed);
      return memoryEntrySchema.parse(parsed);
    },

    getMemoryEntry(id) {
      const entry = memoryEntries.get(id);
      return entry ? memoryEntrySchema.parse(entry) : null;
    },

    listMemoryEntries(projectId) {
      requireProject(projectId);
      return Array.from(memoryEntries.values())
        .filter((entry) => entry.projectId === projectId)
        .map((entry) => memoryEntrySchema.parse(entry));
    },

    updateMemoryEntry(id, patch) {
      const parsedPatch = memoryEntryUpdatePatchSchema.parse(patch);
      const existing = memoryEntries.get(id);
      if (!existing) {
        throw new CoreRegistryError("memory_entry_not_found", `Memory entry does not exist: ${id}`);
      }
      const updated = memoryEntrySchema.parse({ ...existing, ...parsedPatch });
      memoryEntries.set(id, updated);
      return updated;
    },

    deleteMemoryEntry(id) {
      if (!memoryEntries.has(id)) {
        throw new CoreRegistryError("memory_entry_not_found", `Memory entry does not exist: ${id}`);
      }
      memoryEntries.delete(id);
    },

    searchMemoryEntries(projectId, query) {
      requireProject(projectId);
      const entries = Array.from(memoryEntries.values())
        .filter((entry) => entry.projectId === projectId)
        .map((entry) => memoryEntrySchema.parse(entry));
      return searchEntries(entries, query);
    },

    createProjectRule(rule) {
      const parsed = projectRuleSchema.parse(rule);
      if (projectRules.has(parsed.id)) {
        throw new CoreRegistryError(
          "project_rule_already_exists",
          `Project rule already exists: ${parsed.id}`,
        );
      }
      requireProject(parsed.projectId);
      projectRules.set(parsed.id, parsed);
      return projectRuleSchema.parse(parsed);
    },

    getProjectRule(id) {
      const rule = projectRules.get(id);
      return rule ? projectRuleSchema.parse(rule) : null;
    },

    listProjectRules(projectId) {
      requireProject(projectId);
      return Array.from(projectRules.values())
        .filter((rule) => rule.projectId === projectId)
        .map((rule) => projectRuleSchema.parse(rule));
    },

    createFailedAttempt(attempt) {
      const parsed = failedAttemptSchema.parse(attempt);
      if (failedAttempts.has(parsed.id)) {
        throw new CoreRegistryError(
          "failed_attempt_already_exists",
          `Failed attempt already exists: ${parsed.id}`,
        );
      }
      requireProject(parsed.projectId);
      if (parsed.sessionId !== null) {
        const session = sessions.get(parsed.sessionId);
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
      failedAttempts.set(parsed.id, parsed);
      return failedAttemptSchema.parse(parsed);
    },

    getFailedAttempt(id) {
      const attempt = failedAttempts.get(id);
      return attempt ? failedAttemptSchema.parse(attempt) : null;
    },

    listFailedAttempts(projectId) {
      requireProject(projectId);
      return Array.from(failedAttempts.values())
        .filter((attempt) => attempt.projectId === projectId)
        .map((attempt) => failedAttemptSchema.parse(attempt));
    },

    updateFailedAttempt(id, patch) {
      const parsedPatch = failedAttemptPatchSchema.parse(patch);
      const existing = failedAttempts.get(id);
      if (!existing) {
        throw new CoreRegistryError(
          "failed_attempt_not_found",
          `Failed attempt does not exist: ${id}`,
        );
      }
      const updated = failedAttemptSchema.parse({ ...existing, ...parsedPatch });
      failedAttempts.set(id, updated);
      return updated;
    },

    searchFailedAttempts(projectId, query) {
      requireProject(projectId);
      const attempts = Array.from(failedAttempts.values())
        .filter((a) => a.projectId === projectId)
        .map((a) => failedAttemptSchema.parse(a));
      return searchFailures(attempts, query);
    },

    convertFailureToRule(failureId, input, clock) {
      const parsedInput = failureToRuleInputSchema.parse(input);
      const failure = failedAttempts.get(failureId);
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
      if (projectRules.has(rule.id)) {
        throw new CoreRegistryError(
          "project_rule_already_exists",
          `Project rule already exists: ${rule.id}`,
        );
      }
      projectRules.set(rule.id, rule);
      const updatedFailure = failedAttemptSchema.parse({ ...failure, convertedToRule: true });
      failedAttempts.set(failureId, updatedFailure);
      return { rule, failure: updatedFailure };
    },

    createTaskPlan(projectId, input, clock) {
      requireProject(projectId);
      const plan = buildTaskPlanFromInput(projectId, input, clock);
      if (plan.sessionId !== null) {
        const session = sessions.get(plan.sessionId);
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
      if (taskPlans.has(plan.id)) {
        throw new CoreRegistryError(
          "task_plan_already_exists",
          `Task plan already exists: ${plan.id}`,
        );
      }
      taskPlans.set(plan.id, plan);
      return taskPlanSchema.parse(plan);
    },

    getTaskPlan(id) {
      const plan = taskPlans.get(id);
      return plan ? taskPlanSchema.parse(plan) : null;
    },

    listTaskPlans(projectId) {
      requireProject(projectId);
      return Array.from(taskPlans.values())
        .filter((p) => p.projectId === projectId)
        .map((p) => taskPlanSchema.parse(p));
    },

    recordTaskStep(planId, stepId, outcome, clock) {
      const existing = taskPlans.get(planId);
      if (!existing) {
        throw new CoreRegistryError("task_plan_not_found", `Task plan does not exist: ${planId}`);
      }
      const updated = applyTaskStepRecord(existing, stepId, outcome, clock.now());
      taskPlans.set(planId, updated);
      return updated;
    },

    retryTaskStep(planId, stepId) {
      const existing = taskPlans.get(planId);
      if (!existing) {
        throw new CoreRegistryError("task_plan_not_found", `Task plan does not exist: ${planId}`);
      }
      const updated = applyTaskStepRetry(existing, stepId);
      taskPlans.set(planId, updated);
      return updated;
    },

    createToolDefinition(projectId, input, clock) {
      requireProject(projectId);
      const tool = buildToolDefinitionFromInput(projectId, input, clock);
      if (toolDefinitions.has(tool.id)) {
        throw new CoreRegistryError(
          "tool_definition_already_exists",
          `Tool definition already exists: ${tool.id}`,
        );
      }
      toolDefinitions.set(tool.id, tool);
      return toolDefinitionSchema.parse(tool);
    },

    getToolDefinition(id) {
      const tool = toolDefinitions.get(id);
      return tool ? toolDefinitionSchema.parse(tool) : null;
    },

    listToolDefinitions(projectId) {
      requireProject(projectId);
      return Array.from(toolDefinitions.values())
        .filter((t) => t.projectId === projectId)
        .map((t) => toolDefinitionSchema.parse(t));
    },

    routeToolsForTask(projectId, query) {
      requireProject(projectId);
      const tools = Array.from(toolDefinitions.values())
        .filter((t) => t.projectId === projectId)
        .map((t) => toolDefinitionSchema.parse(t));
      return routeTools(tools, query);
    },
  };
}
