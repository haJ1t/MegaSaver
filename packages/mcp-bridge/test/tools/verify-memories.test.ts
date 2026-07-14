import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CoreRegistry, createInMemoryCoreRegistry } from "@megasaver/core";
import type { MemoryEntryId, ProjectId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleSaveMemory } from "../../src/tools/save-memory.js";
import { VERIFY_MEMORIES_UPSELL, handleVerifyMemories } from "../../src/tools/verify-memories.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const TS = "2026-07-14T00:00:00.000Z";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

const AUTH_WITH_SYMBOL = `export function verifyToken(token: string): boolean {
  return token.length > 0;
}

export function otherHelper(): number {
  return 1;
}
`;

const AUTH_WITHOUT_SYMBOL = `export function otherHelper(): number {
  return 1;
}
`;

let repoDir: string;
beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "verify-memories-"));
  git(repoDir, "init", "-q");
  git(repoDir, "config", "user.email", "test@test.invalid");
  git(repoDir, "config", "user.name", "test");
  git(repoDir, "config", "commit.gpgsign", "false");
  mkdirSync(join(repoDir, "src"), { recursive: true });
  writeFileSync(join(repoDir, "src", "auth.ts"), AUTH_WITH_SYMBOL);
  git(repoDir, "add", ".");
  git(repoDir, "commit", "-q", "-m", "fixture: auth with verifyToken");
});
afterEach(() => rmSync(repoDir, { recursive: true, force: true }));

function registryAt(rootPath: string): CoreRegistry {
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath,
    createdAt: TS,
    updatedAt: TS,
  });
  return registry;
}

describe("verify_memories (Pro) — WOW loop", () => {
  it("returns the contradicted id after the anchored symbol is deleted", async () => {
    const registry = registryAt(repoDir);
    // Save an anchored memory through the real capture path (Task 14 wiring;
    // real git this time — no injected execGit).
    const saved = await handleSaveMemory(
      { registry, now: () => TS, newId: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      {
        projectId: PROJECT_ID,
        scope: "project",
        content: "verifyToken rejects empty tokens",
        type: "decision",
        relatedFiles: ["src/auth.ts"],
        relatedSymbols: ["verifyToken"],
      },
    );
    expect(registry.getMemoryEntry(saved.id as MemoryEntryId)?.anchor).toBeDefined();

    // Falsify: delete the symbol and commit.
    writeFileSync(join(repoDir, "src", "auth.ts"), AUTH_WITHOUT_SYMBOL);
    git(repoDir, "add", ".");
    git(repoDir, "commit", "-q", "-m", "refactor: drop verifyToken");

    const plan = await handleVerifyMemories(
      { registry, now: () => "2026-07-14T12:00:00.000Z", isPro: true },
      { projectId: PROJECT_ID },
    );
    if ("upsell" in plan) throw new Error("expected a VerifyPlan for pro tier");
    expect(plan.contradicted.map((c) => c.id)).toEqual([saved.id]);
    expect(registry.getMemoryEntry(saved.id as MemoryEntryId)?.stale).toBe(true);
  });

  it("free tier returns the upsell without running verification", async () => {
    const registry = registryAt(repoDir);
    const result = await handleVerifyMemories(
      { registry, now: () => TS, isPro: false },
      { projectId: PROJECT_ID },
    );
    expect(result).toEqual({ upsell: VERIFY_MEMORIES_UPSELL });
  });

  it("throws resource_not_found for an unknown project", async () => {
    const registry = createInMemoryCoreRegistry();
    await expect(
      handleVerifyMemories({ registry, now: () => TS, isPro: true }, { projectId: PROJECT_ID }),
    ).rejects.toMatchObject({ code: "resource_not_found" });
  });
});
