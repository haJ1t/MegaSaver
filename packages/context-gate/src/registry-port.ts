import type { ProjectId, SessionId, TokenSaverMode } from "@megasaver/shared";

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

export interface OrchestratorRegistry {
  getSession(id: SessionId): SessionView | null;
  getProject(id: ProjectId): ProjectView | null;
}
