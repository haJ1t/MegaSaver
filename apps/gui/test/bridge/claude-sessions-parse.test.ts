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

  it("normalizes an assistant line with thinking, text and tool_use blocks", () => {
    const msg = normalizeLine({
      type: "assistant",
      timestamp: "2026-06-14T10:00:01.000Z",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "let me think", signature: "x" },
          { type: "text", text: "the answer" },
          { type: "tool_use", name: "Bash", input: { command: "ls" } },
        ],
      },
    });
    expect(msg?.role).toBe("assistant");
    expect(msg?.blocks).toEqual([
      { kind: "thinking", text: "let me think" },
      { kind: "text", text: "the answer" },
      { kind: "tool_use", text: 'Bash({"command":"ls"})' },
    ]);
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
});
