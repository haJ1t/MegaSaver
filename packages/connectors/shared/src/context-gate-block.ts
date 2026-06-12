import { MEGA_SAVER_CG_BLOCK_END, MEGA_SAVER_CG_BLOCK_START } from "./constants.js";
import { type ConnectorContext, assertConnectorContext } from "./context.js";

// AA1 §7: rendered ONLY when session.tokenSaver?.enabled === true; otherwise "".
// Agent-agnostic (CLAUDE.md §1) — no per-agent branching. Trailing newline
// mirrors renderBlock (render.ts).
export function renderContextGateBlock(input: ConnectorContext): string {
  const context = assertConnectorContext(input);
  const tokenSaver = context.session?.tokenSaver;
  if (tokenSaver?.enabled !== true) {
    return "";
  }

  return [
    MEGA_SAVER_CG_BLOCK_START,
    "# Mega Saver Mode",
    "",
    "Mega Saver Mode is enabled for this session.",
    "",
    "When reading large files, running commands, or inspecting build /",
    "test output, prefer the Mega Saver MCP tools over native ones:",
    "",
    // Names track the default proxy naming mode (Proxy Mode v1.2 §5).
    // Installs that set MEGASAVER_TOOL_NAMING=legacy expose the
    // mega_* equivalents. Mode-aware rendering is Deliverable 8.
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
    // Proxy Mode v1.2 §6 / §14-D8 canonical instruction block.
    "Prefer proxy tools for reading files, searching code, running tests,",
    "running typecheck, inspecting build logs, and reviewing diffs.",
    "Use native tools only when explicitly required.",
    "Expand chunks before assuming omitted content is irrelevant.",
    "",
    `Session: ${context.session?.id}`,
    `Project: ${context.project.id}`,
    `Mode: ${tokenSaver.mode}`,
    `Max returned bytes: ${tokenSaver.maxReturnedBytes}`,
    MEGA_SAVER_CG_BLOCK_END,
    "",
  ].join("\n");
}
