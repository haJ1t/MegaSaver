import { type CoreRegistry, type ExecResult, runOutputExecCommand } from "@megasaver/core";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";
import { forwardOrFallback } from "./forward.js";

const MAX_BYTES_CEILING = 64_000; // 2 * modeToBudget("safe"), AA1 §8a
const SPAWN_TIMEOUT_MS = 5 * 60 * 1000; // AA1 §8d step 5
const MAX_CAPTURE_FACTOR = 64; // raw capture cap = 64 * maxBytes (AA1 §8d step 5)

export type RunCommandToolEnv = {
  registry: CoreRegistry;
  storeRoot: string;
  now: () => string;
  newId: () => string;
  // AA1 §8d step 3: the resolved MEGASAVER_ORIGIN_PID for this
  // bridge process (own pid if root; inherited if downstream).
  originPid: string;
};

const runCommandInputSchema = z
  .object({
    command: z.string().min(1),
    args: z.array(z.string()).readonly(),
    intent: z.string(),
    sessionId: z.string().min(1),
    maxBytes: z.number().int().positive().optional(),
  })
  .strict();

export async function handleRunCommand(
  env: RunCommandToolEnv,
  rawArgs: unknown,
): Promise<ExecResult> {
  const parsed = runCommandInputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const { command, args, intent, sessionId, maxBytes } = parsed.data;

  if (intent.trim() === "") {
    throw new McpBridgeError("intent_required", "mega_run_command requires a non-empty intent");
  }
  if (maxBytes !== undefined && maxBytes > MAX_BYTES_CEILING) {
    throw new McpBridgeError(
      "max_bytes_exceeded",
      `maxBytes ${maxBytes} exceeds ceiling ${MAX_BYTES_CEILING}`,
    );
  }

  return forwardOrFallback(
    env.storeRoot,
    "/exec-registry",
    { sessionId, command, args, intent, ...(maxBytes !== undefined ? { maxBytes } : {}) },
    async () => {
      // BB7b orchestrator (authoritative: bb7b-output-exec-plan.md Task 1).
      // Owns spawn, env-marker check (AA1 §8d steps 3+5), redact, filterOutput,
      // saveChunkSet, stats. Bridge never spawns — single spawn site.
      // maxBytes here is the raw-capture cap (64x the returned ceiling, AA1 §8d step 5).
      const outcome = await runOutputExecCommand({
        registry: env.registry,
        storeRoot: env.storeRoot,
        sessionId: sessionId as Parameters<typeof runOutputExecCommand>[0]["sessionId"],
        command,
        args,
        intent,
        originPid: env.originPid,
        timeoutMs: SPAWN_TIMEOUT_MS,
        maxBytes: (maxBytes ?? MAX_BYTES_CEILING) * MAX_CAPTURE_FACTOR,
        now: env.now,
        newId: env.newId,
      });

      if (outcome.ok) return outcome.result;
      // Exhaustive over RunOutputExecResult (F1). command_denied carries `code`
      // (PolicyDenyCode), NOT `detail`; no `redaction_failed` — surfaces as `command_failed`.
      switch (outcome.reason) {
        case "session_not_found":
          throw new McpBridgeError("session_not_found", `session not found: ${sessionId}`);
        case "policy_load_failed":
          // Present-but-malformed .megasaver/permissions.yaml. Command NEVER spawned (fail-closed, I3).
          throw new McpBridgeError("policy_load_failed", `policy load failed: ${outcome.detail}`, {
            details: { reason: outcome.detail },
          });
        case "command_denied":
          throw new McpBridgeError("command_denied", `command denied: ${outcome.code}`, {
            details: { reason: outcome.code },
          });
        case "command_failed":
          throw new McpBridgeError("tool_invocation_failed", outcome.detail, {
            cause: new Error(outcome.detail),
          });
        case "store_write_failed":
          throw new McpBridgeError("store_write_failed", outcome.detail);
      }
    },
  );
}
