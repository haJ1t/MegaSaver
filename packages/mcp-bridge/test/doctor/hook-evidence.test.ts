import { describe, expect, it } from "vitest";
import { parseMcpHookLog, parseMcpWireName } from "../../src/doctor/hook-evidence.js";

const LOG = [
  '{"timestamp":"2026-08-06T09:00:00.000Z","agent":"claude-code","tool":"mcp__filetools__write_file","category":"eligible_mcp","sessionId":"s1"}',
  '{"timestamp":"2026-08-06T09:00:01.000Z","agent":"claude-code","tool":"Read","category":"eligible_read","filePath":"src/a.ts"}',
  '{"timestamp":"2026-08-06T09:00:02.000Z","agent":"claude-code","tool":"mcp__filetools__write_file","category":"eligible_mcp"}',
  '{"timestamp":"2026-08-06T09:00:03.000Z","agent":"claude-code","tool":"mcp__cloudfetch__fetch_url","category":"eligible_mcp"}',
  '{"timestamp":"2026-08-06T09:00:04.000Z","agent":"claude-code","tool":"mcp__megasaver__proxy_read_file","category":"eligible_mcp"}',
  "{broken json",
  "",
].join("\n");

describe("parseMcpHookLog", () => {
  it("counts per-server bare tool calls, skipping native, megasaver, and broken lines", () => {
    const evidence = parseMcpHookLog(LOG);
    expect([...evidence.servers.keys()].sort()).toEqual(["cloudfetch", "filetools"]);
    expect(evidence.servers.get("filetools")?.get("write_file")).toBe(2);
    expect(evidence.servers.get("cloudfetch")?.get("fetch_url")).toBe(1);
  });
});

describe("parseMcpWireName", () => {
  it.each([
    ["mcp__srv__tool", { serverKey: "srv", toolName: "tool" }],
    ["mcp__srv__read_file", { serverKey: "srv", toolName: "read_file" }],
    ["mcp__a__b__c", { serverKey: "a", toolName: "b__c" }],
    ["Read", null],
    ["mcp__", null],
    ["mcp__only", null],
  ])("%s", (wire, expected) => {
    expect(parseMcpWireName(wire)).toEqual(expected);
  });
});
