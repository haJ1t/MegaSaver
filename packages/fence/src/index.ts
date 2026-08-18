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
