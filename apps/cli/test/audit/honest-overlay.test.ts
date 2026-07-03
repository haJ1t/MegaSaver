import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordAndFilterOverlayOutput } from "@megasaver/core";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { runHonestAudit } from "../../src/commands/audit/honest.js";

// Large enough to trigger compression under aggressive mode
const bigRaw = `line ${"x".repeat(40)}\n`.repeat(2000);

describe("mega audit honest — overlay event loader", () => {
  it("--json reports non-zero eligibleReduction when overlay events exist for the session", async () => {
    const storeRoot = mkdtempSync(join(tmpdir(), "honest-overlay-"));
    // Use a deterministic synthetic cwd so encodeWorkspaceKey is stable.
    const cwd = "/synthetic/project/path";
    const workspaceKey = encodeWorkspaceKey(cwd);
    const liveSessionId = "aaaaaaaa-1111-4111-8111-111111111111";

    await recordAndFilterOverlayOutput({
      storeRoot,
      workspaceKey,
      liveSessionId,
      raw: bigRaw,
      sourceKind: "command",
      label: "ls",
      mode: "aggressive",
      storeRawOutput: false,
    });

    const { output } = await runHonestAudit({
      liveSessionId,
      storeRoot,
      cwd,
      json: true,
    });
    const metrics = JSON.parse(output) as { eligibleReduction: number; rawTokensEligible: number };
    expect(metrics.eligibleReduction).toBeGreaterThan(0);
    expect(metrics.rawTokensEligible).toBeGreaterThan(0);
  });

  it("returns zero metrics when no overlay events exist for the session", async () => {
    const storeRoot = mkdtempSync(join(tmpdir(), "honest-overlay-empty-"));
    const { output } = await runHonestAudit({
      liveSessionId: "bbbbbbbb-2222-4222-8222-222222222222",
      storeRoot,
      cwd: "/some/path",
      json: true,
    });
    const metrics = JSON.parse(output) as { eligibleReduction: number };
    expect(metrics.eligibleReduction).toBe(0);
  });
});
