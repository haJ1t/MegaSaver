import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type StoredTokenBudgets, readTokenBudgetState, writeTokenBudgets } from "@megasaver/core";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BUDGET_HISTORY_SESSION_CAP,
  maybeReadBudgetWarning,
  refreshBudgetState,
} from "../../src/hooks/budget-run.js";

const WK = encodeWorkspaceKey("/test/proj");
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-budget-run-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function seedOverlayEvent(
  storeRoot: string,
  workspaceKey: string,
  liveSessionId: string,
  event: Record<string, unknown>,
): void {
  const dir = join(storeRoot, "stats", workspaceKey);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, `${liveSessionId}.events.jsonl`);
  const full = {
    id: `ove-${Math.random()}`,
    liveSessionId,
    workspaceKey,
    createdAt: "2026-08-06T10:00:00.000+00:00",
    sourceKind: "command",
    label: "test",
    rawBytes: 1000,
    returnedBytes: 100,
    bytesSaved: 900,
    savingRatio: 0.9,
    summary: "s",
    ...event,
  };
  appendFileSync(p, `${JSON.stringify(full)}\n`);
}

describe("budget-run hook helper", () => {
  it("no budgets.json → refresh writes nothing; readWarning returns undefined", () => {
    refreshBudgetState({ storeRoot: root, workspaceKey: WK, liveSessionId: "live-1" });
    expect(maybeReadBudgetWarning(root, WK, "live-1")).toBeUndefined();
  });

  it("budget 1000, 850 measured → warns 80%, dedupes on next refresh, exceeds at 1000", () => {
    const budgets: StoredTokenBudgets = {
      version: 1,
      sessionDefault: 1000,
      sessions: {},
      tasks: {},
      labels: {},
    };
    writeTokenBudgets(root, WK, budgets);
    seedOverlayEvent(root, WK, "live-1", { returnedTokens: 850 });

    refreshBudgetState({ storeRoot: root, workspaceKey: WK, liveSessionId: "live-1" });
    const warn = maybeReadBudgetWarning(root, WK, "live-1");
    expect(warn).toBeDefined();
    expect(warn).toContain("80%");

    const state1 = readTokenBudgetState(root, WK, "live-1");
    expect(state1?.announced.warn80).toBe(true);

    // Next refresh without new events: pendingLines becomes empty, readWarning is undefined
    refreshBudgetState({ storeRoot: root, workspaceKey: WK, liveSessionId: "live-1" });
    expect(maybeReadBudgetWarning(root, WK, "live-1")).toBeUndefined();

    // Add another event to reach 1050 (>= 1000)
    seedOverlayEvent(root, WK, "live-1", { returnedTokens: 200 });
    refreshBudgetState({ storeRoot: root, workspaceKey: WK, liveSessionId: "live-1" });
    const exceeded = maybeReadBudgetWarning(root, WK, "live-1");
    expect(exceeded).toBeDefined();
    expect(exceeded).toContain("EXCEEDED");
  });

  it("variance alarm fires with >= 3 sibling samples and >= 3x median", () => {
    expect(BUDGET_HISTORY_SESSION_CAP).toBe(20);
    const budgets: StoredTokenBudgets = {
      version: 1,
      sessions: {},
      tasks: { auth: 1_000_000 },
      labels: {
        "live-1": "auth",
        "live-2": "auth",
        "live-3": "auth",
        "live-4": "auth",
      },
    };
    writeTokenBudgets(root, WK, budgets);
    seedOverlayEvent(root, WK, "live-2", { returnedTokens: 40 });
    seedOverlayEvent(root, WK, "live-3", { returnedTokens: 50 });
    seedOverlayEvent(root, WK, "live-4", { returnedTokens: 48 });
    seedOverlayEvent(root, WK, "live-1", { returnedTokens: 150 });

    refreshBudgetState({ storeRoot: root, workspaceKey: WK, liveSessionId: "live-1" });
    const warn = maybeReadBudgetWarning(root, WK, "live-1");
    expect(warn).toBeDefined();
    expect(warn).toContain("variance alarm");
  });

  it("corrupt budgets.json → fail-open, no throw, no warning", () => {
    mkdirSync(join(root, "stats", WK, "budget"), { recursive: true });
    writeFileSync(join(root, "stats", WK, "budget", "budgets.json"), "invalid json");
    expect(() =>
      refreshBudgetState({ storeRoot: root, workspaceKey: WK, liveSessionId: "live-1" }),
    ).not.toThrow();
    expect(maybeReadBudgetWarning(root, WK, "live-1")).toBeUndefined();
  });

  it("unsafe liveSessionId is ignored", () => {
    expect(() =>
      refreshBudgetState({ storeRoot: root, workspaceKey: WK, liveSessionId: "../evil" }),
    ).not.toThrow();
    expect(maybeReadBudgetWarning(root, WK, "../evil")).toBeUndefined();
  });

  it("hot path sync guard: maybeReadBudgetWarning is synchronous and does not write", () => {
    const res = maybeReadBudgetWarning(root, WK, "live-1");
    expect(res).not.toBeInstanceOf(Promise);
    const before = readdirSync(root, { recursive: true });
    maybeReadBudgetWarning(root, WK, "live-1");
    const after = readdirSync(root, { recursive: true });
    expect(after).toEqual(before);
  });
});
