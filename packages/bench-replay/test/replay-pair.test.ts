import { describe, expect, it } from "vitest";
import { replayBothOrders, replayPair } from "../src/replay.js";
import { orderSensitive } from "../src/report.js";
import type { Arm, RecordedRequest } from "../src/types.js";

// One request per arm run keeps the scripted `send` queue a 1:1 map onto arm
// runs, so a test can pin exactly which arm ran in which position.
const recorded: RecordedRequest[] = [
  {
    model: "m",
    messages: [
      { role: "assistant", content: [{ type: "tool_use", id: "t", name: "Bash", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "RAW-OUTPUT" }] },
    ],
  },
];

const applySaver = () => "SHORT";

// The megasaver arm is the only one whose body carries the transformed text, so
// the arm is recoverable from the wire body alone — no back channel needed.
function armOf(body: unknown): Arm {
  return JSON.stringify(body).includes("SHORT") ? "megasaver" : "baseline";
}

// Scripts input_tokens per arm run in send order and records the arms it saw.
function scriptedSend(inputTokens: readonly number[]) {
  const arms: Arm[] = [];
  let call = 0;
  const send = async (body: RecordedRequest) => {
    arms.push(armOf(body));
    const tokens = inputTokens[call] ?? 0;
    call += 1;
    return {
      input_tokens: tokens,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 0,
    };
  };
  return { send, arms };
}

describe("orderSensitive", () => {
  it("is false when both orders agree inside tolerance", () => {
    expect(orderSensitive(1.25, 1.26, 0.05)).toBe(false);
  });

  it("is true when the two orders disagree beyond tolerance", () => {
    expect(orderSensitive(1.25, 1.0, 0.05)).toBe(true);
  });

  it("fails closed on a NaN ratio rather than reading as insensitive", () => {
    expect(orderSensitive(Number.NaN, 1.25, 0.05)).toBe(true);
  });
});

describe("replayPair", () => {
  it("runs the arms in the requested order and records which ran first", async () => {
    const a = scriptedSend([1000, 800]);
    const baselineFirst = await replayPair({
      requests: recorded,
      applySaver,
      send: a.send,
      order: "baseline-first",
      now: () => 0,
    });
    expect(a.arms).toEqual(["baseline", "megasaver"]);
    expect(baselineFirst.order).toBe("baseline-first");
    expect(baselineFirst.costRatio).toBeCloseTo(1.25, 6);

    const b = scriptedSend([800, 1000]);
    const megasaverFirst = await replayPair({
      requests: recorded,
      applySaver,
      send: b.send,
      order: "megasaver-first",
      now: () => 0,
    });
    expect(b.arms).toEqual(["megasaver", "baseline"]);
    expect(megasaverFirst.order).toBe("megasaver-first");
  });

  it("stamps each arm with an injected wall clock", async () => {
    let tick = 0;
    const { send } = scriptedSend([1000, 800]);
    const pair = await replayPair({
      requests: recorded,
      applySaver,
      send,
      order: "baseline-first",
      now: () => ++tick,
    });
    expect(pair.baseline.startedAtMs).toBe(1);
    expect(pair.baseline.finishedAtMs).toBe(2);
    expect(pair.megasaver.startedAtMs).toBe(3);
    expect(pair.megasaver.finishedAtMs).toBe(4);
  });
});

// Fix A: both arms share a byte-identical system+tools prefix. Whichever runs
// first pays cache_creation for it; whichever runs second reads it at
// cache_read — a discount worth ~20x that no property of the saver earned. A
// fixed run order makes that bias invisible; running both orders makes it a
// number the harness can refuse on.
describe("replayBothOrders", () => {
  it("executes both orders, in sequence, and combines their ratios", async () => {
    const { send, arms } = scriptedSend([1000, 800, 800, 1000]);
    const verdict = await replayBothOrders({
      task: "task_1",
      requests: recorded,
      applySaver,
      send,
      orderTolerance: 0.05,
      now: () => 0,
    });
    expect(arms).toEqual(["baseline", "megasaver", "megasaver", "baseline"]);
    expect(verdict.verified.order).not.toBeNull();
    expect(verdict.verified.order?.ratioBaselineFirst).toBeCloseTo(1.25, 6);
    expect(verdict.verified.order?.ratioMegasaverFirst).toBeCloseTo(1.25, 6);
    expect(verdict.verified.order?.spread).toBeCloseTo(0, 6);
    expect(verdict.costRatio).toBeCloseTo(1.25, 6);
  });

  it("refuses a verdict when the two orders disagree beyond tolerance", async () => {
    // megasaver-first run makes both arms cost the same → ratio 1.0 vs 1.25.
    const { send } = scriptedSend([1000, 800, 1000, 1000]);
    await expect(
      replayBothOrders({
        task: "task_1",
        requests: recorded,
        applySaver,
        send,
        orderTolerance: 0.05,
        now: () => 0,
      }),
    ).rejects.toThrow(/order-sensitive/);
  });

  it("reports the observed spread in the refusal so the bias is quantified", async () => {
    const { send } = scriptedSend([1000, 800, 1000, 1000]);
    await expect(
      replayBothOrders({
        task: "task_1",
        requests: recorded,
        applySaver,
        send,
        orderTolerance: 0.05,
        now: () => 0,
      }),
    ).rejects.toThrow(/1\.25.*1(\.0+)?/s);
  });

  it("still refuses an arm that compressed nothing, order agreement notwithstanding", async () => {
    const { send } = scriptedSend([1000, 1000, 1000, 1000]);
    await expect(
      replayBothOrders({
        task: "task_1",
        requests: recorded,
        applySaver: () => null,
        send,
        orderTolerance: 0.05,
        now: () => 0,
      }),
    ).rejects.toThrow(/applied the saver 0 times/);
  });
});
