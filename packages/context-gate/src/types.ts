import type { ProjectId, TokenSaverMode } from "@megasaver/shared";
import type { OrchestratorRegistry } from "./registry-port.js";

export type EffectiveSettings = {
  projectId: ProjectId;
  projectRoot: string;
  mode: TokenSaverMode;
  maxReturnedBytes: number | undefined;
  storeRawOutput: boolean;
};

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
