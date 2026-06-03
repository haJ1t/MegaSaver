import type { ProjectPermissions } from "@megasaver/policy";
import type { ProjectId, TokenSaverMode } from "@megasaver/shared";
import type { OrchestratorRegistry } from "./registry-port.js";

export type EffectiveSettings = {
  projectId: ProjectId;
  projectRoot: string;
  mode: TokenSaverMode;
  maxReturnedBytes: number | undefined;
  storeRawOutput: boolean;
  // Loaded once per resolve from <projectRoot>/.megasaver/permissions.yaml
  // (permissions-yaml §5.1). null ⇒ absent file ⇒ baseline only. Flows into
  // evaluateCommand / evaluatePathRead as additional tighten-only deny gates.
  permissions: ProjectPermissions | null;
};

// resolveEffectiveSettings can fail two ways: the session is unknown, or the
// project permissions file is present-but-malformed (the loader throws). A
// discriminated result keeps the malformed-file failure typed all the way to
// the entry points, which map policy_load_failed → DENY before any IO (I3).
export type ResolveResult =
  | { ok: true; settings: EffectiveSettings }
  | { ok: false; reason: "session_not_found" }
  | { ok: false; reason: "policy_load_failed"; detail: string };

export type PipelineEnv = {
  registry: OrchestratorRegistry;
  storeRoot: string;
  now: () => string;
  newId: () => string;
};

export type GateResult =
  | { ok: true; absolute: string }
  | { ok: false; code: "path_denied"; reason: string }
  | { ok: false; code: "path_unsafe"; message: string };
