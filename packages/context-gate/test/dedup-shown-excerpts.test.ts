import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OutputExcerpt } from "@megasaver/output-filter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashContent } from "../src/read-index.js";
import { dedupShownExcerpts, recordShown } from "../src/shown-index.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "cg-dedup-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function excerpt(text: string): OutputExcerpt {
  return { text, startLine: 1, endLine: 1, score: 1, features: {} as OutputExcerpt["features"] };
}

describe("dedupShownExcerpts", () => {
  it("empty index: keeps all, suppressed 0, queues all to record", () => {
    const ex = [excerpt("alpha"), excerpt("beta")];
    const dd = dedupShownExcerpts({ sessionDir: dir, currentChunkSetId: "cs-now", excerpts: ex });
    expect(dd.excerpts.map((e) => e.text)).toEqual(["alpha", "beta"]);
    expect(dd.suppressed).toBe(0);
    expect(dd.priorChunkSetIds).toEqual([]);
    expect(dd.recordEntries).toEqual([
      { textHash: hashContent("alpha"), chunkSetId: "cs-now" },
      { textHash: hashContent("beta"), chunkSetId: "cs-now" },
    ]);
  });
  it("exact prior hit: suppressed and references the prior chunk-set id", () => {
    recordShown(dir, [{ textHash: hashContent("alpha"), chunkSetId: "cs-A" }]);
    const dd = dedupShownExcerpts({
      sessionDir: dir,
      currentChunkSetId: "cs-now",
      excerpts: [excerpt("alpha"), excerpt("beta")],
    });
    expect(dd.excerpts.map((e) => e.text)).toEqual(["beta"]);
    expect(dd.suppressed).toBe(1);
    expect(dd.priorChunkSetIds).toEqual(["cs-A"]);
    expect(dd.recordEntries).toEqual([{ textHash: hashContent("beta"), chunkSetId: "cs-now" }]);
  });
  it("distinct priorChunkSetIds, first-seen order, no dupes", () => {
    recordShown(dir, [
      { textHash: hashContent("a"), chunkSetId: "cs-A" },
      { textHash: hashContent("b"), chunkSetId: "cs-A" },
      { textHash: hashContent("c"), chunkSetId: "cs-B" },
    ]);
    const dd = dedupShownExcerpts({
      sessionDir: dir,
      currentChunkSetId: "cs-now",
      excerpts: [excerpt("a"), excerpt("b"), excerpt("c"), excerpt("d")],
    });
    expect(dd.excerpts.map((e) => e.text)).toEqual(["d"]);
    expect(dd.suppressed).toBe(3);
    expect(dd.priorChunkSetIds).toEqual(["cs-A", "cs-B"]);
  });
  it("in-batch duplicate: first kept+queued, second suppressed vs current chunk-set", () => {
    const dd = dedupShownExcerpts({
      sessionDir: dir,
      currentChunkSetId: "cs-now",
      excerpts: [excerpt("same"), excerpt("same")],
    });
    expect(dd.excerpts.map((e) => e.text)).toEqual(["same"]);
    expect(dd.suppressed).toBe(1);
    expect(dd.priorChunkSetIds).toEqual(["cs-now"]);
    expect(dd.recordEntries).toEqual([{ textHash: hashContent("same"), chunkSetId: "cs-now" }]);
  });
  it("does NOT suppress when the matched row has an empty chunkSetId (corrupt row)", () => {
    recordShown(dir, [{ textHash: hashContent("alpha"), chunkSetId: "" }]);
    const dd = dedupShownExcerpts({
      sessionDir: dir,
      currentChunkSetId: "cs-now",
      excerpts: [excerpt("alpha")],
    });
    expect(dd.excerpts.map((e) => e.text)).toEqual(["alpha"]);
    expect(dd.suppressed).toBe(0);
  });
});
