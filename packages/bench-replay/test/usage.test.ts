import { describe, expect, it } from "vitest";
import { assembleSseUsage, assembleUsage } from "../src/usage.js";

// message_start's output_tokens is deliberately 3 and the final message_delta's
// is 500: any implementation that reads output from message_start scores 3 here.
const STREAM = [
  "event: message_start",
  'data: {"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":1000,"cache_creation_input_tokens":2000,"cache_read_input_tokens":4000,"output_tokens":3}}}',
  "",
  "event: content_block_start",
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
  "",
  "event: ping",
  'data: {"type":"ping"}',
  "",
  "event: content_block_delta",
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}',
  "",
  "event: message_delta",
  'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":500}}',
  "",
  "event: message_stop",
  'data: {"type":"message_stop"}',
  "",
].join("\n");

describe("assembleSseUsage", () => {
  it("takes output_tokens from the final message_delta, not message_start", () => {
    const usage = assembleSseUsage(STREAM);
    expect(usage.output_tokens).toBe(500);
    expect(usage.output_tokens).not.toBe(3);
  });

  it("takes input and cache counts from message_start", () => {
    expect(assembleSseUsage(STREAM)).toEqual({
      input_tokens: 1000,
      cache_creation_input_tokens: 2000,
      cache_read_input_tokens: 4000,
      output_tokens: 500,
    });
  });

  it("uses the LAST usage-bearing message_delta when several arrive", () => {
    const stream = [
      'data: {"type":"message_start","message":{"usage":{"input_tokens":1,"output_tokens":1}}}',
      'data: {"type":"message_delta","usage":{"output_tokens":40}}',
      'data: {"type":"message_delta","usage":{"output_tokens":900}}',
      'data: {"type":"message_stop"}',
    ].join("\n");
    expect(assembleSseUsage(stream).output_tokens).toBe(900);
  });

  it("survives CRLF line endings", () => {
    expect(assembleSseUsage(STREAM.replace(/\n/g, "\r\n")).output_tokens).toBe(500);
  });

  it("throws on a mid-stream error event rather than reporting partial usage", () => {
    const stream = [
      'data: {"type":"message_start","message":{"usage":{"input_tokens":1000,"output_tokens":3}}}',
      'data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
    ].join("\n");
    expect(() => assembleSseUsage(stream)).toThrow(/overloaded_error/);
  });

  it("throws when no message_delta carried output_tokens", () => {
    const stream = [
      'data: {"type":"message_start","message":{"usage":{"input_tokens":1000,"output_tokens":3}}}',
      'data: {"type":"message_stop"}',
    ].join("\n");
    expect(() => assembleSseUsage(stream)).toThrow(/placeholder/);
  });

  it("throws when the stream carried no message_start", () => {
    expect(() =>
      assembleSseUsage('data: {"type":"message_delta","usage":{"output_tokens":5}}'),
    ).toThrow(/no message_start/);
  });

  it("throws on an unparseable data line", () => {
    expect(() => assembleSseUsage("data: {not json")).toThrow(/unparseable SSE data line/);
  });
});

describe("assembleUsage", () => {
  it("dispatches to the SSE assembler on text/event-stream", () => {
    expect(
      assembleUsage({ contentType: "text/event-stream; charset=utf-8", body: STREAM })
        .output_tokens,
    ).toBe(500);
  });

  it("reads usage straight off a non-streaming JSON response", () => {
    const body = JSON.stringify({
      type: "message",
      usage: {
        input_tokens: 7,
        cache_creation_input_tokens: 8,
        cache_read_input_tokens: 9,
        output_tokens: 10,
      },
    });
    expect(assembleUsage({ contentType: "application/json", body })).toEqual({
      input_tokens: 7,
      cache_creation_input_tokens: 8,
      cache_read_input_tokens: 9,
      output_tokens: 10,
    });
  });

  it("throws on a JSON error response", () => {
    const body = JSON.stringify({
      type: "error",
      error: { type: "invalid_request_error", message: "bad" },
    });
    expect(() => assembleUsage({ contentType: "application/json", body })).toThrow(
      /invalid_request_error/,
    );
  });

  it("throws when a JSON response carries no usage block", () => {
    expect(() =>
      assembleUsage({ contentType: "application/json", body: '{"type":"message"}' }),
    ).toThrow(/no usage block/);
  });
});
