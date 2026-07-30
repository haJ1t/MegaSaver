import { describe, expect, it } from "vitest";
import { replayBothOrders, replayPair } from "../src/replay.js";
import { orderSensitive } from "../src/report.js";
import { prepareArms, stripCacheNamespace } from "../src/transform.js";
import type { Arm, RecordedRequest } from "../src/types.js";
import { rawOutput, savedOutput } from "./saver-output-fixture.js";

// prepareArms verifies the saver's contract per call, so the fake has to honour
// it: a raw big enough to compress, and a replacement carrying the recovery
// footer and strictly smaller than that raw.
const RAW_BYTES = 4000;
const SAVED = savedOutput(RAW_BYTES, 1000);

// One request per arm run keeps the scripted `send` queue a 1:1 map onto arm
// runs, so a test can pin exactly which arm ran in which position.
const recorded: RecordedRequest[] = [
  {
    model: "m",
    // Real recordings always carry one, and the cache-run namespace rides on its
    // front (replayArm -> namespaceCacheRun), so the fixture keeps one too.
    system: "sys",
    messages: [
      { role: "assistant", content: [{ type: "tool_use", id: "t", name: "Bash", input: {} }] },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t", content: rawOutput("t", RAW_BYTES) }],
      },
    ],
  },
];

const applySaver = () => SAVED;

// The megasaver arm is the only one whose body carries the transformed text, so
// the arm is recoverable from the wire body alone — no back channel needed.
function armOf(body: unknown): Arm {
  return JSON.stringify(body).includes("Mega Saver: compressed") ? "megasaver" : "baseline";
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
  const arms = () => prepareArms({ requests: recorded, applySaver });

  it("runs the arms in the requested order and records which ran first", async () => {
    const a = scriptedSend([1000, 800]);
    const baselineFirst = await replayPair({
      arms: arms(),
      send: a.send,
      order: "baseline-first",
      now: () => 0,
    });
    expect(a.arms).toEqual(["baseline", "megasaver"]);
    expect(baselineFirst.order).toBe("baseline-first");
    expect(baselineFirst.costRatio).toBeCloseTo(1.25, 6);

    const b = scriptedSend([800, 1000]);
    const megasaverFirst = await replayPair({
      arms: arms(),
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
      arms: arms(),
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

// Fix A: all four arm runs replay a byte-identical system+tools prefix, so
// whichever ran first paid cache_creation for it and every later run read it at
// cache_read — a discount worth ~20x that no property of the saver earned. A
// fixed run order made that bias invisible; running both orders made it a number
// the harness could refuse on, which is what it then did (1.598 vs 1.197,
// 2026-07-30). Refusing is not measuring: since each run gets its own cache
// namespace, the discount is gone and the two pairs are independent replicates.
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

  // Refused BEFORE a request goes out: the refusal reads only the
  // TransformSummary prepareArms already returned, so paying for four arm runs
  // to reach a verdict that cannot exist is pure waste. Asserting no send
  // happened pins the placement — the throw alone passes from either side.
  it("still refuses an arm that compressed nothing, order agreement notwithstanding", async () => {
    const { send, arms } = scriptedSend([1000, 1000, 1000, 1000]);
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
    expect(arms).toEqual([]);
  });
});

// F1: the real saver is STATEFUL (first-sight ledger) and NON-DETERMINISTIC (a
// randomUUID chunk-set id is interpolated into the text it returns). A memo
// whose lifetime is one arm run therefore hands the gate's two megasaver arms
// two different byte sequences, while baseline — a pure structuredClone — is
// byte-identical in both pairs. Megasaver then pays cache_creation ($10/Mtok)
// in both pairs where baseline reads its own bytes back at cache_read
// ($0.50/Mtok): a ~20x penalty manufactured by the harness. The order check
// cannot see it, because the penalty lands on megasaver in BOTH orders and the
// two ratios move together. The only structural fix is to precompute both
// request sequences ONCE and make every arm run a pure byte-replay.
describe("replayBothOrders transforms once for the whole gate", () => {
  const GATE_RAW_BYTES = 4400;
  const RAW_A = rawOutput("A", GATE_RAW_BYTES);
  const RAW_B = rawOutput("B", GATE_RAW_BYTES);

  // ~1/3 of the raw size, mirroring the real saver's measured 34.4% compression,
  // and unique per call so a per-arm memo cannot coincidentally match. Carries the
  // recovery footer, because prepareArms now verifies that per call.
  const compressed = (n: number) => savedOutput(GATE_RAW_BYTES, 1500 + n);

  // A growing history, as the Messages API actually resends it: tool_result "a"
  // reappears in request 2 verbatim.
  const growing: RecordedRequest[] = [
    {
      model: "m",
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "a", name: "Bash", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "a", content: RAW_A }] },
      ],
    },
    {
      model: "m",
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "a", name: "Bash", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "a", content: RAW_A }] },
        { role: "assistant", content: [{ type: "tool_use", id: "b", name: "Bash", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "b", content: RAW_B }] },
      ],
    },
  ];

  // Content-blind on purpose: the two ratios must come out equal so the order
  // check passes and the divergence has to be caught by the bytes themselves.
  //
  // `sent` records each body with its cache-run namespace STRIPPED, so the
  // "same arm sends the same bytes in both pairs" invariant survives the marker
  // that is supposed to differ between runs. `namespaces` records the markers
  // themselves, so stripping cannot hide a regression that stopped namespacing:
  // every test that compares stripped bodies also asserts the four runs landed
  // in four different namespaces.
  function recordingSend() {
    const sent: string[] = [];
    const namespaces: string[] = [];
    const send = async (body: RecordedRequest) => {
      sent.push(JSON.stringify(stripCacheNamespace(body)));
      namespaces.push(JSON.stringify((body as unknown as { system?: unknown }).system));
      return {
        input_tokens: 100,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 0,
      };
    };
    return { send, sent, namespaces };
  }

  it("invokes the saver once per distinct tool_use_id across all four arm runs", async () => {
    let calls = 0;
    const { send } = recordingSend();
    await replayBothOrders({
      task: "task_1",
      requests: growing,
      // Call-counting and non-deterministic, mirroring the randomUUID the real
      // saver embeds: a per-arm memo cannot coincidentally match. The payload is
      // realistically compressed rather than 2 bytes, so it clears the integrity
      // band instead of tripping the content-destruction floor.
      applySaver: () => compressed(++calls),
      send,
      orderTolerance: 0.05,
      now: () => 0,
    });
    expect(calls).toBe(2);
  });

  it("sends byte-identical bodies for a given arm in both pairs", async () => {
    let calls = 0;
    const { send, sent, namespaces } = recordingSend();
    await replayBothOrders({
      task: "task_1",
      requests: growing,
      applySaver: () => compressed(++calls),
      send,
      orderTolerance: 0.05,
      now: () => 0,
    });
    expect(sent).toHaveLength(8);
    // baseline-first pair: [0,1] baseline, [2,3] megasaver.
    // megasaver-first pair: [4,5] megasaver, [6,7] baseline.
    expect(sent.slice(2, 4)).toEqual(sent.slice(4, 6));
    expect(sent.slice(0, 2)).toEqual(sent.slice(6, 8));
    // …and the four runs really did land in four namespaces, constant within a
    // run. Without this, stripping the marker above would also hide its absence.
    const perRun = [namespaces[0], namespaces[2], namespaces[4], namespaces[6]];
    expect(new Set(perRun).size).toBe(4);
    for (const start of [0, 2, 4, 6]) expect(namespaces[start]).toBe(namespaces[start + 1]);
  });

  // M3: the real saver's first-sight gate compresses a block the first time it
  // sees it and passes through afterwards. Re-consulted per arm run against one
  // persistent store, the second pair's megasaver arm is entirely INERT — yet
  // the verdict was built from pair 1's counters, so it printed anyway.
  it("carries the first-sight decision into both pairs instead of re-deriving it", async () => {
    let calls = 0;
    const { send, sent, namespaces } = recordingSend();
    await replayBothOrders({
      task: "task_1",
      requests: recorded,
      applySaver: () => (++calls === 1 ? SAVED : null),
      send,
      orderTolerance: 0.05,
      now: () => 0,
    });
    expect(calls).toBe(1);
    expect(sent).toHaveLength(4);
    // [1] is the baseline-first pair's megasaver arm, [2] the megasaver-first
    // pair's. Same arm, same recording — the bytes cannot differ, and the ONE
    // thing that may differ (the cache-run namespace) is stripped before the
    // comparison and asserted separately below.
    expect(sent[1]).toBe(sent[2]);
    expect(namespaces[1]).not.toBe(namespaces[2]);
  });

  // M1/M3 reporting gap: costRatio is the mean of BOTH pairs while the verdict
  // carried only pair 1's arms. A reader must not be able to see guards that
  // passed on data other than the number they are reading.
  it("reports the arms of every pair the ratio is averaged over", async () => {
    const { send } = scriptedSend([1000, 800, 800, 1000]);
    const verdict = await replayBothOrders({
      task: "task_1",
      requests: recorded,
      applySaver,
      send,
      orderTolerance: 0.05,
      now: () => 0,
    });
    expect(verdict.pairs.map((p) => p.order)).toEqual(["baseline-first", "megasaver-first"]);
    expect(verdict.pairs[0]?.costRatio).toBeCloseTo(1.25, 6);
    expect(verdict.pairs[1]?.costRatio).toBeCloseTo(1.25, 6);
    expect(verdict.costRatio).toBeCloseTo(1.25, 6);
    // The saver counters and the byte figure describe the ONE transform both
    // pairs replayed, not a single arm run.
    expect(verdict.transform.saver).toEqual({ applied: 1, passthrough: 0, failed: 0 });
    expect(verdict.transform.bytes.transformed).toBeLessThan(verdict.transform.bytes.original);
  });
});
