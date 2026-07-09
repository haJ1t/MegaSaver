// packages/stats/src/budget.ts
// Persistent savings budget (1.13): one store-wide config file at
// stats/budget.json. Corrupt is distinguished from absent (the license.json
// precedent) so the CLI can report honestly instead of silently ignoring a
// broken file the user thinks is active.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { atomicWriteFile } from "./atomic-write.js";

export const storedBudgetSchema = z
  .object({
    version: z.literal(1),
    period: z.enum(["month", "week"]),
    kind: z.enum(["tokens", "dollars"]),
    amount: z.number().finite().positive(),
  })
  .strict();

export type StoredBudget = z.infer<typeof storedBudgetSchema>;

export function budgetPath(root: string): string {
  return join(root, "stats", "budget.json");
}

export function readBudget(root: string): StoredBudget | null {
  let raw: string;
  try {
    raw = readFileSync(budgetPath(root), "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = storedBudgetSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

export function budgetStatus(root: string): "absent" | "ok" | "corrupt" {
  if (!existsSync(budgetPath(root))) return "absent";
  return readBudget(root) === null ? "corrupt" : "ok";
}

export function writeBudget(root: string, budget: StoredBudget): void {
  atomicWriteFile(budgetPath(root), `${JSON.stringify(budget)}\n`);
}

export function clearBudget(root: string): void {
  rmSync(budgetPath(root), { force: true });
}
