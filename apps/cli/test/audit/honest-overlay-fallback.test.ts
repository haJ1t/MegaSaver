import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type OverlaySessionTokenSaverStats,
  recordAndFilterOverlayOutput,
} from "@megasaver/core";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runHonestAudit } from "../../src/commands/audit/honest.js";

const WORKSPACE_A = "workspace-aaa";
const WORKSPACE_B = "workspace-bbb";
const OVERLAY_ID = "1af7f8f0-2b3c-4d5e-8f60-718293a4b5c6";
const TS = "2026-07-03T12:00:00.000Z";
const CWD = "/synthetic/honest/project";

// Large enough to trigger compression under aggressive mode.
const bigRaw = `line ${"x".repeat(40)}\n`.repeat(2000);

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-cli-honest-overlay-fallback-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function overlaySummary(
  liveSessionId: string,
  overrides: Partial<OverlaySessionTokenSaverStats> = {},
): OverlaySessionTokenSaverStats {
  return {
    liveSessionId,
    eventsTotal: 5,
    rawBytesTotal: 90650,
    returnedBytesTotal: 17157,
    bytesSavedTotal: 73493,
    savingRatio: 0.811,
    secretsRedactedTotal: 2,
    chunksStoredTotal: 3,
    updatedAt: TS,
    ...overrides,
  };
}

function writeOverlaySummary(workspaceKey: string, summary: OverlaySessionTokenSaverStats): void {
  const dir = join(root, "stats", workspaceKey);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${summary.liveSessionId}.json`), JSON.stringify(summary), "utf8");
}

describe("mega audit honest — overlay fallback", () => {
  it("renders the overlay card + note when only an overlay summary exists (no eligible tokens)", async () => {
    writeOverlaySummary(WORKSPACE_A, overlaySummary(OVERLAY_ID));

    const out = await runHonestAudit({
      liveSessionId: OVERLAY_ID,
      storeRoot: root,
      cwd: CWD,
      json: false,
    });

    expect(out).toContain("overlay");
    expect(out).toContain("73493");
    expect(out).toContain("81");
    expect(out).toContain(WORKSPACE_A);
    // A one-line note that token-weighted honest metrics need a registered/proxy session.
    expect(out.toLowerCase()).toContain("registered");
    // Must NOT be the plain honest report.
    expect(out).not.toContain("eligible reduction:");
  });

  it("--json emits the overlay summary when only an overlay summary exists", async () => {
    writeOverlaySummary(WORKSPACE_A, overlaySummary(OVERLAY_ID));

    const out = await runHonestAudit({
      liveSessionId: OVERLAY_ID,
      storeRoot: root,
      cwd: CWD,
      json: true,
    });

    const parsed = JSON.parse(out) as OverlaySessionTokenSaverStats;
    expect(parsed.liveSessionId).toBe(OVERLAY_ID);
    expect(parsed.bytesSavedTotal).toBe(73493);
    expect(parsed.savingRatio).toBeCloseTo(0.811, 10);
  });

  it("resolves the overlay summary across multiple workspaces deterministically", async () => {
    writeOverlaySummary(WORKSPACE_B, overlaySummary(OVERLAY_ID, { bytesSavedTotal: 111 }));
    writeOverlaySummary(WORKSPACE_A, overlaySummary(OVERLAY_ID, { bytesSavedTotal: 73493 }));

    const out = await runHonestAudit({
      liveSessionId: OVERLAY_ID,
      storeRoot: root,
      cwd: CWD,
      json: false,
    });

    expect(out).toContain(WORKSPACE_A);
    expect(out).toContain("73493");
  });

  it("uses the honest report (fallback not taken) when eligible overlay events exist for the cwd", async () => {
    const workspaceKey = encodeWorkspaceKey(CWD);
    await recordAndFilterOverlayOutput({
      storeRoot: root,
      workspaceKey,
      liveSessionId: OVERLAY_ID,
      raw: bigRaw,
      sourceKind: "command",
      label: "ls",
      mode: "aggressive",
      storeRawOutput: false,
    });
    // An overlay SUMMARY (different-shaped stats) must not shadow the honest report
    // once eligible token-weighted events exist for this cwd.
    writeOverlaySummary(WORKSPACE_A, overlaySummary(OVERLAY_ID));

    const out = await runHonestAudit({
      liveSessionId: OVERLAY_ID,
      storeRoot: root,
      cwd: CWD,
      json: true,
    });

    const metrics = JSON.parse(out) as { eligibleReduction: number; rawTokensEligible: number };
    expect(metrics.rawTokensEligible).toBeGreaterThan(0);
    expect(metrics.eligibleReduction).toBeGreaterThan(0);
  });

  it("keeps zero honest metrics when neither eligible events nor an overlay summary exist", async () => {
    const out = await runHonestAudit({
      liveSessionId: OVERLAY_ID,
      storeRoot: root,
      cwd: CWD,
      json: true,
    });

    const metrics = JSON.parse(out) as { eligibleReduction: number; rawTokensEligible: number };
    expect(metrics.eligibleReduction).toBe(0);
    expect(metrics.rawTokensEligible).toBe(0);
  });
});
