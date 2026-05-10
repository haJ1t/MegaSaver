import { z } from "zod";

// Order: launch-order. stdio is the MCP reference transport and
// the first v0.4 target; sse is the multi-client follow-up. Do not
// alphabetize — preserve the "ship stdio first" reading order.
export const mcpTransportSchema = z.enum(["stdio", "sse"]);

export type McpTransport = z.infer<typeof mcpTransportSchema>;
