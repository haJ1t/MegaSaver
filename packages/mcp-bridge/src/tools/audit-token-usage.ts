import {
  type AuditSummary,
  type CoreRegistry,
  auditWindowSchema,
  readAuditEvents,
  summarizeAudit,
} from "@megasaver/core";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

export type AuditTokenUsageEnv = {
  registry: CoreRegistry;
  storeRoot: string;
  now: () => string;
};

const inputSchema = z
  .object({
    projectId: z.string().min(1),
    sessionId: z.string().min(1).optional(),
    window: z.string().optional(),
  })
  .strict();

export async function handleAuditTokenUsage(
  env: AuditTokenUsageEnv,
  rawArgs: unknown,
): Promise<AuditSummary> {
  const parsed = inputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const { projectId, sessionId } = parsed.data;

  const window = parsed.data.window ?? (sessionId !== undefined ? "session" : "all");
  const parsedWindow = auditWindowSchema.safeParse(window);
  if (!parsedWindow.success) {
    throw new McpBridgeError(
      "validation_failed",
      `invalid window "${window}" (session | week | all)`,
    );
  }
  if (parsedWindow.data === "session" && sessionId === undefined) {
    throw new McpBridgeError("validation_failed", 'window "session" requires a sessionId');
  }

  const project = env.registry.listProjects().find((p) => p.id === (projectId as ProjectId));
  if (!project) {
    throw new McpBridgeError("resource_not_found", `project not found: ${projectId}`);
  }

  try {
    const events = readAuditEvents(
      { root: env.storeRoot },
      projectId as ProjectId,
      parsedWindow.data === "session" ? (sessionId as SessionId) : undefined,
    );
    return summarizeAudit(events, { window: parsedWindow.data, now: env.now });
  } catch (err) {
    throw new McpBridgeError(
      "validation_failed",
      err instanceof Error ? err.message : "audit failed",
    );
  }
}
