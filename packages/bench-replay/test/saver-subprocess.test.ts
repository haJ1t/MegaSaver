import { describe, expect, it } from "vitest";
import { makeSpawnedSaver } from "../src/saver-subprocess.js";

const BASH = { toolUseId: "t1", toolName: "Bash", toolInput: { command: "ls -la" } };

function saver(run: (payload: string) => string) {
  return makeSpawnedSaver({
    megaBin: "mega",
    cwd: "/repo",
    sessionId: "s1",
    storeRoot: "/tmp/store",
    run,
  });
}

describe("makeSpawnedSaver", () => {
  it("returns the updatedToolOutput text when the hook compresses", () => {
    const apply = saver(() =>
      JSON.stringify({
        hookSpecificOutput: { hookEventName: "PostToolUse", updatedToolOutput: "SHORT" },
      }),
    );
    expect(apply("LONG RAW", BASH)).toBe("SHORT");
  });

  it("returns null on a passthrough decision (hook emits nothing)", () => {
    expect(saver(() => "")("LONG RAW", BASH)).toBeNull();
  });

  // Fix 2: a crashed hook, a missing binary or a maxBuffer overrun must NOT be
  // reported as a passthrough decision — that is how an inert megasaver arm
  // masquerades as "the saver has no effect".
  it("throws when the hook process fails instead of faking a passthrough", () => {
    const apply = saver(() => {
      throw new Error("spawn ENOENT");
    });
    expect(() => apply("LONG RAW", BASH)).toThrow(/spawn ENOENT/);
  });

  it("throws when the hook emits unparseable output", () => {
    expect(() => saver(() => "{not json")("LONG RAW", BASH)).toThrow(/unparseable|JSON/i);
  });

  // Fix 3: floors are per-tool (Bash caps at BASH_COMPRESS_FLOOR, Read/Grep use
  // the plain mode budget, MCP surfaces get a 16384 floor) and the chunk-set
  // label comes from tool_input — a file extension must survive for semantic
  // chunking to fire. Hardcoding Bash/"replay" biased the measurement in both
  // directions at once.
  it("submits the real tool identity and input recovered from the recording", () => {
    let seen = "";
    const apply = saver((payload) => {
      seen = payload;
      return "";
    });
    apply("FILE BODY", {
      toolUseId: "t9",
      toolName: "Read",
      toolInput: { file_path: "/repo/src/transform.ts" },
    });
    const parsed = JSON.parse(seen);
    expect(parsed.tool_name).toBe("Read");
    expect(parsed.tool_input).toEqual({ file_path: "/repo/src/transform.ts" });
    expect(parsed.session_id).toBe("s1");
    expect(parsed.cwd).toBe("/repo");
    expect(parsed.tool_response).toBe("FILE BODY");
  });
});
