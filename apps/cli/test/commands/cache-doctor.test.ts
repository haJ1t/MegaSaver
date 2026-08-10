import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TokenSaverEvent } from "@megasaver/core";
import { describe, expect, it } from "vitest";
import { runCacheDoctor } from "../../src/commands/cache-doctor.js";

function evt(id: string, savingRatio: number): TokenSaverEvent {
  return {
    id,
    sessionId: "s1",
    workspaceKey: "w1",
    createdAt: "2026-08-10T10:00:00.000Z",
    sourceKind: "Bash",
    label: "rg",
    rawBytes: 1000,
    returnedBytes: 200,
    bytesSaved: 800,
    savingRatio,
    summary: "x",
  } as unknown as TokenSaverEvent;
}

describe("mega cache-doctor", () => {
  it("--json returns CacheChurnResult shape", async () => {
    const store = mkdtempSync(join(tmpdir(), "cli-cache-"));
    const lines: string[] = [];
    const code = await runCacheDoctor({
      storeRoot: store,
      json: true,
      readEvents: () => [evt("a", 0.8), evt("b", 0.1)],
      stdout: (l) => lines.push(l),
      stderr: () => {},
    });
    expect(code).toBe(0);
    const out = JSON.parse(lines.join(""));
    expect(out).toHaveProperty("cacheInvalidationRate");
    expect(out).toHaveProperty("netSavingsUsd");
    expect(out).toHaveProperty("recommendation");
    rmSync(store, { recursive: true, force: true });
  });

  it("empty store --json returns zero rate", async () => {
    const store = mkdtempSync(join(tmpdir(), "cli-cache2-"));
    const lines: string[] = [];
    await runCacheDoctor({
      storeRoot: store,
      json: true,
      readEvents: () => [],
      stdout: (l) => lines.push(l),
      stderr: () => {},
    });
    expect(JSON.parse(lines.join(""))).toMatchObject({
      cacheInvalidationRate: 0,
      recommendation: "keep_enabled",
    });
    rmSync(store, { recursive: true, force: true });
  });

  it("human table contains recommendation", async () => {
    const store = mkdtempSync(join(tmpdir(), "cli-cache3-"));
    const lines: string[] = [];
    await runCacheDoctor({
      storeRoot: store,
      json: false,
      readEvents: () => [evt("a", 0.8)],
      stdout: (l) => lines.push(l),
      stderr: () => {},
    });
    expect(lines.join("\n")).toMatch(/keep_enabled|increase_floor|bypass_compression/);
    rmSync(store, { recursive: true, force: true });
  });
});
