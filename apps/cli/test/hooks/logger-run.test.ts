import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runHookLogger } from "../../src/hooks/logger-run.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-hook-run-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const logPath = () => join(root, ".megasaver", "hooks", "claude-tool-calls.jsonl");

describe("runHookLogger", () => {
  it("appends a metadata line for an eligible payload and returns 0", () => {
    const code = runHookLogger({
      stdin: JSON.stringify({
        tool_name: "Read",
        tool_input: { file_path: "src/a.ts" },
        session_id: "s1",
      }),
      cwd: root,
      now: () => "2026-06-12T15:21:00.000Z",
    });
    expect(code).toBe(0);
    expect(JSON.parse(readFileSync(logPath(), "utf8").trim()).tool).toBe("Read");
  });

  it("returns 0 and writes nothing for invalid JSON on stdin", () => {
    const code = runHookLogger({ stdin: "not json", cwd: root });
    expect(code).toBe(0);
    expect(existsSync(logPath())).toBe(false);
  });

  it("returns 0 and writes nothing for empty stdin", () => {
    const code = runHookLogger({ stdin: "", cwd: root });
    expect(code).toBe(0);
    expect(existsSync(logPath())).toBe(false);
  });

  it("returns 0 for a non-eligible tool", () => {
    const code = runHookLogger({ stdin: JSON.stringify({ tool_name: "Write" }), cwd: root });
    expect(code).toBe(0);
    expect(existsSync(logPath())).toBe(false);
  });
});
