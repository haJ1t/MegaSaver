import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CoreRegistry, createInMemoryCoreRegistry } from "@megasaver/core";
import type { ProjectId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { handleReviewPack } from "../src/tools/review-pack.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const NOW = "2026-08-06T10:00:00.000Z";

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: join(tmpdir(), "megasaver-no-gitconfig"),
  GIT_CONFIG_NOSYSTEM: "1",
};
const git = (dir: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd: dir, encoding: "utf8", env: GIT_ENV });

function stubRegistry(repoPath: string = "/tmp/none"): CoreRegistry {
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID,
    name: "fixture",
    rootPath: repoPath,
    createdAt: NOW,
    updatedAt: NOW,
  });
  return registry;
}

function initFixtureRepo(dir: string): void {
  git(dir, "init");
  git(dir, "checkout", "-b", "main");
  git(dir, "config", "user.email", "test@megasaver.dev");
  git(dir, "config", "user.name", "Test");
  writeFileSync(join(dir, "a.ts"), "export const a = 1;\n");
  git(dir, "add", "a.ts");
  git(dir, "commit", "-m", "feat: seed");
  git(dir, "checkout", "-b", "feat/y");
  writeFileSync(
    join(dir, "a.ts"),
    'export const a = 2;\nexport const K = "AKIAIOSFODNN7EXAMPLE";\n',
  );
  git(dir, "add", "a.ts");
  git(dir, "commit", "-m", "fix: bump a and secret");
}

describe("review_pack tool", () => {
  it("rejects malformed args", async () => {
    await expect(
      handleReviewPack(
        { registry: stubRegistry(), storeRoot: "/tmp/none" } as never,
        { nope: 1 },
      ),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("builds a pack for a registered project and returns three chunk-set ids", async () => {
    const repo = mkdtempSync(join(tmpdir(), "megasaver-mcp-repo-"));
    const store = mkdtempSync(join(tmpdir(), "megasaver-mcp-store-"));
    try {
      initFixtureRepo(repo);
      const registry = stubRegistry(repo);
      const result = await handleReviewPack(
        { registry, storeRoot: store },
        {
          projectId: PROJECT_ID,
          range: "main..HEAD",
        },
      );
      expect(Object.keys(result.chunkSets).sort()).toEqual([
        "context",
        "diff",
        "manifest",
      ]);
      expect(result.digest).not.toContain("AKIAIOSFODNN7EXAMPLE");
    } finally {
      for (const d of [repo, store]) rmSync(d, { recursive: true, force: true });
    }
  });
});
