import type {
  ProjectId,
  SessionFailureId,
  SessionId,
  TokenSaverMode,
} from "@megasaver/shared";

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

export interface OrchestratorRegistry {
  getSession(id: SessionId): SessionView | null;
  getProject(id: ProjectId): ProjectView | null;
  createSessionFailure(failure: SessionFailureRecord): SessionFailureRecord;
  listSessionFailures(projectId: ProjectId, sessionId: SessionId): SessionFailureRecord[];
}
