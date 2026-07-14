import { describe, it } from "vitest";
import { type McpToolName, mcpToolNameSchema } from "../src/tool-name.js";

describe("McpToolName type regression", () => {
  it("each member is a valid McpToolName", () => {
    const members: McpToolName[] = [
      "approve_memory",
      "audit_token_usage",
      "build_task_plan",
      "convert_failure_to_rule",
      "explain_context_selection",
      "find_similar_failures",
      "get_applicable_rules",
      "get_context_budget_report",
      "get_edit_impact",
      "get_project_context",
      "get_project_rules",
      "get_relevant_code_blocks",
      "get_relevant_context",
      "get_relevant_memories",
      "get_task_context",
      "get_task_status",
      "get_warm_start_brief",
      "mega_fetch_chunk",
      "mega_impact",
      "mega_index_memory",
      "mega_memory_from_session",
      "mega_memory_sweep",
      "mega_read_file",
      "mega_recall",
      "mega_run_command",
      "proxy_search_code",
      "record_failed_attempt",
      "record_task_step",
      "retry_failed_step",
      "route_tools_for_task",
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

  it("schema.options preserves the 34-member alphabetic order (AA1 §8a + Phase 1 + Phase 3 + Phase 4 + Phase 5 FORGE + Phase 6 Task Engine + Phase 7 Tool Router + Phase 8 Audit + Phase 10 Approval + Proxy Mode v1.2 search + impact + memory index + M2 memory sweep + M4 from-session + live-context-seam get_task_context + edit-impact get_edit_impact + warm-start get_warm_start_brief + guard check_approach)", () => {
    const _t: readonly [
      "approve_memory",
      "audit_token_usage",
      "build_task_plan",
      "check_approach",
      "convert_failure_to_rule",
      "explain_context_selection",
      "find_similar_failures",
      "get_applicable_rules",
      "get_context_budget_report",
      "get_edit_impact",
      "get_project_context",
      "get_project_rules",
      "get_relevant_code_blocks",
      "get_relevant_context",
      "get_relevant_memories",
      "get_task_context",
      "get_task_status",
      "get_warm_start_brief",
      "mega_fetch_chunk",
      "mega_impact",
      "mega_index_memory",
      "mega_memory_from_session",
      "mega_memory_sweep",
      "mega_read_file",
      "mega_recall",
      "mega_run_command",
      "proxy_search_code",
      "record_failed_attempt",
      "record_task_step",
      "retry_failed_step",
      "route_tools_for_task",
      "save_memory",
      "save_project_rule",
      "search_memory",
      "verify_memories",
    ] = mcpToolNameSchema.options;
    void _t;
  });
});
