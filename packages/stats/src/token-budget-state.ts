import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { isSafeSegment } from "./safe-segment.js";
import type { BudgetAnnouncements } from "./token-budget-burn.js";

export const tokenBudgetStateSchema = z
  .object({
    version: z.literal(1),
    burnTokens: z.number().int().nonnegative(),
    measuredEvents: z.number().int().nonnegative(),
    unmeasuredEvents: z.number().int().nonnegative(),
    announced: z
      .object({
        warn80: z.boolean(),
        warn100: z.boolean(),
        variance: z.boolean(),
      })
      .strict(),
    pendingLines: z.array(z.string()).max(8),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type TokenBudgetState = {
  version: 1;
  burnTokens: number;
  measuredEvents: number;
  unmeasuredEvents: number;
  announced: BudgetAnnouncements;
  pendingLines: string[];
  updatedAt: string;
};

export function tokenBudgetStatePath(
  root: string,
  workspaceKey: string,
  liveSessionId: string,
): string | null {
  if (!isSafeSegment(liveSessionId) || !isSafeSegment(workspaceKey)) return null;
  return join(root, "stats", workspaceKey, "budget", `state-${liveSessionId}.json`);
}

export function readTokenBudgetState(
  root: string,
  workspaceKey: string,
  liveSessionId: string,
): TokenBudgetState | null {
  const p = tokenBudgetStatePath(root, workspaceKey, liveSessionId);
  if (p === null) return null;
  let raw: string;
  try {
    raw = readFileSync(p, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const res = tokenBudgetStateSchema.safeParse(parsed);
  return res.success ? (res.data as TokenBudgetState) : null;
}

export function writeTokenBudgetState(
  root: string,
  workspaceKey: string,
  liveSessionId: string,
  state: TokenBudgetState,
): void {
  const p = tokenBudgetStatePath(root, workspaceKey, liveSessionId);
  if (p === null) return;
  const dir = dirname(p);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") {
    try {
      chmodSync(dir, 0o700);
    } catch {
      // ignore
    }
  }
  const tmp = `${p}.${randomBytes(6).toString("hex")}.tmp`;
  const content = `${JSON.stringify(state)}\n`;
  try {
    writeFileSync(tmp, content, { mode: 0o600 });
    renameSync(tmp, p);
  } catch {
    // ignore
  }
}
