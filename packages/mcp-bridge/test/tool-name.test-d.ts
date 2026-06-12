import { describe, it } from "vitest";
import { type McpToolName, mcpToolNameSchema } from "../src/tool-name.js";

describe("McpToolName type regression", () => {
  it("each member is a valid McpToolName", () => {
    const members: McpToolName[] = [
      "build_task_plan",
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
      "get_task_status",
      "mega_fetch_chunk",
      "mega_read_file",
      "mega_recall",
      "mega_run_command",
      "record_failed_attempt",
      "record_task_step",
      "retry_failed_step",
      "save_memory",
      "save_project_rule",
      "search_memory",
    ];
    void members;
  });

  it("non-member string is not assignable to McpToolName", () => {
    // @ts-expect-error arbitrary string is not assignable
    const _bad: McpToolName = "mega_delete" as string;
    void _bad;
  });

  it("schema.options spreads into McpToolName[]", () => {
    const arr: McpToolName[] = [...mcpToolNameSchema.options];
    void arr;
  });

  it("schema.options preserves the 22-member alphabetic order (AA1 §8a + Phase 1 + Phase 3 + Phase 4 + Phase 5 FORGE + Phase 6 Task Engine)", () => {
    const _t: readonly [
      "build_task_plan",
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
      "get_task_status",
      "mega_fetch_chunk",
      "mega_read_file",
      "mega_recall",
      "mega_run_command",
      "record_failed_attempt",
      "record_task_step",
      "retry_failed_step",
      "save_memory",
      "save_project_rule",
      "search_memory",
    ] = mcpToolNameSchema.options;
    void _t;
  });
});
