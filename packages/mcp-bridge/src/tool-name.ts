import { z } from "zod";

// Order: alphabetic (AA1 §8a, §17). Closed set of the MCP tools the
// Mega Saver bridge exposes over the wire. proxy_search_code (Proxy
// Mode v1.2 §9) is a NEW tool with no mega_* twin — it is already a
// proxy_* name and keeps it in both naming modes.
export const mcpToolNameSchema = z.enum([
  "mega_fetch_chunk",
  "mega_read_file",
  "mega_recall",
  "mega_run_command",
  "proxy_search_code",
]);

export type McpToolName = z.infer<typeof mcpToolNameSchema>;
