import { describe, expect, it } from "vitest";
import { mcpToolNameSchema } from "../src/tool-name.js";

describe("tool-name enum (phase 4)", () => {
  it("contains all 15 Phase 4 names (now 18 total with Phase 5 FORGE tools)", () => {
    const opts = mcpToolNameSchema.options;
    expect(opts).toContain("explain_context_selection");
    expect(opts).toContain("get_context_budget_report");
    expect(opts).toContain("get_project_context");
    expect(opts).toContain("get_project_rules");
    expect(opts).toContain("get_relevant_code_blocks");
    expect(opts).toContain("get_relevant_context");
    expect(opts).toContain("get_relevant_memories");
    expect(opts).toContain("mega_fetch_chunk");
    expect(opts).toContain("mega_read_file");
    expect(opts).toContain("mega_recall");
    expect(opts).toContain("mega_run_command");
    expect(opts).toContain("record_failed_attempt");
    expect(opts).toContain("save_memory");
    expect(opts).toContain("save_project_rule");
    expect(opts).toContain("search_memory");
  });
});
