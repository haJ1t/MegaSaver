import { describe, expect, it } from "vitest";
import { PROBE_SLOTS, runIsolationProbe } from "../src/isolation-probe.js";
import { cacheNamespaceMarker, stripCacheNamespace } from "../src/transform.js";
import type { Send } from "../src/replay.js";
import type { RecordedRequest } from "../src/types.js";

const PREFIX_TOKENS = 60_000;

// One recorded request whose system array carries a cache_control breakpoint on
// system[2], mirroring the real corpus: system[0] is the billing header the
// platform strips, system[2] is the first breakpoint.
function recording(): RecordedRequest[] {
  return [
    {
      model: "claude-opus-5",
      max_tokens: 1,
      system: [
        { type: "text", text: "x-anthropic-billing-header: cch=abc123" },
        { type: "text", text: "You are Claude Code." },
        { type: "text", text: "TOOLS...", cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: "hello" }],
    } as unknown as RecordedRequest,
  ];
}

// Simulates the platform. `stripsMarker: true` reproduces the real defect: the
// block carrying the namespace marker is removed before the cache key is
// computed, so all four sends key identically and the isolation is inert.
function fakeUpstream(opts: { stripsMarker: boolean; neverWarms?: boolean }): Send {
  const cache = new Set<string>();
  return async (body) => {
    if (opts.neverWarms) {
      return { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 };
    }
    const effective = opts.stripsMarker ? stripCacheNamespace(body) : body;
    const key = JSON.stringify(effective.system ?? "");
    if (cache.has(key)) {
      return { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: PREFIX_TOKENS, output_tokens: 1 };
    }
    cache.add(key);
    return { input_tokens: 10, cache_creation_input_tokens: PREFIX_TOKENS, cache_read_input_tokens: 0, output_tokens: 1 };
  };
}

describe("isolation-probe", () => {
  it("reports isolationLive when the platform honours the namespace marker", async () => {
    const result = await runIsolationProbe({ recording: recording(), send: fakeUpstream({ stripsMarker: false }) });

    expect(result.positiveControlWarmed).toBe(true);
    expect(result.posCell.runB.cacheReadTokens).toBe(PREFIX_TOKENS);
    expect(result.negCell.runB.cacheReadTokens).toBe(0);
    expect(result.negReadRatio).toBe(0);
    expect(result.isolationLive).toBe(true);
    expect(result.refusal).toBeUndefined();
  });

  it("reports isolationLive=false when the platform strips the marker block", async () => {
    const result = await runIsolationProbe({ recording: recording(), send: fakeUpstream({ stripsMarker: true }) });

    expect(result.positiveControlWarmed).toBe(true);
    expect(result.negCell.runB.cacheReadTokens).toBe(PREFIX_TOKENS);
    expect(result.negReadRatio).toBe(1);
    expect(result.isolationLive).toBe(false);
  });

  it("refuses rather than passing when the positive control never warms", async () => {
    const result = await runIsolationProbe({ recording: recording(), send: fakeUpstream({ stripsMarker: false, neverWarms: true }) });

    expect(result.positiveControlWarmed).toBe(false);
    expect(result.isolationLive).toBe(false);
    expect(result.refusal).toBe("positive_control_never_warmed");
  });

  it("refuses an empty recording instead of probing nothing", async () => {
    const result = await runIsolationProbe({ recording: [], send: fakeUpstream({ stripsMarker: false }) });

    expect(result.isolationLive).toBe(false);
    expect(result.refusal).toBe("empty_recording");
  });

  // The marker prefix is module-private in transform.ts; build the expected
  // values with the exported `cacheNamespaceMarker` rather than restating it.
  it("sends POS twice on one slot and NEG on two disjoint slots, none colliding with the gate's 0-3", async () => {
    const sent: string[] = [];
    const send: Send = async (body) => {
      const blocks = (body as unknown as { system: { text: string }[] }).system;
      const marked = blocks.find((b) => b.text.startsWith(cacheNamespaceMarker(0).slice(0, 20)));
      sent.push(marked?.text.split("\n")[0] ?? "");
      return { input_tokens: 10, cache_creation_input_tokens: 1, cache_read_input_tokens: 0, output_tokens: 1 };
    };

    await runIsolationProbe({ recording: recording(), send });

    const expected = (slot: number) => cacheNamespaceMarker(slot).trimEnd();
    expect(sent).toEqual([expected(90), expected(90), expected(91), expected(92)]);

    // The cells must not share a namespace, or NEG.runA reads POS's entry and
    // the cell measures nothing. And no probe slot may equal a gate slot (0-3),
    // or the probe warms a namespace the gate run needs cold.
    for (const slot of [PROBE_SLOTS.pos, PROBE_SLOTS.negA, PROBE_SLOTS.negB]) {
      expect(slot).toBeGreaterThan(3);
    }
    expect(new Set([PROBE_SLOTS.pos, PROBE_SLOTS.negA, PROBE_SLOTS.negB]).size).toBe(3);
  });
});
