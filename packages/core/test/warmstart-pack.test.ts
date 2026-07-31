import { describe, expect, it } from "vitest";
import { generateWarmStartContextPack } from "../src/warmstart-pack.js";

describe("warmstart-pack (Scaffold Check)", () => {
  it("generates byte-stable context pack under token limit and returns canonical hash", async () => {
    const pack1 = await generateWarmStartContextPack("refactor memory module", {
      maxTokens: 4000,
      timeoutMs: 500,
      repoMapSummary: "packages: core, stats, warmstart",
      candidateFiles: ["packages/core/src/index.ts"],
    });

    const pack2 = await generateWarmStartContextPack("refactor memory module", {
      maxTokens: 4000,
      timeoutMs: 500,
      repoMapSummary: "packages: core, stats, warmstart",
      candidateFiles: ["packages/core/src/index.ts"],
    });

    expect(pack1.isTimedOut).toBe(false);
    expect(pack1.additionalContext).toContain("repo_map_summary");
    expect(pack1.additionalContext).toContain("packages/core/src/index.ts");
    expect(pack1.characterCount).toBeLessThanOrEqual(16000);
    expect(pack1.isScaffold).toBe(true);

    // Session byte-stability invariant (DZ2)
    expect(pack1.contentHash).toBe(pack2.contentHash);
    expect(pack1.additionalContext).toBe(pack2.additionalContext);
  });

  it("falls back to empty payload on 1ms timeout deadline", async () => {
    const pack = await generateWarmStartContextPack("slow build task", {
      maxTokens: 4000,
      timeoutMs: 0, // Force immediate timeout fallback
      repoMapSummary: "x".repeat(100000),
    });

    expect(pack.isTimedOut).toBe(true);
    expect(pack.additionalContext).toBe("");
    expect(pack.characterCount).toBe(0);
  });

  it("physically truncates context payload to fit maxTokens limit", async () => {
    const hugeRepoMap = "a".repeat(20000); // ~5000 tokens
    const pack = await generateWarmStartContextPack("large payload", {
      maxTokens: 500, // Small limit
      timeoutMs: 500,
      repoMapSummary: hugeRepoMap,
    });

    expect(pack.additionalContext.length).toBeLessThanOrEqual(2000); // 500 tokens * 4 chars
    expect(pack.characterCount).toBeLessThanOrEqual(2000);
  });
});
