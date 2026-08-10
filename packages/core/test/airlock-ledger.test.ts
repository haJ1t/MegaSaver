import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendRule, clearRules, pruneExpired, readRules } from "../src/airlock-ledger.js";

function rule(overrides: Partial<import("../src/airlock-ledger.js").AirlockNegativeRule> = {}) {
  return {
    ruleId: "airlock-1",
    sessionId: "sess1",
    toolName: "rg",
    forbiddenPattern: "^rg(?:\\s+.*)?--bad(?:\\b|$)",
    reason: "bad",
    createdAt: new Date().toISOString(),
    ttlSeconds: 3600,
    ...overrides,
  };
}

describe("airlock-ledger", () => {
  it("append then read returns rule", async () => {
    const root = mkdtempSync(join(tmpdir(), "airlock-"));
    await appendRule(root, rule());
    const out = await readRules(root, "sess1");
    expect(out.length).toBe(1);
    rmSync(root, { recursive: true, force: true });
  });
  it("expired rule filtered at read time", async () => {
    const root = mkdtempSync(join(tmpdir(), "airlock2-"));
    await appendRule(
      root,
      rule({ createdAt: new Date(Date.now() - 7200 * 1000).toISOString(), ttlSeconds: 3600 }),
    );
    const out = await readRules(root, "sess1");
    expect(out.length).toBe(0);
    rmSync(root, { recursive: true, force: true });
  });
  it("clearRules empties ledger", async () => {
    const root = mkdtempSync(join(tmpdir(), "airlock3-"));
    await appendRule(root, rule());
    await clearRules(root, "sess1");
    expect((await readRules(root, "sess1")).length).toBe(0);
    rmSync(root, { recursive: true, force: true });
  });
  it("pruneExpired returns count", async () => {
    const root = mkdtempSync(join(tmpdir(), "airlock4-"));
    await appendRule(
      root,
      rule({ ruleId: "a", createdAt: new Date(Date.now() - 7200 * 1000).toISOString() }),
    );
    await appendRule(root, rule({ ruleId: "b" }));
    const n = await pruneExpired(root, "sess1");
    expect(n).toBe(1);
    rmSync(root, { recursive: true, force: true });
  });
});
