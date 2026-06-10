import { type CoreRegistry, runOutputPipeline } from "@megasaver/core";
import type { FilterOutputResult } from "@megasaver/output-filter";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

const MAX_BYTES_CEILING = 64_000; // 2 * modeToBudget("safe"), AA1 §8a

export type ReadFileToolEnv = {
  registry: CoreRegistry;
  storeRoot: string;
  now: () => string;
  newId: () => string;
};

const readFileInputSchema = z
  .object({
    path: z.string().min(1),
    intent: z.string(),
    sessionId: z.string().min(1),
    maxBytes: z.number().int().positive().optional(),
  })
  .strict();

export async function handleReadFile(
  env: ReadFileToolEnv,
  rawArgs: unknown,
): Promise<FilterOutputResult> {
  const parsed = readFileInputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const { path, intent, sessionId, maxBytes } = parsed.data;

  if (intent.trim() === "") {
    throw new McpBridgeError("intent_required", "mega_read_file requires a non-empty intent");
  }
  if (maxBytes !== undefined && maxBytes > MAX_BYTES_CEILING) {
    throw new McpBridgeError(
      "max_bytes_exceeded",
      `maxBytes ${maxBytes} exceeds ceiling ${MAX_BYTES_CEILING}`,
    );
  }

  const outcome = await runOutputPipeline({
    registry: env.registry,
    storeRoot: env.storeRoot,
    sessionId: sessionId as Parameters<typeof runOutputPipeline>[0]["sessionId"],
    path,
    intent,
    now: env.now,
    newId: env.newId,
  });

  if (outcome.ok) return outcome.result;
  switch (outcome.reason) {
    case "session_not_found":
      throw new McpBridgeError("session_not_found", `session not found: ${sessionId}`);
    case "policy_load_failed":
      // A present-but-malformed .megasaver/permissions.yaml. The file was
      // NEVER read — the gate shut before IO (fail-closed, I3).
      throw new McpBridgeError("policy_load_failed", `policy load failed: ${outcome.detail}`, {
        details: { reason: outcome.detail },
      });
    case "path_denied":
      throw new McpBridgeError("path_denied", outcome.detail, {
        details: { reason: outcome.detail },
      });
    case "path_unsafe":
      throw new McpBridgeError("validation_failed", outcome.detail);
    case "file_read_failed":
      throw new McpBridgeError("tool_invocation_failed", outcome.detail, {
        cause: new Error(outcome.detail),
      });
    case "store_write_failed":
      throw new McpBridgeError("store_write_failed", outcome.detail, {
        cause: new Error(outcome.detail),
      });
  }
}
