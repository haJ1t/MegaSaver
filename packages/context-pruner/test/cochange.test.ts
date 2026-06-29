import type { CodeBlock } from "@megasaver/indexer";
import { codeBlockSchema } from "@megasaver/indexer";
import type { ProjectId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { coChangeStrength, parseNumstat } from "../src/cochange.js";
import { scoreBlocks } from "../src/score.js";

const PROJECT_ID = "00000000-0000-4000-8000-0000000000c0" as ProjectId;
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
    contentHash: `hcc${n}`,
    imports: over.imports ?? [],
    exports: over.exports ?? [],
    calls: over.calls ?? [],
    calledBy: [],
    keywords: over.keywords ?? [],
  });
}

// `git log --numstat` prints a commit header line then numstat rows; commits
// are blank-line separated; each numstat row is `<added>\t<deleted>\t<path>`.
// a.ts and migrations/001.sql appear together in THREE commits; b.ts co-changes
// with a.ts only ONCE; z.ts never with a.ts.
const FIXTURE = [
  "commit 1\n1\t1\ta.ts\n2\t0\tmigrations/001.sql",
  "commit 2\n3\t4\ta.ts\n1\t1\tmigrations/001.sql\n5\t0\tb.ts",
  "commit 3\n0\t2\ta.ts\n3\t1\tmigrations/001.sql",
  "commit 4\n9\t9\tz.ts",
].join("\n\n");

describe("parseNumstat", () => {
  it("computes co-change pairs and frequencies from a numstat fixture", () => {
    const map = parseNumstat(FIXTURE);
    expect(map.coChange.get("a.ts")?.get("migrations/001.sql")).toBe(3);
    expect(map.coChange.get("migrations/001.sql")?.get("a.ts")).toBe(3);
    expect(map.coChange.get("a.ts")?.get("b.ts")).toBe(1);
    expect(map.coChange.get("a.ts")?.has("z.ts")).toBe(false);
  });

  it("accumulates per-file churn as summed added+deleted", () => {
    const map = parseNumstat(FIXTURE);
    // a.ts: (1+1) + (3+4) + (0+2) = 11
    expect(map.churn.get("a.ts")).toBe(11);
    // migrations/001.sql: (2+0) + (1+1) + (3+1) = 8
    expect(map.churn.get("migrations/001.sql")).toBe(8);
    expect(map.churn.get("z.ts")).toBe(18);
  });

  it("ignores binary rows (- - path) and blank/garbage lines", () => {
    const map = parseNumstat("added\n-\t-\tasset.bin\n1\t1\tsrc/a.ts\n\n\n");
    expect(map.churn.has("asset.bin")).toBe(false);
    expect(map.churn.get("src/a.ts")).toBe(2);
  });

  it("returns empty maps for empty input", () => {
    const map = parseNumstat("");
    expect(map.coChange.size).toBe(0);
    expect(map.churn.size).toBe(0);
  });
});

describe("coChangeStrength", () => {
  it("is 0 when changedFiles is empty", () => {
    const map = parseNumstat(FIXTURE);
    expect(coChangeStrength(map, "migrations/001.sql", [])).toBe(0);
  });

  it("is 0 for a file that never co-changed with the edit site", () => {
    const map = parseNumstat(FIXTURE);
    expect(coChangeStrength(map, "z.ts", ["a.ts"])).toBe(0);
  });

  it("is positive and stronger for a file that co-changes more often", () => {
    const map = parseNumstat(FIXTURE);
    const strong = coChangeStrength(map, "migrations/001.sql", ["a.ts"]);
    const weak = coChangeStrength(map, "b.ts", ["a.ts"]);
    expect(strong).toBeGreaterThan(0);
    expect(weak).toBeGreaterThan(0);
    expect(strong).toBeGreaterThan(weak);
    expect(strong).toBeLessThanOrEqual(1);
  });
});

describe("scoreBlocks — co-change factor", () => {
  it("raises a co-changing block's score above its no-history baseline", () => {
    const mig = block({ name: "up", filePath: "migrations/001.sql", keywords: ["unrelated"] });

    const withHistory = scoreBlocks({
      task: "zzqqxx_nomatch",
      blocks: [mig],
      changedFiles: ["a.ts"],
      coChangeLog: FIXTURE,
    });
    const baseline = scoreBlocks({
      task: "zzqqxx_nomatch",
      blocks: [mig],
      changedFiles: ["a.ts"],
    });

    const withF = withHistory.find((s) => s.block.name === "up");
    const baseF = baseline.find((s) => s.block.name === "up");
    expect(withF?.factors.coChangeRelevance).toBeGreaterThan(0);
    expect(baseF?.factors.coChangeRelevance).toBe(0);
    expect(withF?.score).toBeGreaterThan(baseF?.score ?? 99);
  });

  it("leaves an unrelated file's co-change factor at 0", () => {
    const z = block({ name: "zfn", filePath: "z.ts" });
    const scored = scoreBlocks({
      task: "zzqqxx_nomatch",
      blocks: [z],
      changedFiles: ["a.ts"],
      coChangeLog: FIXTURE,
    });
    expect(scored.find((s) => s.block.name === "zfn")?.factors.coChangeRelevance).toBe(0);
  });

  it("empty/absent history is a no-op: ranking byte-identical, no throw", () => {
    const blocks = [
      block({ name: "alpha", filePath: "a.ts", keywords: ["auth"] }),
      block({ name: "beta", filePath: "migrations/001.sql", keywords: ["config"] }),
      block({ name: "gamma", filePath: "z.ts", keywords: ["misc"] }),
    ];
    const args = { task: "auth config", blocks, changedFiles: ["a.ts"] };

    const noLog = scoreBlocks(args);
    const emptyLog = scoreBlocks({ ...args, coChangeLog: "" });

    expect(emptyLog.map((s) => s.block.id)).toEqual(noLog.map((s) => s.block.id));
    expect(emptyLog.map((s) => s.score)).toEqual(noLog.map((s) => s.score));
    expect(emptyLog.every((s) => s.factors.coChangeRelevance === 0)).toBe(true);
  });
});
