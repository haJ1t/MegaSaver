import { describe, expect, it } from "vitest";
import { simulateCacheCost } from "../src/cache-model.js";
import type { RecordedRequest } from "../src/types.js";

// A4's last open term is S, the input-side cost difference between the arms.
// Measuring it needs the real API, which is out of budget. It can be MODELLED
// instead, because the prompt cache is not a heuristic: it is a deterministic
// longest-prefix match over content whose bytes and breakpoint positions we hold
// in full for both arms.
//
// Per request the API charges three ways, in this order:
//   cache_read      the longest previously-cached prefix that still matches
//   cache_creation  from there to the LAST cache_control breakpoint in this request
//   input           everything after that breakpoint
//
// The output is a MODEL, not a measurement, and the one input it cannot derive
// is bytes-per-token — so that is an explicit parameter, calibrated against the
// recording's real end-to-end usage rather than assumed.

const cc = { type: "ephemeral", ttl: "1h" };

function body(
  system: readonly { text: string; cache_control?: unknown }[],
  userText = "",
): RecordedRequest {
  return {
    model: "m",
    system: system.map((s) => ({ type: "text", ...s })),
    messages: userText === "" ? [] : [{ role: "user", content: userText }],
  } as unknown as RecordedRequest;
}

// 4 bytes per token keeps the arithmetic checkable by hand.
const BPT = 4;
const sim = (bodies: readonly RecordedRequest[]) =>
  simulateCacheCost(bodies, { bytesPerToken: BPT });

describe("simulateCacheCost", () => {
  it("charges everything as plain input when nothing is cacheable", () => {
    const r = sim([body([{ text: "a".repeat(400) }])]);
    expect(r.cacheCreationTokens).toBe(0);
    expect(r.cacheReadTokens).toBe(0);
    expect(r.inputTokens).toBeGreaterThan(0);
  });

  it("writes the cache on first sight and reads it on the second identical request", () => {
    const one = body([{ text: "s".repeat(400), cache_control: cc }]);
    const r = sim([one, one]);
    // First request creates; second reads the same tokens back.
    expect(r.cacheCreationTokens).toBeGreaterThan(0);
    expect(r.cacheReadTokens).toBe(r.cacheCreationTokens);
  });

  it("charges content after the last breakpoint as input, not as cache", () => {
    const head = [{ text: "s".repeat(400), cache_control: cc }];
    const bare = sim([body(head)]);
    const tailed = sim([body(head, "t".repeat(800))]);
    // The tail lands entirely in `input`; what the breakpoint caches is unchanged.
    expect(tailed.cacheCreationTokens).toBe(bare.cacheCreationTokens);
    expect(tailed.inputTokens).toBeGreaterThan(bare.inputTokens);
    expect(tailed.inputTokens - bare.inputTokens).toBeGreaterThanOrEqual(800 / BPT);
  });

  it("reads the longest matching prefix, not the first", () => {
    // Request 2 shares both breakpoints with request 1, so the LONGER one must
    // be the one read back — reading the shorter would overstate creation.
    const first = body([
      { text: "a".repeat(400), cache_control: cc },
      { text: "b".repeat(400), cache_control: cc },
    ]);
    const once = sim([first]);
    const twice = sim([first, first]);
    // Everything the first request cached is read back. Matching the SHORTER
    // breakpoint would leave part of it recharged as creation.
    expect(twice.cacheReadTokens).toBe(once.cacheCreationTokens);
    expect(twice.cacheCreationTokens).toBe(once.cacheCreationTokens);
  });

  it("cannot read a cache whose prefix diverged", () => {
    // Same length, different bytes: a prefix match is byte-exact, so nothing
    // from the first request is reusable by the second.
    const a = body([{ text: "a".repeat(400), cache_control: cc }]);
    const b = body([{ text: "b".repeat(400), cache_control: cc }]);
    const r = sim([a, b]);
    expect(r.cacheReadTokens).toBe(0);
    // Both requests pay creation in full — nothing was reusable.
    expect(r.cacheCreationTokens).toBe(sim([a]).cacheCreationTokens + sim([b]).cacheCreationTokens);
  });

  it("grows the cached prefix as the conversation grows", () => {
    // The real pattern: request 2 is request 1 plus a new turn, with the
    // breakpoint moved to the end. It reads request 1's prefix and creates only
    // the delta — which is what makes a long session cheap.
    const head = { text: "h".repeat(4000), cache_control: cc };
    const r1 = body([head]);
    const r2 = body([head, { text: "d".repeat(400), cache_control: cc }]);
    const once = sim([r1]);
    const r = sim([r1, r2]);
    // Request 2 reads all of request 1 back and creates only the new turn.
    expect(r.cacheReadTokens).toBe(once.cacheCreationTokens);
    const deltaCreation = r.cacheCreationTokens - once.cacheCreationTokens;
    expect(deltaCreation).toBeGreaterThan(0);
    expect(deltaCreation).toBeLessThan(once.cacheCreationTokens);
  });

  it("counts tool definitions ahead of system, as the API renders them", () => {
    // Tools render BEFORE system, so a breakpoint in system must include the
    // tool bytes in what it caches. Ignoring tools would understate every
    // cached prefix in a recording that has them — and this one has 11.
    const withTools = {
      model: "m",
      tools: [{ name: "Bash", description: "d".repeat(400), input_schema: {} }],
      system: [{ type: "text", text: "s".repeat(400), cache_control: cc }],
      messages: [],
    } as unknown as RecordedRequest;
    const withoutTools = body([{ text: "s".repeat(400), cache_control: cc }]);
    expect(sim([withTools]).cacheCreationTokens).toBeGreaterThan(
      sim([withoutTools]).cacheCreationTokens,
    );
  });

  it("scales inversely with bytes-per-token, the one parameter it cannot derive", () => {
    const one = body([{ text: "s".repeat(400), cache_control: cc }]);
    const coarse = simulateCacheCost([one], { bytesPerToken: 8 });
    const fine = simulateCacheCost([one], { bytesPerToken: 4 });
    expect(fine.cacheCreationTokens).toBe(2 * coarse.cacheCreationTokens);
  });

  it("refuses a non-positive bytes-per-token rather than dividing by zero", () => {
    expect(() => simulateCacheCost([], { bytesPerToken: 0 })).toThrow(/bytesPerToken/);
  });
});

// Calibration against the recording's real usage found this, not review: the
// modelled match froze at the system prefix for an entire 18-request session
// because `cache_control` moves from turn to turn, so the same tool_result
// hashed differently once the marker left it. Real read/creation was 11.8; the
// model said 0.44.
describe("cache_control is a marker, not content", () => {
  it("matches a cached prefix after the breakpoint marker moves off it", () => {
    const head = { type: "text", text: "h".repeat(4000) };
    // Request 1: breakpoint ON the head. Request 2: head unmarked, breakpoint
    // moved to the new turn — exactly what a growing conversation does.
    const r1 = {
      model: "m",
      system: [{ ...head, cache_control: { type: "ephemeral", ttl: "1h" } }],
      messages: [],
    } as unknown as RecordedRequest;
    const r2 = {
      model: "m",
      system: [head],
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "d".repeat(400),
              cache_control: { type: "ephemeral", ttl: "1h" },
            },
          ],
        },
      ],
    } as unknown as RecordedRequest;
    const r = simulateCacheCost([r1, r2], { bytesPerToken: BPT });
    // The head is read back despite no longer carrying the marker.
    expect(r.cacheReadTokens).toBe(
      simulateCacheCost([r1], { bytesPerToken: BPT }).cacheCreationTokens,
    );
  });
});
