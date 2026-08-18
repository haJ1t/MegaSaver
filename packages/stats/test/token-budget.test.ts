import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type StoredTokenBudgets,
  clearTokenBudgets,
  effectiveSessionBudget,
  readTokenBudgets,
  tokenBudgetsPath,
  tokenBudgetsStatus,
  writeTokenBudgets,
} from "../src/token-budget.js";

const WK = "0a1b2c3d4e5f6071";
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-token-budget-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const BUDGETS: StoredTokenBudgets = {
  version: 1,
  sessionDefault: 500_000,
  sessions: { "live-1": 100_000 },
  tasks: { "refactor-auth": 200_000 },
  labels: { "live-1": "refactor-auth", "live-2": "refactor-auth" },
};

describe("token budget store", () => {
  it("roundtrips and lives at stats/<wk>/budget/budgets.json", () => {
    writeTokenBudgets(root, WK, BUDGETS);
    expect(tokenBudgetsPath(root, WK)).toBe(join(root, "stats", WK, "budget", "budgets.json"));
    expect(readTokenBudgets(root, WK)).toEqual(BUDGETS);
    expect(tokenBudgetsStatus(root, WK)).toBe("ok");
  });

  it("absent → null/absent; corrupt JSON → null/corrupt", () => {
    expect(readTokenBudgets(root, WK)).toBeNull();
    expect(tokenBudgetsStatus(root, WK)).toBe("absent");
    mkdirSync(join(root, "stats", WK, "budget"), { recursive: true });
    writeFileSync(tokenBudgetsPath(root, WK), "{not json");
    expect(readTokenBudgets(root, WK)).toBeNull();
    expect(tokenBudgetsStatus(root, WK)).toBe("corrupt");
  });

  it("rejects schema-invalid shapes as corrupt (bad version, negative amount, oversize label, extra key)", () => {
    mkdirSync(join(root, "stats", WK, "budget"), { recursive: true });
    for (const bad of [
      { ...BUDGETS, version: 2 },
      { ...BUDGETS, sessions: { "live-1": -5 } },
      { ...BUDGETS, tasks: { ["x".repeat(65)]: 1000 } },
      { ...BUDGETS, extra: true },
    ]) {
      writeFileSync(tokenBudgetsPath(root, WK), JSON.stringify(bad));
      expect(readTokenBudgets(root, WK)).toBeNull();
      expect(tokenBudgetsStatus(root, WK)).toBe("corrupt");
    }
  });

  it("clearTokenBudgets removes the whole budget dir including state files", () => {
    writeTokenBudgets(root, WK, BUDGETS);
    writeFileSync(join(root, "stats", WK, "budget", "state-live-1.json"), "{}");
    clearTokenBudgets(root, WK);
    expect(tokenBudgetsStatus(root, WK)).toBe("absent");
    expect(readFileSync).toBeDefined();
  });
});

describe("effectiveSessionBudget precedence", () => {
  it("explicit session beats task label beats workspace default", () => {
    expect(effectiveSessionBudget(BUDGETS, "live-1")).toEqual({
      limitTokens: 100_000,
      scope: "session",
    });
    expect(effectiveSessionBudget(BUDGETS, "live-2")).toEqual({
      limitTokens: 200_000,
      scope: "task",
      taskLabel: "refactor-auth",
    });
    expect(effectiveSessionBudget(BUDGETS, "live-3")).toEqual({
      limitTokens: 500_000,
      scope: "workspace-default",
    });
  });

  it("returns null when nothing applies", () => {
    const none: StoredTokenBudgets = { version: 1, sessions: {}, tasks: {}, labels: {} };
    expect(effectiveSessionBudget(none, "live-9")).toBeNull();
  });
});
