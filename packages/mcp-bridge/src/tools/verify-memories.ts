import { type CoreRegistry, type VerifyPlan, runVerify } from "@megasaver/core";
import type { ProjectId } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

export type VerifyMemoriesEnv = {
  registry: CoreRegistry;
  now: () => string;
  isPro: boolean;
  // Injectable git runner threaded into runVerify for hermetic tests.
  execGit?: (args: string[], cwd: string) => string;
};

// Exit-0 precedent (savings history): a locked feature is a normal state, not
// an error — free tier gets the upsell payload and NO Pro compute runs.
export const VERIFY_MEMORIES_UPSELL =
  "Agent-triggered memory verification is Mega Saver Pro — mega license activate <key>. Free tier: run `mega memory verify <projectId>` manually.";

const inputSchema = z.object({ projectId: z.string().min(1) }).strict();

export type VerifyMemoriesResult = VerifyPlan | { upsell: string };

// Thin alias over core's runVerify (i6 §8.6): same JSON shape as the CLI
// --json output. Deterministic from repo state — an agent cannot ask for a
// close, only trigger a look at reality.
export async function handleVerifyMemories(
  env: VerifyMemoriesEnv,
  rawArgs: unknown,
): Promise<VerifyMemoriesResult> {
  const parsed = inputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  if (!env.isPro) return { upsell: VERIFY_MEMORIES_UPSELL };
  const projectId = parsed.data.projectId as ProjectId;
  const project = env.registry.getProject(projectId);
  if (project === null) {
    throw new McpBridgeError("resource_not_found", `project not found: ${projectId}`);
  }
  return runVerify({
    registry: env.registry,
    projectId,
    rootPath: project.rootPath,
    now: env.now(),
    ...(env.execGit !== undefined ? { execGit: env.execGit } : {}),
  });
}
