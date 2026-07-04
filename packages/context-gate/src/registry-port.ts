import type { ProjectId, SessionFailureId, SessionId, TokenSaverMode } from "@megasaver/shared";

// Structural port: the slice of a registry the orchestrator reads.
// @megasaver/core's CoreRegistry structurally satisfies this interface, so
// callers keep passing a CoreRegistry with no cast (TS structural typing).
// Defined here to break the context-gate -> core dependency edge (AA1 §3c).
export interface SessionView {
  projectId: ProjectId;
  // `| undefined` is explicit (not just `?:`) so that under
  // exactOptionalPropertyTypes core's CoreRegistry — whose Session.tokenSaver
  // is emitted as `{ ... } | undefined` — is assignable with no cast.
  tokenSaver?:
    | {
        mode: TokenSaverMode;
        maxReturnedBytes?: number;
        storeRawOutput?: boolean;
      }
    | undefined;
}

export interface ProjectView {
  rootPath: string;
}

// Structural mirror of @megasaver/core's SessionFailure — declared here (not
// imported) to keep the context-gate -> core edge broken (AA1 §3c). core's
// SessionFailure is structurally assignable to this record.
export interface SessionFailureRecord {
  id: SessionFailureId;
  projectId: ProjectId;
  sessionId: SessionId;
  command: string;
  errorOutput: string;
  source: "proxy-classifier";
  createdAt: string;
}

// Narrow structural views of core's MemoryEntry / ProjectRule — only the
// fields the hint builder reads. Declared here (not imported) to keep the
// context-gate -> core edge broken (AA1 §3c). `approval` is a plain string
// (not core's literal union) so core stays assignable without coupling to
// its enum; the builder only compares against "approved".
export interface MemoryEntryView {
  // Core's branded MemoryEntry.id is structurally a string, so a real
  // CoreRegistry supplies it with no cast. Optional because the hint builder's
  // test doubles construct MemoryEntryView literals without an id — a term
  // whose entry has no id is still ranked, it just carries no attribution.
  id?: string | undefined;
  approval: string;
  stale: boolean;
  relatedFiles?: readonly string[] | undefined;
  relatedSymbols?: readonly string[] | undefined;
}

export interface ProjectRuleView {
  appliesTo: readonly string[];
}

export interface OrchestratorRegistry {
  getSession(id: SessionId): SessionView | null;
  getProject(id: ProjectId): ProjectView | null;
  createSessionFailure(failure: SessionFailureRecord): SessionFailureRecord;
  listSessionFailures(projectId: ProjectId, sessionId: SessionId): SessionFailureRecord[];
  listMemoryEntries(projectId: ProjectId): MemoryEntryView[];
  listProjectRules(projectId: ProjectId): ProjectRuleView[];
}
