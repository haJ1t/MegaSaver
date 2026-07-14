import type { CoreRegistry, FailedAttempt } from "@megasaver/core";
import { estimateTokens } from "@megasaver/output-filter";
import type { ProjectId } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

export type CheckApproachEnv = {
  registry: CoreRegistry;
  now: () => string;
  isPro: boolean;
};

const inputSchema = z
  .object({
    projectId: z.string().min(1),
    description: z.string().min(1),
    files: z.array(z.string()).optional(),
  })
  .strict();

const FREE_WINDOW_MS = 7 * 86_400_000;
const MAX_MATCHES = 5;
export const CHECK_APPROACH_UPSELL =
  "Free tier searches the last 7 days of failures. Full history: Mega Saver Pro — mega license activate <key>.";

export type CheckApproachMatch = {
  id: string;
  task: string;
  failedStep: string;
  suspectedCause?: string;
  resolution?: string;
  createdAt: string;
  estimatedWasteTokens?: number;
};

export type CheckApproachResult = { matches: CheckApproachMatch[]; upsell?: string };

function pathsIntersect(files: readonly string[], relatedFiles: readonly string[]): boolean {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/^\.\//, "");
  return files.some((f) =>
    relatedFiles.some((rel) => {
      const a = norm(f);
      const b = norm(rel);
      const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
      return longer === shorter || longer.endsWith(`/${shorter}`);
    }),
  );
}

function toMatch(a: FailedAttempt): CheckApproachMatch {
  return {
    id: a.id,
    task: a.task,
    failedStep: a.failedStep,
    ...(a.suspectedCause !== undefined ? { suspectedCause: a.suspectedCause } : {}),
    ...(a.resolution !== undefined ? { resolution: a.resolution } : {}),
    createdAt: a.createdAt,
    ...(a.errorOutput !== undefined ? { estimatedWasteTokens: estimateTokens(a.errorOutput) } : {}),
  };
}

// Cross-agent pre-flight check (spec §6): BM25 over the failed-attempt corpus
// plus optional relatedFiles narrowing. Free tier sees the last 7 days only —
// the SAME cap applied to find_similar_failures, so neither tool bypasses the
// other.
export async function handleCheckApproach(
  env: CheckApproachEnv,
  rawArgs: unknown,
): Promise<CheckApproachResult> {
  const parsed = inputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const projectId = parsed.data.projectId as ProjectId;
  if (env.registry.getProject(projectId) === null) {
    throw new McpBridgeError("resource_not_found", `project not found: ${projectId}`);
  }
  let hits = env.registry.searchFailedAttempts(projectId, {
    text: parsed.data.description,
    limit: MAX_MATCHES * 2,
  });
  if (parsed.data.files !== undefined && parsed.data.files.length > 0) {
    const files = parsed.data.files;
    hits = hits.filter((a) => a.relatedFiles.length > 0 && pathsIntersect(files, a.relatedFiles));
  }
  if (!env.isPro) {
    const cutoff = Date.parse(env.now()) - FREE_WINDOW_MS;
    hits = hits.filter((a) => Date.parse(a.createdAt) >= cutoff);
  }
  const matches = hits.slice(0, MAX_MATCHES).map(toMatch);
  return env.isPro ? { matches } : { matches, upsell: CHECK_APPROACH_UPSELL };
}
