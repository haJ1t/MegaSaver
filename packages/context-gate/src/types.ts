import type { ProjectId, TokenSaverMode } from "@megasaver/shared";
import type { CoreRegistry } from "../registry.js";

export type EffectiveSettings = {
  projectId: ProjectId;
  projectRoot: string;
  mode: TokenSaverMode;
  maxReturnedBytes: number | undefined;
  storeRawOutput: boolean;
};

export type PipelineEnv = {
  registry: CoreRegistry;
  storeRoot: string;
  now: () => string;
  newId: () => string;
};

export type GateResult =
  | { ok: true; absolute: string }
  | { ok: false; code: "path_denied"; reason: string }
  | { ok: false; code: "path_unsafe"; message: string };
