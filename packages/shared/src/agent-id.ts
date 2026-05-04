import { z } from "zod";

export const agentIdSchema = z.enum(["claude-code", "generic-cli"]);

export type AgentId = z.infer<typeof agentIdSchema>;
