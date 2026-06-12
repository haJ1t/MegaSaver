import { describe, expect, it } from "vitest";
import { mcpToolNameSchema } from "../src/tool-name.js";

describe("tool-name enum (phase 6)", () => {
  it("is a closed set of 23 alphabetically-ordered names", () => {
    expect(mcpToolNameSchema.options).toEqual([
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
      "route_tools_for_task",
      "save_memory",
      "save_project_rule",
      "search_memory",
    ]);
  });
});
