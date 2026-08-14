import { describe, expect, it } from "vitest";
import { parseHookLogRows } from "../src/discover.js";

const LINE = JSON.stringify({
  timestamp: "2026-08-13T10:00:00.000Z",
  agent: "claude-code",
  tool: "Read",
  category: "eligible_read",
  filePath: "/repo/src/big.ts",
  sessionId: "9e0d2f4a-1111-4111-8111-111111111111",
});

describe("parseHookLogRows", () => {
  it("parses valid lines and keeps optional fields", () => {
    const rows = parseHookLogRows(`${LINE}\n`);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tool).toBe("Read");
    expect(rows[0]?.agent).toBe("claude-code");
    expect(rows[0]?.filePath).toBe("/repo/src/big.ts");
  });

  it("tolerates rows without filePath/sessionId/agent (Bash, old lines)", () => {
    const bash = JSON.stringify({
      timestamp: "2026-08-13T10:00:01.000Z",
      tool: "Bash",
      category: "eligible_command",
    });
    const rows = parseHookLogRows(`${bash}\n`);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.filePath).toBeUndefined();
    expect(rows[0]?.agent).toBeUndefined();
  });

  it("skips blank, malformed, and partial-tail lines", () => {
    const rows = parseHookLogRows(`\n${LINE}\nnot-json\n{"timestamp": "2026-`);
    expect(rows).toHaveLength(1);
  });

  it("skips rows missing required fields", () => {
    const noTool = JSON.stringify({ timestamp: "t", agent: "claude-code", category: "c" });
    expect(parseHookLogRows(`${noTool}\n`)).toHaveLength(0);
  });
});
