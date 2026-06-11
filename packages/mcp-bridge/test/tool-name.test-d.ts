import { describe, it } from "vitest";
import { type McpToolName, mcpToolNameSchema } from "../src/tool-name.js";

describe("McpToolName type regression", () => {
  it("each member is a valid McpToolName", () => {
    const _a: McpToolName = "mega_fetch_chunk";
    const _b: McpToolName = "mega_read_file";
    const _c: McpToolName = "mega_recall";
    const _d: McpToolName = "mega_run_command";
    const _e: McpToolName = "save_memory";
    const _f: McpToolName = "search_memory";
    const _g: McpToolName = "get_relevant_memories";
    void _a;
    void _b;
    void _c;
    void _d;
    void _e;
    void _f;
    void _g;
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

  it("schema.options preserves the 7-member alphabetic order (AA1 §8a + Phase 1)", () => {
    const _t: readonly [
      "get_relevant_memories",
      "mega_fetch_chunk",
      "mega_read_file",
      "mega_recall",
      "mega_run_command",
      "save_memory",
      "search_memory",
    ] = mcpToolNameSchema.options;
    void _t;
  });
});
