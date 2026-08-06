import { describe, expect, it } from "vitest";
import { type SseUsageScanner, createSseUsageScanner } from "../src/parse-usage.js";

const MESSAGE_START =
  'data: {"type":"message_start","message":{"usage":{"input_tokens":100,"cache_read_input_tokens":10,"cache_creation_input_tokens":5,"output_tokens":1}}}';
const MESSAGE_DELTA = 'data: {"type":"message_delta","usage":{"output_tokens":50}}';
const EXPECTED = {
  inputTokens: 100,
  outputTokens: 50,
  cacheReadTokens: 10,
  cacheCreationTokens: 5,
};

function pushInChunks(scanner: SseUsageScanner, text: string, size: number): void {
  for (let i = 0; i < text.length; i += size) scanner.push(text.slice(i, i + size));
}

describe("createSseUsageScanner buffer bounds", () => {
  it("drops a newline-free line that outgrows the cap instead of buffering it", () => {
    const line = `data: ${JSON.stringify({
      type: "message_delta",
      pad: "x".repeat(1_500_000),
      usage: { output_tokens: 4242 },
    })}`;
    const scanner = createSseUsageScanner();
    pushInChunks(scanner, line, 65_536);
    scanner.push("\n");
    expect(scanner.result()).toBeNull();
  });

  it("keeps heap flat while a newline-free stream keeps arriving", () => {
    const chunk = "x".repeat(1_048_576);
    const scanner = createSseUsageScanner();
    scanner.push("data: ");
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 64; i += 1) scanner.push(chunk);
    const after = process.memoryUsage().heapUsed;
    expect(after - before).toBeLessThan(16 * 1024 * 1024);
  });

  it("resyncs at the next newline after an oversized line", () => {
    const scanner = createSseUsageScanner();
    pushInChunks(scanner, `data: ${"x".repeat(1_500_000)}`, 65_536);
    scanner.push(`\n${MESSAGE_START}\n${MESSAGE_DELTA}\n`);
    expect(scanner.result()).toEqual(EXPECTED);
  });

  it("still parses a large usage line that stays under the cap", () => {
    const big = `data: ${JSON.stringify({
      type: "message_delta",
      pad: "x".repeat(800_000),
      usage: { output_tokens: 50 },
    })}`;
    const scanner = createSseUsageScanner();
    scanner.push(`${MESSAGE_START}\n`);
    pushInChunks(scanner, big, 65_536);
    scanner.push("\n");
    expect(scanner.result()).toEqual(EXPECTED);
  });
});

describe("createSseUsageScanner well-formed streams", () => {
  const stream = [
    "event: message_start",
    MESSAGE_START,
    "",
    "event: message_delta",
    MESSAGE_DELTA,
    "",
    "event: message_stop",
    'data: {"type":"message_stop"}',
  ];

  it("yields the same totals when fed one character at a time", () => {
    const scanner = createSseUsageScanner();
    pushInChunks(scanner, `${stream.join("\n")}\n`, 1);
    expect(scanner.result()).toEqual(EXPECTED);
  });

  it("yields the same totals when the stream has no trailing newline", () => {
    const scanner = createSseUsageScanner();
    pushInChunks(scanner, [...stream, MESSAGE_DELTA].join("\n"), 7);
    expect(scanner.result()).toEqual(EXPECTED);
  });
});
