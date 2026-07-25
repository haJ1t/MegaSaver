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

export type Redactor = { total: number; text(value: string): string };

export function makeRedactor(): Redactor {
  return {
    total: 0,
    text(value: string): string {
      const result = redactWithFindings(value);
      this.total += result.count;
      return result.redacted;
    },
  };
}

export function redactMemory(entry: MemoryEntry, r: Redactor): MemoryEntry {
  // anchor/lastVerified are pulled OUT of the spread, not overridden after it:
  // anchorFields drops them by returning {}, which a later spread cannot do.
  const { anchor: _anchor, lastVerified: _lastVerified, ...rest } = entry;
  return {
    ...rest,
    title: r.text(entry.title),
    content: r.text(entry.content),
    keywords: entry.keywords.map((k) => r.text(k)),
    ...(entry.reason === undefined ? {} : { reason: r.text(entry.reason) }),
    ...(entry.goal === undefined ? {} : { goal: r.text(entry.goal) }),
    ...(entry.evidence === undefined ? {} : { evidence: entry.evidence.map((e) => r.text(e)) }),
    ...(entry.relatedFiles === undefined
      ? {}
      : { relatedFiles: entry.relatedFiles.map((f) => r.text(f)) }),
    ...(entry.relatedSymbols === undefined
      ? {}
      : { relatedSymbols: entry.relatedSymbols.map((s) => r.text(s)) }),
    // Anchor paths and symbol names are derived from the SAME user input as
    // relatedFiles/relatedSymbols above, so shipping them verbatim leaks the
    // string the fields above just scrubbed. They cannot be redacted in place:
    // code-truth uses path as the `cat-file HEAD:<path>` key and name as the
    // symbol-match key, so a rewritten one resolves to nothing and verify
    // reports a false `contradicted` — which closes validTo on the receiver.
    // Drop the whole anchor instead: the memory imports unanchored, which is
    // exactly what it is once its keys cannot travel.
    ...anchorFields(entry, r),
  };
}

function anchorFields(
  entry: MemoryEntry,
  r: Redactor,
): Pick<MemoryEntry, "anchor" | "lastVerified"> | Record<string, never> {
  if (entry.anchor === undefined) return {};
  const scrubbed = entry.anchor.files.every((f) => r.text(f.path) === f.path);
  const scrubbedSymbols = entry.anchor.symbols.every(
    (s) => r.text(s.path) === s.path && r.text(s.name) === s.name,
  );
  // lastVerified goes with it: a verification stamp for an anchor that no
  // longer travels would render a badge nothing can re-check.
  if (!scrubbed || !scrubbedSymbols) return {};
  return {
    anchor: entry.anchor,
    ...(entry.lastVerified === undefined ? {} : { lastVerified: entry.lastVerified }),
  };
}

function redactRule(rule: ProjectRule, r: Redactor): ProjectRule {
  return {
    ...rule,
    title: r.text(rule.title),
    rule: r.text(rule.rule),
    appliesTo: rule.appliesTo.map((a) => r.text(a)),
    evidence: rule.evidence.map((e) => r.text(e)),
  };
}

export function redactFailure(failure: FailedAttempt, r: Redactor): FailedAttempt {
  return {
    ...failure,
    task: r.text(failure.task),
    failedStep: r.text(failure.failedStep),
    relatedFiles: failure.relatedFiles.map((f) => r.text(f)),
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
