import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonicalFamilyPath,
  familyKeyFromPath,
  nodeResolverDeps,
  readHeartbeatView,
  recordInvocationHeartbeat,
  resolveWorkspaceTokenSaverSettings,
  writeFamilyRecord,
} from "@megasaver/context-gate";
import { recordAndFilterOverlayOutput } from "@megasaver/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildSaverDecision } from "../../src/hooks/saver.js";

let root: string;
let store: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mega-wt-repo-"));
  store = mkdtempSync(join(tmpdir(), "mega-wt-store-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(store, { recursive: true, force: true });
});

// Build a main repo (.git dir) plus a linked worktree (.git file + admin), then
// enable the repository FAMILY, and prove the worktree cwd inherits it — the
// exact scenario the 2026-07-02 live diagnosis showed passing through.
function buildRepoWithWorktree(): { worktreeCwd: string } {
  const gitDir = join(root, "repo", ".git");
  mkdirSync(gitDir, { recursive: true });
  writeFileSync(join(gitDir, "HEAD"), "ref: refs/heads/main\n");
  mkdirSync(join(gitDir, "objects"), { recursive: true });
  const worktreeCwd = join(root, "repo", "wt");
  const admin = join(gitDir, "worktrees", "wt");
  mkdirSync(admin, { recursive: true });
  writeFileSync(join(admin, "HEAD"), "ref: refs/heads/wt\n");
  writeFileSync(join(admin, "commondir"), "../..\n");
  writeFileSync(join(admin, "gitdir"), `${join(worktreeCwd, ".git")}\n`);
  mkdirSync(worktreeCwd, { recursive: true });
  writeFileSync(join(worktreeCwd, ".git"), `gitdir: ${admin}\n`);
  return { worktreeCwd };
}

function enableRepositoryFamily(worktreeCwd: string): void {
  const deps = nodeResolverDeps();
  const git = deps.resolveGit(worktreeCwd);
  if (git.kind !== "ok") throw new Error(`expected ok, got ${git.kind}`);
  const canon = canonicalFamilyPath(git.commonDir, deps.platform, {
    realpathNative: deps.realpath,
    caseMode: deps.caseModeOf,
  });
  const fk = familyKeyFromPath(deps.platform, canon.caseMode, canon.canonicalPath);
  writeFamilyRecord(store, fk.key, {
    enabled: true,
    mode: "aggressive",
    identityDigest: fk.digestHex,
    identityPath: fk.identityPath,
  });
}

const realResolveSettings = (storeRoot: string, cwd: string) => {
  const r = resolveWorkspaceTokenSaverSettings(storeRoot, cwd, nodeResolverDeps());
  return r.enabled ? { enabled: true as const, mode: r.mode } : null;
};

describe("saver hook — repository-family inheritance across worktrees", () => {
  it("a worktree inherits its repository's family enable", () => {
    const { worktreeCwd } = buildRepoWithWorktree();
    // Before enabling: worktree resolves disabled.
    expect(resolveWorkspaceTokenSaverSettings(store, worktreeCwd, nodeResolverDeps()).enabled).toBe(
      false,
    );
    enableRepositoryFamily(worktreeCwd);
    const resolved = resolveWorkspaceTokenSaverSettings(store, worktreeCwd, nodeResolverDeps());
    expect(resolved.enabled).toBe(true);
    expect(resolved.source).toBe("repository");
  });

  it("compresses a large Read output from the worktree via the real resolver", async () => {
    const { worktreeCwd } = buildRepoWithWorktree();
    enableRepositoryFamily(worktreeCwd);

    const payload = {
      tool_name: "Read",
      tool_input: { file_path: join(worktreeCwd, "big.txt") },
      tool_response: { content: "X".repeat(50_000), isError: false },
      session_id: "live-wt",
      cwd: worktreeCwd,
    };
    const out = await buildSaverDecision(payload, {
      storeRoot: store,
      resolveSettings: realResolveSettings,
      readSessionIntent: () => undefined,
      record: recordAndFilterOverlayOutput,
      recordInvocation: () => {},
      recordCompression: () => {},
    });
    expect("updatedToolOutput" in out).toBe(true);
    if ("updatedToolOutput" in out) {
      const u = out.updatedToolOutput as { content: string };
      expect(u.content).toContain("Mega Saver: compressed");
    }
  });

  it("writes an invocation heartbeat even when the output is small (passthrough)", async () => {
    const { worktreeCwd } = buildRepoWithWorktree();
    enableRepositoryFamily(worktreeCwd);
    const now = Date.now();
    let invoked = false;
    const out = await buildSaverDecision(
      {
        tool_name: "Read",
        tool_input: { file_path: join(worktreeCwd, "tiny.txt") },
        tool_response: { content: "tiny", isError: false },
        session_id: "live-wt",
        cwd: worktreeCwd,
      },
      {
        storeRoot: store,
        resolveSettings: realResolveSettings,
        readSessionIntent: () => undefined,
        record: recordAndFilterOverlayOutput,
        recordInvocation: (sr, wk) => {
          invoked = true;
          recordInvocationHeartbeat(sr, wk, new Date(now).toISOString(), now);
        },
        recordCompression: () => {},
      },
    );
    expect(out).toEqual({ passthrough: true });
    expect(invoked).toBe(true);
    expect(readHeartbeatView(store, now).latest).not.toBeNull();
  });
});
