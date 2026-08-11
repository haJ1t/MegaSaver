import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runSweepQuarantine } from "../../src/commands/sweep/quarantine.js";
import { runSweepRestore } from "../../src/commands/sweep/restore.js";
import { runSweepScan } from "../../src/commands/sweep/scan.js";
import { ensureStoreReady } from "../../src/store.js";

let storeRoot: string;
let repoRoot: string;

beforeEach(async () => {
  storeRoot = mkdtempSync(join(tmpdir(), "cli-sweep-store-"));
  repoRoot = mkdtempSync(join(tmpdir(), "cli-sweep-repo-"));
  execSync("git init -q", { cwd: repoRoot });
  execSync('git config user.email "test@test.com"', { cwd: repoRoot });
  execSync('git config user.name "Test"', { cwd: repoRoot });
  writeFileSync(join(repoRoot, "README.md"), "hello\n");
  execSync("git add .", { cwd: repoRoot });
  execSync('git commit -m "init" -q', { cwd: repoRoot });
  const { registry } = await ensureStoreReady(storeRoot);
  registry.createProject({
    id: "22222222-2222-4222-8222-222222222222",
    name: "sweep-it",
    rootPath: repoRoot,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as never);
});

afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
  rmSync(repoRoot, { recursive: true, force: true });
});

describe("mega sweep", () => {
  it("scan finds tmp and build-output", async () => {
    writeFileSync(join(repoRoot, "a.tmp"), "x\n");
    writeFileSync(join(repoRoot, "dist-out.js"), "y\n");
    // dist/out.js is under dist/ only if we create dist dir
    const lines: string[] = [];
    const code = await runSweepScan({
      cwd: repoRoot,
      home: tmpdir(),
      storeFlag: storeRoot,
      xdgDataHome: undefined,
      platform: "linux" as NodeJS.Platform,
      localAppData: undefined,
      json: false,
      stdout: (l) => lines.push(l),
      stderr: () => {},
    });
    expect(code).toBe(0);
    const out = lines.join("\n");
    expect(out).toContain("a.tmp");
  });

  it("quarantine moves and restore brings back", async () => {
    writeFileSync(join(repoRoot, "b.tmp"), "content\n");
    const { quarantineFiles, restoreQuarantine, readQuarantineManifest } = await import(
      "../../src/sweep/quarantine.js"
    );
    const manifest = quarantineFiles({
      repoRoot,
      entries: [{ relPath: "b.tmp" }],
      snapshotId: null,
      now: () => Date.now(),
    });
    expect(manifest.entries).toHaveLength(1);
    expect(existsSync(join(repoRoot, "b.tmp"))).toBe(false);
    expect(existsSync(join(repoRoot, ".megasaver", "quarantine", manifest.id))).toBe(true);
    const loaded = readQuarantineManifest(repoRoot, manifest.id);
    expect(loaded).not.toBeNull();
    if (!loaded) throw new Error("manifest should exist");
    const result = restoreQuarantine({ repoRoot, manifest: loaded });
    expect(result.moved).toBe(1);
    expect(existsSync(join(repoRoot, "b.tmp"))).toBe(true);
  });

  it("fenced file is skipped", async () => {
    // .megasaver/quarantine itself should be ignored
    const lines: string[] = [];
    await runSweepScan({
      cwd: repoRoot,
      home: tmpdir(),
      storeFlag: storeRoot,
      xdgDataHome: undefined,
      platform: "linux" as NodeJS.Platform,
      localAppData: undefined,
      json: true,
      stdout: (l) => lines.push(l),
      stderr: () => {},
    });
    const parsed = JSON.parse(lines.join(""));
    expect(
      parsed.ranked.every(
        (r: { relPath: string }) => !r.relPath.startsWith(".megasaver/quarantine"),
      ),
    ).toBe(true);
  });
});
