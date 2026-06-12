import {
  type AuditSummary,
  type CoreRegistry,
  StatsError,
  auditWindowSchema,
  readAuditEvents,
  resolveAuditWindow,
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

  let requestedWindow: ReturnType<typeof auditWindowSchema.parse> | undefined;
  if (parsed.data.window !== undefined) {
    const parsedWindow = auditWindowSchema.safeParse(parsed.data.window);
    if (!parsedWindow.success) {
      throw new McpBridgeError(
        "validation_failed",
        `invalid window "${parsed.data.window}" (session | week | all)`,
      );
    }
    requestedWindow = parsedWindow.data;
  }
  const window = resolveAuditWindow(requestedWindow, sessionId !== undefined);
  if (window === "session" && sessionId === undefined) {
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
      window === "session" ? (sessionId as SessionId) : undefined,
    );
    return summarizeAudit(events, { window, now: env.now });
  } catch (err) {
    if (err instanceof StatsError && err.code === "store_corrupt") {
      throw new McpBridgeError("validation_failed", `audit store corrupt: ${err.message}`);
    }
    throw new McpBridgeError(
      "validation_failed",
      err instanceof Error ? err.message : "audit failed",
    );
  }
}
