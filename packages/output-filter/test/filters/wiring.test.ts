import { describe, expect, it } from "vitest";
import { filterOutput } from "../../src/index.js";

// Force the compressed band on modest fixtures (schema fields verified in
// filterOutputInputSchema): rawTokens >= 1 always lands in "compressed".
const FORCE = { passthroughThresholdTokens: 1, hardWrapThresholdTokens: 1 } as const;

const STATUS = [
  "On branch main",
  "Changes not staged for commit:",
  '  (use "git add <file>..." to update what will be committed)',
  ...Array.from({ length: 80 }, (_, i) => `\tmodified:   src/mod-${i}.ts`),
].join("\n");

describe("command-filter registry wiring", () => {
  it("registry preempts the diff category compressor for git status", async () => {
    const res = await filterOutput({
      raw: STATUS,
      mode: "balanced",
      ...FORCE,
      source: { kind: "command", command: "git", args: ["status"] },
    });
    expect(res.classification.category).toBe("diff");
    expect(res.compressor).toBe("git-status");
    // a filter rewrites lines — raw coordinates are no longer promised
    expect(res.excerpts.every((e) => e.rawStartLine === undefined)).toBe(true);
  });

  it("passthrough band never invokes a filter", async () => {
    const res = await filterOutput({
      raw: "On branch main\nnothing to commit, working tree clean",
      mode: "balanced",
      source: { kind: "command", command: "git", args: ["status"] },
    });
    expect(res.decision).toBe("passthrough");
    expect(res.compressor).toBe("generic");
  });
});
