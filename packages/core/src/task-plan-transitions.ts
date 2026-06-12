import type { TaskStepId } from "@megasaver/shared";
import type { CoreRegistryErrorCode } from "./errors.js";
import type { TaskPlanStatus, TaskStep } from "./task-plan.js";

// Pure state-machine error carrying a Phase 6 registry code; the registry
// catches it and re-throws as a CoreRegistryError with the same code so the
// wire/CLI mapping is uniform.
export class TaskTransitionError extends Error {
  readonly code: CoreRegistryErrorCode;
  constructor(code: CoreRegistryErrorCode, message: string) {
    super(message);
    this.name = "TaskTransitionError";
    this.code = code;
  }
}

export type StepOutcome =
  | { status: "running" }
  | { status: "completed"; output?: string }
  | { status: "failed"; error?: string };

export function rollUpPlanStatus(steps: readonly TaskStep[]): TaskPlanStatus {
  if (steps.some((s) => s.status === "failed")) return "failed";
  if (steps.some((s) => s.status === "running")) return "running";
  if (steps.every((s) => s.status === "completed")) return "completed";
  return "planned";
}

function requireStep(steps: readonly TaskStep[], stepId: TaskStepId): TaskStep {
  const step = steps.find((s) => s.id === stepId);
  if (!step) {
    throw new TaskTransitionError(
      "task_step_not_found",
      `task_step_not_found: Task step does not exist: ${stepId}`,
    );
  }
  return step;
}

// Legal lifecycle moves (spec §4a). Idempotent same-status moves are no-ops.
export function applyStepOutcome(
  steps: readonly TaskStep[],
  stepId: TaskStepId,
  outcome: StepOutcome,
  now: string,
): TaskStep[] {
  const step = requireStep(steps, stepId);

  if (step.status === outcome.status) {
    return [...steps];
  }

  const from = step.status;
  const to = outcome.status;
  const legal =
    (from === "pending" && (to === "running" || to === "completed" || to === "failed")) ||
    (from === "running" && (to === "completed" || to === "failed"));
  if (!legal) {
    throw new TaskTransitionError(
      "task_step_transition_invalid",
      `task_step_transition_invalid: Illegal task step transition ${from} -> ${to} for ${stepId}.`,
    );
  }

  if (to === "running") {
    const depsMet = step.dependsOn.every(
      (dep) => steps.find((s) => s.id === dep)?.status === "completed",
    );
    if (!depsMet) {
      throw new TaskTransitionError(
        "task_step_dependency_unmet",
        `task_step_dependency_unmet: Task step ${stepId} cannot run before its dependencies complete.`,
      );
    }
  }

  return steps.map((s) => {
    if (s.id !== stepId) return s;
    if (to === "running") {
      return { ...s, status: "running", startedAt: s.startedAt ?? now };
    }
    if (to === "completed") {
      const { error: _error, ...rest } = s;
      return {
        ...rest,
        status: "completed",
        startedAt: s.startedAt ?? now,
        completedAt: now,
        ...(outcome.output !== undefined ? { output: outcome.output } : {}),
      };
    }
    // failed
    const { output: _output, ...rest } = s;
    return {
      ...rest,
      status: "failed",
      startedAt: s.startedAt ?? now,
      completedAt: now,
      ...(outcome.error !== undefined ? { error: outcome.error } : {}),
    };
  });
}

// Selective retry (spec §4b): reset the failed step and its transitive
// dependents back to pending; leave everything else (incl. unrelated
// completed steps) untouched.
export function resetFailedStep(steps: readonly TaskStep[], stepId: TaskStepId): TaskStep[] {
  const target = requireStep(steps, stepId);
  if (target.status !== "failed") {
    throw new TaskTransitionError(
      "task_step_not_failed",
      `task_step_not_failed: Task step is not failed (cannot retry): ${stepId}`,
    );
  }

  const toReset = new Set<TaskStepId>([stepId]);
  const visited = new Set<TaskStepId>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const s of steps) {
      if (visited.has(s.id)) continue;
      if (s.dependsOn.some((dep) => toReset.has(dep))) {
        if (!toReset.has(s.id)) {
          toReset.add(s.id);
          changed = true;
        }
        visited.add(s.id);
      }
    }
  }

  return steps.map((s) => {
    if (!toReset.has(s.id)) return s;
    const { output: _o, error: _e, ...rest } = s;
    return { ...rest, status: "pending", startedAt: null, completedAt: null };
  });
}

export function readySteps(steps: readonly TaskStep[]): TaskStepId[] {
  return steps
    .filter(
      (s) =>
        s.status === "pending" &&
        s.dependsOn.every((dep) => steps.find((x) => x.id === dep)?.status === "completed"),
    )
    .map((s) => s.id);
}
