import { describe, expect, it } from "vitest";
import { mcpToolNameSchema } from "../src/tool-name.js";

describe("tool-name enum (phase 4)", () => {
  it("is a closed set of 15 alphabetically-ordered names", () => {
    expect(mcpToolNameSchema.options).toEqual([
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
  });
});
