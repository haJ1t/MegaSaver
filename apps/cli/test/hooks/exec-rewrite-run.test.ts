import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeExactRecord } from "@megasaver/context-gate";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildExecRewriteHookOutput } from "../../src/hooks/exec-rewrite-run.js";

let store: string;
let cwd: string;
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "mega-rewrite-store-"));
  cwd = mkdtempSync(join(tmpdir(), "mega-rewrite-cwd-"));
  // Settings record lives under the CANONICAL key; the payload cwd keeps the
  // raw tmpdir spelling — the hook gate must canonicalize before resolving
  // (macOS /var vs /private/var regression).
  writeExactRecord(store, encodeWorkspaceKey(realpathSync(cwd)), {
    enabled: true,
    mode: "balanced",
    scope: "exact",
  });
});
afterEach(() => {
  rmSync(store, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

const SID = "sess-1";
function payload(command: string, overrides: Record<string, unknown> = {}): unknown {
  return {
    session_id: SID,
    cwd,
    tool_name: "Bash",
    tool_input: { command },
    ...overrides,
  };
}

describe("buildExecRewriteHookOutput — rewrite", () => {
  it("emits updatedInput with the exec-live command and NO permissionDecision", () => {
    const out = buildExecRewriteHookOutput({ payload: payload("vitest run"), storeRoot: store });
    const parsed = JSON.parse(out) as {
      hookSpecificOutput: Record<string, unknown> & { updatedInput: { command: string } };
    };
    // biome-ignore lint/complexity/useLiteralKeys: property access on an index signature
    expect(parsed.hookSpecificOutput["hookEventName"]).toBe("PreToolUse");
    expect(parsed.hookSpecificOutput.updatedInput.command).toBe(
      `mega output exec-live --live-session ${SID} -- vitest run`,
    );
    expect("permissionDecision" in parsed.hookSpecificOutput).toBe(false); // LD2
  });

  it("LD2 full-replacement echo: unchanged tool_input fields survive", () => {
    const p = payload("vitest run", {
      tool_input: { command: "vitest run", description: "run unit tests" },
    });
    const out = buildExecRewriteHookOutput({ payload: p, storeRoot: store });
    const parsed = JSON.parse(out) as {
      hookSpecificOutput: { updatedInput: { command: string; description: string } };
    };
    expect(parsed.hookSpecificOutput.updatedInput.description).toBe("run unit tests");
    expect(parsed.hookSpecificOutput.updatedInput.command).toContain("output exec-live");
  });

  it("LD11: threads tool_input.timeout (ms) as --timeout seconds", () => {
    const p = payload("vitest run", { tool_input: { command: "vitest run", timeout: 125_000 } });
    const out = buildExecRewriteHookOutput({ payload: p, storeRoot: store });
    const parsed = JSON.parse(out) as {
      hookSpecificOutput: { updatedInput: { command: string } };
    };
    expect(parsed.hookSpecificOutput.updatedInput.command).toBe(
      `mega output exec-live --live-session ${SID} --timeout 125 -- vitest run`,
    );
  });

  it("bakes --store for a SAFE_TOKEN store path", () => {
    // Windows temp paths carry backslashes, which LD10 correctly declines —
    // the baked-store form is POSIX-only by construction.
    if (process.platform === "win32") {
      const out = buildExecRewriteHookOutput({
        payload: payload("git status"),
        storeRoot: store,
        storeFlag: store,
      });
      expect(out).toBe("");
      return;
    }
    const out = buildExecRewriteHookOutput({
      payload: payload("git status"),
      storeRoot: store,
      storeFlag: store,
    });
    const cmd = (JSON.parse(out) as { hookSpecificOutput: { updatedInput: { command: string } } })
      .hookSpecificOutput.updatedInput.command;
    expect(cmd).toBe(`mega output exec-live --live-session ${SID} --store ${store} -- git status`);
  });

  it("LD10: non-SAFE_TOKEN launcher path declines (no shell quoting ever)", () => {
    const out = buildExecRewriteHookOutput({
      payload: payload("git status"),
      storeRoot: store,
      cliPath: "/opt/My Tools/mega",
    });
    expect(out).toBe("");
  });

  it("LD10: non-SAFE_TOKEN store flag declines", () => {
    const out = buildExecRewriteHookOutput({
      payload: payload("git status"),
      storeRoot: store,
      storeFlag: "/tmp/my store dir",
    });
    expect(out).toBe("");
  });
});

describe("buildExecRewriteHookOutput — fail-open emits ''", () => {
  it("malformed payload emits ''", () => {
    expect(buildExecRewriteHookOutput({ payload: "not-an-object", storeRoot: store })).toBe("");
  });

  it("non-Bash tool emits ''", () => {
    const p = payload("vitest run", { tool_name: "Read" });
    expect(buildExecRewriteHookOutput({ payload: p, storeRoot: store })).toBe("");
  });

  it("missing command emits ''", () => {
    const p = { session_id: SID, cwd, tool_name: "Bash", tool_input: {} };
    expect(buildExecRewriteHookOutput({ payload: p, storeRoot: store })).toBe("");
  });

  it("classifier null (script runner) emits ''", () => {
    expect(buildExecRewriteHookOutput({ payload: payload("pnpm test"), storeRoot: store })).toBe(
      "",
    );
  });

  it("unsafe session_id emits ''", () => {
    const p = payload("vitest run", { session_id: "../evil" });
    expect(buildExecRewriteHookOutput({ payload: p, storeRoot: store })).toBe("");
  });

  it("disabled workspace emits ''", () => {
    const otherCwd = mkdtempSync(join(tmpdir(), "mega-rewrite-off-"));
    const p = payload("vitest run", { cwd: otherCwd });
    expect(buildExecRewriteHookOutput({ payload: p, storeRoot: store })).toBe("");
    rmSync(otherCwd, { recursive: true, force: true });
  });

  it("re-entry no-op: a rewritten command is never rewritten again", () => {
    const p = payload(`mega output exec-live --live-session ${SID} -- vitest run`);
    expect(buildExecRewriteHookOutput({ payload: p, storeRoot: store })).toBe("");
  });
});
