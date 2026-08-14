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

import {
  COMMAND_UNMEASURED_CAVEAT,
  DISCOVER_HOOK_MISSING_HINT,
  type ExposureScanInput,
  type HookLogRow,
  type MediatedEvent,
  scanExposure,
} from "../src/discover.js";
import { tokensFromBytes } from "../src/honest-metrics.js";

const row = (over: Partial<HookLogRow> = {}): HookLogRow => ({
  timestamp: "2026-08-13T10:00:00.000Z",
  tool: "Read",
  category: "eligible_read",
  ...over,
});

const event = (over: Partial<MediatedEvent> = {}): MediatedEvent => ({
  createdAt: "2026-08-13T10:00:00.000Z",
  rawBytes: 100,
  returnedBytes: 10,
  ...over,
});

const baseInput = (over: Partial<ExposureScanInput> = {}): ExposureScanInput => ({
  hookLogPresent: true,
  rows: [],
  activation: { enabled: true, mode: "safe" },
  floorFor: () => 32_000,
  coveredTool: () => true,
  sizeOf: () => undefined,
  mediatedEvents: [],
  ...over,
});

describe("scanExposure", () => {
  it("missing hook log -> no groups, no numbers, install hint", () => {
    const report = scanExposure(baseInput({ hookLogPresent: false }));
    expect(report.groups).toHaveLength(0);
    expect(report.aboveFloor).toBeNull();
    expect(report.mediated).toEqual({ execRewrite: null, postToolUse: null });
    expect(report.hint).toBe(DISCOVER_HOOK_MISSING_HINT);
  });

  it("disabled workspace: every row is exposure, measured/unmeasured split inside the group", () => {
    const rows = [
      row({ filePath: "/repo/a.ts" }),
      row({ tool: "Bash", category: "eligible_command" }),
    ];
    const report = scanExposure(
      baseInput({
        rows,
        activation: null,
        sizeOf: (p) => (p === "/repo/a.ts" ? 5_000 : undefined),
      }),
    );
    expect(report.groups).toHaveLength(1);
    const g = report.groups[0];
    expect(g?.cause).toBe("workspace_disabled");
    expect(g?.calls).toBe(2);
    expect(g?.measuredBytes).toBe(5_000);
    expect(g?.unmeasuredCalls).toBe(1);
    expect(g?.remediation).toBe("mega session saver workspace enable");
    expect(g?.estTokens).toBe(tokensFromBytes(5_000));
  });

  it("below-floor is boundary-exact: size == floor is exposure, floor+1 is aboveFloor", () => {
    const rows = [row({ filePath: "/repo/eq.ts" }), row({ filePath: "/repo/over.ts" })];
    const sizes: Record<string, number> = { "/repo/eq.ts": 32_000, "/repo/over.ts": 32_001 };
    const report = scanExposure(baseInput({ rows, sizeOf: (p) => sizes[p] }));
    const g = report.groups.find((x) => x.cause === "below_floor");
    expect(g?.calls).toBe(1);
    expect(g?.measuredBytes).toBe(32_000);
    expect(g?.caveat).toContain("A4");
    expect(report.aboveFloor).toEqual({ calls: 1, measuredBytes: 32_001 });
  });

  it("uncovered tools and eligible_mcp group separately; both count-only", () => {
    const rows = [
      row({ tool: "FutureTool", category: "eligible_read" }),
      row({ tool: "mcp__github__search", category: "eligible_mcp" }),
    ];
    const report = scanExposure(baseInput({ rows, coveredTool: (t) => t !== "FutureTool" }));
    expect(report.groups.map((g) => g.cause).sort()).toEqual(["mcp_unproxied", "source_uncovered"]);
    const mcp = report.groups.find((g) => g.cause === "mcp_unproxied");
    expect(mcp?.measuredBytes).toBe(0);
    expect(mcp?.remediation).toBe("mega mcp install");
    const unc = report.groups.find((g) => g.cause === "source_uncovered");
    expect(unc?.remediation).toContain("coverage gap");
  });

  it("command rows are command_unmeasured: count-only, null remediation, caveat", () => {
    const rows = [
      row({ tool: "Bash", category: "eligible_command" }),
      row({ tool: "Task", category: "eligible_command" }),
    ];
    const report = scanExposure(baseInput({ rows }));
    const g = report.groups.find((x) => x.cause === "command_unmeasured");
    expect(g?.calls).toBe(2);
    expect(g?.measuredBytes).toBe(0);
    expect(g?.remediation).toBeNull();
    expect(g?.caveat).toBe(COMMAND_UNMEASURED_CAVEAT);
  });

  it("unmeasurable read rows in an enabled workspace land in report.unmeasuredCalls, no group", () => {
    const rows = [row({ filePath: "/repo/dir" }), row({})];
    const report = scanExposure(baseInput({ rows, sizeOf: () => undefined }));
    expect(report.groups).toHaveLength(0);
    expect(report.unmeasuredCalls).toBe(2);
  });

  it("topFiles rollup: repeated reads count per call, sorted, capped at 5", () => {
    const rows = Array.from({ length: 8 }, (_, i) =>
      i < 3 ? row({ filePath: "/repo/hot.ts" }) : row({ filePath: `/repo/cold${i}.ts` }),
    );
    const report = scanExposure(
      baseInput({ rows, sizeOf: (p) => (p === "/repo/hot.ts" ? 8_000 : 100) }),
    );
    const g = report.groups.find((x) => x.cause === "below_floor");
    expect(g?.uniqueFiles).toBe(6);
    expect(g?.topFiles[0]).toEqual({ filePath: "/repo/hot.ts", calls: 3, measuredBytes: 24_000 });
    expect(g?.topFiles).toHaveLength(5);
    expect(g?.calls).toBe(8);
    expect(g?.measuredBytes).toBe(24_000 + 5 * 100);
  });

  it("window spans min/max valid row timestamps; invalid timestamps count but never define the window", () => {
    const rows = [
      row({ timestamp: "2026-08-01T00:00:00.000Z" }),
      row({ timestamp: "not-a-date", filePath: "/repo/a.ts" }),
      row({ timestamp: "2026-08-13T00:00:00.000Z" }),
    ];
    const report = scanExposure(baseInput({ rows, sizeOf: () => 1_000 }));
    expect(report.window).toEqual({
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-13T00:00:00.000Z",
    });
    expect(report.groups[0]?.calls).toBe(1);
    expect(report.unmeasuredCalls).toBe(2);
  });

  it("mediated fold: windowed, origin-split, corrupt dates skipped", () => {
    const rows = [
      row({ timestamp: "2026-08-13T10:00:00.000Z" }),
      row({ timestamp: "2026-08-13T12:00:00.000Z" }),
    ];
    const events = [
      event({ createdAt: "2026-08-13T11:00:00.000Z", rawBytes: 100, returnedBytes: 10 }),
      event({
        createdAt: "2026-08-13T11:00:00.000Z",
        rawBytes: 200,
        returnedBytes: 20,
        origin: "exec-rewrite",
      }),
      event({ createdAt: "2026-08-13T09:00:00.000Z", rawBytes: 999, returnedBytes: 99 }),
      event({ createdAt: "garbage", rawBytes: 888, returnedBytes: 88 }),
    ];
    const report = scanExposure(baseInput({ rows, sizeOf: () => 1_000, mediatedEvents: events }));
    expect(report.mediated).toEqual({
      postToolUse: { calls: 1, rawBytes: 100, returnedBytes: 10 },
      execRewrite: { calls: 1, rawBytes: 200, returnedBytes: 20 },
    });
  });

  it("no valid window -> both mediated folds null", () => {
    const report = scanExposure(
      baseInput({
        rows: [row({ timestamp: "junk" })],
        sizeOf: () => 1_000,
        mediatedEvents: [event()],
      }),
    );
    expect(report.window).toBeNull();
    expect(report.mediated).toEqual({ execRewrite: null, postToolUse: null });
  });

  it("groups sort by measuredBytes desc, then calls desc", () => {
    const rows = [
      row({ filePath: "/repo/small.ts" }),
      row({ tool: "Bash", category: "eligible_command" }),
    ];
    const report = scanExposure(
      baseInput({ rows, sizeOf: (p) => (p === "/repo/small.ts" ? 100 : undefined) }),
    );
    expect(report.groups[0]?.cause).toBe("below_floor");
  });

  it("honesty invariants: no price fields, tokens derived only from measured bytes", () => {
    const report = scanExposure(
      baseInput({ rows: [row({ filePath: "/repo/a.ts" })], sizeOf: () => 1_000 }),
    );
    expect(JSON.stringify(report)).not.toMatch(/usd|dollar|price|\$/i);
    for (const g of report.groups) expect(g.estTokens).toBe(tokensFromBytes(g.measuredBytes));
  });
});
