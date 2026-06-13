import {
  type CoreRegistry,
  CoreRegistryError,
  type FailedAttempt,
  failedAttemptSchema,
} from "@megasaver/core";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

export type RecordFailedAttemptEnv = {
  registry: CoreRegistry;
  now: () => string;
  newId: () => string;
};

const inputSchema = z
  .object({
    projectId: z.string().min(1),
    task: z.string().min(1),
    failedStep: z.string().min(1),
    sessionId: z.string().min(1).optional(),
    errorOutput: z.string().min(1).optional(),
    relatedFiles: z.array(z.string()).optional(),
    suspectedCause: z.string().min(1).optional(),
    resolution: z.string().min(1).optional(),
  })
  .strict();

// CoreRegistry failures carry a closed code; surface it as the matching wire code.
function mapCoreError(err: unknown): McpBridgeError {
  if (err instanceof CoreRegistryError) {
    if (err.code === "session_not_found")
      return new McpBridgeError("session_not_found", err.message);
    if (err.code === "project_not_found")
      return new McpBridgeError("resource_not_found", err.message);
    return new McpBridgeError("validation_failed", err.message);
  }
  if (err instanceof Error) return new McpBridgeError("validation_failed", err.message);
  return new McpBridgeError("validation_failed", "record_failed_attempt failed");
}

export async function handleRecordFailedAttempt(
  env: RecordFailedAttemptEnv,
  rawArgs: unknown,
): Promise<{ id: string }> {
  const parsed = inputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const d = parsed.data;

  let attempt: FailedAttempt;
  try {
    attempt = failedAttemptSchema.parse({
      id: env.newId(),
      projectId: d.projectId,
      sessionId: d.sessionId ?? null,
      task: d.task,
      failedStep: d.failedStep,
      relatedFiles: d.relatedFiles ?? [],
      convertedToRule: false,
      createdAt: env.now(),
      ...(d.errorOutput !== undefined ? { errorOutput: d.errorOutput } : {}),
      ...(d.suspectedCause !== undefined ? { suspectedCause: d.suspectedCause } : {}),
      ...(d.resolution !== undefined ? { resolution: d.resolution } : {}),
    });
  } catch (err) {
    throw new McpBridgeError(
      "validation_failed",
      err instanceof Error ? err.message : "invalid failed attempt",
    );
  }

  try {
    const created = env.registry.createFailedAttempt(attempt);
    return { id: created.id };
  } catch (err) {
    throw mapCoreError(err);
  }
}
