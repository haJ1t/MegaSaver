import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ELIGIBLE_HOOK_TOOLS, buildHookLine, writeHookLine } from "../../src/hooks/logger.js";

const NOW = () => "2026-06-12T15:21:00.000Z";

describe("buildHookLine", () => {
  it("maps a Read PreToolUse payload to a metadata line", () => {
    const line = buildHookLine(
      { tool_name: "Read", tool_input: { file_path: "src/auth.ts" }, session_id: "abc123" },
      NOW,
    );
    expect(line).not.toBeNull();
    const parsed = JSON.parse(line as string);
    expect(parsed).toEqual({
      timestamp: "2026-06-12T15:21:00.000Z",
      agent: "claude-code",
      tool: "Read",
      category: "eligible_read",
      filePath: "src/auth.ts",
      sessionId: "abc123",
    });
  });

  it("maps Bash/Grep/Glob/LS to their eligibility categories", () => {
    expect(JSON.parse(buildHookLine({ tool_name: "Bash" }, NOW) as string).category).toBe(
      "eligible_command",
    );
    expect(JSON.parse(buildHookLine({ tool_name: "Grep" }, NOW) as string).category).toBe(
      "eligible_search",
    );
    expect(JSON.parse(buildHookLine({ tool_name: "Glob" }, NOW) as string).category).toBe(
      "eligible_search",
    );
    expect(JSON.parse(buildHookLine({ tool_name: "LS" }, NOW) as string).category).toBe(
      "eligible_read",
    );
  });

  it("omits filePath when the payload has no path", () => {
    const parsed = JSON.parse(buildHookLine({ tool_name: "Bash" }, NOW) as string);
    expect(parsed).not.toHaveProperty("filePath");
  });

  it("returns null for tools that are not eligible", () => {
    expect(buildHookLine({ tool_name: "Write", tool_input: { file_path: "x" } }, NOW)).toBeNull();
    expect(buildHookLine({ tool_name: "Edit" }, NOW)).toBeNull();
  });

  it("returns null for a payload with no usable tool name", () => {
    expect(buildHookLine({}, NOW)).toBeNull();
    expect(buildHookLine({ tool_name: 42 }, NOW)).toBeNull();
  });

  it("never throws on garbage input", () => {
    expect(() => buildHookLine(null, NOW)).not.toThrow();
    expect(() => buildHookLine(undefined, NOW)).not.toThrow();
    expect(() => buildHookLine("not an object", NOW)).not.toThrow();
    expect(buildHookLine(null, NOW)).toBeNull();
  });

  it("never emits file contents, only the path string", () => {
    const line = buildHookLine(
      {
        tool_name: "Read",
        tool_input: { file_path: "src/secret.ts", content: "API_KEY=supersecret" },
        session_id: "s",
      },
      NOW,
    ) as string;
    expect(line).not.toContain("supersecret");
    expect(line).not.toContain("content");
  });

  it("exposes the eligible tool set", () => {
    expect([...ELIGIBLE_HOOK_TOOLS].sort()).toEqual([
      "Bash",
      "BashOutput",
      "Glob",
      "Grep",
      "LS",
      "Monitor",
      "Read",
      "Task",
      "ToolSearch",
      "WebFetch",
      "WebSearch",
    ]);
  });

  it("maps wave-1 agent/search tools to their eligibility categories", () => {
    expect(JSON.parse(buildHookLine({ tool_name: "Task" }, NOW) as string).category).toBe(
      "eligible_command",
    );
    expect(JSON.parse(buildHookLine({ tool_name: "WebSearch" }, NOW) as string).category).toBe(
      "eligible_search",
    );
  });

  it("categorizes any non-Mega mcp__ tool as eligible_mcp", () => {
    const parsed = JSON.parse(buildHookLine({ tool_name: "mcp__somevendor__x" }, NOW) as string);
    expect(parsed.category).toBe("eligible_mcp");
  });

  it("drops Mega's own mcp bridge tools (never self-log)", () => {
    expect(buildHookLine({ tool_name: "mcp__megasaver__x" }, NOW)).toBeNull();
  });
});

describe("writeHookLine (best-effort)", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "megasaver-hook-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const logPath = () => join(root, ".megasaver", "hooks", "claude-tool-calls.jsonl");

  it("appends one JSONL line, creating the hooks dir if absent", () => {
    writeHookLine({
      megasaverRoot: root,
      payload: { tool_name: "Read", tool_input: { file_path: "a.ts" }, session_id: "s" },
      now: NOW,
    });
    expect(existsSync(logPath())).toBe(true);
    const lines = readFileSync(logPath(), "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string).tool).toBe("Read");
  });

  it("appends across multiple calls", () => {
    const base = { megasaverRoot: root, now: NOW };
    writeHookLine({ ...base, payload: { tool_name: "Read", tool_input: { file_path: "a.ts" } } });
    writeHookLine({ ...base, payload: { tool_name: "Bash" } });
    const lines = readFileSync(logPath(), "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
  });

  it("writes nothing for a non-eligible tool", () => {
    writeHookLine({ megasaverRoot: root, payload: { tool_name: "Write" }, now: NOW });
    expect(existsSync(logPath())).toBe(false);
  });

  it("does not throw when the megasaver root is an unwritable path", () => {
    // A path under a regular file cannot be a directory -> mkdir fails. The
    // writer must swallow it (the user's tool call must never be blocked).
    const file = join(root, "afile");
    writeFileSync(file, "x");
    expect(() =>
      writeHookLine({
        megasaverRoot: file,
        payload: { tool_name: "Read", tool_input: { file_path: "a.ts" } },
        now: NOW,
      }),
    ).not.toThrow();
  });

  it("does not throw on garbage payload and writes nothing", () => {
    expect(() =>
      writeHookLine({ megasaverRoot: root, payload: "garbage", now: NOW }),
    ).not.toThrow();
    expect(existsSync(logPath())).toBe(false);
  });
});
