import { z } from "zod";

// Order: alphabetic (AA1 §8a, §17). Closed set of MCP tools the Mega Saver
// bridge exposes over the wire: the four AA1 context-gate tools, the Phase 1
// (DIMMEM) memory tools, the Phase 3 (LAMR) context tools, and the Phase 4
// project tools (get_project_context, get_project_rules, record_failed_attempt,
// save_project_rule).
export const mcpToolNameSchema = z.enum([
  "explain_context_selection",
  "get_context_budget_report",
  "get_project_context",
  "get_project_rules",
  "get_relevant_code_blocks",
  "get_relevant_context",
  "get_relevant_memories",
  "mega_fetch_chunk",
  "mega_read_file",
  "mega_recall",
  "mega_run_command",
  "record_failed_attempt",
  "save_memory",
  "save_project_rule",
  "search_memory",
]);

export type McpToolName = z.infer<typeof mcpToolNameSchema>;
