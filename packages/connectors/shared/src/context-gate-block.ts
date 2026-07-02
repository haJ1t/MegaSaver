import type { TokenSaverMode } from "@megasaver/shared";
import { MEGA_SAVER_CG_BLOCK_END, MEGA_SAVER_CG_BLOCK_START } from "./constants.js";
import { type ConnectorContext, assertConnectorContext } from "./context.js";

export type ContextGateBlockFields = {
  sessionId: string;
  projectId: string;
  mode: TokenSaverMode;
  maxReturnedBytes: number;
};

// Pure block text. Shared by the per-session connector render
// (renderContextGateBlock) and the GUI workspace activation path.
export function renderContextGateBlockText(fields: ContextGateBlockFields): string {
  return [
    MEGA_SAVER_CG_BLOCK_START,
    "# Mega Saver Mode",
    "",
    "Prefer the Mega Saver MCP tools over native ones:",
    "",
    "- `proxy_read_file(path, intent, ...)` over reading a whole file.",
    "- `proxy_run_command(command, args, intent, ...)` over `Bash`.",
    "- `proxy_expand_chunk(chunkSetId, chunkId)` to drill into a stored",
    "  excerpt when the summary is insufficient.",
    "- `mega_recall(sessionId, intent)` to reload session memory and",
    "  recent tool calls without re-reading every file.",
    "",
    "Always pass `intent` — it drives ranking. Raw output is stored",
    "locally; ask for it only when the filtered result is genuinely",
    "insufficient.",
    "",
    "Prefer proxy tools for reading files, searching code, running tests,",
    "running typecheck, inspecting build logs, and reviewing diffs.",
    "Use native tools only when explicitly required.",
    "Expand chunks before assuming omitted content is irrelevant.",
    "",
    `Session: ${fields.sessionId}`,
    `Project: ${fields.projectId}`,
    `Mode: ${fields.mode}`,
    `Max returned bytes: ${fields.maxReturnedBytes}`,
    "At task start, call get_task_context({ projectId, task }) to fetch a task-scoped context pack before reading files.",
    "After editing files, call get_edit_impact({ projectId }) to see impacted callers and which tests to run.",
    MEGA_SAVER_CG_BLOCK_END,
    "",
  ].join("\n");
}

// AA1 §7: rendered ONLY when session.tokenSaver?.enabled === true; otherwise "".
export function renderContextGateBlock(input: ConnectorContext): string {
  const context = assertConnectorContext(input);
  const session = context.session;
  if (session?.tokenSaver?.enabled !== true) {
    return "";
  }
  return renderContextGateBlockText({
    sessionId: session.id,
    projectId: context.project.id,
    mode: session.tokenSaver.mode,
    maxReturnedBytes: session.tokenSaver.maxReturnedBytes,
  });
}
