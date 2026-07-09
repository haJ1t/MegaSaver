// packages/stats/test/budget.test.ts
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type StoredBudget,
  budgetPath,
  budgetStatus,
  clearBudget,
  readBudget,
  storedBudgetSchema,
  writeBudget,
} from "../src/budget.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-budget-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const BUDGET: StoredBudget = { version: 1, period: "month", kind: "dollars", amount: 20 };

describe("budget store — roundtrip", () => {
  it("writeBudget then readBudget returns the same budget", () => {
    writeBudget(root, BUDGET);
    expect(readBudget(root)).toEqual(BUDGET);
    expect(budgetStatus(root)).toBe("ok");
  });

  it("budgetPath is <root>/stats/budget.json and the write creates the dir", () => {
    expect(budgetPath(root)).toBe(join(root, "stats", "budget.json"));
    writeBudget(root, BUDGET);
    expect(JSON.parse(readFileSync(budgetPath(root), "utf8"))).toEqual(BUDGET);
  });

  it("a tokens/week budget roundtrips too", () => {
    const b: StoredBudget = { version: 1, period: "week", kind: "tokens", amount: 5_000_000 };
    writeBudget(root, b);
    expect(readBudget(root)).toEqual(b);
  });
});

describe("budget store — absent vs corrupt", () => {
  it("absent file → readBudget null, status absent", () => {
    expect(readBudget(root)).toBeNull();
    expect(budgetStatus(root)).toBe("absent");
  });

  it("corrupt JSON → readBudget null, status corrupt", () => {
    mkdirSync(join(root, "stats"), { recursive: true });
    writeFileSync(budgetPath(root), "{not json");
    expect(readBudget(root)).toBeNull();
    expect(budgetStatus(root)).toBe("corrupt");
  });

  it("schema-invalid shapes → null/corrupt (wrong version, negative amount, extra key)", () => {
    mkdirSync(join(root, "stats"), { recursive: true });
    for (const bad of [
      { version: 2, period: "month", kind: "dollars", amount: 20 },
      { version: 1, period: "month", kind: "dollars", amount: -5 },
      { version: 1, period: "month", kind: "dollars", amount: 20, extra: true },
      { version: 1, period: "day", kind: "dollars", amount: 20 },
    ]) {
      writeFileSync(budgetPath(root), JSON.stringify(bad));
      expect(readBudget(root)).toBeNull();
      expect(budgetStatus(root)).toBe("corrupt");
    }
  });
});

describe("budget store — clear", () => {
  it("clearBudget removes the file and is idempotent", () => {
    writeBudget(root, BUDGET);
    clearBudget(root);
    expect(budgetStatus(root)).toBe("absent");
    expect(() => clearBudget(root)).not.toThrow(); // second clear: no file, still fine
  });
});

describe("budget schema", () => {
  it("accepts exactly the v1 shape", () => {
    expect(storedBudgetSchema.safeParse(BUDGET).success).toBe(true);
    expect(storedBudgetSchema.safeParse({ ...BUDGET, amount: 0 }).success).toBe(false);
    expect(
      storedBudgetSchema.safeParse({ ...BUDGET, amount: Number.POSITIVE_INFINITY }).success,
    ).toBe(false);
  });
});

describe("budget store — write hardening (surface checks; atomicity itself is", () => {
  // covered by packages/stats/test/atomic-write.test.ts for the shared helper)
  it("overwriting a corrupt file repairs it", () => {
    mkdirSync(join(root, "stats"), { recursive: true });
    writeFileSync(budgetPath(root), "{broken");
    expect(budgetStatus(root)).toBe("corrupt");
    writeBudget(root, BUDGET);
    expect(budgetStatus(root)).toBe("ok");
    expect(readBudget(root)).toEqual(BUDGET);
  });

  it.skipIf(process.platform === "win32")(
    "refuses to write through a symlinked stats dir (StatsError write_failed)",
    () => {
      const target = mkdtempSync(join(tmpdir(), "megasaver-budget-target-"));
      try {
        symlinkSync(target, join(root, "stats"));
        expect(() => writeBudget(root, BUDGET)).toThrow();
        expect(readBudget(root)).toBeNull();
      } finally {
        rmSync(target, { recursive: true, force: true });
      }
    },
  );
});
