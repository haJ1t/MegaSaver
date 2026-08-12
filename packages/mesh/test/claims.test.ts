import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkConflicts, claimPaths, releaseClaim } from "../src/claims.js";
import { registerSession } from "../src/presence.js";

describe("claims", () => {
  let root = "";
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "mesh-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("conflict detected on overlapping path", () => {
    for (const id of ["a1", "b1"])
      registerSession(root, {
        liveSessionId: id,
        agent: "claude-code",
        status: "working",
        lastSeenAt: new Date().toISOString(),
        workspaceKey: "aaaaaaaaaaaaaaaa",
        cwd: "/repo",
      });
    claimPaths(root, { liveSessionId: "a1", paths: ["src/auth.ts"] });
    expect(checkConflicts(root, "b1", ["src/auth.ts"]).length).toBe(1);
    expect(checkConflicts(root, "a1", ["src/auth.ts"]).length).toBe(0); // own claim not conflict
  });

  it("rejects absolute paths (repo-relative only)", () => {
    registerSession(root, {
      liveSessionId: "a1",
      agent: "claude-code",
      status: "working",
      lastSeenAt: new Date().toISOString(),
      workspaceKey: "aaaaaaaaaaaaaaaa",
      cwd: "/repo",
    });
    expect(() => claimPaths(root, { liveSessionId: "a1", paths: ["/etc/passwd"] })).toThrow(
      /repo-relative/,
    );
    expect(() => claimPaths(root, { liveSessionId: "a1", paths: ["C:\\Windows\\foo"] })).toThrow(
      /repo-relative/,
    );
  });

  it("redacts intent via policy", () => {
    registerSession(root, {
      liveSessionId: "a1",
      agent: "claude-code",
      status: "working",
      lastSeenAt: new Date().toISOString(),
      workspaceKey: "aaaaaaaaaaaaaaaa",
      cwd: "/repo",
    });
    const rec = claimPaths(root, {
      liveSessionId: "a1",
      paths: ["src/auth.ts"],
      intent: "token: sk-proj-abcdefghijklmnopqrstuvwxyz0123456789",
    });
    expect(rec.intent).toBeDefined();
    expect(rec.intent).not.toContain("sk-proj");
  });

  it("sets TTL ~30m and expires filtered", async () => {
    registerSession(root, {
      liveSessionId: "a1",
      agent: "claude-code",
      status: "working",
      lastSeenAt: new Date().toISOString(),
      workspaceKey: "aaaaaaaaaaaaaaaa",
      cwd: "/repo",
    });
    registerSession(root, {
      liveSessionId: "b1",
      agent: "claude-code",
      status: "working",
      lastSeenAt: new Date().toISOString(),
      workspaceKey: "aaaaaaaaaaaaaaaa",
      cwd: "/repo",
    });
    const rec = claimPaths(root, { liveSessionId: "a1", paths: ["src/auth.ts"] });
    const ttlMs = Date.parse(rec.expiresAt) - Date.parse(rec.createdAt);
    expect(ttlMs).toBe(30 * 60 * 1000);
    // manually expire the claim file to past
    const { meshPaths } = await import("../src/paths.js");
    const { readFileSync, writeFileSync } = await import("node:fs");
    const { claimsDir } = meshPaths(root);
    const fp = join(claimsDir, `${rec.claimId}.json`);
    const raw = JSON.parse(readFileSync(fp, "utf8"));
    raw.expiresAt = new Date(Date.now() - 1000).toISOString();
    writeFileSync(fp, `${JSON.stringify(raw)}\n`);
    expect(checkConflicts(root, "b1", ["src/auth.ts"]).length).toBe(0);
  });

  it("dead peer claims are not conflicts", () => {
    const now = Date.now();
    registerSession(root, {
      liveSessionId: "a1",
      agent: "claude-code",
      status: "working",
      lastSeenAt: new Date(now - 11 * 60 * 1000).toISOString(), // dead >10m
      workspaceKey: "aaaaaaaaaaaaaaaa",
      cwd: "/repo",
    });
    registerSession(root, {
      liveSessionId: "b1",
      agent: "claude-code",
      status: "working",
      lastSeenAt: new Date().toISOString(),
      workspaceKey: "aaaaaaaaaaaaaaaa",
      cwd: "/repo",
    });
    claimPaths(root, { liveSessionId: "a1", paths: ["src/auth.ts"] });
    expect(checkConflicts(root, "b1", ["src/auth.ts"]).length).toBe(0);
  });

  it("glob overlap via compileGlob NFA", () => {
    for (const id of ["a1", "b1"])
      registerSession(root, {
        liveSessionId: id,
        agent: "claude-code",
        status: "working",
        lastSeenAt: new Date().toISOString(),
        workspaceKey: "aaaaaaaaaaaaaaaa",
        cwd: "/repo",
      });
    claimPaths(root, { liveSessionId: "a1", paths: ["src/**"] });
    expect(checkConflicts(root, "b1", ["src/auth.ts"]).length).toBe(1);
    expect(checkConflicts(root, "b1", ["src/nested/deep.ts"]).length).toBe(1);
    expect(checkConflicts(root, "b1", ["other/file.ts"]).length).toBe(0);
    // claim exact vs query glob (isolated dir to avoid overlapping prior src/** claim)
    claimPaths(root, { liveSessionId: "a1", paths: ["other/exact.ts"] });
    expect(checkConflicts(root, "b1", ["other/*.ts"]).length).toBe(1);
  });

  it("quarantines corrupt claim file", async () => {
    const { meshPaths } = await import("../src/paths.js");
    const { mkdirSync, writeFileSync, existsSync, readdirSync } = await import("node:fs");
    for (const id of ["a1", "b1"])
      registerSession(root, {
        liveSessionId: id,
        agent: "claude-code",
        status: "working",
        lastSeenAt: new Date().toISOString(),
        workspaceKey: "aaaaaaaaaaaaaaaa",
        cwd: "/repo",
      });
    claimPaths(root, { liveSessionId: "a1", paths: ["src/auth.ts"] });
    const { claimsDir, quarantineDir } = meshPaths(root);
    mkdirSync(claimsDir, { recursive: true });
    writeFileSync(join(claimsDir, "bad.json"), "{ not json");
    expect(checkConflicts(root, "b1", ["src/auth.ts"]).length).toBe(1);
    expect(existsSync(join(claimsDir, "bad.json"))).toBe(false);
    expect(readdirSync(quarantineDir).length).toBeGreaterThanOrEqual(1);
  });

  it("releaseClaim removes and returns boolean", () => {
    for (const id of ["a1", "b1"])
      registerSession(root, {
        liveSessionId: id,
        agent: "claude-code",
        status: "working",
        lastSeenAt: new Date().toISOString(),
        workspaceKey: "aaaaaaaaaaaaaaaa",
        cwd: "/repo",
      });
    const rec = claimPaths(root, { liveSessionId: "a1", paths: ["src/auth.ts"] });
    expect(checkConflicts(root, "b1", ["src/auth.ts"]).length).toBe(1);
    expect(releaseClaim(root, rec.claimId)).toBe(true);
    expect(checkConflicts(root, "b1", ["src/auth.ts"]).length).toBe(0);
    expect(releaseClaim(root, rec.claimId)).toBe(false);
    expect(releaseClaim(root, "nonexistent")).toBe(false);
  });

  it("writes with 0600 file and 0700 dir", async () => {
    if (process.platform === "win32") return;
    const { statSync } = await import("node:fs");
    registerSession(root, {
      liveSessionId: "a1",
      agent: "claude-code",
      status: "working",
      lastSeenAt: new Date().toISOString(),
      workspaceKey: "aaaaaaaaaaaaaaaa",
      cwd: "/repo",
    });
    const rec = claimPaths(root, { liveSessionId: "a1", paths: ["src/auth.ts"] });
    const { meshPaths } = await import("../src/paths.js");
    const { claimsDir } = meshPaths(root);
    const fp = join(claimsDir, `${rec.claimId}.json`);
    const fileMode = statSync(fp).mode & 0o777;
    const dirMode = statSync(claimsDir).mode & 0o777;
    expect(fileMode).toBe(0o600);
    expect(dirMode).toBe(0o700);
  });
});
