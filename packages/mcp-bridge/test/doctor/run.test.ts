import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { auditMcpSecurity } from "../../src/doctor/run.js";

const HOOK_LOG = [
  '{"timestamp":"2026-08-06T09:00:00.000Z","agent":"claude-code","tool":"mcp__filetools__write_file","category":"eligible_mcp"}',
  '{"timestamp":"2026-08-06T09:00:01.000Z","agent":"claude-code","tool":"mcp__filetools__proxy_read_file","category":"eligible_mcp"}',
].join("\n");

describe("auditMcpSecurity", () => {
  let home: string;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "mcp-doctor-run-"));
    const dir = join(home, ".config", "claude");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          megasaver: { command: "mega", args: ["mcp", "serve"] },
          filetools: { command: "filetools-mcp" },
          ghostserver: { url: "https://mcp.ghost.example/sse" },
        },
      }),
    );
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it("produces shadow + capability + unknown-inventory findings from real evidence", async () => {
    const report = await auditMcpSecurity({
      home,
      hookLogContent: HOOK_LOG,
      platform: "linux",
      now: () => new Date("2026-08-06T12:00:00.000Z"),
    });
    expect(report.generatedAt).toBe("2026-08-06T12:00:00.000Z");
    expect(report.usageEvidence).toBe("hook-log");
    const codes = report.findings.map((f) => f.code);
    expect(codes).toContain("shadows_bridge_tool");
    expect(codes).toContain("capability_write");
    expect(codes).toContain("non_localhost_url");
    const ghost = report.findings.find(
      (f) => f.code === "evidence_gap" && f.serverKey === "ghostserver",
    );
    expect(ghost?.message).toContain("unknown");
    const again = await auditMcpSecurity({
      home,
      hookLogContent: HOOK_LOG,
      platform: "linux",
      now: () => new Date("2026-08-06T12:00:00.000Z"),
    });
    expect(again.findings).toEqual(report.findings);
  });

  it("without a hook log, reports usage unknown instead of unused", async () => {
    const report = await auditMcpSecurity({ home, hookLogContent: null, platform: "linux" });
    expect(report.usageEvidence).toBe("none");
    const gap = report.findings.find(
      (f) => f.code === "evidence_gap" && f.remediation.includes("mega hooks install"),
    );
    expect(gap?.severity).toBe("info");
    expect(report.findings.some((f) => f.code.startsWith("capability_"))).toBe(false);
  });

  it("our own TOOL_DEFS descriptions carry zero hygiene findings (dogfood)", async () => {
    const report = await auditMcpSecurity({ home, hookLogContent: null, platform: "linux" });
    expect(report.findings.filter((f) => f.checkId === "description_hygiene")).toEqual([]);
  });
});
