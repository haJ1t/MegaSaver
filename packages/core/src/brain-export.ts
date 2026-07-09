import { redactWithFindings } from "@megasaver/policy";
import type { ProjectId } from "@megasaver/shared";
import { type BrainPayload, serializeBrainBundle } from "./brain-bundle.js";
import { CoreRegistryError } from "./errors.js";
import type { FailedAttempt } from "./failed-attempt.js";
import type { MemoryEntry } from "./memory-entry.js";
import type { ProjectRule } from "./project-rule.js";
import type { CoreRegistry } from "./registry.js";

export type ExportBrainInput = {
  registry: CoreRegistry;
  projectId: ProjectId;
  createdAt: string;
};

type Redactor = { total: number; text(value: string): string };

function makeRedactor(): Redactor {
  return {
    total: 0,
    text(value: string): string {
      const result = redactWithFindings(value);
      this.total += result.count;
      return result.redacted;
    },
  };
}

function redactMemory(entry: MemoryEntry, r: Redactor): MemoryEntry {
  return {
    ...entry,
    title: r.text(entry.title),
    content: r.text(entry.content),
    ...(entry.reason === undefined ? {} : { reason: r.text(entry.reason) }),
    ...(entry.goal === undefined ? {} : { goal: r.text(entry.goal) }),
    ...(entry.evidence === undefined ? {} : { evidence: entry.evidence.map((e) => r.text(e)) }),
  };
}

function redactRule(rule: ProjectRule, r: Redactor): ProjectRule {
  return {
    ...rule,
    title: r.text(rule.title),
    rule: r.text(rule.rule),
    evidence: rule.evidence.map((e) => r.text(e)),
  };
}

function redactFailure(failure: FailedAttempt, r: Redactor): FailedAttempt {
  return {
    ...failure,
    task: r.text(failure.task),
    failedStep: r.text(failure.failedStep),
    ...(failure.errorOutput === undefined ? {} : { errorOutput: r.text(failure.errorOutput) }),
    ...(failure.suspectedCause === undefined
      ? {}
      : { suspectedCause: r.text(failure.suspectedCause) }),
    ...(failure.resolution === undefined ? {} : { resolution: r.text(failure.resolution) }),
  };
}

// Only approved, project-scoped memories travel — session-scoped memories
// reference a sessionId absent in the target store (see brain-portability
// spec). Rules and failures carry no scope split, so all of them export.
export function exportBrain(input: ExportBrainInput): string {
  const project = input.registry.getProject(input.projectId);
  if (project === null) {
    throw new CoreRegistryError("project_not_found", `Project does not exist: ${input.projectId}`);
  }
  const r = makeRedactor();
  const payload: BrainPayload = {
    memories: input.registry
      .listMemoryEntries(input.projectId)
      .filter((m) => m.approval === "approved" && m.scope === "project")
      .map((m) => redactMemory(m, r)),
    rules: input.registry.listProjectRules(input.projectId).map((rule) => redactRule(rule, r)),
    failures: input.registry.listFailedAttempts(input.projectId).map((f) => redactFailure(f, r)),
  };
  return serializeBrainBundle({
    sourceProject: { id: project.id, name: project.name },
    createdAt: input.createdAt,
    redactionFindings: r.total,
    payload,
  });
}
