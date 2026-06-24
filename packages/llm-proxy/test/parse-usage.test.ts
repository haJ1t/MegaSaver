import { describe, expect, it } from "vitest";
import { countRequestMessages, parseUsageFromJson, parseUsageFromSse } from "../src/parse-usage.js";

describe("countRequestMessages", () => {
  it("reads model + counts messages", () => {
    const body = JSON.stringify({
      model: "claude-opus-4-8",
      system: "you are…",
      messages: [{ role: "user" }, { role: "assistant" }, { role: "user" }],
    });
    expect(countRequestMessages(body)).toEqual({ model: "claude-opus-4-8", messageCount: 3 });
  });

  it("malformed body → zero/empty (best-effort)", () => {
    expect(countRequestMessages("not json")).toEqual({ model: "", messageCount: 0 });
    expect(countRequestMessages("{}")).toEqual({ model: "", messageCount: 0 });
  });
});

describe("parseUsageFromJson", () => {
  it("extracts usage from a non-stream response", () => {
    const body = JSON.stringify({
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 10,
        cache_creation_input_tokens: 5,
      },
    });
    expect(parseUsageFromJson(body)).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 10,
      cacheCreationTokens: 5,
    });
  });

  it("defaults missing cache fields to 0", () => {
    const body = JSON.stringify({ usage: { input_tokens: 7, output_tokens: 3 } });
    expect(parseUsageFromJson(body)).toEqual({
      inputTokens: 7,
      outputTokens: 3,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
  });

  it("no usage → null", () => {
    expect(parseUsageFromJson(JSON.stringify({ id: "x" }))).toBeNull();
    expect(parseUsageFromJson("not json")).toBeNull();
  });
});

describe("parseUsageFromSse", () => {
  it("accumulates input from message_start and output from message_delta", () => {
    const sse = [
      "event: message_start",
      'data: {"type":"message_start","message":{"usage":{"input_tokens":100,"cache_read_input_tokens":10,"cache_creation_input_tokens":5,"output_tokens":1}}}',
      "",
      "event: message_delta",
      'data: {"type":"message_delta","usage":{"output_tokens":50}}',
      "",
      "event: message_stop",
      'data: {"type":"message_stop"}',
      "",
    ].join("\n");
    expect(parseUsageFromSse(sse)).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 10,
      cacheCreationTokens: 5,
    });
  });

  it("no usage events → null", () => {
    expect(parseUsageFromSse("event: ping\ndata: {}\n")).toBeNull();
  });
});
