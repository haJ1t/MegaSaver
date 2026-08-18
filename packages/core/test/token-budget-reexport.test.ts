import { describe, expect, it } from "vitest";
import {
  effectiveSessionBudget,
  evaluateBudget,
  foldMeasuredBurn,
  medianOf,
  readTokenBudgetState,
  readTokenBudgets,
  writeTokenBudgetState,
  writeTokenBudgets,
} from "../src/index.js";

describe("core re-exports the token budget surface (§3c pin)", () => {
  it("all runtime symbols resolve through @megasaver/core", () => {
    for (const fn of [
      effectiveSessionBudget,
      evaluateBudget,
      foldMeasuredBurn,
      medianOf,
      readTokenBudgets,
      readTokenBudgetState,
      writeTokenBudgets,
      writeTokenBudgetState,
    ]) {
      expect(typeof fn).toBe("function");
    }
  });
});
