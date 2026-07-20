import { describe, expect, it } from "vitest";
import { buildVerdict, checkTransformIntegrity, costRatioOf } from "../src/report.js";
import { prepareArms } from "../src/transform.js";
import type { ApplySaver } from "../src/transform.js";
import type { PairResult, RecordedRequest, ReplayOrder } from "../src/types.js";
import { rawOutput, savedOutput } from "./saver-output-fixture.js";

// ROUND 4's finding, and the reason this file exists: every guard the harness had
// constrained a conversation-wide AGGREGATE, while a saver is broken PER CALL.
// The two aggregate axes (applied fraction, byte ratio) trade off freely, so any
// destructive transform could be moved inside the band by shrinking its blast
// radius. The fix is a per-call contract, checked once per distinct tool call at
// the one layer that still sees each raw beside its replacement.

// One request carrying `sizes.length` tool_use/tool_result pairs. A single
// request is enough: the saver's cardinality is per distinct tool_use_id, not
// per request.
function recording(sizes: readonly number[]): RecordedRequest[] {
  const messages: unknown[] = [];
  for (const [i, bytes] of sizes.entries()) {
    messages.push({
      role: "assistant",
      content: [{ type: "tool_use", id: `t${i}`, name: "Bash", input: { command: "ls" } }],
    });
    messages.push({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: `t${i}`, content: rawOutput(i, bytes) }],
    });
  }
  return [{ model: "claude-opus-4-8", messages }];
}

const arm = (cost: number) => ({
  arm: "baseline" as const,
  inputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  outputTokens: 0,
  normalizedCostUsd: cost,
  startedAtMs: 0,
  finishedAtMs: 1,
  perRequest: [],
});

const pair = (
  baselineCost: number,
  megasaverCost: number,
  order: ReplayOrder = "baseline-first",
): PairResult => {
  const baseline = arm(baselineCost);
  const megasaver = { ...arm(megasaverCost), arm: "megasaver" as const };
  return { order, baseline, megasaver, costRatio: costRatioOf(baseline, megasaver) };
};

// ---------------------------------------------------------------- the escapes

// Each scenario below was MEASURED passing the old two-sided aggregate band. The
// first three must now be refused and the fourth — which the old byte floor
// refused — must now be accepted.
describe("Round-4 escapes land on the correct side", () => {
  it("refuses a saver that empties half the calls, which the aggregate band called healthy", () => {
    const sizes = Array.from({ length: 100 }, () => 4000);
    // Empty on even ids, passthrough on odd: applied 50, passthrough 50 →
    // fraction 0.500, and 200,000 of 400,000 B survive → byteRatio 0.500. Both
    // axes sit comfortably inside the old band, and it reported 2.0x.
    const saver: ApplySaver = (_raw, ctx) => (Number(ctx.toolUseId.slice(1)) % 2 === 0 ? "" : null);

    expect(
      checkTransformIntegrity({
        saver: { applied: 50, passthrough: 50, failed: 0 },
        bytes: { original: 400_000, transformed: 200_000 },
      }).ok,
      "the aggregate band still calls this healthy — which is exactly why it cannot be the guard",
    ).toBe(true);

    expect(() => prepareArms({ requests: recording(sizes), applySaver: saver })).toThrow(
      /missing-recovery-footer/,
    );
  });

  it("refuses a saver that empties only the 11 largest of 100 calls", () => {
    // The blast-radius trick: 11 big outputs destroyed, 89 small ones passed
    // through. fraction 0.110, byteRatio 89,000/309,000 = 0.288 — deep inside the
    // old band — and it reported 3.3x.
    const sizes = [
      ...Array.from({ length: 89 }, () => 1000),
      ...Array.from({ length: 11 }, () => 20_000),
    ];
    const saver: ApplySaver = (raw) => (Buffer.byteLength(raw, "utf8") > 10_000 ? "" : null);

    expect(
      checkTransformIntegrity({
        saver: { applied: 11, passthrough: 89, failed: 0 },
        bytes: { original: 309_000, transformed: 89_000 },
      }).ok,
    ).toBe(true);

    expect(() => prepareArms({ requests: recording(sizes), applySaver: saver })).toThrow(
      /missing-recovery-footer/,
    );
  });

  it("refuses a near-inert transform whose maximum possible effect is below the band being resolved", () => {
    // Every applied call here is a GENUINE compression — footer present, strictly
    // smaller — so the per-call contract passes and must not be the thing that
    // refuses it. What disqualifies it is aggregate and unavoidable: it moved 3%
    // of the tool_result bytes, so it cannot produce a cost effect inside the ≤5%
    // band this harness exists to resolve. It reported 1.031x.
    const sizes = Array.from({ length: 100 }, () => 5000);
    const saver: ApplySaver = (raw, ctx) =>
      Number(ctx.toolUseId.slice(1)) < 20
        ? savedOutput(Buffer.byteLength(raw, "utf8"), 4250)
        : null;

    const arms = prepareArms({ requests: recording(sizes), applySaver: saver });
    expect(arms.saver).toEqual({ applied: 20, passthrough: 80, failed: 0 });
    expect(arms.bytes).toEqual({ original: 500_000, transformed: 485_000 });
    expect(checkTransformIntegrity(arms).byteRatio).toBeCloseTo(0.97, 6);

    expect(() => buildVerdict("t", [pair(1.031, 1)], arms)).toThrow(/measured nothing/);
  });

  it("accepts an honest aggressive-mode run on large outputs, which the old byte floor refused", () => {
    // The regime the saver performs BEST in, and the one the 0.05 byte floor
    // rejected: it fits output to an absolute budget (aggressive = 4000 B), so
    // byteRatio ≈ budget/original and falls as outputs grow. 10 × 100 KB → 0.039.
    const sizes = Array.from({ length: 10 }, () => 102_400);
    const saver: ApplySaver = (raw) => savedOutput(Buffer.byteLength(raw, "utf8"), 4000);

    const arms = prepareArms({ requests: recording(sizes), applySaver: saver });
    expect(arms.saver).toEqual({ applied: 10, passthrough: 0, failed: 0 });
    const integrity = checkTransformIntegrity(arms);
    expect(integrity.byteRatio).toBeCloseTo(0.039, 3);
    expect(integrity.ok).toBe(true);

    const verdict = buildVerdict("t", [pair(1.4, 1)], arms);
    expect(verdict.costRatio).toBeCloseTo(1.4, 6);
  });
});

// ------------------------------------------------------- the contract itself

describe("prepareArms verifies the saver's contract per call", () => {
  const sizes = Array.from({ length: 100 }, () => 4000);
  const honest: ApplySaver = (raw) => savedOutput(Buffer.byteLength(raw, "utf8"), 1200);

  it("accepts a transform where every applied call is a real compression", () => {
    const arms = prepareArms({ requests: recording(sizes), applySaver: honest });
    expect(arms.saver.applied).toBe(100);
    expect(arms.bytes).toEqual({ original: 400_000, transformed: 120_000 });
  });

  // THE decisive property, and the one no aggregate can have: 99 good calls
  // cannot average away 1 bad one.
  it("catches a single bad call surrounded by 99 good ones", () => {
    const saver: ApplySaver = (raw, ctx) => (ctx.toolUseId === "t57" ? "" : honest(raw, ctx));
    expect(() => prepareArms({ requests: recording(sizes), applySaver: saver })).toThrow(/"t57"/);
  });

  it("refuses an applied output that is not strictly smaller than the raw it replaced", () => {
    // The saver's own net-negative guard degrades to passthrough rather than
    // returning this, so an arm that contains it did not come from the saver.
    const saver: ApplySaver = (raw) =>
      savedOutput(Buffer.byteLength(raw, "utf8"), Buffer.byteLength(raw, "utf8") + 10);
    expect(() => prepareArms({ requests: recording([4000]), applySaver: saver })).toThrow(
      /not-smaller-than-original/,
    );
  });

  it("refuses a truncating saver that drops content without compressing it", () => {
    // Looks like a 4x win on every axis the aggregate band measures, and is
    // simply content loss: no footer means the bytes are gone, not recoverable.
    const saver: ApplySaver = (raw) => raw.slice(0, 1000);
    expect(() => prepareArms({ requests: recording(sizes), applySaver: saver })).toThrow(
      /missing-recovery-footer/,
    );
  });

  it("names every offending tool_use_id and the reason, not just a count", () => {
    const saver: ApplySaver = (raw, ctx) =>
      ctx.toolUseId === "t1" || ctx.toolUseId === "t3" ? "" : honest(raw, ctx);
    let message = "";
    try {
      prepareArms({ requests: recording([4000, 4000, 4000, 4000]), applySaver: saver });
    } catch (cause) {
      message = cause instanceof Error ? cause.message : String(cause);
    }
    expect(message).toContain('"t1"');
    expect(message).toContain('"t3"');
    expect(message).not.toContain('"t0"');
    expect(message).toContain("missing-recovery-footer");
    expect(message).toContain("Bash");
  });

  it("leaves passthrough decisions alone — they are not compressions and carry no footer", () => {
    const arms = prepareArms({ requests: recording(sizes), applySaver: () => null });
    expect(arms.saver).toEqual({ applied: 0, passthrough: 100, failed: 0 });
  });
});
