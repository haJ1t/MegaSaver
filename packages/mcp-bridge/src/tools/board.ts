import { postFact, readBoardFacts, resolveFact } from "@megasaver/mesh";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

const safeSegment = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export const boardPostInputSchema = z
  .object({
    text: z.string().trim().min(1).max(4000),
    topic: z.string().trim().min(1),
    confidence: z.enum(["low", "medium", "high"]).optional().default("medium"),
    scope: z
      .object({
        repo: z.string().trim().min(1),
        paths: z.array(z.string().min(1).max(1024)).optional(),
      })
      .strict(),
    expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
    liveSessionId: z.string().regex(safeSegment, "unsafe liveSessionId"),
  })
  .strict();

export const boardListInputSchema = z
  .object({
    repo: z.string().optional(),
    topic: z.string().optional(),
    status: z.enum(["active", "disputed", "resolved"]).optional(),
  })
  .strict();

export const boardResolveInputSchema = z
  .object({
    factId: z.string().min(1),
    note: z.string().optional(),
  })
  .strict();

export type BoardStoreEnv = { storeRoot: string };

export async function handleBoardPost(
  env: BoardStoreEnv,
  rawArgs: unknown,
): Promise<{ fact: unknown }> {
  const parsed = boardPostInputSchema.safeParse(rawArgs);
  if (!parsed.success) throw new McpBridgeError("validation_failed", parsed.error.message);
  try {
    const fact = postFact(env.storeRoot, {
      text: parsed.data.text,
      topic: parsed.data.topic,
      confidence: parsed.data.confidence as "low" | "medium" | "high",
      scope: {
        repo: parsed.data.scope.repo,
        ...(parsed.data.scope.paths ? { paths: parsed.data.scope.paths } : {}),
      },
      expiresAt: parsed.data.expiresAt ?? null,
      liveSessionId: parsed.data.liveSessionId,
    });
    return { fact };
  } catch (err) {
    throw new McpBridgeError(
      "validation_failed",
      err instanceof Error ? err.message : "board_post failed",
    );
  }
}

export async function handleBoardList(
  env: BoardStoreEnv,
  rawArgs: unknown,
): Promise<{ facts: unknown[] }> {
  const parsed = boardListInputSchema.safeParse(rawArgs);
  if (!parsed.success) throw new McpBridgeError("validation_failed", parsed.error.message);
  try {
    const facts = readBoardFacts(env.storeRoot, {
      ...(parsed.data.repo !== undefined ? { repo: parsed.data.repo } : {}),
      ...(parsed.data.topic !== undefined ? { topic: parsed.data.topic } : {}),
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
    });
    return { facts };
  } catch (err) {
    throw new McpBridgeError(
      "validation_failed",
      err instanceof Error ? err.message : "board_list failed",
    );
  }
}

export async function handleBoardResolve(
  env: BoardStoreEnv,
  rawArgs: unknown,
): Promise<{ ok: boolean }> {
  const parsed = boardResolveInputSchema.safeParse(rawArgs);
  if (!parsed.success) throw new McpBridgeError("validation_failed", parsed.error.message);
  try {
    resolveFact(env.storeRoot, parsed.data.factId, parsed.data.note);
    return { ok: true };
  } catch (err) {
    throw new McpBridgeError(
      "validation_failed",
      err instanceof Error ? err.message : "board_resolve failed",
    );
  }
}
