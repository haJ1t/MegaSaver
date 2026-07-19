import { describe, expect, it } from "vitest";
import { replayArm } from "../src/replay.js";

const recorded = [
  {
    model: "m",
    messages: [
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "RAW" }] },
    ],
  },
  { model: "m", messages: [{ role: "user", content: "second" }] },
];

describe("replayArm", () => {
  it("sends every recorded request in order and sums usage", async () => {
    const sent: unknown[] = [];
    const usage = await replayArm({
      arm: "baseline",
      requests: recorded,
      applySaver: () => null,
      send: async (body) => {
        sent.push(body);
        return {
          input_tokens: 10,
          cache_creation_input_tokens: 100,
          cache_read_input_tokens: 1000,
          output_tokens: 1,
        };
      },
    });
    expect(sent).toHaveLength(2);
    expect(usage.inputTokens).toBe(20);
    expect(usage.cacheCreationTokens).toBe(200);
    expect(usage.cacheReadTokens).toBe(2000);
    expect(usage.outputTokens).toBe(2);
    // 20*5 + 200*10 + 2000*0.5 + 2*25 = 100+2000+1000+50 = 3150 per 1e6
    expect(usage.normalizedCostUsd).toBeCloseTo(0.00315, 8);
  });

  it("megasaver arm sends transformed tool_result content", async () => {
    const sent: string[] = [];
    await replayArm({
      arm: "megasaver",
      requests: recorded,
      applySaver: () => "SHORT",
      send: async (body) => {
        sent.push(JSON.stringify(body));
        return {
          input_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          output_tokens: 0,
        };
      },
    });
    expect(sent[0]).toContain("SHORT");
    expect(sent[0]).not.toContain("RAW");
  });

  it("sends requests one at a time, not concurrently (cache measurement requires ordering)", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const order: number[] = [];
    await replayArm({
      arm: "baseline",
      requests: recorded,
      applySaver: () => null,
      send: async (body) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        order.push(order.length);
        await new Promise((resolve) => setTimeout(resolve, 0));
        inFlight--;
        return {
          input_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          output_tokens: 0,
        };
      },
    });
    expect(maxInFlight).toBe(1);
    expect(order).toEqual([0, 1]);
  });

  it("aborts loudly on a send failure instead of returning partial usage", async () => {
    let calls = 0;
    const send = async () => {
      calls++;
      if (calls === 2) throw new Error("network blew up");
      return {
        input_tokens: 1,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 0,
      };
    };
    await expect(
      replayArm({ arm: "baseline", requests: recorded, applySaver: () => null, send }),
    ).rejects.toThrow(/network blew up/);
    // must not have gone on to send further requests after the failure
    expect(calls).toBe(2);
  });
});
