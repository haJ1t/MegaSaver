import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendRule } from "@megasaver/core";
import { describe, expect, it } from "vitest";
import { runFirewallAirlockClear, runFirewallAirlockList } from "../../src/commands/firewall.js";

describe("mega firewall airlock", () => {
  it("list --json returns active rules", async () => {
    const store = mkdtempSync(join(tmpdir(), "fw-air-"));
    await appendRule(store, {
      ruleId: "airlock-1",
      sessionId: "sess1",
      toolName: "rg",
      forbiddenPattern: "^rg(?:\\s+.*)?--bad(?:\\b|$)",
      reason: "bad",
      createdAt: new Date().toISOString(),
      ttlSeconds: 3600,
    });
    const lines: string[] = [];
    await runFirewallAirlockList({
      storeRoot: store,
      sessionId: "sess1",
      json: true,
      stdout: (l) => lines.push(l),
      stderr: () => {},
    });
    expect(JSON.parse(lines.join(""))).toHaveLength(1);
    rmSync(store, { recursive: true, force: true });
  });
  it("clear empties ledger", async () => {
    const store = mkdtempSync(join(tmpdir(), "fw-air2-"));
    await appendRule(store, {
      ruleId: "airlock-1",
      sessionId: "sess1",
      toolName: "rg",
      forbiddenPattern: "^rg",
      reason: "x",
      createdAt: new Date().toISOString(),
      ttlSeconds: 3600,
    });
    await runFirewallAirlockClear({
      storeRoot: store,
      sessionId: "sess1",
      stdout: () => {},
      stderr: () => {},
    });
    const lines: string[] = [];
    await runFirewallAirlockList({
      storeRoot: store,
      sessionId: "sess1",
      json: true,
      stdout: (l) => lines.push(l),
      stderr: () => {},
    });
    expect(JSON.parse(lines.join(""))).toHaveLength(0);
    rmSync(store, { recursive: true, force: true });
  });
});
