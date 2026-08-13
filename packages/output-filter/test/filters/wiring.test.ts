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

  it("a matched filter that recognizes nothing stays a generic no-op", async () => {
    const raw = Array.from(
      { length: 400 },
      (_, i) => `commit line ${i} with a full-format body`,
    ).join("\n");
    const res = await filterOutput({
      raw,
      mode: "balanced",
      ...FORCE,
      source: { kind: "command", command: "git", args: ["log"] },
    });
    expect(res.compressor).toBe("generic");
    // Spec Testing row: the no-op path keeps provenance — no filter rewrote
    // lines, so surviving excerpts still carry raw coordinates.
    expect(res.excerpts.length).toBeGreaterThan(0);
    expect(res.excerpts.every((e) => e.rawStartLine !== undefined)).toBe(true);
  });

  it("an applied filter skips simhash dedupe — every distinct row survives", async () => {
    const HEADER = "CONTAINER ID   IMAGE   COMMAND   CREATED   STATUS   PORTS   NAMES";
    const psRow = (image: string, name: string): string =>
      `id-${name}   ${image}   "entry"   long ago   Up long   none   ${name}`;
    const raw = [
      HEADER,
      // 10 consecutive same-image replicas: the filter folds 7 behind its
      // counted marker, so commandFilterApplied is true.
      ...Array.from({ length: 10 }, (_, i) => psRow("noise:1", `noise-${i}`)),
      // 84 near-identical rows with DISTINCT images: the filter keeps every
      // one, they chunk into near-identical 40-line windows, and absent the
      // commandFilterApplied disjunct simhash dedupe would fold the later
      // windows — erasing distinct evidence.
      ...Array.from({ length: 84 }, (_, i) => psRow(`svc-${i}:v1`, `svc-${i}`)),
    ].join("\n");
    const res = await filterOutput({
      raw,
      mode: "balanced",
      ...FORCE,
      // Budget out of the way (an explicit caller cap wins in targetBudget,
      // fit.ts): dedupe is then the ONLY step that could drop a kept row.
      maxReturnedBytes: 64_000,
      source: { kind: "command", command: "docker", args: ["ps"] },
    });
    expect(res.compressor).toBe("docker-ps");
    const delivered = res.excerpts.map((e) => e.text).join("\n");
    expect(delivered).toContain("… [7 similar: noise:1]");
    for (const name of Array.from({ length: 84 }, (_, i) => `svc-${i}`)) {
      expect(delivered).toContain(psRow(`${name}:v1`, name));
    }
  });
});
