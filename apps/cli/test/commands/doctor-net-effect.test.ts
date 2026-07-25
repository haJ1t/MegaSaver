import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readNetEffectRecord } from "@megasaver/context-gate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { refreshNetEffectVerdicts } from "../../src/commands/doctor-saver.js";

let store: string;
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "mega-doctor-ne-"));
});
afterEach(() => rmSync(store, { recursive: true, force: true }));

const NOW = "2026-07-19T12:00:00.000Z";

// A valid overlay event line. sourceKind/mode must be members of the
// overlayTokenSaverEventSchema enums (output-source + token-saver-mode).
function overlayEvent(wk: string, sid: string, bytesSaved: number): object {
  return {
    id: "e1",
    liveSessionId: sid,
    workspaceKey: wk,
    createdAt: NOW,
    sourceKind: "command",
    label: "x",
    rawBytes: bytesSaved,
    returnedBytes: 0,
    bytesSaved,
    savingRatio: 1,
    summary: "",
    mode: "balanced",
  };
}
function seedOverlay(wk: string, sid: string, events: object[]): void {
  const dir = join(store, "stats", wk);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${sid}.events.jsonl`),
    `${events.map((e) => JSON.stringify(e)).join("\n")}\n`,
  );
}
function seedUsage(rows: object[]): void {
  const dir = join(store, "proxy-usage");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "usage.jsonl"), `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`);
}

describe("refreshNetEffectVerdicts", () => {
  it("persists an ok verdict when savings exceed churn", () => {
    seedOverlay("wk1", "s1", [overlayEvent("wk1", "s1", 400_000)]);
    seedUsage(
      Array.from({ length: 25 }, (_, i) => ({
        ts: NOW,
        cacheCreationTokens: 1000,
        messageCount: 3 + i,
      })),
    );
    const checks = refreshNetEffectVerdicts(store, NOW);
    expect(checks.some((c) => c.key === "saver-net-effect" && c.pass)).toBe(true);
    expect(readNetEffectRecord(store, "wk1")?.verdict).toBe("ok");
  });

  it("no proxy ledger → unknown verdict, check passes with a warn", () => {
    seedOverlay("wk1", "s1", [overlayEvent("wk1", "s1", 4000)]);
    const checks = refreshNetEffectVerdicts(store, NOW);
    const c = checks.find((c) => c.key === "saver-net-effect");
    expect(c?.pass).toBe(true);
    expect(c?.value).toContain("unknown");
  });

  it("persists a negative verdict and marks the check failed when churn dwarfs savings", () => {
    seedOverlay("wk1", "s1", [overlayEvent("wk1", "s1", 4000)]); // ~1000 tokens saved
    const rows = [
      ...Array.from({ length: 19 }, () => ({
        ts: NOW,
        cacheCreationTokens: 1000,
        messageCount: 5,
      })),
      { ts: NOW, cacheCreationTokens: 101_000, messageCount: 5 },
    ];
    seedUsage(rows);
    const checks = refreshNetEffectVerdicts(store, NOW);
    expect(checks.some((c) => c.key === "saver-net-effect" && !c.pass)).toBe(true);
    expect(readNetEffectRecord(store, "wk1")?.verdict).toBe("negative");
  });

  it("does not throw when the verdict cannot be persisted (write fail-open)", () => {
    seedOverlay("wk1", "s1", [overlayEvent("wk1", "s1", 400_000)]);
    seedUsage(
      Array.from({ length: 25 }, (_, i) => ({
        ts: NOW,
        cacheCreationTokens: 1000,
        messageCount: 3 + i,
      })),
    );
    // Occupy the net-effect.json path with a directory so the atomic rename fails.
    mkdirSync(join(store, "stats", "wk1", "net-effect.json"), { recursive: true });
    let checks: ReturnType<typeof refreshNetEffectVerdicts> = [];
    expect(() => {
      checks = refreshNetEffectVerdicts(store, NOW);
    }).not.toThrow();
    expect(checks.some((c) => c.key === "saver-net-effect")).toBe(true);
  });
});
