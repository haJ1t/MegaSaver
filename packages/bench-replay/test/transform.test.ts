import { describe, expect, it } from "vitest";
import {
  GENERATION_CAP_TOKENS,
  assertUncompressedRecording,
  prepareArms,
  transformRequest,
} from "../src/transform.js";
import { rawOutput, savedOutput } from "./saver-output-fixture.js";

const body = {
  model: "claude-opus-4-8",
  system: [{ type: "text", text: "sys" }],
  messages: [
    { role: "user", content: "do the thing" },
    { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash", input: {} }] },
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "t1", content: "RAW OUTPUT" },
        { type: "text", text: "keep me" },
      ],
    },
  ],
};

describe("transformRequest", () => {
  // Baseline is the recording verbatim: the whole comparison rests on it. The
  // prompt-cache namespace that keeps the four arm runs from sharing entries is
  // applied later, at send time, per RUN — not here (see replayArm).
  it("baseline returns the body unchanged, on a new object", () => {
    const out = transformRequest(body, "baseline", () => "IGNORED");
    expect(out).not.toBe(body);
    expect(out).toEqual(body);
  });

  it("megasaver rewrites tool_result content and leaves everything else intact", () => {
    const out = transformRequest(body, "megasaver", (raw) => `COMPRESSED(${raw.length})`);
    const content = (
      out.messages[2] as { content: { type: string; content?: string; text?: string }[] }
    ).content;
    expect(content[0]).toEqual({
      type: "tool_result",
      tool_use_id: "t1",
      content: "COMPRESSED(10)",
    });
    expect(content[1]).toEqual({ type: "text", text: "keep me" });
    expect(out.model).toBe("claude-opus-4-8");
    expect(out.system).toEqual(body.system);
    expect((out.messages[0] as { content: string }).content).toBe("do the thing");
  });

  it("a passthrough saver decision (null) leaves the tool_result untouched", () => {
    const out = transformRequest(body, "megasaver", () => null);
    expect(out.messages).toEqual(body.messages);
  });

  it("does not mutate the input body", () => {
    const snapshot = JSON.parse(JSON.stringify(body));
    transformRequest(body, "megasaver", () => "X");
    expect(body.messages).toEqual(snapshot.messages);
  });

  it("leaves string-content messages alone (nothing to rewrite)", () => {
    const plain = { model: "m", system: "sys", messages: [{ role: "user", content: "just text" }] };
    const out = transformRequest(plain, "megasaver", () => "X");
    expect(out.messages).toEqual(plain.messages);
  });

  // Real recorded Claude Code transcripts show tool_result.content as an array of
  // content blocks (the Anthropic API's other accepted shape) in ~14% of cases —
  // not a rare edge case. Skipping it would silently under-transform the megasaver
  // arm and bias the benchmark toward "no effect".
  it("megasaver rewrites array-form tool_result content, merging text blocks and keeping non-text blocks", () => {
    const arrayBody = {
      model: "m",
      system: "sys",
      messages: [
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "t1", name: "Bash", input: {} }],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "t1",
              content: [
                { type: "tool_reference", tool_name: "WebSearch" },
                { type: "text", text: "part one" },
                { type: "text", text: "part two" },
              ],
            },
          ],
        },
      ],
    };
    const out = transformRequest(arrayBody, "megasaver", (raw) => `COMPRESSED(${raw.length})`);
    const block = (out.messages[1] as { content: { content: unknown }[] }).content[0];
    // "part one\npart two" is 17 chars.
    expect(block.content).toEqual([
      { type: "tool_reference", tool_name: "WebSearch" },
      { type: "text", text: "COMPRESSED(17)" },
    ]);
  });

  it("array-form tool_result content with no text blocks is left untouched (nothing to compress)", () => {
    const imageOnlyBody = {
      model: "m",
      system: "sys",
      messages: [
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "t1", name: "Bash", input: {} }],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "t1",
              content: [{ type: "image", source: { type: "base64", data: "AAA" } }],
            },
          ],
        },
      ],
    };
    expect(
      transformRequest(imageOnlyBody, "megasaver", () => "SHOULD NOT BE CALLED").messages,
    ).toEqual(imageOnlyBody.messages);
  });

  it("a passthrough decision on array-form content leaves it untouched", () => {
    const arrayBody = {
      model: "m",
      system: "sys",
      messages: [
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "t1", name: "Bash", input: {} }],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "raw" }] },
          ],
        },
      ],
    };
    expect(transformRequest(arrayBody, "megasaver", () => null).messages).toEqual(
      arrayBody.messages,
    );
  });
});

// Fix C: nothing required MegaSaver's hooks to be OFF while a conversation was
// being recorded. A recording captured with the saver live has already-compressed
// tool_results, which makes the "baseline" arm secretly a megasaver run and the
// megasaver arm a double-compression — the ratio collapses toward 1.00 with no
// signal that anything is wrong. The saver's own recovery footer is the tell.
describe("assertUncompressedRecording", () => {
  // Byte-identical prefix of the footer emitted by buildRecoveryFooter in
  // packages/context-gate/src/recovery-footer.ts.
  const footer =
    '\n\n[Mega Saver: compressed 100000→200 B (~25000→50 tokens, 99.8%). Full output recoverable — run: mega output chunk "cs-1" "0" (or MCP proxy_expand_chunk if connected).]';

  const withToolResult = (content: unknown) => [
    {
      model: "m",
      system: "sys",
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content }] },
      ],
    },
  ];

  it("accepts a recording captured with the saver off", () => {
    expect(() => assertUncompressedRecording(withToolResult("raw bash output"))).not.toThrow();
  });

  it("rejects a string tool_result already carrying the saver footer", () => {
    expect(() => assertUncompressedRecording(withToolResult(`out${footer}`))).toThrow(
      /already compressed/i,
    );
  });

  it("rejects the footer inside an array-shaped tool_result", () => {
    expect(() =>
      assertUncompressedRecording(withToolResult([{ type: "text", text: `out${footer}` }])),
    ).toThrow(/already compressed/i);
  });

  it("names the offending request and tool call so the operator can find it", () => {
    expect(() => assertUncompressedRecording(withToolResult(`out${footer}`))).toThrow(/t1/);
  });
});

// The check lives in prepareArms, the last layer that still sees the RAW
// recording: downstream the megasaver bodies legitimately carry the saver's
// footer, so the same check there could not tell contamination from work.
// prepareArms runs before a single request is sent, so a contaminated recording
// still cannot reach the API by any path.
describe("prepareArms refuses a contaminated recording", () => {
  it("aborts when the recording was captured with the saver on", () => {
    let saverCalls = 0;
    expect(() =>
      prepareArms({
        requests: [
          {
            model: "m",
            system: "sys",
            messages: [
              {
                role: "assistant",
                content: [{ type: "tool_use", id: "t1", name: "Bash", input: {} }],
              },
              {
                role: "user",
                content: [
                  {
                    type: "tool_result",
                    tool_use_id: "t1",
                    content: "out\n\n[Mega Saver: compressed 100→10 B (~25→2 tokens, 90.0%).]",
                  },
                ],
              },
            ],
          },
        ],
        applySaver: () => {
          saverCalls += 1;
          return null;
        },
      }),
    ).toThrow(/already compressed/i);
    expect(saverCalls).toBe(0);
  });
});

// BLOCKER: the recorded bodies were sent verbatim, `"stream": true` included, so
// the model resampled freely on all four arm runs. The replay never USES that
// output — assistant turns come from the recording — yet at $25/Mtok it is ~26%
// of arm cost and pure noise: a reviewer's 200-run simulation against a true 5%
// input-side saving measured sd 3.78% and reported the saver as a net LOSS in
// 15.5% of runs. Capping generation is only sound if it lands on BOTH arms and
// leaves the cached prefix alone.
describe("prepareArms generation cap", () => {
  const CAP_RAW_BYTES = 4000;
  const CAP_RAW = rawOutput("cap", CAP_RAW_BYTES);
  const CAP_SAVED = savedOutput(CAP_RAW_BYTES, 1000);

  const recorded = [
    {
      model: "claude-opus-4-8",
      stream: true,
      max_tokens: 32000,
      system: [{ type: "text", text: "sys", cache_control: { type: "ephemeral" } }],
      tools: [{ name: "Bash", input_schema: { type: "object" } }],
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash", input: {} }] },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "t1", content: CAP_RAW }],
        },
      ],
    },
  ];

  const maxTokensOf = (body: unknown) => (body as { max_tokens?: unknown }).max_tokens;

  it("caps max_tokens to the same value on both arms", () => {
    const arms = prepareArms({ requests: recorded, applySaver: () => CAP_SAVED });
    expect(GENERATION_CAP_TOKENS).toBe(1);
    expect(arms.baseline.map(maxTokensOf)).toEqual([GENERATION_CAP_TOKENS]);
    expect(arms.megasaver.map(maxTokensOf)).toEqual([GENERATION_CAP_TOKENS]);
  });

  // max_tokens is not part of the prompt-cache key — the key is the rendered
  // prefix (tools -> system -> messages). Changing anything that IS would change
  // the very thing being measured, so the cap must be the ONLY difference from
  // the recording.
  //
  // This stayed true through the cache-namespacing work of 2026-07-30. An
  // intermediate version namespaced `system` HERE, per arm, which broke it; that
  // was the wrong level (it left the pair-to-pair cache sharing that dominated
  // the measured 0.40 spread untouched) and the marker now goes on at send time,
  // per arm RUN, in replayArm. What prepareArms hands out is once again the
  // recording plus the cap and nothing else.
  it("leaves every cache-keyed field byte-identical to the recording", () => {
    const arms = prepareArms({ requests: recorded, applySaver: () => null });
    const sent = arms.baseline[0] as Record<string, unknown>;
    const other = arms.megasaver[0] as Record<string, unknown>;
    const original = recorded[0] as Record<string, unknown>;

    for (const key of ["model", "stream", "tools", "messages", "system"]) {
      expect(sent[key]).toEqual(original[key]);
      expect(sent[key]).toEqual(other[key]);
    }
    expect(Object.keys(sent).sort()).toEqual(Object.keys(original).sort());
  });

  // Extended thinking reserves budget_tokens out of max_tokens, so the API
  // rejects budget_tokens >= max_tokens. Detected before a request is sent
  // rather than as a 400 four arm runs deep.
  it("refuses a recording whose thinking budget cannot fit under the cap", () => {
    expect(() =>
      prepareArms({
        requests: [{ ...recorded[0], thinking: { type: "enabled", budget_tokens: 8000 } } as never],
        applySaver: () => CAP_SAVED,
      }),
    ).toThrow(/budget_tokens/);
  });
});

// A paid run died on request 1 with:
//   `cache_control.scope: "global"` is only valid when every preceding block is
//   also globally scoped ... tool definitions render before `system` blocks
//
// The body we sent was byte-identical to the recording apart from the
// generation cap, so the recording itself is what the API rejects. It was
// captured from Claude Code, whose beta set includes `oauth-2025-04-20` — the
// live session authenticated with a subscription OAuth token, and global cache
// scope is not accepted on the `x-api-key` path the replay must use.
//
// Normalised away rather than worked around, because the alternative (adding
// global scope to every preceding block) changes what is cached, and this does
// not: scope selects how WIDELY a cache entry is shared, and both arms already
// run in their own namespace. Applied through the same both-arms path as the
// generation cap, so the symmetry is structural rather than a convention two
// call sites happen to honour.
describe("global cache scope normalisation", () => {
  const scoped = () => ({
    model: "m",
    max_tokens: 64000,
    system: [
      { type: "text", text: "billing" },
      {
        type: "text",
        text: "core",
        cache_control: { type: "ephemeral", ttl: "1h", scope: "global" },
      },
      { type: "text", text: "more", cache_control: { type: "ephemeral", ttl: "1h" } },
    ],
    tools: [{ name: "Bash", description: "d", input_schema: { type: "object" } }],
    messages: [{ role: "user", content: "hi" }],
  });

  it("drops scope:global from both arms", () => {
    const arms = prepareArms({ requests: [scoped()], applySaver: () => null });
    for (const body of [arms.baseline[0], arms.megasaver[0]]) {
      const blocks = (body as unknown as { system: { cache_control?: Record<string, unknown> }[] })
        .system;
      expect(blocks[1]?.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    }
  });

  it("keeps the rest of cache_control intact — only scope goes", () => {
    const arms = prepareArms({ requests: [scoped()], applySaver: () => null });
    const blocks = (
      arms.baseline[0] as unknown as {
        system: { cache_control?: Record<string, unknown> }[];
      }
    ).system;
    // The breakpoints themselves are load-bearing: removing one would change
    // what is cached and therefore what is measured.
    expect(blocks[1]?.cache_control?.["type"]).toBe("ephemeral");
    expect(blocks[1]?.cache_control?.["ttl"]).toBe("1h");
    expect(blocks[2]?.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(blocks[0]?.cache_control).toBeUndefined();
  });

  // "global" is the only value the x-api-key path rejects. Deleting `scope`
  // whenever it is present would silently rewrite a narrower scope into the
  // default and change what is cached — the exact class of harm this function
  // avoids by not touching the breakpoints.
  it("preserves a scope that is not global", () => {
    const sessionScoped = {
      model: "m",
      system: [
        {
          type: "text",
          text: "core",
          cache_control: { type: "ephemeral", ttl: "1h", scope: "session" },
        },
      ],
      messages: [{ role: "user", content: "hi" }],
    };
    const arms = prepareArms({ requests: [sessionScoped], applySaver: () => null });
    const blocks = (
      arms.baseline[0] as unknown as {
        system: { cache_control?: Record<string, unknown> }[];
      }
    ).system;
    expect(blocks[0]?.cache_control?.["scope"]).toBe("session");
  });

  it("leaves a recording that never used global scope untouched", () => {
    const plain = {
      model: "m",
      system: [{ type: "text", text: "core", cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: "hi" }],
    };
    const arms = prepareArms({ requests: [plain], applySaver: () => null });
    expect((arms.baseline[0] as unknown as { system: unknown }).system).toEqual(plain.system);
  });
});
