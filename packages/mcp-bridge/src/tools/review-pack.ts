import type { CoreRegistry } from "@megasaver/core";
import {
  type ReviewPack,
  ReviewPackError,
  buildReviewPack,
} from "@megasaver/review-pack";
import { projectIdSchema } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

export type ReviewPackToolEnv = { registry: CoreRegistry; storeRoot: string };

export const reviewPackInputSchema = z
  .object({
    projectId: z.string().min(1),
    range: z.string().optional(),
  })
  .strict();

export type ReviewPackToolResult = ReviewPack;

export async function handleReviewPack(
  env: ReviewPackToolEnv,
  rawArgs: unknown,
): Promise<ReviewPackToolResult> {
  const parsed = reviewPackInputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const pId = projectIdSchema.safeParse(parsed.data.projectId);
  if (!pId.success) {
    throw new McpBridgeError(
      "validation_failed",
      `invalid projectId: ${parsed.data.projectId}`,
    );
  }
  const project = env.registry.getProject(pId.data);
  if (!project) {
    throw new McpBridgeError(
      "resource_not_found",
      `project not found: ${parsed.data.projectId}`,
    );
  }

  try {
    return await buildReviewPack({
      repoRoot: project.rootPath,
      storeRoot: env.storeRoot,
      range: parsed.data.range,
      resolveProjectId: () => pId.data,
    });
  } catch (err) {
    if (err instanceof ReviewPackError) {
      if (err.code === "store_write_failed") {
        throw new McpBridgeError("store_write_failed", err.message, { cause: err });
      }
      throw new McpBridgeError("tool_invocation_failed", err.message, { cause: err });
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new McpBridgeError("tool_invocation_failed", message, { cause: err });
  }
}
