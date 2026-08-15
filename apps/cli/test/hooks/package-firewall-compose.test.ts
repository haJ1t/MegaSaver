import { describe, expect, it } from "vitest";
import {
  type FirewallStageResult,
  type PackageFirewallStageResult,
  composeGuardOutputs,
} from "../../src/hooks/guard-run.js";

const none: FirewallStageResult = { kind: "none" };
const pkgNone: PackageFirewallStageResult = { kind: "none" };
const fwWarn: FirewallStageResult = { kind: "warn", text: "FW WARN" };
const pkgWarn: PackageFirewallStageResult = { kind: "warn", text: "PKG WARN" };
const deny: FirewallStageResult = { kind: "deny", reason: "DENY REASON" };

describe("composeGuardOutputs — the ONE guard-run composition seam", () => {
  it("all none → empty (inert — hook stdout byte-identical to today)", () => {
    expect(
      composeGuardOutputs({ firewall: none, packageFirewall: pkgNone, meshAdditional: undefined }),
    ).toBe("");
  });

  it("firewall warn + package none → byte-identical to today's warn JSON", () => {
    expect(
      composeGuardOutputs({
        firewall: fwWarn,
        packageFirewall: pkgNone,
        meshAdditional: undefined,
      }),
    ).toBe('{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"FW WARN"}}');
  });

  it("firewall none + package warn → package-only JSON", () => {
    expect(
      composeGuardOutputs({ firewall: none, packageFirewall: pkgWarn, meshAdditional: undefined }),
    ).toBe('{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"PKG WARN"}}');
  });

  it("deny + package warn → deny wire; the package text appears NOWHERE", () => {
    const out = composeGuardOutputs({
      firewall: deny,
      packageFirewall: pkgWarn,
      meshAdditional: undefined,
    });
    expect(out).toBe(
      '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"DENY REASON"}}',
    );
    expect(out).not.toContain("PKG WARN");
  });

  it("firewall warn + package warn → ONE additionalContext with a single-\\n join", () => {
    expect(
      composeGuardOutputs({
        firewall: fwWarn,
        packageFirewall: pkgWarn,
        meshAdditional: undefined,
      }),
    ).toBe(
      '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"FW WARN\\nPKG WARN"}}',
    );
  });

  // MESH VARIANTS (architect M4 — the refactor's highest-risk path):
  it("package warn + mesh only → package then \\n\\n mesh (mesh stays outside the seam join)", () => {
    expect(
      composeGuardOutputs({ firewall: none, packageFirewall: pkgWarn, meshAdditional: "MESH" }),
    ).toBe(
      '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"PKG WARN\\n\\nMESH"}}',
    );
  });

  it("firewall warn + package warn + mesh → fw \\n pkg \\n\\n mesh", () => {
    expect(
      composeGuardOutputs({ firewall: fwWarn, packageFirewall: pkgWarn, meshAdditional: "MESH" }),
    ).toBe(
      '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"FW WARN\\nPKG WARN\\n\\nMESH"}}',
    );
  });

  it("deny + package warn + mesh → deny wire carrying mesh (today's wire); package nowhere", () => {
    const out = composeGuardOutputs({
      firewall: deny,
      packageFirewall: pkgWarn,
      meshAdditional: "MESH",
    });
    expect(out).toBe(
      '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"DENY REASON","additionalContext":"MESH"}}',
    );
    expect(out).not.toContain("PKG WARN");
  });

  it("mesh-only (project null / no match) → today's mesh-only wire", () => {
    expect(
      composeGuardOutputs({ firewall: none, packageFirewall: pkgNone, meshAdditional: "MESH" }),
    ).toBe('{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"MESH"}}');
  });
});
