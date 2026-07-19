import { describe, expect, it } from "vitest";
import { replayArm } from "../src/replay.js";

const recorded = [
  {
    model: "m",
    messages: [
      { role: "assistant", content: [{ type: "tool_use", id: "t", name: "Bash", input: {} }] },
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

// Fix 1: a Messages API conversation resends its whole history, so a tool_result
// recorded once appears in every later request. Production fires the saver hook
// ONCE per tool call (PostToolUse) and the compressed text then sits in the
// transcript byte-for-byte forever — that byte-stability is exactly what keeps
// the prompt cache warm. Re-invoking the (stateful, non-deterministic) saver per
// request would churn the megasaver arm's prefix and manufacture a ~20x
// cache_creation penalty the product does not actually have.
describe("replayArm saver memoization (once per tool_use_id)", () => {
  const growing = [
    {
      model: "m",
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "a", name: "Bash", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "a", content: "RAW-A" }] },
      ],
    },
    {
      model: "m",
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "a", name: "Bash", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "a", content: "RAW-A" }] },
        { role: "assistant", content: [{ type: "tool_use", id: "b", name: "Bash", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "b", content: "RAW-B" }] },
      ],
    },
    {
      model: "m",
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "a", name: "Bash", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "a", content: "RAW-A" }] },
        { role: "assistant", content: [{ type: "tool_use", id: "b", name: "Bash", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "b", content: "RAW-B" }] },
        { role: "assistant", content: [{ type: "tool_use", id: "c", name: "Bash", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "c", content: "RAW-C" }] },
      ],
    },
  ];

  const zeroUsage = {
    input_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: 0,
  };

  function toolResultContentFor(body: unknown, id: string): unknown {
    const msgs = (body as { messages: unknown[] }).messages;
    for (const m of msgs) {
      const content = (m as { content?: unknown }).content;
      if (!Array.isArray(content)) continue;
      for (const b of content) {
        const block = b as { type?: string; tool_use_id?: string; content?: unknown };
        if (block.type === "tool_result" && block.tool_use_id === id) return block.content;
      }
    }
    return undefined;
  }

  it("invokes the saver once per distinct tool_use_id and reuses its text verbatim", async () => {
    // Counter-based on purpose: mirrors the real saver's non-determinism (a
    // randomUUID chunk-set id is embedded in the returned text), so a regression
    // to per-request application fails loudly instead of coincidentally matching.
    let calls = 0;
    const sent: unknown[] = [];
    await replayArm({
      arm: "megasaver",
      requests: growing,
      applySaver: (raw) => {
        calls++;
        return `COMPRESSED(${raw})#${calls}`;
      },
      send: async (body) => {
        sent.push(body);
        return zeroUsage;
      },
    });

    expect(calls).toBe(3);
    const a0 = toolResultContentFor(sent[0], "a");
    expect(a0).toBe("COMPRESSED(RAW-A)#1");
    expect(toolResultContentFor(sent[1], "a")).toBe(a0);
    expect(toolResultContentFor(sent[2], "a")).toBe(a0);
    const b1 = toolResultContentFor(sent[1], "b");
    expect(toolResultContentFor(sent[2], "b")).toBe(b1);
  });

  it("reuses a memoized passthrough (null) without re-invoking the saver", async () => {
    let calls = 0;
    await replayArm({
      arm: "megasaver",
      requests: growing,
      applySaver: () => {
        calls++;
        return null;
      },
      send: async () => zeroUsage,
    });
    expect(calls).toBe(3);
  });

  it("passes the real tool identity to the saver, resolved from the tool_use block", async () => {
    const seen: { toolUseId: string; toolName: string; toolInput: unknown }[] = [];
    await replayArm({
      arm: "megasaver",
      requests: [
        {
          model: "m",
          messages: [
            {
              role: "assistant",
              content: [
                { type: "tool_use", id: "t1", name: "Read", input: { file_path: "/repo/a.ts" } },
              ],
            },
            {
              role: "user",
              content: [{ type: "tool_result", tool_use_id: "t1", content: "FILE BODY" }],
            },
          ],
        },
      ],
      applySaver: (_raw, ctx) => {
        seen.push(ctx);
        return null;
      },
      send: async () => zeroUsage,
    });
    expect(seen).toEqual([
      { toolUseId: "t1", toolName: "Read", toolInput: { file_path: "/repo/a.ts" } },
    ]);
  });
});

// Fix 2: a fail-open `null` is indistinguishable from a legitimate passthrough
// decision. A missing binary, a crashed hook or a maxBuffer overrun would turn
// the megasaver arm into a second baseline and report costRatio ≈ 1.00 as a
// clean "the saver has no effect" measurement. Failures must be counted and
// must abort.
describe("replayArm saver outcome accounting", () => {
  const one = [
    {
      model: "m",
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "a", name: "Bash", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "a", content: "RAW-A" }] },
        { role: "assistant", content: [{ type: "tool_use", id: "b", name: "Bash", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "b", content: "RAW-B" }] },
      ],
    },
  ];
  const zeroUsage = {
    input_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: 0,
  };

  it("aborts loudly when the saver fails instead of silently passing through", async () => {
    let sends = 0;
    await expect(
      replayArm({
        arm: "megasaver",
        requests: one,
        applySaver: () => {
          throw new Error("spawn ENOENT");
        },
        send: async () => {
          sends++;
          return zeroUsage;
        },
      }),
    ).rejects.toThrow(/spawn ENOENT/);
    expect(sends).toBe(0);
  });

  it("counts applied vs passthrough decisions per arm", async () => {
    const usage = await replayArm({
      arm: "megasaver",
      requests: one,
      applySaver: (raw) => (raw === "RAW-A" ? "SHORT" : null),
      send: async () => zeroUsage,
    });
    expect(usage.saver).toEqual({ applied: 1, passthrough: 1, failed: 0 });
  });

  it("surfaces an entirely inert megasaver arm as applied === 0", async () => {
    const usage = await replayArm({
      arm: "megasaver",
      requests: one,
      applySaver: () => null,
      send: async () => zeroUsage,
    });
    expect(usage.saver.applied).toBe(0);
    expect(usage.saver.passthrough).toBe(2);
  });

  // Fix B: the integrity guard is only as good as the bytes fed to it, and they
  // are accumulated once per distinct tool call — not once per request, which a
  // resent conversation history would inflate.
  it("accumulates original vs transformed tool_result bytes per tool call", async () => {
    const usage = await replayArm({
      arm: "megasaver",
      requests: one,
      applySaver: () => "S",
      send: async () => zeroUsage,
    });
    expect(usage.bytes).toEqual({ original: 10, transformed: 2 }); // "RAW-A" + "RAW-B" → "S" + "S"
  });

  it("counts a passthrough as its own bytes unchanged, not as a saving", async () => {
    const usage = await replayArm({
      arm: "megasaver",
      requests: one,
      applySaver: () => null,
      send: async () => zeroUsage,
    });
    expect(usage.bytes).toEqual({ original: 10, transformed: 10 });
  });

  it("aborts when a tool_result has no matching tool_use block rather than guessing", async () => {
    await expect(
      replayArm({
        arm: "megasaver",
        requests: [
          {
            model: "m",
            messages: [
              {
                role: "user",
                content: [{ type: "tool_result", tool_use_id: "orphan", content: "RAW" }],
              },
            ],
          },
        ],
        applySaver: () => "SHORT",
        send: async () => zeroUsage,
      }),
    ).rejects.toThrow(/orphan/);
  });
});

// Fix 4: the megasaver arm's cache_read collapsing while baseline's stays large
// is the single diagnostic that makes a prefix-churn regression obvious on
// sight. Summing it away before anyone can see it hides exactly that.
describe("replayArm per-request usage", () => {
  it("retains the per-request usage breakdown alongside the totals", async () => {
    let n = 0;
    const usage = await replayArm({
      arm: "baseline",
      requests: recorded,
      applySaver: () => null,
      send: async () => {
        n++;
        return {
          input_tokens: n,
          cache_creation_input_tokens: n * 10,
          cache_read_input_tokens: n * 100,
          output_tokens: n * 1000,
        };
      },
    });
    expect(usage.perRequest).toEqual([
      { inputTokens: 1, cacheCreationTokens: 10, cacheReadTokens: 100, outputTokens: 1000 },
      { inputTokens: 2, cacheCreationTokens: 20, cacheReadTokens: 200, outputTokens: 2000 },
    ]);
    expect(usage.inputTokens).toBe(3);
    expect(usage.cacheReadTokens).toBe(300);
  });
});
