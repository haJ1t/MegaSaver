import { failedAttemptIdSchema, memoryEntryIdSchema, projectRuleIdSchema } from "@megasaver/shared";
import type { ProjectId } from "@megasaver/shared";
import { type BrainBundle, parseBrainBundle } from "./brain-bundle.js";
import { CoreRegistryError } from "./errors.js";
import type { CoreRegistry } from "./registry.js";

export type ImportCounts = { memories: number; rules: number; failures: number };

export type ImportBrainReport = {
  sourceProject: { id: string; name: string };
  imported: ImportCounts;
  skipped: ImportCounts;
};

export type ImportBrainInput = {
  registry: CoreRegistry;
  projectId: ProjectId;
  bundleText: string;
  newId: () => string;
};

export function importBrain(input: ImportBrainInput): ImportBrainReport {
  const project = input.registry.getProject(input.projectId);
  if (project === null) {
    throw new CoreRegistryError("project_not_found", `Project does not exist: ${input.projectId}`);
  }
  const bundle: BrainBundle = parseBrainBundle(input.bundleText);
  const provenance = `brain-import:${bundle.manifest.sourceProject.name}`;

  const existingMemories = input.registry.listMemoryEntries(input.projectId);
  const existingRules = input.registry.listProjectRules(input.projectId);
  const existingFailures = input.registry.listFailedAttempts(input.projectId);
  const memoryKeys = new Set(
    existingMemories.filter((m) => m.scope === "project").map((m) => m.content),
  );
  const ruleKeys = new Set(existingRules.map((r) => r.rule));
  const failureKeys = new Set(existingFailures.map((f) => `${f.task}\0${f.failedStep}`));

  const imported: ImportCounts = { memories: 0, rules: 0, failures: 0 };
  const skipped: ImportCounts = { memories: 0, rules: 0, failures: 0 };

  // ponytail: writes are per-call and non-transactional; merge-only + content dedupe makes a re-run self-healing, so partial writes on a mid-loop throw are acceptable for v1.

  for (const entry of bundle.payload.memories) {
    if (memoryKeys.has(entry.content)) {
      skipped.memories += 1;
      continue;
    }
    const { supersedesId: _dropped, ...rest } = entry;
    input.registry.createMemoryEntry({
      ...rest,
      id: memoryEntryIdSchema.parse(input.newId()),
      projectId: input.projectId,
      sessionId: null,
      scope: "project",
      approval: "suggested",
      evidence: [...(entry.evidence ?? []), provenance],
    });
    memoryKeys.add(entry.content);
    imported.memories += 1;
  }

  for (const rule of bundle.payload.rules) {
    if (ruleKeys.has(rule.rule)) {
      skipped.rules += 1;
      continue;
    }
    input.registry.createProjectRule({
      ...rule,
      id: projectRuleIdSchema.parse(input.newId()),
      projectId: input.projectId,
    });
    ruleKeys.add(rule.rule);
    imported.rules += 1;
  }

  for (const failure of bundle.payload.failures) {
    const key = `${failure.task}\0${failure.failedStep}`;
    if (failureKeys.has(key)) {
      skipped.failures += 1;
      continue;
    }
    input.registry.createFailedAttempt({
      ...failure,
      id: failedAttemptIdSchema.parse(input.newId()),
      projectId: input.projectId,
      sessionId: null,
    });
    failureKeys.add(key);
    imported.failures += 1;
  }

  return { sourceProject: bundle.manifest.sourceProject, imported, skipped };
}
