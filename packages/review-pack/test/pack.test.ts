import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadOverlayChunkSet } from "@megasaver/content-store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReviewPackError } from "../src/errors.js";
import { buildReviewPack } from "../src/pack.js";
import { git, initFixtureRepo } from "./fixture.js";

describe("buildReviewPack", () => {
  let repo: string;
  let store: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "megasaver-rp-pack-"));
    store = mkdtempSync(join(tmpdir(), "megasaver-rp-store-"));
    initFixtureRepo(repo);
    git(repo, "checkout", "-b", "feat/x");
    writeFileSync(join(repo, "alpha.ts"), "export function alpha(): number {\n  return 42;\n}\n");
    git(repo, "add", "alpha.ts");
    git(repo, "commit", "-m", "fix(core): alpha returns 42");
  });
  afterEach(() => {
    for (const d of [repo, store]) rmSync(d, { recursive: true, force: true });
  });

  it("persists three expandable chunk sets and returns their ids", async () => {
    const pack = await buildReviewPack({ repoRoot: repo, storeRoot: store, range: "main..HEAD" });
    expect(pack.claims.claims[0]?.subject).toBe("fix(core): alpha returns 42");
    const diffSet = await loadOverlayChunkSet({
      storeRoot: store,
      workspaceKey: pack.workspaceKey,
      liveSessionId: `review-${pack.packId}`,
      chunkSetId: pack.chunkSets.diff,
    });
    expect(diffSet.redacted).toBe(true);
    expect(diffSet.chunks.some((c) => c.text.includes("return 42"))).toBe(true);
    expect(pack.digest).toContain("mega output chunk");
  });

  it("redacts secrets out of the digest and the stored diff", async () => {
    writeFileSync(join(repo, "leak.ts"), 'export const K = "AKIAIOSFODNN7EXAMPLE";\n');
    git(repo, "add", "leak.ts");
    git(repo, "commit", "-m", "chore: add config");
    const pack = await buildReviewPack({ repoRoot: repo, storeRoot: store, range: "main..HEAD" });
    expect(pack.digest).not.toContain("AKIAIOSFODNN7EXAMPLE");
    const diffSet = await loadOverlayChunkSet({
      storeRoot: store,
      workspaceKey: pack.workspaceKey,
      liveSessionId: `review-${pack.packId}`,
      chunkSetId: pack.chunkSets.diff,
    });
    expect(diffSet.chunks.every((c) => !c.text.includes("AKIAIOSFODNN7EXAMPLE"))).toBe(true);
  });

  it("fails closed on a dirty tree with nothing persisted", async () => {
    writeFileSync(join(repo, "alpha.ts"), "// dirty\n");
    await expect(
      buildReviewPack({ repoRoot: repo, storeRoot: store, range: "main..HEAD" }),
    ).rejects.toThrow(ReviewPackError);
    const contentRoot = join(store, "content");
    expect(!existsSync(contentRoot) || readdirSync(contentRoot).length === 0).toBe(true);
  });

  it("throws empty_diff for an empty range", async () => {
    await expect(
      buildReviewPack({ repoRoot: repo, storeRoot: store, range: "HEAD..HEAD" }),
    ).rejects.toMatchObject({ code: "empty_diff" });
  });

  it("removes earlier sets when a later save fails (no partial pack)", async () => {
    const { persistPack } = await import("../src/persist.js");
    const saved: string[] = [];
    const removed: string[] = [];
    const failingDeps = {
      save: async ({ chunkSet }: { storeRoot: string; chunkSet: { chunkSetId: string } }) => {
        if (saved.length === 1) throw new Error("disk full");
        saved.push(chunkSet.chunkSetId);
      },
      remove: async ({ chunkSetId }: { chunkSetId: string }) => {
        removed.push(chunkSetId);
      },
    };
    await expect(
      persistPack({
        storeRoot: store,
        workspaceKey: "0123456789abcdef",
        liveSessionId: "review-rp-000000000000",
        createdAt: "2026-08-06T12:00:00.000Z",
        rangeLabel: "main..HEAD",
        sets: fakeSets(),
        deps: failingDeps as never,
      }),
    ).rejects.toMatchObject({ code: "store_write_failed" });
    expect(removed).toEqual(saved);
  });
});

function fakeSets() {
  const make = (suffix: "diff" | "context" | "manifest") => ({
    chunkSetId: `rp-000000000000-${suffix}`,
    liveSessionId: "review-rp-000000000000",
    workspaceKey: "0123456789abcdef",
    createdAt: "2026-08-06T12:00:00.000Z",
    source: { kind: "command" as const, command: "mega", args: ["review", "pack", "main..HEAD"] },
    rawBytes: 1,
    redacted: true,
    chunks: [{ id: "0", startLine: 1, endLine: 1, bytes: 1, text: "x" }],
  });
  return { diff: make("diff"), context: make("context"), manifest: make("manifest") };
}
