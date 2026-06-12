import { type CoreRegistry, CoreRegistryError, type ToolRouteResult } from "@megasaver/core";
import type { ProjectId } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

export type RouteToolsForTaskEnv = { registry: CoreRegistry };

const inputSchema = z
  .object({
    projectId: z.string().min(1),
    task: z.string().optional(),
  })
  .strict();

export type RouteToolsForTaskResult = ToolRouteResult;

function mapCoreError(err: unknown): McpBridgeError {
  if (err instanceof CoreRegistryError) {
    if (err.code === "project_not_found") {
      return new McpBridgeError("resource_not_found", err.message);
    }
    return new McpBridgeError("validation_failed", err.message);
  }
  if (err instanceof Error) return new McpBridgeError("validation_failed", err.message);
  return new McpBridgeError("validation_failed", "route_tools_for_task failed");
}

export async function handleRouteToolsForTask(
  env: RouteToolsForTaskEnv,
  rawArgs: unknown,
): Promise<RouteToolsForTaskResult> {
  const parsed = inputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  try {
    return env.registry.routeToolsForTask(parsed.data.projectId as ProjectId, parsed.data.task);
  } catch (err) {
    throw mapCoreError(err);
  }
}
