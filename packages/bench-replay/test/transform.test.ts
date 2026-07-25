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
  it("baseline returns the body unchanged (deep equal, new object)", () => {
    const out = transformRequest(body, "baseline", () => "IGNORED");
    expect(out).toEqual(body);
    expect(out).not.toBe(body);
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
    expect(out).toEqual(body);
  });

  it("does not mutate the input body", () => {
    const snapshot = JSON.parse(JSON.stringify(body));
    transformRequest(body, "megasaver", () => "X");
    expect(body).toEqual(snapshot);
  });

  it("leaves string-content messages alone (nothing to rewrite)", () => {
    const plain = { model: "m", messages: [{ role: "user", content: "just text" }] };
    expect(transformRequest(plain, "megasaver", () => "X")).toEqual(plain);
  });

  // Real recorded Claude Code transcripts show tool_result.content as an array of
  // content blocks (the Anthropic API's other accepted shape) in ~14% of cases —
  // not a rare edge case. Skipping it would silently under-transform the megasaver
  // arm and bias the benchmark toward "no effect".
  it("megasaver rewrites array-form tool_result content, merging text blocks and keeping non-text blocks", () => {
    const arrayBody = {
      model: "m",
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
    expect(transformRequest(imageOnlyBody, "megasaver", () => "SHOULD NOT BE CALLED")).toEqual(
      imageOnlyBody,
    );
  });

  it("a passthrough decision on array-form content leaves it untouched", () => {
    const arrayBody = {
      model: "m",
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
    expect(transformRequest(arrayBody, "megasaver", () => null)).toEqual(arrayBody);
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
  it("leaves every cache-keyed field byte-identical to the recording", () => {
    const arms = prepareArms({ requests: recorded, applySaver: () => null });
    const sent = arms.baseline[0] as Record<string, unknown>;
    const original = recorded[0] as Record<string, unknown>;
    for (const key of ["model", "stream", "system", "tools", "messages"]) {
      expect(sent[key]).toEqual(original[key]);
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
