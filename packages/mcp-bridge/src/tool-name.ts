import { z } from "zod";

// Order: alphabetic (AA1 §8a, §17). Closed set of MCP tools the Mega Saver
// bridge exposes over the wire: the four AA1 context-gate tools, the Phase 1
// (DIMMEM) memory tools, the Phase 3 (LAMR) context tools, the Phase 4
// project tools (get_project_context, get_project_rules, record_failed_attempt,
// save_project_rule), and the Phase 5 FORGE tools (convert_failure_to_rule,
// find_similar_failures, get_applicable_rules).
export const mcpToolNameSchema = z.enum([
  "convert_failure_to_rule",
  "explain_context_selection",
  "find_similar_failures",
  "get_applicable_rules",
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
