import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashContent, hashPath, loadReadIndex, recordRead } from "../src/read-index.js";

let sessionDir: string;
beforeEach(() => {
  sessionDir = mkdtempSync(join(tmpdir(), "mega-readidx-guard-"));
});
afterEach(() => {
  rmSync(sessionDir, { recursive: true, force: true });
});

// Guard for the read-index short-circuit in run.ts (runOutputPipeline :121-130,
// runOverlayOutputPipeline :300-311): a re-read whose content CHANGED must
// never be served the prior chunk set. Mirrors exactly how run.ts consumes the
// helpers: prior = loadReadIndex(dir)[hashPath(abs)]; short-circuit iff
// prior.contentHash === hashContent(raw); fresh path calls recordRead (:186).
describe("read-index short-circuit invalidation (proxy guard)", () => {
  const ABS = "/repo/src/app.ts";
  const V1 = "export const a = 1;\n";
  const V2 = "export const a = 2;\n";

  it("changed content MUST NOT short-circuit to the prior chunk set", () => {
    const pathHash = hashPath(ABS);
    recordRead(sessionDir, pathHash, { contentHash: hashContent(V1), chunkSetId: "cs-v1" });
    // exactly the run.ts comparison:
    const prior = loadReadIndex(sessionDir)[pathHash];
    const shortCircuits = prior !== undefined && prior.contentHash === hashContent(V2);
    expect(shortCircuits).toBe(false);
    // the fresh-read path then refreshes the index (run.ts:186):
    recordRead(sessionDir, pathHash, { contentHash: hashContent(V2), chunkSetId: "cs-v2" });
    expect(loadReadIndex(sessionDir)[pathHash]).toEqual({
      contentHash: hashContent(V2),
      chunkSetId: "cs-v2",
    });
  });

  it("unchanged content DOES short-circuit to the prior chunk set", () => {
    const pathHash = hashPath(ABS);
    recordRead(sessionDir, pathHash, { contentHash: hashContent(V1), chunkSetId: "cs-v1" });
    const prior = loadReadIndex(sessionDir)[pathHash];
    const shortCircuits = prior !== undefined && prior.contentHash === hashContent(V1);
    expect(shortCircuits).toBe(true);
    expect(prior?.chunkSetId).toBe("cs-v1");
  });

  it("outline reads key a separate slot — a full-read marker cannot suppress an outline", () => {
    // run.ts keys outline reads as hashPath(`${abs}\0outline`); the \0 separator
    // is illegal in filesystem paths on every OS so it can never collide.
    recordRead(sessionDir, hashPath(ABS), { contentHash: hashContent(V1), chunkSetId: "cs-full" });
    expect(loadReadIndex(sessionDir)[hashPath(`${ABS}\0outline`)]).toBeUndefined();
  });
});
