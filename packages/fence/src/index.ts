export {
  FenceError,
  type FenceErrorCode,
  fenceErrorCodeSchema,
} from "./error.js";

export {
  FENCE_CLASSES,
  FENCE_FILE_NAME,
  FENCE_MAX_ALLOW_GLOBS,
  FENCE_MAX_ENTRIES,
  FENCE_MAX_GLOB_LENGTH,
  type FenceClass,
  type FenceEntry,
  type FenceFile,
  fenceClassSchema,
  fenceEntrySchema,
  fenceFileSchema,
  loadFenceFile,
  locateFenceRoot,
  parseFenceFile,
  serializeFenceFile,
} from "./fence-file.js";

export {
  type SkippedGitattributesPattern,
  type TranslateGitattributesResult,
  translateGitattributes,
} from "./gitattributes.js";

export {
  BUILD_OUTPUT_DIRS,
  CODEGEN_HEADER_LITERALS,
  type DeriveResult,
  type DeriveSeams,
  deriveFence,
  LOCKFILE_BASENAMES,
  VENDORED_DIRS,
} from "./derive.js";

export { createDefaultDeriveSeams } from "./derive-seams.js";

export {
  type CompiledFence,
  type FenceVerdict,
  compileFence,
  evaluateFenceWrite,
  normalizeFencePath,
} from "./evaluate.js";

export {
  fenceAlternative,
  formatFenceDenyReason,
  formatFenceWarn,
} from "./texts.js";

export {
  type FenceHookVerdict,
  evaluateFenceForWrite,
} from "./hook.js";

export {
  appendFenceAllow,
  appendFenceEntries,
  writeFenceFileAtomic,
} from "./write.js";
