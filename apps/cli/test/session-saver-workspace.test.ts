/**
 * `mega session saver workspace {enable,disable}` + `default` behavior tests.
 *
 * The workspace toggle is now repository-aware: at a cwd where the resolver
 * yields a Git family key it writes a FAMILY record (covers all worktrees);
 * elsewhere (or with --exact) it writes a v1 exact record. `default` writes the
 * global default. All records are the strict v1 shapes read by the saver hook.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonicalFamilyPath,
  familyKeyFromPath,
  nodeResolverDeps,
  resolveWorkspaceTokenSaverSettings,
} from "@megasaver/context-gate";
import { encodeWorkspaceKey, tokenSaverModeSchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  runSessionSaverDefaultEnable,
  runSessionSaverWorkspaceDisable,
  runSessionSaverWorkspaceEnable,
  sessionSaverCommand,
} from "../src/commands/session/saver/index.js";
import { MODE_INVALID_MESSAGE_PREFIX } from "../src/errors.js";

const NON_GIT_CWD = "/work/project-alpha";

function exactPath(store: string, cwd: string): string {
  return join(store, "stats", encodeWorkspaceKey(cwd), "workspace-token-saver.json");
}
async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8"));
}

describe("workspace toggle — non-Git cwd → exact scope", () => {
  let store: string;
  beforeEach(() => {
    store = mkdtempSync(join(tmpdir(), "megasaver-cli-saver-ws-"));
  });
  afterEach(() => {
    rmSync(store, { recursive: true, force: true });
  });

  const enable = async (
    args: { mode?: string; cwd?: string; exact?: boolean; json?: boolean } = {},
  ) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runSessionSaverWorkspaceEnable({
      modeFlag: args.mode,
      exact: args.exact ?? false,
      storeFlag: store,
      cwd: args.cwd ?? NON_GIT_CWD,
      home: "/tmp",
      xdgDataHome: undefined,
      platform: "linux",
      localAppData: undefined,
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      json: args.json ?? false,
    });
    return { out, err, code };
  };

  it("writes a v1 exact record", async () => {
    const { code } = await enable({ mode: "aggressive" });
    expect(code).toBe(0);
    expect(await readJson(exactPath(store, NON_GIT_CWD))).toMatchObject({
      version: 1,
      enabled: true,
      mode: "aggressive",
      scope: "exact",
    });
  });

  it("rejects a bad --mode → exit 1, no file", async () => {
    const { out, err, code } = await enable({ mode: "turbo" });
    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(err.some((e) => e.startsWith(MODE_INVALID_MESSAGE_PREFIX))).toBe(true);
    await expect(readFile(exactPath(store, NON_GIT_CWD), "utf8")).rejects.toThrow();
  });

  it("echoes 'this workspace only' scope", async () => {
    const { out } = await enable({ mode: "safe" });
    expect(out.join("\n").toLowerCase()).toContain("this workspace only");
  });

  it("json mode carries scope + key", async () => {
    const { out, code } = await enable({ mode: "safe", json: true });
    expect(code).toBe(0);
    const payload = JSON.parse(out[0] as string);
    expect(payload.scope).toBe("exact");
    expect(payload.enabled).toBe(true);
    expect(payload.workspaceKey).toBe(encodeWorkspaceKey(NON_GIT_CWD));
  });

  it("D19: enabling aggressive in a floored repo prints a clamp notice", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "megasaver-floored-"));
    mkdirSync(join(cwd, ".megasaver"), { recursive: true });
    writeFileSync(join(cwd, ".megasaver", "policy.json"), JSON.stringify({ modeFloor: "balanced" }));
    const { code, err } = await enable({ mode: "aggressive", cwd });
    expect(code).toBe(0); // record still written; resolver clamps at read time
    expect(err.join("\n")).toContain('floors this repository at "balanced"');
    rmSync(cwd, { recursive: true, force: true });
  });
});

describe("workspace toggle — repository cwd → family scope", () => {
  let store: string;
  let root: string;
  beforeEach(() => {
    store = mkdtempSync(join(tmpdir(), "megasaver-cli-saver-fam-"));
    root = mkdtempSync(join(tmpdir(), "megasaver-cli-repo-"));
  });
  afterEach(() => {
    rmSync(store, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  });

  function makeRepoWithWorktree(): { mainCwd: string; worktreeCwd: string } {
    const gitDir = join(root, "repo", ".git");
    mkdirSync(join(gitDir, "objects"), { recursive: true });
    writeFileSync(join(gitDir, "HEAD"), "ref: refs/heads/main\n");
    const worktreeCwd = join(root, "repo", "wt");
    const admin = join(gitDir, "worktrees", "wt");
    mkdirSync(admin, { recursive: true });
    writeFileSync(join(admin, "HEAD"), "ref: refs/heads/wt\n");
    writeFileSync(join(admin, "commondir"), "../..\n");
    writeFileSync(join(admin, "gitdir"), `${join(worktreeCwd, ".git")}\n`);
    mkdirSync(worktreeCwd, { recursive: true });
    writeFileSync(join(worktreeCwd, ".git"), `gitdir: ${admin}\n`);
    return { mainCwd: join(root, "repo"), worktreeCwd };
  }

  const enable = async (cwd: string, exact = false) => {
    const out: string[] = [];
    const code = await runSessionSaverWorkspaceEnable({
      modeFlag: "balanced",
      exact,
      storeFlag: store,
      cwd,
      home: "/tmp",
      xdgDataHome: undefined,
      platform: process.platform,
      localAppData: undefined,
      stdout: (l) => out.push(l),
      stderr: () => {},
      json: false,
    });
    return { out, code };
  };

  it("enabling from the worktree activates the whole family", async () => {
    const { mainCwd, worktreeCwd } = makeRepoWithWorktree();
    const { out, code } = await enable(worktreeCwd);
    expect(code).toBe(0);
    expect(out.join("\n").toLowerCase()).toContain("repository family");
    // Both the main checkout and the worktree now resolve enabled.
    expect(resolveWorkspaceTokenSaverSettings(store, mainCwd, nodeResolverDeps()).enabled).toBe(
      true,
    );
    expect(resolveWorkspaceTokenSaverSettings(store, worktreeCwd, nodeResolverDeps()).enabled).toBe(
      true,
    );
  });

  it("--exact opts down to a this-checkout-only record inside a repo", async () => {
    const { mainCwd, worktreeCwd } = makeRepoWithWorktree();
    const { out } = await enable(worktreeCwd, true);
    expect(out.join("\n").toLowerCase()).toContain("this workspace only");
    // The worktree is enabled (its exact key) but the main checkout is not.
    expect(resolveWorkspaceTokenSaverSettings(store, worktreeCwd, nodeResolverDeps()).enabled).toBe(
      true,
    );
    expect(resolveWorkspaceTokenSaverSettings(store, mainCwd, nodeResolverDeps()).enabled).toBe(
      false,
    );
  });

  it("disabling the family from a worktree covers all worktrees", async () => {
    const { mainCwd, worktreeCwd } = makeRepoWithWorktree();
    await enable(worktreeCwd);
    const code = await runSessionSaverWorkspaceDisable({
      exact: false,
      storeFlag: store,
      cwd: mainCwd,
      home: "/tmp",
      xdgDataHome: undefined,
      platform: process.platform,
      localAppData: undefined,
      stdout: () => {},
      stderr: () => {},
      json: false,
    });
    expect(code).toBe(0);
    expect(resolveWorkspaceTokenSaverSettings(store, worktreeCwd, nodeResolverDeps()).enabled).toBe(
      false,
    );
  });
});

describe("session saver default", () => {
  let store: string;
  beforeEach(() => {
    store = mkdtempSync(join(tmpdir(), "megasaver-cli-saver-def-"));
  });
  afterEach(() => {
    rmSync(store, { recursive: true, force: true });
  });

  it("writes a global default that a non-Git workspace inherits", async () => {
    const out: string[] = [];
    const code = await runSessionSaverDefaultEnable({
      modeFlag: "safe",
      storeFlag: store,
      cwd: NON_GIT_CWD,
      home: "/tmp",
      xdgDataHome: undefined,
      platform: "linux",
      localAppData: undefined,
      stdout: (l) => out.push(l),
      stderr: () => {},
      json: false,
    });
    expect(code).toBe(0);
    const r = resolveWorkspaceTokenSaverSettings(store, "/some/other/dir", {
      platform: "linux",
      resolveGit: () => ({ kind: "not_git" }),
      caseModeOf: () => "sensitive",
      realpath: (p) => p,
      readPolicyFloor: () => null,
    });
    expect(r.enabled).toBe(true);
    expect(r.source).toBe("global");
  });
});

describe("sessionSaverCommand workspace wiring", () => {
  it("exposes workspace {enable,disable} and a default subcommand", () => {
    const sub = sessionSaverCommand.subCommands as Record<string, unknown>;
    expect(Object.keys(sub)).toContain("workspace");
    expect(Object.keys(sub)).toContain("default");
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    const ws = (sub["workspace"] as { subCommands?: Record<string, unknown> }).subCommands ?? {};
    expect(Object.keys(ws).sort()).toEqual(["disable", "enable"]);
  });
});
