import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMcpDoctor } from "../../src/commands/mcp/doctor.js";
import { HOOK_LOG_RELATIVE_PATH } from "../../src/hooks/logger.js";

describe("runMcpDoctor", () => {
  let home: string;
  let cwd: string;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "cli-mcp-doctor-home-"));
    cwd = await mkdtemp(join(tmpdir(), "cli-mcp-doctor-cwd-"));
    const cfgDir = join(home, ".config", "claude");
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(
      join(cfgDir, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          megasaver: { command: "mega", args: ["mcp", "serve"] },
          srv_a: { command: "srv-a-mcp" },
          srv_b: { command: "srv-b-mcp" },
        },
      }),
    );
    const logPath = join(cwd, HOOK_LOG_RELATIVE_PATH);
    mkdirSync(join(cwd, ".megasaver", "hooks"), { recursive: true });
    writeFileSync(
      logPath,
      [
        '{"timestamp":"2026-08-06T09:00:00.000Z","agent":"claude-code","tool":"mcp__srv_a__read_file","category":"eligible_mcp"}',
        '{"timestamp":"2026-08-06T09:00:01.000Z","agent":"claude-code","tool":"mcp__srv_b__read_file","category":"eligible_mcp"}',
      ].join("\n"),
    );
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  });

  it("exits 1 on a high clone_exact finding and prints its remediation", async () => {
    const out: string[] = [];
    const code = await runMcpDoctor({ home, cwd, stdout: (l) => out.push(l), stderr: () => undefined, json: false });
    expect(code).toBe(1);
    const text = out.join("\n");
    expect(text).toContain("clone_shadowing");
    expect(text).toContain("read_file");
    expect(text).toContain("remediation:");
  });

  it("--json emits the full report as one parseable line", async () => {
    const out: string[] = [];
    const code = await runMcpDoctor({ home, cwd, stdout: (l) => out.push(l), stderr: () => undefined, json: true });
    expect(code).toBe(1);
    expect(out).toHaveLength(1);
    const report = JSON.parse(out[0] ?? "{}") as { usageEvidence: string; findings: Array<{ code: string }> };
    expect(report.usageEvidence).toBe("hook-log");
    expect(report.findings.some((f) => f.code === "clone_exact")).toBe(true);
  });

  it("exits 0 with usage-unknown info when no hook log exists", async () => {
    await rm(join(cwd, ".megasaver"), { recursive: true, force: true });
    const out: string[] = [];
    const code = await runMcpDoctor({ home, cwd, stdout: (l) => out.push(l), stderr: () => undefined, json: true });
    expect(code).toBe(0);
    const report = JSON.parse(out[0] ?? "{}") as { usageEvidence: string };
    expect(report.usageEvidence).toBe("none");
  });
});
