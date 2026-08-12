import { describe, expect, it } from "vitest";
import {
  MAX_CLAIMED_PATHS,
  MAX_DISCLOSURE_INPUT_BYTES,
  extractClaimedPaths,
} from "../src/commands/session/disclosure/path-claims.js";

// Guard recipe ([[concepts/redos-guard-testing]]): size at the shipped cap,
// n-vs-4n growth ratio on min-of-repeats, non-vacuity match floor, no lower
// runtime bound. Revert-proof: relaxing any bound ({1,256} -> *, {1,64} -> +,
// dropping the {1,8} segment cap) must turn THIS test red alone —
// proven manually before commit, one bound at a time.
const REPEATS = 5;
const RATIO_LIMIT = 8;

function adversarialBlock(): string {
  const anchors = [
    "`src/real/anchor.ts`",
    "+++ b/apps/cli/src/main.ts",
    "touched packages/policy/src/redact.ts",
  ].join("\n");
  const backtickTease = "`".repeat(512);
  const slashTease = `${"a/".repeat(2048)}${"-".repeat(64)}`;
  const headerTease = `diff --git a/${"x".repeat(4096)} `;
  return [anchors, backtickTease, slashTease, headerTease].join("\n");
}

function corpusOfBytes(target: number): string {
  const block = `${adversarialBlock()}\n`;
  return block.repeat(Math.ceil(target / Buffer.byteLength(block))).slice(0, target);
}

function minRuntimeMs(text: string): number {
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < REPEATS; i += 1) {
    const start = performance.now();
    extractClaimedPaths(text);
    min = Math.min(min, performance.now() - start);
  }
  return min;
}

describe("path-claims ReDoS guard", () => {
  it("scales linearly from n to 4n at the shipped cap", () => {
    const small = corpusOfBytes(MAX_DISCLOSURE_INPUT_BYTES / 4);
    const large = corpusOfBytes(MAX_DISCLOSURE_INPUT_BYTES);
    const smallCount = extractClaimedPaths(small).length;
    const largeCount = extractClaimedPaths(large).length;
    expect(smallCount).toBeGreaterThanOrEqual(3);
    expect(largeCount).toBeLessThan(MAX_CLAIMED_PATHS);
    const tSmall = minRuntimeMs(small);
    const tLarge = minRuntimeMs(large);
    expect(tLarge / Math.max(tSmall, 5)).toBeLessThan(RATIO_LIMIT);
  }, 120_000);
});
