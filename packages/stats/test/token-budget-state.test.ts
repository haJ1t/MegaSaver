import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type TokenBudgetState,
  readTokenBudgetState,
  tokenBudgetStatePath,
  writeTokenBudgetState,
} from "../src/token-budget-state.js";

const WK = "0a1b2c3d4e5f6071";
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-token-budget-state-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const STATE: TokenBudgetState = {
  version: 1,
  burnTokens: 850,
  measuredEvents: 3,
  unmeasuredEvents: 1,
  announced: { warn80: true, warn100: false, variance: false },
  pendingLines: ["[Mega Saver budget] at 85% of budget"],
  updatedAt: "2026-08-06T10:00:00.000Z",
};

describe("token budget state", () => {
  it("roundtrips and lives at stats/<wk>/budget/state-<session>.json", () => {
    writeTokenBudgetState(root, WK, "live-1", STATE);
    expect(tokenBudgetStatePath(root, WK, "live-1")).toBe(
      join(root, "stats", WK, "budget", "state-live-1.json"),
    );
    expect(readTokenBudgetState(root, WK, "live-1")).toEqual(STATE);
  });

  it("unsafe session id returns null path and writes nothing", () => {
    expect(tokenBudgetStatePath(root, WK, "../evil")).toBeNull();
    writeTokenBudgetState(root, WK, "../evil", STATE);
    expect(readdirSync(root).length).toBe(0);
    expect(readTokenBudgetState(root, WK, "../evil")).toBeNull();
  });

  it("corrupt/absent/schema-invalid returns null", () => {
    expect(readTokenBudgetState(root, WK, "live-1")).toBeNull();
    writeTokenBudgetState(root, WK, "live-1", {
      ...STATE,
      // @ts-expect-error invalid pendingLines length
      pendingLines: Array.from({ length: 9 }, (_, i) => `line ${i}`),
    });
    expect(readTokenBudgetState(root, WK, "live-1")).toBeNull();
  });

  it("writes with 0600 file mode and 0700 dir mode on POSIX", () => {
    if (process.platform === "win32") return;
    writeTokenBudgetState(root, WK, "live-1", STATE);
    const filePath = tokenBudgetStatePath(root, WK, "live-1");
    expect(filePath).not.toBeNull();
    if (filePath) {
      const fileStat = statSync(filePath);
      expect(fileStat.mode & 0o777).toBe(0o600);
      const dirStat = statSync(join(root, "stats", WK, "budget"));
      expect(dirStat.mode & 0o777).toBe(0o700);
    }
  });
});
