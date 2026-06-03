import { z } from "zod";

// Order: alphabetic (AA1 §8a, §17). Closed set — the four MCP
// tools the Mega Saver bridge exposes over the wire.
export const mcpToolNameSchema = z.enum([
  "mega_fetch_chunk",
  "mega_read_file",
  "mega_recall",
  "mega_run_command",
]);

export type McpToolName = z.infer<typeof mcpToolNameSchema>;
