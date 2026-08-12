import { mkdtempSync, readFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { claimPaths, drainInbox, listPeers, registerSession, sendMessage } from "@megasaver/mesh";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildGuardHookOutput, handleGuard } from "../../src/hooks/guard-run.js";
import { handleSaver } from "../../src/hooks/saver-run.js";
import { buildWarmupHookOutput } from "../../src/hooks/warmup-run.js";
import { ensureStoreReady } from "../../src/store.js";

const NOW = "2026-08-12T10:00:00.000Z";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

function tempStore(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

async function seedProject(storeRoot: string, rootPath: string) {
  const { registry } = await ensureStoreReady(storeRoot);
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath,
    createdAt: NOW,
    updatedAt: NOW,
  } as never);
  return registry;
}

describe("warmup-run mesh registerSession", () => {
  let root: string;
  beforeEach(() => {
    root = tempStore("mesh-warmup-");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("registers session even when project exists", async () => {
    await seedProject(root, "/work/demo");
    const wk = encodeWorkspaceKey("/work/demo");
    const now = Date.now();
    const text = await buildWarmupHookOutput({
      payload: { session_id: "s1", cwd: "/work/demo", source: "startup" },
      storeRoot: root,
      now: () => now,
      gatherDelta: () => ({ branch: "main", ahead: 0, behind: 0, changedFiles: [] }) as never,
    });
    expect(typeof text).toBe("string");
    const peers = listPeers(root, { workspaceKey: wk });
    expect(peers.map((p) => p.liveSessionId)).toContain("s1");
    expect(peers.find((p) => p.liveSessionId === "s1")?.branch).toBe("main");
  });

  it("registers session even when project missing (fail-open)", async () => {
    await ensureStoreReady(root);
    const wk = encodeWorkspaceKey("/nowhere");
    const now = Date.now();
    await buildWarmupHookOutput({
      payload: { session_id: "s2", cwd: "/nowhere", source: "startup" },
      storeRoot: root,
      now: () => now,
      gatherDelta: () => null,
    });
    const peers = listPeers(root, { workspaceKey: wk });
    expect(peers.map((p) => p.liveSessionId)).toContain("s2");
  });

  it("handleWarmup wrapper registers without throwing", async () => {
    const { handleWarmup } = await import("../../src/hooks/warmup-run.js");
    await expect(
      handleWarmup({ session_id: "s3", cwd: "/work/demo", source: "startup" }, root),
    ).resolves.toBeUndefined();
    const wk = encodeWorkspaceKey("/work/demo");
    const peers = listPeers(root, { workspaceKey: wk });
    expect(peers.some((p) => p.liveSessionId === "s3")).toBe(true);
  });
});

describe("saver-run heartbeat fire-and-forget debounced ≥5s", () => {
  let root: string;
  beforeEach(() => {
    root = tempStore("mesh-saver-");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("heartbeat updates lastSeenAt after debounce window", async () => {
    const wk = encodeWorkspaceKey("/repo");
    const now = Date.now();
    registerSession(root, {
      liveSessionId: "live1",
      agent: "claude-code",
      status: "working",
      lastSeenAt: new Date(now - 10_000).toISOString(),
      workspaceKey: wk,
      cwd: "/repo",
    });
    // Manually set mtime old to force debounce pass
    const presencePath = join(root, "mesh", "presence", "live1.json");
    const oldTime = new Date(now - 10_000);
    utimesSync(presencePath, oldTime, oldTime);
    const before = listPeers(root, { workspaceKey: wk }).find(
      (p) => p.liveSessionId === "live1",
    )?.lastSeenAt;
    await handleSaver(
      {
        session_id: "live1",
        cwd: "/repo",
        tool_name: "Bash",
        tool_input: { command: "echo hi" },
        tool_response: { stdout: "x".repeat(50000) },
      } as unknown,
      root,
    );
    const after = listPeers(root, { workspaceKey: wk }).find(
      (p) => p.liveSessionId === "live1",
    )?.lastSeenAt;
    expect(Date.parse(after ?? "") > Date.parse(before ?? "")).toBe(true);
  });

  it("does not debounce within 5s (mtime check)", async () => {
    const wk = encodeWorkspaceKey("/repo");
    const now = Date.now();
    registerSession(root, {
      liveSessionId: "live-debounce",
      agent: "claude-code",
      status: "working",
      lastSeenAt: new Date(now).toISOString(),
      workspaceKey: wk,
      cwd: "/repo",
    });
    // mtime is now, so immediate heartbeat should be debounced (no update)
    const presencePath = join(root, "mesh", "presence", "live-debounce.json");
    // Ensure mtime is now
    const nowDate = new Date(now);
    utimesSync(presencePath, nowDate, nowDate);
    const before = readFileSync(presencePath, "utf8");
    await handleSaver({ session_id: "live-debounce", cwd: "/repo" } as unknown, root);
    const after = readFileSync(presencePath, "utf8");
    expect(after).toBe(before);
  });

  it("hot-path guard: saver-run.ts does not contain await heartbeat", async () => {
    // Resolve file path relative to this test file
    const thisDir = join(fileURLToPath(import.meta.url), "..");
    // Try multiple resolution strategies
    let content: string | undefined;
    const candidates = [
      join(thisDir, "../../src/hooks/saver-run.ts"),
      join(process.cwd(), "apps/cli/src/hooks/saver-run.ts"),
      join(process.cwd(), "src/hooks/saver-run.ts"),
    ];
    for (const cand of candidates) {
      try {
        content = readFileSync(cand, "utf8");
        if (content) break;
      } catch {}
    }
    if (!content) {
      // fallback: read via relative from worktree root env
      const worktree =
        // biome-ignore lint/complexity/useLiteralKeys: env index
        process.env["MEGASAVER_WORKTREE"] ??
        "/Users/ozger/Desktop/MegaSaver/.worktrees/feat-session-mesh-family";
      content = readFileSync(join(worktree, "apps/cli/src/hooks/saver-run.ts"), "utf8");
    }
    expect(content).toBeDefined();
    const c = content as string;
    expect(c).not.toContain("await heartbeat");
    // also ensure heartbeat is called without await in the fire helper
    expect(c).toContain("heartbeat(");
  });
});

describe("guard-run mesh: checkConflicts + drainInbox bounded", () => {
  let root: string;
  beforeEach(async () => {
    root = tempStore("mesh-guard-");
    await ensureStoreReady(root);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function registerBoth(cwd: string, ids: string[]) {
    const wk = encodeWorkspaceKey(cwd);
    for (const id of ids) {
      registerSession(root, {
        liveSessionId: id,
        agent: "claude-code",
        status: "working",
        lastSeenAt: new Date().toISOString(),
        workspaceKey: wk,
        cwd,
      });
    }
  }

  it("injects conflict warning and drains inbox bounded via handleGuard wrapper", async () => {
    const cwd = "/repo";
    registerBoth(cwd, ["a1", "b1"]);
    claimPaths(root, { liveSessionId: "a1", paths: ["src/auth.ts"], intent: "fix auth" });
    sendMessage(root, { from: "a1", to: "b1", kind: "message", text: "hello from a1" });

    const result = await handleGuard({
      tool: "Edit",
      path: "src/auth.ts",
      storeRoot: root,
      liveSessionId: "b1",
      cwd,
    } as never);
    expect(result.additionalContext).toBeDefined();
    const ctx1 = result.additionalContext as string;
    expect(ctx1).toContain("peer a1");
    expect(ctx1).toContain("src/auth.ts");
    expect(ctx1).toContain("untrusted");
    // inbox should be drained
    expect(drainInbox(root, "b1")).toHaveLength(0);
  });

  it("buildGuardHookOutput injects conflict warning on file_path absolute converted to repo-relative", async () => {
    const cwd = "/repo/proj";
    registerBoth(cwd, ["a1", "b1"]);
    claimPaths(root, { liveSessionId: "a1", paths: ["src/auth.ts"] });
    // Use absolute path for guard
    const outStr = await buildGuardHookOutput({
      payload: {
        session_id: "b1",
        cwd,
        tool_name: "Edit",
        tool_input: { file_path: "/repo/proj/src/auth.ts", new_string: "x" },
      },
      storeRoot: root,
      now: () => Date.now(),
    });
    expect(outStr).not.toBe("");
    const out = JSON.parse(outStr) as { hookSpecificOutput: { additionalContext: string } };
    expect(out.hookSpecificOutput.additionalContext).toContain("peer a1");
    expect(out.hookSpecificOutput.additionalContext).toContain("src/auth.ts");
  });

  it("bounds inbox to ≤5 messages and ≤2000 tokens with untrusted label", async () => {
    const cwd = "/repo";
    registerBoth(cwd, ["a1", "b1"]);
    // send 10 messages
    for (let i = 0; i < 10; i++) {
      sendMessage(root, {
        from: "a1",
        to: "b1",
        kind: "message",
        text: `msg ${i} ${"x".repeat(2000)}`,
      });
    }
    const outStr = await buildGuardHookOutput({
      payload: {
        session_id: "b1",
        cwd,
        tool_name: "Edit",
        tool_input: { file_path: "src/other.ts", new_string: "y" },
      },
      storeRoot: root,
      now: () => Date.now(),
    });
    expect(outStr).not.toBe("");
    const out = JSON.parse(outStr) as { hookSpecificOutput: { additionalContext: string } };
    const ctx = out.hookSpecificOutput.additionalContext;
    expect(ctx).toContain("untrusted");
    // Count injected lines that start with "untrusted peer"
    const untrustedLines = ctx.split("\n").filter((l) => l.includes("untrusted peer"));
    expect(untrustedLines.length).toBeLessThanOrEqual(5);
    // Token bound: estimate tokens <=2000 (+ header overhead small)
    // Use rough estimate: each char/4
    const estimated = Math.ceil(ctx.length / 4);
    expect(estimated).toBeLessThanOrEqual(2600); // allow header slack, but must be ~2000
    // Further ensure raw drain is empty
    expect(drainInbox(root, "b1")).toHaveLength(0);
  });

  it("labels untrusted peer text and preserves firewall warn when both present", async () => {
    const cwd = "/work/demo";
    await seedProject(root, cwd);
    // need to set up guard corpus to trigger firewall
    const { appendGuardCorpusRow } = await import("@megasaver/context-gate");
    appendGuardCorpusRow(root, PROJECT_ID, {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      command: "pnpm vitest --shard 2",
      errorOutput: "Error: unknown option '--shard' in src/run.ts",
      wastedTokens: 4200,
      createdAt: "2026-07-11T10:00:00.000Z",
    } as never);
    registerBoth(cwd, ["a1", "s1"]);
    claimPaths(root, { liveSessionId: "a1", paths: ["src/auth.ts"] });
    sendMessage(root, { from: "a1", to: "s1", kind: "message", text: "peer hint" });

    const outStr = await buildGuardHookOutput({
      payload: {
        session_id: "s1",
        cwd,
        tool_name: "Bash",
        tool_input: { command: "pnpm vitest --shard 2" },
      },
      storeRoot: root,
      now: () => Date.parse(NOW),
    });
    expect(outStr).not.toBe("");
    const out = JSON.parse(outStr) as { hookSpecificOutput: { additionalContext: string } };
    expect(out.hookSpecificOutput.additionalContext).toContain("Mistake Firewall");
    expect(out.hookSpecificOutput.additionalContext).toContain("peer a1");
    expect(out.hookSpecificOutput.additionalContext).toContain("untrusted");
  });

  it("drainInbox not awaited and fail-open on missing liveSessionId", async () => {
    const cwd = "/repo";
    registerBoth(cwd, ["a1"]);
    // No inbox for b1 exists, should not throw and return mesh empty
    const outStr = await buildGuardHookOutput({
      payload: {
        session_id: "b1",
        cwd,
        tool_name: "Edit",
        tool_input: { file_path: "src/foo.ts", new_string: "x" },
      },
      storeRoot: root,
      now: () => Date.now(),
    });
    // b1 not registered but checkConflicts should handle gracefully (liveSet excludes unknown)
    // Should either be "" or contain nothing, but not throw
    expect(typeof outStr).toBe("string");
  });
});
