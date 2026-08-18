import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { atomicWriteFile } from "./atomic-write.js";

export const TOKEN_BUDGET_LABEL_MAX = 64;

const limitField = z.number().int().positive();
const labelField = z.string().min(1).max(TOKEN_BUDGET_LABEL_MAX);

export const storedTokenBudgetsSchema = z
  .object({
    version: z.literal(1),
    sessionDefault: limitField.optional(),
    sessions: z.record(z.string().min(1), limitField),
    tasks: z.record(labelField, limitField),
    labels: z.record(z.string().min(1), labelField),
  })
  .strict();

export type StoredTokenBudgets = z.infer<typeof storedTokenBudgetsSchema>;

export function tokenBudgetsPath(root: string, workspaceKey: string): string {
  return join(root, "stats", workspaceKey, "budget", "budgets.json");
}

export function readTokenBudgets(root: string, workspaceKey: string): StoredTokenBudgets | null {
  let raw: string;
  try {
    raw = readFileSync(tokenBudgetsPath(root, workspaceKey), "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = storedTokenBudgetsSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

export function tokenBudgetsStatus(
  root: string,
  workspaceKey: string,
): "absent" | "ok" | "corrupt" {
  if (!existsSync(tokenBudgetsPath(root, workspaceKey))) return "absent";
  return readTokenBudgets(root, workspaceKey) === null ? "corrupt" : "ok";
}

export function writeTokenBudgets(
  root: string,
  workspaceKey: string,
  budgets: StoredTokenBudgets,
): void {
  atomicWriteFile(tokenBudgetsPath(root, workspaceKey), `${JSON.stringify(budgets)}\n`);
}

export function clearTokenBudgets(root: string, workspaceKey: string): void {
  rmSync(dirname(tokenBudgetsPath(root, workspaceKey)), {
    recursive: true,
    force: true,
  });
}

export type BudgetScope = "session" | "task" | "workspace-default";
export type EffectiveBudget = {
  limitTokens: number;
  scope: BudgetScope;
  taskLabel?: string | undefined;
};

export function effectiveSessionBudget(
  budgets: StoredTokenBudgets,
  liveSessionId: string,
): EffectiveBudget | null {
  const explicit = budgets.sessions[liveSessionId];
  if (explicit !== undefined) return { limitTokens: explicit, scope: "session" };
  const label = budgets.labels[liveSessionId];
  if (label !== undefined) {
    const taskLimit = budgets.tasks[label];
    if (taskLimit !== undefined) {
      return { limitTokens: taskLimit, scope: "task", taskLabel: label };
    }
  }
  if (budgets.sessionDefault !== undefined) {
    return { limitTokens: budgets.sessionDefault, scope: "workspace-default" };
  }
  return null;
}
