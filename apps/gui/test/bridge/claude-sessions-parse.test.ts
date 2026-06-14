import { describe, expect, it } from "vitest";
import { normalizeLine } from "../../bridge/claude-sessions/parse.js";

describe("normalizeLine", () => {
  it("normalizes a user string line", () => {
    const msg = normalizeLine({
      type: "user",
      timestamp: "2026-06-14T10:00:00.000Z",
      message: { role: "user", content: "hello there" },
    });
    expect(msg).toEqual({
      role: "user",
      ts: "2026-06-14T10:00:00.000Z",
      blocks: [{ kind: "text", text: "hello there" }],
    });
  });

  it("normalizes an assistant line with thinking, text, tool_use and tool_result blocks", () => {
    const msg = normalizeLine({
      type: "assistant",
      timestamp: "2026-06-14T10:00:01.000Z",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "let me think", signature: "x" },
          { type: "text", text: "the answer" },
          { type: "tool_use", name: "Bash", input: { command: "ls" } },
          { type: "tool_result", content: "exit 0" },
        ],
      },
    });
    expect(msg?.role).toBe("assistant");
    expect(msg?.blocks).toEqual([
      { kind: "thinking", text: "let me think" },
      { kind: "text", text: "the answer" },
      { kind: "tool_use", text: 'Bash({"command":"ls"})' },
      { kind: "tool_result", text: "exit 0" },
    ]);
  });

  it("truncates a long tool_use input", () => {
    const msg = normalizeLine({
      type: "assistant",
      timestamp: "2026-06-14T10:00:02.000Z",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", name: "Bash", input: { command: "x".repeat(3000) } }],
      },
    });
    expect(msg?.blocks[0]?.kind).toBe("tool_use");
    expect(msg?.blocks[0]?.text.length ?? 0).toBeLessThanOrEqual(2010);
  });

  it("returns null for attachment, queue-operation, last-prompt, system lines", () => {
    expect(normalizeLine({ type: "attachment" })).toBeNull();
    expect(normalizeLine({ type: "queue-operation" })).toBeNull();
    expect(normalizeLine({ type: "last-prompt", lastPrompt: "x" })).toBeNull();
    expect(normalizeLine({ type: "system", content: "x" })).toBeNull();
  });

  it("returns null for malformed input", () => {
    expect(normalizeLine(null)).toBeNull();
    expect(normalizeLine("nope")).toBeNull();
    expect(normalizeLine({ noType: true })).toBeNull();
    expect(normalizeLine({ type: "user" })).toBeNull();
  });

  it("retains per-turn model/usage/gitBranch as meta on an assistant line", () => {
    const msg = normalizeLine({
      type: "assistant",
      timestamp: "2026-06-14T10:00:01.000Z",
      gitBranch: "main",
      message: {
        role: "assistant",
        model: "claude-haiku-4-5-20251001",
        usage: {
          input_tokens: 3,
          output_tokens: 2,
          cache_creation_input_tokens: 17499,
          cache_read_input_tokens: 15204,
          service_tier: "standard",
        },
        content: [{ type: "text", text: "the answer" }],
      },
    });
    expect(msg?.meta).toEqual({
      model: "claude-haiku-4-5-20251001",
      usage: {
        inputTokens: 3,
        outputTokens: 2,
        cacheCreationInputTokens: 17499,
        cacheReadInputTokens: 15204,
      },
      gitBranch: "main",
    });
  });

  it("omits meta entirely when no model/usage/gitBranch on the line", () => {
    const msg = normalizeLine({
      type: "assistant",
      timestamp: "2026-06-14T10:00:01.000Z",
      message: { role: "assistant", content: [{ type: "text", text: "plain" }] },
    });
    expect(msg).not.toBeNull();
    expect("meta" in (msg as object)).toBe(false);
  });
});
