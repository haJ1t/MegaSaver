import { describe, expect, it } from "vitest";
import { recoveryBreakeven } from "../src/recovery-breakeven.js";
import type { PreparedArms } from "../src/transform.js";
import type { RecordedRequest } from "../src/types.js";

// A4 asks for NET cost reduction. The replay measures the input-side saving
// honestly, but it is blind to the other first-order term: when the agent pulls
// dropped content back (`mega output chunk` / proxy_expand_chunk), those bytes
// re-enter the prompt and eat the saving. A fixed-trajectory replay can never
// produce those turns, so the term cannot be MEASURED here.
//
// It can, however, be BOUNDED, and in the same currency, with no API spend and
// no token-pricing assumption:
//
//   saving  = SUM over requests of (baseline body bytes - megasaver body bytes)
//   cost of expanding output i = bytes it can give back x requests it rides in
//
// Both sides are byte-appearances — a byte present in three requests is sent
// three times and counted three times. Break-even is where the second sum
// reaches the first. That converts "unmeasured" into "net cheaper as long as
// fewer than R* of compressed outputs are expanded", which is a decision with a
// stated boundary rather than a number nobody can produce.
//
// The reported R* assumes the agent expands the COSTLIEST outputs first (large,
// and early enough to ride in many requests). That is the worst case, so the
// real recovery rate has to beat a bound that is deliberately pessimistic.

function body(toolResults: readonly { id: string; text: string }[], padding = ""): RecordedRequest {
  return {
    model: "m",
    system: "sys",
    messages: [
      ...toolResults.flatMap((t) => [
        {
          role: "assistant",
          content: [{ type: "tool_use", id: t.id, name: "Bash", input: {} }],
        },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: t.id, content: t.text }],
        },
      ]),
      { role: "user", content: padding },
    ],
  } as unknown as RecordedRequest;
}

function arms(
  baseline: readonly RecordedRequest[],
  megasaver: readonly RecordedRequest[],
): PreparedArms {
  return {
    baseline,
    megasaver,
    saver: { applied: 1, passthrough: 0, failed: 0 },
    bytes: { original: 0, transformed: 0 },
  };
}

// One tool_result, raw 1000 B compressed to 100 B, appearing in all 3 requests.
// Saving = 900 x 3 = 2700 byte-appearances. Expanding it right after its first
// appearance puts 900 B back into requests 2 and 3 = 1800 — under the saving,
// so one expansion is affordable and R* is 1.0.
const RAW = "r".repeat(1000);
const SMALL = "c".repeat(100);

describe("recoveryBreakeven", () => {
  it("counts the saving in byte-appearances, not in bytes", () => {
    const base = [body([{ id: "a", text: RAW }]), body([{ id: "a", text: RAW }])];
    const mega = [body([{ id: "a", text: SMALL }]), body([{ id: "a", text: SMALL }])];
    // The SAME 900 B removed, appearing twice, is worth twice as much as once.
    const one = recoveryBreakeven(arms([base[0] as RecordedRequest], [mega[0] as RecordedRequest]));
    const two = recoveryBreakeven(arms(base, mega));
    expect(two.savedBytes).toBeCloseTo(2 * one.savedBytes, 6);
  });

  it("prices an expansion by how many requests it would ride in", () => {
    // Two outputs of IDENTICAL raw size, one first seen in request 1 and one in
    // request 3 of 4. Same bytes, different position, so only the multiplication
    // by `ridesInRequests` can separate them.
    //
    // The previous version of this test compared two separate sessions and read
    // `expandable[0]?.costBytes ?? 0`. In the "late" session the output was
    // already small at its first appearance, so nothing was expandable and the
    // `?? 0` fallback supplied the number the assertion then compared — it
    // passed with the multiplication removed. Both outputs now live in ONE
    // session and the length is asserted, so no fallback can stand in.
    const base = [
      body([{ id: "early", text: RAW }]),
      body([{ id: "early", text: RAW }]),
      body([
        { id: "early", text: RAW },
        { id: "late", text: RAW },
      ]),
      body([
        { id: "early", text: RAW },
        { id: "late", text: RAW },
      ]),
    ];
    const mega = [
      body([{ id: "early", text: SMALL }]),
      body([{ id: "early", text: SMALL }]),
      body([
        { id: "early", text: SMALL },
        { id: "late", text: SMALL },
      ]),
      body([
        { id: "early", text: SMALL },
        { id: "late", text: SMALL },
      ]),
    ];
    const result = recoveryBreakeven(arms(base, mega));
    expect(result.expandable).toHaveLength(2);
    const byId = new Map(result.expandable.map((e) => [e.toolUseId, e]));
    const early = byId.get("early");
    const late = byId.get("late");
    expect(early?.rawBytes).toBe(late?.rawBytes);
    expect(early?.ridesInRequests).toBe(3);
    expect(late?.ridesInRequests).toBe(1);
    expect(early?.costBytes).toBe((early?.rawBytes ?? 0) * 3);
    expect(late?.costBytes).toBe((late?.rawBytes ?? 0) * 1);
  });

  // An expansion re-enters the prompt as the RAW content while the compressed
  // summary stays in history — the session ends up carrying both. Charging only
  // the delta made "saving beats cost" an identity: per output the saving is
  // (r-c)(N-j+1) and the delta-cost is (r-c)(N-j), so the saving won for every
  // possible input and R* was pinned at 100% regardless of the data.
  it("charges an expansion the raw bytes, not the bytes compression removed", () => {
    const base = [body([{ id: "a", text: RAW }]), body([{ id: "a", text: RAW }])];
    const mega = [body([{ id: "a", text: SMALL }]), body([{ id: "a", text: SMALL }])];
    const item = recoveryBreakeven(arms(base, mega)).expandable[0];
    expect(item?.rawBytes).toBeGreaterThan(item?.recoverableBytes ?? 0);
    expect(item?.costBytes).toBe((item?.rawBytes ?? 0) * (item?.ridesInRequests ?? 0));
  });

  // Found by running this against the small recorded corpus, where the saver
  // never fires: it printed "R* 0.0%", which reads as "no expansion is
  // affordable" — a damning number — when the truth is that there is no
  // decision to make at all. A rate of zero is a real, meaningful answer
  // (compression happened and was net-negative); "nothing compressed" is not.
  // NaN follows `pooledCostRatio`'s posture: never hand back a number the data
  // cannot stand behind.
  it("returns NaN, not zero, when the saver never fired", () => {
    const same = [body([{ id: "a", text: RAW }]), body([{ id: "a", text: RAW }])];
    const result = recoveryBreakeven(arms(same, same));
    expect(result.expandable).toEqual([]);
    expect(result.savedBytes).toBe(0);
    expect(result.breakevenRate).toBeNaN();
  });

  // The case a zero rate really does describe, kept distinct from the one above.
  it("returns zero when compression happened but bought nothing", () => {
    const base = [body([{ id: "a", text: RAW }]), body([{ id: "a", text: RAW }])];
    const mega = [
      body([{ id: "a", text: SMALL }], "p".repeat(5000)),
      body([{ id: "a", text: SMALL }], "p".repeat(5000)),
    ];
    const result = recoveryBreakeven(arms(base, mega));
    expect(result.expandable.length).toBeGreaterThan(0);
    expect(result.savedBytes).toBeLessThan(0);
    expect(result.breakevenRate).toBe(0);
  });

  it("assumes the COSTLIEST outputs are expanded first, so R* is a worst case", () => {
    const base = [
      body([{ id: "big", text: RAW }]),
      body([
        { id: "big", text: RAW },
        { id: "small", text: "r".repeat(300) },
      ]),
    ];
    const mega = [
      body([{ id: "big", text: SMALL }]),
      body([
        { id: "big", text: SMALL },
        { id: "small", text: "c".repeat(50) },
      ]),
    ];
    const result = recoveryBreakeven(arms(base, mega));
    const costs = result.expandable.map((e) => e.costBytes);
    expect(costs).toEqual([...costs].sort((a, b) => b - a));
  });

  it("stops counting expansions once the saving is consumed", () => {
    // Three identical compressed outputs, all in request 1 of 1, so each costs
    // nothing to expand after its own request... give them a later request to
    // ride in so the cost is real.
    const ids = ["a", "b", "c"];
    const base = [
      body(ids.map((id) => ({ id, text: RAW }))),
      body(ids.map((id) => ({ id, text: RAW }))),
    ];
    const mega = [
      body(ids.map((id) => ({ id, text: SMALL }))),
      body(ids.map((id) => ({ id, text: SMALL }))),
    ];
    const result = recoveryBreakeven(arms(base, mega));
    expect(result.expandable).toHaveLength(3);
    // Saving is 3 x 900 x 2 = 5400. Each expansion rides in request 2 only:
    // 900 each. All three are affordable.
    expect(result.breakevenCount).toBe(3);
    expect(result.breakevenRate).toBe(1);
  });

  // The budget has to actually RUN OUT somewhere, or "stop when the saving is
  // consumed" is never exercised. Deleting the break left every earlier test
  // passing, because every case in them was affordable anyway.
  //
  // Affordability per output is (N-j+1)(r-c) >= r(N-j); at j=1 that reduces to
  // N < r/c. With r/c = 10 a session of 12 requests puts every expansion over
  // its own budget, so the count is pinned by the total saving rather than by
  // the number of outputs.
  it("stops counting once the saving is consumed, short of every output", () => {
    const ids = ["a", "b", "c", "d"];
    const requests = 12;
    const base = Array.from({ length: requests }, () => body(ids.map((id) => ({ id, text: RAW }))));
    const mega = Array.from({ length: requests }, () =>
      body(ids.map((id) => ({ id, text: SMALL }))),
    );
    const result = recoveryBreakeven(arms(base, mega));
    expect(result.expandable).toHaveLength(4);
    expect(result.breakevenCount).toBeGreaterThan(0);
    expect(result.breakevenCount).toBeLessThan(4);
    expect(result.breakevenRate).toBeLessThan(1);
    expect(result.breakevenRate).toBe(result.breakevenCount / 4);
    // And the accepted set really is affordable: the rejected one would not be.
    const accepted = result.expandable.slice(0, result.breakevenCount);
    const spent = accepted.reduce((n, e) => n + e.costBytes, 0);
    const next = result.expandable[result.breakevenCount];
    expect(spent).toBeLessThanOrEqual(result.savedBytes);
    expect(spent + (next?.costBytes ?? 0)).toBeGreaterThan(result.savedBytes);
  });

  it("refuses arms of different lengths rather than comparing misaligned requests", () => {
    expect(() => recoveryBreakeven(arms([body([{ id: "a", text: RAW }])], []))).toThrow(
      /same number of requests/,
    );
  });
});
