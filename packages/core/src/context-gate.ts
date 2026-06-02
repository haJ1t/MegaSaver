export {
  runOutputPipeline,
  type RunOutputInput,
  type RunOutputResult,
} from "./context-gate/run.js";
export {
  runOutputExecCommand,
  type RunOutputExecInput,
  type RunOutputExecResult,
  type RunCommandSpawn,
  type ExecResult,
} from "./context-gate/run-command.js";
export { fetchChunk, type FetchChunkResult } from "./context-gate/fetch-chunk.js";
export { locateChunkSet, type LocatedChunkSet } from "./context-gate/locate-chunk-set.js";
export {
  resolveEffectiveSettings,
  runTwoGates,
  readAndFilter,
  persistChunkSet,
  defaultNow,
  defaultNewId,
} from "./context-gate/read.js";
export type { EffectiveSettings, GateResult, PipelineEnv } from "./context-gate/types.js";
