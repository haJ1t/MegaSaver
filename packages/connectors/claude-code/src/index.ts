export {
  CLAUDE_CODE_AGENT_ID,
  CLAUDE_MD_FILE,
  MEGA_SAVER_BLOCK_END,
  MEGA_SAVER_BLOCK_START,
} from "./constants.js";
export {
  type ClaudeCodeContext,
  ClaudeCodeContextSchema,
  assertClaudeCodeContext,
} from "./context.js";
export {
  ClaudeCodeConnectorError,
  type ClaudeCodeConnectorErrorCode,
  claudeCodeConnectorErrorCodeSchema,
} from "./errors.js";
export { readClaudeMd, syncClaudeMdContext, writeClaudeMd } from "./filesystem.js";
export {
  type ClaudeMdDocument,
  parseClaudeMd,
  removeMegaSaverBlock,
  renderClaudeCodeContext,
  upsertMegaSaverBlock,
} from "./markdown.js";
export {
  HOOK_MATCHER,
  DEFAULT_HOOK_COMMAND,
  SAVER_HOOK_COMMAND,
  SAVER_HOOK_MATCHER,
  hasPreToolUseHook,
  addPreToolUseHook,
  hasPostToolUseHook,
  addPostToolUseHook,
  removePreToolUseHook,
  removePostToolUseHook,
  installClaudeCodeHook,
  uninstallClaudeCodeHook,
  readClaudeCodeHookStatus,
  resolveClaudeCodeSettingsPath,
  type InstallClaudeCodeHookInput,
  type ClaudeCodeHookResult,
  type ClaudeCodeHookStatus,
} from "./hook-settings.js";
export {
  buildClaudeArgs,
  createClaudeCodeLauncher,
  type SpawnFn,
  type SpawnedChild,
} from "./launcher.js";
export {
  type ClaudeRouteAdapter,
  type RouteInspection,
  type EnsureHooksError,
  createClaudeRouteAdapter,
} from "./proxy-route.js";
