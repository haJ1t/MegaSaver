import type { CodeBlock } from "@megasaver/indexer";
import { codeBlockSchema } from "@megasaver/indexer";
import type { ProjectId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { type ScoredCandidate, scoreBlocks } from "../src/score.js";
import { WEIGHTS } from "../src/weights.js";

const PROJECT_ID = "00000000-0000-4000-8000-000000000001" as ProjectId;
let n = 0;

function block(over: Partial<CodeBlock> & { name: string; filePath: string }): CodeBlock {
  n += 1;
  return codeBlockSchema.parse({
    id: `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`,
    projectId: PROJECT_ID,
    filePath: over.filePath,
    startLine: over.startLine ?? 1,
    endLine: over.endLine ?? 10,
    blockType: over.blockType ?? "function",
    name: over.name,
    contentHash: `h${n}`,
    imports: over.imports ?? [],
    exports: over.exports ?? [],
    calls: over.calls ?? [],
    calledBy: [],
    keywords: over.keywords ?? [],
  });
}

function find(scored: ScoredCandidate[], name: string): ScoredCandidate | undefined {
  return scored.find((s) => s.block.name === name);
}

describe("scoreBlocks", () => {
  it("ranks semantic matches above unrelated blocks", () => {
    const scored = scoreBlocks({
      task: "jwt auth middleware",
      blocks: [
        block({
          name: "validateToken",
          filePath: "src/auth.ts",
          keywords: ["jwt", "auth", "middleware"],
        }),
        block({ name: "Navbar", filePath: "src/nav.tsx", keywords: ["ui", "header"] }),
      ],
    });
    expect(find(scored, "validateToken")?.factors.semanticRelevance).toBeGreaterThan(
      find(scored, "Navbar")?.factors.semanticRelevance ?? 1,
    );
  });

  it("userMention is set and near-decisive when the task names a symbol", () => {
    const scored = scoreBlocks({
      task: "fix validateToken so it rejects expired tokens",
      blocks: [block({ name: "validateToken", filePath: "src/auth.ts" })],
    });
    const hit = find(scored, "validateToken");
    expect(hit?.factors.userMentionRelevance).toBe(1);
    expect(hit?.score).toBeGreaterThanOrEqual(WEIGHTS.userMention);
  });

  it("flags failing-test, changed-file and memory relevance from inputs", () => {
    const scored = scoreBlocks({
      task: "unrelated",
      blocks: [block({ name: "a", filePath: "src/a.ts" })],
      failingTests: ["src/a.ts"],
      changedFiles: ["src/a.ts"],
      memoryFiles: ["src/a.ts"],
    });
    const f = find(scored, "a")?.factors;
    expect(f?.testFailureRelevance).toBe(1);
    expect(f?.recentEditRelevance).toBe(1);
    expect(f?.memoryRelevance).toBe(1);
  });

  it("penalizes stale and noise below a clean block", () => {
    const scored = scoreBlocks({
      task: "config",
      blocks: [
        block({ name: "clean", filePath: "src/config.ts", keywords: ["config"] }),
        block({
          name: "lockfile",
          filePath: "pnpm-lock.yaml",
          blockType: "config",
          keywords: ["config"],
        }),
        block({
          name: "staleDoc",
          filePath: "docs/old.md",
          blockType: "docs",
          keywords: ["config"],
        }),
      ],
      staleFiles: ["docs/old.md"],
    });
    expect(find(scored, "lockfile")?.factors.noisePenalty).toBe(1);
    expect(find(scored, "staleDoc")?.factors.stalePenalty).toBe(1);
    expect(find(scored, "clean")?.score).toBeGreaterThan(find(scored, "lockfile")?.score ?? 99);
    expect(find(scored, "clean")?.score).toBeGreaterThan(find(scored, "staleDoc")?.score ?? 99);
  });

  it("yields zero semantic relevance when nothing matches the task", () => {
    const scored = scoreBlocks({
      task: "zzqqxx nonsense",
      blocks: [block({ name: "a", filePath: "src/a.ts", keywords: ["auth"] })],
    });
    expect(scored.every((s) => s.factors.semanticRelevance === 0)).toBe(true);
  });

  it("exposes weights as named constants", () => {
    expect(WEIGHTS.userMention).toBeGreaterThan(WEIGHTS.semantic);
    expect(WEIGHTS.testFailure).toBeGreaterThan(WEIGHTS.recentEdit);
  });
});
