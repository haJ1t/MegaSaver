import { describe, it } from "vitest";
import { type McpToolName, mcpToolNameSchema } from "../src/tool-name.js";

describe("McpToolName type regression", () => {
  it("each member is a valid McpToolName", () => {
    const _a: McpToolName = "mega_fetch_chunk";
    const _b: McpToolName = "mega_read_file";
    const _c: McpToolName = "mega_recall";
    const _d: McpToolName = "mega_run_command";
    void _a;
    void _b;
    void _c;
    void _d;
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

  it("schema.options preserves the 4-member alphabetic order (AA1 §8a)", () => {
    const _t: readonly ["mega_fetch_chunk", "mega_read_file", "mega_recall", "mega_run_command"] =
      mcpToolNameSchema.options;
    void _t;
  });
});
