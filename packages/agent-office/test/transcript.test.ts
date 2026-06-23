import { describe, expect, it } from "vitest";
import { projectEvent, transcriptEntrySchema } from "../src/transcript.js";

describe("projectEvent", () => {
  it("maps an assistant text block", () => {
    const e = projectEvent({
      kind: "stream",
      payload: { type: "assistant", message: { content: [{ type: "text", text: "Hello" }] } },
    });
    expect(e).toEqual({ role: "assistant", text: "Hello" });
  });

  it("maps an Edit tool_use to a tool entry with basename", () => {
    const e = projectEvent({
      kind: "stream",
      payload: {
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "Edit", input: { file_path: "/a/b/foo.ts" } }],
        },
      },
    });
    expect(e).toEqual({ role: "tool", tool: "Edit", summary: "foo.ts" });
  });

  it("maps a Bash tool_use to the truncated command", () => {
    const e = projectEvent({
      kind: "stream",
      payload: {
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Bash", input: { command: "pnpm test" } }] },
      },
    });
    expect(e).toEqual({ role: "tool", tool: "Bash", summary: "pnpm test" });
  });

  it("maps a tool_use with no recognized input to a bare tool entry", () => {
    const e = projectEvent({
      kind: "stream",
      payload: {
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "WebSearch", input: { query: "x" } }] },
      },
    });
    expect(e).toEqual({ role: "tool", tool: "WebSearch" });
  });

  it("maps a tool_result (user) to a truncated summary", () => {
    const e = projectEvent({
      kind: "stream",
      payload: {
        type: "user",
        message: { content: [{ type: "tool_result", content: "x".repeat(500) }] },
      },
    });
    expect(e?.role).toBe("tool_result");
    expect((e?.summary ?? "").length).toBeLessThanOrEqual(201);
  });

  it("maps a successful result", () => {
    expect(projectEvent({ kind: "stream", payload: { type: "result", is_error: false } })).toEqual({
      role: "result",
      summary: "done",
    });
  });

  it("maps a failed result", () => {
    expect(projectEvent({ kind: "stream", payload: { type: "result", is_error: true } })).toEqual({
      role: "result",
      summary: "failed",
    });
  });

  it("skips system events", () => {
    expect(
      projectEvent({ kind: "stream", payload: { type: "system", subtype: "init" } }),
    ).toBeNull();
  });

  it("maps non-empty stderr", () => {
    expect(projectEvent({ kind: "stderr", text: " boom\n" })).toEqual({
      role: "stderr",
      summary: "boom",
    });
  });

  it("skips empty stderr", () => {
    expect(projectEvent({ kind: "stderr", text: "  \n" })).toBeNull();
  });

  it("returns the first relevant assistant block when multiple are present", () => {
    const e = projectEvent({
      kind: "stream",
      payload: {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "hi" },
            { type: "tool_use", name: "Read", input: { file_path: "x.ts" } },
          ],
        },
      },
    });
    expect(e).toEqual({ role: "assistant", text: "hi" });
  });

  // Hostile / malformed payloads must never throw — the launcher emits these
  // from an async stdout callback, so a throw would become an uncaughtException
  // and crash the bridge.
  it("does not throw on a null content block", () => {
    expect(() =>
      projectEvent({
        kind: "stream",
        payload: { type: "assistant", message: { content: [null] } },
      }),
    ).not.toThrow();
  });

  it("does not throw on a primitive content block", () => {
    expect(() =>
      projectEvent({ kind: "stream", payload: { type: "user", message: { content: [42, "x"] } } }),
    ).not.toThrow();
  });

  it("returns null when message is missing", () => {
    expect(projectEvent({ kind: "stream", payload: { type: "assistant" } })).toBeNull();
  });

  it("returns null when content is not an array", () => {
    expect(
      projectEvent({
        kind: "stream",
        payload: { type: "assistant", message: { content: "nope" } },
      }),
    ).toBeNull();
  });

  it("returns null for a non-object payload", () => {
    expect(projectEvent({ kind: "stream", payload: 42 })).toBeNull();
    expect(projectEvent({ kind: "stream", payload: null })).toBeNull();
  });

  it("truncates very long assistant text", () => {
    const e = projectEvent({
      kind: "stream",
      payload: {
        type: "assistant",
        message: { content: [{ type: "text", text: "x".repeat(9000) }] },
      },
    });
    expect(e?.role).toBe("assistant");
    expect((e?.text ?? "").length).toBeLessThanOrEqual(4001);
  });
});

describe("transcriptEntrySchema", () => {
  it("accepts a full entry", () => {
    expect(() =>
      transcriptEntrySchema.parse({
        id: "00000000-0000-4000-8000-000000000000",
        seq: 0,
        ts: "2026-06-23T12:00:00.000Z",
        role: "assistant",
        text: "hi",
      }),
    ).not.toThrow();
  });

  it("rejects an unknown role", () => {
    expect(() =>
      transcriptEntrySchema.parse({
        id: "00000000-0000-4000-8000-000000000000",
        seq: 0,
        ts: "2026-06-23T12:00:00.000Z",
        role: "nope",
      }),
    ).toThrow();
  });
});
