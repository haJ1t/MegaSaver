import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { firewallLogPath } from "@megasaver/context-gate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildGuardHookOutput, composeGuardOutputs } from "../../src/hooks/guard-run.js";

const NOW = "2026-08-06T12:00:00.000Z";
let root: string; // store root
let repo: string; // fenced repo (has .git so locateFenceRoot stops here)
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-fenceguard-"));
  repo = mkdtempSync(join(tmpdir(), "megasaver-fencerepo-"));
  mkdirSync(join(repo, ".git"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

const FENCE_YAML = [
  "version: 1",
  "allow:",
  "  - docs/generated/README.md",
  "entries:",
  "  - path: pnpm-lock.yaml",
  "    class: lockfile",
  '    reason: "derived: lockfile basename"',
  "  - path: dist/**",
  "    class: build-output",
  '    reason: "derived: build-output dir on disk"',
  "    mode: deny",
  "",
].join("\n");

function editPayload(filePath: string) {
  return {
    session_id: "s1",
    cwd: repo,
    tool_name: "Edit",
    tool_input: { file_path: filePath, old_string: "a", new_string: "b" },
  };
}
function call(payload: unknown) {
  return buildGuardHookOutput({
    payload,
    storeRoot: root,
    now: () => Date.parse(NOW),
  });
}
function ledgerRows(): unknown[] {
  try {
    return readFileSync(firewallLogPath(root), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

describe("guard-run fence stage", () => {
  it("no fence.yaml → output byte-identical to today (inert)", async () => {
    expect(await call(editPayload(join(repo, "src/app.ts")))).toBe("");
  });

  it("warns on a fenced lockfile with no registered project (repo-scoped)", async () => {
    writeFileSync(join(repo, "fence.yaml"), FENCE_YAML);
    const out = JSON.parse(await call(editPayload(join(repo, "pnpm-lock.yaml"))));
    expect(out.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    const ctx: string = out.hookSpecificOutput.additionalContext;
    expect(ctx).toContain("Generated-File Fence");
    expect(ctx).toContain("pnpm install");
    expect(ctx).toContain("mega fence allow pnpm-lock.yaml");
    expect(out.hookSpecificOutput.permissionDecision).toBeUndefined();
  });

  it("denies a deny-mode entry with the verified wire, exact shape", async () => {
    writeFileSync(join(repo, "fence.yaml"), FENCE_YAML);
    const out = JSON.parse(await call(editPayload(join(repo, "dist/bundle.js"))));
    expect(Object.keys(out)).toEqual(["hookSpecificOutput"]);
    expect(out.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain(
      "mega fence allow dist/bundle.js",
    );
    expect(out.hookSpecificOutput.additionalContext).toBeUndefined();
  });

  it("appends value-free ledger rows for warn and deny", async () => {
    writeFileSync(join(repo, "fence.yaml"), FENCE_YAML);
    await call(editPayload(join(repo, "pnpm-lock.yaml")));
    await call(editPayload(join(repo, "dist/bundle.js")));
    const rows = ledgerRows();
    expect(rows).toMatchObject([
      {
        kind: "fence-warn",
        detector: "fence:lockfile",
        count: 1,
        sourcePath: "pnpm-lock.yaml",
        sessionId: "s1",
      },
      {
        kind: "fence-deny",
        detector: "fence:build-output",
        count: 1,
        sourcePath: "dist/bundle.js",
        sessionId: "s1",
      },
    ]);
    for (const row of rows) expect(JSON.stringify(row)).not.toContain("old_string");
  });

  it("allow glob silences the fence; Bash stays out of scope; corrupt fence is inert", async () => {
    writeFileSync(join(repo, "fence.yaml"), FENCE_YAML);
    expect(await call(editPayload(join(repo, "docs/generated/README.md")))).toBe("");
    expect(
      await call({
        session_id: "s1",
        cwd: repo,
        tool_name: "Bash",
        tool_input: { command: "echo x > pnpm-lock.yaml" },
      }),
    ).toBe("");
    writeFileSync(join(repo, "fence.yaml"), "{{{{");
    expect(await call(editPayload(join(repo, "pnpm-lock.yaml")))).toBe("");
  });

  it("imports @megasaver/fence lazily — no top-level import (hot-path guard)", () => {
    const src = readFileSync(new URL("../../src/hooks/guard-run.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/^import[^\n]*"@megasaver\/fence"/m);
    expect(src).toContain('await import("@megasaver/fence")');
  });
});

describe("composeGuardOutputs (documented order: fence → firewall → mesh)", () => {
  it("both warn → fence text first, one additionalContext", () => {
    const out = JSON.parse(
      composeGuardOutputs({
        fence: { kind: "warn", text: "FENCE" },
        firewall: { kind: "warn", text: "FIREWALL" },
      }),
    );
    expect(out.hookSpecificOutput.additionalContext).toBe("FENCE\nFIREWALL");
  });
  it("package-firewall text joins after the mistake-firewall text (absorbed mergeHookOutputs)", () => {
    const out = JSON.parse(
      composeGuardOutputs({
        fence: { kind: "warn", text: "FENCE" },
        firewall: { kind: "warn", text: "FIREWALL" },
        packageFirewallText: "PKG",
      }),
    );
    const ctx: string = out.hookSpecificOutput.additionalContext;
    expect(ctx.startsWith("FENCE\nFIREWALL")).toBe(true);
    expect(ctx.endsWith("PKG")).toBe(true);
  });
  it("firewall strict deny wins unchanged; fence warn dropped (write blocked anyway)", () => {
    const out = JSON.parse(
      composeGuardOutputs({
        fence: { kind: "warn", text: "FENCE" },
        firewall: { kind: "deny", reason: "R" },
      }),
    );
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toBe("R");
    expect(JSON.stringify(out)).not.toContain("FENCE");
  });
  it("none + none → empty string (no injection)", () => {
    expect(
      composeGuardOutputs({
        fence: { kind: "none" },
        firewall: { kind: "none" },
      }),
    ).toBe("");
  });
});
